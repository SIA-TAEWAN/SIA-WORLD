import {
  ACCEL, BANANA_STUN, BAR_STUN, BOOST_FACTOR, BOOST_TIME, DT, HURDLE_STUN, IMMUNE_TIME, JUMP_TIME, LOG_GONE, LOG_LEN, LOG_SPEED, LOG_STUN,
  LOG_TRIGGER, MUD_FACTOR, SLIDE_TIME, TOP_SPEED, TRACK_LEN,
} from './constants';
import type { Obstacle } from './track';

/**
 * wait 출발 전(GO 뒤 버튼을 기다림) · run 달리는 중 · jump 공중 · slide 슬라이딩(몸을 낮춤)
 * fall 넘어짐(허들·통나무·낮은 막대) · slip 미끄러짐(바나나) · done 도착 · foul 실격
 */
export type RunState = 'wait' | 'run' | 'jump' | 'slide' | 'fall' | 'slip' | 'done' | 'foul';

/** 이번 걸음의 버튼: true·'jump' 는 출발 또는 점프, 'slide' 는 출발 또는 슬라이딩 */
export type Press = boolean | 'jump' | 'slide';

/** 한 걸음에 생긴 일 (소리·이펙트용) */
export type SimEvent = 'start' | 'jump' | 'land' | 'slide' | 'slideEnd' | 'mud' | 'hurdle' | 'banana' | 'log' | 'bar' | 'boost' | 'getup' | 'finish';

export interface Runner {
  /** 위치 (m) */
  x: number;
  /** 기본 속도: 정지에서 0.4초에 5 m/s까지. 실제 속도는 여기에 진흙·부스트를 곱한다 */
  base: number;
  /** 지금 실제 속도 */
  v: number;
  state: RunState;
  /** GO부터 흐른 시간 (초) */
  t: number;
  /** 점프한 뒤 흐른 시간 */
  jumpT: number;
  /** 뛰는 순간의 속도 (공중에서 그대로) */
  jumpV: number;
  /** 슬라이딩한 뒤 흐른 시간 */
  slideT: number;
  /** 넘어져 있는 남은 시간 */
  stunT: number;
  /** 부스트 남은 시간 */
  boostT: number;
  /** 방금 걸린 방해물(다시 안 걸림)과 남은 시간 */
  immuneId: number;
  immuneT: number;
  /** 이미 밟은 부스트 발판 */
  usedBoost: number[];
  /** 통나무 위치: 방해물 id → 지금 x (사라졌으면 -1). 구르기 전에는 없음 */
  logX: Record<number, number>;
  inMud: boolean;
  /** 도착 기록 (ms). 도착 전에는 null */
  finishMs: number | null;
  events: SimEvent[];
}

export function newRunner(): Runner {
  return {
    x: 0, base: 0, v: 0, state: 'wait', t: 0, jumpT: 0, jumpV: 0, slideT: 0, stunT: 0, boostT: 0,
    immuneId: -1, immuneT: 0, usedBoost: [], logX: {}, inMud: false, finishMs: null, events: [],
  };
}

/** 점프 높이 비율 (0~1, 포물선) */
export function jumpArc(state: RunState, jumpT: number): number {
  if (state !== 'jump') return 0;
  const p = Math.min(1, jumpT / JUMP_TIME);
  return 4 * p * (1 - p);
}

/** 통나무의 지금 위치 (구르기 전이면 놓인 자리, 사라졌으면 null) */
export function logPos(r: Pick<Runner, 'logX'>, o: Obstacle): number | null {
  const x = r.logX[o.id];
  if (x === undefined) return o.x;
  return x < 0 ? null : x;
}

const onGround = (r: Runner) => r.state === 'run' || r.state === 'slide';
const overlaps = (prevX: number, x: number, a: number, b: number) => x >= a && prevX <= b;

function stun(r: Runner, o: Obstacle, state: 'fall' | 'slip', time: number, ev: SimEvent) {
  r.state = state;
  r.jumpT = 0;
  r.slideT = 0;
  r.stunT = time;
  r.base = 0;
  r.v = 0;
  r.immuneId = o.id;
  r.immuneT = time + IMMUNE_TIME;
  r.events.push(ev);
}

/**
 * 한 걸음(dt) 계산. press: 이번 걸음에 누른 버튼 (출발, 또는 점프·슬라이딩).
 * 생긴 일은 r.events 에 쌓인다 (부르는 쪽에서 비운다).
 */
