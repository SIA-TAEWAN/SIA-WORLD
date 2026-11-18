import { describe, expect, it } from 'vitest';
import { seededRng, type GameEvent, type SeatInfo } from './engine.ts';
import { blackjack, newRoundWithShoe, stackDeal, type BjPublic, type BjState } from './blackjack.ts';
import { rewindBlackjack } from './blackjack-rewind.ts';

/** 화면에 그리는 값만 (차례·단계 표시는 되돌린 화면에서 따로 정한다) */
const shown = (p: BjPublic, withShoe = true) => ({
  dealer: { cards: p.dealer.cards, total: p.dealer.total, soft: p.dealer.soft, revealed: p.dealer.revealed, blackjack: p.dealer.blackjack },
  seats: p.seats.map((s) => ({
    seat: s.seat,
    out: s.out,
    bet: s.bet,
    delta: s.delta,
    hands: s.hands.map((h) => ({ cards: h.cards, bet: h.bet, total: h.total, soft: h.soft, doubled: h.doubled, fromSplit: h.fromSplit, result: h.result, delta: h.delta })),
  })),
  shoe: withShoe ? p.shoeRemaining : 0,
});
const maxId = (p: BjPublic) => p.events.reduce((a, e) => Math.max(a, e.id), 0);
const fresh = (p: BjPublic, seen: number): GameEvent[] => p.events.filter((e) => e.id > seen);

const human = (seat: number): SeatInfo => ({ seat, kind: 'human', name: `사람${seat}`, stack: 1_000_000 });

