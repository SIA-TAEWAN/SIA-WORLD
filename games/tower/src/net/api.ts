import type { SupabaseClient } from '@supabase/supabase-js';
import { TOTAL_FLOORS, isCheckpoint } from '../data';
import { LOOK_PRICE, isLook, normalize, sameLook, type Look, type TowerData } from '../game/progress';
import { LOCAL_MODE } from './local';
import { worldSupabase } from './world';

/**
 * 서버 약속 (PRD '서버 약속', 104_tower.sql) — 이 셋만 부른다:
 *   tower_state() → { look, data, bestFloor, siaCoins, lookPrice }
 *   tower_set_look(p_look) → { look, siaCoins, paid }          ('bad look' · 'not enough sia coins')
 *   tower_save(p_data, p_cleared) → { bestFloor, gotCoin, siaCoins }   ('bad save')
 * 테스트 모드(?local=1)는 같은 규칙으로 이 기기에만 (createLocalApi).
 * 저장이 통신 문제로 실패하면 기기에 보관했다가 다음 저장·시작 때 차례대로 다시 보낸다.
 */
export class ApiError extends Error {}

export interface TowerState {
  look: Look | null;
  data: TowerData;
  bestFloor: number;
  siaCoins: number;
  lookPrice: number;
}
export interface LookResult {
  look: Look;
  siaCoins: number;
  paid: boolean;
}
export interface SaveResult {
  bestFloor: number;
  gotCoin: boolean;
  siaCoins: number;
}
export interface TowerApi {
  state(): Promise<TowerState>;
  /** 외형 정하기 (처음은 무료, 바꾸면 시아코인 30). 거절이면 ApiError */
  setLook(look: Look): Promise<LookResult>;
  /** 진행 저장. cleared = 방금 깬 층. 통신 실패면 null (보관해 두었다가 다시 보낸다) */
  save(data: TowerData, cleared?: number | null): Promise<SaveResult | null>;
  /** 못 보낸 저장 수 */
  pending(): number;
  /** 못 보낸 저장 다시 보내기 → 남은 수 */
  resend(): Promise<number>;
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

/** 서버가 확인하는 것과 같은 규칙 (값 범위·층 건너뛰기). 어기면 'bad save' */
export function checkSave(data: TowerData, cleared: number | null, best: number): string | null {
  if (JSON.stringify(data).length > 32 * 1024) return 'bad save';
  if (!(data.level >= 1 && data.level <= 99) || data.exp < 0 || data.coins < 0) return 'bad save';
  if (!(data.floor >= 1 && data.floor <= TOTAL_FLOORS)) return 'bad save';
  if (cleared != null && !(Number.isInteger(cleared) && cleared >= 1 && cleared <= TOTAL_FLOORS && cleared <= best + 1)) return 'bad save';
  const newBest = Math.max(best, cleared ?? 0);
  if (!isCheckpoint(data.checkpoint) || data.checkpoint > newBest + 1 || data.floor > newBest + 1) return 'bad save';
  return null;
}

// ---------- 테스트 모드 ----------
interface LocalRow {
  look: Look | null;
  data: unknown;
  best: number;
  siaCoins: number;
  coinFloors: number[];
}
export function createLocalApi(store: Store, key = 'siatower:local'): TowerApi {
  const read = (): LocalRow => {
    try {
      const v = JSON.parse(store.getItem(key) ?? 'null');
      if (v && typeof v === 'object') return { look: isLook(v.look) ? v.look : null, data: v.data ?? {}, best: Number(v.best) || 0, siaCoins: Number(v.siaCoins) || 0, coinFloors: Array.isArray(v.coinFloors) ? v.coinFloors : [] };
    } catch {
      /* 깨진 기록은 처음부터 */
    }
    return { look: null, data: {}, best: 0, siaCoins: 100, coinFloors: [] };
  };
  const write = (r: LocalRow) => {
    try {
      store.setItem(key, JSON.stringify(r));
    } catch {
      /* 저장하지 못해도 게임은 계속 */
    }
  };
  return {
    async state() {
      const r = read();
      write(r);
      return { look: r.look, data: normalize(r.data), bestFloor: r.best, siaCoins: r.siaCoins, lookPrice: LOOK_PRICE };
    },
    async setLook(look) {
      if (!isLook(look)) throw new ApiError('bad look');
      const r = read();
      if (!r.look || sameLook(r.look, look)) {
        r.look = look;
        write(r);
        return { look, siaCoins: r.siaCoins, paid: false };
      }
      if (r.siaCoins < LOOK_PRICE) throw new ApiError('not enough sia coins');
      r.siaCoins -= LOOK_PRICE;
      r.look = look;
      write(r);
      return { look, siaCoins: r.siaCoins, paid: true };
    },
    async save(data, cleared = null) {
      const r = read();
      const why = checkSave(data, cleared, r.best);
      if (why) throw new ApiError(why);
      let gotCoin = false;
      if (cleared != null) {
        r.best = Math.max(r.best, cleared);
        if (!r.coinFloors.includes(cleared)) {
          r.coinFloors.push(cleared);
          r.siaCoins++;
          gotCoin = true;
        }
      }
      r.data = data;
      write(r);
      return { bestFloor: r.best, gotCoin, siaCoins: r.siaCoins };
    },
    pending: () => 0,
    resend: async () => 0,
  };
}

// ---------- 서버 ----------
const RPC_TIMEOUT_MS = 10_000;
const PENDING_MAX = 40;
interface RpcAnswer {
  data: unknown;
  error: { message: string } | null;
}
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcAnswer>;
}
/** 서버가 일부러 거절한 까닭 (raise exception 글자) — 다시 보내도 소용없다 */
const REJECTS = ['not enough sia coins', 'bad look', 'bad save', 'old save', 'no look', 'need login', 'not allowed', 'game closed'];
const rejectOf = (msg: string) => REJECTS.find((x) => msg.includes(x)) ?? null;

