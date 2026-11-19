import { TICKS_PER_SEC } from '../src/data/balance';
import { ENEMY_INDEX } from '../src/data/enemies';
import { spawnEnemy } from '../src/game/core';
import { createRun, makeInput, step } from '../src/game/sim';
import type { Enemy, Input, RunConfig, State } from '../src/game/state';

/** 시험용 판: 요괴가 저절로 나오지 않는 빈 들판 (필요한 것만 직접 놓는다) */
export function emptyRun(cfg: Partial<RunConfig> = {}): State {
  const s = createRun({ seed: 1, char: 'rat', map: 'field', ...cfg });
  s.map = { ...s.map, spawns: [], swarms: [], bosses: [] };
  return s;
}

/** 무기를 모두 뺀다 (피격·이동만 볼 때) */
export function disarm(s: State): State {
  s.weapons.length = 0;
  return s;
}

export function put(s: State, id: string, x: number, y: number): Enemy {
  const e = spawnEnemy(s, ENEMY_INDEX[id], x, y);
  if (!e) throw new Error('풀이 가득 찼다');
  return e;
}

export interface AdvanceOpts {
  /** 조작 (없으면 가만히) */
  input?: Input;
  /** 죽지 않게: 걸음마다 무적으로 만든다 */
  immortal?: boolean;
  /** 걸음마다 부르는 함수 */
  each?: (s: State) => void;
}

/** sec 초만큼 진행한다. 레벨업이 뜨면 첫 카드를 고른다 */
export function advance(s: State, sec: number, opts: AdvanceOpts = {}) {
  const input = opts.input ?? makeInput();
  const end = s.tick + Math.round(sec * TICKS_PER_SEC);
  let guard = Math.round(sec * TICKS_PER_SEC) * 3 + 100;
  while (s.tick < end && guard-- > 0 && (s.phase === 'play' || s.phase === 'levelup')) {
    if (opts.immortal) s.player.inv = 5;
    input.pick = s.phase === 'levelup' ? 0 : -1;
    step(s, input);
    opts.each?.(s);
  }
}

/**
 * 오래 걸리는 계산 사이에 한 번 쉰다. vitest 는 시험 파일이 60초 넘게 쉬지 않고 계산하면
 * 진행 상황을 주고받지 못해 (전부 통과여도) `Timeout calling "onTaskUpdate"` 로 실패 처리한다.
 */
export const breathe = () => new Promise<void>((done) => setTimeout(done, 0));

export const live = <T>(p: { items: T[]; n: number }) => p.items.slice(0, p.n);
export const move = (mx: number, my: number): Input => ({ mx, my, pick: -1, reroll: false });
