import type { SupabaseClient } from '@supabase/supabase-js';
import { ZODIAC_IDS, type ZodiacId } from '../data/balance';
import { CHARACTERS } from '../data/characters';
import { MAPS, MAP_INDEX } from '../data/maps';
import { UPGRADE_TOTAL } from '../data/upgrades';
import {
  applyRun, buyUpgrade, cleanProfile, defaultProfile, rejectReason, resetUpgrades, unlockCharacter,
  type FinishResult, type RunReport, type SurvivalProfile, type SurvivalRecord,
} from '../game/progress';
import { LocalChannel, SupaChannel, type Channel } from './channel';
import { dropPending, flushPending, keepPending, type SendOutcome, type Store } from './pending';
import { worldSupabase } from './world';

/**
 * 서버 연결. 시아서바이벌은 1인 전용이라 게임 중에는 서버와 통신하지 않는다 (PRD 1장).
 *   · 메인에 들어올 때 프로필(엽전·강화·해금·도감)을 읽고
 *   · 출전할 때 start, 판이 끝나면 finish 한 번
 *   · finish 가 통신 문제로 실패하면 기기에 임시 보관했다가 다음 접속 때 다시 보낸다 (net/pending.ts)
 * 엽전·강화·해금·기록은 모두 서버 함수가 정한다 (supabase/migrations/038_survival.sql).
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
  /** 판 시작: 판 id. 못 받으면 null (그 판은 기록되지 않는다). skipSec: 테스트 모드에서 시작 시각을 건너뛴 판(?t=420)의 시작을 그만큼 앞당긴다 */
  start(map: string, character: ZodiacId, skipSec?: number): Promise<string | null>;
  /** 판 끝: 새 프로필과 결과. 통신 실패면 임시 보관하고 null, 서버가 거절했으면 ApiError */
  finish(report: RunReport): Promise<{ profile: SurvivalProfile; result: FinishResult } | null>;
  /** 임시 보관해 둔 결과를 다시 보낸다 → 올라간 판 수 */
  resend(): Promise<number>;
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
    seq: number;
  }
  const read = (): Saved => {
    try {
      const d = JSON.parse(store.getItem(LOCAL_KEY) ?? 'null') as Saved | null;
      if (d) return { profile: cleanProfile(d.profile), records: d.records ?? {}, runs: d.runs ?? {}, seq: Number(d.seq) || 0 };
    } catch {
      /* 처음 상태 */
    }
    return { profile: defaultProfile(), records: {}, runs: {}, seq: 0 };
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
      // 한 사람은 진행 중인 판 하나
      const id = `local-${++d.seq}`;
      d.runs = { [id]: now() - skipSec * 1000 };
      write(d);
      return id;
    },
    async finish(report) {
      const d = read();
      const started = d.runs[report.run];
      if (started === undefined) throw new ApiError('no run');
      const why = rejectReason(report, (now() - started) / 1000);
      if (why) throw new ApiError(why);
      delete d.runs[report.run];
      const out = applyRun(d.profile, d.records, report, now());
      d.profile = out.profile;
      d.records = out.records;
      write(d);
      return { profile: out.profile, result: out.result };
    },
    async resend() {
      return 0;
    },
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
const rejected = (error: { code?: string; message?: string } | null) => !!error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) && !error.code.startsWith('08');

export function createSupabaseApi(sb: SupabaseClient, uid: string, store: Store): SurvivalApi {
  const profileRpc = async (fn: string, args?: Record<string, unknown>): Promise<SurvivalProfile> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw rejected(error) ? new ApiError(error.message ?? 'error') : new Error('network');
    return cleanProfile(data);
  };
  const send = async (r: RunReport): Promise<{ outcome: SendOutcome; data?: { profile: SurvivalProfile; result: FinishResult }; why?: string }> => {
    try {
      const { data, error } = await sb.rpc('survival_finish', {
        p_run: r.run, p_time: r.time, p_kills: r.kills, p_level: r.level, p_coins: r.coins, p_cleared: r.cleared,
        p_boss_kills: r.bossKills, p_cakes: r.cakes, p_codex: r.codex,
      });
      if (error) return rejected(error) ? { outcome: 'rejected', why: error.message } : { outcome: 'failed' };
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
  return {
    kind: 'supabase',
    channel: <M>(name: string, key: string) => new SupaChannel<M>(sb, name, key),
    async now() {
      const t0 = Date.now();
      const { data, error } = await sb.rpc('survival_now');
      const t1 = Date.now();
      return error || typeof data !== 'number' ? t1 : data + (t1 - t0) / 2;
    },
    loadProfile: () => profileRpc('survival_profile'),
    async start(map, character) {
      const { data, error } = await sb.rpc('survival_start', { p_map: map, p_character: character });
      if (error && rejected(error)) throw new ApiError(error.message ?? 'error');
      if (error || typeof data !== 'string') {
        console.warn('[시아서바이벌] 판 시작을 서버에 알리지 못했어요 (이 판은 기록되지 않아요)', error?.message);
        return null;
      }
      return data;
    },
    async finish(report) {
      const out = await send(report);
      if (out.outcome === 'ok') {
        dropPending(store, uid, report.run);
        return out.data!;
      }
      if (out.outcome === 'rejected') {
        dropPending(store, uid, report.run);
        throw new ApiError(out.why ?? 'error');
      }
      // 통신 실패: 기기에 보관해 두고 다음 접속 때 다시 보낸다
      keepPending(store, uid, report);
      return null;
    },
    resend: () => flushPending(store, uid, async (r) => (await send(r)).outcome),
    buyUpgrade: (key) => profileRpc('survival_buy_upgrade', { p_key: key }),
    resetUpgrades: () => profileRpc('survival_reset_upgrades'),
    unlockCharacter: (id) => profileRpc('survival_unlock_character', { p_character: id }),
  };
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
 *   ?local=1&map=field&char=tiger&upg=10&t=420   → 강화 10레벨 상태로 7분 시점부터 바로 시작
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
