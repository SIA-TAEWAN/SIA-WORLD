import { describe, expect, it } from 'vitest';
import { EngineError, seededRng, type SeatInfo } from './engine.ts';
import {
  compareHands,
  evaluate5,
  evaluate7,
  evaluateOpen,
  fullDeck,
  HandCat,
  poker,
  type PokerAction,
  type PokerState,
} from './poker.ts';

// ───────────────────────── 도우미 ─────────────────────────

const h = (s: string) => s.split(' ');
const ev = (s: string) => evaluate7(h(s));
const cmp = (a: string, b: string) => Math.sign(compareHands(ev(a), ev(b)));
const rng = seededRng(7);

function seat(n: number, kind: 'human' | 'ai', stack: number | null = kind === 'ai' ? null : 100000): SeatInfo {
  return { seat: n, kind, name: `P${n}`, stack };
}

function start(seats: SeatInfo[], baseUnit = 1000, seed = 1): PokerState {
  return poker.newRound({ seats, baseUnit, carry: null, rng: seededRng(seed) });
}

/** 패와 이후 나올 카드를 정해 둔다. streets = 4구부터 (살아 있는 자리 번호 순으로) 나오는 순서 */
function rig(s: PokerState, hands: Record<number, string[]>, streets: string[]): PokerState {
  const used = new Set([...Object.values(hands).flat(), ...streets]);
  expect(used.size).toBe(Object.values(hands).flat().length + streets.length);
  const rest = fullDeck().filter((c) => !used.has(c));
  const n = { ...s, players: s.players.map((p) => ({ ...p })) };
  for (const p of n.players) if (hands[p.seat]) p.choices = hands[p.seat].slice();
  n.deck = [...rest.slice(0, 52 - used.size), ...streets.slice().reverse()];
  return n;
}

function chooseAll(s: PokerState, picks: Record<number, [string, string]>): PokerState {
  for (const [st, [d, o]] of Object.entries(picks)) s = poker.apply(s, Number(st), { type: 'choose', discard: d, open: o }, rng);
  return s;
}

const act = (s: PokerState, st: number, type: PokerAction['type']) => poker.apply(s, st, { type } as PokerAction, rng);
const opts = (s: PokerState) => poker.view(s).public.actions;
const optMap = (s: PokerState) => Object.fromEntries(opts(s).map((o) => [o.type, o.amount]));
const player = (s: PokerState, st: number) => s.players.find((p) => p.seat === st)!;

function allCards(s: PokerState): string[] {
  return [...s.deck, ...s.discards, ...s.players.flatMap((p) => [...p.choices, ...p.down, ...p.up])];
}
function expectConserved(s: PokerState) {
  const cs = allCards(s);
  expect(cs).toHaveLength(52);
  expect(new Set(cs).size).toBe(52);
}

// ───────────────────────── 족보 ─────────────────────────

