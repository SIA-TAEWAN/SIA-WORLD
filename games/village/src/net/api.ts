import type { SupabaseClient } from '@supabase/supabase-js';
import { CONST, LEVEL_EXP, RES_IDS } from '../data/balance';
import { GOALS } from '../data/goals';
import {
  RuleError, build, claimGoal, cleanState, cloneState, craft, expand, feast, harvest, move, newVillage, place, sell, settle, store as storeRule, upgrade,
  type HarvestResult, type VillageState,
} from '../game/rules';
import { worldSupabase } from './world';

/**
 * 서버 연결. 시아마을은 서버가 진실이다 (PRD 3·13장):
 * 짓기 · 옮기기 · 수확 · 업그레이드 · 목표 보상은 모두 서버 함수(supabase/migrations/047_village.sql)가 서버 시간으로 계산하고,
 * 화면은 돌려받은 상태와 서버 시각(기기 시계와의 차이를 맞춘 now())으로 진행 막대와 쌓인 양을 보여 주기만 한다.
 * 테스트 모드(?local=1, 개발 서버·localhost 전용)는 같은 규칙(game/rules.ts)으로 이 기기에만 저장한다.
 */

const loc = typeof location === 'undefined' ? null : location;
const params = new URLSearchParams(loc?.search ?? '');
export const LOCAL_MODE =
  !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));

/** 서버가 거절했을 때의 까닭 (SQL 의 raise exception 글자 = RuleError 의 글자) */
export class ApiError extends Error {}

