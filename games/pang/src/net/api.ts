import type { SupabaseClient } from '@supabase/supabase-js';
import LEVELS from '../data/levels.json';
import { worldSupabase } from './world';

/**
 * 서버 약속 (PRD 'SIA-WORLD 연동', 111_pang.sql) — 이 셋만 부른다:
 *   pang_state() → { stars: {스테이지: 별}, best: {스테이지: 최고 점수}, siaCoins, lives, nextLife, admin }
 *   pang_start(p_stage) → { run, lives, nextLife }                 ('locked stage' · 'bad stage' · 'no lives')
 *   pang_finish(p_run, p_won, p_score, p_swaps) → { stars, best, gotCoin, siaCoins, lives, nextLife, lifeBack }   ('bad run' · 'too fast' · 'bad score')
 * 목숨(113_pang_lives.sql): 최대 5개, 판 시작마다 1개, 처음 깬 스테이지면 1개 돌려받음, 20분마다 1개 참. 관리자는 줄지 않고 모든 판이 열린다.
 * 별은 서버가 점수와 스테이지 별 기준(_pang_stage_stars = src/data/levels.json 의 stars)으로 다시 계산한다.
 * 테스트 모드(?local=1)는 같은 규칙으로 이 기기에만 (createLocalApi).
 */
export class ApiError extends Error {}

export interface PangState {
  stars: Record<string, number>;
  best: Record<string, number>;
  siaCoins: number;
  /** 지금 목숨 (관리자는 줄지 않는다) */
  lives: number;
  /** 다음 목숨이 찰 때까지 초 (다 찼으면 0) */
  nextLife: number;
  admin: boolean;
}
export interface StartResult {
  run: string;
  lives: number;
  nextLife: number;
}
export interface FinishResult {
  stars: number;
  best: number;
  gotCoin: boolean;
  siaCoins: number;
  lives: number;
  nextLife: number;
  /** 처음 깬 스테이지라 목숨 1개를 돌려받았는지 */
  lifeBack: boolean;
}
export interface PangApi {
  state(): Promise<PangState>;
  /** 판 시작 → 판 번호 (결과를 보낼 때 쓴다) · 목숨 1개를 쓴다 */
  start(stage: number): Promise<StartResult>;
  /** 판 끝. 멈춤에서 나간 판은 보내지 않는다 (시아코인도 없다) */
  finish(run: string, stage: number, won: boolean, score: number, swaps: number): Promise<FinishResult>;
}

/** 서버와 같은 별 계산 (이기면 1개, 점수가 기준을 넘으면 2·3개) */
export function starsFor(stage: number, won: boolean, score: number): number {
  if (!won) return 0;
  const s = LEVELS[stage - 1]?.stars ?? [Infinity, Infinity];
  return score >= s[1] ? 3 : score >= s[0] ? 2 : 1;
}
/** 서버가 확인하는 것과 같은 한계 (111_pang.sql 의 _pang_const 와 같이 고친다 — tests/sql.test.ts) */
export const LIMITS = { maxScore: 3_000_000, secPerSwap: 0.35, extraSwaps: 40 };
/** 목숨 (113_pang_lives.sql 의 _pang_lives_const 와 같이 고친다 — tests/sql.test.ts) */
export const LIVES = { max: 5, regenSec: 1200 };

/** 시간이 지나 찬 목숨 (서버 _pang_refill 과 같다). at = 다음 목숨이 차기 시작한 때(ms, 다 찼으면 null) */
export function refill(lives: number, at: number | null, now: number): { lives: number; at: number | null; next: number } {
  if (lives >= LIVES.max) return { lives: LIVES.max, at: null, next: 0 };
  if (at == null) at = now;
  const gained = Math.floor((now - at) / 1000 / LIVES.regenSec);
  if (gained > 0) {
    lives = Math.min(LIVES.max, lives + gained);
    at = lives >= LIVES.max ? null : at + gained * LIVES.regenSec * 1000;
  }
  return { lives, at, next: at == null ? 0 : Math.max(1, Math.ceil(LIVES.regenSec - (now - at) / 1000)) };
}

export function checkFinish(stage: number, score: number, swaps: number, elapsedSec: number): string | null {
  const L = LEVELS[stage - 1];
  if (!L) return 'bad run';
  if (!(Number.isInteger(score) && score >= 0 && score <= LIMITS.maxScore)) return 'bad score';
  if (!(Number.isInteger(swaps) && swaps >= 1 && swaps <= L.moves + LIMITS.extraSwaps)) return 'bad score';
  if (elapsedSec < swaps * LIMITS.secPerSwap) return 'too fast';
  return null;
}

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const memory = new Map<string, string>();
export const safeStore = (): Store => {
  try {
    localStorage.setItem('__p', '1');
    localStorage.removeItem('__p');
    return localStorage;
  } catch {
    return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };
  }
};

