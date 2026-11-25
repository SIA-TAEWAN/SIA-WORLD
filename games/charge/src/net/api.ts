import type { SupabaseClient } from '@supabase/supabase-js';
import type { UpgradeKey } from '../data/growth';
import {
  applyReport,
  buyUpgrade,
  checkStart,
  emptyProfile,
  type ChargeProfile,
  type FinishResult,
  type RunMode,
  type RunReport,
} from '../game/progress';
import { LOCAL_MODE } from './local';
import { worldSupabase } from './world';

/**
 * 기록 저장 (PRD 12장): 판을 시작할 때 charge_start, 끝날 때 charge_finish 로 한 번에.
 * 못 올린 결과는 기기에 보관했다가 다음에 다시 보낸다 (시아디펜스 net/pending.ts 와 같은 방식).
 * 테스트 모드(?local=1)는 같은 규칙(src/game/progress.ts)으로 이 기기에만 저장한다.
 */

export class ApiError extends Error {}

export interface ChargeApi {
  loadProfile(): Promise<ChargeProfile>;
  /**
   * 판 시작 → 판 번호 (서버가 거절하면 ApiError, 통신 실패면 '' = 기록되지 않는 판).
   * day = 오늘의 길에서 코스를 만든 날짜: 서버가 그 날짜로 기록한다 (서버의 오늘과 다르면 'bad day', 088)
   */
  start(stage: string, leader: string, mode: RunMode, day?: string): Promise<string>;
  /** 판 결과 → 새 프로필과 결과 (통신 실패면 null: 보관했다가 다시 보낸다) */
  finish(report: RunReport): Promise<{ profile: ChargeProfile; result: FinishResult } | null>;
  /** 보관해 둔 결과 다시 보내기 → 올라간 판 수 */
  resend(): Promise<number>;
  buyUpgrade(key: UpgradeKey): Promise<ChargeProfile>;
  /** 한 지역의 스테이지별 친구 기록 (079 charge_stage_tops). 테스트 모드는 빈 값. 실패하면 던진다 → 화면은 조용히 숨긴다 */
  stageTops(region: number): Promise<StageTops>;
}

/** 한 스테이지의 최다 생존 대원: 1~3위 · 기록한 사람 수 · 내 기록 (없으면 null) */
export interface StageTop {
  top: { place: number; nickname: string; troops: number; me: boolean }[];
  total: number;
  mine: { place: number; troops: number } | null;
}
/** 스테이지 id → 기록 (기록이 없는 스테이지는 빠진다) */
export type StageTops = Record<string, StageTop>;

export function normalizeTops(v: unknown): StageTops {
  const out: StageTops = {};
  if (!v || typeof v !== 'object') return out;
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    const o = (raw ?? {}) as { top?: unknown; total?: unknown; mine?: { place?: unknown; troops?: unknown } | null };
    const top = (Array.isArray(o.top) ? o.top : [])
      .map((t: { place?: unknown; nickname?: unknown; troops?: unknown; me?: unknown }) => ({
        place: Number(t?.place) || 0,
        nickname: String(t?.nickname ?? ''),
        troops: Math.max(0, Number(t?.troops) || 0),
        me: t?.me === true,
      }))
      .filter((t) => t.place >= 1 && t.place <= 3)
      .sort((a, b) => a.place - b.place);
    if (!top.length) continue;
    const m = o.mine;
    const mine = m && Number(m.place) >= 1 ? { place: Number(m.place), troops: Math.max(0, Number(m.troops) || 0) } : null;
    out[id] = { top, total: Math.max(top.length, Number(o.total) || 0), mine };
  }
  return out;
}

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();
const memStore: Store = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v), removeItem: (k) => void memory.delete(k) };
const safeStore = (): Store => {
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    return localStorage;
  } catch {
    return memStore;
  }
};

export function normalize(p: unknown): ChargeProfile {
  const o = (p ?? {}) as Partial<ChargeProfile>;
  const e = o.endless as ChargeProfile['endless'];
  return {
    coins: Math.max(0, Number(o.coins) || 0),
    stages: typeof o.stages === 'object' && o.stages ? { ...(o.stages as Record<string, number>) } : {},
    upgrades: typeof o.upgrades === 'object' && o.upgrades ? { ...o.upgrades } : {},
    endless: e && Number.isFinite(Number(e.meters)) ? { meters: Number(e.meters), leader: String(e.leader ?? 'rat') } : null,
  };
}

// ---------- 테스트 모드: 이 기기에만 ----------