export interface VillageApi {
  kind: 'supabase' | 'local';
  /** 지금의 서버 시각 (ms). 마지막 답에 실려 온 서버 시각으로 기기 시계와의 차이를 맞춘 값 */
  now(): number;
  /** 내 마을 (없으면 만든다). 끝난 짓기 · 업그레이드가 마무리된 상태 */
  load(): Promise<VillageState>;
  /** 아래는 모두 새 상태를 돌려준다. 서버가 거절하면 ApiError(까닭), 통신 문제면 Error('network') */
  build(type: string, x: number, y: number): Promise<{ state: VillageState; id: string }>;
  move(id: string, x: number, y: number): Promise<VillageState>;
  harvest(ids: string[]): Promise<{ state: VillageState; harvest: HarvestResult }>;
  upgrade(id: string): Promise<VillageState>;
  claimGoal(): Promise<VillageState>;
  /** 가공 시작 (방앗간 · 장독대): n개 */
  craft(id: string, n: number): Promise<VillageState>;
  /** 장터에서 팔기 → 받은 엽전 */
  sell(res: string, n: number): Promise<{ state: VillageState; sold: number }>;
  /** 보관함에 넣기 · 보관함에서 꺼내 놓기 */
  store(id: string): Promise<VillageState>;
  place(id: string, x: number, y: number): Promise<VillageState>;
  /** 땅 넓히기 (시아코인) · 잔치 열기 (떡) */
  expand(): Promise<VillageState>;
  feast(): Promise<VillageState>;
}

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function browserStore(): Store {
  try {
    localStorage.getItem('siavillage:probe');
    return localStorage;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
}

// ───────────────────────── 테스트 모드 ─────────────────────────

const LOCAL_KEY = 'siavillage:local';

/**
 * 이 기기에만 저장하는 마을. fast: 시간을 그 배수로 빨리 돌린다 (개발용 ?fast=60 → 1초가 1분).
 * 빨리 돌린 시간은 저장해 두므로 새로 고쳐도 뒤로 가지 않는다.
 */
export function createLocalApi(store: Store, realNow: () => number = () => Date.now(), fast = 1): VillageApi {
  interface Saved {
    state: VillageState;
    seq: number;
    /** 마을 시각 − 기기 시각 (빨리 돌린 만큼 앞서 있다) */
    skew: number;
  }
  const read = (): Saved | null => {
    try {
      const d = JSON.parse(store.getItem(LOCAL_KEY) ?? 'null') as Saved | null;
      if (d?.state) return { state: cleanState(d.state), seq: Number(d.seq) || 0, skew: Number(d.skew) || 0 };
    } catch {
      /* 처음 상태 */
    }
    return null;
  };
  const t0 = realNow();
  const skew0 = read()?.skew ?? 0;
  const now = () => {
    const t = realNow();
    return Math.floor(t + skew0 + (t - t0) * (fast - 1));
  };
  const open = (): Saved => read() ?? { state: newVillage(now()), seq: 0, skew: 0 };
  const save = (d: Saved) => {
    d.skew = now() - realNow();
    try {
      store.setItem(LOCAL_KEY, JSON.stringify(d));
    } catch {
      /* 무시 */
    }
  };
  /** 규칙 함수 하나를 돌리고 저장한다 (거절되면 저장하지 않는다) */
  const run = <T>(fn: (s: VillageState, d: Saved) => T): { state: VillageState; out: T } => {
    const d = open();
    let out: T;
    try {
      out = fn(d.state, d);
    } catch (e) {
      if (e instanceof RuleError) throw new ApiError(e.message);
      throw e;
    }
    save(d);
    return { state: cloneState(d.state), out };
  };
  return {
    kind: 'local',
    now,
    async load() {
      return run((s) => settle(s, now())).state;
    },
    async build(type, x, y) {
      const r = run((s, d) => build(s, type, x, y, now(), `local-${++d.seq}`));
      return { state: r.state, id: r.out.id };
    },
    async move(id, x, y) {
      return run((s) => move(s, id, x, y, now())).state;
    },
    async harvest(ids) {
      const r = run((s) => harvest(s, ids, now()));
      return { state: r.state, harvest: r.out };
    },
    async upgrade(id) {
      return run((s) => upgrade(s, id, now())).state;
    },
    async claimGoal() {
      return run((s) => void claimGoal(s, now())).state;
    },
    async craft(id, n) {
      return run((s) => craft(s, id, n, now())).state;
    },
    async sell(res, n) {
      const r = run((s) => sell(s, res, n, now()));
      return { state: r.state, sold: r.out };
    },
    async store(id) {
      return run((s) => storeRule(s, id, now())).state;
    },
    async place(id, x, y) {
      return run((s) => place(s, id, x, y, now())).state;
    },
    async expand() {
      return run((s) => expand(s, now())).state;
    },
    async feast() {
      return run((s) => feast(s, now())).state;
    },
  };
}

// ───────────────────────── 서버 ─────────────────────────

/** 서버 함수 하나를 기다리는 시간 */
export const RPC_TIMEOUT_MS = 12000;

type RpcError = { code?: string; message?: string };
type RpcAnswer = { data: unknown; error: RpcError | null };
/** createSupabaseApi 가 쓰는 만큼의 서버 연결 (시험에서는 가짜를 넣는다) */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcAnswer> & { abortSignal?(signal: AbortSignal): PromiseLike<RpcAnswer> };
}