interface Pending {
  id: string;
  data: TowerData;
  cleared: number | null;
}

export function createSupabaseApi(sb: SupabaseClient | RpcClient, uid: string, store: Store): TowerApi {
  const pKey = `siatower:pending:${uid}`;
  const readPending = (): Pending[] => {
    try {
      const v = JSON.parse(store.getItem(pKey) ?? '[]');
      return Array.isArray(v) ? v.filter((p) => p && typeof p.data === 'object').map((p, i) => ({ ...p, id: String(p.id ?? `old-${i}`) })) : [];
    } catch {
      return [];
    }
  };
  const writePending = (list: Pending[]) => {
    try {
      if (!list.length) store.removeItem(pKey);
      else store.setItem(pKey, JSON.stringify(list.slice(-PENDING_MAX)));
    } catch {
      /* 보관하지 못해도 게임은 계속 */
    }
  };
  const call = async (fn: string, args?: Record<string, unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<RpcAnswer>((_, rej) => (timer = setTimeout(() => rej(new Error('timeout')), RPC_TIMEOUT_MS)));
    try {
      const res = await Promise.race([Promise.resolve((sb as RpcClient).rpc(fn, args)), timeout]);
      if (res.error) {
        const why = rejectOf(res.error.message);
        throw why ? new ApiError(why) : new Error(res.error.message);
      }
      return res.data;
    } finally {
      clearTimeout(timer);
    }
  };
  const toSave = (d: unknown): SaveResult => {
    const o = (d ?? {}) as Partial<SaveResult>;
    return { bestFloor: Number(o.bestFloor) || 0, gotCoin: !!o.gotCoin, siaCoins: Number(o.siaCoins) || 0 };
  };

  /** 보관한 저장을 차례대로 보낸다 (층 건너뛰기 확인 때문에 순서가 중요하다). 보낸 것의 답은 done 에 */
  const done = new Map<string, SaveResult | ApiError>();
  let flushing: Promise<void> | null = null;
  const flush = () => {
    flushing ??= (async () => {
      for (;;) {
        const list = readPending();
        if (!list.length) break;
        const e = list[0];
        try {
          done.set(e.id, toSave(await call('tower_save', { p_data: e.data, p_cleared: e.cleared })));
        } catch (err) {
          if (!(err instanceof ApiError)) break;
          // 서버가 거절한 저장은 버린다 (다음 것은 계속)
          done.set(e.id, err);
        }
        writePending(readPending().filter((x) => x.id !== e.id));
      }
    })().finally(() => (flushing = null));
    return flushing;
  };
  let seq = 0;

  return {
    async state() {
      if (readPending().length) await flush().catch(() => null);
      const d = (await call('tower_state')) as Partial<{ look: unknown; data: unknown; bestFloor: number; siaCoins: number; lookPrice: number }>;
      let left = readPending();
      const serverBest = Math.max(0, Number(d?.bestFloor) || 0);
      // 다른 기기에서 더 높이 올랐으면 이 기기의 못 보낸 저장은 옛것이다 (서버가 'old save' 로 거절한다) → 버린다
      if (left.length && normalize(left[left.length - 1].data).best < serverBest) {
        writePending([]);
        left = [];
      }
      // 못 보낸 저장이 남았으면 (아직 통신이 안 된다) 기기에 있는 것이 더 새것이다
      const data = normalize(left.length ? left[left.length - 1].data : (d?.data ?? {}));
      if (data.best < serverBest) data.best = serverBest;
      return {
        look: isLook(d?.look) ? d.look : null,
        data,
        bestFloor: Math.max(0, Number(d?.bestFloor) || 0),
        siaCoins: Number(d?.siaCoins) || 0,
        lookPrice: Number(d?.lookPrice) || LOOK_PRICE,
      };
    },
    async setLook(look) {
      const d = (await call('tower_set_look', { p_look: look })) as Partial<LookResult>;
      return { look: isLook(d?.look) ? d.look : look, siaCoins: Number(d?.siaCoins) || 0, paid: !!d?.paid };
    },
    async save(data, cleared = null) {
      const list = readPending();
      // 층을 깬 저장이 아니면 바로 앞의 '그냥 저장' 을 덮어쓴다 (보낼 것을 줄인다. 보내는 중일 수 있는 맨 앞 것은 두고)
      if (list.length > 1 && list[list.length - 1].cleared == null && cleared == null) list.pop();
      const id = `${Date.now().toString(36)}-${seq++}`;
      list.push({ id, data: JSON.parse(JSON.stringify(data)), cleared: cleared ?? null });
      writePending(list);
      // 다른 저장을 보내는 중이면 그것이 끝난 뒤 한 번 더 (내 것까지 보내지게)
      if (flushing) await flushing.catch(() => null);
      await flush().catch(() => null);
      const r = done.get(id);
      done.delete(id);
      if (r instanceof ApiError) throw r;
      return r ?? null;
    },
    pending: () => readPending().length,
    async resend() {
      await flush().catch(() => null);
      done.clear();
      return readPending().length;
    },
  };
}

let api: TowerApi | null = null;
/** uid = 로그인한 사람 (테스트 모드는 'local') */
export async function getApi(uid: string): Promise<TowerApi> {
  if (api) return api;
  if (LOCAL_MODE) return (api = createLocalApi(safeStore()));
  return (api = createSupabaseApi(await worldSupabase(), uid, safeStore()));
}
