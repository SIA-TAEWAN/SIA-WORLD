import { describe, expect, it } from 'vitest';
import { BADGES, TUMBLER_FALLS, badgesOf, newTally, tallyEvent, type Tally } from '../src/game/badges';
import { DT, OBSTACLE_COUNTS } from '../src/game/constants';
import { newRunner, stepRunner, type Press, type SimEvent } from '../src/game/sim';
import { aiPress, type AiPlan } from '../src/game/ai';
import { makeTrack } from '../src/game/track';

type Ev = [SimEvent, number];
const ids = (t: Tally, boosts = 3) => badgesOf(t, boosts).map((b) => b.id);
const feed = (evs: Ev[]) => {
  const t = newTally();
  for (const [ev, at] of evs) tallyEvent(t, ev, at);
  return t;
};

describe('배지 집계 (tallyEvent)', () => {
  it('넘어짐(허들·낮은 막대·통나무·바나나)·부스트·점프·슬라이딩·진흙을 센다', () => {
    const t = feed([['start', 0.3], ['jump', 2], ['land', 2.5], ['hurdle', 4], ['getup', 5], ['bar', 6], ['log', 8], ['banana', 9], ['boost', 10], ['slide', 11], ['slideEnd', 11.4], ['mud', 12], ['finish', 33]]);
    expect(t).toEqual({ startT: 0.3, falls: 4, boosts: 1, jumps: 1, slides: 1, muds: 1, finished: true });
  });
  it('출발 시각은 처음 한 번만 적는다', () => {
    expect(feed([['start', 0.1], ['start', 5]]).startT).toBe(0.1);
  });
});

describe('배지 (badgesOf)', () => {
  it('무결점 완주: 한 번도 안 넘어지고 완주', () => {
    expect(ids(feed([['start', 0.4], ['mud', 3], ['finish', 31]]))).toEqual(['clean']);
    expect(ids(feed([['start', 0.4], ['banana', 3], ['finish', 31]]))).toEqual([]);
    // 완주하지 못하면 없다
    expect(ids(feed([['start', 0.4]]))).toEqual([]);
  });
  it('칼출발 배지는 없다 (아주 빨리 출발해도. 4단계에서 출발 반응 표시로 대신)', () => {
    expect(ids(feed([['start', 0.05]]))).toEqual([]);
    expect(Object.keys(BADGES)).toEqual(['clean', 'boostAll', 'tumbler']);
  });
  it('부스트 싹쓸이: 트랙의 부스트 발판을 모두', () => {
    expect(ids(feed([['start', 1], ['boost', 2], ['boost', 3], ['boost', 4]]), 3)).toEqual(['boostAll']);
    expect(ids(feed([['start', 1], ['boost', 2], ['boost', 3]]), 3)).toEqual([]);
    expect(ids(newTally(), 0)).toEqual([]); // 발판이 없는 트랙
  });
  it('오뚝이: 여러 번 넘어지고도 완주', () => {
    const falls = (n: number, finish: boolean) => {
      const evs: Ev[] = [['start', 1]];
      for (let i = 0; i < n; i++) evs.push(['hurdle', 5 + i]);
      if (finish) evs.push(['finish', 40]);
      return feed(evs);
    };
    expect(ids(falls(TUMBLER_FALLS, true))).toEqual(['tumbler']);
    expect(ids(falls(TUMBLER_FALLS - 1, true))).toEqual([]);
    expect(ids(falls(TUMBLER_FALLS, false))).toEqual([]);
  });
  it('여러 개를 한꺼번에, 정해진 순서로', () => {
    const t = feed([['start', 0.05], ['boost', 2], ['boost', 3], ['boost', 4], ['finish', 29]]);
    expect(badgesOf(t, 3)).toEqual([BADGES.clean, BADGES.boostAll]);
  });
  it('결과가 미완주면 완주 배지는 없다 (내 기기에서는 결승선을 넘었어도)', () => {
    const clean = feed([['start', 0.05], ['boost', 2], ['boost', 3], ['boost', 4], ['finish', 29]]);
    expect(badgesOf(clean, 3, false)).toEqual([BADGES.boostAll]);
    const evs: Ev[] = [['start', 1]];
    for (let i = 0; i < TUMBLER_FALLS; i++) evs.push(['hurdle', 5 + i]);
    evs.push(['finish', 40]);
    expect(badgesOf(feed(evs), 3, false)).toEqual([]);
    expect(badgesOf(feed(evs), 3, true)).toEqual([BADGES.tumbler]);
  });
});

describe('실제 달리기에서 센 배지', () => {
  /** 계획대로 달리며 생긴 일을 센다 (RaceGame.update 가 하는 것과 같은 방법) */
  function run(seed: number, plan: AiPlan) {
    const obs = makeTrack(seed);
    const r = newRunner();
    const t = newTally();
    for (let i = 0; i < 90 / DT && r.finishMs === null; i++) {
      const press: Press = aiPress(r, obs, plan);
      const seen = r.events.length;
      stepRunner(r, obs, press);
      for (let k = seen; k < r.events.length; k++) tallyEvent(t, r.events[k], r.t);
      r.events.length = 0;
    }
    return t;
  }
  const planOf = (seed: number, react: number, good: boolean): AiPlan => {
    const jump: Record<number, boolean> = {};
    for (const o of makeTrack(seed)) jump[o.id] = good ? o.kind !== 'boost' : false;
    return { react, jump };
  };
  it('방해물을 모두 잘 넘고 발판을 모두 밟으면 무결점 완주 + 부스트 싹쓸이', () => {
    for (const seed of [11, 222, 3333]) {
      const t = run(seed, planOf(seed, 0.1, true));
      expect(t.finished).toBe(true);
      expect(t.startT).toBeCloseTo(0.1, 1);
      expect(t.boosts).toBe(OBSTACLE_COUNTS.boost);
      expect(ids(t), `seed ${seed}`).toEqual(['clean', 'boostAll']);
    }
  });
  it('아무것도 안 넘으면 계속 넘어져 오뚝이만 받는다 (발판은 모두 밟는다)', () => {
    const t = run(77, planOf(77, 0.4, false));
    expect(t.finished).toBe(true);
    expect(t.falls).toBeGreaterThanOrEqual(TUMBLER_FALLS);
    expect(ids(t)).toEqual(['boostAll', 'tumbler']);
  });
});
