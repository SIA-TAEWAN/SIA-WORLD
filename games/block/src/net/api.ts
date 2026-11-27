import type { SupabaseClient } from '@supabase/supabase-js';
import { VerifyError, verifyRun, type Move } from '../rules.ts';
import { worldSupabase } from './world.ts';

/**
 * 서버 약속 (PRD 8, 122_block.sql · block-finish):
 *   block_state() → { best, bestAt, weekBest, siaCoins, weekTop: { name, score } | null }
 *   block_start() → { run, seed }
 *   block-finish (Edge Function) { rules, runId, log, score } → FinishResult
 *     서버가 시드부터 놓기 기록을 다시 돌려 점수를 정한다. 기기 점수와 다르면 랭킹에 넣지 않는다 (verified false).
 * 제출에 실패하면(통신 · 서버 문제) 기기에 보관했다가 다음에 다시 보낸다. 서버가 거절한 판(4xx)은 버린다.
 * 테스트 모드(?local=1)는 같은 규칙으로 이 기기에만 (createLocalApi).
 */
export class ApiError extends Error {}

export interface WeekTop { name: string; score: number }
export interface BlockInfo {
  best: number;
  bestAt: string | null;
  weekBest: number;
  siaCoins: number;
  /** 이번 주 1등 (아직 없으면 null) */
  weekTop: WeekTop | null;
}
export interface StartResult { run: string; seed: number }
export interface FinishResult {
  /** 서버가 다시 돌려 얻은 점수 */
  score: number;
  /** 기기가 보낸 점수와 같았나 (다르면 랭킹 · 최고 점수에 안 들어감) */
  verified: boolean;
  best: number;
  weekBest: number;
  newBest: boolean;
  /** 전체 · 이번 주 순위 (기록이 없으면 null) */
  rank: number | null;
  weekRank: number | null;
  gotCoin: boolean;
  siaCoins: number;
}
export interface RunReport { run: string; seed: number; log: Move[]; score: number; rules: number }
export interface BlockApi {
  state(): Promise<BlockInfo>;
  start(): Promise<StartResult>;
  /** 끝난 판 보내기. 보내지 못하면 보관하고 null */
  finish(report: RunReport): Promise<FinishResult | null>;
  /** 보관한 판 다시 보내기 → 보낸 수 */
  flush(): Promise<number>;
}

export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** 상식 검사: 놓은 횟수 × 0.3초보다 빨리 끝낼 수 없다 (서버 122_block.sql 의 _block_const 와 같이 고친다 — tests/sql.test.ts) */
export const LIMITS = { secPerMove: 0.3, maxHours: 24 } as const;

/** 이번 주 (월요일 시작, 한국 시간) 첫날 'YYYY-MM-DD' */
export function weekOf(ms: number): string {
  const k = new Date(ms + 9 * 3600_000);
  const dow = (k.getUTCDay() + 6) % 7;
  const mon = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - dow));
  return mon.toISOString().slice(0, 10);
}

// ---------- 테스트 모드 (이 기기에만) ----------

export function createLocalApi(store: Store, key = 'siablock:local', now: () => number = Date.now, seedOf?: () => number): BlockApi {
  type Save = { best: number; bestAt: string | null; week: string; weekBest: number; coins: number; runs: Record<string, { seed: number; at: number }> };
  const load = (): Save => {
    try {
      const v = JSON.parse(store.getItem(key) ?? 'null');
      if (v && typeof v === 'object') return { best: 0, bestAt: null, week: '', weekBest: 0, coins: 0, runs: {}, ...v };
    } catch { /* 새로 */ }
    return { best: 0, bestAt: null, week: '', weekBest: 0, coins: 0, runs: {} };
  };
  const save = (s: Save) => { try { store.setItem(key, JSON.stringify(s)); } catch { /* 저장 못 해도 계속 */ } };
  const thisWeek = (s: Save) => { const w = weekOf(now()); if (s.week !== w) { s.week = w; s.weekBest = 0; } return s; };
  return {
    async state() {
      const s = thisWeek(load());
      return { best: s.best, bestAt: s.bestAt, weekBest: s.weekBest, siaCoins: s.coins, weekTop: s.weekBest ? { name: '나', score: s.weekBest } : null };
    },
    async start() {
      const s = load();
      const run = 'local-' + now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
      const seed = seedOf ? seedOf() : Math.floor(Math.random() * 2 ** 31);
      s.runs = { [run]: { seed, at: now() } };
      save(s);
      return { run, seed };
    },
    async finish(r) {
      const s = thisWeek(load());
      const meta = s.runs[r.run];
      if (!meta) throw new ApiError('no run');
      delete s.runs[r.run];
      let v;
      try { v = verifyRun(meta.seed, r.log); } catch (e) { save(s); throw e instanceof VerifyError ? new ApiError(e.message) : e; }
      if ((now() - meta.at) / 1000 < v.moves * LIMITS.secPerMove) { save(s); throw new ApiError('too fast'); }
      const verified = v.score === r.score;
      const newBest = verified && v.score > s.best;
      if (newBest) { s.best = v.score; s.bestAt = new Date(now()).toISOString(); }
      if (verified && v.score > s.weekBest) s.weekBest = v.score;
      s.coins += 1;
      save(s);
      return { score: v.score, verified, best: s.best, weekBest: s.weekBest, newBest, rank: s.best ? 1 : null, weekRank: s.weekBest ? 1 : null, gotCoin: true, siaCoins: s.coins };
    },
    async flush() { return 0; },
  };
}

// ---------- 서버 ----------

