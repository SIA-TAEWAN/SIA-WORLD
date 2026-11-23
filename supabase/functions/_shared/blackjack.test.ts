import { describe, expect, it } from 'vitest';
import { EngineError, seededRng, type SeatInfo } from './engine.ts';
import {
  basicStrategy,
  blackjack,
  CUT,
  freshShoe,
  handValue,
  newRoundWithShoe,
  SHOE_SIZE,
  stackDeal,
  type BjAction,
  type BjState,
  type Card,
} from './blackjack.ts';

const rng = seededRng(7);
const B = 100;

const human = (seat: number, stack: number | null = 1_000_000): SeatInfo => ({ seat, kind: 'human', name: `사람${seat}`, stack });
const ai = (seat: number): SeatInfo => ({ seat, kind: 'ai', name: `AI${seat}`, stack: null });

/** 여분 카드 (딜러가 더 뽑을 때 등) */
const FILLER: Card[] = Array.from({ length: 20 }, () => '2C');

function start(seats: SeatInfo[], players: [Card, Card][], dealer: [Card, Card], rest: Card[] = [], bets?: number[]): BjState {
  let s = newRoundWithShoe({ seats, baseUnit: B, rng }, stackDeal(players, dealer, rest));
  seats.forEach((si, i) => {
    s = blackjack.apply(s, si.seat, { type: 'bet', amount: bets?.[i] ?? B }, rng);
  });
  return s;
}

const act = (s: BjState, seat: number, a: BjAction) => blackjack.apply(s, seat, a, rng);
const deltas = (s: BjState) => blackjack.settle(s).deltas;

describe('핸드 합계', () => {
  it('하드/소프트와 여러 에이스', () => {
    expect(handValue(['10S', 'KD'])).toEqual({ total: 20, soft: false });
    expect(handValue(['AS', '6D'])).toEqual({ total: 17, soft: true });
    expect(handValue(['AS', '6D', '10H'])).toEqual({ total: 17, soft: false });
    expect(handValue(['AS', 'AD'])).toEqual({ total: 12, soft: true });
    expect(handValue(['AS', 'AD', 'AH', 'AC'])).toEqual({ total: 14, soft: true });
    expect(handValue(['AS', 'AD', '9H'])).toEqual({ total: 21, soft: true });
    expect(handValue(['AS', 'AD', '9H', 'KC'])).toEqual({ total: 21, soft: false });
    expect(handValue(['AS', 'KD'])).toEqual({ total: 21, soft: true });
    expect(handValue(['QS', 'JD', '5H'])).toEqual({ total: 25, soft: false });
  });
  it('새 슈는 312장, 각 카드 6장씩', () => {
    const shoe = freshShoe();
    expect(shoe).toHaveLength(312);
    expect(shoe.filter((c) => c === 'AS')).toHaveLength(6);
    expect(new Set(shoe).size).toBe(52);
  });
});

describe('딜러', () => {
  it('16에서 뽑고 하드 17에서 선다', () => {
    let s = start([human(0)], [['10S', '8D']], ['10H', '6C'], ['AD', '5S']);
    s = act(s, 0, { type: 'stand' });
    expect(s.phase).toBe('done');
    expect(s.dealer).toEqual(['10H', '6C', 'AD']); // 16 + A = 17 하드 → 섬
    expect(deltas(s)[0]).toBe(B); // 18 > 17
  });
  it('소프트 17에서 선다', () => {
    let s = start([human(0)], [['10S', '7D']], ['AH', '6C'], ['5S']);
    s = act(s, 0, { type: 'stand' });
    expect(s.dealer).toEqual(['AH', '6C']);
    expect(deltas(s)[0]).toBe(0); // 17 대 17 푸시
  });
  it('소프트 16 이하는 계속 뽑는다', () => {
    let s = start([human(0)], [['10S', '9D']], ['AH', '5C'], ['AS', 'KD', '3C']);
    s = act(s, 0, { type: 'stand' });
    // A5=16s → +A=17s 섬
    expect(s.dealer).toEqual(['AH', '5C', 'AS']);
    expect(deltas(s)[0]).toBe(B);
  });
  it('딜러 버스트면 남은 핸드 승리', () => {
    let s = start([human(0)], [['10S', '2D']], ['10H', '6C'], ['KD']);
    s = act(s, 0, { type: 'stand' });
    expect(handValue(s.dealer).total).toBe(26);
    expect(deltas(s)[0]).toBe(B);
    expect(s.events.some((e) => e.t === 'dealer_bust')).toBe(true);
  });
  it('모든 플레이어가 버스트면 딜러는 뽑지 않는다', () => {
    let s = start([human(0)], [['10S', '6D']], ['10H', '2C'], ['KD', '9S']);
    s = act(s, 0, { type: 'hit' });
    expect(s.phase).toBe('done');
    expect(s.dealer).toEqual(['10H', '2C']);
    expect(s.holeRevealed).toBe(true);
    expect(deltas(s)[0]).toBe(-B);
  });
});

