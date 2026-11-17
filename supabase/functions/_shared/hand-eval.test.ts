import { describe, expect, it } from 'vitest';
import { compareHands, evaluate5, evaluate7, HandCat, KOREAN, STANDARD } from './hand-eval.ts';
import { computeSidePots, splitPot } from './pots.ts';

const h = (s: string) => s.split(' ');

describe('hand-eval: 세븐포커(KOREAN) 기본값 유지', () => {
  it('백스트레이트(A-5)는 마운틴 다음으로 높다', () => {
    const wheel = evaluate5(h('AS 2D 3H 4C 5S'));
    const six = evaluate5(h('2S 3D 4H 5C 6S'));
    const mountain = evaluate5(h('TS JD QH KC AS'));
    expect(compareHands(wheel, six)).toBeGreaterThan(0);
    expect(compareHands(mountain, wheel)).toBeGreaterThan(0);
  });
  it('숫자까지 같으면 무늬로 가린다', () => {
    const a = evaluate5(h('AS AD 9H 7C 3S'));
    const b = evaluate5(h('AH AC 9S 7D 3C'));
    expect(compareHands(a, b)).toBeGreaterThan(0);
    // 기본값이 KOREAN과 같다
    expect(compareHands(a, b, KOREAN)).toBe(compareHands(a, b));
  });
});

describe('hand-eval: 홀덤(STANDARD)', () => {
  it('A-2-3-4-5는 가장 낮은 스트레이트', () => {
    const wheel = evaluate5(h('AS 2D 3H 4C 5S'), STANDARD);
    const six = evaluate5(h('2S 3D 4H 5C 6S'), STANDARD);
    expect(wheel.cat).toBe(HandCat.STRAIGHT);
    expect(compareHands(wheel, six, STANDARD)).toBeLessThan(0);
  });
  it('스티플도 A-5가 가장 낮다', () => {
    const a = evaluate5(h('AS 2S 3S 4S 5S'), STANDARD);
    const b = evaluate5(h('2H 3H 4H 5H 6H'), STANDARD);
    expect(a.cat).toBe(HandCat.STRAIGHT_FLUSH);
    expect(compareHands(a, b, STANDARD)).toBeLessThan(0);
  });
  it('무늬 비교 없음: 숫자까지 같으면 0 (무승부)', () => {
    const a = evaluate5(h('AS AD 9H 7C 3S'), STANDARD);
    const b = evaluate5(h('AH AC 9S 7D 3C'), STANDARD);
    expect(compareHands(a, b, STANDARD)).toBe(0);
  });
  it('키커 비교: 같은 원페어면 다음 높은 숫자', () => {
    const board = h('AS 9D 7H 4C 2S');
    const a = evaluate7([...board, 'AD', 'KC'], STANDARD);
    const b = evaluate7([...board, 'AH', 'QC'], STANDARD);
    expect(compareHands(a, b, STANDARD)).toBeGreaterThan(0);
  });
  it('보드가 가장 좋으면 둘 다 보드로 무승부', () => {
    const board = h('TS JD QH KC AS');
    const a = evaluate7([...board, '2D', '3C'], STANDARD);
    const b = evaluate7([...board, '4D', '5C'], STANDARD);
    expect(compareHands(a, b, STANDARD)).toBe(0);
  });
  it('7장 중 최고 5장: 플러시가 스트레이트를 이긴다', () => {
    const v = evaluate7(h('2H 5H 9H JH KH TD QC'), STANDARD);
    expect(v.cat).toBe(HandCat.FLUSH);
  });
});

describe('pots', () => {
  it('올인 단계별 사이드 팟, 폴드한 돈은 남고 자격은 없다', () => {
    const pots = computeSidePots([
      { seat: 0, total: 100, folded: false, allIn: true },
      { seat: 1, total: 300, folded: false, allIn: false },
      { seat: 2, total: 300, folded: false, allIn: false },
      { seat: 3, total: 50, folded: true, allIn: false },
    ]);
    expect(pots).toEqual([
      { amount: 350, eligible: [0, 1, 2] },
      { amount: 400, eligible: [1, 2] },
    ]);
  });
  it('나머지 칩은 순서 앞쪽(버튼 다음) 승자에게', () => {
    expect(splitPot(101, [1, 3], [3, 0, 1, 2])).toEqual({ 3: 51, 1: 50 });
    expect(splitPot(100, [0, 2], [1, 2, 3, 0])).toEqual({ 0: 50, 2: 50 });
    expect(splitPot(10, [0, 1, 2], [2, 0, 1])).toEqual({ 2: 4, 0: 3, 1: 3 });
  });
});
