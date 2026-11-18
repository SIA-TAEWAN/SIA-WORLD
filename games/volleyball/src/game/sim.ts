/**
 * 시아배구 경기 계산 (순수 모듈: 화면·통신·Math.random 을 쓰지 않는다).
 *
 * - 고정 시간 간격: step() 한 번이 1/60초. 화면 프레임 속도와 상관없이 누적 시간만큼 step을 돌린다 (ticksFor).
 * - 상태(SimState)는 숫자·문자열만 담은 평범한 객체라 JSON으로 그대로 주고받을 수 있다.
 * - 온라인(3단계): 방장 기기가 이 계산을 돌리고, 상대 기기도 같은 계산으로 미리 보여 준다.
 *   상대 캐릭터처럼 '밖에서 받은 위치'는 setPlayer()로 덮어쓰고, 방장이 보낸 공·점수는 applyBall()/applyScore()로 덮어쓴다.
 */
import {
  BALL_GRAVITY, BALL_MAX_SPEED, BALL_R, CEIL, FLOOR_Y, GROUND_Y, HIT_CARRY, HIT_MIN_SPEED, JUMP_SPEED, LEFT, MOVE_SPEED, NET_CAP_Y, NET_R, NET_W, NET_X,
  PLAYER_GRAVITY, PLAYER_MAX_X, PLAYER_MIN_X, PLAYER_R, POINT_PAUSE_TICKS, RALLY_MAX_STAGE, RALLY_STAGE_GAIN, RALLY_STAGE_TICKS, RESTITUTION, RIGHT,
  SERVE_OFFSET, SERVE_Y, START_X, STEP_MS, SUBSTEPS, WIN_SCORE,
} from './constants';
import { makeRng } from './rng';

/** 자리: 0 = 왼쪽(1P), 1 = 오른쪽(2P) */
export type Side = 0 | 1;

/** 한 틱의 조작 (자리마다 같은 모양) */
export interface Input {
  left: boolean;
  right: boolean;
  jump: boolean;
}
export const NO_INPUT: Readonly<Input> = { left: false, right: false, jump: false };

export interface PlayerState {
  /** 원(반지름 PLAYER_R)의 중심 */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 땅에 서 있는가 */
  ground: boolean;
}

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** play: 경기 중(서브 포함) · point: 득점 뒤 1.5초 멈춤 · over: 경기 끝 */
export type Phase = 'play' | 'point' | 'over';

export interface SimState {
  /** 지금까지 계산한 틱 수 */
  tick: number;
  phase: Phase;
  ball: BallState;
  players: [PlayerState, PlayerState];
  score: [number, number];
  /** 이번(또는 다음) 서브를 넣는 자리 */
  server: Side;
  /** 서브 뒤 흐른 틱 */
  rallyTicks: number;
  /** 랠리 가속 단계 0~5 (공 속도 +10%씩) */
  stage: number;
  /** 득점 뒤 남은 멈춤 틱 */
  pause: number;
  /** 마지막으로 점수를 얻은 자리 (-1: 아직 없음) */
  scorer: Side | -1;
  /** 이긴 자리 (-1: 경기 중) */
  winner: Side | -1;
}

/** 계산 중에 생긴 일 (소리·이펙트용). step()에 배열을 넘기면 거기에 쌓인다 */
export type SimEvent =
  | { t: 'serve'; side: Side }
  | { t: 'jump'; side: Side }
  | { t: 'land'; side: Side }
  /** 캐릭터가 공을 침. power: 튕겨 나간 속도 */
  | { t: 'hit'; side: Side; x: number; y: number; power: number }
  | { t: 'wall'; x: number; y: number }
  | { t: 'net'; x: number; y: number }
  /** 랠리 가속 단계가 오름 */
  | { t: 'speedup'; stage: number }
  /** side가 1점 (공이 x 지점 바닥에 닿음) */
  | { t: 'point'; side: Side; x: number }
  | { t: 'over'; winner: Side };

/** 랠리 가속 단계 → 속도 배율 (1.0 ~ 1.5) */
export const speedMult = (stage: number) => 1 + RALLY_STAGE_GAIN * stage;
/** 지금 단계의 공 최대 속도 (20 ~ 30) */
export const maxBallSpeed = (stage: number) => BALL_MAX_SPEED * speedMult(stage);

const newPlayer = (side: Side): PlayerState => ({ x: START_X[side], y: GROUND_Y, vx: 0, vy: 0, ground: true });

