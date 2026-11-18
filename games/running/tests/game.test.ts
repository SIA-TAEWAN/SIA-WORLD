import { describe, expect, it } from 'vitest';
import {
  AI_FINISH_MAX, AI_FINISH_MIN, BANANA_STUN, BOOST_TIME, DT, HURDLE_STUN, IMMUNE_TIME, JUMP_TIME, LOG_STUN, TOP_SPEED, TRACK_LEN,
} from '../src/game/constants';
import { makeTrack, trackProblems, type Obstacle } from '../src/game/track';
import { advance, foul, newRunner, stepRunner, type Runner } from '../src/game/sim';
import { aiPress, makeAiPlan, simulatePlan } from '../src/game/ai';
import { formatTime, livePlace, rankResults, tierOf } from '../src/game/ranking';

/** presses: 버튼을 누르는 시각(초) 목록 */
function run(obs: Obstacle[], presses: number[], until = 60): Runner {
  const r = newRunner();
  const q = [...presses].sort((a, b) => a - b);
  for (let i = 0; i < until / DT && r.finishMs === null; i++) {
    const press = q.length > 0 && r.t + DT >= q[0];
    if (press) q.shift();
    stepRunner(r, obs, press);
  }
  return r;
}
const at = (kind: Obstacle['kind'], x: number, len: number, id = 0): Obstacle => ({ id, kind, x, len });

describe('달리기', () => {
  it('방해물 없이 GO 직후 출발하면 100m를 20.0~20.5초에 달린다', () => {
    const r = run([], [0]);
    expect(r.state).toBe('done');
    expect(r.finishMs).toBeGreaterThanOrEqual(20000);
    expect(r.finishMs).toBeLessThanOrEqual(20500);
    // 가속 0.4초(1m) + 99m ÷ 5 m/s = 20.2초
    expect(r.finishMs! / 1000).toBeCloseTo(20.2, 1);
  });

  it('정지에서 0.4초에 최고 속도 5 m/s', () => {
    const r = newRunner();
    advance(r, [], 0.2, true);
    expect(r.v).toBeCloseTo(2.5, 1);
    advance(r, [], 0.41, false);
    expect(r.v).toBe(TOP_SPEED);
    advance(r, [], 5, false);
    expect(r.v).toBe(TOP_SPEED);
  });

  it('버튼을 누르기 전에는 서 있고, 기록 시계는 GO부터 흐른다', () => {
    const r = newRunner();
    advance(r, [], 1, false);
    expect(r.x).toBe(0);
    expect(r.state).toBe('wait');
    const late = run([], [1]);
    expect(late.finishMs! / 1000).toBeCloseTo(21.2, 1);
  });

  it('점프: 체공 0.6초, 비거리 3m, 공중 재점프 불가', () => {
    const r = newRunner();
    advance(r, [], 2, true);
    const x0 = r.x;
    stepRunner(r, [], true);
    expect(r.state).toBe('jump');
    let steps = 1;
    while (r.state === 'jump') {
      stepRunner(r, [], true); // 공중에서 계속 눌러도 그대로
      steps++;
    }
    expect(steps * DT).toBeCloseTo(JUMP_TIME, 1);
    expect(r.x - x0).toBeCloseTo(3, 1);
  });

  it('점프는 뛰는 순간의 속도를 유지한다 (가속 중에 뛰면 짧다)', () => {
    const r = newRunner();
    advance(r, [], 0.2, true); // 2.5 m/s
    const x0 = r.x;
    const v0 = r.v;
    stepRunner(r, [], true);
    while (r.state === 'jump') stepRunner(r, [], false);
    expect(r.x - x0).toBeCloseTo(v0 * JUMP_TIME, 1);
    expect(r.x - x0).toBeLessThan(2);
  });

  it('점프해도 방해물이 없으면 기록은 같다', () => {
    const r = run([], [0, 3, 6, 9]);
    expect(r.finishMs! / 1000).toBeCloseTo(20.2, 1);
  });

  it('실격하면 달리지 못한다', () => {
    const r = newRunner();
    foul(r);
    advance(r, [], 5, true);
    expect(r.x).toBe(0);
    expect(r.state).toBe('foul');
    expect(r.finishMs).toBeNull();
  });
});