const PENDING_MAX = 5;
const RPC_TIMEOUT_MS = 10_000;
const FN_TIMEOUT_MS = 20_000;

interface Answer {
  data: unknown;
  error: { message: string; context?: { status?: number; json?: () => Promise<unknown> } } | null;
}
/** 시험에서 흉내 낼 수 있는 만큼만 (SupabaseClient 도 맞는다) */
export interface ServerClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Answer>;
  functions: { invoke(name: string, opts: { body: unknown }): Promise<Answer> };
}

/** 서버가 일부러 거절한 까닭 — 다시 보내도 소용없다 */
const REJECTS = ['already finished', 'too fast', 'too late', 'no run', 'old rules', 'not over', 'bad '];
export const rejectOf = (msg: string): string | null => {
  const w = REJECTS.find(x => msg.includes(x));
  return w ? (w === 'bad ' ? (msg.match(/bad \w+/)?.[0] ?? 'bad log') : w) : null;
};

const withTimeout = <T>(p: PromiseLike<T>, ms: number) =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const numOrNull = (v: unknown) => (v == null ? null : num(v));

export function normalizeInfo(d: unknown): BlockInfo {
  const o = (d ?? {}) as Record<string, unknown>;
  const t = o.weekTop as Record<string, unknown> | null | undefined;
  return {
    best: num(o.best), bestAt: typeof o.bestAt === 'string' ? o.bestAt : null, weekBest: num(o.weekBest), siaCoins: num(o.siaCoins),
    weekTop: t && num(t.score) > 0 ? { name: String(t.name ?? ''), score: num(t.score) } : null,
  };
}
export function normalizeFinish(d: unknown): FinishResult {
  const o = (d ?? {}) as Record<string, unknown>;
  return {
    score: num(o.score), verified: o.verified !== false, best: num(o.best), weekBest: num(o.weekBest), newBest: !!o.newBest,
    rank: numOrNull(o.rank), weekRank: numOrNull(o.weekRank), gotCoin: !!o.gotCoin, siaCoins: num(o.siaCoins),
  };
}

export function createSupabaseApi(sb: SupabaseClient | ServerClient, uid: string, store: Store): BlockApi {
  const c = sb as unknown as ServerClient;
  const pKey = `siablock:pending:${uid}`;
  const readPending = (): RunReport[] => {
    try {
      const v = JSON.parse(store.getItem(pKey) ?? '[]');
      return Array.isArray(v) ? v.filter(r => r && typeof r.run === 'string' && r.run && Array.isArray(r.log)) : [];
    } catch { return []; }
  };
  const writePending = (list: RunReport[]) => {
    try {
      if (!list.length) store.removeItem(pKey);
      else store.setItem(pKey, JSON.stringify(list.slice(-PENDING_MAX)));
    } catch { /* 보관하지 못해도 게임은 계속 */ }
  };
  const drop = (run: string) => writePending(readPending().filter(x => x.run !== run));
  const call = async (fn: string, args?: Record<string, unknown>) => {
    const res = await withTimeout(c.rpc(fn, args), RPC_TIMEOUT_MS);
    if (res.error) {
      const why = rejectOf(res.error.message);
      throw why ? new ApiError(why) : new Error(res.error.message);
    }
    return res.data;
  };
  const send = async (r: RunReport): Promise<FinishResult> => {
    const res = await withTimeout(c.functions.invoke('block-finish', { body: { runId: r.run, log: r.log, score: r.score, rules: r.rules } }), FN_TIMEOUT_MS);
    if (res.error) {
      const status = res.error.context?.status;
      let msg = res.error.message;
      try {
        const j = (await res.error.context?.json?.()) as { error?: string } | undefined;
        if (j?.error) msg = j.error;
      } catch { /* 그대로 */ }
      // 401(로그인 만료 · 'need login')은 다시 로그인한 뒤 보낼 수 있게 보관한다
      const why = status && status < 500 && status !== 401 ? rejectOf(msg) ?? 'bad log' : null;
      throw why ? new ApiError(why) : new Error(msg);
    }
    return normalizeFinish(res.data);
  };
  let sending: Promise<number> | null = null;
  /** 지금 finish 가 보내는 중인 판 (flush 가 같은 판을 또 보내지 않게) */
  const inflight = new Set<string>();
  const api: BlockApi = {
    async state() { return normalizeInfo(await call('block_state')); },
    async start() {
      const d = (await call('block_start')) as Record<string, unknown>;
      const run = String(d?.run ?? '');
      if (!run) throw new Error('no run');
      return { run, seed: num(d.seed) };
    },
    async finish(report) {
      writePending([...readPending().filter(r => r.run !== report.run), report]);
      inflight.add(report.run);
      try {
        const out = await send(report);
        drop(report.run);
        return out;
      } catch (e) {
        if (e instanceof ApiError) { drop(report.run); throw e; }
        return null;
      } finally {
        inflight.delete(report.run);
      }
    },
    flush() {
      sending ??= (async () => {
        let n = 0;
        for (const r of readPending()) {
          if (inflight.has(r.run)) continue;
          try { await send(r); drop(r.run); n++; } catch (e) { if (e instanceof ApiError) drop(r.run); else break; }
        }
        return n;
      })().finally(() => { sending = null; });
      return sending;
    },
  };
  return api;
}

export async function getApi(local: boolean, uid: string | null, seed: number | null): Promise<BlockApi> {
  const store: Store = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem() {}, removeItem() {} };
  if (local || !uid) return createLocalApi(store, 'siablock:local', Date.now, seed != null ? () => seed : undefined);
  return createSupabaseApi(await worldSupabase(), uid, store);
}