describe('블랙잭·피크', () => {
  it('블랙잭은 3:2, 베팅은 기본 단위의 배수만', () => {
    const s = start([human(0), human(1)], [['AS', 'KD'], ['QS', 'AC']], ['9H', '7C'], [], [B, 300]);
    expect(s.phase).toBe('done'); // 둘 다 블랙잭 → 딜러는 뽑지 않음
    expect(s.dealer).toHaveLength(2);
    const d = deltas(s);
    expect(d[0]).toBe(150);
    expect(d[1]).toBe(450);
    expect(() => start([human(0)], [['AS', 'KD']], ['9H', '7C'], [], [B + 1])).toThrow(/단위/);
  });
  it('딜러 블랙잭 피크: 즉시 공개, 원금만 잃고 플레이어 블랙잭은 푸시', () => {
    const s = start([human(0), human(1)], [['10S', '9D'], ['AS', 'JD']], ['AH', 'KC'], FILLER, [300, 200]);
    expect(s.phase).toBe('done');
    expect(s.dealerBlackjack).toBe(true);
    expect(s.holeRevealed).toBe(true);
    const d = deltas(s);
    expect(d[0]).toBe(-300);
    expect(d[1]).toBe(0);
    expect(s.events.some((e) => e.t === 'dealer_blackjack')).toBe(true);
  });
  it('10점 업카드도 피크한다', () => {
    const s = start([human(0)], [['10S', '9D']], ['KH', 'AC']);
    expect(s.phase).toBe('done');
    expect(deltas(s)[0]).toBe(-B);
  });
  it('업카드가 10/A가 아니면 피크하지 않고, 딜러의 2장 21은 진행 중 드러나지 않음', () => {
    const s = start([human(0)], [['10S', '9D']], ['9H', '2C']);
    expect(s.phase).toBe('play');
    expect(blackjack.view(s).public.dealer.cards).toEqual(['9H', null]);
  });
  it('딜러 블랙잭이 아니면 플레이어 블랙잭은 건너뛰고 다음 자리부터', () => {
    let s = start([human(0), human(1)], [['AS', 'KD'], ['10S', '8D']], ['AH', '7C']);
    expect(s.phase).toBe('play');
    expect(blackjack.pending(s)).toEqual([1]);
    s = act(s, 1, { type: 'stand' });
    expect(s.phase).toBe('done');
    const d = deltas(s);
    expect(d[0]).toBe(150);
    expect(d[1]).toBe(0); // 18 대 18
  });
});

describe('기본 결과', () => {
  it('푸시', () => {
    let s = start([human(0)], [['10S', '9D']], ['10H', '9C']);
    s = act(s, 0, { type: 'stand' });
    expect(deltas(s)[0]).toBe(0);
    expect(s.seats[0].hands[0].result).toBe('push');
  });
  it('버스트는 즉시 패', () => {
    let s = start([human(0), human(1)], [['10S', '6D'], ['10C', '8D']], ['10H', '7C'], ['KD']);
    s = act(s, 0, { type: 'hit' });
    expect(s.seats[0].hands[0].status).toBe('bust');
    expect(blackjack.pending(s)).toEqual([1]);
    s = act(s, 1, { type: 'stand' });
    expect(deltas(s)).toEqual({ 0: -B, 1: B });
    expect(s.seats[0].hands[0].result).toBe('bust');
  });
  it('21이 되면 자동 스탠드', () => {
    let s = start([human(0)], [['10S', '6D']], ['10H', '7C'], ['5D']);
    s = act(s, 0, { type: 'hit' });
    expect(s.phase).toBe('done');
    expect(deltas(s)[0]).toBe(B);
  });
});

