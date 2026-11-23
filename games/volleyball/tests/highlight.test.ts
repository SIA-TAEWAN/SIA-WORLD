import { describe, expect, it } from 'vitest';
import { RALLY_MAX_STAGE, RALLY_STAGE_TICKS, STEP_MS, TICK_RATE } from '../src/game/constants';
import { copyHighlight, highlightView, newHighlight, packHighlight, tally, unpackHighlight, type Highlight } from '../src/game/highlight';
import { createState, step, type SimEvent } from '../src/game/sim';
import { Match, type MatchResult } from '../src/match/game';
import { ai, chaser, type PolicyMaker } from './helpers';

/** 한 경기를 끝까지 돌리며 집계한다. 따로 센 값(알림의 틱으로 계산)도 함께 돌려준다 */
function run(left: PolicyMaker, right: PolicyMaker, seed: number, withTally = true) {
  const s = createState(seed);
  const pl = left(0, seed * 7 + 1);
  const pr = right(1, seed * 13 + 5);
  const h = newHighlight();
  const all: SimEvent[] = [];
  // 따로 세기: 랠리 길이 = 득점 틱 − 서브 틱, 단계 = 가속 알림의 최댓값, 터치 = 타격 알림 수
  let serveTick = 0;
  const want: Highlight = newHighlight();
  while (s.phase !== 'over' && s.tick < TICK_RATE * 60 * 20) {
    const from = all.length;
    step(s, [pl(s), pr(s)], all);
    if (withTally) tally(h, s, all, from);
    for (const e of all.slice(from)) {
      if (e.t === 'serve') serveTick = s.tick;
      if (e.t === 'point') want.longest = Math.max(want.longest, s.tick - serveTick);
      if (e.t === 'speedup') want.maxStage = Math.max(want.maxStage, e.stage);
      if (e.t === 'hit') want.touches[e.side]++;
    }
  }
  return { s, h, want };
}

describe('하이라이트 집계 (순수 함수)', () => {
  it('빈 값에서 시작한다', () => {
    expect(newHighlight()).toEqual({ longest: 0, maxStage: 0, touches: [0, 0] });
  });

  it('상태의 rallyTicks·stage 는 가장 큰 값만 남고, 타격 알림은 자리별로 센다', () => {
    const h = newHighlight();
    tally(h, { rallyTicks: 40, stage: 0 }, [{ t: 'hit', side: 0, x: 0, y: 0, power: 11 }, { t: 'jump', side: 1 }] as SimEvent[]);
    tally(h, { rallyTicks: 700, stage: 1 }, [{ t: 'hit', side: 1, x: 0, y: 0, power: 11 }, { t: 'hit', side: 1, x: 0, y: 0, power: 11 }, { t: 'wall', x: 0, y: 0 }] as SimEvent[]);
    // 다음 서브: rallyTicks·stage 가 0으로 돌아가도 기록은 남는다
    tally(h, { rallyTicks: 1, stage: 0 }, []);
    expect(h).toEqual({ longest: 700, maxStage: 1, touches: [1, 2] });
  });

  it('알림 목록이 쌓여 있어도 from 자리부터만 센다 (같은 타격을 두 번 세지 않는다)', () => {
    const h = newHighlight();
    const evs: SimEvent[] = [{ t: 'hit', side: 0, x: 0, y: 0, power: 11 }];
    tally(h, { rallyTicks: 1, stage: 0 }, evs, 0);
    evs.push({ t: 'hit', side: 0, x: 0, y: 0, power: 11 }, { t: 'hit', side: 1, x: 0, y: 0, power: 11 });
    tally(h, { rallyTicks: 2, stage: 0 }, evs, 1);
    tally(h, { rallyTicks: 3, stage: 0 }, evs, evs.length);
    expect(h.touches).toEqual([2, 1]);
  });

  for (const seed of [3, 11, 29, 104]) {
    it(`실제 경기(시드 ${seed}): 알림으로 따로 센 값과 같다`, () => {
      const { s, h, want } = run(ai(), chaser(), seed);
      expect(s.phase).toBe('over');
      expect(h).toEqual(want);
      expect(h.longest).toBeGreaterThan(0);
      expect(h.touches[0] + h.touches[1]).toBeGreaterThan(0);
      // 최고 단계는 가장 긴 랠리에서 나온다: 10초마다 한 단계, 최대 5
      expect(h.maxStage).toBe(Math.min(RALLY_MAX_STAGE, Math.floor(h.longest / RALLY_STAGE_TICKS)));
    });
  }

  it('집계는 계산 결과를 바꾸지 않는다 (집계를 하든 안 하든 끝 상태가 같다)', () => {
    const a = run(ai(), ai(), 17, true);
    const b = run(ai(), ai(), 17, false);
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
  });

  it('같은 조작이면 어느 기기에서 모아도 같은 값이 나온다 (결정적)', () => {
    expect(run(ai(), chaser(), 51).h).toEqual(run(ai(), chaser(), 51).h);
  });
});

