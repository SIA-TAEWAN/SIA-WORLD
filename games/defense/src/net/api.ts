import type { SupabaseClient } from '@supabase/supabase-js';
import { SQUAD_SIZE, ZODIAC_IDS, type ZodiacId } from '../data/balance';
import { ROSTER } from '../data/characters';
import { CHAR_MAX_LV, UPGRADES } from '../data/growth';
import { STAGES, stageOf } from '../data/stages';
import {
  LIMITS, applyRun, buyUpgrade, cleanProfile, defaultProfile, levelUp, minRealTime, openedBy, rejectReason, squadOk, stageOpen, startLivesOf,
  type DefenseProfile, type FinishResult, type RunReport,
} from '../game/progress';
import { dropPending, flushPending, keepPending, type SendOutcome, type Store } from './pending';
import { worldSupabase } from './world';

/**
 * 서버 연결. 시아디펜스는 1인 전용이라 게임 중에는 서버와 통신하지 않는다 (PRD 1장).
 *   · 메인에 들어올 때 프로필(엽전·별·레벨·강화·해금)을 읽고
 *   · 출전할 때 start, 판이 끝나면 finish 한 번
 *   · finish 는 보내기 전에 결과를 기기에 보관하고, 서버가 받았거나 거절하면 지운다. 통신 문제(12초 안에 답 없음 포함)면
 *     남겨 두었다가 다음 판을 시작할 때·다음 저장이 성공했을 때·다음 접속 때 다시 보낸다 (net/pending.ts)
 * 엽전·별·레벨·강화·해금은 모두 서버 함수가 정한다 (supabase/migrations/048_defense.sql).
 * 테스트 모드(?local=1)는 같은 규칙(game/progress.ts)으로 이 기기에 저장한다.
 */

/** 주소 (화면 없이 시험할 때는 없다) */
const loc = typeof location === 'undefined' ? null : location;
const params = new URLSearchParams(loc?.search ?? '');
/** 주소의 ?local=1 이면 로그인 없이 해 보는 테스트 모드. 개발 서버나 내 컴퓨터(localhost)에서만 켜진다 */
export const LOCAL_MODE =
  !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));

export type { DefenseProfile, FinishResult, RunReport } from '../game/progress';
export type { Store } from './pending';

/** 서버가 거절했을 때의 까닭 (SQL의 raise exception 글자) */
export class ApiError extends Error {}

export interface DefenseApi {
  kind: 'supabase' | 'local';
  loadProfile(): Promise<DefenseProfile>;
  /** 판 시작: 판 id. 못 받으면 null (그 판은 기록되지 않는다). 잠긴 스테이지·캐릭터면 ApiError */
  start(stage: string, squad: ZodiacId[]): Promise<string | null>;
  /** 판 끝: 새 프로필과 결과. 통신 실패면 임시 보관하고 null, 서버가 거절했으면 ApiError */
  finish(report: RunReport): Promise<{ profile: DefenseProfile; result: FinishResult } | null>;
  /** 임시 보관해 둔 결과를 다시 보낸다 → 올라간 판 수 */
  resend(): Promise<number>;
  /** 다시 보내기(resend)로 새 프로필을 받았을 때 부른다 */
  onProfile: ((p: DefenseProfile) => void) | null;
  /** 아래 둘은 새 프로필을 돌려준다. 안 되면 ApiError(까닭) */
  levelUp(id: ZodiacId): Promise<DefenseProfile>;
  buyUpgrade(key: string): Promise<DefenseProfile>;
}

