/**
 * 시아카드배틀 서버 연결 (112_card.sql · Edge Function card-finish).
 *  - state(): 진행 중인 판(서버가 확인한 입력 기록 포함) · 영웅별 숙련·클리어 · 끝없는 최고
 *  - start(): 판 시작 → 판 번호·씨앗 (보통·끝없는 판의 씨앗은 서버가 정한다)
 *  - upload(): 막이 끝날 때 · 판이 끝날 때 판 처음부터의 입력 기록을 보낸다. 보내기 전에 기기에 보관하고,
 *    통신 실패·서버 오류(5xx)면 보관한 채로 두었다가 flush() 때 다시 보낸다. 서버가 거절(4xx)하면 버린다 (친목용: 더 막지 않는다).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { RULES_VERSION, type Input, type RunMode } from '../game/rules';

export interface ServerRun {
  runId: string;
  mode: RunMode;
  hero: string;
  mastery: number;
  seed: number;
  rules: number;
  day: string | null;
  firstOfDay: boolean;
  log: Input[];
  acts: number;
  floors: number;
  coins: number;
  /** 시작 엽전 (null = 기본 99 · 관리자 계정의 보통·끝없는 판은 10000) — 다시 돌릴 때 newRun 에 넘긴다 */
  startGold?: number | null;
  /** card_start: 앞 판들에서 못 받은 막 코인을 이번에 받은 수 */
  paidCoins?: number;
}
export interface HeroProgress {
  mastery: number;
  best: number;
  clears: number;
}
export interface CardState {
  rules: number;
  masteryOpen: number;
  runs: Partial<Record<RunMode, ServerRun>>;
  heroes: Record<string, HeroProgress>;
  clears: number;
  endless: { floors: number; acts: number; hero: string } | null;
  today: string;
  dailyPlayed: boolean;
}
export interface FinishResult {
  mode: RunMode;
  acts: number;
  floors: number;
  over: boolean;
  cleared: boolean;
  newCoins: number;
  coins: number;
  mastery: number;
  daily: { recorded: boolean; score: number; best?: number; improved?: boolean } | null;
  endless: { floors: number; best: number; improved: boolean } | null;
}

/** 서버가 일부러 거절한 것 (다시 보내도 소용없다) */
export class ApiError extends Error {}

/** 테스트에서 흉내 낼 수 있는 만큼만 (SupabaseClient 도 맞는다) */
interface Answer {
  data: unknown;
  error: { message: string; context?: { status?: number; json?: () => Promise<unknown> } } | null;
}
export interface ServerClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Answer>;
  functions: { invoke(name: string, opts: { body: unknown }): Promise<Answer> };
}
export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const RPC_TIMEOUT_MS = 10_000;
const FN_TIMEOUT_MS = 20_000;
/** 서버의 raise 글자 중 거절 (화면 문구는 friendly) */
const REJECTS = ['locked character', 'bad character', 'bad mastery', 'bad mode', 'bad day', 'bad seed', 'need login', 'already finished', 'stale', 'old rules', 'no run', 'bad log', 'bad result', 'bad daily', 'bad run'];
export const rejectOf = (msg: string) => REJECTS.find((w) => msg.includes(w)) ?? null;

const withTimeout = <T>(p: PromiseLike<T>, ms: number) =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** 화면에 띄울 말 */
export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes('locked character')) return '고양이는 영웅 고르기에서 시아코인 100으로 열 수 있어요';
  if (m.includes('bad mastery')) return '아직 열리지 않은 숙련 단계예요';
  if (m.includes('bad day')) return '날짜가 바뀌었어요. 처음 화면에서 다시 시작해 주세요';
  if (m.includes('need login')) return '로그인이 필요해요';
  if (m.includes('old rules')) return '게임이 새 버전으로 바뀌었어요. 새로 고침해 주세요';
  return '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요';
}

interface Pending {
  runId: string;
  rules: number;
  log: Input[];
}

export interface CardApi {
  state(): Promise<CardState>;
  start(mode: RunMode, hero: string, mastery: number, day?: string | null, seed?: number | null): Promise<ServerRun>;
  /** 보내고 결과 (보관만 하고 못 보냈으면 null, 거절이면 ApiError) */
  upload(runId: string, log: Input[]): Promise<FinishResult | null>;
  /** 보관한 업로드를 다시 보낸다 → 보낸 개수 */
  flush(): Promise<number>;
  /** 이 판의 업로드가 아직 보관 중인지 */
  pending(runId: string): boolean;
}

