import { describe, expect, it } from 'vitest';
import {
  AI_FINISH_MAX, AI_FINISH_MIN, BANANA_STUN, BAR_STUN, BOOST_FACTOR, BOOST_TIME, DT, HURDLE_STUN, IMMUNE_TIME, JUMP_TIME, LOG_STUN, MIN_VALID_MS,
  OBSTACLE_COUNTS, SLIDE_TIME, TOP_SPEED, TRACK_LEN,
} from '../src/game/constants';
import { makeTrack, trackProblems, type Obstacle } from '../src/game/track';
import { advance, foul, newRunner, stepRunner, type Press, type Runner } from '../src/game/sim';
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

/** acts: [누르는 시각(초), 버튼] 목록 (점프·슬라이딩을 섞어 누를 때) */
function runActs(obs: Obstacle[], acts: [number, Press][], until = 60): Runner {
  const r = newRunner();
  const q = [...acts].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < until / DT && r.finishMs === null; i++) {
    let press: Press = false;
    if (q.length > 0 && r.t + DT >= q[0][0]) press = q.shift()![1];
    stepRunner(r, obs, press);
  }
  return r;
}
/** x(m) 지점을 최고 속도로 지나는 시각 (GO 직후 출발) */
const timeAt = (x: number) => 0.4 + (x - 1) / 5;
/** 빈 트랙 기록 (초): 가속 0.4초(1m) + 나머지 ÷ 5 m/s */
const BASE = timeAt(TRACK_LEN);

describe('달리기', () => {
  it('방해물 없이 GO 직후 출발하면 150m를 30.0~30.5초에 달린다', () => {
    const r = run([], [0]);
    expect(r.state).toBe('done');
    expect(r.finishMs).toBeGreaterThanOrEqual(30000);
    expect(r.finishMs).toBeLessThanOrEqual(30500);
    // 가속 0.4초(1m) + 149m ÷ 5 m/s = 30.2초
    expect(r.finishMs! / 1000).toBeCloseTo(BASE, 1);
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
    expect(late.finishMs! / 1000).toBeCloseTo(BASE + 1, 1);
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
    expect(r.finishMs! / 1000).toBeCloseTo(BASE, 1);
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
    expect(hit.finishMs! / 1000).toBeCloseTo(BASE + HURDLE_STUN + 0.2, 1);
    const tJump = 0.4 + (28.5 - 1) / 5; // 28.5m에서 점프
    const clear = run([at('hurdle', 30, 0.3)], [0, tJump]);
    expect(clear.finishMs! / 1000).toBeCloseTo(BASE, 1);
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
    expect(r.finishMs! / 1000).toBeCloseTo(BASE + BANANA_STUN + 0.2, 1);
  });

  it('짧은 진흙(2m): 밟으면 20% 느려지고, 점프로 완전히 넘을 수 있다', () => {
    const obs = [at('mudShort', 30, 2)];
    const slow = run(obs, [0]);
    // 2m를 4 m/s로 = 0.5초 (원래 0.4초)
    expect(slow.finishMs! / 1000).toBeCloseTo(BASE + 0.1, 1);
    const tJump = 0.4 + (29.6 - 1) / 5;
    const clear = run(obs, [0, tJump]);
    expect(clear.finishMs! / 1000).toBeCloseTo(BASE, 1);
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
    expect(fast.finishMs! / 1000).toBeCloseTo(BASE - (BOOST_TIME * TOP_SPEED * 0.3) / TOP_SPEED, 1);
    const tJump = 0.4 + (29 - 1) / 5;
    const missed = run(obs, [0, tJump]);
    expect(missed.finishMs! / 1000).toBeCloseTo(BASE, 1);
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
    expect(hit.finishMs! / 1000).toBeCloseTo(BASE + LOG_STUN + 0.2, 1);
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
    expect(r.finishMs! / 1000).toBeCloseTo(BASE, 1);
    expect(r.logX[0]).toBe(-1);
  });
});