function browserStore(): Store {
  try {
    localStorage.getItem('siadefense:probe');
    return localStorage;
  } catch {
    // 저장소를 쓸 수 없는 브라우저: 이번 접속 동안만 기억한다
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
}

// ───────────────────────── 테스트 모드: 이 기기에만 저장 (서버와 같은 규칙, game/progress.ts) ─────────────────────────

export const LOCAL_KEY = 'siadefense:local';

interface LocalRun {
  stage: string;
  squad: ZodiacId[];
  started: number;
  startLives: number;
}
interface Saved {
  profile: DefenseProfile;
  /** 진행 중인 판 */
  runs: Record<string, LocalRun>;
  /** 끝난 판: 시작 시각과 판 시간 (겹치는 판 확인용) */
  done: Record<string, { started: number; time: number }>;
  seq: number;
}

/**
 * lenient: 시간 검사(too early · overlap)를 하지 않는다 — 판을 빨리 감아 보는 화면 점검용 (?ff=1, 테스트 모드에서만)
 */
export function createLocalApi(store: Store, key = LOCAL_KEY, now: () => number = () => Date.now(), lenient = false): DefenseApi {
  const read = (): Saved => {
    try {
      const d = JSON.parse(store.getItem(key) ?? 'null') as Partial<Saved> | null;
      if (d) return { profile: cleanProfile(d.profile), runs: d.runs ?? {}, done: d.done ?? {}, seq: Number(d.seq) || 0 };
    } catch {
      /* 처음 상태 */
    }
    return { profile: defaultProfile(), runs: {}, done: {}, seq: 0 };
  };
  const write = (d: Saved) => {
    try {
      store.setItem(key, JSON.stringify(d));
    } catch {
      /* 무시 */
    }
  };
  const change = (fn: (p: DefenseProfile) => DefenseProfile): DefenseProfile => {
    const d = read();
    try {
      d.profile = fn(d.profile);
    } catch (e) {
      throw new ApiError((e as Error).message);
    }
    write(d);
    return d.profile;
  };
  return {
    kind: 'local',
    async loadProfile() {
      return read().profile;
    },
    async start(stageId, squad) {
      const d = read();
      const stage = stageOf(stageId);
      if (!stage) throw new ApiError('bad stage');
      if (new Set(squad).size !== squad.length || squad.length < 1 || squad.length > SQUAD_SIZE) throw new ApiError('bad squad');
      if (!stageOpen(d.profile, stage)) throw new ApiError('stage locked');
      if (!squadOk(d.profile, squad)) throw new ApiError('character locked');
      // 서버와 같다: 끝나지 않은 이전 판은 두되, 너무 오래됐거나 많이 쌓인 것만 치우고, 끝난 판은 30일 뒤에 지운다
      const t = now();
      const open = Object.entries(d.runs)
        .filter(([, r]) => r.started >= t - LIMITS.max_age * 1000)
        .sort((a, b) => b[1].started - a[1].started)
        .slice(0, LIMITS.open_runs - 1);
      const id = `local-${++d.seq}`;
      d.runs = { ...Object.fromEntries(open), [id]: { stage: stageId, squad, started: t, startLives: startLivesOf(stage, d.profile.upgrades) } };
      for (const k of Object.keys(d.done)) if (d.done[k].started < t - 30 * 86400_000) delete d.done[k];
      write(d);
      return id;
    },
    async finish(report) {
      const d = read();
      if (d.done[report.run]) throw new ApiError('already finished');
      const rn = d.runs[report.run];
      if (!rn) throw new ApiError('no run');
      // 스테이지와 시작 생명은 시작할 때 적어 둔 것을 쓴다 (보고에 적힌 값은 믿지 않는다)
      report = { ...report, stage: rn.stage, startLives: rn.startLives };
      const why = rejectReason(report, lenient ? 1e6 : (now() - rn.started) / 1000, rn.startLives);
      if (why && !(lenient && why === 'too late')) throw new ApiError(why);
      const span = (time: number) => minRealTime(time) * 1000;
      if (!lenient) {
        for (const o of Object.values(d.done)) {
          if (o.started < rn.started + span(report.time) && o.started + span(o.time) > rn.started) throw new ApiError('overlap');
        }
      }
      let out: ReturnType<typeof applyRun>;
      try {
        out = applyRun(d.profile, report, rn.squad);
      } catch (e) {
        throw new ApiError((e as Error).message);
      }
      delete d.runs[report.run];
      d.done[report.run] = { started: rn.started, time: report.time };
      d.profile = out.profile;
      write(d);
      return out;
    },
    async resend() {
      return 0;
    },
    onProfile: null,
    async levelUp(id) {
      return change((p) => levelUp(p, id));
    },
    async buyUpgrade(k) {
      return change((p) => buyUpgrade(p, k));
    },
  };
}

// ───────────────────────── 서버 ─────────────────────────

/** 서버 함수가 낸 오류인가 (raise exception → 코드 P0001). 그 밖(연결 끊김·시간 초과)은 통신 실패로 본다 */
const rejected = (error: { code?: string; message?: string } | null) => !!error && error.code === 'P0001';

/** 서버 함수 하나를 기다리는 시간. 넘으면 통신 실패로 본다 (끝 저장은 보관해 두고 나중에 다시 보낸다) */
export const RPC_TIMEOUT_MS = 12000;

type RpcError = { code?: string; message?: string };
type RpcAnswer = { data: unknown; error: RpcError | null };
/** createSupabaseApi 가 쓰는 만큼의 서버 연결 (시험에서는 가짜를 넣는다) */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcAnswer> & { abortSignal?(signal: AbortSignal): PromiseLike<RpcAnswer> };
}