describe('더블다운', () => {
  it('베팅 2배, 정확히 한 장 받고 끝', () => {
    let s = start([human(0)], [['6S', '5D']], ['10H', '7C'], ['2D', 'KS']);
    s = act(s, 0, { type: 'double' });
    expect(s.phase).toBe('done');
    const h = s.seats[0].hands[0];
    expect(h.cards).toEqual(['6S', '5D', '2D']);
    expect(h.bet).toBe(2 * B);
    expect(h.status).toBe('doubled');
    expect(deltas(s)[0]).toBe(-2 * B); // 13 대 17
  });
  it('더블 승리는 2배', () => {
    let s = start([human(0)], [['6S', '5D']], ['10H', '7C'], ['KD']);
    s = act(s, 0, { type: 'double' });
    expect(deltas(s)[0]).toBe(2 * B);
  });
  it('세 장 이후에는 더블 불가', () => {
    let s = start([human(0)], [['2S', '3D']], ['10H', '7C'], ['2D', '9S']);
    s = act(s, 0, { type: 'hit' });
    expect(() => act(s, 0, { type: 'double' })).toThrow(EngineError);
    expect(blackjack.view(s).public.legal).toEqual(['hit', 'stand']);
  });
  it('stack이 부족하면 더블 불가', () => {
    const s = start([human(0, 150)], [['6S', '5D']], ['10H', '7C'], ['KD']);
    expect(() => act(s, 0, { type: 'double' })).toThrow(EngineError);
    const s2 = start([human(0, 200)], [['6S', '5D']], ['10H', '7C'], ['KD']);
    expect(act(s2, 0, { type: 'double' }).seats[0].hands[0].bet).toBe(200);
  });
  it('원래 상태는 바뀌지 않는다', () => {
    const s = start([human(0)], [['6S', '5D']], ['10H', '7C'], ['KD']);
    const snap = JSON.stringify(s);
    act(s, 0, { type: 'double' });
    expect(JSON.stringify(s)).toBe(snap);
  });
});