describe('슬라이딩', () => {
  it('0.6초 동안 속도를 유지하며 3m 미끄러지고, 슬라이딩 중에는 다시 슬라이딩·점프할 수 없다', () => {
    const r = newRunner();
    advance(r, [], 2, true);
    const x0 = r.x;
    stepRunner(r, [], 'slide');
    expect(r.state).toBe('slide');
    expect(r.events).toContain('slide');
    let steps = 1;
    while (r.state === 'slide') {
      // 슬라이딩 중에 점프·슬라이딩을 번갈아 눌러도 그대로
      stepRunner(r, [], steps % 2 ? true : 'slide');
      steps++;
      expect(r.v).toBe(TOP_SPEED);
    }
    expect(steps * DT).toBeCloseTo(SLIDE_TIME, 2);
    expect(r.x - x0).toBeCloseTo(SLIDE_TIME * TOP_SPEED, 1);
    expect(r.state).toBe('run');
    expect(r.events).toContain('slideEnd');
    expect(r.events).not.toContain('jump');
  });

  it('공중에서는 슬라이딩할 수 없고, 출발 전에 누르면 출발만 한다', () => {
    const r = newRunner();
    stepRunner(r, [], 'slide');
    expect(r.state).toBe('run');
    advance(r, [], 2, false);
    stepRunner(r, [], true);
    expect(r.state).toBe('jump');
    stepRunner(r, [], 'slide');
    expect(r.state).toBe('jump');
  });

  it('슬라이딩해도 방해물이 없으면 기록은 같고, 가속 중에 하면 느려진다 (가속이 멈춘다)', () => {
    expect(runActs([], [[0, true], [5, 'slide'], [9, 'slide']]).finishMs).toBe(run([], [0]).finishMs);
    const r = newRunner();
    advance(r, [], 0.2, true);
    const v = r.v;
    stepRunner(r, [], 'slide');
    advance(r, [], r.t + 0.3, false);
    expect(r.state).toBe('slide');
    expect(r.v).toBeCloseTo(v, 5);
    expect(runActs([], [[0, true], [0.2, 'slide']]).finishMs!).toBeGreaterThan(run([], [0]).finishMs! + 200);
  });

  it('슬라이딩은 땅이다: 허들·바나나·통나무에 걸리고, 진흙에서 느려지고, 부스트 발판을 밟는다', () => {
    for (const [kind, len] of [['hurdle', 0.3], ['banana', 0.4]] as const) {
      const r = runActs([at(kind, 30, len)], [[0, true], [timeAt(28.5), 'slide']]);
      expect(r.finishMs!, kind).toBeGreaterThan(20200 + 500);
    }
    expect(runActs([at('log', 50, 0.6)], [[0, true], [timeAt(44.5), 'slide']]).finishMs!).toBeGreaterThan(20200 + 900);
    const mud = [at('mudShort', 30, 2)];
    expect(runActs(mud, [[0, true], [timeAt(29.6), 'slide']]).finishMs).toBe(run(mud, [0]).finishMs);
    const boost = [at('boost', 30, 1)];
    expect(runActs(boost, [[0, true], [timeAt(29), 'slide']]).finishMs).toBe(run(boost, [0]).finishMs);
  });

  it('슬라이딩으로 결승선을 지나도 도착한다', () => {
    const r = runActs([], [[0, true], [timeAt(99), 'slide']]);
    expect(r.state).toBe('done');
    expect(r.finishMs).toBe(run([], [0]).finishMs);
  });
});

