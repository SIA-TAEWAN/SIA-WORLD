import { REACT_GOOD, REACT_LUCKY, REACT_PERFECT } from './constants';

/**
 * 출발 반응 시간 (순수 함수 + 기기 저장).
 * 반응 시간 = GO 부터 내가 출발한 걸음의 시각까지 (badges.ts 의 Tally.startT = 출발이 생긴 걸음의 Runner.t).
 * 걸음 기준이라 고스트·시뮬레이션과 같은 값이다. 실격한 판(출발 전)에는 없다.
 * 판정은 화면에 보이는 0.01초 값(올림)으로 한다: 보이는 값이 0.25 면 늘 PERFECT, 0.26 이면 GOOD.
 */

export type ReactionGrade = 'PERFECT' | 'GOOD' | 'LATE';

export interface Reaction {
  /** 반응 시간 (ms, 정수) */
  ms: number;
  /** 화면에 보이는 값 '0.21' */
  text: string;
  grade: ReactionGrade;
  /** 0.10초 미만: 운으로 본다 (표시는 하고 최고 반응 기록에는 넣지 않는다) */
  lucky: boolean;
}

/** 보이는 0.01초 단위 (올림): 250ms → 25, 258ms → 26 */
const centis = (ms: number) => Math.ceil(ms / 10 - 1e-9);

/** '0.21' (0.01초, 올림) */
export function reactionText(ms: number): string {
  const cs = centis(Math.max(0, ms));
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

/** 출발 시각(GO 뒤 초)에서 반응. 출발하지 않았으면(실격·출발 전) null */
export function reactionOf(startT: number | null | undefined): Reaction | null {
  if (startT === null || startT === undefined || !Number.isFinite(startT) || startT < 0) return null;
  const ms = Math.round(startT * 1000);
  const cs = centis(ms);
  const grade: ReactionGrade = cs <= Math.round(REACT_PERFECT * 100) ? 'PERFECT' : cs <= Math.round(REACT_GOOD * 100) ? 'GOOD' : 'LATE';
  return { ms, text: reactionText(ms), grade, lucky: cs < Math.round(REACT_LUCKY * 100) };
}

/** 머리 위 표시: 'PERFECT 0.21' */
export const reactionPop = (r: Reaction) => `${r.grade} ${r.text}`;

/** 결과 화면 줄: '반응 0.21초 · PERFECT' */
export const reactionLine = (r: Reaction) => `반응 ${r.text}초 · ${r.grade}`;

/**
 * 최고 반응 기록과 비교: 운(0.10초 미만)은 넣지 않는다. 더 빠를 때만 바뀐다.
 * → { best: 바뀐 뒤 최고 (없으면 null), improved }
 */
export function nextBestReaction(old: number | null, r: Reaction | null): { best: number | null; improved: boolean } {
  if (!r || r.lucky) return { best: old, improved: false };
  if (old !== null && old <= r.ms) return { best: old, improved: false };
  return { best: r.ms, improved: true };
}

// ───────────── 기기 저장 (사용자별, 서버에는 올리지 않는다) ─────────────

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const key = (uid: string) => `siarace:react:${uid}`;
const defaultStore = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** 저장된 최고 반응 (ms). 없거나 못 읽으면 null */
export function loadBestReaction(uid: string, store: Store | null = defaultStore()): number | null {
  try {
    const n = Number(store?.getItem(key(uid)));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

/** 이번 판의 반응을 최고 반응과 비교해 저장한다. → 갱신했는가 (저장에 실패해도 갱신은 알려 준다) */
export function saveBestReaction(uid: string, r: Reaction | null, store: Store | null = defaultStore()): boolean {
  const { best, improved } = nextBestReaction(loadBestReaction(uid, store), r);
  if (improved && best !== null) {
    try {
      store?.setItem(key(uid), String(best));
    } catch {
      /* 저장 못 해도 계속 */
    }
  }
  return improved;
}
