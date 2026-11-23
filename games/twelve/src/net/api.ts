import type { SupabaseClient } from '@supabase/supabase-js';
import { BAG, MAX_PLUS, POTION, POTION_SIZES } from '../data/economy';
import { isHero } from '../data/heroes';
import { SLOTS, itemDef, type Item } from '../data/items';
import { REGIONS, type Mode } from '../data/regions';
import type { Pity } from '../game/drops';
import { applyReport, checkReport, checkStart, emptyProfile, setHero, type FinishResult, type MapRecord, type RunReport, type TwelveProfile } from '../game/progress';
import { buy, claim, enhance, equip, scrap, sell, setLock, unequip } from '../game/rules';
import { LOCAL_MODE } from './local';
import { worldSupabase } from './world';

/**
 * 기록 저장 (PRD '저장과 서버'): 맵을 시작할 때 start, 끝날 때 finish, 쉼터에서 사고·강화하고·장비를 바꿀 때마다.
 * - 테스트 모드(?local=1): 같은 규칙(src/game/progress.ts · rules.ts)으로 이 기기에만 저장한다 (createLocalApi).
 * - 서버: 078_twelve.sql 의 RPC (createSupabaseApi). 경험치·엽전·드랍은 서버가 계산한다.
 */

export class ApiError extends Error {}

export interface StartInfo {
  /** 판 번호 ('' = 기록되지 않는 판) */
  run: string;
  /** 드랍 씨앗 (전투 화면이 무엇이 떨어질지 미리 안다. 판정은 서버가 다시 한다) */
  seed: number;
}

export interface TwelveApi {
  loadProfile(): Promise<TwelveProfile>;
  /** 판 시작 (거절이면 ApiError, 통신 실패면 run '' = 기록되지 않는 판) */
  start(map: string, mode: Mode, hero: string): Promise<StartInfo>;
  /** 판 결과 → 새 프로필과 결과 (통신 실패면 null: 보관해 두었다가 resend 로 다시 보낸다) */
  finish(report: RunReport): Promise<{ profile: TwelveProfile; result: FinishResult } | null>;
  /** 못 보낸 결과 다시 보내기 → 보낸 수 */
  resend(): Promise<number>;
  /** 대표 대원 바꾸기 */
  setHero(hero: string): Promise<TwelveProfile>;
  equip(id: string): Promise<TwelveProfile>;
  unequip(slot: string): Promise<TwelveProfile>;
  lock(id: string, on: boolean): Promise<TwelveProfile>;
  /** 보관함 → 가방 (ids 가 없으면 들어가는 만큼 전부) */
  claim(ids?: string[]): Promise<TwelveProfile>;
  sell(ids: string[]): Promise<TwelveProfile>;
  scrap(ids: string[]): Promise<TwelveProfile>;
  enhance(id: string): Promise<TwelveProfile>;
  /** what = 장비 id · 'potion:<0|1>:<0~2>' · 'bag' */
  buy(what: string, n?: number): Promise<TwelveProfile>;
}

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();
const memStore: Store = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v), removeItem: (k) => void memory.delete(k) };
export const safeStore = (): Store => {
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    return localStorage;
  } catch {
    return memStore;
  }
};

const int = (v: unknown, min: number, max: number, dflt = min) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.floor(Number(v)))) : dflt);
const recs = (v: unknown): Record<string, MapRecord> => {
  const out: Record<string, MapRecord> = {};
  if (typeof v !== 'object' || !v) return out;
  for (const [id, r] of Object.entries(v as Record<string, Partial<MapRecord>>)) {
    if (!r || !(Number(r.clears) > 0)) continue;
    out[id] = { stars: Number(r.stars) & 7, clears: Math.floor(Number(r.clears)), best: Math.max(0, Number(r.best) || 0) };
  }
  return out;
};
const regions = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= REGIONS))].sort((a, b) => a - b) : []);
const pities = (v: unknown): Record<string, Pity> => {
  const out: Record<string, Pity> = {};
  if (typeof v !== 'object' || !v) return out;
  for (const [r, c] of Object.entries(v as Record<string, Partial<Pity>>)) {
    if (!c || !(Number(r) >= 1 && Number(r) <= REGIONS)) continue;
    const row = { elite: int(c.elite, 0, 9999), boss: int(c.boss, 0, 9999), key: int(c.key, 0, 9999) };
    if (row.elite || row.boss || row.key) out[String(Number(r))] = row;
  }
  return out;
};