/** 새 경기. 첫 서브는 시드로 정한 무작위 자리 */
export function createState(seed: number): SimState {
  const s: SimState = {
    tick: 0, phase: 'play', ball: { x: 0, y: 0, vx: 0, vy: 0 }, players: [newPlayer(0), newPlayer(1)], score: [0, 0],
    server: makeRng(seed)() < 0.5 ? 0 : 1, rallyTicks: 0, stage: 0, pause: 0, scorer: -1, winner: -1,
  };
  startServe(s);
  return s;
}

/** 서브: 두 캐릭터를 제자리에 세우고, 서브하는 캐릭터 머리 위에서 공을 떨어뜨린다 */
function startServe(s: SimState, ev?: SimEvent[]) {
  s.players = [newPlayer(0), newPlayer(1)];
  s.ball = { x: START_X[s.server] + (s.server === 0 ? SERVE_OFFSET : -SERVE_OFFSET), y: SERVE_Y, vx: 0, vy: 0 };
  s.rallyTicks = 0;
  s.stage = 0;
  s.pause = 0;
  s.phase = 'play';
  ev?.push({ t: 'serve', side: s.server });
}

function clampSpeed(b: BallState, max: number) {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > max) {
    b.vx *= max / sp;
    b.vy *= max / sp;
  }
}

/**
 * 공과 벽·천장·네트. prevX: 이번 조각을 움직이기 전의 공 x (네트 기둥의 어느 쪽에 있었는지).
 * 공이 닿았으면 밖으로 밀어내고 속도를 뒤집는다 (반발 0.9).
 */
function collideWorld(b: BallState, prevX: number, ev?: SimEvent[]) {
  if (b.x < LEFT + BALL_R) {
    b.x = LEFT + BALL_R;
    if (b.vx < 0) {
      b.vx = -b.vx * RESTITUTION;
      ev?.push({ t: 'wall', x: LEFT, y: b.y });
    }
  } else if (b.x > RIGHT - BALL_R) {
    b.x = RIGHT - BALL_R;
    if (b.vx > 0) {
      b.vx = -b.vx * RESTITUTION;
      ev?.push({ t: 'wall', x: RIGHT, y: b.y });
    }
  }
  if (b.y < CEIL + BALL_R) {
    b.y = CEIL + BALL_R;
    if (b.vy < 0) {
      b.vy = -b.vy * RESTITUTION;
      ev?.push({ t: 'wall', x: b.x, y: CEIL });
    }
  }
  if (b.y < NET_CAP_Y) {
    // 네트 윗부분: 둥근 면 (원 충돌)
    const dx = b.x - NET_X;
    const dy = b.y - NET_CAP_Y;
    const d = Math.hypot(dx, dy);
    const min = BALL_R + NET_R;
    if (d < min) {
      const nx = d > 1e-6 ? dx / d : 0;
      const ny = d > 1e-6 ? dy / d : -1;
      b.x = NET_X + nx * min;
      b.y = NET_CAP_Y + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + RESTITUTION) * vn * nx;
        b.vy -= (1 + RESTITUTION) * vn * ny;
        ev?.push({ t: 'net', x: NET_X + nx * NET_R, y: NET_CAP_Y + ny * NET_R });
      }
    }
  } else {
    // 네트 기둥: 있던 쪽으로 밀어낸다 (반대쪽으로 뚫고 나가지 않게)
    const min = BALL_R + NET_W / 2;
    if (Math.abs(b.x - NET_X) < min) {
      const side = prevX <= NET_X ? -1 : 1;
      b.x = NET_X + side * min;
      if (b.vx * side < 0) {
        b.vx = -b.vx * RESTITUTION;
        ev?.push({ t: 'net', x: NET_X + (side * NET_W) / 2, y: b.y });
      }
    }
  }
}