export function createSupabaseApi(sb: SupabaseClient | RpcClient, uid: string, store: Store, timeoutMs = RPC_TIMEOUT_MS): DefenseApi {
  /** 서버 함수를 부른다. ms 안에 답이 없으면 요청을 끊고 통신 실패(error.code 없음)로 돌려준다. 던지지 않는다 */
  const call = async (fn: string, args?: Record<string, unknown>, ms = timeoutMs): Promise<RpcAnswer> => {
    const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<RpcAnswer>((resolve) => {
      timer = setTimeout(() => {
        ctrl?.abort();
        resolve({ data: null, error: { message: 'timeout' } });
      }, ms);
    });
    try {
      const q = (sb as RpcClient).rpc(fn, args);
      const asked = ctrl && q.abortSignal ? q.abortSignal(ctrl.signal) : q;
      return await Promise.race([Promise.resolve(asked), late]);
    } catch (e) {
      return { data: null, error: { message: (e as Error)?.message ?? 'network' } };
    } finally {
      clearTimeout(timer);
    }
  };
  const profileRpc = async (fn: string, args?: Record<string, unknown>): Promise<DefenseProfile> => {
    const { data, error } = await call(fn, args);
    if (error) throw rejected(error) ? new ApiError(error.message ?? 'error') : new Error('network');
    return (last = cleanProfile(data));
  };
  /** 마지막으로 받은 프로필 (새로 열린 스테이지를 앞뒤 비교로 찾는다) */
  let last: DefenseProfile | null = null;
  /** 지금 보내는 중인 판 (다시 보내기가 같은 판을 또 보내지 않게) */
  const sending = new Set<string>();
  let flushing: Promise<number> | null = null;
  const send = async (r: RunReport): Promise<{ outcome: SendOutcome; data?: { profile: DefenseProfile; result: FinishResult }; why?: string }> => {
    try {
      const stars = r.cleared ? (r.lives >= r.startLives ? 3 : r.lives >= 10 ? 2 : 1) : 0;
      const { data, error } = await call('defense_finish', {
        p_run: r.run, p_time: r.time, p_cleared: r.cleared, p_lives: r.lives, p_stars: stars, p_kills: r.kills, p_placed: r.placed, p_cmds: r.cmds, p_bonus: r.bonus,
      });
      // 'too early': 판 시작 알림이 늦게 닿았을 때. 조금 뒤에 다시 보내면 통과하므로 버리지 않는다
      if (error) return rejected(error) && !/too early/.test(error.message ?? '') ? { outcome: 'rejected', why: error.message } : { outcome: 'failed' };
      const d = data as { profile?: unknown; result?: Partial<FinishResult> } | null;
      if (!d?.result) return { outcome: 'failed' };
      const res = d.result;
      const profile = cleanProfile(d.profile);
      const before = last;
      last = profile;
      const num = (v: unknown) => Math.max(0, Math.floor(Number(v)) || 0);
      return {
        outcome: 'ok',
        data: {
          profile,
          result: {
            stars: num(res.stars), bestStars: num(res.bestStars), newStars: num(res.newStars), firstClear: res.firstClear === true,
            coins: num(res.coins), baseCoins: num(res.baseCoins), firstCoins: num(res.firstCoins), starCoins: num(res.starCoins),
            opened: res.firstClear === true && before ? openedBy(before, profile) : null,
            unlocked: (Array.isArray(res.unlocked) ? res.unlocked : []).filter((c): c is ZodiacId => (ZODIAC_IDS as readonly string[]).includes(c)),
            valid: res.valid !== false,
          },
        },
      };
    } catch {
      return { outcome: 'failed' };
    }
  };
  const self: DefenseApi = {
    kind: 'supabase',
    loadProfile: () => profileRpc('defense_profile'),
    async start(stage, squad) {
      // 통신 문제면 한 번 더 해 본다. 두 번을 합쳐 timeoutMs(12초) 안에 답이 없으면 이 판은 기록되지 않는다
      let why: string | undefined;
      for (let i = 0; i < 2; i++) {
        const { data, error } = await call('defense_start', { p_stage: stage, p_squad: squad }, timeoutMs / 2);
        if (error && rejected(error)) throw new ApiError(error.message ?? 'error');
        if (!error && typeof data === 'string') return data;
        why = error?.message;
      }
      console.warn('[시아디펜스] 판 시작을 서버에 알리지 못했어요 (이 판은 기록되지 않아요)', why);
      return null;
    },
    async finish(report) {
      // 먼저 보관하고 보낸다: 보내는 도중에 창이 닫히거나 답이 오지 않아도 결과가 남는다
      keepPending(store, uid, report);
      sending.add(report.run);
      let out: Awaited<ReturnType<typeof send>>;
      try {
        out = await send(report);
      } finally {
        sending.delete(report.run);
      }
      if (out.outcome === 'ok') {
        dropPending(store, uid, report.run);
        // 통신이 되는 김에 앞서 못 올린 판도 올린다 (기다리지 않는다)
        void self.resend().catch(() => 0);
        return out.data!;
      }
      if (out.outcome === 'rejected') {
        dropPending(store, uid, report.run);
        throw new ApiError(out.why ?? 'error');
      }
      // 통신 실패: 보관해 둔 것을 다음에 다시 보낸다
      return null;
    },
    resend() {
      flushing ??= flushPending(
        store,
        uid,
        async (r) => {
          const out = await send(r);
          if (out.outcome === 'ok') self.onProfile?.(out.data!.profile);
          return out.outcome;
        },
        (run) => sending.has(run),
      ).finally(() => (flushing = null));
      return flushing;
    },
    onProfile: null,
    levelUp: (id) => profileRpc('defense_level_up', { p_character: id }),
    buyUpgrade: (key) => profileRpc('defense_buy_upgrade', { p_key: key }),
  };
  return self;
}