describe('스플릿', () => {
  it('10과 K는 같은 점수라 스플릿 가능, 핸드 2개 순서대로', () => {
    let s = start([human(0)], [['10S', 'KD']], ['10H', '7C'], ['9D', '8S', '9C']);
    expect(blackjack.view(s).public.legal).toContain('split');
    s = act(s, 0, { type: 'split' });
    const st = s.seats[0];
    expect(st.hands).toHaveLength(2);
    expect(st.hands[0].cards).toEqual(['10S', '9D']);
    expect(st.hands[1].cards).toEqual(['KD']); // 둘째 핸드는 차례가 오면 받는다
    expect(s.turn).toEqual({ seat: 0, hand: 0 });
    s = act(s, 0, { type: 'stand' });
    expect(s.turn).toEqual({ seat: 0, hand: 1 });
    expect(s.seats[0].hands[1].cards).toEqual(['KD', '8S']);
    s = act(s, 0, { type: 'stand' });
    expect(s.phase).toBe('done');
    expect(s.seats[0].hands.map((h) => h.result)).toEqual(['win', 'win']);
    expect(deltas(s)[0]).toBe(2 * B);
  });
  it('점수가 다르면 스플릿 불가', () => {
    const s = start([human(0)], [['9S', 'KD']], ['10H', '7C']);
    expect(() => act(s, 0, { type: 'split' })).toThrow(EngineError);
  });
  it('한 번만 스플릿', () => {
    let s = start([human(0)], [['8S', '8D']], ['10H', '7C'], ['8C', '10D', '3S']);
    s = act(s, 0, { type: 'split' });
    expect(s.seats[0].hands[0].cards).toEqual(['8S', '8C']);
    expect(blackjack.view(s).public.legal).not.toContain('split');
    expect(() => act(s, 0, { type: 'split' })).toThrow(EngineError);
  });
  it('stack이 부족하면 스플릿 불가', () => {
    const s = start([human(0, 150)], [['8S', '8D']], ['10H', '7C']);
    expect(() => act(s, 0, { type: 'split' })).toThrow(EngineError);
  });
  it('스플릿 에이스는 한 장씩 받고 자동 스탠드, 21이어도 1:1', () => {
    let s = start([human(0)], [['AS', 'AD']], ['10H', '7C'], ['KD', '5S', '9C']);
    s = act(s, 0, { type: 'split' });
    expect(s.phase).toBe('done');
    const hs = s.seats[0].hands;
    expect(hs[0].cards).toEqual(['AS', 'KD']);
    expect(hs[1].cards).toEqual(['AD', '5S']);
    expect(hs[0].result).toBe('win');
    expect(hs[0].delta).toBe(B); // 블랙잭(3:2) 아님
    expect(hs[1].result).toBe('lose'); // 16 대 17
    expect(deltas(s)[0]).toBe(0);
    expect(s.dealer).toEqual(['10H', '7C']);
  });
  it('스플릿 후 21(비에이스)도 1:1이고 자동 스탠드', () => {
    let s = start([human(0)], [['KS', 'KD']], ['10H', '7C'], ['AC', '9S']);
    s = act(s, 0, { type: 'split' });
    expect(s.seats[0].hands[0].status).toBe('stood');
    expect(s.turn).toEqual({ seat: 0, hand: 1 });
    s = act(s, 0, { type: 'stand' });
    expect(s.seats[0].hands[0].delta).toBe(B);
    expect(s.seats[0].hands[0].result).toBe('win');
  });
  it('스플릿 후 더블 가능', () => {
    let s = start([human(0)], [['5S', '5D']], ['10H', '7C'], ['6C', 'KS', '4D', '2H']);
    s = act(s, 0, { type: 'split' });
    expect(s.seats[0].hands[0].cards).toEqual(['5S', '6C']);
    s = act(s, 0, { type: 'double' });
    expect(s.seats[0].hands[0].cards).toEqual(['5S', '6C', 'KS']);
    expect(s.seats[0].hands[0].bet).toBe(2 * B);
    expect(s.turn).toEqual({ seat: 0, hand: 1 });
    expect(s.seats[0].hands[1].cards).toEqual(['5D', '4D']);
    s = act(s, 0, { type: 'double' });
    expect(s.phase).toBe('done');
    // 21 승(+200), 11 패(-200)
    expect(deltas(s)[0]).toBe(0);
  });
  it('스플릿 후 더블은 stack 한도 안에서만', () => {
    let s = start([human(0, 250)], [['5S', '5D']], ['10H', '7C'], ['6C', 'KS', '4D', '2H']);
    s = act(s, 0, { type: 'split' });
    expect(() => act(s, 0, { type: 'double' })).toThrow(EngineError);
  });
});