/** 공과 캐릭터(원): 캐릭터 중심 → 공 방향으로 튕겨 나가고, 캐릭터 속도의 절반이 더해진다 */
function collidePlayer(b: BallState, p: PlayerState, side: Side, mult: number, ev?: SimEvent[]) {
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const d = Math.hypot(dx, dy);
  const min = BALL_R + PLAYER_R;
  if (d >= min) return;
  const nx = d > 1e-6 ? dx / d : 0;
  const ny = d > 1e-6 ? dy / d : -1;
  b.x = p.x + nx * min;
  b.y = p.y + ny * min;
  // 캐릭터가 본 공의 속도 (부딪치는 방향 성분)
  const vn = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
  const out = Math.max(HIT_MIN_SPEED * mult, -vn * RESTITUTION);
  b.vx = nx * out + p.vx * HIT_CARRY;
  b.vy = ny * out + p.vy * HIT_CARRY;
  clampSpeed(b, BALL_MAX_SPEED * mult);
  // 끼어서 계속 닿아 있는 동안에는 알림을 한 번만 (다가오던 공일 때만)
  if (vn < 0) ev?.push({ t: 'hit', side, x: p.x + nx * PLAYER_R, y: p.y + ny * PLAYER_R, power: Math.hypot(b.vx, b.vy) });
}

/** 캐릭터 한 명을 한 조각만큼 움직인다 (자기 코트 밖으로는 못 나간다) */
function movePlayer(p: PlayerState, side: Side, frac: number, ev?: SimEvent[]) {
  p.x = Math.min(PLAYER_MAX_X[side], Math.max(PLAYER_MIN_X[side], p.x + p.vx * frac));
  if (p.ground) return;
  p.y += p.vy * frac;
  if (p.y >= GROUND_Y) {
    p.y = GROUND_Y;
    p.vy = 0;
    p.ground = true;
    ev?.push({ t: 'land', side });
  }
}

/** 조작을 캐릭터 속도에 반영 (좌우 이동은 공중에서도 가능, 점프는 땅에서만) */
function control(p: PlayerState, side: Side, input: Input, ev?: SimEvent[]) {
  p.vx = input.left === input.right ? 0 : input.left ? -MOVE_SPEED : MOVE_SPEED;
  if (!p.ground) p.vy += PLAYER_GRAVITY;
  else if (input.jump) {
    p.ground = false;
    p.vy = -JUMP_SPEED;
    ev?.push({ t: 'jump', side });
  }
}

/**
 * 공만 한 틱 움직인다 (캐릭터 없이 벽·천장·네트만). AI가 공이 떨어질 곳을 내다볼 때 쓴다.
 * 바닥에 닿으면 true.
 */
export function stepBallOnly(b: BallState, stage: number): boolean {
  b.vy += BALL_GRAVITY;
  clampSpeed(b, maxBallSpeed(stage));
  for (let i = 0; i < SUBSTEPS; i++) {
    const prevX = b.x;
    b.x += b.vx / SUBSTEPS;
    b.y += b.vy / SUBSTEPS;
    collideWorld(b, prevX);
    if (b.y + BALL_R >= FLOOR_Y) {
      b.y = FLOOR_Y - BALL_R;
      return true;
    }
  }
  clampSpeed(b, maxBallSpeed(stage));
  return false;
}

/**
 * 한 틱(1/60초) 계산. 상태를 그 자리에서 고치고 그대로 돌려준다.
 * inputs: [왼쪽 조작, 오른쪽 조작]. events를 넘기면 이번 틱에 생긴 일이 쌓인다.
 */
export function step(s: SimState, inputs: readonly [Input, Input], events?: SimEvent[]): SimState {
  if (s.phase === 'over') return s;
  s.tick++;

  if (s.phase === 'point') {
    // 득점 연출: 공은 바닥에 멈추고, 떠 있던 캐릭터만 내려온다
    for (const side of [0, 1] as const) {
      const p = s.players[side];
      p.vx = 0;
      if (!p.ground) p.vy += PLAYER_GRAVITY;
      movePlayer(p, side, 1);
    }
    if (--s.pause <= 0) startServe(s, events);
    return s;
  }

  // 랠리 가속: 서브 후 10초마다 공이 10% 빨라진다 (최대 +50%)
  s.rallyTicks++;
  const stage = Math.min(RALLY_MAX_STAGE, Math.floor(s.rallyTicks / RALLY_STAGE_TICKS));
  if (stage > s.stage) {
    const k = speedMult(stage) / speedMult(s.stage);
    s.ball.vx *= k;
    s.ball.vy *= k;
    s.stage = stage;
    events?.push({ t: 'speedup', stage });
  }
  const mult = speedMult(s.stage);
  const max = BALL_MAX_SPEED * mult;
  const b = s.ball;

  control(s.players[0], 0, inputs[0], events);
  control(s.players[1], 1, inputs[1], events);
  b.vy += BALL_GRAVITY;
  clampSpeed(b, max);

  // 한 틱을 여러 조각으로 나눠 움직인다 (빠른 공이 뚫고 지나가지 않게)
  const frac = 1 / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) {
    movePlayer(s.players[0], 0, frac, events);
    movePlayer(s.players[1], 1, frac, events);
    const prevX = b.x;
    b.x += b.vx * frac;
    b.y += b.vy * frac;
    // 캐릭터 → 벽·네트 순서로 두 번: 마지막은 언제나 벽·네트라서 공이 경기장 밖이나 네트 속에 남지 않는다
    for (let k = 0; k < 2; k++) {
      collidePlayer(b, s.players[0], 0, mult, events);
      collidePlayer(b, s.players[1], 1, mult, events);
      collideWorld(b, prevX, events);
    }
    if (b.y + BALL_R >= FLOOR_Y) {
      b.y = FLOOR_Y - BALL_R;
      scorePoint(s, b.x < NET_X ? 1 : 0, events);
      return s;
    }
  }
  clampSpeed(b, max);
  return s;
}