describe('방해물', () => {
  it('허들: 부딪히면 0.8초 멈추고, 넘으면 그대로', () => {
    const hit = run([at('hurdle', 30, 0.3)], [0]);
    // 0.8초 멈춤 + 다시 가속(0.2초 손해)
    expect(hit.finishMs! / 1000).toBeCloseTo(20.2 + HURDLE_STUN + 0.2, 1);
    const tJump = 0.4 + (28.5 - 1) / 5; // 28.5m에서 점프
    const clear = run([at('hurdle', 30, 0.3)], [0, tJump]);
    expect(clear.finishMs! / 1000).toBeCloseTo(20.2, 1);
  });

  it('허들에 걸리면 조작이 안 되고, 일어난 뒤 0.5초간 같은 허들에 다시 걸리지 않는다', () => {
    const obs = [at('hurdle', 10, 0.3)];
    const r = newRunner();
    advance(r, obs, 0.4 + 9 / 5 + 0.05, true);
    expect(r.state).toBe('fall');
    const x = r.x;
    stepRunner(r, obs, true);
    expect(r.state).toBe('fall');
    advance(r, obs, r.t + HURDLE_STUN, false);
    expect(r.state).toBe('run');
    expect(r.x).toBeGreaterThanOrEqual(x);
    expect(r.immuneT).toBeGreaterThan(0);
    expect(r.immuneT).toBeLessThanOrEqual(IMMUNE_TIME);
    advance(r, obs, r.t + 1, false);
    expect(r.state).toBe('run');
    expect(r.x).toBeGreaterThan(11);
  });

  it('바나나: 밟으면 0.6초 멈춘다', () => {
    const r = run([at('banana', 40, 0.4)], [0]);
    expect(r.finishMs! / 1000).toBeCloseTo(20.2 + BANANA_STUN + 0.2, 1);
  });

  it('짧은 진흙(2m): 밟으면 20% 느려지고, 점프로 완전히 넘을 수 있다', () => {
    const obs = [at('mudShort', 30, 2)];
    const slow = run(obs, [0]);
    // 2m를 4 m/s로 = 0.5초 (원래 0.4초)
    expect(slow.finishMs! / 1000).toBeCloseTo(20.3, 1);
    const tJump = 0.4 + (29.6 - 1) / 5;
    const clear = run(obs, [0, tJump]);
    expect(clear.finishMs! / 1000).toBeCloseTo(20.2, 1);
    expect(slow.finishMs! - clear.finishMs!).toBeGreaterThan(60);
  });

  it('긴 진흙(5m): 점프해도 3m만 건너뛴다', () => {
    const obs = [at('mudLong', 30, 5)];
    const slow = run(obs, [0]);
    expect(slow.finishMs! - 20200).toBeGreaterThan(200);
    const tJump = 0.4 + (29.9 - 1) / 5;
    const part = run(obs, [0, tJump]);
    expect(part.finishMs!).toBeLessThan(slow.finishMs! - 100);
    expect(part.finishMs!).toBeGreaterThan(20200 + 50);
  });

  it('부스트 발판: 밟으면 1.5초간 30% 빨라지고, 점프하면 놓친다', () => {
    const obs = [at('boost', 30, 1)];
    const fast = run(obs, [0]);
    // 1.5초 × 1.5 m/s = 2.25m 이득 → 0.45초
    expect(fast.finishMs! / 1000).toBeCloseTo(20.2 - (BOOST_TIME * TOP_SPEED * 0.3) / TOP_SPEED, 1);
    const tJump = 0.4 + (29 - 1) / 5;
    const missed = run(obs, [0, tJump]);
    expect(missed.finishMs! / 1000).toBeCloseTo(20.2, 1);
  });

  it('통나무: 가까이 가면 초속 2m로 굴러오고, 맞으면 1.0초 멈춘다', () => {
    const obs = [at('log', 50, 0.6)];
    const r = newRunner();
    advance(r, obs, 0.4 + (41.5 - 1) / 5, true); // 41.5m: 통나무(50m)까지 8.5m → 구르는 중
    const l0 = r.logX[0];
    expect(l0).toBeLessThan(50);
    advance(r, obs, r.t + 0.5, false);
    expect(l0 - r.logX[0]).toBeCloseTo(1, 1);
    const hit = run(obs, [0]);
    expect(hit.finishMs! / 1000).toBeCloseTo(20.2 + LOG_STUN + 0.2, 1);
  });

  it('통나무: 제때 뛰면 넘는다', () => {
    const obs = [at('log', 50, 0.6)];
    const r = newRunner();
    let jumped = false;
    for (let i = 0; i < 60 / DT && r.finishMs === null; i++) {
      const lx = r.logX[0];
      const press = r.state === 'wait' || (!jumped && lx !== undefined && lx > 0 && lx - r.x < 2.2);
      if (press && r.state === 'run') jumped = true;
      stepRunner(r, obs, press);
    }
    expect(jumped).toBe(true);
    expect(r.finishMs! / 1000).toBeCloseTo(20.2, 1);
    expect(r.logX[0]).toBe(-1);
  });
});

describe('방해물 배치', () => {
  it('어느 시드든 규칙을 지킨다 (개수 12, 출발 10m·도착 전 5m 비움, 사이 6m 이상, 허들 뒤 부스트 없음)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const obs = makeTrack(seed * 7919);
      expect(obs).toHaveLength(12);
      expect(trackProblems(obs), `seed ${seed}`).toEqual([]);
    }
  });

  it('같은 시드는 같은 배치, 다른 시드는 다른 배치', () => {
    expect(makeTrack(1234)).toEqual(makeTrack(1234));
    expect(makeTrack(1234)).not.toEqual(makeTrack(1235));
  });
});

