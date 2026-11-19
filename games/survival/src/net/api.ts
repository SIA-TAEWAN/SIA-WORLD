import type { SupabaseClient } from '@supabase/supabase-js';
import { ZODIAC_IDS, type ZodiacId } from '../data/balance';
import { CHARACTERS } from '../data/characters';
import { MAPS, MAP_INDEX } from '../data/maps';
import { UPGRADE_TOTAL } from '../data/upgrades';
import {
  LIMITS, applyRun, buyUpgrade, cleanProfile, defaultProfile, minRealTime, rejectReason, resetUpgrades, unlockCharacter,
  type FinishResult, type RunReport, type SurvivalProfile, type SurvivalRecord,
} from '../game/progress';
import { LocalChannel, SupaChannel, type Channel } from './channel';
import { dropPending, flushPending, keepPending, type SendOutcome, type Store } from './pending';
import { worldSupabase } from './world';

/**
 * 서버 연결. 시아서바이벌은 1인 전용이라 게임 중에는 서버와 통신하지 않는다 (PRD 1장).
 *   · 메인에 들어올 때 프로필(엽전·강화·해금·도감)을 읽고
 *   · 출전할 때 start, 판이 끝나면 finish 한 번
 *   · finish 는 보내기 전에 결과를 기기에 보관하고, 서버가 받았거나 거절하면 지운다. 통신 문제(12초 안에 답 없음 포함)면
 *     남겨 두었다가 다음 판을 시작할 때·다음 저장이 성공했을 때·다음 접속 때 다시 보낸다 (net/pending.ts)
 *   · 판 도중에 창이 닫히면(새로고침·탭 닫기·로그아웃) 그때까지의 결과를 보관해 둔다 (stash)
 * 엽전·강화·해금·기록은 모두 서버 함수가 정한다 (supabase/migrations/038_survival.sql, 039_survival_hardening.sql, 040_survival_5min.sql, 041_survival_3min.sql, 042_survival_speed.sql, 043_survival_4min.sql).
 */

/** 주소 (화면 없이 시험할 때는 없다) */
const loc = typeof location === 'undefined' ? null : location;
const params = new URLSearchParams(loc?.search ?? '');
/** 주소의 ?local=1 이면 로그인 없이 해 보는 테스트 모드 (프로필은 이 기기에만 저장). 개발 서버나 내 컴퓨터(localhost)에서만 켜진다 */
export const LOCAL_MODE =
  !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));

export type { FinishResult, RunReport, SurvivalProfile } from '../game/progress';

/** 서버가 거절했을 때의 까닭 (SQL의 raise exception 글자) */
export class ApiError extends Error {}

export interface SurvivalApi {
  kind: 'supabase' | 'local';
  /** 실시간 채널 (접속 인원) */
  channel<M>(name: string, key: string): Channel<M>;
  /** 서버 시각 (ms) */
  now(): Promise<number>;
  loadProfile(): Promise<SurvivalProfile>;
  /** 판 시작: 판 id. 못 받으면 null (그 판은 기록되지 않는다). skipSec: 테스트 모드에서 시작 시각을 건너뛴 판(?t=120)의 시작을 그만큼 앞당긴다 */
  start(map: string, character: ZodiacId, skipSec?: number): Promise<string | null>;
  /** 판 끝: 새 프로필과 결과. 통신 실패면 임시 보관하고 null, 서버가 거절했으면 ApiError */
  finish(report: RunReport): Promise<{ profile: SurvivalProfile; result: FinishResult } | null>;
  /** 임시 보관해 둔 결과를 다시 보낸다 → 올라간 판 수 (이미 보내는 중이면 그 일이 끝나기를 기다린다) */
  resend(): Promise<number>;
  /** 판 도중에 창이 닫힐 때: 그때까지의 결과를 보내지 않고 보관만 한다 (다음 접속 때 올라간다. 판이 이어져 끝나면 finish 가 덮어쓴다) */
  stash(report: RunReport): void;
  /** 다시 보내기(resend)로 새 프로필을 받았을 때 부른다 (화면의 엽전·해금 갱신용) */
  onProfile: ((p: SurvivalProfile) => void) | null;
  /** 아래 셋은 새 프로필을 돌려준다. 안 되면 ApiError(까닭) */
  buyUpgrade(key: string): Promise<SurvivalProfile>;
  resetUpgrades(): Promise<SurvivalProfile>;
  unlockCharacter(id: ZodiacId): Promise<SurvivalProfile>;
}