describe('하이라이트 통신 값', () => {
  it('묶었다 풀면 그대로 (JSON 을 거쳐도)', () => {
    const h: Highlight = { longest: 1234, maxStage: 2, touches: [17, 9] };
    expect(packHighlight(h)).toEqual([1234, 2, 17, 9]);
    expect(unpackHighlight(JSON.parse(JSON.stringify(packHighlight(h))))).toEqual(h);
    const c = copyHighlight(h);
    c.touches[0]++;
    expect(h.touches[0]).toBe(17);
  });

  it('이상한 값은 버린다', () => {
    for (const bad of [null, undefined, {}, 'x', [1, 2, 3], [1, 2, 3, 4, 5], [-1, 0, 0, 0], [10, 6, 0, 0], [10, 1.5, 0, 0], [NaN, 0, 0, 0], [10, 0, '3', 0], [10, 0, 0, Infinity], [1e9, 0, 0, 0]])
      expect(unpackHighlight(bad)).toBeNull();
  });
});

describe('하이라이트 글 (결과 화면)', () => {
  it('최장 랠리는 초(소수 한 자리), 최고 가속은 +%, 터치는 내 자리 것', () => {
    const h: Highlight = { longest: 738, maxStage: 1, touches: [14, 6] };
    expect(highlightView(h, 0)).toEqual({ rally: '12.3초', speed: '+10%', touches: '14번' });
    expect(highlightView(h, 1).touches).toBe('6번');
    expect(highlightView({ longest: 3000, maxStage: 5, touches: [0, 0] }, 0)).toMatchObject({ rally: '50.0초', speed: '+50%' });
  });

  it('한 번도 빨라지지 않았으면 "없음"', () => {
    expect(highlightView({ longest: 90, maxStage: 0, touches: [1, 0] }, 0)).toEqual({ rally: '1.5초', speed: '없음', touches: '1번' });
  });
});

describe('AI 대전 한 경기의 결과에 하이라이트가 담긴다', () => {
  it('끝날 때까지 돌리면 결과에 최장 랠리·최고 단계·터치 수가 있다', () => {
    const m = new Match({ mode: 'ai', mySide: 0, seed: 21, bg: 0, fighters: [{ name: '나', char: 'tiger', ai: false }, { name: 'AI', char: 'pig', ai: true }] });
    const got: MatchResult[] = [];
    m.onOver = (r) => got.push(r);
    let now = 0;
    let hits = 0;
    let stage = 0;
    for (let i = 0; i < TICK_RATE * 60 * 20 && got.length === 0; i++) {
      m.update((now += STEP_MS));
      for (const e of m.events.splice(0)) {
        if (e.t === 'hit') hits++;
        if (e.t === 'speedup') stage = Math.max(stage, e.stage);
      }
    }
    expect(got).toHaveLength(1);
    const h = got[0].highlight!;
    expect(h.longest).toBeGreaterThan(0);
    expect(h.touches[0] + h.touches[1]).toBe(hits);
    expect(h.maxStage).toBe(stage);
    expect(m.highlight()).toEqual(h);
  });
});
