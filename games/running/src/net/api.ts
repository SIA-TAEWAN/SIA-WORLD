import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodiacId } from '../game/constants';
import { LocalChannel, SupaChannel, type Channel } from './channel';
import { worldSupabase } from './world';

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
}

export interface RankRow {
  place: number;
  userId: string;
  nickname: string;
  bestMs: number;
  character: string;
}

export interface RaceApi {
  kind: 'supabase' | 'local';
  channel<M>(name: string, key: string): Channel<M>;
  /** 기기 시계를 서버 시각에 맞춘다 */
  syncClock(): Promise<void>;
  /** 방장: 이번 판의 준비·GO 시각을 서버에서 받는다 */
  go(room: string): Promise<GoInfo>;
  /** 완주 기록 올리기 (사람만) */
  submit(room: string, round: number, ms: number, character: ZodiacId): Promise<SubmitResult>;
  /** 내 최고 기록 (없으면 null) */
  myBest(): Promise<number | null>;
}

/** GO 요청부터 '준비' 표시까지 (서버 029_race.sql 의 lead_ms 와 같은 값) */
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
  // 판 번호는 시각으로: 방장이 바뀌어도 겹치지 않고 늘어난다
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

function createLocalApi(uid: string): RaceApi {
  return {
    kind: 'local',
    channel: <M>(name: string, key: string) => new LocalChannel<M>(name, key),
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
  };
}

function createSupabaseApi(sb: SupabaseClient, uid: string): RaceApi {
  return {
    kind: 'supabase',
    channel: <M>(name: string, key: string) => new SupaChannel<M>(sb, name, key),
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
      // 너무 빨리 다시 불렀다: 기기 시계로 대신 열지 않는다 (방에서 남은 시간 뒤에 다시 묻는다)
      if (error && /too soon/.test(error.message ?? '')) throw new GoTooSoonError();
      if (error || !d) {
        // 서버 함수를 못 쓰면(배포 전·통신 오류) 방장 시계로 정한다. 이 판의 기록은 랭킹에 못 올린다
        console.warn('[시아레이스] 서버에서 GO 시각을 받지 못해 이 기기 시계로 정합니다', error?.message);
        return localGo();
      }
      // 답이 빨리 왔으면 시계도 다시 맞춘다
      if (t1 - t0 < 400) offset = d.now - (t0 + t1) / 2;
      return { round: d.round, readyAt: d.ready_at, goAt: d.go_at };
    },
    async submit(room, round, ms, character) {
      const { data, error } = await sb.rpc('race_submit', { p_room_key: room, p_round: round, p_time_ms: ms, p_character: character });
      const d = data as { best_ms: number; improved: boolean } | null;
      if (error || !d) {
        console.warn('[시아레이스] 기록을 서버에 올리지 못했어요', error?.message);
        return saveLocalBest(uid, ms);
      }
      saveLocalBest(uid, d.best_ms);
      return { saved: true, bestMs: d.best_ms, improved: d.improved };
    },
    async myBest() {
      const { data, error } = await sb.from('race_records').select('best_ms').eq('user_id', uid).maybeSingle();
      if (error) return readLocalBest(uid);
      return (data as { best_ms: number } | null)?.best_ms ?? null;
    },
  };
}

const params = new URLSearchParams(location.search);
/** 주소의 ?local=1 이면 탭끼리 통신하는 테스트 모드 (로그인 없이). 개발 서버나 내 컴퓨터(localhost)에서만 켜진다 */
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
