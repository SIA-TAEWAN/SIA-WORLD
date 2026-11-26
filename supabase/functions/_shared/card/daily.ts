/**
 * 오늘의 도전 조건 (PRD: 모두 같은 영웅·지도·보상). 날짜 문자열 'YYYY-MM-DD' 에서 어느 기기·서버나 같은 값을 만든다.
 * shared/daily.js 의 dailySeed / dailyPick 과 같은 계산 (FNV-1a) — 서버(card-finish)도 써야 해서 여기 다시 둔다
 * (games/card/tests/daily.test.ts 가 shared/daily.js 와 같은 값인지 본다).
 */
import { DAILY_SCORE } from './data/modes.ts';
import type { RunState } from './state.ts';

export const DAILY_GAME = 'card';
/** 오늘의 도전 영웅 후보: 십이지 12명 (고양이 제외), shared/characters.js 의 순서 */
export const DAILY_HEROES = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;

/** shared/daily.js dailySeed 와 같은 32비트 시드 */
export function dailySeed(game: string, day: string, salt = ''): number {
  const s = `${game}:${day}:${salt}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** shared/daily.js dailyPick 과 같은 고르기 */
export function dailyPick<T>(list: readonly T[], game: string, day: string, salt = 'pick'): T | undefined {
  if (!list.length) return undefined;
  return list[dailySeed(game, day, salt) % list.length];
}

export const isDayText = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** 그날의 판: 씨앗(지도·보상) + 영웅 */
export function dailyRun(day: string): { seed: number; hero: string } {
  return { seed: dailySeed(DAILY_GAME, day, 'seed'), hero: dailyPick(DAILY_HEROES, DAILY_GAME, day, 'hero')! };
}

/** 오늘의 도전 점수 (높을수록 좋음). SQL card_finish_verified 와 같은 식 */
export function dailyScore(s: { floors: number; elites: number; bosses: number; hp: number }): number {
  return s.floors * DAILY_SCORE.floor + s.elites * DAILY_SCORE.elite + s.bosses * DAILY_SCORE.boss + Math.max(0, s.hp);
}
export const runScore = (run: RunState) => dailyScore({ ...run.stats, hp: run.hp });
