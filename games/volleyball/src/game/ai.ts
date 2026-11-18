/**
 * 시아배구 AI (PRD 6장, 보통 난이도 한 가지). 순수 모듈: 난수는 시드로 만든 것만 쓴다.
 *
 * - 공이 자기 코트로 오면 떨어질 곳을 내다보고 그쪽으로 가서, 공이 알맞은 높이에 오면 점프한다.
 * - 공의 방향이 바뀐 것(누가 침·벽에 튐)은 0.15~0.25초 뒤에야 알아챈다. 그때 내다본 자리에는 ±20px 오차가 붙는다.
 * - 공이 상대 코트로 가면 자기 코트 가운데로 돌아간다.
 * 사람과 똑같이 { left, right, jump } 조작만 낸다.
 */
import {
  AI_ERROR, AI_REACT_MAX, AI_REACT_MIN, BALL_GRAVITY, BALL_R, GROUND_Y, HIT_MIN_SPEED, NET_W, NET_X, PLAYER_MAX_X, PLAYER_MIN_X, PLAYER_R, RESTITUTION, START_X, TICK_RATE,
} from './constants';
import { makeRng, type Rng } from './rng';
import { maxBallSpeed, speedMult, stepBallOnly, type BallState, type Input, type Side, type SimState } from './sim';

export interface AiOptions {
  /** 반응 지연 (초) */
  reactMin: number;
  reactMax: number;
  /** 예측 오차 (±px) */
  error: number;
  /** 점프해서 칠 확률 (0~1) */
  jumpRate: number;
  /**
   * 공 뒤쪽(자기 벽 쪽)으로 가장 많이 물러서는 거리. 물러설수록 공이 낮고 빠르게 넘어간다.
   * AI는 이 값부터 줄여 가며 '네트를 넘길 수 있는 가장 공격적인 자리'를 고른다.
   */
  behind: number;
  /** 자리를 고를 때 두는 여유 (px). 이만큼 더 물러서도 네트를 넘겨야 그 자리를 고른다. 작을수록 아슬아슬하게 친다 */
  safety: number;
  /** 욕심내서 칠 확률 (0~1): 계산 없이 가장 많이 물러서서 낮고 빠르게 친다. 잘 맞으면 받기 어렵고, 네트에 걸리기도 한다 */
  riskRate: number;
  /** 점프: 공이 내 중심보다 이 높이 범위만큼 위에 내려왔을 때 뛴다 */
  jumpDyMin: number;
  jumpDyMax: number;
}
export const AI_NORMAL: AiOptions = { reactMin: AI_REACT_MIN, reactMax: AI_REACT_MAX, error: AI_ERROR, jumpRate: 0.5, behind: 44, safety: 8, riskRate: 0.5, jumpDyMin: 100, jumpDyMax: 170 };

export interface Ai {
  side: Side;
  opts: AiOptions;
  rng: Rng;
  /** 바로 앞 틱의 공 (방향이 바뀌었는지 알아보려고) */
  last: BallState | null;
  lastTick: number;
  /** 방향이 바뀐 것을 알아챌 틱 (-1: 기다리는 것 없음) */
  noticeAt: number;
  /** 지금 믿고 있는 '공이 떨어질 곳' (오차 포함) */
  landX: number;
  /** 공 뒤쪽으로 물러설 거리 (이번 공) */
  aim: number;
  /** 이번 공을 점프해서 칠 것인가 */
  willJump: boolean;
}

/** 공이 서 있는 캐릭터 머리에 닿는 높이 (공 중심) */
const CONTACT_Y = GROUND_Y - PLAYER_R - BALL_R;
const REACH = PLAYER_R + BALL_R;
/** 목표 자리에 이만큼 가까우면 멈춘다 */
const DEAD_ZONE = 4;
/** 점프: 공이 가로로 이 거리 안에 있을 때 */
const JUMP_DX = 56;
/** 내다보는 시간 한도 (틱) */
const LOOK_AHEAD = 240;
/** 물러설 거리를 고르는 간격·가장 작은 값 */
const AIM_STEP = 8;
const AIM_MIN = 12;

export function makeAi(side: Side, seed: number, opts: AiOptions = AI_NORMAL): Ai {
  return { side, opts, rng: makeRng(seed), last: null, lastTick: -1, noticeAt: -1, landX: NET_X, aim: AIM_MIN, willJump: false };
}

/**
 * 공이 머리 높이까지 내려왔을 때의 공 (벽·천장·네트에 튀는 것까지 계산, 캐릭터는 없다고 본다).
 * 이미 그보다 낮으면 지금 공.
 */
export function predictArrival(ball: Readonly<BallState>, stage: number): BallState {
  const b = { ...ball };
  for (let i = 0; i < LOOK_AHEAD; i++) {
    if (b.y >= CONTACT_Y && b.vy >= 0) break;
    if (stepBallOnly(b, stage)) break;
  }
  return b;
}
/** 공이 떨어질 곳의 x */
export const predictLanding = (ball: Readonly<BallState>, stage: number) => predictArrival(ball, stage).x;

