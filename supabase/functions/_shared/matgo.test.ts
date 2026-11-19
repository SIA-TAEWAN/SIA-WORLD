import { describe, expect, it } from 'vitest';
import { EngineError, seededRng } from './engine.ts';
import type { Rng, SeatInfo } from './engine.ts';
import {
  applyGo, CARDS, cardById, dealOrder, makeTestState, matgo, scoreCards,
} from './matgo.ts';
import type { MatgoAction, MatgoState, MatgoSummary, MatgoTestSetup } from './matgo.ts';

const R = seededRng(1);
const ALL_IDS = CARDS.map((c) => c.id).sort();
const act = (s: MatgoState, seat: number, a: MatgoAction) => matgo.apply(s, seat, a, R);
const play = (s: MatgoState, seat: number, card: string, shake?: boolean) =>
  act(s, seat, shake ? { type: 'play', card, shake } : { type: 'play', card });
const types = (s: MatgoState) => s.events.map((e) => e.t);
/** 항상 같은 값을 주는 난수 (AI의 15% 무작위를 끄려고 0.9) */
const fixedRng = (v = 0.9): Rng => ({ next: () => v, int: () => 0 });
const summary = (s: MatgoState) => matgo.settle(s).summary as MatgoSummary;

const GW3 = ['m01-gwang', 'm03-gwang', 'm08-gwang'];
const HONG = ['m01-tti', 'm02-tti', 'm03-tti'];
const PI8 = ['m02-pi1', 'm02-pi2', 'm04-pi1', 'm04-pi2', 'm06-pi1', 'm06-pi2', 'm09-pi1', 'm09-pi2'];
/** 3광(3) + 홍단(3) + 피 8장 → 마지막에 피 2장을 더 먹으면 피 10장(1) = 7점 */
const WIN7 = [...GW3, ...HONG, ...PI8];

/**
 * 첫째 자리가 m10-pi1로 바닥 m10-pi2를 먹고 손패가 비어 자동 스톱하는 판.
 * 승자 먹은 패 = w + [m10-pi1, m10-pi2], 패자 먹은 패 = l.
 */
function winBy(w: string[], l: string[], o: Partial<MatgoTestSetup> = {}, pre?: (s: MatgoState) => void) {
  const s = makeTestState({ hands: [['m10-pi1'], ['m05-pi1']], floor: ['m10-pi2'], pile: ['m07-pi1'], captured: [w, l], ...o });
  pre?.(s);
  const out = act(s, s.seats[0], { type: 'play', card: 'm10-pi1' });
  expect(out.phase).toBe('done');
  return out;
}

describe('카드 구성', () => {
  it('48장, id 고유, 달마다 4장', () => {
    expect(CARDS).toHaveLength(48);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(48);
    for (let m = 1; m <= 12; m++) expect(CARDS.filter((c) => c.month === m)).toHaveLength(4);
  });
  it('광 5, 열끗 9, 띠 10, 피 24 (쌍피 2장 포함, 피 값 합 26)', () => {
    const n = (k: string) => CARDS.filter((c) => c.kind === k).length;
    expect([n('gwang'), n('yeol'), n('tti'), n('pi')]).toEqual([5, 9, 10, 24]);
    expect(CARDS.filter((c) => c.ssangpi).map((c) => c.id).sort()).toEqual(['m11-ssangpi', 'm12-ssangpi']);
    expect(scoreCards(CARDS.filter((c) => c.kind === 'pi').map((c) => c.id)).counts.pi).toBe(26);
  });
  it('광은 1·3·8·11·12월, 비광은 12월', () => {
    expect(CARDS.filter((c) => c.kind === 'gwang').map((c) => c.month)).toEqual([1, 3, 8, 11, 12]);
    expect(CARDS.filter((c) => c.bigwang).map((c) => c.id)).toEqual(['m12-gwang']);
  });
  it('고도리 2·4·8월, 단 구성, 비띠는 단 없음, 국진은 9월 열끗', () => {
    expect(CARDS.filter((c) => c.godori).map((c) => c.month)).toEqual([2, 4, 8]);
    const dan = (d: string) => CARDS.filter((c) => c.dan === d).map((c) => c.month);
    expect(dan('hong')).toEqual([1, 2, 3]);
    expect(dan('cheong')).toEqual([6, 9, 10]);
    expect(dan('cho')).toEqual([4, 5, 7]);
    expect(cardById('m12-tti').dan).toBeNull();
    expect(cardById('m12-tti').kind).toBe('tti');
    expect(CARDS.filter((c) => c.gukjin).map((c) => c.id)).toEqual(['m09-yeol']);
  });
  it('십이지신 동물과 이름', () => {
    expect(cardById('m01-gwang').animal).toBe('쥐');
    expect(cardById('m12-gwang').animal).toBe('돼지');
    expect(cardById('m12-gwang').name).toBe('12월 돼지 비광');
    expect(cardById('m09-yeol').name).toBe('9월 원숭이 국진');
  });
  it('없는 카드는 EngineError', () => {
    expect(() => cardById('m13-pi1')).toThrow(EngineError);
  });
});