/** 저장된 값(기기·서버)을 프로필 모양으로. 장비가 하나도 없는(처음이거나 깨진) 기록은 처음 장비로 */
export function normalize(v: unknown): TwelveProfile {
  const o = (v ?? {}) as Partial<TwelveProfile> & { maps?: Partial<TwelveProfile['maps']>; keys?: Partial<TwelveProfile['keys']>; pity?: Partial<TwelveProfile['pity']> };
  const e = emptyProfile();
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const it of Array.isArray(o.items) ? (o.items as Partial<Item>[]) : []) {
    const id = String(it?.id ?? '');
    if (!it || !id || seen.has(id) || !itemDef(String(it.base))) continue;
    seen.add(id);
    items.push({ id, base: String(it.base), plus: int(it.plus, 0, MAX_PLUS), lock: !!it.lock, box: !!it.box });
  }
  const fresh = !items.length;
  const eq = { ...e.eq };
  if (!fresh) {
    for (const slot of SLOTS) {
      const id = o.eq?.[slot] == null ? null : String(o.eq[slot]);
      const it = items.find((x) => x.id === id);
      eq[slot] = it && !it.box && itemDef(it.base)!.slot === slot ? it.id : null;
    }
    // 무기는 꼭 하나 들고 있어야 한다
    eq.weapon ??= items.find((x) => !x.box && itemDef(x.base)!.slot === 'weapon')?.id ?? null;
  }
  return {
    level: int(o.level, 1, 99),
    exp: int(o.exp, 0, 1e12),
    coins: int(o.coins, 0, 1e12),
    stones: int(o.stones, 0, 1e9),
    mode: o.mode === 'hard' ? 'hard' : 'normal',
    hero: typeof o.hero === 'string' && isHero(o.hero) ? o.hero : e.hero,
    bag: int(o.bag, BAG.size, BAG.max),
    potions: [0, 1].map((s) => Array.from({ length: POTION_SIZES }, (_, z) => (Array.isArray(o.potions?.[s]) ? int(o.potions![s][z], 0, POTION.max) : e.potions[s][z]))),
    eq,
    items: fresh ? e.items : items,
    maps: { normal: recs(o.maps?.normal), hard: recs(o.maps?.hard) },
    keys: { normal: regions(o.keys?.normal), hard: regions(o.keys?.hard) },
    pity: { normal: pities(o.pity?.normal), hard: pities(o.pity?.hard) },
    codex: Array.isArray(o.codex) ? [...new Set(o.codex.map(String).filter((b) => itemDef(b)))] : [],
  };
}