describe('족보 평가', () => {
  it('모든 족보 등급', () => {
    expect(ev('AS KS QS JS TS').cat).toBe(HandCat.ROYAL);
    expect(ev('AS KS QS JS TS').name).toBe('로열 스트레이트 플러시');
    expect(ev('9H 8H 7H 6H 5H').cat).toBe(HandCat.STRAIGHT_FLUSH);
    expect(ev('AD 2D 3D 4D 5D').name).toBe('백스트레이트 플러시');
    expect(ev('9C 9D 9H 9S 2C').cat).toBe(HandCat.QUADS);
    expect(ev('9C 9D 9H 2S 2C').cat).toBe(HandCat.FULL_HOUSE);
    expect(ev('KC 9C 7C 4C 2C').cat).toBe(HandCat.FLUSH);
    expect(ev('9C 8D 7H 6S 5C').cat).toBe(HandCat.STRAIGHT);
    expect(ev('AS KD QH JC TS').name).toBe('마운틴');
    expect(ev('AC 2D 3H 4S 5C').name).toBe('백스트레이트');
    expect(ev('9C 9D 9H 6S 5C').cat).toBe(HandCat.TRIPS);
    expect(ev('9C 9D 6H 6S 5C').cat).toBe(HandCat.TWO_PAIR);
    expect(ev('9C 9D 7H 6S 5C').cat).toBe(HandCat.PAIR);
    expect(ev('KC 9D 7H 6S 4C').cat).toBe(HandCat.HIGH);
    // 등급 순서
    const order = [
      'KC 9D 7H 6S 4C', '9C 9D 7H 6S 5C', '9C 9D 6H 6S 5C', '9C 9D 9H 6S 5C', '9C 8D 7H 6S 5C',
      'KC 9C 7C 4C 2C', '9C 9D 9H 2S 2C', '9C 9D 9H 9S 2C', '9H 8H 7H 6H 5H', 'AS KS QS JS TS',
    ];
    for (let i = 1; i < order.length; i++) expect(cmp(order[i], order[i - 1])).toBe(1);
  });

  it('스트레이트 플러시: 로티플 > 백스트레이트 플러시 > K 스트레이트 플러시', () => {
    expect(cmp('AH KH QH JH TH', 'AD 2D 3D 4D 5D')).toBe(1);
    expect(cmp('AD 2D 3D 4D 5D', 'KC QC JC TC 9C')).toBe(1);
    expect(cmp('KC QC JC TC 9C', '6S 5S 4S 3S 2S')).toBe(1);
  });

  it('스트레이트: 마운틴 > 백스트레이트 > K 스트레이트 > 6 스트레이트', () => {
    expect(cmp('AS KD QH JC TS', 'AC 2D 3H 4S 5C')).toBe(1);
    expect(cmp('AC 2D 3H 4S 5C', 'KS QD JH TC 9S')).toBe(1);
    expect(cmp('KS QD JH TC 9S', '6S 5D 4H 3C 2S')).toBe(1);
    expect(cmp('AC 2D 3H 4S 5C', '6S 5D 4H 3C 2S')).toBe(1);
  });

  it('A는 위아래로만 이어진다 (Q-K-A-2-3은 스트레이트가 아님)', () => {
    expect(ev('QS KD AH 2C 3S').cat).toBe(HandCat.HIGH);
    expect(ev('AH 2C 3S 4D 5H').cat).toBe(HandCat.STRAIGHT);
    // 7장 중 A-2-3-4-5와 2~6이 같이 있으면 백스트레이트가 더 높다
    expect(ev('AH 2C 3S 4D 5H 6C 9D').name).toBe('백스트레이트');
    // 7장 중 2~7이면 7 스트레이트
    expect(ev('2C 3S 4D 5H 6C 7D KS').name).toBe('7 스트레이트');
  });

  it('7장에서 가장 좋은 5장을 고른다', () => {
    expect(ev('2H 5H 9H JH KH 3C 4D').cat).toBe(HandCat.FLUSH);
    expect(ev('AS AD AH KS KD KH 2C').name).toBe('A 풀하우스');
    expect(ev('AS AD AH KS KD KH 2C').ranks).toEqual([14, 13]);
    expect(ev('9C 8C 7C 6C 5C 9D 9H').cat).toBe(HandCat.STRAIGHT_FLUSH); // 풀하우스 가능성보다 스트레이트 플러시
    expect(ev('9C 9D 9H 9S 5C 5D 5H').cat).toBe(HandCat.QUADS);
    expect(ev('9C 9D 9H 9S 5C 5D 5H').ranks).toEqual([9, 5]);
    expect(ev('JC 9D 6H 6S 2C 2D 4S').name).toBe('6 투페어');
    expect(ev('JC 9D 6H 6S 2C 2D JS').ranks).toEqual([11, 6, 9]); // 투페어 3개 중 위 두 개 + 키커
    expect(ev('KS KD QH 8C 5S 3D 2C').ranks).toEqual([13, 12, 8, 5]);
    expect(evaluate7(h('AS KS QS JS TS 2D 3D')).cards).toHaveLength(5);
  });

  it('키커 비교', () => {
    expect(cmp('AS AD KH 7C 3S', 'AC AH QH 9C 8S')).toBe(1);
    expect(cmp('AS AD KH 8C 3S', 'AC AH KD 7C 6S')).toBe(1);
    expect(cmp('9S 9D 5H 5C KS', '9C 9H 5S 5D QS')).toBe(1);
    expect(cmp('9S 9D 5H 5C 2S', '8C 8H 7S 7D AS')).toBe(1);
    expect(cmp('KC 9C 7C 4C 3C', 'KD 9D 7D 4D 2D')).toBe(1);
    expect(cmp('7S 7D 7H AC 2S', '7C 9H 9S 9D 2D')).toBe(-1);
    expect(cmp('AS KD 9H 7C 4C', 'AH KS 9D 7D 3D')).toBe(1);
  });

  it('숫자가 같으면 결정 카드의 무늬 ♠ > ◆ > ♥ > ♣', () => {
    // 하이카드: 가장 높은 카드(A)의 무늬
    expect(cmp('AS KD 9H 7C 3C', 'AD KS 9D 7D 3D')).toBe(1);
    expect(cmp('AD KC 9H 7C 3C', 'AH KS 9D 7D 3D')).toBe(1);
    expect(cmp('AH KC 9H 7C 3C', 'AC KS 9D 7D 3D')).toBe(1);
    // 원페어: 페어 중 좋은 무늬 (♠K가 있는 쪽)
    expect(cmp('KS KC 9H 7C 3C', 'KD KH 9D 7D 3D')).toBe(1);
    // 투페어: 높은 페어의 무늬
    expect(cmp('KH KC 9H 9C 3C', 'KD KS 9D 9S 3D')).toBe(-1);
    // 스트레이트: 가장 높은 카드의 무늬 / 백스트레이트는 A의 무늬
    expect(cmp('9S 8C 7C 6C 5C', '9D 8S 7S 6S 5D')).toBe(1);
    expect(cmp('AS 2C 3C 4C 5H', 'AD 2S 3S 4S 5S')).toBe(1);
    // 플러시: 가장 높은 카드의 무늬
    expect(cmp('KS 9S 7S 4S 3S', 'KH 9H 7H 4H 3H')).toBe(1);
    // 로열: 무늬
    expect(cmp('AS KS QS JS TS', 'AD KD QD JD TD')).toBe(1);
    expect(cmp('AH KH QH JH TH', 'AC KC QC JC TC')).toBe(1);
    // 같은 카드 다섯 장이면 0 (방어적)
    expect(compareHands(evaluate5(h('AS KD 9H 7C 3C')), evaluate5(h('AS KD 9H 7C 3C')))).toBe(0);
  });

  it('공개 카드 족보 (1~4장)', () => {
    const o = (s: string) => evaluateOpen(h(s))!;
    expect(o('KS').name).toBe('K 탑');
    expect(o('KS KD').name).toBe('K 원페어');
    expect(o('3S 3D 2H 2C').name).toBe('3 투페어');
    expect(o('3S 3D 3H').name).toBe('3 트리플');
    expect(o('3S 3D 3H 3C').cat).toBe(HandCat.QUADS);
    expect(compareHands(o('2S 2D'), o('AS KD'))).toBeGreaterThan(0);
    expect(compareHands(o('AH KD'), o('AS 2D'))).toBeGreaterThan(0);
    expect(compareHands(o('AS KD'), o('AH KC'))).toBeGreaterThan(0);
  });
});

