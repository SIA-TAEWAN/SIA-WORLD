import type { SupabaseClient } from '@supabase/supabase-js';
import { SHIPS, type ShipId } from '../data/ships';
import type { Difficulty } from '../game/sim';
import { worldSupabase } from './world';

/**
 * 서버 약속 (121_ace.sql) — 이 넷만 부른다:
 *   ace_state() → { cleared, allClear, best: {easy, normal, hard}, rushBest, endlessBest, siaCoins, admin }
 *   ace_start(p_mode, p_difficulty, p_ship, p_stage) → { run }
 *   ace_clear(p_run, p_stage) → { cleared, unlocked }                       아케이드 스테이지를 깰 때마다
 *   ace_finish(p_run, p_score, p_rank_score, p_kills, p_seconds, p_stage, p_done) → { gotCoin, siaCoins, best }
 * 스테이지 연습은 서버를 부르지 않는다 (시아코인 · 랭킹 없음, 개인 최고 기록은 이 기기에).
 * 테스트 모드(?local=1)는 같은 규칙으로 이 기기에만 (createLocalApi).
 */
export class ApiError extends Error {}

export type ServerMode = 'arcade' | 'rush' | 'endless';
export interface AceState {
  cleared: number;
  allClear: boolean;
  best: Record<Difficulty, number>;
  rushBest: number;
  endlessBest: number;
  siaCoins: number;
  admin: boolean;
}
export interface FinishArgs { score: number; rankScore: number; kills: number; seconds: number; stage: number; done: boolean }
export interface FinishResult { gotCoin: boolean; siaCoins: number; best: number }
export interface AceApi {
  state(): Promise<AceState>;
  start(mode: ServerMode, difficulty: Difficulty, ship: ShipId, stage: number): Promise<string>;
  clear(run: string, stage: number): Promise<{ cleared: number; unlocked: ShipId | null }>;
  finish(run: string, a: FinishArgs): Promise<FinishResult>;
}

/** 서버가 확인하는 한계 (121_ace.sql 의 _ace_const 와 같이 고친다 — tests/sql.test.ts) */
export const LIMITS = {
  minSecPerStage: 100, scorePerStage: 300000, bossPerStage: 50000, killsPerSec: 6, killsExtra: 60,
  rushMinSec: 90, rushMaxScore: 8000000, endlessScorePerSec: 4000, endlessScoreExtra: 100000, timeSlack: 15, catNeed: 5,
};
/** 아케이드 1 ~ n 스테이지 점수 상한 (SQL _ace_score_cap 과 같다) */
export const scoreCap = (stage: number) => {
  const n = Math.max(1, Math.min(12, stage));
  return n * LIMITS.scorePerStage + (LIMITS.bossPerStage * (n * (n + 1))) / 2;
};
/** 스테이지 n 을 처음 깨면 열리는 기체 (SQL ace_clear 의 목록과 같다) */
export const SHIP_BY_STAGE: ShipId[] = ['tiger', 'rabbit', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];

/** 서버와 같은 판 끝 검사 (테스트 모드용). 거절이면 까닭 */
export function checkFinish(mode: ServerMode, run: { firstStage: number; stageAt: number }, a: FinishArgs, elapsedSec: number): string | null {
  const L = LIMITS;
  if ([a.score, a.rankScore, a.kills, a.seconds].some(v => !Number.isInteger(v) || v < 0)) return 'bad score';
  if (a.seconds > elapsedSec + L.timeSlack) return 'too fast';
  if (a.kills > a.seconds * L.killsPerSec + L.killsExtra) return 'bad score';
  if (mode === 'arcade') {
    if (a.stage < run.firstStage || a.stage > Math.min(12, run.stageAt)) return 'bad stage';
    if (a.score > scoreCap(a.stage) || a.rankScore > scoreCap(a.stage)) return 'bad score';
  } else if (mode === 'rush') {
    if (a.score > L.rushMaxScore) return 'bad score';
    if (a.done && a.seconds < L.rushMinSec) return 'too fast';
  } else if (a.score > a.seconds * L.endlessScorePerSec + L.endlessScoreExtra) return 'bad score';
  return null;
}

// ---------- 테스트 모드 ----------
export interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void }
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
interface LocalRun { mode: ServerMode; difficulty: Difficulty; ship: ShipId; firstStage: number; stageAt: number; at: number }
interface LocalRow { state: AceState; runs: Record<string, LocalRun> }