export function createLocalApi(store: Store, key = 'sia-twelve-local-v2'): TwelveApi {
  const load = () => {
    try {
      return normalize(JSON.parse(store.getItem(key) ?? 'null'));
    } catch {
      return emptyProfile();
    }
  };
  const save = (p: TwelveProfile) => store.setItem(key, JSON.stringify(p));
  /** 규칙 하나를 적용하고 저장 (거절이면 ApiError) */
  const act = async (fn: (p: TwelveProfile) => string | null) => {
    const p = load();
    const why = fn(p);
    if (why) throw new ApiError(why);
    save(p);
    return p;
  };
  const seeds = new Map<string, number>();
  let n = 0;
  return {
    async loadProfile() {
      return load();
    },
    async start(map, mode, hero) {
      const why = checkStart(load(), map, mode, hero);
      if (why) throw new ApiError(why);
      const run = `local-${Date.now()}-${n++}`;
      const seed = Math.floor(Math.random() * 0x7fffffff);
      seeds.set(run, seed);
      return { run, seed };
    },
    async finish(report) {
      const why = checkReport(report);
      if (why) throw new ApiError(why);
      const p = load();
      const result = applyReport(p, report, seeds.get(report.run) ?? 0);
      seeds.delete(report.run);
      save(p);
      return { profile: p, result };
    },
    async resend() {
      return 0;
    },
    setHero: (hero) => act((p) => setHero(p, hero)),
    equip: (id) => act((p) => equip(p, id)),
    unequip: (slot) => act((p) => unequip(p, slot)),
    lock: (id, on) => act((p) => setLock(p, id, on)),
    claim: (ids) => act((p) => claim(p, ids ?? [])),
    sell: (ids) => act((p) => sell(p, ids)),
    scrap: (ids) => act((p) => scrap(p, ids)),
    enhance: (id) => act((p) => enhance(p, id)),
    buy: (what, cnt = 1) => act((p) => buy(p, what, cnt)),
  };
}

// ---------- 서버 ----------

const PENDING_MAX = 5;
const RPC_TIMEOUT_MS = 10_000;

interface RpcAnswer {
  data: unknown;
  error: { message: string } | null;
}
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcAnswer>;
}

/** 서버가 일부러 거절한 까닭 (raise exception 글자) — 다시 보내도 소용없다 */
const REJECTS = [
  'map locked', 'hero locked', 'locked character', 'mode locked', 'not enough coins', 'not enough stones', 'low level', 'locked item', 'equipped', 'bag full',
  'max plus', 'max bag', 'max potions', 'not for sale', 'no weapon', 'no item', 'already finished', 'too early', 'too late', 'overlap', 'no run', 'need login', 'bad ',
];
/** 거절이면 까닭, 아니면(통신 문제) null */
const rejectOf = (msg: string) => {
  const w = REJECTS.find((x) => msg.includes(x));
  return w ? (w === 'bad ' ? (msg.match(/bad \w+/)?.[0] ?? 'bad result') : w) : null;
};
const nums = (list: string[]) => list.map(Number);