// ───────────────────────── 진행 · 베팅 ─────────────────────────

/** 2인 기본 판: 0번(사람) vs 2번(AI). 4구에서 2번이 Q 원페어로 먼저 */
function twoPlayer(stack0 = 100000) {
  let s = start([seat(0, 'human', stack0), seat(2, 'ai')]);
  s = rig(
    s,
    { 0: h('2C 7D 9S KH'), 2: h('3C 4D 8S QH') },
    h('5S QD 6D 6H TC TH JS JH'),
  );
  return s;
}

describe('흐름', () => {
  it('카드 장수: 4장 → 1장 버림 → 1장 공개 → 4·5·6구 공개 → 7구 비공개, 덱 보존', () => {
    let s = twoPlayer();
    expectConserved(s);
    for (const p of s.players) expect(p.choices).toHaveLength(4);
    expect(s.deck).toHaveLength(52 - 8);
    expect(poker.pending(s)).toEqual([0, 2]);
    s = poker.apply(s, 0, { type: 'choose', discard: '2C', open: 'KH' }, rng);
    expect(poker.pending(s)).toEqual([2]);
    // 아직 공개 안 됨
    expect(poker.view(s).public.seats.every((x) => x.open.length === 0)).toBe(true);
    s = poker.apply(s, 2, { type: 'choose', discard: '3C', open: 'QH' }, rng);
    expectConserved(s);
    expect(s.phase).toBe('bet4');
    for (const p of s.players) {
      expect(p.down).toHaveLength(2);
      expect(p.up).toHaveLength(2);
    }
    expect(s.discards.sort()).toEqual(['2C', '3C']);
    for (const r of [5, 6, 7]) {
      const first = s.turn!;
      s = act(s, first, 'check');
      s = act(s, s.turn!, 'check');
      expectConserved(s);
      if (r < 8) expect(s.round).toBe(r);
      for (const p of s.players) {
        expect(p.up).toHaveLength(r === 7 ? 4 : r - 2);
        expect(p.down).toHaveLength(r === 7 ? 3 : 2);
      }
    }
    expect(s.phase).toBe('bet7');
    s = act(s, s.turn!, 'check');
    s = act(s, s.turn!, 'check');
    expect(poker.done(s)).toBe(true);
    expectConserved(s);
    const st = poker.settle(s);
    expect(st.deltas[0] + st.deltas[2]).toBe(0);
    // 0번: K 9 7 6 T J 5 → 하이 / 2번: Q Q ... → 2번 승
    expect(s.result!.winners).toEqual([2]);
    expect(st.deltas).toEqual({ 0: -1000, 2: 1000 });
    const pub = poker.view(s).public;
    expect(pub.showdown).toHaveLength(2);
    expect(pub.showdown!.find((x) => x.seat === 2)!.cards).toHaveLength(7);
  });

  it('첫 행동자는 공개 패가 가장 좋은 사람, 체크/삥은 베팅이 없을 때만', () => {
    let s = chooseAll(twoPlayer(), { 0: ['2C', 'KH'], 2: ['3C', 'QH'] });
    expect(s.turn).toBe(2); // Q 원페어 > K 탑
    expect(poker.view(s).public.seats.find((x) => x.seat === 2)!.openLabel).toBe('Q 원페어');
    expect(optMap(s)).toEqual({ check: 0, bbing: 1000, half: 1000, die: 0 });
    expect(() => act(s, 2, 'call')).toThrow(EngineError);
    expect(() => act(s, 2, 'ddadang')).toThrow(EngineError);
    expect(() => act(s, 0, 'check')).toThrow(EngineError); // 차례 아님
    s = act(s, 2, 'bbing');
    expect(s.turn).toBe(0);
    expect(() => act(s, 0, 'check')).toThrow(EngineError);
    expect(() => act(s, 0, 'bbing')).toThrow(EngineError);
    expect(optMap(s)).toEqual({ call: 1000, ddadang: 2000, half: 3000, die: 0 });
  });

  it('따당·하프 금액과 레이즈 3회 제한', () => {
    let s = chooseAll(twoPlayer(), { 0: ['2C', 'KH'], 2: ['3C', 'QH'] });
    s = act(s, 2, 'bbing'); // 판돈 3000, 베팅 1000
    s = act(s, 0, 'half'); // 콜 1000 + (3000+1000)/2 = 3000 → 베팅 수준 1000 + 2000 = 3000
    expect(player(s, 0).betRound).toBe(3000);
    expect(s.curBet).toBe(3000);
    expect(s.raises).toBe(1);
    // 2번: 콜 2000, 따당 2×3000−1000 = 5000, 하프 2000 + (6000+2000)/2 = 6000
    expect(optMap(s)).toEqual({ call: 2000, ddadang: 5000, half: 6000, die: 0 });
    s = act(s, 2, 'ddadang');
    expect(s.curBet).toBe(6000);
    expect(s.raises).toBe(2);
    // 0번: 콜 3000, 따당 12000−3000 = 9000, 하프 3000 + (11000+3000)/2 = 10000
    expect(optMap(s)).toEqual({ call: 3000, ddadang: 9000, half: 10000, die: 0 });
    s = act(s, 0, 'half');
    expect(s.curBet).toBe(13000);
    expect(s.raises).toBe(3);
    // 제한 뒤에는 콜·다이만
    expect(optMap(s)).toEqual({ call: 7000, die: 0 });
    expect(() => act(s, 2, 'half')).toThrow(EngineError);
    expect(() => act(s, 2, 'ddadang')).toThrow(EngineError);
    s = act(s, 2, 'call');
    expect(s.phase).toBe('bet5');
    expect(s.raises).toBe(0);
    expect(s.curBet).toBe(0);
    expect(poker.view(s).public.pot).toBe(2000 + 13000 * 2);
  });

  it('라운드 종료: 모두 행동하고 금액을 맞춰야 끝난다', () => {
    let s = chooseAll(twoPlayer(), { 0: ['2C', 'KH'], 2: ['3C', 'QH'] });
    s = act(s, 2, 'check');
    expect(s.phase).toBe('bet4');
    expect(s.turn).toBe(0);
    s = act(s, 0, 'bbing');
    expect(s.phase).toBe('bet4');
    expect(s.turn).toBe(2); // 체크했던 사람도 다시 응해야 한다
    s = act(s, 2, 'call');
    expect(s.phase).toBe('bet5');
  });

  it('4인 · 자리 번호가 띄엄띄엄이어도 시계 방향', () => {
    let s = start([seat(0, 'ai'), seat(1, 'ai'), seat(3, 'ai'), seat(5, 'ai')]);
    s = rig(
      s,
      { 0: h('2C 2D 3C 4C'), 1: h('5C 5D 6C 7C'), 3: h('8C 8D 9C TC'), 5: h('JC JD QC KC') },
      // 4구: 0,1,3,5 순서. 3번이 9 원페어 → 먼저
      h('3D 6D 9D 2H'),
    );
    s = chooseAll(s, { 0: ['2D', '3C'], 1: ['5D', '6C'], 3: ['8D', '9C'], 5: ['JD', 'QC'] });
    expect(s.turn).toBe(3);
    const order: number[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(s.turn!);
      s = act(s, s.turn!, 'check');
    }
    expect(order).toEqual([3, 5, 0, 1]);
    expect(s.phase).toBe('bet5');
  });

  it('돈이 모자라면 올인, 올인 뒤 남은 카드는 자동으로 돌리고 쇼다운', () => {
    let s = start([seat(0, 'human', 3000), seat(2, 'ai')]);
    s = rig(s, { 0: h('2C 7D 9S KH'), 2: h('3C 4D 8S QH') }, h('5S QD 6D 6H TC TH JS JH'));
    s = chooseAll(s, { 0: ['2C', 'KH'], 2: ['3C', 'QH'] });
    s = act(s, 2, 'bbing');
    // 0번 남은 돈 2000: 따당 2000은 딱 올인, 하프 3000 → 2000 올인
    expect(opts(s)).toEqual([
      { type: 'call', amount: 1000, allIn: false },
      { type: 'ddadang', amount: 2000, allIn: true },
      { type: 'half', amount: 2000, allIn: true },
      { type: 'die', amount: 0, allIn: false },
    ]);
    s = act(s, 0, 'call');
    expect(s.phase).toBe('bet5');
    expect(s.turn).toBe(2);
    s = act(s, 2, 'half'); // (4000)/2 = 2000
    expect(player(s, 2).betRound).toBe(2000);
    // 남은 돈 1000 ≤ 콜 2000 → 레이즈 없이 콜(올인)·다이만
    expect(opts(s)).toEqual([
      { type: 'call', amount: 1000, allIn: true },
      { type: 'die', amount: 0, allIn: false },
    ]);
    s = act(s, 0, 'call');
    expect(player(s, 0).allIn).toBe(true);
    expect(poker.done(s)).toBe(true);
    expectConserved(s);
    for (const p of s.players) expect(p.down.length + p.up.length).toBe(7);
    expect(s.result!.pots).toEqual([
      { amount: 6000, eligible: [0, 2], winners: [2] },
      { amount: 1000, eligible: [2], winners: [2] },
    ]);
    expect(poker.settle(s).deltas).toEqual({ 0: -3000, 2: 3000 });
    expect(s.events.some((e) => e.t === 'allin' && e.seat === 0)).toBe(true);
  });

  it('사이드 팟: 4인, 스택이 다르고 다이한 사람 돈 포함', () => {
    let s = start([seat(0, 'human', 2000), seat(1, 'human', 5000), seat(2, 'ai'), seat(3, 'ai')]);
    s = rig(
      s,
      { 0: h('9S 9D 9H 2C'), 1: h('KS KD 7C 2D'), 2: h('QS QD 6C 3D'), 3: h('AS AD TS 5C') },
      h('3C 8C 8D AH 9C KH 2S 4D JD JH 5H 6S 4C'),
    );
    s = chooseAll(s, { 0: ['2C', '9H'], 1: ['2D', '7C'], 2: ['3D', '6C'], 3: ['5C', 'AS'] });
    expect(s.turn).toBe(3); // A 원페어 공개
    s = act(s, 3, 'bbing');
    expect(optMap(s).call).toBe(1000);
    s = act(s, 0, 'call'); // 남은 1000 전부 → 올인
    expect(player(s, 0).allIn).toBe(true);
    // 1번 하프: 1000 + (6000+1000)/2 = 4500 → 남은 4000 올인
    expect(opts(s).find((o) => o.type === 'half')).toEqual({ type: 'half', amount: 4000, allIn: true });
    s = act(s, 1, 'half');
    expect(s.curBet).toBe(4000);
    s = act(s, 2, 'call');
    expect(optMap(s).call).toBe(3000);
    s = act(s, 3, 'die');
    // 베팅할 사람이 2번뿐 → 끝까지 돌리고 쇼다운
    expect(poker.done(s)).toBe(true);
    expectConserved(s);
    expect(s.result!.pots).toEqual([
      { amount: 8000, eligible: [0, 1, 2], winners: [0] },
      { amount: 6000, eligible: [1, 2], winners: [1] },
    ]);
    const st = poker.settle(s);
    expect(st.deltas).toEqual({ 0: 6000, 1: 1000, 2: -5000, 3: -2000 });
    expect(Object.values(st.deltas).reduce((a, b) => a + b, 0)).toBe(0);
    expect(s.events.some((e) => e.t === 'four_kind' && e.seat === 0)).toBe(true);
    // 다이한 3번 카드는 쇼다운에도 안 보인다
    const pub = poker.view(s).public;
    expect(pub.showdown!.map((x) => x.seat)).toEqual([0, 1, 2]);
    expect(JSON.stringify(pub)).not.toContain('"AD"');
  });

  it('모두 다이하면 마지막 사람이 카드를 보이지 않고 이긴다', () => {
    let s = chooseAll(twoPlayer(), { 0: ['2C', 'KH'], 2: ['3C', 'QH'] });
    s = act(s, 2, 'bbing');
    s = act(s, 0, 'die');
    expect(poker.done(s)).toBe(true);
    expect(s.result!.uncontested).toBe(true);
    expect(poker.settle(s).deltas).toEqual({ 0: -1000, 2: 1000 });
    const pub = poker.view(s).public;
    expect(pub.showdown).toBeNull();
    const str = JSON.stringify(pub);
    for (const c of [...player(s, 2).down, ...player(s, 0).down]) expect(str).not.toContain(`"${c}"`);
  });

  it('앤티를 못 내는 사람은 제외, 앤티와 같으면 앤티 올인', () => {
    let s = start([seat(0, 'human', 500), seat(1, 'human', 1000), seat(2, 'ai')]);
    expect(player(s, 0).excluded).toBe(true);
    expect(player(s, 0).choices).toHaveLength(0);
    expect(player(s, 1).allIn).toBe(true);
    expect(poker.pending(s)).toEqual([1, 2]);
    expect(() => poker.apply(s, 0, { type: 'choose', discard: '2C', open: '3C' }, rng)).toThrow(EngineError);
    expect(poker.view(s).private[0]).toBeUndefined();
    s = poker.apply(s, 1, poker.timeout(s, 1, rng), rng);
    s = poker.apply(s, 2, poker.timeout(s, 2, rng), rng);
    // 베팅할 사람이 1명뿐이라 바로 쇼다운
    expect(poker.done(s)).toBe(true);
    const d = poker.settle(s).deltas;
    expect(d[0]).toBeUndefined(); // 빠진 자리는 정산에 없다
    expect(d[1] + d[2]).toBe(0);
    expect(Math.abs(d[1])).toBe(1000);
    expect(s.result!.excluded).toEqual([0]);
  });

  it('참가자가 2명 미만이면 판이 취소된다', () => {
    const s = start([seat(0, 'human', 100), seat(1, 'ai')]);
    expect(poker.done(s)).toBe(true);
    expect(s.result!.cancelled).toBe(true);
    expect(poker.settle(s).deltas).toEqual({ 1: 0 }); // 빠진 자리(0)는 정산에 없다
  });

  it('시간 초과: 선택은 가장 낮은 카드 버리고 그다음 낮은 카드 공개, 베팅은 체크 아니면 다이', () => {
    let s = twoPlayer();
    expect(poker.timeout(s, 0, rng)).toEqual({ type: 'choose', discard: '2C', open: '7D' });
    expect(poker.timeout(s, 2, rng)).toEqual({ type: 'choose', discard: '3C', open: '4D' });
    s = chooseAll(s, { 0: ['2C', 'KH'], 2: ['3C', 'QH'] });
    expect(poker.timeout(s, 2, rng)).toEqual({ type: 'check' });
    expect(() => poker.timeout(s, 0, rng)).toThrow(EngineError);
    s = act(s, 2, 'bbing');
    expect(poker.timeout(s, 0, rng)).toEqual({ type: 'die' });
  });

  it('규칙 위반은 EngineError', () => {
    let s = twoPlayer();
    expect(() => act(s, 0, 'check')).toThrow(EngineError); // 선택 단계
    expect(() => poker.apply(s, 0, { type: 'choose', discard: '2C', open: '2C' }, rng)).toThrow(EngineError);
    expect(() => poker.apply(s, 0, { type: 'choose', discard: 'AS', open: '2C' }, rng)).toThrow(EngineError);
    expect(() => poker.apply(s, 9, { type: 'choose', discard: '2C', open: '7D' }, rng)).toThrow(EngineError);
    const s1 = poker.apply(s, 0, { type: 'choose', discard: '2C', open: 'KH' }, rng);
    expect(() => poker.apply(s1, 0, { type: 'choose', discard: '7D', open: 'KH' }, rng)).toThrow(EngineError);
    // 원래 상태는 바뀌지 않는다
    expect(player(s, 0).chosen).toBe(false);
    s = poker.apply(s1, 2, { type: 'choose', discard: '3C', open: 'QH' }, rng);
    expect(() => poker.apply(s, 2, { type: 'choose', discard: '4D', open: '8S' }, rng)).toThrow(EngineError);
    expect(() => act(s, 0, 'bbing')).toThrow(EngineError); // 차례 아님
  });

  it('비공개 정보: 덱·버린 카드·남의 비공개 카드는 공개 화면에 없다', () => {
    let s = twoPlayer();
    const v0 = poker.view(s);
    expect(v0.private[0].choices).toEqual(h('2C 7D 9S KH'));
    expect(v0.public.seats.every((x) => x.hiddenCount === 4)).toBe(true);
    s = chooseAll(s, { 0: ['2C', 'KH'], 2: ['3C', 'QH'] });
    const v = poker.view(s);
    const str = JSON.stringify(v.public);
    for (const c of [...s.deck, ...s.discards, ...s.players.flatMap((p) => p.down)]) expect(str).not.toContain(`"${c}"`);
    expect(v.private[0].hidden).toEqual(['7D', '9S']);
    expect(v.private[0].open).toEqual(['KH', '5S']);
    expect(v.private[2].hidden).toEqual(['4D', '8S']);
    expect(JSON.stringify(v.private[0])).not.toContain('"4D"');
  });

  it('AI는 선택 단계와 베팅에서 늘 합법 행동을 고른다', () => {
    let s = twoPlayer();
    const a = poker.ai(poker.view(s).public, poker.view(s).private[2], 2, rng);
    expect(a.type).toBe('choose');
    s = poker.apply(s, 2, a, rng);
    expect(player(s, 2).chosen).toBe(true);
  });
});

