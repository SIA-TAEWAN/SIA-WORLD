import { AI_FINISH_MAX, AI_FINISH_MIN, AI_REACT_MAX, AI_REACT_MIN, AI_SUCCESS, DT, END_AFTER_GO, JUMP_TIME, LOG_SPEED, SLIDE_TIME } from './constants';
import { makeRng, type Rng } from './rng';
import { logPos, newRunner, stepRunner, type Press, type Runner } from './sim';
import type { Obstacle } from './track';

/** AI 한 명의 계획: 출발 반응 시간과, 방해물마다 뛸지 말지 */
export interface AiPlan {
  /** GO 뒤 출발까지 (0.2~0.5초) */
  react: number;
  /** 방해물 id → 제때 점프하는가 (낮은 막대는 제때 슬라이딩하는가. 부스트 발판은 뛰면 놓친다) */
  jump: Record<number, boolean>;
}

/** 이 방해물에서 '잘한 것'이 점프(낮은 막대는 슬라이딩)인가 (부스트 발판만 반대: 밟아야 이득) */
export const goodIsJump = (o: Obstacle) => o.kind !== 'boost';

/** AI가 지금 누를 버튼 (출발·점프는 true, 슬라이딩은 'slide', 안 누르면 false) */
export function aiPress(r: Runner, obs: readonly Obstacle[], plan: AiPlan): Press {
  if (r.state === 'wait') return r.t >= plan.react;
  if (r.state !== 'run') return false;
  const half = (r.v * JUMP_TIME) / 2;
  for (const o of obs) {
    if (!plan.jump[o.id]) continue;
    if (o.kind === 'log') {
      const lx = logPos(r, o);
      if (lx === null || lx < r.x) continue;
      // 공중 한가운데에서 통나무와 엇갈리게
      if (lx - r.x <= ((r.v + LOG_SPEED) * JUMP_TIME) / 2 + 0.2) return true;
      continue;
    }
    if (r.x > o.x) continue;
    if (o.kind === 'bar') {
      // 막대가 슬라이딩 한가운데에 오게 몸을 낮춘다
      if (r.x >= o.x + o.len / 2 - (r.v * SLIDE_TIME) / 2) return 'slide';
      continue;
    }
    // 긴 진흙은 가장자리에서 뛰어 3m를 건너뛴다. 나머지는 방해물 가운데가 점프 한가운데에 오게
    const takeoff = o.kind === 'mudLong' ? o.x - 0.15 : o.x + o.len / 2 - half;
    if (r.x >= takeoff) return true;
  }
  return false;
}

/** 계획대로 혼자 달렸을 때의 도착 시간 (초). 90초 안에 못 오면 Infinity */
export function simulatePlan(obs: readonly Obstacle[], plan: AiPlan): number {
  const r = newRunner();
  const steps = Math.ceil(END_AFTER_GO / DT);
  for (let i = 0; i < steps; i++) {
    stepRunner(r, obs, aiPress(r, obs, plan));
    r.events.length = 0;
    if (r.finishMs !== null) return r.finishMs / 1000;
  }
  return Infinity;
}

function pick<T>(list: T[], rng: Rng): T {
  return list[Math.floor(rng() * list.length)];
}

/**
 * AI 계획 만들기. 방해물마다 75% 확률로 잘 넘는다 (낮은 막대는 같은 확률로 슬라이딩).
 * tune=true 면 도착 시간이 33~37.5초에 들도록 성공·실패를 하나씩 바꿔 맞춘다 (PRD: AI는 33~37.5초 도착).
 * 사람 대신 이어 달리는 AI는 tune=false (이미 달린 구간이 있어서 맞출 수 없다).
 */
export function makeAiPlan(seed: number, slot: number, obs: readonly Obstacle[], tune = true): AiPlan {
  const rng = makeRng((seed ^ Math.imul(slot + 1, 0x9e3779b9)) >>> 0);
  const plan: AiPlan = { react: AI_REACT_MIN + rng() * (AI_REACT_MAX - AI_REACT_MIN), jump: {} };
  for (const o of obs) {
    const good = rng() < AI_SUCCESS;
    plan.jump[o.id] = goodIsJump(o) ? good : !good;
  }
  if (!tune) return plan;
  for (let i = 0; i < 40; i++) {
    const t = simulatePlan(obs, plan);
    if (t >= AI_FINISH_MIN && t <= AI_FINISH_MAX) break;
    const tooFast = t < AI_FINISH_MIN;
    // 너무 빠르면 잘 넘던 것 하나를 실수로, 너무 느리면 실수 하나를 성공으로
    const cand = obs.filter((o) => (plan.jump[o.id] === goodIsJump(o)) === tooFast);
    if (!cand.length) break;
    const o = pick(cand, rng);
    plan.jump[o.id] = !plan.jump[o.id];
  }
  return plan;
}
