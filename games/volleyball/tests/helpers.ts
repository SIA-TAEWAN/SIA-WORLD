import { NET_X, START_X, TICK_RATE } from '../src/game/constants';
import { AI_NORMAL, aiInput, makeAi, type AiOptions } from '../src/game/ai';
import { makeRng } from '../src/game/rng';
import { NO_INPUT, createState, step, type Input, type Side, type SimEvent, type SimState } from '../src/game/sim';

/** 조작을 내는 것 (사람 흉내·AI) */
export type Policy = (s: SimState) => Input;
export type PolicyMaker = (side: Side, seed: number) => Policy;

/** 가만히 서 있는 상대 */
export const idle: PolicyMaker = () => () => NO_INPUT;

/** 게임의 AI (보통 난이도) */
export const ai =
  (opts: AiOptions = AI_NORMAL): PolicyMaker =>
  (side, seed) => {
    const a = makeAi(side, seed, opts);
    return (s) => aiInput(a, s);
  };

/**
 * 단순한 사람 흉내: 공이 내 코트에 있으면 공을 따라가고(공보다 조금 뒤에 서려고 한다), 머리 위 가까이 오면 점프.
 * 공이 어디 떨어질지는 내다보지 않는다. reactSec 만큼 늦게 본 공을 따라간다.
 */
export const chaser =
  (reactSec = 0.2, jumpRate = 0.5): PolicyMaker =>
  (side, seed) => {
    const rng = makeRng(seed);
    const seen: { x: number; y: number; vy: number }[] = [];
    const lag = Math.round(reactSec * TICK_RATE);
    let jumpy = false;
    let lastSide = false;
    return (s) => {
      seen.push({ x: s.ball.x, y: s.ball.y, vy: s.ball.vy });
      if (seen.length > lag + 1) seen.shift();
      const b = seen[0];
      const me = s.players[side];
      const mine = side === 0 ? b.x < NET_X : b.x > NET_X;
      if (mine && !lastSide) jumpy = rng() < jumpRate;
      lastSide = mine;
      const target = mine ? b.x + (side === 0 ? -14 : 14) : START_X[side];
      const input: Input = { left: target < me.x - 6, right: target > me.x + 6, jump: false };
      const up = me.y - s.ball.y;
      if (mine && jumpy && me.ground && s.ball.vy > 0 && Math.abs(s.ball.x - me.x) < 50 && up > 100 && up < 170) input.jump = true;
      return input;
    };
  };

export interface MatchResult {
  winner: Side | -1;
  score: [number, number];
  ticks: number;
  /** 가장 길었던 랠리 (틱) */
  longestRally: number;
  maxStage: number;
}

/** 한 경기를 끝까지 돌린다 (maxTicks 안에 안 끝나면 winner -1) */
export function playMatch(left: PolicyMaker, right: PolicyMaker, seed: number, maxTicks = TICK_RATE * 60 * 20): MatchResult {
  const s = createState(seed);
  const pl = left(0, seed * 7 + 1);
  const pr = right(1, seed * 13 + 5);
  const ev: SimEvent[] = [];
  let longestRally = 0;
  let maxStage = 0;
  while (s.phase !== 'over' && s.tick < maxTicks) {
    step(s, [pl(s), pr(s)], ev);
    if (s.rallyTicks > longestRally) longestRally = s.rallyTicks;
    if (s.stage > maxStage) maxStage = s.stage;
    ev.length = 0;
  }
  return { winner: s.winner, score: [s.score[0], s.score[1]], ticks: s.tick, longestRally, maxStage };
}

export interface Series {
  games: number;
  leftWins: number;
  rightWins: number;
  unfinished: number;
  /** 평균 경기 시간 (초) */
  avgSec: number;
  longestRallySec: number;
}

export function playSeries(left: PolicyMaker, right: PolicyMaker, games: number, seed0 = 1): Series {
  const r: Series = { games, leftWins: 0, rightWins: 0, unfinished: 0, avgSec: 0, longestRallySec: 0 };
  let ticks = 0;
  for (let i = 0; i < games; i++) {
    const m = playMatch(left, right, seed0 + i * 101);
    if (m.winner === 0) r.leftWins++;
    else if (m.winner === 1) r.rightWins++;
    else r.unfinished++;
    ticks += m.ticks;
    r.longestRallySec = Math.max(r.longestRallySec, m.longestRally / TICK_RATE);
  }
  r.avgSec = ticks / games / TICK_RATE;
  return r;
}


/** 다른 일(vitest 일꾼의 보고 등)이 끼어들 수 있게 잠깐 양보한다 */
export const yieldWorker = () => new Promise<void>((r) => setImmediate(r));

/**
 * playSeries 와 같은 결과(같은 씨앗)를 내지만, 경기마다 잠깐 양보한다.
 * 오래 도는 테스트가 일꾼을 수십 초 붙잡으면 vitest 가 "Timeout calling onTaskUpdate" 로 멈출 수 있어서.
 */
export async function playSeriesAsync(left: PolicyMaker, right: PolicyMaker, games: number, seed0 = 1): Promise<Series> {
  const r: Series = { games, leftWins: 0, rightWins: 0, unfinished: 0, avgSec: 0, longestRallySec: 0 };
  let ticks = 0;
  for (let i = 0; i < games; i++) {
    const m = playMatch(left, right, seed0 + i * 101);
    if (m.winner === 0) r.leftWins++;
    else if (m.winner === 1) r.rightWins++;
    else r.unfinished++;
    ticks += m.ticks;
    r.longestRallySec = Math.max(r.longestRallySec, m.longestRally / TICK_RATE);
    await yieldWorker();
  }
  r.avgSec = ticks / games / TICK_RATE;
  return r;
}