describe('점수 계산', () => {
  it('광 3장: 비광 없으면 3, 비광 포함 2', () => {
    expect(scoreCards(GW3).total).toBe(3);
    expect(scoreCards(['m01-gwang', 'm03-gwang', 'm12-gwang']).total).toBe(2);
    expect(scoreCards(['m01-gwang', 'm03-gwang']).total).toBe(0);
  });
  it('광 4장 4 (비광 포함도 4), 5장 15', () => {
    expect(scoreCards([...GW3, 'm11-gwang']).total).toBe(4);
    expect(scoreCards([...GW3, 'm12-gwang']).total).toBe(4);
    expect(scoreCards([...GW3, 'm11-gwang', 'm12-gwang']).total).toBe(15);
  });
  it('열끗 4장 0, 5장 1, 6장 2', () => {
    const y = ['m05-yeol', 'm06-yeol', 'm07-yeol', 'm10-yeol', 'm12-yeol', 'm09-yeol'];
    expect(scoreCards(y.slice(0, 4)).total).toBe(0);
    expect(scoreCards(y.slice(0, 5)).total).toBe(1);
    expect(scoreCards(y).total).toBe(2);
  });
  it('고도리 5 (2장이면 0)', () => {
    expect(scoreCards(['m02-yeol', 'm04-yeol', 'm08-yeol']).total).toBe(5);
    expect(scoreCards(['m02-yeol', 'm04-yeol', 'm05-yeol']).total).toBe(0);
    // 고도리 + 열끗 5장
    expect(scoreCards(['m02-yeol', 'm04-yeol', 'm08-yeol', 'm05-yeol', 'm06-yeol']).total).toBe(6);
  });
  it('띠 4장 0, 5장 1, 6장 2 (단 없이)', () => {
    const t = ['m01-tti', 'm04-tti', 'm06-tti', 'm12-tti', 'm09-tti', 'm05-tti'];
    expect(scoreCards(t.slice(0, 4)).total).toBe(0);
    expect(scoreCards(t.slice(0, 5)).total).toBe(1);
    expect(scoreCards(t).total).toBe(2);
  });
  it('홍단·청단·초단 각 3', () => {
    expect(scoreCards(HONG).total).toBe(3);
    expect(scoreCards(['m06-tti', 'm09-tti', 'm10-tti']).total).toBe(3);
    expect(scoreCards(['m04-tti', 'm05-tti', 'm07-tti']).total).toBe(3);
    // 홍단 + 청단 + 띠 6장 = 3 + 3 + 2
    expect(scoreCards([...HONG, 'm06-tti', 'm09-tti', 'm10-tti']).total).toBe(8);
  });
  it('비띠는 어느 단도 채우지 못한다', () => {
    expect(scoreCards(['m01-tti', 'm02-tti', 'm12-tti']).total).toBe(0);
    expect(scoreCards(['m06-tti', 'm09-tti', 'm12-tti']).total).toBe(0);
    expect(scoreCards(['m04-tti', 'm05-tti', 'm12-tti']).total).toBe(0);
  });
  it('피 9장 0, 10장 1, 11장 2 / 쌍피는 2장', () => {
    const p = [...PI8, 'm01-pi1', 'm01-pi2', 'm03-pi1'];
    expect(scoreCards(p.slice(0, 9)).total).toBe(0);
    expect(scoreCards(p.slice(0, 10)).total).toBe(1);
    expect(scoreCards(p).total).toBe(2);
    expect(scoreCards([...PI8, 'm11-ssangpi']).counts.pi).toBe(10);
    expect(scoreCards([...PI8, 'm11-ssangpi']).total).toBe(1);
    expect(scoreCards([...PI8.slice(0, 6), 'm11-ssangpi', 'm12-ssangpi']).total).toBe(1);
  });
  it('국진: 열끗으로 쓰면 열끗, 쌍피로 쓰면 피 2장', () => {
    const y4 = ['m05-yeol', 'm06-yeol', 'm07-yeol', 'm10-yeol'];
    expect(scoreCards([...y4, 'm09-yeol'], 'yeol').total).toBe(1);
    expect(scoreCards([...y4, 'm09-yeol'], 'ssangpi').total).toBe(0);
    expect(scoreCards([...PI8, 'm09-yeol'], 'ssangpi').total).toBe(1);
    expect(scoreCards([...PI8, 'm09-yeol'], 'ssangpi').counts.yeol).toBe(0);
    expect(scoreCards([...PI8, 'm09-yeol'], null).total).toBe(0);
  });
  it('고 보너스: 1고 +1, 2고 +2, 3고 ×2, 4고 ×4', () => {
    expect(applyGo(7, 0)).toBe(7);
    expect(applyGo(7, 1)).toBe(8);
    expect(applyGo(7, 2)).toBe(9);
    expect(applyGo(7, 3)).toBe(18);
    expect(applyGo(7, 4)).toBe(36);
    expect(applyGo(10, 5)).toBe(96);
  });
});

describe('시작', () => {
  const seats: SeatInfo[] = [
    { seat: 4, kind: 'human', name: '나', stack: 10000 },
    { seat: 9, kind: 'ai', name: 'AI 호랑이', stack: null },
  ];
  it('10·10장, 바닥 8장, 더미 20장', () => {
    const s = matgo.newRound({ seats, baseUnit: 100, carry: null, rng: seededRng(3) });
    if (s.phase === 'done') return; // 총통 (드묾)
    expect(s.hands[0]).toHaveLength(10);
    expect(s.hands[1]).toHaveLength(10);
    expect(s.floor).toHaveLength(8);
    expect(s.pile).toHaveLength(20);
    expect([...s.hands[0], ...s.hands[1], ...s.floor, ...s.pile].sort()).toEqual(ALL_IDS);
  });
  it('carry.first가 선, 자리 번호를 그대로 쓴다', () => {
    const s = matgo.newRound({ seats, baseUnit: 100, carry: { first: 9, nagari: 1 }, rng: seededRng(5) });
    expect(s.first).toBe(1);
    expect(s.turn).toBe(1);
    if (s.phase !== 'done') expect(matgo.pending(s)).toEqual([9]);
  });
  it('2명이 아니면 EngineError', () => {
    expect(() => matgo.newRound({ seats: [seats[0]], baseUnit: 100, carry: null, rng: seededRng(1) })).toThrow(EngineError);
  });
  it('바닥에 같은 달 4장이 깔리면 다시 섞는다', () => {
    // 섞기를 무력화한 난수: 처음 47번은 제자리 → 달 순서 그대로 (바닥 = 6월 4장 + 7월 4장)
    const base = seededRng(11);
    let n = 0;
    const rigged: Rng = { next: () => base.next(), int: (k) => (n++ < 47 ? k - 1 : base.int(k)) };
    expect(dealOrder(CARDS.map((c) => c.id))).toBeNull();
    const s = matgo.newRound({ seats, baseUnit: 100, carry: null, rng: rigged });
    expect(s.redeals).toBeGreaterThanOrEqual(1);
    for (let m = 1; m <= 12; m++) expect(s.floor.filter((id) => cardById(id).month === m).length).toBeLessThan(4);
    expect([...s.hands[0], ...s.hands[1], ...s.floor, ...s.pile].sort()).toEqual(ALL_IDS);
  });
  it('여러 시드에서 바닥 4장 같은 달은 절대 없다', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = matgo.newRound({ seats, baseUnit: 100, carry: null, rng: seededRng(seed) });
      for (let m = 1; m <= 12; m++) expect(s.floor.filter((id) => cardById(id).month === m).length).toBeLessThan(4);
    }
  });
});