describe('낮은 막대 (슬라이딩으로만 지나간다)', () => {
  const obs = [at('bar', 30, 0.3)];

  it('서서 달리면 부딪혀 0.8초 멈춘다', () => {
    const r = run(obs, [0]);
    expect(r.finishMs! / 1000).toBeCloseTo(BASE + BAR_STUN + 0.2, 1);
  });

  it('점프로는 피할 수 없다: 뛰어들어도 부딪힌다', () => {
    // 허들이라면 넘는 자리(28.5m)에서 뛴다
    const r = newRunner();
    const seen: string[] = [];
    for (let i = 0; i < 60 / DT && r.finishMs === null; i++) {
      stepRunner(r, obs, r.state === 'wait' || (r.state === 'run' && r.x >= 28.5 && r.x < 29));
      seen.push(...r.events.splice(0));
    }
    expect(seen).toContain('jump');
    expect(seen).toContain('bar');
    expect(r.finishMs! / 1000).toBeCloseTo(BASE + BAR_STUN + 0.2, 1);
    // 어느 자리에서 뛰어도 마찬가지
    for (let x = 26.6; x <= 30; x += 0.2) {
      const j = run(obs, [0, timeAt(x)]);
      expect(j.finishMs!, `${x.toFixed(1)}m에서 점프`).toBeGreaterThan(20200 + 700);
    }
  });

  it('슬라이딩하면 그대로 지나간다', () => {
    const seen: string[] = [];
    const r = newRunner();
    for (let i = 0; i < 60 / DT && r.finishMs === null; i++) {
      stepRunner(r, obs, r.state === 'wait' ? true : r.state === 'run' && r.x >= 28.5 && r.x < 29 ? 'slide' : false);
      seen.push(...r.events.splice(0));
    }
    expect(seen).toContain('slide');
    expect(seen).not.toContain('bar');
    expect(r.finishMs).toBe(run([], [0]).finishMs);
  });

  it('너무 일찍 슬라이딩하면 일어나다가 걸린다', () => {
    const r = runActs(obs, [[0, true], [timeAt(26), 'slide']]);
    expect(r.finishMs!).toBeGreaterThan(20200 + 700);
  });

  it('걸리면 넘어져 조작이 안 되고, 일어난 뒤 0.5초간 다시 걸리지 않는다', () => {
    const r = newRunner();
    advance(r, obs, timeAt(30) + 0.05, true);
    expect(r.state).toBe('fall');
    stepRunner(r, obs, 'slide');
    expect(r.state).toBe('fall');
    advance(r, obs, r.t + BAR_STUN, false);
    expect(r.state).toBe('run');
    expect(r.immuneT).toBeGreaterThan(0);
    advance(r, obs, r.t + 1, false);
    expect(r.state).toBe('run');
    expect(r.x).toBeGreaterThan(31);
  });
});

describe('속도 꼼수 점검 (점프·슬라이딩을 이어 눌러도 정상 속도를 넘지 않는다)', () => {
  /** 무작위로 버튼을 마구 누르며 달린다 */
  function mash(obs: Obstacle[], seed: number, rate: number) {
    let s = seed >>> 0;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const r = newRunner();
    let vmax = 0;
    for (let i = 0; i < 60 / DT && r.finishMs === null; i++) {
      const k = rnd();
      const press: Press = r.state === 'wait' ? true : k < rate ? 'slide' : k < rate * 2 ? true : false;
      const boosted = r.boostT > 0;
      stepRunner(r, obs, press);
      // 부스트가 없으면 5 m/s, 있어도 6.5 m/s를 넘지 않는다 (공중은 뛰는 순간의 속도)
      if (r.state === 'run' || r.state === 'slide') expect(r.v).toBeLessThanOrEqual((boosted ? BOOST_FACTOR : 1) * TOP_SPEED + 1e-9);
      vmax = Math.max(vmax, r.v);
      r.events.length = 0;
    }
    return { ms: r.finishMs ?? Infinity, vmax };
  }

  it('빈 트랙: 어떻게 눌러도 30.2초보다 빠르지 않다 (빈 트랙 30.0~30.5초 유지)', () => {
    const plain = run([], [0]).finishMs!;
    expect(plain).toBeGreaterThanOrEqual(30000);
    expect(plain).toBeLessThanOrEqual(30500);
    for (let seed = 1; seed <= 60; seed++) {
      const { ms, vmax } = mash([], seed, [0.01, 0.05, 0.5][seed % 3]);
      expect(ms, `seed ${seed}`).toBeGreaterThanOrEqual(plain);
      expect(vmax).toBeLessThanOrEqual(TOP_SPEED);
    }
  });

  it('슬라이딩은 부스트를 늘리지 못한다: 부스트가 끝나면 슬라이딩 중에도 바로 원래 속도', () => {
    const obs = [at('boost', 30, 1)];
    const r = newRunner();
    advance(r, obs, timeAt(30.5), true);
    expect(r.boostT).toBeGreaterThan(0);
    // 부스트가 끝나기 직전에 슬라이딩
    advance(r, obs, r.t + r.boostT - 0.1, false);
    stepRunner(r, obs, 'slide');
    expect(r.v).toBeCloseTo(TOP_SPEED * BOOST_FACTOR, 5);
    advance(r, obs, r.t + 0.2, false);
    expect(r.state).toBe('slide');
    expect(r.v).toBe(TOP_SPEED);
    // 슬라이딩을 이어 눌러도 그냥 달린 것보다 빠르지 않다
    const plain = run(obs, [0]).finishMs!;
    for (let seed = 1; seed <= 40; seed++) {
      let s = seed;
      const r2 = newRunner();
      for (let i = 0; i < 60 / DT && r2.finishMs === null; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        stepRunner(r2, obs, r2.state === 'wait' ? true : s / 0x100000000 < 0.05 ? 'slide' : false);
      }
      expect(r2.finishMs!).toBeGreaterThanOrEqual(plain);
    }
  });

  it('실제 배치에서 마구 눌러도 서버 기준(28초)보다 빠른 기록은 나오지 않는다', () => {
    let best = Infinity;
    for (let seed = 1; seed <= 40; seed++) {
      const obs = makeTrack(seed * 6151);
      for (let k = 0; k < 6; k++) best = Math.min(best, mash(obs, seed * 100 + k, [0.004, 0.01, 0.03][k % 3]).ms);
    }
    expect(best).toBeGreaterThanOrEqual(MIN_VALID_MS);
  }, 30000);
});