const asNum = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
function normRun(x: unknown): ServerRun | null {
  const r = x as Record<string, unknown> | null;
  if (!r || typeof r.runId !== 'string') return null;
  return {
    runId: r.runId,
    mode: (['normal', 'endless', 'daily'].includes(String(r.mode)) ? r.mode : 'normal') as RunMode,
    hero: String(r.hero ?? 'tiger'),
    mastery: asNum(r.mastery),
    seed: asNum(r.seed) >>> 0,
    rules: asNum(r.rules),
    day: typeof r.day === 'string' ? r.day : null,
    firstOfDay: r.firstOfDay === true,
    log: Array.isArray(r.log) ? (r.log as Input[]) : [],
    acts: asNum(r.acts),
    floors: asNum(r.floors),
    coins: asNum(r.coins),
    ...(r.startGold != null && Number.isFinite(Number(r.startGold)) ? { startGold: asNum(r.startGold) } : {}),
    ...(r.paidCoins !== undefined ? { paidCoins: asNum(r.paidCoins) } : {}),
  };
}
export function normState(x: unknown): CardState {
  const s = (x ?? {}) as Record<string, unknown>;
  const runs: CardState['runs'] = {};
  for (const [k, v] of Object.entries((s.runs ?? {}) as Record<string, unknown>)) {
    const r = normRun(v);
    if (r) runs[k as RunMode] = r;
  }
  const heroes: Record<string, HeroProgress> = {};
  for (const [k, v] of Object.entries((s.heroes ?? {}) as Record<string, Record<string, unknown>>)) {
    heroes[k] = { mastery: asNum(v?.mastery), best: asNum(v?.best, -1), clears: asNum(v?.clears) };
  }
  const e = s.endless as Record<string, unknown> | null;
  return {
    rules: asNum(s.rules),
    masteryOpen: asNum(s.masteryOpen, 5),
    runs,
    heroes,
    clears: asNum(s.clears),
    endless: e ? { floors: asNum(e.floors), acts: asNum(e.acts), hero: String(e.hero ?? 'tiger') } : null,
    today: typeof s.today === 'string' ? s.today : '',
    dailyPlayed: s.dailyPlayed === true,
  };
}

export function createApi(sb: SupabaseClient | ServerClient, uid: string, store: Store): CardApi {
  const c = sb as unknown as ServerClient;
  const key = `siacard:pending:${uid}`;
  const read = (): Pending[] => {
    try {
      const v = JSON.parse(store.getItem(key) ?? '[]');
      return Array.isArray(v) ? v.filter((p) => p && typeof p.runId === 'string' && Array.isArray(p.log)) : [];
    } catch {
      return [];
    }
  };
  const write = (list: Pending[]) => {
    try {
      if (!list.length) store.removeItem(key);
      else store.setItem(key, JSON.stringify(list.slice(-4)));
    } catch {
      /* 보관하지 못해도 게임은 계속 */
    }
  };
  /** 같은 판은 가장 긴(최근) 기록 하나만 */
  const keep = (p: Pending) => write([...read().filter((x) => x.runId !== p.runId), p]);
  const drop = (p: Pending) => write(read().filter((x) => !(x.runId === p.runId && x.log.length <= p.log.length)));
  const call = async (fn: string, args?: Record<string, unknown>) => {
    const res = await withTimeout(c.rpc(fn, args), RPC_TIMEOUT_MS);
    if (res.error) {
      const why = rejectOf(res.error.message);
      throw why ? new ApiError(why) : new Error(res.error.message);
    }
    return res.data;
  };
  const send = async (p: Pending): Promise<FinishResult> => {
    const res = await withTimeout(c.functions.invoke('card-finish', { body: { runId: p.runId, log: p.log, rules: p.rules } }), FN_TIMEOUT_MS);
    if (res.error) {
      const status = res.error.context?.status;
      let msg = res.error.message;
      try {
        const j = (await res.error.context?.json?.()) as { error?: string } | undefined;
        if (j?.error) msg = j.error;
      } catch {
        /* 그대로 */
      }
      const why = status && status < 500 ? (rejectOf(msg) ?? 'rejected') : null;
      throw why ? new ApiError(why) : new Error(msg);
    }
    return (res.data as { result: FinishResult }).result;
  };
  let chain: Promise<unknown> = Promise.resolve();
  /** 한 번에 하나씩 보낸다 (앞 막 기록이 뒤 막보다 늦게 닿지 않게) */
  const queued = <T>(f: () => Promise<T>): Promise<T> => {
    const p = chain.then(f, f);
    chain = p.catch(() => null);
    return p;
  };
  const sendOne = async (p: Pending): Promise<FinishResult | null> => {
    try {
      const r = await send(p);
      drop(p);
      return r;
    } catch (e) {
      if (e instanceof ApiError) {
        drop(p);
        throw e;
      }
      return null;
    }
  };
  return {
    async state() {
      return normState(await call('card_state'));
    },
    async start(mode, hero, mastery, day = null, seed = null) {
      const r = normRun(await call('card_start', { p_mode: mode, p_hero: hero, p_mastery: mastery, p_day: day, p_seed: seed }));
      if (!r) throw new Error('bad answer');
      return r;
    },
    upload(runId, log) {
      const p: Pending = { runId, rules: RULES_VERSION, log: log.slice() };
      keep(p);
      return queued(() => sendOne(p));
    },
    flush() {
      return queued(async () => {
        let n = 0;
        for (const p of read()) {
          try {
            if (await sendOne(p)) n++;
          } catch {
            /* 거절은 버렸다 */
          }
        }
        return n;
      });
    },
    pending(runId) {
      return read().some((p) => p.runId === runId);
    },
  };
}
