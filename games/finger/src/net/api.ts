import type { SupabaseClient } from '@supabase/supabase-js';
import { EXTRA_HERO_IDS, isExtraHero, verifyRun, VerifyError, type HeroId, type RunResult, type RunSnapshot, type ShotInput, type UpgradeKey } from '../sim';
import {
  applyResult,
  buyUpgrade,
  checkStart,
  emptyProfile,
  levelUp,
  normalize,
  snapshotOf,
  CAT_PRICE,
  catProgress,
  type UnlockAnswer,
  type FingerProfile,
  type FinishResult,
} from '../game/progress';
import { DEV_CAT_COND, DEV_CAT_LOCKED, LOCAL_MODE } from './local';
import { worldSupabase } from './world';

/**
 * 기록 저장 (PRD "서버와 검증"): 판을 시작할 때 finger_start, 끝나면 조작 목록만 Edge Function finger-finish 로 보낸다.
 * 서버가 같은 시뮬레이션으로 다시 돌려 결과를 계산하고 finger_finish_verified 로 저장한다.
 * 못 보낸 결과는 기기에 5판까지 보관했다가 다음에 다시 보낸다 (돌격대 net/api.ts 와 같은 방식).
 * 테스트 모드(?local=1)는 같은 규칙(src/game/progress.ts + verifyRun)으로 이 기기에만 저장한다.
 */

export class ApiError extends Error {}

/** 판 하나의 보고: 판 번호와 조작 목록뿐 (결과 값은 서버가 계산한다) */
export interface RunReport {
  /** finger_start 가 준 판 번호 (기록되지 않는 판은 '') */
  run: string;
  stage: string;
  inputs: ShotInput[];
  /** 판을 둔 화면의 규칙 판 번호 (FINGER_RULES). 예전에 보관한 판은 없음 → 서버가 'old rules' 로 거절 */
  rules?: number;
}

export interface FinishAnswer {
  profile: FingerProfile;
  result: FinishResult;
  /** 서버가 다시 돌린 결과 (테스트 모드는 기기에서 다시 돌린 결과) */
  replay: RunResult | null;
}

