import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodiacId } from '../game/constants';
import { worldSupabase } from './world';
import { isLockedError } from '../game/unlock';
import { retryDaily } from '../game/daily';
import { isCharId } from '../game/constants';
import { parseGhost, type Ghost } from '../game/ghost';

/** 한 판의 시각 (모두 서버 시각 ms): '준비' 표시와 GO */
export interface GoInfo {
  round: number;
  readyAt: number;
  goAt: number;
}

export interface SubmitResult {
  /** 서버(랭킹)에 올라갔는가 */
  saved: boolean;
  /** 내 최고 기록 (ms) */
  bestMs: number;
  /** 이번 기록이 개인 최고 기록인가 */
  improved: boolean;
  /** 서버가 잠긴 캐릭터라서 거절했다 ('locked character') */
  locked?: boolean;
}

export interface RankRow {
  place: number;
  userId: string;
  nickname: string;
  bestMs: number;
  character: string;
}

/** 그날 1위 고스트 (095_race_ghost.sql 의 race_ghost_top). ghost 는 아직 확인 전 (받는 기기가 다시 달려 본다) */
export interface GhostTop {
  ghost: unknown;
  nickname: string;
  char: ZodiacId;
  ms: number;
  /** 그 사람의 역대 최고 기록 순위 (없으면 null) */
  place: number | null;
  /** 그날 순위 (1위의 고스트가 없으면 고스트가 있는 사람 중 가장 높은 순위) */
  dayPlace: number;
  /** 내 고스트인가 */
  me: boolean;
}

/** 고스트 올리기 결과: 받음(빠를 때만 바뀐다) · 서버가 거절(다시 해도 같다) · 통신 실패(다시 해 볼 것) */
export type GhostSubmitResult = 'ok' | 'rejected' | 'retry';

export interface RaceApi {
  kind: 'supabase' | 'local';
  /** 기기 시계를 서버 시각에 맞춘다 */
  syncClock(): Promise<void>;
  /** 이번 판의 준비·GO 시각을 서버에서 받는다 (room: 오늘의 도전 방 키) */
  go(room: string): Promise<GoInfo>;
  /** 완주 기록 올리기 (사람만) */
  submit(room: string, round: number, ms: number, character: ZodiacId): Promise<SubmitResult>;
  /** 내 최고 기록 (없으면 null) */
  myBest(): Promise<number | null>;
  /**
   * 역대 최고 기록 순위 (서버 race_ranking 뷰의 place, 읽기만): 사용자 id → 순위.
   * 기록이 없는 사람은 빠진다. 못 읽으면(통신 오류·테스트 모드) 빈 표 — 화면은 구름으로 그린다
   */
  places(ids: readonly string[]): Promise<Record<string, number>>;
  /**
   * 오늘의 도전: 방금 올린 완주 기록(race_runs)을 그날 기록으로 넣는다 (083_race_daily.sql).
   * 들어갔으면 기록된 날짜 'YYYY-MM-DD', 못 넣었으면 null. 통신이 실패하면 두 번까지 다시 해 본다
   */
  dailySubmit(room: string, round: number, day: string): Promise<string | null>;
  /** 그날 1위 고스트 (없거나 못 읽으면 null) */
  ghostTop(day: string): Promise<GhostTop | null>;
  /** 오늘의 도전 기록이 들어간 판의 고스트 올리기 (race_ghost_submit) */
  ghostSubmit(room: string, round: number, ghost: Ghost): Promise<GhostSubmitResult>;
  /**
   * 내 이번 주 순위 (096_race_weekly.sql 의 race_weekly_ranking 뷰 place, 읽기만).
   * 이번 주 기록이 없으면 null, 못 읽으면(통신 오류·테스트 모드) undefined
   */
  weeklyPlace(): Promise<number | null | undefined>;
}

/** race_ghost_top 의 답 → GhostTop (모양이 이상하면 null) */
export function ghostTopOf(d: unknown): GhostTop | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const ch = o.character;
  const dayPlace = Number(o.day_place);
  const ms = Number(o.ms);
  if (!isCharId(ch) || !(dayPlace >= 1) || !(ms > 0) || !o.ghost) return null;
  const place = Number(o.place);
  return { ghost: o.ghost, nickname: String(o.nickname ?? ''), char: ch, ms, place: place >= 1 ? place : null, dayPlace, me: o.me === true };
}

/** GO 요청부터 '준비' 표시까지 (서버 race_go 의 lead_ms 와 같은 값 — 최신 정의 095_race_ghost.sql) */
const LEAD_MS = 1200;
/** 같은 사람이 race_go 를 다시 부를 수 있는 최소 간격 (서버 031_race_150m.sql 의 gap_ms 와 같은 값) */
export const GO_GAP_MS = 4000;

