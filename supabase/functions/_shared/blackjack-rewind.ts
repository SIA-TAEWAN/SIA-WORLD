/**
 * 블랙잭 화면용 '되돌리기' (브라우저에서 쓴다. 서버 엔진은 쓰지 않는다. 순수 함수라 여기 두고 엔진과 함께 테스트한다).
 *
 * 서버는 한 번의 응답에 여러 동작(AI 베팅 여러 개, 딜, 히트, 딜러, 정산…)을 담아 보낸다.
 * 화면은 그것을 한 동작씩 보여 줘야 하므로, 새 공개 상태에서 새 사건을 뒤에서부터 하나씩 되돌려
 * 각 사건 직전의 공개 상태를 만든다 (games/lib/shell.ts의 GameUI.rewind).
 *
 * out[i] = events[i]가 일어나기 직전의 화면. 차례 표시(turn)는 그 사건을 하는 자리·핸드.
 * 되돌릴 수 없는 모양이면 예외를 던진다 (화면은 그때 예전 방식: 말풍선 → 새 상태).
 */
import type { GameEvent } from './engine.ts';
import { handValue, type BjPublic } from './blackjack.ts';

export function rewindBlackjack(next: BjPublic, events: readonly GameEvent[]): BjPublic[] {
  const out: BjPublic[] = new Array(events.length);
  let cur = next;
  for (let i = events.length - 1; i >= 0; i--) {
    cur = JSON.parse(JSON.stringify(cur)) as BjPublic;
    undo(cur, events[i]);
    out[i] = cur;
  }
  return out;
}

function undo(p: BjPublic, e: GameEvent) {
  const seat = typeof e.seat === 'number' ? p.seats.find((x) => x.seat === e.seat) : undefined;
  const hi = typeof e.hand === 'number' ? e.hand : 0;
  const need = <T,>(v: T | undefined | null): T => {
    if (v === undefined || v === null) throw new Error(`되돌릴 수 없는 사건: ${e.t}`);
    return v;
  };
  const hideHole = () => {
    if (p.dealer.cards.length >= 2) p.dealer.cards[1] = null;
    p.dealer.revealed = false;
    p.dealer.blackjack = false;
  };
  let phase: BjPublic['phase'] = 'play';
  let turn: BjPublic['turn'] = null;
  switch (e.t) {
    case 'result':
      for (const h of need(seat).hands) {
        h.result = null;
        h.delta = null;
      }
      need(seat).delta = null;
      phase = 'dealer';
      break;
    case 'dealer_stand':
    case 'dealer_bust':
      phase = 'dealer';
      break;
    case 'dealer_hit':
      need(p.dealer.cards.pop());
      p.shoeRemaining += 1;
      phase = 'dealer';
      break;
    case 'dealer_reveal':
    case 'dealer_blackjack':
      hideHole();
      phase = 'dealer';
      break;
    case 'bust':
    case 'stand':
      need(need(seat).hands[hi]);
      turn = { seat: need(seat).seat, hand: hi };
      break;
    case 'hit':
    case 'double': {
      const h = need(need(seat).hands[hi]);
      if (h.cards.length < 2) throw new Error('되돌릴 카드가 없어요');
      h.cards.pop();
      p.shoeRemaining += 1;
      if (e.t === 'double') {
        h.bet = Math.round(h.bet / 2);
        h.doubled = false;
      }
      turn = { seat: need(seat).seat, hand: hi };
      break;
    }
    case 'split': {
      const st = need(seat);
      if (st.hands.length !== 2 || st.hands[0].cards.length !== 1 || st.hands[1].cards.length !== 1) throw new Error('스플릿을 되돌릴 수 없어요');
      st.hands[0].cards.push(st.hands[1].cards[0]);
      st.hands[0].fromSplit = false;
      st.hands.pop();
      turn = { seat: st.seat, hand: 0 };
      break;
    }
    case 'deal':
      for (const st of p.seats) {
        p.shoeRemaining += st.hands.reduce((a, h) => a + h.cards.length, 0);
        st.hands = [];
      }
      p.shoeRemaining += p.dealer.cards.length;
      p.dealer.cards = [];
      hideHole();
      phase = 'bet';
      break;
    case 'bet':
      need(seat).bet = null;
      phase = 'bet';
      break;
    case 'sitout':
      // 스스로 쉰 자리만 되돌린다 (칩이 모자라 빠진 자리는 판 시작부터 쉬는 중)
      if (e.reason === 'choice') {
        need(seat).out = false;
        need(seat).outReason = null;
      }
      phase = 'bet';
      break;
    case 'reshuffle':
      phase = p.dealer.cards.length ? 'play' : 'bet';
      break;
    default:
      // 'blackjack' 등: 화면은 그대로
      break;
  }
  for (const st of p.seats) {
    for (const h of st.hands) {
      const v = handValue(h.cards);
      h.total = v.total;
      h.soft = v.soft;
    }
  }
  const shown = p.dealer.cards.filter((c): c is string => c !== null);
  const dv = shown.length ? handValue(shown) : null;
  p.dealer.total = dv ? dv.total : null;
  p.dealer.soft = dv ? dv.soft : false;
  p.phase = phase;
  p.turn = turn;
  p.legal = [];
  p.waitingBets = phase === 'bet' ? p.seats.filter((x) => !x.out && x.bet === null).map((x) => x.seat) : [];
  p.summary = null;
}
