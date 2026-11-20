import type { SupabaseClient } from '@supabase/supabase-js';
import { STAT_IDS, noStats, type GameStats, type StatId } from '../data/monuments';
import { CONST, LEVEL_EXP, RES_IDS } from '../data/balance';
import { isBuildingType, type BuildingType } from '../data/buildings';
import { isResidentId, type ResidentId } from '../data/residents';
import { GOALS } from '../data/goals';
import {
  RuleError, assign, build, claimGoal, cleanState, cloneState, craft, dailyClaim, expand, feast, harvest, move, newVillage, place, praiseGive, praiseLeft, prosperityOf, refresh, rename,
  adminBoost, adminSetState, grantMonuments, requestDone, requestSkip, sell, settle, store as storeRule, upgrade,
  type HarvestResult, type VillageState,
} from '../game/rules';
import { makeShowcase } from '../data/showcase';
import { worldSupabase } from './world';

/**
 * 서버 연결. 시아마을은 서버가 진실이다 (PRD 3·13장):
 * 짓기 · 옮기기 · 수확 · 업그레이드 · 판매 · 부탁 · 시아코인 쓰기 등 자원이 바뀌는 동작은 모두 서버 함수(supabase/migrations/047 · 049 · 050 · 051)가 서버 시간으로 계산하고,
 * 화면은 돌려받은 상태와 서버 시각(기기 시계와의 차이를 맞춘 now())으로 진행 막대와 쌓인 양을 보여 주기만 한다.
 * 테스트 모드(?local=1, 개발 서버·localhost 전용)는 같은 규칙(game/rules.ts)으로 이 기기에만 저장한다.
 */

const loc = typeof location === 'undefined' ? null : location;
const params = new URLSearchParams(loc?.search ?? '');
export const LOCAL_MODE =
  !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));

/** 서버가 거절했을 때의 까닭 (SQL 의 raise exception 글자 = RuleError 의 글자) */
export class ApiError extends Error {}

/** 랭킹의 한 줄 */
export interface RankRow {
  userId: string;
  nickname: string;
  /** 마을 이름 (비어 있으면 화면이 '닉네임네 마을'로 보여 준다) */
  name: string;
  level: number;
  prosperity: number;
  place: number;
}
export interface Ranking {
  /** 상위 100곳 */
  rows: RankRow[];
  /** 내 줄 (100위 밖이어도) */
  mine: RankRow | null;
  total: number;
  /** 관리자 계정의 마을 (랭킹에는 나오지 않고 따로 구경만 간다. place 는 0) */
  admins: RankRow[];
}
/** 구경하는 마을 (읽기 전용: 자원 · 시아코인 · 부탁은 오지 않는다) */
export interface Visit {
  userId: string;
  nickname: string;
  name: string;
  level: number;
  prosperity: number;
  landStage: number;
  mine: boolean;
  /** 오늘 내가 이 마을을 칭찬했나 · 오늘 더 칭찬할 수 있는 횟수 */
  praised: boolean;
  praiseLeft: number;
  buildings: { id: string; type: BuildingType; level: number; x: number; y: number; state: 'building' | 'done' }[];
  residents: { id: ResidentId; affinity: number; building: string | null }[];
}

const num0 = (v: unknown) => Math.max(0, Math.floor(Number(v)) || 0);
export function cleanVisit(raw: unknown): Visit {
  const r = (raw ?? {}) as Record<string, unknown>;
  const buildings: Visit['buildings'] = [];
  for (const v of Array.isArray(r.buildings) ? r.buildings : []) {
    const b = (v ?? {}) as Record<string, unknown>;
    if (!isBuildingType(b.type) || typeof b.id !== 'string') continue;
    buildings.push({ id: b.id, type: b.type, level: Math.max(1, Math.min(CONST.building_max_level, num0(b.level))), x: Math.min(19, num0(b.x)), y: Math.min(19, num0(b.y)), state: b.state === 'building' ? 'building' : 'done' });
  }
  const residents: Visit['residents'] = [];
  for (const v of Array.isArray(r.residents) ? r.residents : []) {
    const x = (v ?? {}) as Record<string, unknown>;
    if (isResidentId(x.id)) residents.push({ id: x.id, affinity: num0(x.affinity), building: typeof x.building === 'string' ? x.building : null });
  }
  return {
    userId: String(r.userId ?? ''), nickname: String(r.nickname ?? ''), name: typeof r.name === 'string' ? r.name : '', level: Math.max(1, Math.min(CONST.max_level, num0(r.level))),
    prosperity: num0(r.prosperity), landStage: Math.min(6, num0(r.landStage)), mine: r.mine === true, praised: r.praised === true, praiseLeft: num0(r.praiseLeft), buildings, residents,
  };
}

