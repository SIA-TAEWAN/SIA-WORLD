/**
 * card-finish 의 다시 돌리기 (PRD [기술] '막이 끝날 때마다 씨앗 + 입력 기록을 보내면 서버가 다시 돌려 …').
 * 서버가 판 시작 때 정한 것(씨앗·영웅·모드·숙련·시작 엽전)과 화면이 보낸 입력 목록(판 처음부터 전부)으로 replay 한다.
 *  - 입력 하나라도 받아들여지지 않으면 'bad log'
 *  - 판이 끝났으면(쓰러짐·엔딩) 그 끝 상태를, 아니면 마지막으로 시작한 막의 처음(actStart 의 마지막)까지만 기록한다
 *    → 다른 기기는 그 기록으로 '마지막으로 깬 막 다음부터' 이어 한다
 * Deno · Node · 브라우저 모두에서 돈다 (Node/Deno 전용 API 없음).
 */
import { dailyRun, isDayText } from './daily.ts';
import { MAX_LOG, RUN_MODES, type RunMode } from './data/modes.ts';
import { RULES_VERSION, replay } from './run.ts';
import type { Input, RunState } from './state.ts';

export const CARD_RULES = RULES_VERSION;

export class VerifyError extends Error {}

/** 서버가 판 시작 때 남긴 것 (card_runs 의 줄) */
export interface RunSnap {
  mode: RunMode;
  hero: string;
  mastery: number;
  seed: number;
  /** 오늘의 도전 날짜 'YYYY-MM-DD' (그 밖에는 null) */
  day: string | null;
  /** 시작 엽전 (card_runs.start_gold, null = 기본 99 · 관리자 시험 판 10000). 오늘의 도전은 늘 기본 */
  startGold?: number | null;
}

/** SQL card_finish_verified 에 넘기는 결과 */
export interface VerifiedResult {
  rules: number;
  /** 기록할 입력 개수 (= 함께 넘기는 log 의 길이) */
  logLen: number;
  /** 깬 막 수 (어둑시니 포함) */
  acts: number;
  floors: number;
  elites: number;
  bosses: number;
  hp: number;
  maxHp: number;
  /** 판이 끝남 (쓰러짐 또는 엔딩) */
  over: boolean;
  dead: boolean;
  ending: 'normal' | 'true' | null;
  /** 지금 막 (기록한 곳) */
  act: number;
}

/** 입력의 글자 칸(t · kind) 최대 길이 */
const MAX_TEXT = 16;
const INPUT_KEYS = new Set(['t', 'col', 'uid', 'target', 'slot', 'keep', 'i', 'pick', 'kind', 'uids']);

/** 입력 모양만 본다 (값이 맞는지는 replay 가 본다) */
function cleanLog(raw: unknown): Input[] {
  if (!Array.isArray(raw)) throw new VerifyError('bad log');
  if (raw.length > MAX_LOG) throw new VerifyError('bad log');
  for (const x of raw) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || typeof (x as { t?: unknown }).t !== 'string') throw new VerifyError('bad log');
    for (const [k, v] of Object.entries(x)) {
      if (!INPUT_KEYS.has(k)) throw new VerifyError('bad log');
      if (k === 't' || k === 'kind') {
        if (typeof v !== 'string' || v.length > MAX_TEXT) throw new VerifyError('bad log');
        continue;
      }
      if (k === 'uids') {
        if (!Array.isArray(v) || v.length > 10 || !v.every((n) => Number.isInteger(n))) throw new VerifyError('bad log');
      } else if (!Number.isInteger(v)) throw new VerifyError('bad log');
    }
  }
  return raw as Input[];
}

const resultOf = (run: RunState, logLen: number, over: boolean): VerifiedResult => ({
  rules: RULES_VERSION,
  logLen,
  acts: run.stats.bosses,
  floors: run.stats.floors,
  elites: run.stats.elites,
  bosses: run.stats.bosses,
  hp: Math.max(0, run.hp),
  maxHp: run.maxHp,
  over,
  dead: run.phase === 'dead',
  ending: run.ending ?? null,
  act: run.act,
});

/** 다시 돌려 확인 → 기록할 결과와 입력 목록 */
export function verifyRun(snap: RunSnap, rawLog: unknown): { result: VerifiedResult; log: Input[]; run: RunState } {
  if (!RUN_MODES.includes(snap.mode)) throw new VerifyError('bad run');
  const seed = Number(snap.seed) >>> 0;
  if (snap.mode === 'daily') {
    // 오늘의 도전: 그날 모두 같은 영웅·씨앗이어야 한다
    if (!isDayText(snap.day)) throw new VerifyError('bad daily');
    const d = dailyRun(snap.day);
    if (d.seed !== seed || d.hero !== snap.hero) throw new VerifyError('bad daily');
  }
  const log = cleanLog(rawLog);
  const g = snap.startGold;
  if (g != null && (!Number.isInteger(g) || g < 0 || g > 100000)) throw new VerifyError('bad run');
  const opts = { mode: snap.mode, mastery: snap.mastery, gold: snap.mode === 'daily' ? null : (g ?? null) };
  let full;
  try {
    full = replay(seed, snap.hero, log, opts);
  } catch {
    throw new VerifyError('bad log');
  }
  if (full.bad >= 0) throw new VerifyError('bad log');
  const run = full.run;
  if (run.phase === 'dead' || run.phase === 'won') return { result: resultOf(run, log.length, true), log, run };
  // 아직 진행 중: 마지막으로 시작한 막의 처음까지만
  const cut = run.actStart[run.actStart.length - 1] ?? 0;
  const part = log.slice(0, cut);
  const at = replay(seed, snap.hero, part, opts).run;
  return { result: resultOf(at, part.length, false), log: part, run: at };
}