describe('베팅', () => {
  it('베팅 범위 검사', () => {
    const s = newRoundWithShoe({ seats: [human(0, 50_000)], baseUnit: B, rng }, FILLER);
    expect(() => act(s, 0, { type: 'bet', amount: 99 })).toThrow(EngineError);
    expect(() => act(s, 0, { type: 'bet', amount: 10_001 })).toThrow(EngineError);
    expect(() => act(s, 0, { type: 'bet', amount: 150.5 })).toThrow(EngineError);
    expect(act(s, 0, { type: 'bet', amount: 10_000 }).seats[0].bet).toBe(10_000);
    const poor = newRoundWithShoe({ seats: [human(0, 300)], baseUnit: B, rng }, FILLER);
    expect(() => act(poor, 0, { type: 'bet', amount: 301 })).toThrow(EngineError);
    expect(act(poor, 0, { type: 'bet', amount: 300 }).seats[0].bet).toBe(300);
  });
  it('베팅은 동시에, 모두 걸면 딜', () => {
    let s = newRoundWithShoe({ seats: [human(0), ai(2), human(5)], baseUnit: B, rng }, stackDeal([['2S', '3S'], ['2D', '3D'], ['2H', '3H']], ['9C', '7C'], FILLER));
    expect(blackjack.pending(s)).toEqual([0, 2, 5]);
    s = act(s, 5, { type: 'bet', amount: B });
    expect(blackjack.pending(s)).toEqual([0, 2]);
    expect(() => act(s, 5, { type: 'bet', amount: B })).toThrow(EngineError);
    expect(() => act(s, 0, { type: 'hit' })).toThrow(EngineError);
    s = act(s, 2, { type: 'bet', amount: B });
    s = act(s, 0, { type: 'bet', amount: B });
    expect(s.phase).toBe('play');
    expect(s.seats.map((x) => x.hands[0].cards)).toEqual([['2S', '3S'], ['2D', '3D'], ['2H', '3H']]);
    expect(blackjack.pending(s)).toEqual([0]);
  });
  it('stack이 최소 베팅보다 작으면 빠진다', () => {
    let s = newRoundWithShoe(
      { seats: [human(0, 99), human(1)], baseUnit: B, rng },
      stackDeal([['10S', '9S']], ['10C', '7C'], FILLER),
    );
    expect(s.seats[0].out).toBe(true);
    expect(blackjack.pending(s)).toEqual([1]);
    s = act(s, 1, { type: 'bet', amount: B });
    s = act(s, 1, { type: 'stand' });
    expect(deltas(s)).toEqual({ 1: B }); // 쉰 자리는 정산에 없다 (시아코인을 받지 않게)
    expect(blackjack.view(s).public.seats[0].out).toBe(true);
  });
  it('모두 빠지면 카드 없이 끝', () => {
    const s = newRoundWithShoe({ seats: [human(0, 10)], baseUnit: B, rng }, FILLER);
    expect(blackjack.done(s)).toBe(true);
    expect(deltas(s)).toEqual({});
    expect(blackjack.settle(s).carry.shoe).toHaveLength(FILLER.length);
    let s2 = newRoundWithShoe({ seats: [human(0)], baseUnit: B, rng }, FILLER);
    s2 = act(s2, 0, { type: 'sitout' });
    expect(blackjack.done(s2)).toBe(true);
  });
});

describe('슈 유지·재셔플', () => {
  it('carry가 없으면 새 6덱', () => {
    const s = blackjack.newRound({ seats: [human(0)], baseUnit: B, carry: null, rng: seededRng(1) });
    expect(s.shoe).toHaveLength(SHOE_SIZE);
    expect(s.cut).toBe(CUT);
    expect(CUT).toBe(78);
  });
  it('25% 이상 남으면 슈를 이어 쓰고, 미만이면 재셔플', () => {
    const r = seededRng(3);
    const shoe = freshShoe().slice(0, CUT);
    const kept = blackjack.newRound({ seats: [human(0)], baseUnit: B, carry: { shoe, cut: CUT }, rng: r });
    expect(kept.shoe).toEqual(shoe);
    const re = blackjack.newRound({ seats: [human(0)], baseUnit: B, carry: { shoe: shoe.slice(1), cut: CUT }, rng: r });
    expect(re.shoe).toHaveLength(SHOE_SIZE);
    expect(re.events.some((e) => e.t === 'reshuffle')).toBe(true);
  });
  it('정산 carry는 남은 슈 그대로', () => {
    const r = seededRng(4);
    let s = blackjack.newRound({ seats: [human(0)], baseUnit: B, carry: null, rng: r });
    s = blackjack.apply(s, 0, { type: 'bet', amount: B }, r);
    while (!blackjack.done(s)) s = blackjack.apply(s, 0, { type: 'stand' }, r);
    const { carry } = blackjack.settle(s);
    const used = s.dealer.length + s.seats[0].hands[0].cards.length;
    expect(carry.shoe).toHaveLength(SHOE_SIZE - used);
    const next = blackjack.newRound({ seats: [human(0)], baseUnit: B, carry, rng: r });
    expect(next.shoe).toEqual(carry.shoe);
  });
});