export function createSupabaseApi(sb: SupabaseClient | RpcClient, timeoutMs = RPC_TIMEOUT_MS, deviceNow: () => number = () => Date.now()): VillageApi {
  /** 서버 시각 − 기기 시각 */
  let offset = 0;
  const call = async (fn: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<RpcAnswer>((resolve) => {
      timer = setTimeout(() => {
        ctrl?.abort();
        resolve({ data: null, error: { message: 'timeout' } });
      }, timeoutMs);
    });
    const sent = deviceNow();
    let ans: RpcAnswer;
    try {
      const q = (sb as RpcClient).rpc(fn, args);
      const asked = ctrl && q.abortSignal ? q.abortSignal(ctrl.signal) : q;
      ans = await Promise.race([Promise.resolve(asked), late]);
    } catch (e) {
      ans = { data: null, error: { message: (e as Error)?.message ?? 'network' } };
    } finally {
      clearTimeout(timer);
    }
    // raise exception → 코드 P0001 (서버가 거절). 그 밖은 통신 문제
    if (ans.error) throw ans.error.code === 'P0001' ? new ApiError(ans.error.message ?? 'error') : new Error('network');
    const d = ans.data as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') throw new Error('network');
    // 서버 시각은 요청을 보낸 때와 답을 받은 때의 한가운데로 본다
    const got = deviceNow();
    if (typeof d.now === 'number') offset = d.now - (sent + got) / 2;
    return d;
  };
  return {
    kind: 'supabase',
    now: () => Math.floor(deviceNow() + offset),
    load: async () => cleanState(await call('village_state')),
    async build(type, x, y) {
      const d = await call('village_build', { p_type: type, p_x: x, p_y: y });
      return { state: cleanState(d), id: String(d.id ?? '') };
    },
    move: async (id, x, y) => cleanState(await call('village_move', { p_id: id, p_x: x, p_y: y })),
    async harvest(ids) {
      const d = await call('village_harvest', { p_ids: ids });
      const h = (d.harvest ?? {}) as Partial<HarvestResult>;
      return { state: cleanState(d), harvest: { per: h.per ?? {}, gained: h.gained ?? {}, exp: Number(h.exp) || 0, lost: Number(h.lost) || 0 } };
    },
    upgrade: async (id) => cleanState(await call('village_upgrade', { p_id: id })),
    claimGoal: async () => cleanState(await call('village_claim_goal')),
    craft: async (id, n) => cleanState(await call('village_craft', { p_id: id, p_n: n })),
    async sell(res, n) {
      const d = await call('village_sell', { p_res: res, p_n: n });
      return { state: cleanState(d), sold: Number(d.sold) || 0 };
    },
    store: async (id) => cleanState(await call('village_store', { p_id: id })),
    place: async (id, x, y) => cleanState(await call('village_place', { p_id: id, p_x: x, p_y: y })),
    expand: async () => cleanState(await call('village_expand')),
    feast: async () => cleanState(await call('village_feast')),
  };
}

let api: VillageApi | null = null;
export async function getApi(): Promise<VillageApi> {
  if (api) return api;
  if (LOCAL_MODE) {
    const store = browserStore();
    seedLocal(store);
    const fast = Math.max(1, Math.min(100000, Number(params.get('fast')) || 1));
    return (api = createLocalApi(store, undefined, fast));
  }
  return (api = createSupabaseApi(await worldSupabase()));
}

/**
 * 테스트 모드의 마을을 주소로 정한다 (헤드리스 확인용):
 *   ?fresh=1 처음 상태로 · ?rice=500&wood=500&stone=&cake=&coin=&special= 자원 · ?sia=100 시아코인 · ?lv=5 마을 레벨 · ?goal=7 목표 번호 · ?fast=60 시간을 60배로
 */
function seedLocal(store: Store) {
  if (params.get('fresh') === '1') store.removeItem(LOCAL_KEY);
  const keys = [...RES_IDS, 'lv', 'goal', 'sia', 'land'].filter((k) => params.get(k) !== null);
  if (keys.length === 0) return;
  let d: { state?: unknown; seq?: number; skew?: number } = {};
  try {
    d = JSON.parse(store.getItem(LOCAL_KEY) ?? '{}') ?? {};
  } catch {
    /* 처음 상태 */
  }
  const s = d.state ? cleanState(d.state) : newVillage(Date.now() + (Number(d.skew) || 0));
  const num = (k: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(params.get(k)) || 0)));
  for (const k of RES_IDS) if (params.get(k) !== null) s.profile.resources[k] = num(k, 1e9);
  if (params.get('lv') !== null) {
    s.profile.level = Math.max(1, num('lv', CONST.max_level));
    s.profile.exp = Math.min(s.profile.exp, (LEVEL_EXP[s.profile.level - 1] ?? 1) - 1);
  }
  if (params.get('sia') !== null) s.sia = num('sia', 1e9);
  if (params.get('land') !== null) s.profile.landStage = num('land', 6);
  if (params.get('goal') !== null) {
    s.profile.goal = num('goal', GOALS.length);
    s.profile.goalProgress = 0;
  }
  store.setItem(LOCAL_KEY, JSON.stringify({ ...d, state: s }));
}