export interface FingerApi {
  loadProfile(): Promise<FingerProfile>;
  /** 판 시작 → 판 번호 (서버가 거절하면 ApiError, 통신 실패면 '' = 기록되지 않는 판) */
  start(stage: string, party: HeroId[], mode?: 'normal' | 'tower'): Promise<string>;
  /** 판 결과 → 새 프로필과 결과 (통신 실패면 null: 보관했다가 다시 보낸다) */
  finish(report: RunReport): Promise<FinishAnswer | null>;
  /** 보관해 둔 결과 다시 보내기 → 올라간 판 수 */
  resend(): Promise<number>;
  buyUpgrade(key: UpgradeKey): Promise<FingerProfile>;
  levelUp(hero: HeroId): Promise<FingerProfile>;
  /** 추가 대원(고양이)을 시아코인으로 열기 — 시아핑거에서만 열린다 (071 buy_character(game, id)). 성공·이미 연 경우면 새 프로필도 */
  unlock(hero: HeroId): Promise<{ answer: UnlockAnswer; profile: FingerProfile | null }>;
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

// ---------- 테스트 모드: 이 기기에만 ----------

/** owned = 테스트 모드에서 연 것으로 볼 추가 대원 (기본: 모두. ?local=1&cat=0 이면 없음) */
export function createLocalApi(store: Store, key = 'siafinger:profile:local', ownedAtStart: readonly HeroId[] = EXTRA_HERO_IDS, catReadyAs?: boolean): FingerApi {
  // 테스트 모드의 '연 대원' (서버 없이 흉내: 열기 버튼을 누르면 바로 열린다. 새로고침하면 ?cat= 대로 처음부터)
  const owned: HeroId[] = [...ownedAtStart];
  const load = () => {
    let p: FingerProfile;
    try {
      p = normalize(JSON.parse(store.getItem(key) ?? 'null'));
    } catch {
      p = emptyProfile();
    }
    p.owned = [...owned];
    // 구매 조건: 지정하지 않으면 실제 기록(3-5 클리어)으로 본다
    if (catReadyAs !== undefined) p.catReady = catReadyAs;
    return p;
  };
  const save = (p: FingerProfile) => store.setItem(key, JSON.stringify(p));
  /** 판 번호 → 시작 때 스냅숏 (서버의 finger_runs 대신) */
  const runs = new Map<string, RunSnapshot>();
  let n = 0;
  return {
    async loadProfile() {
      return load();
    },
    async start(stage, party, mode = 'normal') {
      const p = load();
      const why = checkStart(p, stage, party, mode);
      if (why) throw new ApiError(why);
      const id = `local-${Date.now()}-${n++}`;
      runs.set(id, snapshotOf(p, stage, party, mode));
      return id;
    },
    async finish(report) {
      const snap = runs.get(report.run);
      if (!snap) throw new ApiError('no run');
      runs.delete(report.run);
      let replay: RunResult;
      try {
        replay = verifyRun(snap, report.inputs);
      } catch (e) {
        if (e instanceof VerifyError) throw new ApiError(e.message);
        throw e;
      }
      const p = load();
      const result = applyResult(p, snap.stage, replay, snap.upgrades);
      save(p);
      return { profile: p, result, replay };
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
    async levelUp(id) {
      const p = load();
      const why = levelUp(p, id);
      if (why) throw new ApiError(why);
      save(p);
      return p;
    },
    async unlock(id) {
      if (!isExtraHero(id)) return { answer: { ok: false, reason: 'error' }, profile: null };
      if (owned.includes(id)) return { answer: { ok: false, reason: 'owned', price: CAT_PRICE }, profile: load() };
      const prog = catProgress(load());
      if (prog.have < prog.need) return { answer: { ok: false, reason: 'condition', price: CAT_PRICE, ...prog }, profile: load() };
      owned.push(id);
      return { answer: { ok: true, price: CAT_PRICE }, profile: load() };
    },
  };
}

// ---------- 서버 ----------

const PENDING_MAX = 5;
const RPC_TIMEOUT_MS = 10_000;
const FN_TIMEOUT_MS = 15_000;

interface Answer {
  data: unknown;
  error: { message: string; context?: { status?: number; json?: () => Promise<unknown> } } | null;
}

/** 테스트에서 흉내 낼 수 있는 만큼만 (SupabaseClient 도 맞는다) */
export interface ServerClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Answer>;
  functions: { invoke(name: string, opts: { body: unknown }): Promise<Answer> };
}

/** 서버가 일부러 거절한 까닭 (raise exception · Edge Function error 글자) — 다시 보내도 소용없다 */
const REJECTS = [
  'stage locked', 'tower locked', 'hero locked', 'locked character', 'not enough coins', 'max level', 'already finished', 'too early', 'too late', 'overlap', 'no run', 'need login', 'old rules',
  'extra inputs', 'too many turns', 'bad ',
];
/** 거절이면 까닭, 아니면(통신 문제) null */
export const rejectOf = (msg: string) => {
  const w = REJECTS.find((x) => msg.includes(x));
  return w ? (w === 'bad ' ? (msg.match(/bad \w+/)?.[0] ?? 'bad result') : w) : null;
};

const withTimeout = <T>(p: PromiseLike<T>, ms: number) =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export function createSupabaseApi(sb: SupabaseClient | ServerClient, uid: string, store: Store): FingerApi {
  const c = sb as unknown as ServerClient;
  const pKey = `siafinger:pending:${uid}`;
  const readPending = (): RunReport[] => {
    try {
      const v = JSON.parse(store.getItem(pKey) ?? '[]');
      return Array.isArray(v) ? v.filter((r) => r && typeof r.run === 'string' && r.run && Array.isArray(r.inputs)) : [];
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
    const res = await withTimeout(c.rpc(fn, args), RPC_TIMEOUT_MS);
    if (res.error) {
      const why = rejectOf(res.error.message);
      throw why ? new ApiError(why) : new Error(res.error.message);
    }
    return res.data;
  };
  /** finger-finish 호출. 서버가 답한 거절(4xx)은 ApiError, 통신 실패·서버 오류는 Error */
  const send = async (r: RunReport): Promise<FinishAnswer> => {
    const res = await withTimeout(c.functions.invoke('finger-finish', { body: { runId: r.run, inputs: r.inputs, rules: r.rules ?? 0 } }), FN_TIMEOUT_MS);
    if (res.error) {
      const status = res.error.context?.status;
      let msg = res.error.message;
      try {
        const j = (await res.error.context?.json?.()) as { error?: string } | undefined;
        if (j?.error) msg = j.error;
      } catch {
        /* 그대로 */
      }
      const why = status && status < 500 ? rejectOf(msg) : null;
      throw why ? new ApiError(why) : new Error(msg);
    }
    const data = res.data as { profile: unknown; result: FinishResult; replay?: RunResult };
    return { profile: normalize(data.profile), result: { ...data.result, newHeroes: data.result.newHeroes ?? [] }, replay: data.replay ?? null };
  };
  const drop = (run: string) => writePending(readPending().filter((x) => x.run !== run));
  let sending: Promise<number> | null = null;
  return {
    async unlock(id) {
      let answer: UnlockAnswer;
      try {
        const res = await withTimeout(c.rpc('buy_character', { p_game: 'finger', p_id: id }), RPC_TIMEOUT_MS);
        if (res.error) answer = { ok: false, reason: /need login|permission denied|JWT/i.test(res.error.message) ? 'login' : 'error' };
        else answer = (res.data as UnlockAnswer) ?? { ok: false, reason: 'error' };
      } catch {
        answer = { ok: false, reason: 'error' };
      }
      // 조건 미달이면 진행(스테이지 기록)을 다시 받아 안내를 고친다
      if (!answer.ok && answer.reason !== 'owned' && answer.reason !== 'condition') return { answer, profile: null };
      const profile = await call('finger_profile').then(normalize).catch(() => null);
      return { answer, profile };
    },
    async loadProfile() {
      return normalize(await call('finger_profile'));
    },
    async start(stage, party, mode = 'normal') {
      try {
        return String(await call('finger_start', { p_stage: mode === 'tower' ? 'tower' : stage, p_party: party, p_mode: mode }));
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
        drop(report.run);
        return out;
      } catch (e) {
        if (e instanceof ApiError) {
          drop(report.run);
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
            drop(r.run);
          } catch (e) {
            if (e instanceof ApiError) drop(r.run);
          }
        }
        return n;
      })().finally(() => (sending = null));
      return sending;
    },
    async buyUpgrade(k) {
      return normalize(await call('finger_buy_upgrade', { p_key: k }));
    },
    async levelUp(id) {
      return normalize(await call('finger_level_up', { p_hero: id }));
    },
  };
}

let api: FingerApi | null = null;
export async function getApi(uid: string): Promise<FingerApi> {
  if (api) return api;
  if (LOCAL_MODE) return (api = createLocalApi(safeStore(), undefined, DEV_CAT_LOCKED ? [] : EXTRA_HERO_IDS, DEV_CAT_LOCKED ? !DEV_CAT_COND : undefined));
  return (api = createSupabaseApi(await worldSupabase(), uid, safeStore()));
}