/** 떨어지는 공(arr)을 공보다 d만큼 뒤에 서서 받으면 네트를 넘어가는가 (서서 받는다고 보고 계산) */
function clearsNet(arr: Readonly<BallState>, side: Side, stage: number, d: number): boolean {
  const dir = side === 0 ? 1 : -1;
  const px = Math.min(PLAYER_MAX_X[side], Math.max(PLAYER_MIN_X[side], arr.x - dir * d));
  const sin = Math.max(-0.95, Math.min(0.95, (arr.x - px) / REACH));
  const cos = Math.sqrt(1 - sin * sin);
  // 캐릭터 중심 → 공 방향으로 튄다 (sim.ts 의 collidePlayer 와 같은 식)
  const vn = arr.vx * sin - arr.vy * cos;
  const out = Math.min(maxBallSpeed(stage), Math.max(HIT_MIN_SPEED * speedMult(stage), -vn * RESTITUTION));
  const b: BallState = { x: px + sin * REACH, y: GROUND_Y - cos * REACH, vx: sin * out, vy: -cos * out };
  if (b.vx * dir <= 0) return false;
  for (let i = 0; i < 120; i++) {
    if (stepBallOnly(b, stage)) return false;
    if (b.vx * dir <= 0) return false; // 네트에 맞고 돌아옴
    if ((b.x - NET_X) * dir > BALL_R + NET_W / 2) return true;
  }
  return false;
}

/** 네트를 넘길 수 있는 가장 공격적인(가장 많이 물러선) 자리 */
function chooseAim(arr: Readonly<BallState>, side: Side, stage: number, opts: AiOptions): number {
  for (let d = opts.behind; d >= AIM_MIN; d -= AIM_STEP) {
    if (clearsNet(arr, side, stage, d) && clearsNet(arr, side, stage, d + opts.safety)) return d;
  }
  // 한 번에 못 넘기면 네트 쪽으로 띄워 놓고 다시 친다
  return Math.min(opts.behind, 20);
}

/** 이번 틱의 AI 조작. 매 틱 한 번씩 부른다 (step 전에) */
export function aiInput(ai: Ai, s: SimState): Input {
  const { side, opts, rng } = ai;
  const me = s.players[side];
  const b = s.ball;

  // 공의 방향이 바뀌었는가: 중력만 받았다면 vx는 그대로, vy는 중력만큼만 늘어난다
  const jumped = s.tick !== ai.lastTick + 1;
  let turned = ai.last === null || jumped;
  if (!turned && ai.last) {
    // 중력만 받았을 때의 속도
    const ex = ai.last.vx;
    const ey = ai.last.vy + BALL_GRAVITY;
    const same = Math.abs(b.vx - ex) <= 0.01 && Math.abs(b.vy - ey) <= 0.01;
    // 속도 상한에 걸려 크기만 줄고 방향은 그대로인 경우(빠르게 떨어지는 공)는 방향이 바뀐 것이 아니다
    const capped = !same && Math.abs(b.vx * ey - b.vy * ex) <= 0.02 * Math.hypot(ex, ey) && b.vx * ex + b.vy * ey > 0 && Math.hypot(b.vx, b.vy) <= Math.hypot(ex, ey) + 1e-6;
    turned = (!same && !capped) || Math.abs(b.x - ai.last.x - b.vx) > 0.5;
  }
  ai.last = { ...b };
  ai.lastTick = s.tick;
  if (turned) {
    // 조금 뒤에야 알아챈다 (이미 기다리는 중이면 그 시각을 그대로 둔다)
    const delay = opts.reactMin + rng() * (opts.reactMax - opts.reactMin);
    if (ai.noticeAt < 0) ai.noticeAt = s.tick + Math.round(delay * TICK_RATE);
  }
  if (ai.noticeAt >= 0 && s.tick >= ai.noticeAt) {
    ai.noticeAt = -1;
    const arr = predictArrival(b, s.stage);
    ai.landX = arr.x + (rng() * 2 - 1) * opts.error;
    ai.willJump = rng() < opts.jumpRate;
    if (side === 0 ? arr.x < NET_X : arr.x > NET_X) ai.aim = rng() < opts.riskRate ? opts.behind : chooseAim(arr, side, s.stage, opts);
  }

  const input: Input = { left: false, right: false, jump: false };
  if (s.phase !== 'play') return input;

  const mine = side === 0 ? ai.landX < NET_X : ai.landX > NET_X;
  // 내 코트로 오면 공 뒤쪽에 서고, 아니면 가운데로 돌아간다
  const target = mine ? ai.landX + (side === 0 ? -ai.aim : ai.aim) : START_X[side];
  const dx = target - me.x;
  if (dx < -DEAD_ZONE) input.left = true;
  else if (dx > DEAD_ZONE) input.right = true;

  // 점프: 방금 방향이 바뀐 공(아직 못 알아챈 공)에는 뛰지 않는다
  if (mine && ai.willJump && ai.noticeAt < 0 && me.ground && b.vy > 0) {
    const up = me.y - b.y;
    if (Math.abs(b.x - me.x) < JUMP_DX && up > opts.jumpDyMin && up < opts.jumpDyMax) input.jump = true;
  }
  return input;
}