/**
 * 서버가 'too soon'(같은 사람이 4초 안에 다시 GO 요청)으로 거절했다.
 * 이때 기기 시계로 판을 열면 서버에 그 판이 없어 기록·코인이 하나도 남지 않으므로, 조금 뒤 다시 물어야 한다
 */
export class GoTooSoonError extends Error {
  constructor() {
    super('too soon');
    this.name = 'GoTooSoonError';
  }
}

let offset = 0;
/** 서버 시각 (ms). syncClock 전에는 기기 시각 */
export const serverNow = () => Date.now() + offset;

/** 서버 없이 정한 시각 (테스트 모드, 또는 서버 함수가 실패했을 때) */
function localGo(): GoInfo {
  const now = serverNow();
  const readyAt = now + LEAD_MS;
  // 판 번호는 시각으로: 다시 도전해도 겹치지 않고 늘어난다
  return { round: Math.floor(now / 1000) % 100000000, readyAt, goAt: readyAt + 1000 + Math.random() * 2000 };
}

const bestKey = (uid: string) => `siarace:best150:${uid}`;
function readLocalBest(uid: string): number | null {
  try {
    const n = Number(localStorage.getItem(bestKey(uid)));
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}
function saveLocalBest(uid: string, ms: number): SubmitResult {
  const old = readLocalBest(uid);
  const improved = old === null || ms < old;
  if (improved) {
    try {
      localStorage.setItem(bestKey(uid), String(ms));
    } catch {
      /* 저장 못 해도 계속 */
    }
  }
  return { saved: false, bestMs: improved ? ms : old!, improved };
}

/** 테스트 모드: 기기에 그날 내 최고 고스트 (다음 판에 같이 달린다) */
const ghostKey = (uid: string, day: string) => `siarace:ghost:${uid}:${day}`;
function readLocalGhost(uid: string, day: string): Ghost | null {
  try {
    return parseGhost(JSON.parse(localStorage.getItem(ghostKey(uid, day)) ?? 'null'));
  } catch {
    return null;
  }
}

function createLocalApi(uid: string): RaceApi {
  return {
    kind: 'local',
    async syncClock() {},
    async go() {
      return localGo();
    },
    async submit(_room, _round, ms) {
      return saveLocalBest(uid, ms);
    },
    async myBest() {
      return readLocalBest(uid);
    },
    async places() {
      return {}; // 테스트 모드: 서버 순위 없음
    },
    async dailySubmit() {
      return null; // 테스트 모드: 서버 기록 없음
    },
    async ghostTop(day) {
      const g = readLocalGhost(uid, day);
      return g ? { ghost: g, nickname: '나', char: g.char, ms: g.ms, place: null, dayPlace: 1, me: true } : null;
    },
    async ghostSubmit(_room, _round, ghost) {
      const old = readLocalGhost(uid, ghost.day);
      if (old && old.ms <= ghost.ms) return 'ok';
      try {
        localStorage.setItem(ghostKey(uid, ghost.day), JSON.stringify(ghost));
      } catch {
        return 'rejected';
      }
      return 'ok';
    },
    async weeklyPlace() {
      return undefined; // 테스트 모드: 서버 순위 없음
    },
  };
}

function createSupabaseApi(sb: SupabaseClient, uid: string): RaceApi {
  return {
    kind: 'supabase',
    async syncClock() {
      // 세 번 물어 가장 빨리 돌아온 답으로 맞춘다
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        const { data, error } = await sb.rpc('race_now');
        const t1 = Date.now();
        if (error || typeof data !== 'number') return;
        if (t1 - t0 < best) {
          best = t1 - t0;
          offset = data - (t0 + t1) / 2;
        }
      }
    },
    async go(room) {
      const t0 = Date.now();
      const { data, error } = await sb.rpc('race_go', { p_room_key: room });
      const t1 = Date.now();
      const d = data as { round: number; ready_at: number; go_at: number; now: number } | null;
      // 너무 빨리 다시 불렀다: 기기 시계로 대신 열지 않는다 (solo.ts 가 남은 시간 뒤에 다시 묻는다)
      if (error && /too soon/.test(error.message ?? '')) throw new GoTooSoonError();
      if (error || !d) {
        // 통신 오류 등: 기기 시계로 대신 열면 30초 달린 뒤 기록이 거절되므로 던진다
        // (solo.ts SoloSession.go 가 다시 묻고, 끝내 안 되면 '준비하지 못했어요')
        console.warn('[시아레이스] 서버에서 GO 시각을 받지 못했어요', error?.message);
        throw new Error(error?.message || 'go failed');
      }
      // 답이 빨리 왔으면 시계도 다시 맞춘다
      if (t1 - t0 < 400) offset = d.now - (t0 + t1) / 2;
      return { round: d.round, readyAt: d.ready_at, goAt: d.go_at };
    },
    async submit(room, round, ms, character) {
      // 통신 실패(서버가 검사해서 거절한 P0001 이 아닌 오류)면 잠깐 쉬고 다시 (모두 3번, dailySubmit 과 같은 방식)
      let error: { message?: string; code?: string } | null = null;
      for (let i = 0; i < 3; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1200 * i));
        let data: unknown = null;
        try {
          ({ data, error } = await sb.rpc('race_submit', { p_room_key: room, p_round: round, p_time_ms: ms, p_character: character }));
        } catch (e) {
          error = { message: e instanceof Error ? e.message : String(e) };
        }
        const d = data as { best_ms: number; improved: boolean } | null;
        if (!error && d) {
          saveLocalBest(uid, d.best_ms);
          return { saved: true, bestMs: d.best_ms, improved: d.improved };
        }
        // 앞선 요청이 서버에는 닿았다 (응답만 못 받음): 받은 것으로 본다 (최고 기록은 기기 값과 이번 기록 중 작은 값)
        if (i > 0 && error && /already submitted/.test(error.message ?? '')) {
          const local = saveLocalBest(uid, ms);
          return { saved: true, bestMs: Math.min(local.bestMs, ms), improved: local.improved };
        }
        // 서버가 검사해서 거절한 것(raise exception)은 다시 해도 같다
        if (!error || error.code === 'P0001') break;
      }
      console.warn('[시아레이스] 기록을 서버에 올리지 못했어요', error?.message);
      return { ...saveLocalBest(uid, ms), locked: isLockedError(error?.message) };
    },
    async myBest() {
      const { data, error } = await sb.from('race_records').select('best_ms').eq('user_id', uid).maybeSingle();
      if (error) return readLocalBest(uid);
      return (data as { best_ms: number } | null)?.best_ms ?? null;
    },
    async places(ids) {
      const list = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
      if (!list.length) return {};
      try {
        const { data, error } = await sb.from('race_ranking').select('user_id,place').in('user_id', list);
        if (error || !Array.isArray(data)) return {};
        const out: Record<string, number> = {};
        for (const r of data as { user_id: string; place: number }[]) if (Number(r.place) > 0) out[r.user_id] = Number(r.place);
        return out;
      } catch {
        return {};
      }
    },
    dailySubmit(room, round, day) {
      return retryDaily(async () => {
        try {
          const { data, error } = await sb.rpc('race_daily_submit', { p_room_key: room, p_round: round, p_day: day });
          if (!error) return data ? { done: true, day: typeof (data as { day?: unknown }).day === 'string' ? (data as { day: string }).day : day } : { done: true, day: null };
          // 앞선 요청이 서버에는 닿았다 (응답만 못 받음): 들어간 것으로 본다
          if (/already submitted/.test(error.message ?? '')) return { done: true, day };
          // 서버가 검사해서 거절한 것(raise exception)은 다시 해도 같다
          if (error.code === 'P0001') return { done: true, day: null };
          return { done: false };
        } catch {
          return { done: false };
        }
      });
    },
    async ghostTop(day) {
      try {
        const { data, error } = await sb.rpc('race_ghost_top', { p_day: day });
        return error ? null : ghostTopOf(data);
      } catch {
        return null;
      }
    },
    async ghostSubmit(room, round, ghost) {
      try {
        const { error } = await sb.rpc('race_ghost_submit', { p_room_key: room, p_round: round, p_ghost: ghost });
        if (!error) return 'ok';
        // 서버가 검사해서 거절한 것(raise exception)은 다시 해도 같다
        return error.code === 'P0001' ? 'rejected' : 'retry';
      } catch {
        return 'retry';
      }
    },
    async weeklyPlace() {
      try {
        const { data, error } = await sb.from('race_weekly_ranking').select('place').eq('user_id', uid).maybeSingle();
        if (error) return undefined;
        const p = Number((data as { place?: unknown } | null)?.place);
        return data ? (p >= 1 ? p : undefined) : null;
      } catch {
        return undefined;
      }
    },
  };
}

const params = new URLSearchParams(location.search);
/** 주소의 ?local=1 이면 서버 없이 도는 테스트 모드 (로그인 없이). 개발 서버나 내 컴퓨터(localhost)에서만 켜진다 */
export const LOCAL_MODE =
  params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(location.hostname));

let api: RaceApi | null = null;
export async function getApi(uid: string): Promise<RaceApi> {
  if (api) return api;
  if (LOCAL_MODE) return (api = createLocalApi(uid));
  try {
    api = createSupabaseApi(await worldSupabase(), uid);
    void api.syncClock();
  } catch {
    return createLocalApi(uid); // 다음에 다시 시도
  }
  return api;
}