let api: DefenseApi | null = null;
export async function getApi(uid: string): Promise<DefenseApi> {
  if (api) return api;
  const store = browserStore();
  if (LOCAL_MODE) {
    seedLocal(store);
    return (api = createLocalApi(store, LOCAL_KEY, () => Date.now(), params.get('ff') === '1'));
  }
  return (api = createSupabaseApi(await worldSupabase(), uid, store));
}

/**
 * 테스트 모드의 진행 상황을 주소로 정한다 (헤드리스 확인용):
 *   ?fresh=1 처음 상태로 · ?coins=500 엽전 · ?cleared=1-4 그 스테이지까지 클리어한 것으로 (&stars=3 이면 별 3개씩, 없으면 1개씩)
 *   ?unlock=1 캐릭터 모두 해금 · ?ff=1 판을 빨리 감아도 저장되게 (시간 검사를 하지 않는다)
 */
function seedLocal(store: Store) {
  if (params.get('fresh') === '1') store.removeItem(LOCAL_KEY);
  const coins = params.get('coins');
  const upTo = stageOf(params.get('cleared') ?? '');
  const all = params.get('unlock') === '1';
  if (coins === null && !upTo && !all) return;
  let d: { profile?: unknown } = {};
  try {
    d = JSON.parse(store.getItem(LOCAL_KEY) ?? '{}') ?? {};
  } catch {
    /* 처음 상태 */
  }
  const p = cleanProfile(d.profile);
  if (coins !== null) p.coins = Math.max(0, Math.floor(Number(coins)) || 0);
  if (upTo) {
    const stars = Math.max(1, Math.min(3, Math.floor(Number(params.get('stars')) || 1)));
    for (const s of STAGES) {
      if (s.region < upTo.region || (s.region === upTo.region && s.no <= upTo.no)) p.stages[s.id] = Math.max(p.stages[s.id] ?? 0, stars);
    }
    // 클리어한 지역의 캐릭터도 해금된 것으로
    for (const c of ROSTER) if (c.unlockRegion > 0 && p.stages[`${c.unlockRegion}-5`] && !p.unlocked.includes(c.id)) p.unlocked.push(c.id);
  }
  if (all) p.unlocked = ROSTER.map((c) => c.id);
  store.setItem(LOCAL_KEY, JSON.stringify({ ...d, profile: cleanProfile(p) }));
}