describe('차례·시간 초과·오류', () => {
  it('여러 명은 자리 순서대로', () => {
    let s = start([human(1), human(3), human(4)], [['10S', '5S'], ['10D', '6D'], ['10H', '4H']], ['10C', '7C'], ['2S', '2D', '2H']);
    expect(blackjack.pending(s)).toEqual([1]);
    expect(() => act(s, 3, { type: 'stand' })).toThrow(EngineError);
    s = act(s, 1, { type: 'hit' });
    expect(blackjack.pending(s)).toEqual([1]);
    s = act(s, 1, { type: 'stand' });
    expect(blackjack.pending(s)).toEqual([3]);
    s = act(s, 3, { type: 'stand' });
    expect(blackjack.pending(s)).toEqual([4]);
    s = act(s, 4, { type: 'stand' });
    expect(blackjack.done(s)).toBe(true);
  });
  it('스탠드 후 히트는 오류, 끝난 판 행동도 오류', () => {
    let s = start([human(0), human(1)], [['10S', '8S'], ['10D', '8D']], ['10C', '7C']);
    s = act(s, 0, { type: 'stand' });
    expect(() => act(s, 0, { type: 'hit' })).toThrow(EngineError);
    s = act(s, 1, { type: 'stand' });
    expect(() => act(s, 1, { type: 'hit' })).toThrow(EngineError);
    expect(() => act(s, 0, { type: 'bet', amount: B })).toThrow(EngineError);
  });
  it('플레이 중 베팅은 오류, 정산은 끝난 뒤에만', () => {
    const s = start([human(0)], [['10S', '8S']], ['10C', '7C']);
    expect(() => act(s, 0, { type: 'bet', amount: B })).toThrow(EngineError);
    expect(() => blackjack.settle(s)).toThrow(EngineError);
  });
  it('시간 초과: 베팅은 최소, 플레이는 스탠드', () => {
    let s = newRoundWithShoe({ seats: [human(0, 500), ai(1)], baseUnit: B, rng }, stackDeal([['10S', '8S'], ['10D', '8D']], ['10C', '7C'], FILLER));
    expect(blackjack.timeout(s, 0, rng)).toEqual({ type: 'bet', amount: B });
    expect(blackjack.timeout(s, 1, rng)).toEqual({ type: 'bet', amount: B });
    s = act(s, 0, blackjack.timeout(s, 0, rng));
    s = act(s, 1, blackjack.timeout(s, 1, rng));
    expect(blackjack.timeout(s, 0, rng)).toEqual({ type: 'stand' });
    // stack이 최소보다 작으면 sitout (보통은 이미 빠져 있음)
    const fake = JSON.parse(JSON.stringify(newRoundWithShoe({ seats: [human(0)], baseUnit: B, rng }, FILLER))) as BjState;
    fake.seats[0].stack = 50;
    expect(blackjack.timeout(fake, 0, rng)).toEqual({ type: 'sitout' });
  });
});

describe('화면 정보', () => {
  it('홀카드와 슈는 공개 정보에 없다', () => {
    const s = start([human(0)], [['10S', '8S']], ['9C', 'QH'], ['5D']);
    const v = blackjack.view(s);
    expect(v.public.dealer.cards).toEqual(['9C', null]);
    expect(v.public.dealer.total).toBe(9);
    const json = JSON.stringify(v);
    expect(json).not.toContain('QH');
    expect(json).not.toContain('5D');
    expect(json).not.toContain('"shoe"');
    expect(v.public.shoeRemaining).toBe(1);
    expect(v.private).toEqual({ 0: {} });
    const done = blackjack.view(act(s, 0, { type: 'stand' }));
    expect(done.public.dealer.cards).toEqual(['9C', 'QH']);
    expect(done.public.summary).not.toBeNull();
    expect(done.public.seats[0].delta).toBe(-B);
  });
  it('이벤트 id는 늘어나고 최대 30개', () => {
    let s = start([human(0)], [['AS', 'AD']], ['10C', '7C'], Array.from({ length: 40 }, () => 'AC'));
    for (let i = 0; i < 8; i++) s = act(s, 0, { type: 'hit' });
    const ev = blackjack.view(s).public.events;
    for (let i = 1; i < ev.length; i++) expect(ev[i].id).toBeGreaterThan(ev[i - 1].id);
    expect(ev.length).toBeLessThanOrEqual(30);
  });
});