describe('AI', () => {
  it('출발 반응 0.2~0.5초, 22~25초에 도착한다', () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 150; seed++) {
      const obs = makeTrack(seed * 104729);
      for (let slot = 1; slot <= 3; slot++) {
        const plan = makeAiPlan(seed, slot, obs);
        expect(plan.react).toBeGreaterThanOrEqual(0.2);
        expect(plan.react).toBeLessThanOrEqual(0.5);
        const t = simulatePlan(obs, plan);
        expect(t, `seed ${seed} slot ${slot}`).toBeGreaterThanOrEqual(AI_FINISH_MIN);
        expect(t, `seed ${seed} slot ${slot}`).toBeLessThanOrEqual(AI_FINISH_MAX);
        times.push(t);
      }
    }
    // AI마다 기록이 다르다
    expect(new Set(times.map((t) => t.toFixed(2))).size).toBeGreaterThan(100);
  });

  it('방해물마다 대략 75% 성공한다', () => {
    let good = 0;
    let all = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const obs = makeTrack(seed * 31337);
      const plan = makeAiPlan(seed, 1, obs);
      for (const o of obs) {
        all++;
        if (plan.jump[o.id] === (o.kind !== 'boost')) good++;
      }
    }
    console.log(`AI 성공률 ${((good / all) * 100).toFixed(1)}%`);
    expect(good / all).toBeGreaterThan(0.6);
    expect(good / all).toBeLessThan(0.85);
  });

  it('같은 시드·자리는 어느 기기에서나 같은 계획 (방장이 바뀌어도 이어 달린다)', () => {
    const obs = makeTrack(77);
    expect(makeAiPlan(77, 2, obs)).toEqual(makeAiPlan(77, 2, obs));
    expect(makeAiPlan(77, 2, obs)).not.toEqual(makeAiPlan(77, 3, obs));
  });

  it('GO 전에는 누르지 않는다 (실격 없음)', () => {
    const obs = makeTrack(5);
    const plan = makeAiPlan(5, 1, obs);
    const r = newRunner();
    expect(aiPress(r, obs, plan)).toBe(false);
  });

  it('잘 넘기로 한 방해물은 실제로 넘는다', () => {
    for (const seed of [99, 100, 101, 102, 103]) {
      const obs = makeTrack(seed);
      const plan = { react: 0.3, jump: Object.fromEntries(obs.map((o) => [o.id, o.kind !== 'boost'])) };
      const r = newRunner();
      const seen = new Set<string>();
      for (let i = 0; i < 60 / DT && r.finishMs === null; i++) {
        stepRunner(r, obs, aiPress(r, obs, plan));
        r.events.forEach((e) => seen.add(e));
        r.events.length = 0;
      }
      expect(seen.has('hurdle')).toBe(false);
      expect(seen.has('banana')).toBe(false);
      expect(seen.has('log')).toBe(false);
      expect(seen.has('boost')).toBe(true);
      expect(r.finishMs! / 1000).toBeLessThan(20.6);
    }
  });
});

describe('순위', () => {
  it('도착 기록 순 → 미완주는 남은 거리 순 → 실격은 맨 아래', () => {
    const res = rankResults([
      { slot: 0, status: 'foul', timeMs: null, x: 0 },
      { slot: 1, status: 'dnf', timeMs: null, x: 60 },
      { slot: 2, status: 'finish', timeMs: 23100, x: TRACK_LEN },
      { slot: 3, status: 'dnf', timeMs: null, x: 88 },
    ]);
    expect(res.map((e) => e.slot)).toEqual([2, 3, 1, 0]);
    expect(res.map((e) => e.place)).toEqual([1, 2, 3, 4]);
  });

  it('도착한 사람끼리는 빠른 순, 같으면 자리 순', () => {
    const res = rankResults([
      { slot: 3, status: 'finish', timeMs: 21000, x: 100 },
      { slot: 1, status: 'finish', timeMs: 20500, x: 100 },
      { slot: 2, status: 'finish', timeMs: 21000, x: 100 },
      { slot: 0, status: 'finish', timeMs: 24000, x: 100 },
    ]);
    expect(res.map((e) => e.slot)).toEqual([1, 2, 3, 0]);
  });

  it('경기 중 순위는 앞선 순', () => {
    const now = [
      { slot: 0, status: 'dnf' as const, timeMs: null, x: 40 },
      { slot: 1, status: 'dnf' as const, timeMs: null, x: 55 },
      { slot: 2, status: 'finish' as const, timeMs: 20100, x: 100 },
      { slot: 3, status: 'foul' as const, timeMs: null, x: 0 },
    ];
    expect([0, 1, 2, 3].map((s) => livePlace(now, s))).toEqual([3, 2, 1, 4]);
  });

  it('등급: 해 20.5초 · 달 22초 · 별 25초 · 구름', () => {
    expect(tierOf(20500)).toBe('gold');
    expect(tierOf(20501)).toBe('silver');
    expect(tierOf(22000)).toBe('silver');
    expect(tierOf(22001)).toBe('bronze');
    expect(tierOf(25000)).toBe('bronze');
    expect(tierOf(25001)).toBe('white');
  });

  it('기록은 0.01초 단위로 표시', () => {
    expect(formatTime(20200)).toBe('20.20');
    expect(formatTime(20349)).toBe('20.34');
    expect(formatTime(9050)).toBe('9.05');
  });
});
