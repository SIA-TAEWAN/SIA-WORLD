import { TICK } from '../src/data/balance';
import { STARTERS, TOWER_INDEX } from '../src/data/characters';
import { command, createGame, step } from '../src/game/sim';
import type { State } from '../src/game/state';

/** 시험용 판 (기본 4종 출전) */
export const game = (stage = '1-1', seed = 1): State => createGame({ seed, stage, squad: [...STARTERS] });

export const T = TOWER_INDEX as Record<'rat' | 'ox' | 'tiger' | 'rabbit', number>;

/** sec 초 동안 걷는다 (끝나면 멈춘다) */
export function run(s: State, sec: number) {
  const n = Math.round(sec / TICK);
  for (let i = 0; i < n && s.phase === 'play'; i++) step(s);
}

/** 끝날 때까지 걷는다 (최대 maxSec) */
export function runToEnd(s: State, maxSec = 600) {
  run(s, maxSec);
  return s;
}

/** 기운을 넉넉히 준다 */
export function rich(s: State, energy = 100000) {
  s.energy = energy;
  return s;
}

export const start = (s: State) => command(s, 'start');