export function createLocalApi(store: Store, key = 'sia-charge-local-v1'): ChargeApi {
  const load = () => {
    try {
      return normalize(JSON.parse(store.getItem(key) ?? 'null'));
    } catch {
      return emptyProfile();
    }
  };
  const save = (p: ChargeProfile) => store.setItem(key, JSON.stringify(p));
  let n = 0;
  return {
    async loadProfile() {
      return load();
    },
    async start(stage, leader, mode) {
      const why = checkStart(load(), stage, leader, mode);
      if (why) throw new ApiError(why);
      return `local-${Date.now()}-${n++}`;
    },
    async finish(report) {
      const p = load();
      const result = applyReport(p, report);
      save(p);
      return { profile: p, result };
    },
    async resend() {
      return 0;
    },
    async buyUpgrade(k) {
      const p = load();
      const why = buyUpgrade(p, k);
      if (why) throw new ApiError(why);
      save(p);
      return p;
    },
    async stageTops() {
      return {};
    },
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
const REJECTS = ['stage locked', 'leader locked', 'locked character', 'endless locked', 'not enough coins', 'max level', 'already finished', 'too early', 'too late', 'overlap', 'no run', 'need login', 'bad '];
/** 거절이면 까닭, 아니면(통신 문제) null */
const rejectOf = (msg: string) => {
  const w = REJECTS.find((x) => msg.includes(x));
  return w ? (w === 'bad ' ? (msg.match(/bad \w+/)?.[0] ?? 'bad result') : w) : null;
};

export function createSupabaseApi(sb: SupabaseClient | RpcClient, uid: string, store: Store): ChargeApi {
  const pKey = `siacharge:pending:${uid}`;
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
  const call = async (fn: string, args?: Record<string, unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<RpcAnswer>((_, rej) => (timer = setTimeout(() => rej(new Error('timeout')), RPC_TIMEOUT_MS)));
    let res: RpcAnswer;
    try {
      res = await Promise.race([Promise.resolve((sb as RpcClient).rpc(fn, args)), timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (res.error) {
      const why = rejectOf(res.error.message);
      throw why ? new ApiError(why) : new Error(res.error.message);
    }
    return res.data;
  };
  const args = (r: RunReport) => ({
    p_run: r.run, p_time: Math.floor(r.time), p_cleared: r.cleared, p_troops: Math.floor(r.troops), p_kills: Math.floor(r.kills),
    p_progress: Math.round(r.progress * 1000) / 1000, p_meters: Math.floor(r.meters), p_bosses: Math.floor(r.bosses), p_crate: Math.floor(r.crate),
  });
  const send = async (r: RunReport) => {
    const data = (await call('charge_finish', args(r))) as { profile: unknown; result: FinishResult };
    return { profile: normalize(data.profile), result: { ...data.result, newLeaders: data.result.newLeaders ?? [] } as FinishResult };
  };
  let sending: Promise<number> | null = null;
  return {
    async loadProfile() {
      return normalize(await call('charge_profile'));
    },
    async start(stage, leader, mode, day) {
      try {
        return String(await call('charge_start', { p_stage: stage, p_leader: leader, p_mode: mode, ...(mode === 'daily' && day ? { p_day: day } : {}) }));
      } catch (e) {
        if (e instanceof ApiError) throw e;
        return '';
      }
    },
    async finish(report) {
      if (!report.run) return null;
      // 보내기 전에 먼저 보관 (보내는 도중 창이 닫혀도 남게)
      writePending([...readPending().filter((r) => r.run !== report.run), report]);
      try {
        const out = await send(report);
        writePending(readPending().filter((r) => r.run !== report.run));
        return out;
      } catch (e) {
        if (e instanceof ApiError) {
          writePending(readPending().filter((r) => r.run !== report.run));
          throw e;
        }
        return null;
      }
    },
    resend() {
      sending ??= (async () => {
        let n = 0;
        for (const r of readPending()) {
          try {
            await send(r);
            n++;
            writePending(readPending().filter((x) => x.run !== r.run));
          } catch (e) {
            if (e instanceof ApiError) {
              writePending(readPending().filter((x) => x.run !== r.run));
              // 앞서 보낸 답만 못 받았던 판: 서버에는 이미 올라가 있으니 올린 것으로 센다 (프로필을 다시 읽게)
              if (e.message === 'already finished') n++;
            }
          }
        }
        return n;
      })().finally(() => (sending = null));
      return sending;
    },
    async buyUpgrade(k) {
      return normalize(await call('charge_buy_upgrade', { p_key: k }));
    },
    async stageTops(region) {
      return normalizeTops(await call('charge_stage_tops', { p_region: region }));
    },
  };
}

let api: ChargeApi | null = null;
export async function getApi(uid: string): Promise<ChargeApi> {
  if (api) return api;
  if (LOCAL_MODE) return (api = createLocalApi(safeStore()));
  return (api = createSupabaseApi(await worldSupabase(), uid, safeStore()));
}