describe('AI', () => {
  it('베팅은 1~5 × 기본 단위', () => {
    const r = seededRng(9);
    const s = blackjack.newRound({ seats: [ai(0)], baseUnit: B, carry: null, rng: r });
    for (let i = 0; i < 50; i++) {
      const a = blackjack.ai(blackjack.view(s).public, {}, 0, r);
      expect(a.type).toBe('bet');
      if (a.type === 'bet') expect([100, 200, 300, 400, 500]).toContain(a.amount);
    }
  });
  it('기본 전략을 대체로 따른다', () => {
    const r = seededRng(11);
    const count = (players: [Card, Card], dealer: [Card, Card]) => {
      const tally: Record<string, number> = {};
      const s = start([ai(0)], [players], dealer);
      for (let i = 0; i < 200; i++) {
        const a = blackjack.ai(blackjack.view(s).public, {}, 0, r);
        tally[a.type] = (tally[a.type] ?? 0) + 1;
      }
      return tally;
    };
    expect(count(['6S', '5D'], ['6C', '10C']).double).toBeGreaterThan(160);
    expect(count(['8S', '8D'], ['10C', '7C']).split).toBeGreaterThan(160);
    expect(count(['10S', '6D'], ['10C', '7C']).hit).toBeGreaterThan(160);
    expect(count(['10S', '3D'], ['5C', '7C']).stand).toBeGreaterThan(160);
    expect(count(['AS', '7D'], ['9C', '7C']).hit).toBeGreaterThan(160);
    expect(count(['10S', '10D'], ['6C', '7C']).stand).toBeGreaterThan(160);
  });
});

describe('무작위 500판', () => {
  it('불변식', () => {
    let violations = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const r = seededRng(seed * 7919);
      const n = 1 + (seed % 4);
      const seats: SeatInfo[] = Array.from({ length: n }, (_, i) => ai(i * 2 + (seed % 2)));
      let carry = null as ReturnType<typeof blackjack.settle>['carry'] | null;
      for (let round = 0; round < 20; round++) {
        let s = blackjack.newRound({ seats, baseUnit: B, carry, rng: r });
        const startShoe = s.shoe.slice();
        let steps = 0;
        while (!blackjack.done(s)) {
          const p = blackjack.pending(s);
          expect(p.length).toBeGreaterThan(0);
          const v = blackjack.view(s);
          // 홀카드 공개 전에는 null, 슈는 노출되지 않음
          if (!s.holeRevealed && s.dealer.length === 2) {
            expect(v.public.dealer.cards[1]).toBeNull();
            expect(v.public.events.some((e) => e.t === 'dealer_reveal' || e.t === 'dealer_blackjack')).toBe(false);
          }
          expect(JSON.stringify(v.public)).not.toContain('"shoe"');
          const seat = p[r.int(p.length)];
          s = blackjack.apply(s, seat, blackjack.ai(v.public, v.private[seat], seat, r), r);
          if (++steps > 200) throw new Error('판이 끝나지 않음');
        }
        const st = blackjack.settle(s);
        // 카드 보존: 시작 슈 = 남은 슈 + 테이블 카드 (중간 재셔플 없을 때)
        if (s.refills === 0) {
          const table = [...s.dealer, ...s.seats.flatMap((x) => x.hands.flatMap((h) => h.cards))];
          expect([...st.carry.shoe, ...table].sort()).toEqual([...startShoe].sort());
          expect(startShoe.slice(table.length)).toEqual(st.carry.shoe);
        } else violations++;
        for (const x of s.seats) {
          const exposure = x.hands.reduce((a, h) => a + h.bet, 0);
          expect(exposure).toBeLessThanOrEqual(4 * 100 * B);
          const d = st.deltas[x.seat];
          expect(d).toBeGreaterThanOrEqual(-exposure);
          expect(d).toBeLessThanOrEqual(1.5 * exposure);
          expect(Number.isInteger(d)).toBe(true);
        }
        carry = st.carry;
      }
    }
    expect(violations).toBe(0);
  });
});

describe('기본 전략', () => {
  it('소프트 12 (A,A 인데 스플릿 못 할 때)는 딜러 카드와 상관없이 히트', () => {
    for (const up of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) expect(basicStrategy(['AS', 'AD'], up, false)).toBe('H');
    expect(basicStrategy(['AS', 'AD'], 6, true)).toBe('P');
  });
});