describe('블랙잭 되돌리기 (한 동작씩 보여 주기)', () => {
  it('판 시작: 베팅을 되돌리면 아무도 베팅하지 않은 빈 판', () => {
    const rng = seededRng(3);
    let s = blackjack.newRound({ seats: [human(0), human(1), human(2)], baseUnit: 100, carry: null, rng });
    s = blackjack.apply(s, 1, { type: 'bet', amount: 300 }, rng);
    s = blackjack.apply(s, 2, { type: 'bet', amount: 200 }, rng);
    const pub = blackjack.view(s).public;
    const ev = pub.events.filter((e) => e.t === 'bet');
    const frames = rewindBlackjack(pub, ev);
    expect(frames).toHaveLength(2);
    expect(frames[0].seats.map((x) => x.bet)).toEqual([null, null, null]);
    expect(frames[0].waitingBets).toEqual([0, 1, 2]);
    expect(frames[1].seats.map((x) => x.bet)).toEqual([null, 300, null]);
    expect(frames[0].phase).toBe('bet');
    // 원래 상태는 바뀌지 않는다
    expect(pub.seats.map((x) => x.bet)).toEqual([null, 300, 200]);
  });

  it('스플릿: 두 장이 갈라지고 → 첫 핸드가 한 장 받고 → (첫 핸드가 끝나면) 둘째 핸드가 한 장 받는다', () => {
    const rng = seededRng(5);
    let s: BjState = newRoundWithShoe({ seats: [human(0)], baseUnit: 100, rng }, stackDeal([['8S', '8D']], ['6H', '10C'], ['3C', '9H', '5S', '10D', '2C']));
    s = blackjack.apply(s, 0, { type: 'bet', amount: 100 }, rng);
    const before = blackjack.view(s).public;
    const s2 = blackjack.apply(s, 0, { type: 'split' }, rng);
    const after = blackjack.view(s2).public;
    const ev = fresh(after, maxId(before));
    expect(ev.map((e) => e.t)).toEqual(['split', 'hit']);
    const frames = rewindBlackjack(after, ev);
    // 0: 스플릿 전 (한 핸드에 두 장), 1: 갈라진 직후 (한 장씩), 그다음이 실제 상태 (첫 핸드 두 장)
    expect(frames[0].seats[0].hands.map((h) => h.cards)).toEqual([['8S', '8D']]);
    expect(frames[0].seats[0].hands[0].fromSplit).toBe(false);
    expect(frames[1].seats[0].hands.map((h) => h.cards)).toEqual([['8S'], ['8D']]);
    expect(frames[1].seats[0].hands.map((h) => h.total)).toEqual([8, 8]);
    expect(frames[1].turn).toEqual({ seat: 0, hand: 0 });
    expect(after.seats[0].hands.map((h) => h.cards)).toEqual([['8S', '3C'], ['8D']]);
    expect(shown(frames[0])).toEqual(shown(before));
    // 첫 핸드 스탠드 → 둘째 핸드가 두 번째 카드를 받는다
    const s3 = blackjack.apply(s2, 0, { type: 'stand' }, rng);
    const after3 = blackjack.view(s3).public;
    const ev3 = fresh(after3, maxId(after));
    expect(ev3.map((e) => e.t)).toEqual(['stand', 'hit']);
    const f3 = rewindBlackjack(after3, ev3);
    expect(f3[1].seats[0].hands.map((h) => h.cards)).toEqual([['8S', '3C'], ['8D']]);
    expect(f3[1].turn).toEqual({ seat: 0, hand: 1 });
    expect(after3.seats[0].hands[1].cards).toEqual(['8D', '9H']);
  });

  it('되돌릴 수 없는 사건 모양이면 예외 (화면은 예전 방식으로 보여 준다)', () => {
    const rng = seededRng(5);
    let s: BjState = newRoundWithShoe({ seats: [human(0)], baseUnit: 100, rng }, stackDeal([['9S', '7D']], ['6H', '10C'], ['3C', '9H', '5S']));
    s = blackjack.apply(s, 0, { type: 'bet', amount: 100 }, rng);
    const pub = blackjack.view(s).public;
    expect(() => rewindBlackjack(pub, [{ id: 99, t: 'split', seat: 0 }])).toThrow();
    expect(() => rewindBlackjack(pub, [{ id: 99, t: 'hit', seat: 7, hand: 0 }])).toThrow();
  });

  it('무작위 300판: 어느 행동이든 새 사건을 모두 되돌리면 그 행동 직전 화면과 같다', () => {
    const rng = seededRng(20261118);
    let carry = null as ReturnType<typeof blackjack.settle>['carry'] | null;
    let checked = 0;
    let splits = 0;
    for (let round = 0; round < 300; round++) {
      const seats: SeatInfo[] = [0, 1, 2, 3].map((i) => ({ seat: i, kind: i < 2 ? 'human' : 'ai', name: `자리${i}`, stack: i < 2 ? 50_000 : null }));
      let s = blackjack.newRound({ seats, baseUnit: 100, carry, rng });
      // 판 시작 상태를 통째로 되돌리면 빈 판
      const first = blackjack.view(s).public;
      if (first.events.length) {
        const f0 = rewindBlackjack(first, first.events)[0];
        expect(f0.seats.every((x) => x.bet === null && x.hands.length === 0)).toBe(true);
      }
      // 여러 행동을 묶어서(서버가 AI 차례를 이어서 두는 것처럼) 되돌려 본다
      let base = first;
      let baseSeen = maxId(first);
      let chain = 0;
      for (let step = 0; step < 200 && !blackjack.done(s); step++) {
        const seat = blackjack.pending(s)[0];
        const v = blackjack.view(s);
        s = blackjack.apply(s, seat, blackjack.ai(v.public, v.private[seat], seat, rng), rng);
        const pub = blackjack.view(s).public;
        const ev = fresh(pub, baseSeen);
        const exact = ev.every((e, i) => e.id === baseSeen + 1 + i);
        if (exact && ev.length) {
          const frames = rewindBlackjack(pub, ev);
          expect(frames).toHaveLength(ev.length);
          const reshuffled = ev.some((e) => e.t === 'reshuffle');
          expect(shown(frames[0], !reshuffled)).toEqual(shown(base, !reshuffled));
          for (const f of frames) expect(f.summary).toBeNull();
          if (ev.some((e) => e.t === 'split')) splits++;
          checked++;
        }
        // 가끔 기준을 옮긴다 (한 동작만 되돌리는 경우와 여러 동작을 되돌리는 경우를 모두)
        if (++chain >= 1 + rng.int(4) || !exact) {
          base = pub;
          baseSeen = maxId(pub);
          chain = 0;
        }
      }
      expect(blackjack.done(s)).toBe(true);
      carry = blackjack.settle(s).carry;
    }
    expect(checked).toBeGreaterThan(1000);
    expect(splits).toBeGreaterThan(5);
  });
});