// ---------- 테스트 모드 ----------
interface LocalRow {
  stars: Record<string, number>;
  best: Record<string, number>;
  siaCoins: number;
  runs: Record<string, { stage: number; at: number }>;
  lives: number;
  livesAt: number | null;
}
/** admin = 관리자처럼 (목숨이 줄지 않고 모든 판이 열린다 — 테스트 모드 &admin=1) */
export function createLocalApi(store: Store, key = 'siapang:local', now: () => number = Date.now, admin = false): PangApi {
  const read = (): LocalRow => {
    try {
      const v = JSON.parse(store.getItem(key) ?? 'null');
      if (v && typeof v === 'object') return { stars: v.stars ?? {}, best: v.best ?? {}, siaCoins: Number(v.siaCoins) || 0, runs: v.runs ?? {}, lives: Number.isFinite(v.lives) ? v.lives : LIVES.max, livesAt: Number.isFinite(v.livesAt) ? v.livesAt : null };
    } catch {
      /* 깨진 기록은 처음부터 */
    }
    return { stars: {}, best: {}, siaCoins: 100, runs: {}, lives: LIVES.max, livesAt: null };
  };
  const write = (r: LocalRow) => {
    try {
      store.setItem(key, JSON.stringify(r));
    } catch {
      /* 저장하지 못해도 게임은 계속 */
    }
  };
  const open = (r: LocalRow) => { let n = 1; while (n <= 100 && r.stars[n]) n++; return n; };
  const fill = (r: LocalRow) => { const f = refill(r.lives, r.livesAt, now()); r.lives = f.lives; r.livesAt = f.at; return f.next; };
  let seq = 0;
  return {
    async state() {
      const r = read();
      const next = fill(r);
      write(r);
      return { stars: r.stars, best: r.best, siaCoins: r.siaCoins, lives: r.lives, nextLife: next, admin };
    },
    async start(stage) {
      const r = read();
      if (!(Number.isInteger(stage) && stage >= 1 && stage <= 100)) throw new ApiError('bad stage');
      const all = admin || (typeof location !== 'undefined' && /[?&]all=1\b/.test(location.search));
      if (!all && stage > open(r)) throw new ApiError('locked stage');
      let next = fill(r);
      if (!admin) {
        if (r.lives < 1) throw new ApiError('no lives');
        r.lives--;
        if (r.livesAt == null) { r.livesAt = now(); next = LIVES.regenSec; }
      }
      const id = `local-${now()}-${seq++}`;
      r.runs = { [id]: { stage, at: now() } };
      write(r);
      return { run: id, lives: r.lives, nextLife: next };
    },
    async finish(run, stage, won, score, swaps) {
      const r = read();
      const ru = r.runs[run];
      if (!ru || ru.stage !== stage) throw new ApiError('bad run');
      const why = checkFinish(stage, score, swaps, (now() - ru.at) / 1000);
      if (why) throw new ApiError(why);
      delete r.runs[run];
      const st = starsFor(stage, won, score);
      const lifeBack = st > 0 && !r.stars[stage];
      if (lifeBack) { r.lives = Math.min(LIVES.max, r.lives + 1); if (r.lives >= LIVES.max) r.livesAt = null; }
      const next = fill(r);
      if (st) {
        r.stars[stage] = Math.max(r.stars[stage] ?? 0, st);
        r.best[stage] = Math.max(r.best[stage] ?? 0, score);
      }
      r.siaCoins++;
      write(r);
      return { stars: r.stars[stage] ?? 0, best: r.best[stage] ?? 0, gotCoin: true, siaCoins: r.siaCoins, lives: r.lives, nextLife: next, lifeBack };
    },
  };
}

// ---------- 서버 ----------
const RPC_TIMEOUT_MS = 10_000;
interface RpcAnswer {
  data: unknown;
  error: { message: string } | null;
}
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcAnswer>;
}
/** 서버가 일부러 거절한 까닭 (raise exception 글자) — 다시 보내도 소용없다 */
const REJECTS = ['no lives', 'locked stage', 'bad stage', 'bad run', 'too fast', 'bad score', 'need login'];
const rejectOf = (msg: string) => REJECTS.find((x) => msg.includes(x)) ?? null;
const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (Number.isFinite(Number(n))) out[k] = Number(n);
  return out;
};

const num = (v: unknown, d: number) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export function createSupabaseApi(sb: SupabaseClient | RpcClient): PangApi {
  const call = async (fn: string, args?: Record<string, unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<RpcAnswer>((_, rej) => (timer = setTimeout(() => rej(new Error('timeout')), RPC_TIMEOUT_MS)));
    try {
      const res = await Promise.race([Promise.resolve((sb as RpcClient).rpc(fn, args)), timeout]);
      if (res.error) {
        const why = rejectOf(res.error.message);
        throw why ? new ApiError(why) : new Error(res.error.message);
      }
      return (res.data ?? {}) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async state() {
      const d = await call('pang_state');
      return { stars: numMap(d.stars), best: numMap(d.best), siaCoins: Number(d.siaCoins) || 0, lives: num(d.lives, LIVES.max), nextLife: num(d.nextLife, 0), admin: d.admin === true };
    },
    async start(stage) {
      const d = await call('pang_start', { p_stage: stage });
      if (typeof d.run !== 'string') throw new Error('no run');
      return { run: d.run, lives: num(d.lives, 0), nextLife: num(d.nextLife, 0) };
    },
    async finish(run, _stage, won, score, swaps) {
      const d = await call('pang_finish', { p_run: run, p_won: won, p_score: score, p_swaps: swaps });
      return { stars: Number(d.stars) || 0, best: Number(d.best) || 0, gotCoin: !!d.gotCoin, siaCoins: Number(d.siaCoins) || 0, lives: num(d.lives, 0), nextLife: num(d.nextLife, 0), lifeBack: d.lifeBack === true };
    },
  };
}

export async function getApi(local: boolean): Promise<PangApi> {
  return local ? createLocalApi(safeStore(), undefined, undefined, /[?&]admin=1\b/.test(location.search)) : createSupabaseApi(await worldSupabase());
}