export interface VillageApi {
  kind: 'supabase' | 'local';
  /** 지금의 서버 시각 (ms). 마지막 답에 실려 온 서버 시각으로 기기 시계와의 차이를 맞춘 값 */
  now(): number;
  /**
   * 내 마을 (없으면 만든다). 끝난 짓기 · 업그레이드가 마무리된 상태.
   * entry: 게임에 처음 들어올 때만 true (관리자 계정의 엽전 · 시아코인 10,000 맞추기는 그때 한 번만). 1분마다 · 돌아올 때 · 다시 읽을 때는 false
   */
  load(entry?: boolean): Promise<VillageState>;
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
  /** 주민 배치 (building 이 null 이면 쉬게 한다) */
  assign(resident: string, building: string | null): Promise<VillageState>;
  /** 부탁 들어주기 → gift: 친밀도 선물로 받은 장식물의 id (없으면 null) · 넘기기 */
  requestDone(slot: number): Promise<{ state: VillageState; gift: string | null }>;
  requestSkip(slot: number): Promise<VillageState>;
  /** 오늘의 할 일 보상 (slot 0 … 2, 3 = 다 끝낸 추가 보상) */
  dailyClaim(slot: number): Promise<VillageState>;
  /** 번영도 랭킹 (상위 100곳 + 내 줄) */
  ranking(): Promise<Ranking>;
  /** 다른 마을 구경 (읽기 전용) */
  visit(userId: string): Promise<Visit>;
  /** 칭찬하기 → 내 새 상태와 그 마을의 새 모습 */
  praise(userId: string): Promise<{ state: VillageState; visit: Visit }>;
  /** 마을 이름 바꾸기 */
  rename(name: string): Promise<VillageState>;
  /** [기념물] 화면: 조건을 다시 보고, 다른 게임의 기록(stats)과 함께 돌려준다 */
  monuments(): Promise<{ state: VillageState; stats: GameStats }>;
  /** 관리자만: 내 마을을 주어진 모양(전시 마을, data/showcase.ts 의 makeShowcase)으로 바꾼다. 관리자가 아니면 ApiError('not admin') */
  adminSetState(state: VillageState): Promise<VillageState>;
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
 * admin: 관리자 계정처럼 (개발용 ?admin=1. 서버의 profiles.is_admin)
 */
export function createLocalApi(store: Store, realNow: () => number = () => Date.now(), fast = 1, me = { id: 'local', name: '시아' }, stats: GameStats = noStats(), admin = false): VillageApi {
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
  const open = (): Saved => {
    const d = read() ?? { state: newVillage(now()), seq: 0, skew: 0 };
    d.state.admin = admin;
    return d;
  };
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
    // 서버처럼 답을 내기 직전에 번영도를 다시 센다
    refresh(d.state, now());
    save(d);
    return { state: cloneState(d.state), out };
  };
  /** 구경 · 랭킹을 해 볼 수 있게 이웃 마을 셋을 지어 둔다 (이 기기의 기억에만 있다) */
  const bots = makeBots();
  const visitOf = (id: string): Visit => {
    const s = id === me.id ? open().state : bots.find((b) => b.id === id)?.state;
    const bot = bots.find((b) => b.id === id);
    if (!s) throw new ApiError('no village');
    const mine = open().state;
    return {
      userId: id, nickname: bot?.nick ?? me.name, name: s.profile.name, level: s.profile.level, prosperity: prosperityOf(s), landStage: s.profile.landStage, mine: id === me.id,
      praised: mine.profile.praisedDay === kstDayOf(now()) && mine.profile.praised.includes(id), praiseLeft: Math.max(0, praiseLeft(mine, now())),
      buildings: s.buildings.filter((b) => b.state !== 'stored').map((b) => ({ id: b.id, type: b.type, level: b.level, x: b.x, y: b.y, state: b.state === 'building' ? 'building' : 'done' })),
      residents: s.residents.map((r) => ({ id: r.id, affinity: r.affinity, building: r.building })),
    };
  };
  return {
    kind: 'local',
    now,
    async load() {
      return run((s, d) => {
        settle(s, now());
        // 관리자: 마을 레벨 최고 · 땅 끝까지 (서버의 village_state 와 같이, 바뀌었으면 한 번 더 마무리)
        if (adminBoost(s)) settle(s, now());
        grantMonuments(s, stats, now(), () => `local-${++d.seq}`);
      }).state;
    },
    async adminSetState(input) {
      return run((s, d) => adminSetState(s, input, now(), () => `local-${++d.seq}`)).state;
    },
    async monuments() {
      const r = run((s, d) => {
        settle(s, now());
        grantMonuments(s, stats, now(), () => `local-${++d.seq}`);
      });
      return { state: r.state, stats: { ...stats } };
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
    async assign(resident, building) {
      return run((s) => assign(s, resident, building, now())).state;
    },
    async requestDone(slot) {
      const r = run((s, d) => requestDone(s, slot, now(), `local-${++d.seq}`));
      return { state: r.state, gift: r.out?.id ?? null };
    },
    async requestSkip(slot) {
      return run((s) => requestSkip(s, slot, now())).state;
    },
    async dailyClaim(slot) {
      return run((s) => dailyClaim(s, slot, now())).state;
    },
    async ranking() {
      const mine = run((s) => settle(s, now())).state;
      // 관리자 계정은 랭킹에 나오지 않는다 (서버의 village_ranking 뷰와 같이)
      const all = [...(mine.admin ? [] : [{ id: me.id, nick: me.name, state: mine }]), ...bots]
        .map((v) => ({ userId: v.id, nickname: v.nick, name: v.state.profile.name, level: v.state.profile.level, prosperity: prosperityOf(v.state), at: v.state.profile.prosperityAt }))
        .sort((a, b) => b.prosperity - a.prosperity || a.at - b.at)
        .map(({ at: _at, ...r }, i) => ({ ...r, place: i + 1 }));
      const admins = mine.admin ? [{ userId: me.id, nickname: me.name, name: mine.profile.name, level: mine.profile.level, prosperity: prosperityOf(mine), place: 0 }] : [];
      return { rows: all, mine: all.find((r) => r.userId === me.id) ?? null, total: all.length, admins };
    },
    async visit(id) {
      return visitOf(id);
    },
    async praise(id) {
      if (id !== me.id && !bots.some((b) => b.id === id)) throw new ApiError('no village');
      const r = run((s) => praiseGive(s, me.id, id, now()));
      const bot = bots.find((b) => b.id === id)!;
      bot.state.profile.praiseCount++;
      return { state: r.state, visit: visitOf(id) };
    },
    async rename(name) {
      return run((s) => rename(s, name, now())).state;
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

export function createSupabaseApi(sb: SupabaseClient | RpcClient, timeoutMs = RPC_TIMEOUT_MS, deviceNow: () => number = () => Date.now(), uid = ''): VillageApi {
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
    load: async (entry = false) => cleanState(await call('village_state', { p_entry: entry })),
    async build(type, x, y) {
      const d = await call('village_build', { p_type: type, p_x: x, p_y: y });
      return { state: cleanState(d), id: String(d.id ?? '') };
    },
    move: async (id, x, y) => cleanState(await call('village_move', { p_id: id, p_x: x, p_y: y })),
    async harvest(ids) {
      const d = await call('village_harvest', { p_ids: ids });
      const h = (d.harvest ?? {}) as Partial<HarvestResult>;
      return { state: cleanState(d), harvest: { per: h.per ?? {}, gained: h.gained ?? {}, exp: Number(h.exp) || 0, lost: Number(h.lost) || 0, rooster: Number(h.rooster) || 0 } };
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
    assign: async (resident, building) => cleanState(await call('village_assign', { p_resident: resident, p_building: building })),
    async requestDone(slot) {
      const d = await call('village_request_done', { p_slot: slot });
      return { state: cleanState(d), gift: typeof d.gift === 'string' ? d.gift : null };
    },
    requestSkip: async (slot) => cleanState(await call('village_request_skip', { p_slot: slot })),
    dailyClaim: async (slot) => cleanState(await call('village_daily_claim', { p_slot: slot })),
    async ranking() {
      // village_ranking 뷰: 번영도 높은 순 → 먼저 달성한 순 (place · total 은 뷰가 센다)
      const cols = 'user_id,nickname,village_name,level,prosperity,place,total';
      const view = () => (sb as SupabaseClient).from('village_ranking');
      const map = (r: Record<string, unknown>): RankRow => ({
        userId: String(r.user_id), nickname: String(r.nickname ?? ''), name: typeof r.village_name === 'string' ? r.village_name : '',
        level: num0(r.level), prosperity: num0(r.prosperity), place: num0(r.place),
      });
      const [{ data, error }, adm] = await Promise.all([
        view().select(cols).order('place', { ascending: true }).limit(100),
        // 관리자 마을 목록은 못 읽어도 랭킹은 보여 준다
        (sb as SupabaseClient).from('village_admin_villages').select('user_id,nickname,village_name,level,prosperity').order('prosperity', { ascending: false }).limit(20),
      ]);
      if (error) throw new Error('network');
      const admins = ((adm.data ?? []) as Record<string, unknown>[]).map((r) => ({ ...map(r), place: 0 }));
      const rows = ((data ?? []) as Record<string, unknown>[]).map(map);
      let mine = rows.find((r) => r.userId === uid) ?? null;
      let total = num0((data as Record<string, unknown>[] | null)?.[0]?.total);
      if (uid && !mine && rows.length >= 100) {
        const res = await view().select(cols).eq('user_id', uid).maybeSingle();
        if (res.data) {
          mine = map(res.data as Record<string, unknown>);
          total = num0((res.data as Record<string, unknown>).total);
        }
      }
      return { rows, mine, total, admins };
    },
    visit: async (id) => cleanVisit(await call('village_visit', { p_user: id })),
    async praise(id) {
      const d = await call('village_praise', { p_user: id });
      return { state: cleanState(d), visit: cleanVisit(d.visit) };
    },
    rename: async (name) => cleanState(await call('village_rename', { p_name: name })),
    adminSetState: async (state) => cleanState(await call('village_admin_set_state', { p_state: state })),
    async monuments() {
      const d = await call('village_monuments');
      return { state: cleanState(d), stats: cleanStats(d.stats) };
    },
  };
}

/** 서버가 준 게임 기록을 다듬는다 (없는 값은 0) */
export function cleanStats(raw: unknown): GameStats {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = noStats();
  for (const k of STAT_IDS) out[k] = Math.max(0, Math.floor(Number(r[k]) || 0));
  return out;
}

let api: VillageApi | null = null;
export async function getApi(user: { id: string; name: string }): Promise<VillageApi> {
  if (api) return api;
  if (LOCAL_MODE) {
    const store = browserStore();
    seedLocal(store);
    const fast = Math.max(1, Math.min(100000, Number(params.get('fast')) || 1));
    // 다른 게임의 기록은 주소로 정한다:  ?mon=tank_wins:10,surv_field:1  (없으면 조금씩 해 본 것으로)
    const stats = noStats();
    for (const part of (params.get('mon') ?? 'tank_wins:3,volley_wins:12,race_plays:1,surv_field:1,matgo_wins:1').split(',')) {
      const [k, v] = part.split(':');
      if ((STAT_IDS as readonly string[]).includes(k)) stats[k as StatId] = Math.max(0, Math.floor(Number(v) || 0));
    }
    // ?admin=1 관리자 계정처럼 (최고 레벨 · 짓기 제한 없음 · 값 없음 · [전시 마을로 꾸미기])
    return (api = createLocalApi(store, undefined, fast, user, stats, params.get('admin') === '1'));
  }
  return (api = createSupabaseApi(await worldSupabase(), undefined, undefined, user.id));
}

const kstDayOf = (ms: number) => Math.floor((ms + 9 * 3600_000) / 86400_000) - 20454;

/** 테스트 모드의 다 자란 마을 (?town=1, 화면 확인용): 12×12 땅, 수확 방울은 가득 찬 채로 */
function makeTown(now: number): VillageState {
  const s = newVillage(now);
  Object.assign(s.profile, { level: 16, exp: 0, landStage: 2, goal: 60, name: '시험 마을' });
  Object.assign(s.profile.resources, { rice: 3000, wood: 3000, stone: 3000, cake: 200, coin: 9000, special: 5 });
  s.sia = 200;
  s.buildings[0].level = 7;
  const list: [BuildingType, number, number, number][] = [
    ['paddy', 5, 5, 1], ['paddy', 6, 5, 2], ['paddy', 7, 5, 4], ['paddy', 8, 5, 6], ['paddy', 9, 5, 8], ['paddy', 10, 5, 10],
    ['lumber', 12, 5, 2], ['lumber', 13, 5, 5], ['lumber', 14, 5, 9],
    ['house', 5, 7, 1], ['house', 6, 7, 3], ['house', 7, 7, 4], ['house', 8, 7, 6], ['house', 9, 7, 8], ['house', 10, 7, 10], ['house', 11, 7, 2], ['house', 12, 7, 5],
    ['storage', 5, 9, 3], ['storage', 6, 9, 6], ['market', 7, 9, 4], ['quarry', 5, 11, 3], ['quarry', 6, 11, 7], ['mill', 7, 11, 5], ['jar', 8, 11, 8],
    ['pavilion', 12, 9, 2], ['feast', 12, 12, 1], ['shrine', 5, 13, 3],
    ['road', 9, 11, 1], ['road', 10, 11, 1], ['road', 11, 11, 1], ['road', 11, 10, 1], ['road', 11, 9, 1],
    ['tree', 14, 9, 1], ['tree', 14, 10, 1], ['flower', 11, 12, 1], ['lantern', 8, 13, 1], ['lantern', 10, 13, 1], ['pond', 14, 11, 1], ['stonetower', 15, 11, 1],
    ['well', 11, 14, 1], ['jangseung', 7, 13, 1], ['sotdae', 14, 14, 1], ['haystack', 4, 5, 1], ['scarecrow', 4, 6, 1], ['stonewall', 15, 5, 1], ['bench', 9, 13, 1],
    ['mon_tank1', 13, 7, 1], ['mon_def12', 14, 7, 1], ['gift_rat', 15, 7, 1],
  ];
  list.forEach(([type, x, y, level], i) => s.buildings.push({ id: `town-${i}`, type, level, x, y, state: 'done', finishAt: null, startAt: null, collectedAt: now - 14 * 3600_000, jobN: 0, banked: 0, accFrom: 0 }));
  // 하나는 업그레이드 중 (진행 막대)
  const up = s.buildings.find((b) => b.id === 'town-7')!;
  Object.assign(up, { state: 'upgrading', startAt: now - 600_000, finishAt: now + 1200_000 });
  s.residents = (['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep'] as ResidentId[]).map((id, i) => ({ id, affinity: [100, 60, 30, 12, 5, 0, 0, 0][i], building: null, gifted: i === 0 }));
  s.residents[1].building = 'town-5';
  s.residents[2].building = 'town-8';
  s.monuments = ['mon_tank1', 'mon_def12'];
  refresh(s, now);
  return s;
}

/** 테스트 모드의 이웃 마을 셋 */
function makeBots(): { id: string; nick: string; state: VillageState }[] {
  const mk = (id: string, nick: string, name: string, level: number, list: [BuildingType, number, number, number][], residents: [ResidentId, number][], praise: number) => {
    const s = newVillage(0, `${id}-hall`);
    s.profile.name = name;
    s.profile.level = level;
    s.profile.praiseCount = praise;
    s.buildings[0].level = Math.min(10, Math.max(1, Math.floor(level / 3)));
    list.forEach(([type, x, y, lv], i) => s.buildings.push({ id: `${id}-${i}`, type, level: lv, x, y, state: 'done', finishAt: null, startAt: null, collectedAt: 0, jobN: 0, banked: 0, accFrom: 0 }));
    s.residents = residents.map(([rid, affinity]) => ({ id: rid, affinity, building: null, gifted: false }));
    refresh(s, 1000 + level);
    return { id, nick, state: s };
  };
  return [
    mk('bot-1', '달토끼', '달빛 마을', 12, [['paddy', 6, 6, 5], ['paddy', 7, 6, 5], ['paddy', 8, 6, 4], ['house', 6, 8, 3], ['house', 7, 8, 3], ['house', 8, 8, 2], ['lumber', 12, 6, 4], ['lumber', 13, 6, 4], ['storage', 12, 8, 4], ['market', 13, 8, 3], ['quarry', 6, 12, 3], ['mill', 7, 12, 3], ['jar', 8, 12, 2], ['pond', 12, 12, 1], ['lantern', 13, 12, 1], ['tree', 11, 12, 1], ['flower', 12, 13, 1], ['road', 9, 11, 1], ['road', 10, 11, 1]], [['rat', 40], ['ox', 20], ['tiger', 12], ['rabbit', 5], ['dragon', 0]], 4),
    mk('bot-2', '솔바람', '', 6, [['paddy', 6, 6, 3], ['paddy', 7, 6, 2], ['house', 12, 6, 2], ['house', 13, 6, 1], ['lumber', 6, 12, 2], ['storage', 7, 12, 2], ['market', 12, 12, 1], ['tree', 13, 13, 1]], [['rat', 12], ['ox', 3]], 1),
    mk('bot-3', '새싹이', '새싹 마을', 2, [['paddy', 6, 6, 1], ['house', 7, 6, 1]], [['rat', 0]], 0),
  ];
}

/**
 * 테스트 모드의 마을을 주소로 정한다 (헤드리스 확인용):
 *   ?fresh=1 처음 상태로 · ?rice=500&wood=500&stone=&cake=&coin=&special= 자원 · ?sia=100 시아코인 · ?land=2 땅 단계 · ?aff=95 친밀도 · ?lv=5 마을 레벨 · ?goal=7 목표 번호 · ?fast=60 시간을 60배로
 *   ?town=1 다 자란 마을로 바꾼다 (건물 모습 1 · 2 · 3단계, 가득 찬 수확 방울, 주민 여덟, 특별 건물 · 장식물 · 기념물 · 길)
 */
function seedLocal(store: Store) {
  if (params.get('fresh') === '1') store.removeItem(LOCAL_KEY);
  const keys = [...RES_IDS, 'lv', 'goal', 'sia', 'land', 'aff', 'town'].filter((k) => params.get(k) !== null);
  if (keys.length === 0) return;
  let d: { state?: unknown; seq?: number; skew?: number } = {};
  try {
    d = JSON.parse(store.getItem(LOCAL_KEY) ?? '{}') ?? {};
  } catch {
    /* 처음 상태 */
  }
  const t0 = Date.now() + (Number(d.skew) || 0);
  const s = params.get('town') === 'showcase' ? makeShowcase(t0) : params.get('town') === '1' ? makeTown(t0) : d.state ? cleanState(d.state) : newVillage(t0);
  const num = (k: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(params.get(k)) || 0)));
  for (const k of RES_IDS) if (params.get(k) !== null) s.profile.resources[k] = num(k, 1e9);
  if (params.get('lv') !== null) {
    s.profile.level = Math.max(1, num('lv', CONST.max_level));
    s.profile.exp = Math.min(s.profile.exp, (LEVEL_EXP[s.profile.level - 1] ?? 1) - 1);
  }
  if (params.get('sia') !== null) s.sia = num('sia', 1e9);
  if (params.get('land') !== null) s.profile.landStage = num('land', 6);
  // ?aff=95 이사 온 주민 모두의 친밀도 점수
  if (params.get('aff') !== null) for (const r of s.residents) r.affinity = num('aff', 1000);
  if (params.get('goal') !== null) {
    s.profile.goal = num('goal', GOALS.length);
    s.profile.goalProgress = 0;
  }
  store.setItem(LOCAL_KEY, JSON.stringify({ ...d, state: s }));
}