export function createSupabaseApi(sb: SupabaseClient | RpcClient, uid: string, store: Store): TwelveApi {
  const pKey = `siatwelve:pending:${uid}`;
  const readPending = (): RunReport[] => {
    try {
      const v = JSON.parse(store.getItem(pKey) ?? '[]');
      return Array.isArray(v) ? v.filter((r) => r && typeof r.run === 'string' && r.run) : [];
    } catch {
      return [];
    }
  };
  const writePending = (list: RunReport[]) => {
    try {
      if (!list.length) store.removeItem(pKey);
      else store.setItem(pKey, JSON.stringify(list.slice(-PENDING_MAX)));
    } catch {
      /* 보관하지 못해도 게임은 계속 */
    }
  };
  const forget = (run: string) => writePending(readPending().filter((r) => r.run !== run));
  const call = async (fn: string, args?: Record<string, unknown>) => {
    const timeout = new Promise<RpcAnswer>((_, rej) => setTimeout(() => rej(new Error('timeout')), RPC_TIMEOUT_MS));
    const res = await Promise.race([Promise.resolve((sb as RpcClient).rpc(fn, args)), timeout]);
    if (res.error) {
      const why = rejectOf(res.error.message);
      throw why ? new ApiError(why) : new Error(res.error.message);
    }
    return res.data;
  };
  const state = async (fn: string, args?: Record<string, unknown>) => normalize(await call(fn, args));
  const send = async (r: RunReport) => {
    const data = (await call('twelve_finish', {
      p_run: r.run,
      p_report: { time: Math.floor(r.time), cleared: r.cleared, kills: r.kills, elites: r.elites, boss: r.boss, chest: r.chest, deaths: r.deaths, potions: r.potions ?? null },
    })) as { state: unknown; result: Partial<FinishResult> };
    const res = data.result ?? {};
    const result: FinishResult = {
      exp: Number(res.exp) || 0,
      coins: Number(res.coins) || 0,
      ups: Number(res.ups) || 0,
      level: Number(res.level) || 1,
      stars: Number(res.stars) || 0,
      newStars: Number(res.newStars) || 0,
      first: !!res.first,
      joined: typeof res.joined === 'string' && isHero(res.joined) ? res.joined : null,
      siaCoin: !!res.siaCoin,
      items: (Array.isArray(res.items) ? res.items : []).map((it) => ({ id: String(it.id), base: String(it.base), plus: 0, lock: false, box: !!it.box })),
      stones: Number(res.stones) || 0,
      potions: [0, 1].map((s) => Array.from({ length: POTION_SIZES }, (_, z) => Number(res.potions?.[s]?.[z]) || 0)),
      key: !!res.key,
      starItem: typeof res.starItem === 'string' ? res.starItem : null,
    };
    return { profile: normalize(data.state), result };
  };
  let sending: Promise<number> | null = null;
  const resend = () => {
    sending ??= (async () => {
      let n = 0;
      for (const r of readPending()) {
        try {
          await send(r);
          n++;
          forget(r.run);
        } catch (e) {
          if (e instanceof ApiError) forget(r.run);
        }
      }
      return n;
    })().finally(() => (sending = null));
    return sending;
  };
  return {
    loadProfile: () => state('twelve_state'),
    async start(map, mode, hero) {
      // 못 보낸 결과가 있으면 새 판을 시작하기 전에 먼저 보낸다 (새 판과 시간이 겹치면 서버가 받지 않는다)
      if (readPending().length) await resend().catch(() => 0);
      try {
        const d = (await call('twelve_start', { p_map: map, p_mode: mode, p_hero: hero })) as { run?: string; seed?: number };
        return { run: String(d.run ?? ''), seed: Number(d.seed) || 0 };
      } catch (e) {
        if (e instanceof ApiError) throw e;
        return { run: '', seed: Math.floor(Math.random() * 0x7fffffff) };
      }
    },
    async finish(report) {
      if (!report.run) return null;
      // 보내기 전에 먼저 보관 (보내는 도중 창이 닫혀도 남게)
      writePending([...readPending().filter((r) => r.run !== report.run), report]);
      try {
        const out = await send(report);
        forget(report.run);
        return out;
      } catch (e) {
        if (e instanceof ApiError) {
          forget(report.run);
          throw e;
        }
        return null;
      }
    },
    resend,
    setHero: (hero) => state('twelve_set_hero', { p_hero: hero }),
    equip: (id) => state('twelve_equip', { p_item: Number(id) }),
    unequip: (slot) => state('twelve_unequip', { p_slot: slot }),
    lock: (id, on) => state('twelve_lock', { p_item: Number(id), p_on: on }),
    claim: (list) => state('twelve_claim', { p_items: nums(list ?? []) }),
    sell: (list) => state('twelve_sell', { p_items: nums(list) }),
    scrap: (list) => state('twelve_scrap', { p_items: nums(list) }),
    enhance: (id) => state('twelve_enhance', { p_item: Number(id) }),
    buy: (what, n = 1) => state('twelve_buy', { p_what: what, p_n: n }),
  };
}

let api: TwelveApi | null = null;
/** uid = 로그인한 사람 (테스트 모드는 'local') */
export async function getApi(uid: string): Promise<TwelveApi> {
  if (api) return api;
  if (LOCAL_MODE) return (api = createLocalApi(safeStore()));
  return (api = createSupabaseApi(await worldSupabase(), uid, safeStore()));
}