function browserStore(): Store {
  try {
    localStorage.getItem('siasurvival:probe');
    return localStorage;
  } catch {
    // 저장소를 쓸 수 없는 브라우저: 이번 접속 동안만 기억한다
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
}

// ───────────────────────── 테스트 모드: 이 기기에만 저장하는 프로필 (서버와 같은 규칙, game/progress.ts) ─────────────────────────

const LOCAL_KEY = 'siasurvival:local';

export function createLocalApi(store: Store, now: () => number = () => Date.now()): SurvivalApi {
  interface Saved {
    profile: SurvivalProfile;
    records: Record<string, SurvivalRecord>;
    /** 진행 중인 판: id → 시작 시각 */
    runs: Record<string, number>;
    /** 끝난 판: id → 시작 시각과 생존 시간 (겹치는 판 확인용. 서버처럼 30일 뒤에 지운다) */
    done: Record<string, { started: number; time: number }>;
    seq: number;
  }
  const read = (): Saved => {
    try {
      const d = JSON.parse(store.getItem(LOCAL_KEY) ?? 'null') as Saved | null;
      if (d) return { profile: cleanProfile(d.profile), records: d.records ?? {}, runs: d.runs ?? {}, done: d.done ?? {}, seq: Number(d.seq) || 0 };
    } catch {
      /* 처음 상태 */
    }
    return { profile: defaultProfile(), records: {}, runs: {}, done: {}, seq: 0 };
  };
  const write = (d: Saved) => {
    try {
      store.setItem(LOCAL_KEY, JSON.stringify(d));
    } catch {
      /* 무시 */
    }
  };
  const change = (fn: (p: SurvivalProfile) => SurvivalProfile): SurvivalProfile => {
    const d = read();
    try {
      d.profile = fn(d.profile);
    } catch (e) {
      throw new ApiError((e as Error).message);
    }
    write(d);
    return d.profile;
  };
  return {
    kind: 'local',
    channel: <M>(name: string, key: string) => new LocalChannel<M>(name, key),
    async now() {
      return now();
    },
    async loadProfile() {
      return read().profile;
    },
    async start(map, character, skipSec = 0) {
      const d = read();
      if (!d.profile.unlockedMaps.includes(map)) throw new ApiError('map locked');
      if (!d.profile.unlockedCharacters.includes(character)) throw new ApiError('character locked');
      // 서버(039)와 같다: 끝나지 않은 이전 판을 지우지 않는다 (겹치는 판은 finish 가 막는다).
      // 너무 오래됐거나(7일) 많이 쌓인 것(새 판까지 5개)만 치우고, 끝난 판은 30일 뒤에 지운다
      const t = now();
      const seqOf = (k: string) => Number(k.slice(6)) || 0;
      const open = Object.entries(d.runs)
        .filter(([, at]) => at >= t - LIMITS.max_age * 1000)
        .sort((a, b) => b[1] - a[1] || seqOf(b[0]) - seqOf(a[0]))
        .slice(0, LIMITS.open_runs - 1);
      const id = `local-${++d.seq}`;
      d.runs = { ...Object.fromEntries(open), [id]: t - skipSec * 1000 };
      for (const k of Object.keys(d.done)) if (d.done[k].started < t - 30 * 86400_000) delete d.done[k];
      write(d);
      return id;
    },
    async finish(report) {
      const d = read();
      if (d.done[report.run]) throw new ApiError('already finished');
      const started = d.runs[report.run];
      if (started === undefined) throw new ApiError('no run');
      const why = rejectReason(report, (now() - started) / 1000);
      if (why) throw new ApiError(why);
      // 한 번에 한 판: 이미 끝낸 다른 판과 플레이 시간이 겹치면 받지 않는다 (판 하나가 쓴 시간은 가장 빠른 배속 기준)
      const span = (time: number) => minRealTime(time) * 1000;
      for (const o of Object.values(d.done)) {
        if (o.started < started + span(report.time) && o.started + span(o.time) > started) throw new ApiError('overlap');
      }
      delete d.runs[report.run];
      d.done[report.run] = { started, time: report.time };
      const out = applyRun(d.profile, d.records, report, now());
      d.profile = out.profile;
      d.records = out.records;
      write(d);
      return { profile: out.profile, result: out.result };
    },
    async resend() {
      return 0;
    },
    // 테스트 모드는 결과를 기기에 바로 적으므로 보관할 것이 없다
    stash() {},
    onProfile: null,
    async buyUpgrade(key) {
      return change((p) => buyUpgrade(p, key));
    },
    async resetUpgrades() {
      return change(resetUpgrades);
    },
    async unlockCharacter(id) {
      return change((p) => unlockCharacter(p, id));
    },
  };
}

// ───────────────────────── 서버 ─────────────────────────

/** 서버 함수가 낸 오류인가 (raise exception → 코드 P0001). 그 밖(연결 끊김·시간 초과)은 통신 실패로 본다 */
const rejected = (error: { code?: string; message?: string } | null) => !!error && error.code === 'P0001';

/** 서버 함수 하나를 기다리는 시간. 넘으면 통신 실패로 본다 (끝 저장은 보관해 두고 나중에 다시 보낸다) */
export const RPC_TIMEOUT_MS = 12000;

type RpcError = { code?: string; message?: string };
type RpcAnswer = { data: unknown; error: RpcError | null };
/** createSupabaseApi 가 쓰는 만큼의 서버 연결 (시험에서는 가짜를 넣는다) */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcAnswer> & { abortSignal?(signal: AbortSignal): PromiseLike<RpcAnswer> };
}