/** all = 관리자처럼 모두 열림 (시간 검사도 건너뜀 — 테스트 모드 &all=1 · 시험 페이지) */
export function createLocalApi(store: Store, key = 'ace:local', now: () => number = Date.now, all = false): AceApi {
  const empty = (): LocalRow => ({ state: { cleared: 0, allClear: false, best: { easy: 0, normal: 0, hard: 0 }, rushBest: 0, endlessBest: 0, siaCoins: 100, admin: all }, runs: {} });
  const read = (): LocalRow => {
    try {
      const v = JSON.parse(store.getItem(key) ?? 'null');
      if (v?.state) return { runs: v.runs ?? {}, state: { ...empty().state, ...v.state, admin: all } };
    } catch { /* 처음부터 */ }
    return empty();
  };
  const write = (r: LocalRow) => { try { store.setItem(key, JSON.stringify(r)); } catch { /* 저장 못 해도 게임은 계속 */ } };
  let seq = 0;
  return {
    async state() { return read().state; },
    async start(mode, difficulty, ship, stage) {
      const r = read(), s = r.state;
      if (!all && ((mode === 'rush' && !s.allClear) || (mode === 'endless' && s.cleared < 6))) throw new ApiError('locked mode');
      const u = SHIPS[ship]?.unlock;
      if (u === undefined) throw new ApiError('bad ship');
      if (!all && typeof u === 'number' && s.cleared < u) throw new ApiError('locked ship');
      if (mode === 'arcade' && (stage < 1 || stage > 12 || (stage !== 1 && !all))) throw new ApiError('bad stage');
      const id = `local-${now()}-${seq++}`;
      r.runs = { [id]: { mode, difficulty, ship, firstStage: stage, stageAt: stage, at: now() } };
      write(r);
      return id;
    },
    async clear(run, stage) {
      const r = read(), ru = r.runs[run];
      if (!ru || ru.mode !== 'arcade') throw new ApiError('bad run');
      if (stage !== ru.stageAt) throw new ApiError('bad stage');
      if (!all && (now() - ru.at) / 1000 + LIMITS.timeSlack < (stage - ru.firstStage + 1) * LIMITS.minSecPerStage) throw new ApiError('too fast');
      ru.stageAt = stage + 1;
      let unlocked: ShipId | null = null;
      if (stage > r.state.cleared) { unlocked = SHIP_BY_STAGE[stage - 1] ?? null; r.state.cleared = stage; }
      if (stage >= 12) r.state.allClear = true;
      write(r);
      return { cleared: r.state.cleared, unlocked };
    },
    async finish(run, a) {
      const r = read(), ru = r.runs[run];
      if (!ru) throw new ApiError('bad run');
      const why = checkFinish(ru.mode, ru, a, all ? Infinity : (now() - ru.at) / 1000);
      if (why) throw new ApiError(why);
      delete r.runs[run];
      const s = r.state;
      let best = 0;
      if (ru.mode === 'arcade') best = s.best[ru.difficulty] = Math.max(s.best[ru.difficulty], a.rankScore);
      else if (ru.mode === 'rush' && a.done) best = s.rushBest = s.rushBest ? Math.min(s.rushBest, a.seconds) : a.seconds;
      else if (ru.mode === 'endless') best = s.endlessBest = Math.max(s.endlessBest, a.seconds);
      s.siaCoins++;
      write(r);
      return { gotCoin: true, siaCoins: s.siaCoins, best };
    },
  };
}

// ---------- 서버 ----------
const RPC_TIMEOUT_MS = 10_000;
interface RpcAnswer { data: unknown; error: { message: string } | null }
export interface RpcClient { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcAnswer> }
/** 서버가 일부러 거절한 까닭 (raise exception 글자) — 다시 보내도 소용없다 */
const REJECTS = ['locked mode', 'bad mode', 'locked ship', 'bad ship', 'locked character', 'bad character', 'bad stage', 'bad run', 'too fast', 'bad score', 'need login'];
const rejectOf = (msg: string) => REJECTS.find((x) => msg.includes(x)) ?? null;
const n0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function createSupabaseApi(sb: SupabaseClient | RpcClient): AceApi {
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
      const d = await call('ace_state');
      const b = (d.best ?? {}) as Record<string, unknown>;
      return {
        cleared: n0(d.cleared), allClear: d.allClear === true, best: { easy: n0(b.easy), normal: n0(b.normal), hard: n0(b.hard) },
        rushBest: n0(d.rushBest), endlessBest: n0(d.endlessBest), siaCoins: n0(d.siaCoins), admin: d.admin === true,
      };
    },
    async start(mode, difficulty, ship, stage) {
      const d = await call('ace_start', { p_mode: mode, p_difficulty: difficulty, p_ship: ship, p_stage: stage });
      if (typeof d.run !== 'string') throw new Error('no run');
      return d.run;
    },
    async clear(run, stage) {
      const d = await call('ace_clear', { p_run: run, p_stage: stage });
      return { cleared: n0(d.cleared), unlocked: typeof d.unlocked === 'string' ? (d.unlocked as ShipId) : null };
    },
    async finish(run, a) {
      const d = await call('ace_finish', { p_run: run, p_score: a.score, p_rank_score: a.rankScore, p_kills: a.kills, p_seconds: a.seconds, p_stage: a.stage, p_done: a.done });
      return { gotCoin: d.gotCoin === true, siaCoins: n0(d.siaCoins), best: n0(d.best) };
    },
  };
}

export async function getApi(local: boolean, all = false): Promise<AceApi> {
  return local ? createLocalApi(safeStore(), undefined, undefined, all) : createSupabaseApi(await worldSupabase());
}