// ───────────────────────── 무작위 ─────────────────────────

describe('무작위 500판', () => {
  it('불변식: 정산 합 0, 사람 손실 ≤ stack, 예외 없음, 종료, 비공개 유지', () => {
    const r = seededRng(20261117);
    const STACKS = [500, 1000, 1500, 3000, 8000, 50000, 1000000];
    let showdowns = 0;
    let uncontested = 0;
    for (let g = 0; g < 500; g++) {
      const n = 2 + r.int(3);
      const pool = [0, 1, 2, 3, 4, 5];
      const chosenSeats: number[] = [];
      while (chosenSeats.length < n) chosenSeats.push(pool.splice(r.int(pool.length), 1)[0]);
      const seats: SeatInfo[] = chosenSeats
        .sort((a, b) => a - b)
        .map((x) => (r.next() < 0.5 ? seat(x, 'ai') : seat(x, 'human', STACKS[r.int(STACKS.length)])));
      const base = [100, 500, 1000][r.int(3)];
      let s = poker.newRound({ seats, baseUnit: base, carry: null, rng: r });
      let steps = 0;
      while (!poker.done(s)) {
        expect(++steps).toBeLessThan(500);
        expectConserved(s);
        const v = poker.view(s);
        // 공개 화면에 덱/버린 카드/선택 카드/남의 비공개 카드가 없어야 한다
        const pubStr = JSON.stringify(v.public);
        const secret = [...s.deck, ...s.discards, ...s.players.flatMap((p) => [...p.choices, ...p.down])];
        if (s.phase === 'choose') secret.push(...s.players.flatMap((p) => p.up));
        for (const c of secret) expect(pubStr.includes(`"${c}"`)).toBe(false);
        const pend = poker.pending(s);
        expect(pend.length).toBeGreaterThan(0);
        const st = pend[r.int(pend.length)];
        const p = s.players.find((x) => x.seat === st)!;
        let action: PokerAction;
        if (p.kind === 'ai') action = poker.ai(v.public, v.private[st], st, r);
        else if (r.next() < 0.15) action = poker.timeout(s, st, r);
        else if (s.phase === 'choose') {
          const cs = v.private[st].choices.slice();
          const d = cs.splice(r.int(4), 1)[0];
          action = { type: 'choose', discard: d, open: cs[r.int(3)] };
        } else {
          const acts = v.public.actions;
          action = { type: acts[r.int(acts.length)].type } as PokerAction;
        }
        s = poker.apply(s, st, action, r);
      }
      const st = poker.settle(s);
      const sum = Object.values(st.deltas).reduce((a, b) => a + b, 0);
      expect(sum).toBe(0);
      for (const si of seats) {
        // 앤티를 못 내 빠진 자리는 정산에 넣지 않는다 (정산 SQL 이 deltas 에 있는 자리에 시아코인을 준다)
        const excluded = s.players.find((p) => p.seat === si.seat)!.excluded;
        if (excluded) expect(st.deltas[si.seat]).toBeUndefined();
        else expect(st.deltas[si.seat]).toBeDefined();
        if (si.stack !== null && si.stack < base) expect(st.deltas[si.seat] ?? 0).toBe(0);
        if (si.stack !== null && st.deltas[si.seat] !== undefined) expect(st.deltas[si.seat]).toBeGreaterThanOrEqual(-si.stack);
      }
      const pub = poker.view(s).public;
      const pubStr = JSON.stringify(pub);
      for (const c of [...s.deck, ...s.discards]) expect(pubStr.includes(`"${c}"`)).toBe(false);
      for (const p of s.players) {
        const shown = !!s.result && !s.result.uncontested && !s.result.cancelled && !p.folded && !p.excluded;
        if (!shown) for (const c of p.down) expect(pubStr.includes(`"${c}"`)).toBe(false);
      }
      if (s.result!.uncontested) uncontested++;
      else if (!s.result!.cancelled) {
        showdowns++;
        expectConserved(s);
      }
      // 이벤트 id 증가, 30개 이하
      expect(pub.events.length).toBeLessThanOrEqual(30);
      for (let i = 1; i < pub.events.length; i++) expect(pub.events[i].id).toBe(pub.events[i - 1].id + 1);
    }
    expect(showdowns).toBeGreaterThan(20);
    expect(uncontested).toBeGreaterThan(20);
  });
});