export function stepRunner(r: Runner, obs: readonly Obstacle[], press: Press, dt = DT): void {
  r.t += dt;
  if (r.state === 'foul') return;
  if (r.state === 'wait') {
    if (!press) return;
    r.state = 'run';
    r.events.push('start');
    press = false;
  }
  const prevX = r.x;
  if (r.boostT > 0) r.boostT = Math.max(0, r.boostT - dt);
  if (r.immuneT > 0) r.immuneT = Math.max(0, r.immuneT - dt);

  if (r.state === 'done') {
    // 결승선을 지나 천천히 멈춘다 (화면용)
    r.v = Math.max(0, r.v - ACCEL * 0.5 * dt);
    r.x += r.v * dt;
  } else if (r.state === 'fall' || r.state === 'slip') {
    r.stunT -= dt;
    if (r.stunT <= 0) {
      r.state = 'run';
      r.stunT = 0;
      r.events.push('getup');
    }
  } else {
    if (r.state === 'run' && press === 'slide') {
      r.state = 'slide';
      r.slideT = 0;
      r.events.push('slide');
    } else if (r.state === 'run' && press) {
      r.state = 'jump';
      r.jumpT = 0;
      r.jumpV = r.v;
      r.events.push('jump');
    }
    if (r.state === 'jump') {
      r.jumpT += dt;
      r.v = r.jumpV;
      r.x += r.v * dt;
      r.inMud = false;
      if (r.jumpT >= JUMP_TIME) {
        r.state = 'run';
        r.jumpT = 0;
        // 착지하면 땅 위 속도로 (안 그러면 바로 다시 뛸 때 부스트 속도가 끝없이 이어진다)
        r.v = r.base * (r.boostT > 0 ? BOOST_FACTOR : 1);
        r.events.push('land');
      }
    } else {
      // 슬라이딩: 땅에 붙어 있으므로 진흙·부스트는 그대로 받지만, 가속은 멈춘다 (달릴 때보다 빨라지지 않는다)
      const sliding = r.state === 'slide';
      if (!sliding) r.base = Math.min(TOP_SPEED, r.base + ACCEL * dt);
      let mud = false;
      for (const o of obs) if ((o.kind === 'mudShort' || o.kind === 'mudLong') && r.x >= o.x && r.x <= o.x + o.len) mud = true;
      if (mud && !r.inMud) r.events.push('mud');
      r.inMud = mud;
      r.v = r.base * (mud ? MUD_FACTOR : 1) * (r.boostT > 0 ? BOOST_FACTOR : 1);
      r.x += r.v * dt;
      if (sliding) {
        r.slideT += dt;
        if (r.slideT >= SLIDE_TIME) {
          r.state = 'run';
          r.slideT = 0;
          r.events.push('slideEnd');
        }
      }
    }
  }

  // 통나무: 주자가 가까이 오면 구르기 시작해 다가온다
  for (const o of obs) {
    if (o.kind !== 'log') continue;
    let lx = r.logX[o.id];
    if (lx === undefined) {
      if (r.x < o.x - LOG_TRIGGER) continue;
      lx = o.x;
    }
    if (lx < 0) continue;
    const prevL = lx;
    lx -= LOG_SPEED * dt;
    if (onGround(r) && !(r.immuneId === o.id && r.immuneT > 0) && overlaps(prevX, r.x, lx, prevL + LOG_LEN)) stun(r, o, 'fall', LOG_STUN, 'log');
    r.logX[o.id] = lx < r.x - LOG_GONE || lx < -1 ? -1 : lx;
  }

  // 낮은 막대(머리 높이): 슬라이딩이 아니면 걸린다. 점프해도 부딪힌다
  if (r.state === 'run' || r.state === 'jump') {
    for (const o of obs) {
      if (o.kind !== 'bar' || !overlaps(prevX, r.x, o.x, o.x + o.len)) continue;
      if (r.immuneId === o.id && r.immuneT > 0) continue;
      stun(r, o, 'fall', BAR_STUN, 'bar');
      break;
    }
  }

  // 땅에 있을 때만 걸린다 (슬라이딩도 땅이다)
  if (onGround(r)) {
    for (const o of obs) {
      if (o.kind === 'log' || o.kind === 'mudShort' || o.kind === 'mudLong' || o.kind === 'bar') continue;
      if (!overlaps(prevX, r.x, o.x, o.x + o.len)) continue;
      if (o.kind === 'boost') {
        if (!r.usedBoost.includes(o.id)) {
          r.usedBoost.push(o.id);
          r.boostT = BOOST_TIME;
          r.events.push('boost');
        }
        continue;
      }
      if (r.immuneId === o.id && r.immuneT > 0) continue;
      if (o.kind === 'hurdle') stun(r, o, 'fall', HURDLE_STUN, 'hurdle');
      else stun(r, o, 'slip', BANANA_STUN, 'banana');
      break;
    }
  }

  // 결승선: 지나는 순간을 걸음 안에서 나눠 0.001초까지 잰다 (공중에서 지나도 도착)
  if (r.finishMs === null && r.x >= TRACK_LEN && (r.state === 'run' || r.state === 'jump' || r.state === 'slide')) {
    const frac = r.x > prevX ? (TRACK_LEN - prevX) / (r.x - prevX) : 1;
    r.finishMs = Math.round((r.t - dt + frac * dt) * 1000);
    r.state = 'done';
    r.events.push('finish');
  }
}

/** 실격: 그 판은 달리지 못한다 */
export function foul(r: Runner) {
  r.state = 'foul';
  r.v = 0;
  r.base = 0;
}

/**
 * GO 뒤 toT(초)까지 고정 간격으로 계산한다. press는 첫 걸음에 한 번만 쓰인다.
 * → 계산한 걸음 수
 */
export function advance(r: Runner, obs: readonly Obstacle[], toT: number, press: Press, dt = DT): number {
  let n = 0;
  while (r.t + dt <= toT + 1e-9) {
    stepRunner(r, obs, press && n === 0, dt);
    n++;
  }
  return n;
}