export function createSupabaseApi(sb: SupabaseClient | RpcClient, uid: string, store: Store, timeoutMs = RPC_TIMEOUT_MS): SurvivalApi {
  /** 서버 함수를 부른다. ms 안에 답이 없으면 요청을 끊고 통신 실패(error.code 없음)로 돌려준다. 던지지 않는다 */
  const call = async (fn: string, args?: Record<string, unknown>, ms = timeoutMs): Promise<RpcAnswer> => {
    const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<RpcAnswer>((resolve) => {
      timer = setTimeout(() => {
        ctrl?.abort();
        resolve({ data: null, error: { message: 'timeout' } });
      }, ms);
    });
    try {
      const q = (sb as RpcClient).rpc(fn, args);
      const asked = ctrl && q.abortSignal ? q.abortSignal(ctrl.signal) : q;
      return await Promise.race([Promise.resolve(asked), late]);
    } catch (e) {
      return { data: null, error: { message: (e as Error)?.message ?? 'network' } };
    } finally {
      clearTimeout(timer);
    }
  };
  const profileRpc = async (fn: string, args?: Record<string, unknown>): Promise<SurvivalProfile> => {
    const { data, error } = await call(fn, args);
    if (error) throw rejected(error) ? new ApiError(error.message ?? 'error') : new Error('network');
    return cleanProfile(data);
  };
  /** 지금 보내는 중인 판 (다시 보내기가 같은 판을 또 보내지 않게) */
  const sending = new Set<string>();
  let flushing: Promise<number> | null = null;
  const send = async (r: RunReport): Promise<{ outcome: SendOutcome; data?: { profile: SurvivalProfile; result: FinishResult }; why?: string }> => {
    try {
      const { data, error } = await call('survival_finish', {
        p_run: r.run, p_time: r.time, p_kills: r.kills, p_level: r.level, p_coins: r.coins, p_cleared: r.cleared,
        p_boss_kills: r.bossKills, p_cakes: r.cakes, p_codex: r.codex,
      });
      // 'too early': 판 시작 알림이 늦게 닿았을 때. 조금 뒤에 다시 보내면 통과하므로 버리지 않는다
      if (error) return rejected(error) && !/too early/.test(error.message ?? '') ? { outcome: 'rejected', why: error.message } : { outcome: 'failed' };
      const d = data as { profile?: unknown; result?: Partial<FinishResult> } | null;
      if (!d?.result) return { outcome: 'failed' };
      const res = d.result;
      return {
        outcome: 'ok',
        data: {
          profile: cleanProfile(d.profile),
          result: {
            coins: Number(res.coins) || 0,
            valid: res.valid !== false,
            newRecord: res.newRecord === true,
            unlockedCharacters: (Array.isArray(res.unlockedCharacters) ? res.unlockedCharacters : []).filter((c) => ZODIAC_IDS.includes(c)),
            unlockedMaps: (Array.isArray(res.unlockedMaps) ? res.unlockedMaps : []).filter((m) => MAP_INDEX[m] !== undefined),
          },
        },
      };
    } catch {
      return { outcome: 'failed' };
    }
  };
  const self: SurvivalApi = {
    kind: 'supabase',
    channel: <M>(name: string, key: string) => new SupaChannel<M>(sb as SupabaseClient, name, key),
    async now() {
      const t0 = Date.now();
      const { data, error } = await call('survival_now');
      const t1 = Date.now();
      return error || typeof data !== 'number' ? t1 : data + (t1 - t0) / 2;
    },
    loadProfile: () => profileRpc('survival_profile'),
    async start(map, character) {
      // 통신 문제면 한 번 더 해 본다. 두 번을 합쳐 timeoutMs(12초) 안에 답이 없으면 이 판은 기록되지 않는다
      let why: string | undefined;
      for (let i = 0; i < 2; i++) {
        const { data, error } = await call('survival_start', { p_map: map, p_character: character }, timeoutMs / 2);
        if (error && rejected(error)) throw new ApiError(error.message ?? 'error');
        if (!error && typeof data === 'string') return data;
        why = error?.message;
      }
      console.warn('[시아서바이벌] 판 시작을 서버에 알리지 못했어요 (이 판은 기록되지 않아요)', why);
      return null;
    },
    async finish(report) {
      // 먼저 보관하고 보낸다: 보내는 도중에 창이 닫히거나 답이 오지 않아도 결과가 남는다
      keepPending(store, uid, report);
      sending.add(report.run);
      let out: Awaited<ReturnType<typeof send>>;
      try {
        out = await send(report);
      } finally {
        sending.delete(report.run);
      }
      if (out.outcome === 'ok') {
        dropPending(store, uid, report.run);
        // 통신이 되는 김에 앞서 못 올린 판도 올린다 (기다리지 않는다)
        void self.resend().catch(() => 0);
        return out.data!;
      }
      if (out.outcome === 'rejected') {
        dropPending(store, uid, report.run);
        throw new ApiError(out.why ?? 'error');
      }
      // 통신 실패: 보관해 둔 것을 다음에 다시 보낸다
      return null;
    },
    resend() {
      flushing ??= flushPending(
        store,
        uid,
        async (r) => {
          const out = await send(r);
          if (out.outcome === 'ok') self.onProfile?.(out.data!.profile);
          return out.outcome;
        },
        (run) => sending.has(run),
      ).finally(() => (flushing = null));
      return flushing;
    },
    stash(report) {
      if (!sending.has(report.run)) keepPending(store, uid, report);
    },
    onProfile: null,
    buyUpgrade: (key) => profileRpc('survival_buy_upgrade', { p_key: key }),
    resetUpgrades: () => profileRpc('survival_reset_upgrades'),
    unlockCharacter: (id) => profileRpc('survival_unlock_character', { p_character: id }),
  };
  return self;
}