/** 공이 바닥에 닿음: 반대쪽이 1점. 3점이면 경기 끝, 아니면 1.5초 뒤 실점한 쪽이 서브 */
function scorePoint(s: SimState, scorer: Side, ev?: SimEvent[]) {
  s.ball.vx = 0;
  s.ball.vy = 0;
  s.score[scorer]++;
  s.scorer = scorer;
  s.server = scorer === 0 ? 1 : 0;
  ev?.push({ t: 'point', side: scorer, x: s.ball.x });
  if (s.score[scorer] >= WIN_SCORE) {
    s.phase = 'over';
    s.winner = scorer;
    ev?.push({ t: 'over', winner: scorer });
  } else {
    s.phase = 'point';
    s.pause = POINT_PAUSE_TICKS;
  }
}

// ---------- 고정 시간 간격 ----------

/** 남은 시간을 모아 두는 시계 */
export interface Clock {
  /** 아직 계산하지 않은 시간 (ms) */
  acc: number;
}
export const newClock = (): Clock => ({ acc: 0 });

/**
 * 흐른 시간(ms)을 더하고, 이번에 계산할 틱 수를 돌려준다.
 * 화면이 30fps든 144fps든 같은 시간에는 같은 틱 수가 나온다. 한 번에 maxTicks를 넘으면 버린다 (탭을 오래 내려 둔 경우).
 */
export function ticksFor(clock: Clock, dtMs: number, maxTicks = 12): number {
  clock.acc += Math.max(0, dtMs);
  let n = 0;
  while (clock.acc >= STEP_MS - 1e-6) {
    clock.acc -= STEP_MS;
    n++;
  }
  if (n > maxTicks) {
    n = maxTicks;
    clock.acc = 0;
  }
  return n;
}

// ---------- 온라인(3단계)용: 상태 복사·덮어쓰기 ----------

/** 상태를 통째로 복사 (JSON으로 보내고 받은 것과 같다) */
export function cloneState(s: SimState): SimState {
  return {
    ...s,
    ball: { ...s.ball },
    players: [{ ...s.players[0] }, { ...s.players[1] }],
    score: [s.score[0], s.score[1]],
  };
}

/** 한 캐릭터만 밖에서 받은 값으로 덮어쓴다 (상대 기기가 보낸 위치) */
export function setPlayer(s: SimState, side: Side, p: Readonly<PlayerState>) {
  s.players[side] = {
    x: Math.min(PLAYER_MAX_X[side], Math.max(PLAYER_MIN_X[side], p.x)),
    y: Math.min(GROUND_Y, p.y),
    vx: p.vx,
    vy: p.vy,
    ground: p.ground,
  };
}

/** 공만 덮어쓴다 (방장이 보낸 공) */
export function applyBall(s: SimState, b: Readonly<BallState>) {
  s.ball = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
}

/** 점수·서브·단계처럼 방장이 정하는 값을 덮어쓴다 (공·캐릭터는 그대로) */
export function applyScore(s: SimState, from: Readonly<SimState>) {
  s.phase = from.phase;
  s.score = [from.score[0], from.score[1]];
  s.server = from.server;
  s.rallyTicks = from.rallyTicks;
  s.stage = from.stage;
  s.pause = from.pause;
  s.scorer = from.scorer;
  s.winner = from.winner;
}
