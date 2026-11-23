import { describe, expect, it } from 'vitest';
import { DT, REACT_GOOD, REACT_LUCKY, REACT_PERFECT } from '../src/game/constants';
import { loadBestReaction, nextBestReaction, reactionLine, reactionOf, reactionPop, reactionText, saveBestReaction } from '../src/game/reaction';
import { newTally, tallyEvent } from '../src/game/badges';
import { newRunner, stepRunner } from '../src/game/sim';

/** 걸음 n 에 출발했을 때의 시각 (Runner.t 가 쌓이는 그대로) */
function startAt(step: number): number {
  const r = newRunner();
  const tally = newTally();
  for (let i = 1; i <= step; i++) {
    const seen = r.events.length;
    stepRunner(r, [], i === step);
    for (let k = seen; k < r.events.length; k++) tallyEvent(tally, r.events[k], r.t);
  }
  return tally.startT!;
}

describe('출발 반응', () => {
  it('상수: PERFECT 0.25 · GOOD 0.40 · 운 0.10', () => {
    expect([REACT_PERFECT, REACT_GOOD, REACT_LUCKY]).toEqual([0.25, 0.4, 0.1]);
  });

  it('출발 안 함(실격·출발 전)이면 없다', () => {
    expect(reactionOf(null)).toBeNull();
    expect(reactionOf(undefined)).toBeNull();
    expect(reactionOf(NaN)).toBeNull();
    expect(reactionOf(-0.1)).toBeNull();
  });

  it('판정 경계: 0.25 이하 PERFECT, 0.40 이하 GOOD, 그 뒤 LATE (보이는 0.01초 값으로)', () => {
    expect(reactionOf(0.21)).toMatchObject({ ms: 210, text: '0.21', grade: 'PERFECT', lucky: false });
    expect(reactionOf(0.25)).toMatchObject({ text: '0.25', grade: 'PERFECT' });
    expect(reactionOf(0.251)).toMatchObject({ text: '0.26', grade: 'GOOD' });
    expect(reactionOf(0.4)).toMatchObject({ text: '0.40', grade: 'GOOD' });
    expect(reactionOf(0.401)).toMatchObject({ text: '0.41', grade: 'LATE' });
    expect(reactionOf(1.5)).toMatchObject({ text: '1.50', grade: 'LATE' });
  });

  it('0.10초 미만은 운: 표시는 하고 최고 기록에는 넣지 않는다', () => {
    const r = reactionOf(0.05)!;
    expect(r).toMatchObject({ grade: 'PERFECT', lucky: true, text: '0.05' });
    expect(reactionOf(0.1)!.lucky).toBe(false);
    expect(nextBestReaction(null, r)).toEqual({ best: null, improved: false });
    expect(nextBestReaction(300, r)).toEqual({ best: 300, improved: false });
  });

  it('걸음 기준: 출발 걸음의 시각 (걸음 30 = 0.25초 PERFECT, 걸음 31 = 0.26 GOOD, 걸음 48 = 0.40 GOOD, 걸음 49 = LATE)', () => {
    expect(reactionOf(startAt(1))).toMatchObject({ ms: Math.round(DT * 1000), lucky: true });
    expect(reactionOf(startAt(30))).toMatchObject({ ms: 250, text: '0.25', grade: 'PERFECT' });
    expect(reactionOf(startAt(31))).toMatchObject({ ms: 258, text: '0.26', grade: 'GOOD' });
    expect(reactionOf(startAt(48))).toMatchObject({ ms: 400, text: '0.40', grade: 'GOOD' });
    expect(reactionOf(startAt(49))).toMatchObject({ text: '0.41', grade: 'LATE' });
    expect(reactionOf(startAt(12))).toMatchObject({ ms: 100, lucky: false });
  });

  it('표시 글자', () => {
    const r = reactionOf(0.21)!;
    expect(reactionPop(r)).toBe('PERFECT 0.21');
    expect(reactionLine(r)).toBe('반응 0.21초 · PERFECT');
    expect(reactionText(0)).toBe('0.00');
    expect(reactionText(1234)).toBe('1.24');
  });

  it('최고 반응: 더 빠를 때만 바뀐다', () => {
    expect(nextBestReaction(null, reactionOf(0.3))).toEqual({ best: 300, improved: true });
    expect(nextBestReaction(300, reactionOf(0.3))).toEqual({ best: 300, improved: false });
    expect(nextBestReaction(300, reactionOf(0.31))).toEqual({ best: 300, improved: false });
    expect(nextBestReaction(300, reactionOf(0.2))).toEqual({ best: 200, improved: true });
    expect(nextBestReaction(300, null)).toEqual({ best: 300, improved: false });
  });

  it('기기 저장: 사용자별 키, 읽기·쓰기 실패해도 멈추지 않는다', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(loadBestReaction('u1', store)).toBeNull();
    expect(saveBestReaction('u1', reactionOf(0.3), store)).toBe(true);
    expect(saveBestReaction('u1', reactionOf(0.35), store)).toBe(false);
    expect(saveBestReaction('u1', reactionOf(0.05), store)).toBe(false); // 운
    expect(loadBestReaction('u1', store)).toBe(300);
    expect(loadBestReaction('u2', store)).toBeNull();
    expect(mem.get('siarace:react:u1')).toBe('300');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadBestReaction('u1', broken)).toBeNull();
    expect(saveBestReaction('u1', reactionOf(0.2), broken)).toBe(true);
    expect(loadBestReaction('u1', null)).toBeNull();
    mem.set('siarace:react:u3', 'abc');
    expect(loadBestReaction('u3', store)).toBeNull();
  });
});