/**
 * 개발용 테스트 설정 (PRD 7장: 지역과 캐릭터 레벨을 지정해 바로 시험). 개발 서버·localhost 의 ?local=1 에서만 읽는다.
 *   ?local=1&stage=3-2&lv=3         → 메뉴를 건너뛰고 3지역 2번째 스테이지를, 모든 캐릭터 3레벨로 바로 시작 (잠금·해금을 보지 않는다)
 *   ?local=1&region=5&lv=5          → 5지역 첫 스테이지 (stage=5-1 과 같다)
 *   &upg=2 공통 강화를 모두 2레벨로 · &squad=rat,tiger 데려갈 캐릭터 · &seed=숫자 같은 판 다시 보기
 * 이렇게 시작한 판은 저장되지 않는다. lv·upg 만 적으면 메뉴에서 시작하는 판에 그 레벨이 적용된다.
 */
export interface DevSetup {
  stage: string | null;
  squad: ZodiacId[] | null;
  seed: number | null;
  /** 모든 캐릭터의 레벨 (적지 않았으면 null: 저장된 레벨) */
  lv: number | null;
  /** 모든 공통 강화의 레벨 (적지 않았으면 null) */
  upg: number | null;
}

export function devSetup(): DevSetup | null {
  if (!LOCAL_MODE) return null;
  const region = params.get('region');
  const stage = params.get('stage') ?? (region ? `${region}-1` : null);
  const squad = (params.get('squad') ?? '').split(',').filter((c): c is ZodiacId => (ZODIAC_IDS as readonly string[]).includes(c)).slice(0, SQUAD_SIZE);
  const seed = params.get('seed');
  const num = (k: string, min: number, max: number) => (params.get(k) === null ? null : Math.max(min, Math.min(max, Math.floor(Number(params.get(k))) || min)));
  return {
    stage: stage !== null && stageOf(stage) ? stage : null,
    squad: squad.length ? squad : null,
    seed: seed !== null && Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : null,
    lv: num('lv', 1, CHAR_MAX_LV),
    upg: num('upg', 0, Math.max(...UPGRADES.map((u) => u.max))),
  };
}