describe('패 내기와 먹기', () => {
  it('바닥에 같은 달 1장 → 두 장 먹음, 못 맞춘 뒤집은 패는 바닥에', () => {
    let s = makeTestState({ hands: [['m05-yeol', 'm01-pi1'], ['m06-pi1']], floor: ['m05-pi1', 'm10-pi1'], pile: ['m11-pi1'] });
    s = play(s, 0, 'm05-yeol');
    expect(s.captured[0].sort()).toEqual(['m05-pi1', 'm05-yeol']);
    expect(s.floor.sort()).toEqual(['m10-pi1', 'm11-pi1']);
    expect(s.turn).toBe(1);
    expect(matgo.pending(s)).toEqual([1]);
  });
  it('같은 달 2장(가치 다름) → 낸 사람이 고른다', () => {
    let s = makeTestState({
      hands: [['m01-pi2', 'm02-pi1'], ['m06-pi1']], floor: ['m01-gwang', 'm01-pi1', 'm05-pi1'], pile: ['m09-pi1', 'm04-pi1'],
    });
    s = play(s, 0, 'm01-pi2');
    expect(s.phase).toBe('choose');
    expect(matgo.pending(s)).toEqual([0]);
    const pub = matgo.view(s).public;
    expect(pub.choice).toEqual({ kind: 'choose', seat: 0, stage: 'play', options: ['m01-gwang', 'm01-pi1'] });
    expect(() => act(s, 0, { type: 'choose', card: 'm05-pi1' })).toThrow(EngineError);
    expect(() => act(s, 0, { type: 'go' })).toThrow(EngineError);
    s = act(s, 0, { type: 'choose', card: 'm01-gwang' });
    expect(s.captured[0].sort()).toEqual(['m01-gwang', 'm01-pi2']);
    expect(s.floor.sort()).toEqual(['m01-pi1', 'm05-pi1', 'm09-pi1']);
    expect(s.turn).toBe(1);
  });
  it('같은 가치 2장(일반 피 2장)이면 고르지 않고 자동', () => {
    let s = makeTestState({ hands: [['m04-yeol', 'm01-pi1'], ['m06-pi1']], floor: ['m04-pi1', 'm04-pi2'], pile: ['m09-pi1'] });
    s = play(s, 0, 'm04-yeol');
    expect(s.phase).toBe('play');
    expect(s.captured[0]).toHaveLength(2);
    expect(s.floor.filter((id) => id.startsWith('m04'))).toHaveLength(1);
  });
  it('뒤집은 패가 같은 달 2장에 맞으면 같은 사람이 고른다', () => {
    let s = makeTestState({
      hands: [['m05-pi2', 'm01-pi1'], ['m06-pi1']], floor: ['m02-yeol', 'm02-pi1', 'm05-pi1'], pile: ['m02-pi2', 'm09-pi1'],
    });
    s = play(s, 0, 'm05-pi2');
    expect(s.phase).toBe('choose');
    expect(s.choice?.stage).toBe('flip');
    expect(matgo.view(s).public.turnCards).toEqual({ played: ['m05-pi2'], flipped: 'm02-pi2' });
    s = act(s, 0, { type: 'choose', card: 'm02-yeol' });
    expect(s.captured[0].sort()).toEqual(['m02-pi2', 'm02-yeol', 'm05-pi1', 'm05-pi2']);
    expect(s.floor).toEqual(['m02-pi1']);
  });
  it('차례가 아니거나 손에 없는 패면 EngineError, 입력 상태는 바뀌지 않는다', () => {
    const s = makeTestState({ hands: [['m05-yeol'], ['m06-pi1']], floor: ['m05-pi1'], pile: ['m11-pi1'] });
    const before = JSON.stringify(s);
    expect(() => play(s, 1, 'm06-pi1')).toThrow(EngineError);
    expect(() => play(s, 0, 'm06-pi1')).toThrow(EngineError);
    expect(() => play(s, 7, 'm05-yeol')).toThrow(EngineError);
    expect(() => act(s, 0, { type: 'flip' })).toThrow(EngineError);
    play(s, 0, 'm05-yeol');
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('특수 규칙', () => {
  it('뻑: 1장 맞춘 뒤 같은 달이 뒤집히면 3장이 바닥에 쌓인다', () => {
    let s = makeTestState({ hands: [['m03-pi1', 'm05-pi1'], ['m06-pi1', 'm07-pi1']], floor: ['m03-tti', 'm10-pi1'], pile: ['m03-pi2', 'm11-pi1'] });
    s = play(s, 0, 'm03-pi1');
    expect(s.captured[0]).toEqual([]);
    expect(s.floor.filter((id) => id.startsWith('m03')).sort()).toEqual(['m03-pi1', 'm03-pi2', 'm03-tti']);
    expect(s.ppeok).toEqual([3]);
    expect(types(s)).toContain('ppeok');
    const g = matgo.view(s).public.floor.find((x) => x.month === 3)!;
    expect(g.stacked).toBe(true);
    expect(g.ppeok).toBe(true);
  });
  it('뻑 먹기: 4번째 패로 다 먹고 상대 일반 피 1장', () => {
    let s = makeTestState({
      hands: [['m03-gwang', 'm05-pi1'], ['m06-pi1']], floor: ['m03-tti', 'm03-pi1', 'm03-pi2', 'm10-pi1'], pile: ['m07-pi1'],
      captured: [[], ['m12-ssangpi', 'm11-pi1']], ppeok: [3],
    });
    s = play(s, 0, 'm03-gwang');
    expect(s.captured[0].sort()).toEqual(['m03-gwang', 'm03-pi1', 'm03-pi2', 'm03-tti', 'm11-pi1']);
    expect(s.captured[1]).toEqual(['m12-ssangpi']);
    expect(s.ppeok).toEqual([]);
    expect(types(s)).toContain('ppeok_eat');
    expect(types(s)).toContain('steal');
  });
  it('뒤집은 패로 뻑 더미를 먹어도 피 1장', () => {
    let s = makeTestState({
      hands: [['m01-pi1', 'm05-pi1'], ['m06-pi1']], floor: ['m03-tti', 'm03-pi1', 'm03-pi2'], pile: ['m03-gwang'],
      captured: [[], ['m11-pi1']], ppeok: [3],
    });
    s = play(s, 0, 'm01-pi1');
    expect(s.captured[0]).toContain('m11-pi1');
    expect(s.captured[0].filter((id) => id.startsWith('m03'))).toHaveLength(4);
  });
  it('처음부터 쌓인 같은 달 3장: 4번째로 다 먹지만 피는 안 빼앗는다', () => {
    const s0 = makeTestState({
      hands: [['m04-pi2', 'm01-pi1'], ['m06-pi1']], floor: ['m04-yeol', 'm04-tti', 'm04-pi1', 'm10-pi1'], pile: ['m11-pi1'],
      captured: [[], ['m05-pi1']],
    });
    const g = matgo.view(s0).public.floor.find((x) => x.month === 4)!;
    expect(g).toEqual({ month: 4, cards: ['m04-yeol', 'm04-tti', 'm04-pi1'], stacked: true, ppeok: false });
    const s = play(s0, 0, 'm04-pi2');
    expect(s.captured[0].sort()).toEqual(['m04-pi1', 'm04-pi2', 'm04-tti', 'm04-yeol']);
    expect(s.captured[1]).toEqual(['m05-pi1']);
    expect(types(s)).not.toContain('steal');
  });
  it('쪽: 못 맞춘 패에 같은 달이 뒤집히면 둘 다 먹고 피 1장 (일반 피 없으면 쌍피)', () => {
    let s = makeTestState({
      hands: [['m05-yeol', 'm06-pi1'], ['m07-pi1']], floor: ['m10-pi1'], pile: ['m05-pi1', 'm11-pi1'], captured: [[], ['m11-ssangpi']],
    });
    s = play(s, 0, 'm05-yeol');
    expect(s.captured[0].sort()).toEqual(['m05-pi1', 'm05-yeol', 'm11-ssangpi']);
    expect(s.captured[1]).toEqual([]);
    expect(types(s)).toContain('jjok');
  });
  it('따닥: 바닥 2장 + 낸 패 + 뒤집은 패 4장 다 먹고 피 1장 (상대 피 없으면 못 빼앗음)', () => {
    let s = makeTestState({
      hands: [['m06-yeol', 'm01-pi1'], ['m07-pi1']], floor: ['m06-pi1', 'm06-tti', 'm10-pi1'], pile: ['m06-pi2', 'm11-pi1'],
      captured: [[], ['m02-yeol']],
    });
    s = play(s, 0, 'm06-yeol');
    expect(s.phase).toBe('choose'); // 피·띠 중 고르기
    s = act(s, 0, { type: 'choose', card: 'm06-pi1' });
    expect(s.captured[0].sort()).toEqual(['m06-pi1', 'm06-pi2', 'm06-tti', 'm06-yeol']);
    expect(types(s)).toContain('ttadak');
    expect(types(s)).not.toContain('steal');
    expect(s.captured[1]).toEqual(['m02-yeol']);
  });
  it('쓸: 바닥을 다 비우면 피 1장', () => {
    let s = makeTestState({
      hands: [['m07-yeol', 'm01-pi1'], ['m08-pi1']], floor: ['m07-pi1', 'm10-pi1'], pile: ['m10-yeol', 'm11-pi2'],
      captured: [[], ['m11-ssangpi', 'm11-pi1']],
    });
    s = play(s, 0, 'm07-yeol');
    expect(s.floor).toEqual([]);
    expect(types(s)).toContain('sseul');
    expect(s.captured[0]).toContain('m11-pi1');
    expect(s.captured[1]).toEqual(['m11-ssangpi']);
  });
  it('국진: 먹은 사람이 열끗/쌍피를 고른다', () => {
    let s = makeTestState({ hands: [['m09-pi1', 'm01-pi1'], ['m06-pi1']], floor: ['m09-yeol'], pile: ['m10-pi1'] });
    s = play(s, 0, 'm09-pi1');
    expect(s.phase).toBe('gukjin');
    expect(matgo.pending(s)).toEqual([0]);
    expect(matgo.view(s).public.choice).toEqual({ kind: 'gukjin', seat: 0 });
    expect(() => act(s, 0, { type: 'play', card: 'm01-pi1' })).toThrow(EngineError);
    s = act(s, 0, { type: 'gukjin', as: 'ssangpi' });
    expect(s.gukjinAs).toBe('ssangpi');
    const p = matgo.view(s).public.players[0];
    expect(p.captured.pi.sort()).toEqual(['m09-pi1', 'm09-yeol']);
    expect(p.piCount).toBe(3);
    expect(s.turn).toBe(1);
  });
  it('흔들기: 손에 같은 달 3장 + 바닥 0장일 때만, 3장을 공개', () => {
    const s0 = makeTestState({
      hands: [['m02-yeol', 'm02-tti', 'm02-pi1', 'm05-pi1'], ['m06-pi1', 'm07-pi1']], floor: ['m10-pi1'], pile: ['m11-pi1', 'm11-pi2'],
    });
    expect(matgo.view(s0).private[0].shakeable).toEqual([2]);
    expect(() => play(s0, 0, 'm05-pi1', true)).toThrow(EngineError);
    const s = play(s0, 0, 'm02-yeol', true);
    expect(s.shakes).toEqual([1, 0]);
    const e = s.events.find((x) => x.t === 'shake')!;
    expect(e.seat).toBe(0);
    expect((e.cards as string[]).sort()).toEqual(['m02-pi1', 'm02-tti', 'm02-yeol']);
  });
  it('폭탄: 3장 한꺼번에 내 4장 먹고 피 1장, 이후 2번은 뒤집기만', () => {
    const s0 = makeTestState({
      hands: [['m08-gwang', 'm08-yeol', 'm08-pi1', 'm05-pi1'], ['m06-pi1', 'm07-pi1']], floor: ['m08-pi2', 'm10-pi1'],
      pile: ['m11-pi1', 'm12-yeol', 'm11-pi2', 'm03-pi1'], captured: [[], ['m01-pi1']],
    });
    expect(matgo.view(s0).private[0].bombable).toEqual([8]);
    expect(() => act(s0, 0, { type: 'bomb', month: 5 })).toThrow(EngineError);
    let s = act(s0, 0, { type: 'bomb', month: 8 });
    expect(s.captured[0].sort()).toEqual(['m01-pi1', 'm08-gwang', 'm08-pi1', 'm08-pi2', 'm08-yeol']);
    expect(s.hands[0]).toEqual(['m05-pi1']);
    expect(s.bombs).toEqual([1, 0]);
    expect(s.fill).toEqual([2, 0]);
    expect(types(s)).toContain('bomb');
    s = play(s, 1, 'm06-pi1');
    expect(() => act(s, 1, { type: 'flip' })).toThrow(EngineError);
    expect(matgo.view(s).public.choice).toEqual({ kind: 'play', seat: 0, canFlip: true });
    s = act(s, 0, { type: 'flip' }); // m11-pi2 → 바닥 m11-pi1 먹음
    expect(s.fill).toEqual([1, 0]);
    expect(s.hands[0]).toEqual(['m05-pi1']);
    expect(s.captured[0]).toContain('m11-pi2');
  });
  it('총통: 처음 손패에 같은 달 4장 → 즉시 7점 승리 (나가리 배수 적용)', () => {
    const s = makeTestState({
      hands: [['m04-yeol', 'm04-tti', 'm04-pi1', 'm04-pi2', 'm01-pi1'], ['m05-pi1']], floor: ['m10-pi1'], pile: ['m11-pi1'], nagariMul: 2,
    });
    expect(matgo.done(s)).toBe(true);
    expect(matgo.pending(s)).toEqual([]);
    expect(types(s)).toContain('chongtong');
    const st = matgo.settle(s);
    const sum = st.summary as MatgoSummary;
    expect(sum.chongtong).toBe(true);
    expect(sum.score).toBe(7);
    expect(sum.multipliers).toEqual(['나가리 ×2']);
    expect(sum.amount).toBe(1400);
    expect(st.deltas).toEqual({ 0: 1400, 1: -1400 });
    expect(st.carry).toEqual({ first: 0, nagari: 1 });
  });
});

describe('고 · 스톱', () => {
  const goSetup = (o: Partial<MatgoTestSetup> = {}) => makeTestState({
    hands: [['m10-pi1', 'm05-pi1', 'm07-pi1', 'm11-pi1'], ['m05-tti', 'm07-tti', 'm11-pi2', 'm12-tti']],
    floor: ['m10-pi2', 'm12-yeol'], pile: ['m03-pi1', 'm03-pi2', 'm01-pi1', 'm01-pi2'],
    captured: [WIN7, ['m11-gwang']], ...o,
  });
  it('7점이 되면 고/스톱을 묻고, 고하면 상대 차례', () => {
    let s = play(goSetup(), 0, 'm10-pi1');
    expect(s.phase).toBe('goStop');
    expect(matgo.view(s).public.choice).toEqual({ kind: 'goStop', seat: 0, score: 7, go: 0 });
    expect(() => play(s, 0, 'm05-pi1')).toThrow(EngineError);
    s = act(s, 0, { type: 'go' });
    expect(s.go).toEqual([1, 0]);
    expect(s.goScore).toEqual([7, 0]);
    expect(s.turn).toBe(1);
    expect(s.events.at(-1)).toMatchObject({ t: 'go', seat: 0, count: 1 });
  });
  it('스톱하면 끝나고 정산', () => {
    let s = play(goSetup(), 0, 'm10-pi1');
    s = act(s, 0, { type: 'stop' });
    expect(matgo.done(s)).toBe(true);
    const sum = summary(s);
    expect(sum.winner).toBe(0);
    expect(sum.score).toBe(7);
    expect(sum.goCount).toBe(0);
  });
  it('고 뒤 점수가 오르지 않으면 다시 묻지 않는다', () => {
    const s = play(goSetup({ go: [1, 0], goScore: [7, 0] }), 0, 'm10-pi1');
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(1);
  });
  it('고 뒤 점수가 오르면 다시 묻고, 스톱 점수에 고 보너스', () => {
    let s = play(goSetup({ go: [1, 0], goScore: [6, 0] }), 0, 'm10-pi1');
    expect(s.phase).toBe('goStop');
    s = act(s, 0, { type: 'stop' });
    const sum = summary(s);
    expect(sum.baseScore).toBe(7);
    expect(sum.score).toBe(8);
    expect(sum.breakdown).toContainEqual({ label: '1고', points: 1 });
  });
  it('3고 ×2, 4고 ×4가 정산 점수에 반영', () => {
    let s = act(play(goSetup({ go: [3, 0], goScore: [6, 0] }), 0, 'm10-pi1'), 0, { type: 'stop' });
    expect(summary(s).score).toBe(18);
    expect(summary(s).amount).toBe(1800);
    s = act(play(goSetup({ go: [4, 0], goScore: [6, 0] }), 0, 'm10-pi1'), 0, { type: 'stop' });
    expect(summary(s).score).toBe(36);
  });
  it('손패가 없으면 고를 못 하고 자동 스톱', () => {
    const s = winBy(WIN7, ['m11-gwang']);
    expect(s.winner).toBe(0);
    expect(s.events.find((e) => e.t === 'stop')).toMatchObject({ seat: 0, auto: true });
  });
});

describe('정산 배수', () => {
  const L_GW = 'm11-gwang';
  const PI7 = ['m03-pi1', 'm03-pi2', 'm01-pi1', 'm01-pi2', 'm08-pi1', 'm08-pi2', 'm11-pi1'];
  it('배수 없음: 7점 × 100', () => {
    const sum = summary(winBy(WIN7, [L_GW]));
    expect(sum.multipliers).toEqual([]);
    expect(sum.amount).toBe(700);
  });
  it('피박: 패자 피 1~7장이면 ×2, 0장·8장이면 아님', () => {
    expect(summary(winBy(WIN7, [L_GW, 'm03-pi1'])).multipliers).toEqual(['피박']);
    expect(summary(winBy(WIN7, [L_GW, ...PI7])).multipliers).toEqual(['피박']);
    expect(summary(winBy(WIN7, [L_GW, ...PI7])).amount).toBe(1400);
    expect(summary(winBy(WIN7, [L_GW])).multipliers).toEqual([]);
    expect(summary(winBy(WIN7, [L_GW, ...PI7, 'm11-pi2'])).multipliers).toEqual([]);
  });
  it('피박 장수는 쌍피를 2장으로 센다', () => {
    expect(summary(winBy(WIN7, [L_GW, ...PI7.slice(0, 6), 'm11-ssangpi'])).multipliers).toEqual([]); // 8장
    expect(summary(winBy(WIN7, [L_GW, ...PI7.slice(0, 5), 'm11-ssangpi'])).multipliers).toEqual(['피박']); // 7장
  });
  it('승자가 피로 점수를 못 냈으면 피박 아님', () => {
    const w = [...GW3, ...HONG, 'm06-tti', 'm09-tti', 'm10-tti'];
    const sum = summary(winBy(w, [L_GW, 'm03-pi1']));
    expect(sum.multipliers).toEqual([]);
    expect(sum.score).toBe(11);
  });
  it('광박: 승자 광 점수 + 패자 광 0장 → ×2 (이벤트도)', () => {
    const s = winBy(WIN7, []);
    expect(summary(s).multipliers).toEqual(['광박']);
    expect(summary(s).amount).toBe(1400);
    expect(s.events.find((e) => e.t === 'gwangbak')?.seat).toBe(1);
    expect(summary(winBy(WIN7, ['m12-gwang'])).multipliers).toEqual([]);
  });
  it('멍박: 승자 열끗 7장 이상 → ×2', () => {
    const w = ['m02-yeol', 'm04-yeol', 'm08-yeol', 'm05-yeol', 'm06-yeol', 'm07-yeol', 'm12-yeol'];
    const sum = summary(winBy(w, [L_GW]));
    expect(sum.baseScore).toBe(8);
    expect(sum.multipliers).toEqual(['멍박']);
    expect(sum.amount).toBe(1600);
    expect(summary(winBy([...w.slice(0, 6), ...GW3], [L_GW])).multipliers).toEqual([]);
  });
  it('고박: 고한 사람이 지면 ×2', () => {
    const s = winBy(WIN7, [L_GW], { go: [0, 1], goScore: [0, 7] });
    expect(summary(s).multipliers).toEqual(['고박']);
    expect(summary(s).amount).toBe(1400);
    expect(s.events.find((e) => e.t === 'gobak')?.seat).toBe(1);
  });
  it('흔들기·폭탄은 누가 했든 각각 ×2', () => {
    const s = winBy(WIN7, [L_GW], {}, (x) => {
      x.shakes = [1, 0];
      x.bombs = [0, 1];
    });
    expect(summary(s).multipliers).toEqual(['흔들기', '폭탄']);
    expect(summary(s).amount).toBe(2800);
  });
  it('여러 배수는 곱해진다 (피박·광박·고박·나가리 ×4)', () => {
    const sum = summary(winBy(WIN7, ['m03-pi1'], { go: [0, 1], goScore: [0, 7], nagariMul: 4 }));
    expect(sum.multipliers).toEqual(['피박', '광박', '고박', '나가리 ×4']);
    expect(sum.multiplier).toBe(32);
    expect(sum.amount).toBe(7 * 100 * 32);
  });
  it('패자는 가진 돈까지만 낸다, 자리 번호로 정산', () => {
    const seats: SeatInfo[] = [
      { seat: 3, kind: 'ai', name: 'AI', stack: null },
      { seat: 7, kind: 'human', name: '나', stack: 500 },
    ];
    const s = winBy(WIN7, [L_GW], { seats, baseUnit: 1000 });
    const st = matgo.settle(s);
    expect((st.summary as MatgoSummary).amount).toBe(7000);
    expect((st.summary as MatgoSummary).paid).toBe(500);
    expect(st.deltas).toEqual({ 3: 500, 7: -500 });
    expect(st.carry).toEqual({ first: 3, nagari: 1 });
  });
  it('AI(stack null)가 지면 전액', () => {
    const seats: SeatInfo[] = [
      { seat: 0, kind: 'human', name: '나', stack: 100 },
      { seat: 1, kind: 'ai', name: 'AI', stack: null },
    ];
    expect(matgo.settle(winBy(WIN7, [L_GW], { seats })).deltas).toEqual({ 0: 700, 1: -700 });
  });
  it('끝나기 전 정산은 EngineError', () => {
    const s = makeTestState({ hands: [['m10-pi1'], ['m05-pi1']], floor: [], pile: [] });
    expect(() => matgo.settle(s)).toThrow(EngineError);
  });
});

describe('나가리', () => {
  const nagari = (mul: number) => {
    let s = makeTestState({ hands: [['m01-pi1'], ['m02-pi1']], floor: ['m05-pi1'], pile: ['m03-pi1', 'm04-pi1'], turn: 1, first: 1, nagariMul: mul });
    s = play(s, 1, 'm02-pi1');
    s = play(s, 0, 'm01-pi1');
    return s;
  };
  it('둘 다 패를 다 쓰면 나가리, 증감 0, 선 유지, 다음 판 ×2', () => {
    const s = nagari(1);
    expect(matgo.done(s)).toBe(true);
    expect(s.winner).toBeNull();
    expect(types(s)).toContain('nagari');
    const st = matgo.settle(s);
    expect(st.deltas).toEqual({ 0: 0, 1: 0 });
    expect(st.carry).toEqual({ first: 1, nagari: 2 });
    expect((st.summary as MatgoSummary).result).toBe('nagari');
  });
  it('연속 나가리는 ×4, ×8로 쌓이고 다음 판에 이어진다', () => {
    expect(matgo.settle(nagari(2)).carry).toEqual({ first: 1, nagari: 4 });
    expect(matgo.settle(nagari(4)).carry).toEqual({ first: 1, nagari: 8 });
    const seats: SeatInfo[] = [
      { seat: 0, kind: 'human', name: '나', stack: null },
      { seat: 1, kind: 'ai', name: 'AI', stack: null },
    ];
    const next = matgo.newRound({ seats, baseUnit: 100, carry: matgo.settle(nagari(2)).carry, rng: seededRng(9) });
    expect(next.nagariMul).toBe(4);
    expect(next.first).toBe(1);
    expect(matgo.view(next).public.nagariMul).toBe(4);
  });
  it('승부가 나면 나가리 배수는 1로 돌아간다', () => {
    const st = matgo.settle(winBy(WIN7, ['m11-gwang'], { nagariMul: 4 }));
    expect((st.summary as MatgoSummary).multipliers).toEqual(['나가리 ×4']);
    expect(st.carry).toEqual({ first: 0, nagari: 1 });
  });
});

describe('뻑 보너스 · 삼뻑', () => {
  const L_GW = 'm11-gwang';
  /** 첫째 자리가 3·5·7월에서 차례로 뻑을 낼 수 있는 판 (둘째 자리는 그 사이 아무 일 없는 패를 낸다) */
  const threePpeok = (o: Partial<MatgoTestSetup> = {}) =>
    makeTestState({
      hands: [['m03-pi1', 'm05-pi1', 'm07-pi1', 'm12-yeol'], ['m06-pi1', 'm08-pi1', 'm09-pi1', 'm12-tti']],
      floor: ['m03-tti', 'm05-tti', 'm07-tti'],
      pile: ['m03-pi2', 'm10-pi1', 'm05-pi2', 'm11-pi1', 'm07-pi2', 'm01-pi1', 'm02-pi1'],
      ...o,
    });
  const ppeokEvents = (s: MatgoState) => s.events.filter((e) => e.t === 'ppeok').map((e) => [e.seat, e.count]);

  it('뻑을 낼 때마다 그 사람의 횟수가 늘고, 사건에 몇 번째 뻑인지 실린다', () => {
    let s = threePpeok();
    s = play(s, 0, 'm03-pi1');
    expect(s.ppeokCount).toEqual([1, 0]);
    expect(ppeokEvents(s)).toEqual([[0, 1]]);
    s = play(s, 1, 'm06-pi1');
    s = play(s, 0, 'm05-pi1');
    expect(s.ppeokCount).toEqual([2, 0]);
    expect(ppeokEvents(s)).toEqual([[0, 1], [0, 2]]);
    expect(matgo.done(s)).toBe(false);
    expect(matgo.view(s).public.players[0].ppeok).toBe(2);
    expect(matgo.view(s).public.players[1].ppeok).toBe(0);
  });

  it('세 번째 뻑은 그 자리에서 승리: 7점, 다른 배수 없이 기본금 ×7 + 앞서 받은 뻑 보너스(×2 + ×3)', () => {
    let s = threePpeok({ nagariMul: 4 });
    s = play(s, 0, 'm03-pi1');
    s = play(s, 1, 'm06-pi1');
    s = play(s, 0, 'm05-pi1');
    s = play(s, 1, 'm08-pi1');
    s = play(s, 0, 'm07-pi1');
    expect(matgo.done(s)).toBe(true);
    expect(matgo.pending(s)).toEqual([]);
    expect(s.winner).toBe(0);
    expect(ppeokEvents(s)).toEqual([[0, 1], [0, 2], [0, 3]]);
    expect(types(s)).toContain('samppeok');
    expect(types(s)).not.toContain('stop');
    const st = matgo.settle(s);
    const sum = st.summary as MatgoSummary;
    expect(sum).toMatchObject({ result: 'win', winner: 0, loser: 1, samPpeok: true, chongtong: false, score: 7, multipliers: [], multiplier: 1, amount: 700, paid: 1200 });
    expect(sum.breakdown).toEqual([{ label: '삼뻑', points: 7 }]);
    expect(sum.ppeoks).toEqual([{ seat: 0, count: 3, bonus: 500 }]);
    expect(st.deltas).toEqual({ 0: 1200, 1: -1200 });
    expect(st.carry).toEqual({ first: 0, nagari: 1 });
    // 화면에도 같은 결과
    expect(matgo.view(s).public.result).toEqual(sum);
  });

  it('삼뻑으로 져도 사람은 가진 만큼만 낸다', () => {
    const seats: SeatInfo[] = [
      { seat: 0, kind: 'ai', name: 'AI', stack: null },
      { seat: 1, kind: 'human', name: '나', stack: 1000 },
    ];
    let s = threePpeok({ seats });
    for (const [seat, card] of [[0, 'm03-pi1'], [1, 'm06-pi1'], [0, 'm05-pi1'], [1, 'm08-pi1'], [0, 'm07-pi1']] as [number, string][]) s = play(s, seat, card);
    const st = matgo.settle(s);
    expect((st.summary as MatgoSummary).paid).toBe(1000);
    expect(st.deltas).toEqual({ 0: 1000, 1: -1000 });
  });

  it('첫 뻑은 기본금 ×2, 두 번째 뻑은 ×3 을 판 끝 정산에 더한다 (이긴 사람·진 사람 모두)', () => {
    // 이긴 사람이 뻑 1번: 700 + 200
    let st = matgo.settle(winBy(WIN7, [L_GW], { ppeokCount: [1, 0] }));
    let sum = st.summary as MatgoSummary;
    expect(sum.amount).toBe(700);
    expect(sum.ppeoks).toEqual([{ seat: 0, count: 1, bonus: 200 }]);
    expect(sum.paid).toBe(900);
    expect(st.deltas).toEqual({ 0: 900, 1: -900 });
    // 진 사람이 뻑 2번: 700 - (200 + 300)
    st = matgo.settle(winBy(WIN7, [L_GW], { ppeokCount: [0, 2] }));
    sum = st.summary as MatgoSummary;
    expect(sum.ppeoks).toEqual([{ seat: 1, count: 2, bonus: 500 }]);
    expect(st.deltas).toEqual({ 0: 200, 1: -200 });
    // 둘 다: 700 + 200 - 500, 기본금이 다르면 그만큼
    st = matgo.settle(winBy(WIN7, [L_GW], { ppeokCount: [1, 2], baseUnit: 500 }));
    expect(st.deltas).toEqual({ 0: 2000, 1: -2000 });
    // 뻑이 없으면 예전과 같다
    st = matgo.settle(winBy(WIN7, [L_GW]));
    expect((st.summary as MatgoSummary).ppeoks).toEqual([]);
    expect(st.deltas).toEqual({ 0: 700, 1: -700 });
  });

  it('뻑 보너스를 더해도 사람의 손실은 가진 돈을 넘지 않는다', () => {
    const seats: SeatInfo[] = [
      { seat: 0, kind: 'ai', name: 'AI', stack: null },
      { seat: 1, kind: 'human', name: '나', stack: 800 },
    ];
    const st = matgo.settle(winBy(WIN7, [L_GW], { seats, ppeokCount: [2, 0] }));
    expect((st.summary as MatgoSummary).amount).toBe(700);
    expect(st.deltas).toEqual({ 0: 800, 1: -800 });
  });

  it('나가리여도 뻑 보너스는 오간다 (나가리 배수는 그대로 이어진다)', () => {
    let s = makeTestState({ hands: [['m01-pi1'], ['m02-pi1']], floor: ['m05-pi1'], pile: ['m03-pi1', 'm04-pi1'], turn: 1, first: 1, ppeokCount: [1, 0] });
    s = play(s, 1, 'm02-pi1');
    s = play(s, 0, 'm01-pi1');
    const st = matgo.settle(s);
    const sum = st.summary as MatgoSummary;
    expect(sum.result).toBe('nagari');
    expect(sum.paid).toBe(200);
    expect(st.deltas).toEqual({ 0: 200, 1: -200 });
    expect(st.carry).toEqual({ first: 1, nagari: 2 });
  });

  it('처음부터 바닥에 깔린 같은 달 3장을 먹는 것은 뻑이 아니다', () => {
    const s0 = makeTestState({ hands: [['m04-pi2', 'm01-pi1'], ['m06-pi1']], floor: ['m04-yeol', 'm04-tti', 'm04-pi1', 'm10-pi1'], pile: ['m11-pi1'] });
    const s = play(s0, 0, 'm04-pi2');
    expect(s.ppeokCount).toEqual([0, 0]);
    expect(types(s)).not.toContain('ppeok');
  });

  it('예전에 저장된 상태(뻑 횟수 칸 없음)도 이어서 둘 수 있다', () => {
    const old = threePpeok();
    delete old.ppeokCount;
    delete old.samPpeok;
    const s = play(old, 0, 'm03-pi1');
    expect(s.ppeokCount).toEqual([1, 0]);
    expect(matgo.view(old).public.players[0].ppeok).toBe(0);
  });

  it('AI: 이미 뻑을 두 번 냈으면 세 번째(삼뻑)를 노린다', () => {
    const base = { hands: [['m04-pi1', 'm06-pi1', 'm06-yeol'], ['m01-pi1']] as [string[], string[]], floor: ['m04-yeol', 'm06-pi2'], pile: ['m10-pi1'] };
    const aiOf = (s: MatgoState) => {
      const v = JSON.parse(JSON.stringify(matgo.view(s)));
      return matgo.ai(v.public, v.private[0], 0, fixedRng());
    };
    expect(aiOf(makeTestState(base))).not.toEqual({ type: 'play', card: 'm04-pi1' });
    expect(aiOf(makeTestState({ ...base, ppeokCount: [2, 0] }))).toEqual({ type: 'play', card: 'm04-pi1' });
  });
});

describe('AI (보통)', () => {
  const aiOf = (s: MatgoState, seat = 0, rng: Rng = fixedRng()) => {
    const v = JSON.parse(JSON.stringify(matgo.view(s)));
    return matgo.ai(v.public, v.private[seat], seat, rng);
  };
  it('광을 피보다 먼저 먹는다', () => {
    const s = makeTestState({ hands: [['m01-pi1', 'm03-pi2', 'm05-pi1'], ['m06-pi1']], floor: ['m01-pi2', 'm03-gwang'], pile: ['m10-pi1'] });
    expect(aiOf(s)).toEqual({ type: 'play', card: 'm03-pi2' });
  });
  it('상대가 2장 모은 단의 패가 바닥에 있으면 가로챈다', () => {
    const base = { hands: [['m03-pi1', 'm11-pi1'], ['m06-pi1']] as [string[], string[]], floor: ['m03-tti', 'm11-ssangpi'], pile: ['m10-pi1'] };
    expect(aiOf(makeTestState({ ...base, captured: [[], ['m01-tti', 'm02-tti']] }))).toEqual({ type: 'play', card: 'm03-pi1' });
    expect(aiOf(makeTestState(base))).toEqual({ type: 'play', card: 'm11-pi1' });
  });
  it('뻑 날 만한 패는 피한다', () => {
    const s = makeTestState({ hands: [['m04-pi1', 'm06-pi1', 'm06-yeol'], ['m01-pi1']], floor: ['m04-yeol', 'm06-pi2'], pile: ['m10-pi1'] });
    expect(aiOf(s)).not.toEqual({ type: 'play', card: 'm04-pi1' });
  });
  it('폭탄이 되면 폭탄, 흔들 수 있으면 흔든다', () => {
    const b = makeTestState({ hands: [['m08-gwang', 'm08-yeol', 'm08-pi1', 'm05-pi1'], ['m01-pi1']], floor: ['m08-pi2'], pile: ['m10-pi1'] });
    expect(aiOf(b)).toEqual({ type: 'bomb', month: 8 });
    const k = makeTestState({ hands: [['m02-yeol', 'm02-tti', 'm02-pi1'], ['m01-pi1']], floor: ['m10-pi1'], pile: ['m11-pi1'] });
    const a = aiOf(k);
    expect(a.type).toBe('play');
    expect(a.type === 'play' && a.shake).toBe(true);
  });
  it('고르기: 더 좋은 패, 국진: 점수가 나은 쪽', () => {
    let s = makeTestState({ hands: [['m01-pi2', 'm05-pi1'], ['m06-pi1']], floor: ['m01-gwang', 'm01-pi1'], pile: ['m10-pi1'] });
    s = play(s, 0, 'm01-pi2');
    expect(aiOf(s)).toEqual({ type: 'choose', card: 'm01-gwang' });
    const y4 = ['m05-yeol', 'm06-yeol', 'm07-yeol', 'm10-yeol'];
    let g = makeTestState({ hands: [['m09-pi1', 'm01-pi1'], ['m06-pi1']], floor: ['m09-yeol'], pile: ['m11-pi1'], captured: [y4, []] });
    g = play(g, 0, 'm09-pi1');
    expect(aiOf(g)).toEqual({ type: 'gukjin', as: 'yeol' });
    let p = makeTestState({ hands: [['m09-pi1', 'm01-pi1'], ['m07-pi1']], floor: ['m09-yeol'], pile: ['m11-pi2'], captured: [[...PI8.slice(0, 6), 'm03-pi1'], []] });
    p = play(p, 0, 'm09-pi1');
    expect(aiOf(p)).toEqual({ type: 'gukjin', as: 'ssangpi' });
  });
  it('고/스톱: 상대 5점 이상·손패 3장 이하·이미 2고면 스톱, 아니면 고', () => {
    const hand4 = ['m10-pi1', 'm05-pi1', 'm07-pi1', 'm11-pi1'];
    const mk = (captured1: string[], hand: string[], go = 0) => {
      const s = makeTestState({
        hands: [hand, ['m05-tti']], floor: ['m10-pi2'], pile: ['m03-pi1', 'm03-pi2'],
        captured: [WIN7, captured1], go: [go, 0], goScore: [go ? 6 : 0, 0],
      });
      return play(s, 0, 'm10-pi1');
    };
    expect(aiOf(mk([], [...hand4, 'm12-tti']))).toEqual({ type: 'go' });
    expect(aiOf(mk([], hand4))).toEqual({ type: 'stop' }); // 남은 손패 3장
    expect(aiOf(mk(['m02-yeol', 'm04-yeol', 'm08-yeol'], [...hand4, 'm12-tti']))).toEqual({ type: 'stop' }); // 상대 5점
    expect(aiOf(mk([], [...hand4, 'm12-tti'], 2))).toEqual({ type: 'stop' }); // 2고
    expect(aiOf(mk([], [...hand4, 'm12-tti'], 1))).toEqual({ type: 'go' });
  });
  it('차례가 아닌 자리의 AI 호출·timeout은 EngineError', () => {
    const s = makeTestState({ hands: [['m01-pi1'], ['m02-pi1']], floor: [], pile: ['m03-pi1'] });
    expect(() => aiOf(s, 1)).toThrow(EngineError);
    expect(() => matgo.timeout(s, 1, R)).toThrow(EngineError);
  });
  it('timeout은 그 자리 AI 결정과 같다', () => {
    const s = matgo.newRound({
      seats: [{ seat: 0, kind: 'human', name: '나', stack: 1000 }, { seat: 1, kind: 'ai', name: 'AI', stack: null }],
      baseUnit: 100, carry: null, rng: seededRng(21),
    });
    if (s.phase === 'done') return;
    const seat = matgo.pending(s)[0];
    expect(matgo.timeout(s, seat, seededRng(5))).toEqual(aiOf(s, seat, seededRng(5)));
  });
});

describe('AI 대 AI 무작위 300판', () => {
  it('불변식: 48장 보존, 종료, 증감 합 0, view에 상대 손패·더미 없음', () => {
    const stats = { win: 0, nagari: 0, chongtong: 0, sam: 0 };
    let carry: { first: number; nagari: number } | null = null;
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRng(seed * 7919);
      const seatNos = seed % 2 ? [0, 1] : [2, 5];
      const seats: SeatInfo[] = [
        { seat: seatNos[0], kind: 'human', name: '나', stack: seed % 3 ? 5000 : 300 },
        { seat: seatNos[1], kind: 'ai', name: 'AI', stack: null },
      ];
      if (carry && !seatNos.includes(carry.first)) carry = null;
      let s = matgo.newRound({ seats, baseUnit: 100, carry, rng });
      const revealed = new Set<string>();
      let steps = 0;
      const check = (st: MatgoState) => {
        const all = [...st.hands[0], ...st.hands[1], ...st.floor, ...st.pile, ...st.captured[0], ...st.captured[1]];
        if (st.ctx) {
          all.push(...st.ctx.played);
          if (st.ctx.flipped) all.push(st.ctx.flipped);
        }
        expect(all.sort()).toEqual(ALL_IDS);
        const v = matgo.view(st);
        for (const e of v.public.events) if (e.t === 'shake' || e.t === 'chongtong') (e.cards as string[]).forEach((c) => revealed.add(c));
        const pubJson = JSON.stringify(v.public);
        for (const id of [...st.hands[0], ...st.hands[1]]) if (!revealed.has(id)) expect(pubJson).not.toContain(`"${id}"`);
        for (const id of st.pile) expect(pubJson).not.toContain(`"${id}"`);
        expect(v.public.pileCount).toBe(st.pile.length);
        st.seats.forEach((seat, i) => expect(v.private[seat].hand).toEqual(st.hands[i]));
      };
      check(s);
      while (!matgo.done(s)) {
        const p = matgo.pending(s);
        expect(p).toHaveLength(1);
        const seat = p[0];
        const v = matgo.view(s);
        const a = steps % 5 === 0 ? matgo.timeout(s, seat, rng) : matgo.ai(v.public, v.private[seat], seat, rng);
        const before = JSON.stringify(s);
        const next = matgo.apply(s, seat, a, rng);
        expect(JSON.stringify(s)).toBe(before);
        s = next;
        check(s);
        expect(++steps).toBeLessThan(80);
      }
      expect(matgo.pending(s)).toEqual([]);
      const st = matgo.settle(s);
      const sum = st.summary as MatgoSummary;
      const d = Object.values(st.deltas);
      expect(d).toHaveLength(2);
      expect(d[0] + d[1]).toBe(0);
      if (sum.loser !== null) {
        const stack = seats.find((x) => x.seat === sum.loser)!.stack;
        if (stack !== null) expect(-st.deltas[sum.loser]).toBeLessThanOrEqual(stack);
        // 점수 금액 + 이긴 사람의 뻑 보너스까지만
        expect(sum.paid).toBeLessThanOrEqual(sum.amount + sum.ppeoks.reduce((a, x) => a + (x.seat === sum.winner ? x.bonus : 0), 0));
        expect(sum.paid).toBe(st.deltas[sum.winner!]);
        expect(sum.score).toBeGreaterThanOrEqual(7);
      }
      for (const seat of seatNos) {
        const stack = seats.find((x) => x.seat === seat)!.stack;
        if (stack !== null) expect(-st.deltas[seat]).toBeLessThanOrEqual(stack);
      }
      if (sum.samPpeok) stats.sam++;
      if (sum.chongtong) stats.chongtong++;
      else if (sum.result === 'win') stats.win++;
      else stats.nagari++;
      carry = st.carry;
      expect(JSON.parse(JSON.stringify(s))).toEqual(s); // 상태는 JSON
    }
    expect(stats.win).toBeGreaterThan(100);
  });
});
