import type { SupabaseClient } from '@supabase/supabase-js';
import { TOTAL_FLOORS, isCheckpoint } from '../data';
import { LOOK_PRICE, isLook, normalize, sameLook, type Look, type TowerData } from '../game/progress';
import { LOCAL_MODE } from './local';
import { worldSupabase } from './world';

/**
 * 서버 약속 (PRD '서버 약속', 104_tower.sql) — 이 셋만 부른다:
 *   tower_state() → { look, data, bestFloor, siaCoins, lookPrice, savedAt }   (savedAt: 106)
 *   tower_set_look(p_look) → { look, siaCoins, paid }          ('bad look' · 'not enough sia coins')
 *   tower_save(p_data, p_cleared) → { bestFloor, gotCoin, siaCoins, savedAt }   ('bad save'. savedAt: 107 — 옛 서버는 없다)
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
const PENDING_MAX = 120; // 100층을 모두 못 보내도 층 깬 저장이 하나도 빠지지 않게
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
  /** 만든 시각 (ms). 서버의 마지막 저장(savedAt)보다 먼저 만든 것은 다른 기기에 밀린 옛 저장이다 */
  at?: number;
}

export function createSupabaseApi(sb: SupabaseClient | RpcClient, uid: string, store: Store): TowerApi {
  const pKey = `siatower:pending:${uid}`;
  /** 이 기기가 마지막으로 서버에 넣은(또는 받아들인) 저장의 savedAt (107). 없으면 null → 106 방식(만든 시각 비교)으로 */
  const sKey = `siatower:savedAt:${uid}`;
  const readSeen = (): number | null => {
    try {
      const v = Number(store.getItem(sKey));
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  };
  const writeSeen = (v: unknown) => {
    const n = Number(v);
    // 줄어들지 않게 (서버 시각은 늘기만 한다. 실패해서 옛 state 로 돌아간 경우에도 앞으로 받은 값을 지킨다)
    if (!Number.isFinite(n) || n <= 0 || n <= (readSeen() ?? 0)) return;
    try {
      store.setItem(sKey, String(n));
    } catch {
      /* 적지 못해도 게임은 계속 */
    }
  };
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
      else {
        // 너무 많으면 '그냥 저장'부터 줄인다 (층을 깬 저장을 버리면 그 뒤 층 깬 저장이 모두 건너뛰기로 거절된다)
        let keep = list;
        while (keep.length > PENDING_MAX) {
          const i = keep.findIndex((p, k) => p.cleared == null && k < keep.length - 1);
          keep = i >= 0 ? keep.filter((_, k) => k !== i) : keep.slice(-PENDING_MAX);
        }
        store.setItem(pKey, JSON.stringify(keep));
      }
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
          const res = await call('tower_save', { p_data: e.data, p_cleared: e.cleared });
          // 107 서버는 이 저장의 시각을 돌려준다 → 다음 state() 에서 '내 저장' 과 '다른 기기의 저장' 을 가른다
          writeSeen((res as { savedAt?: unknown } | null)?.savedAt);
          done.set(e.id, toSave(res));
        } catch (err) {
          if (!(err instanceof ApiError)) break;
          if (err.message === 'old save') {
            // 다른 곳(탭·기기)에서 더 진행했다 → 이 기기의 못 보낸 저장은 모두 옛것이다. 다 버린다 (화면은 state() 로 다시 불러온다)
            for (const p of readPending()) done.set(p.id, err);
            writePending([]);
            break;
          }
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
      type St = Partial<{ look: unknown; data: unknown; bestFloor: number; siaCoins: number; lookPrice: number; savedAt: number }>;
      let d = (await call('tower_state')) as St;
      if (readPending().length) {
        // 다른 기기가 그 뒤에 저장했으면 이 기기의 못 보낸 저장은 옛것이다 → 보내지 않고 버린다 (최고 층이 같아도 레벨·엽전을 덮어쓰지 않게)
        // 107: 서버의 마지막 저장이 이 기기가 넣은 마지막 저장(seen)이면 다른 기기의 저장이 아니다 → 하나도 버리지 않는다
        //      (못 보낸 A·B 중 A 만 들어가고 끊긴 경우, 서버 savedAt = A 를 보낸 시각 > B 를 만든 시각이어도 B 는 남긴다)
        const savedAt = Number(d?.savedAt) || 0;
        const seen = readSeen();
        if (savedAt && (seen == null || savedAt > seen)) writePending(readPending().filter((p) => !(typeof p.at === 'number' && p.at < savedAt)));
        if (readPending().length) {
          await flush().catch(() => null);
          d = ((await call('tower_state').catch(() => null)) as St | null) ?? d;
        }
      }
      let left = readPending();
      const serverBest = Math.max(0, Number(d?.bestFloor) || 0);
      // 다른 기기에서 더 높이 올랐으면 이 기기의 못 보낸 저장은 옛것이다 (서버가 'old save' 로 거절한다) → 버린다
      if (left.length && normalize(left[left.length - 1].data).best < serverBest) {
        writePending([]);
        left = [];
      }
      // 보낼 것이 없으면 이 기기는 서버의 지금 상태를 받아들였다 → 그 시각을 기준으로 삼는다
      if (!left.length) writeSeen(d?.savedAt);
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
      list.push({ id, data: JSON.parse(JSON.stringify(data)), cleared: cleared ?? null, at: Date.now() });
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
