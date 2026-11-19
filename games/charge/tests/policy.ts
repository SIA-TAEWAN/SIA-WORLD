import { autopilot } from '../src/game/autopilot';
import { stageOf } from '../src/data/stages';
import { STEP, createRun, setTarget, starsFor, step, type RunState } from '../src/game/sim';

/** 테스트용 플레이어: 매 간격 목표 좌우 위치를 정한다 */
export type Policy = (s: RunState) => number;

/** 늘 한 자리에 서 있는 플레이어 (아무것도 고르지 않음) */
export const stay = (x: number): Policy => () => x;

/** 생각하는 플레이어 (src/game/autopilot.ts) */
export const greedy: Policy = autopilot;

/** 판 하나를 끝까지 돌린다 (최대 3분) */
export function simulate(stageId: string, leader: string, policy: Policy) {
  const st = stageOf(stageId);
  if (!st) throw new Error(`no stage ${stageId}`);
  const s = createRun(st, leader);
  for (let i = 0; i < 180 / STEP && s.phase !== 'clear' && s.phase !== 'fail'; i++) {
    setTarget(s, policy(s));
    step(s);
    s.events.length = 0;
  }
  return { state: s, cleared: s.phase === 'clear', troops: s.troops, peak: s.peak, stars: starsFor(s), time: s.t };
}