describe('방해물 배치', () => {
  it('어느 시드든 규칙을 지킨다 (개수 18, 출발 10m·도착 전 5m 비움, 사이 6m 이상, 허들 뒤 부스트 없음)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const obs = makeTrack(seed * 7919);
      expect(obs).toHaveLength(18);
      expect(trackProblems(obs), `seed ${seed}`).toEqual([]);
    }
  });

  it('낮은 막대는 판마다 3개, 다른 방해물과 같은 규칙으로 놓인다 (출발 10m·도착 전 5m 밖, 앞뒤 6m 이상)', () => {
    expect(OBSTACLE_COUNTS.bar).toBe(3);
    for (let seed = 1; seed <= 300; seed++) {
      const obs = makeTrack(seed * 4099);
      const bars = obs.filter((o) => o.kind === 'bar');
      expect(bars).toHaveLength(3);
      for (const b of bars) {
        expect(b.x).toBeGreaterThanOrEqual(10);
        expect(b.x + b.len).toBeLessThanOrEqual(TRACK_LEN - 5);
        const i = obs.indexOf(b);
        if (i > 0) expect(b.x - (obs[i - 1].x + obs[i - 1].len)).toBeGreaterThanOrEqual(6 - 0.011);
        if (i < obs.length - 1) expect(obs[i + 1].x - (b.x + b.len)).toBeGreaterThanOrEqual(6 - 0.011);
      }
    }
  });

  it('같은 시드는 같은 배치, 다른 시드는 다른 배치', () => {
    expect(makeTrack(1234)).toEqual(makeTrack(1234));
    expect(makeTrack(1234)).not.toEqual(makeTrack(1235));
  });
});

describe('AI', () => {
  it('출발 반응 0.2~0.5초, 33~37.5초에 도착한다', () => {
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

  it('낮은 막대: 잘 넘기로 했으면 슬라이딩으로 지나가고, 실수하기로 했으면 그대로 부딪힌다', () => {
    const obs: Obstacle[] = [{ id: 0, kind: 'bar', x: 30, len: 0.3 }];
    for (const good of [true, false]) {
      const plan = { react: 0.3, jump: { 0: good } };
      const r = newRunner();
      const seen = new Set<string>();
      for (let i = 0; i < 60 / DT && r.finishMs === null; i++) {
        stepRunner(r, obs, aiPress(r, obs, plan));
        r.events.forEach((e) => seen.add(e));
        r.events.length = 0;
      }
      expect(seen.has('slide')).toBe(good);
      expect(seen.has('bar')).toBe(!good);
      expect(seen.has('jump')).toBe(false);
    }
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
      // 낮은 막대는 슬라이딩으로 지나간다
      expect(seen.has('bar')).toBe(false);
      expect(seen.has('slide')).toBe(true);
      expect(seen.has('boost')).toBe(true);
      expect(r.finishMs! / 1000).toBeLessThan(BASE + 0.4);
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

  it('등급: 해 30.75초 · 달 33초 · 별 37.5초 · 구름', () => {
    expect(tierOf(30750)).toBe('gold');
    expect(tierOf(30751)).toBe('silver');
    expect(tierOf(33000)).toBe('silver');
    expect(tierOf(33001)).toBe('bronze');
    expect(tierOf(37500)).toBe('bronze');
    expect(tierOf(37501)).toBe('white');
  });

  it('기록은 0.01초 단위로 표시', () => {
    expect(formatTime(20200)).toBe('20.20');
    expect(formatTime(20349)).toBe('20.34');
    expect(formatTime(9050)).toBe('9.05');
  });
});