let api: SurvivalApi | null = null;
export async function getApi(uid: string): Promise<SurvivalApi> {
  if (api) return api;
  const store = browserStore();
  if (LOCAL_MODE) {
    api = createLocalApi(store);
    seedLocal(store);
    return api;
  }
  return (api = createSupabaseApi(await worldSupabase(), uid, store));
}

/**
 * 테스트 모드의 프로필을 주소로 정한다 (헤드리스 확인용):
 *   ?fresh=1 처음 상태로 · ?coins=5000 엽전 · ?unlock=1 캐릭터·맵 모두 해금
 */
function seedLocal(store: Store) {
  if (params.get('fresh') === '1') store.removeItem(LOCAL_KEY);
  const coins = params.get('coins');
  const all = params.get('unlock') === '1';
  if (coins === null && !all) return;
  let d: { profile?: unknown } = {};
  try {
    d = JSON.parse(store.getItem(LOCAL_KEY) ?? '{}') ?? {};
  } catch {
    /* 처음 상태 */
  }
  const p = cleanProfile(d.profile);
  if (coins !== null) p.coins = Math.max(0, Math.floor(Number(coins)) || 0);
  if (all) {
    p.unlockedCharacters = CHARACTERS.map((c) => c.id);
    p.unlockedMaps = MAPS.map((m) => m.id);
  }
  store.setItem(LOCAL_KEY, JSON.stringify({ ...d, profile: p }));
}

/**
 * 개발용 테스트 설정 (PRD 7장). 개발 서버·localhost 의 ?local=1 에서만 읽는다.
 *   ?local=1&map=field&char=tiger&upg=10&t=120   → 강화 10레벨 상태로 2분 시점부터 바로 시작
 *   seed=숫자: 같은 판 다시 보기
 */
export interface DevSetup {
  map: string | null;
  char: ZodiacId | null;
  /** 강화를 몇 레벨 찍은 상태인가 (0~49). 적지 않았으면 null (저장된 강화를 쓴다) */
  upg: number | null;
  /** 시작 시각 (초) */
  t: number;
  seed: number | null;
  /** map 과 char 를 모두 적었으면 메뉴를 건너뛰고 바로 판을 시작한다 */
  auto: boolean;
}

export function devSetup(): DevSetup | null {
  if (!LOCAL_MODE) return null;
  const map = params.get('map');
  const char = params.get('char') as ZodiacId | null;
  const okMap = map !== null && MAP_INDEX[map] !== undefined ? map : null;
  const okChar = char !== null && ZODIAC_IDS.includes(char) ? char : null;
  const num = (k: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(params.get(k)) || 0)));
  const seed = params.get('seed');
  return {
    map: okMap,
    char: okChar,
    upg: params.get('upg') === null ? null : num('upg', UPGRADE_TOTAL),
    t: num('t', 660),
    seed: seed !== null && Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : null,
    auto: okMap !== null && okChar !== null,
  };
}
