/**
 * 블랙잭 규칙 엔진 (서버 전용, 순수 TypeScript).
 *
 * 규칙 요약
 * - 6덱(312장) 슈. 남은 카드가 78장(25%) 미만이거나 carry가 없으면 판 시작 전에 새로 섞는다.
 * - 카드 표기: 문자열 `랭크 + 무늬`. 랭크 'A','2'..'10','J','Q','K', 무늬 'S','D','H','C'. 예: 'AS', '10H', 'KD'.
 * - 판 흐름: 베팅(동시) → 딜(각 자리 2장 공개, 딜러 1장 공개 + 1장 숨김) → 딜러 피크 → 자리 순서대로 행동 → 딜러 → 정산.
 * - 딜 순서: 자리 순서대로 1장씩 → 딜러 업카드 → 자리 순서대로 1장씩 → 딜러 홀카드. 슈는 배열 앞에서부터 뽑는다.
 * - 딜러는 소프트 17 포함 17 이상에서 선다 (S17). 보험·서렌더 없음.
 * - 플레이어 블랙잭 3:2 (소수점 버림). 스플릿 후 21은 블랙잭이 아니다 (1:1).
 * - 스플릿은 같은 점수의 첫 두 장(10과 K도 같음)일 때 한 번만 (최대 2핸드). 스플릿 에이스는 한 장씩만 받고 자동 스탠드.
 * - 스플릿 후 더블 가능 (스플릿 에이스 제외).
 * - 스플릿 시 첫 핸드는 바로 두 번째 카드를 받고, 둘째 핸드는 자기 차례가 올 때 받는다 (스플릿 에이스는 둘 다 즉시).
 * - 어떤 핸드든 21이 되면 자동 스탠드.
 * - 사람 자리의 stack이 baseUnit보다 작으면 이번 판은 자동으로 빠진다(out). 베팅 단계에서 스스로 빠질 수도 있다(sitout).
 * - 베팅·더블·스플릿 합계는 stack을 넘을 수 없으므로 사람의 손실은 stack을 넘지 않는다.
 * - 판 도중 슈가 바닥나면(사실상 일어나지 않음) 테이블 위 카드를 뺀 새 6덱을 섞어 이어 쓴다.
 */
import {
  clone,
  EngineError,
  shuffle,
  type Engine,
  type GameEvent,
  type Rng,
  type RoundInput,
  type SeatKind,
  type Settlement,
  type View,
} from './engine.ts';

// ───────────────────────── 타입 ─────────────────────────

/** 카드 문자열: 'AS', '10H', 'KD' 등 (랭크 + 무늬) */
export type Card = string;

export type BjPhase = 'bet' | 'play' | 'dealer' | 'done';
export type BjHandStatus = 'playing' | 'stood' | 'bust' | 'blackjack' | 'doubled';
/** 핸드 결과: blackjack(3:2 승), win(1:1), push(무승부), lose(패), bust(버스트 패) */
export type BjResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
export type BjPlayAction = 'hit' | 'stand' | 'double' | 'split';

export type BjAction =
  | { type: 'bet'; amount: number }
  | { type: 'sitout' }
  // hand · cards: 화면이 본 핸드 번호와 장수 (있으면 다르면 거절 — 시간 초과와 겹쳐 다음 핸드에 들어가지 않게)
  | { type: 'hit'; hand?: number; cards?: number }
  | { type: 'stand'; hand?: number; cards?: number }
  | { type: 'double'; hand?: number; cards?: number }
  | { type: 'split'; hand?: number; cards?: number };

export interface BjCarry {
  /** 남은 슈 (앞에서부터 뽑음) */
  shoe: Card[];
  /** 남은 장수가 이 값보다 작으면 다음 판 전에 새로 섞는다 */
  cut: number;
}

export interface BjHand {
  cards: Card[];
  bet: number;
  status: BjHandStatus;
  /** 스플릿으로 생긴 핸드 */
  fromSplit: boolean;
  /** 스플릿 에이스 핸드 */
  splitAces: boolean;
  doubled: boolean;
  result: BjResult | null;
  delta: number | null;
}

export interface BjSeatState {
  seat: number;
  kind: SeatKind;
  name: string;
  /** null = 무한(AI) */
  stack: number | null;
  /** 이번 판에서 빠짐 */
  out: boolean;
  outReason: 'stack' | 'choice' | null;
  /** 처음 건 금액 (아직 안 걸었으면 null) */
  bet: number | null;
  hands: BjHand[];
  split: boolean;
}

export interface BjState {
  phase: BjPhase;
  baseUnit: number;
  seats: BjSeatState[];
  dealer: Card[];
  holeRevealed: boolean;
  dealerBlackjack: boolean;
  shoe: Card[];
  cut: number;
  /** 이번 판 시작 때 슈 장수 (검증용) */
  shoeStart: number;
  /** 판 도중 슈를 다시 채운 횟수 */
  refills: number;
  turn: { seat: number; hand: number } | null;
  events: GameEvent[];
  eventSeq: number;
}

export interface BjHandPublic {
  cards: Card[];
  bet: number;
  total: number;
  soft: boolean;
  status: BjHandStatus;
  fromSplit: boolean;
  doubled: boolean;
  result: BjResult | null;
  delta: number | null;
}

export interface BjSeatPublic {
  seat: number;
  kind: SeatKind;
  name: string;
  out: boolean;
  outReason: 'stack' | 'choice' | null;
  bet: number | null;
  /** 이 자리가 걸 수 있는 최대 금액 (테이블 최대와 stack 중 작은 값) */
  maxBet: number;
  hands: BjHandPublic[];
  /** 판이 끝났을 때 자리 합계 */
  delta: number | null;
}

export interface BjSummary {
  dealer: { cards: Card[]; total: number; blackjack: boolean; bust: boolean };
  seats: { seat: number; name: string; out: boolean; hands: { bet: number; result: BjResult; delta: number }[]; delta: number }[];
}

export interface BjPublic {
  phase: BjPhase;
  baseUnit: number;
  minBet: number;
  maxBet: number;
  dealer: {
    /** 홀카드는 공개 전까지 null */
    cards: (Card | null)[];
    /** 보이는 카드 기준 합계 (카드 없으면 null) */
    total: number | null;
    soft: boolean;
    revealed: boolean;
    blackjack: boolean;
  };
  seats: BjSeatPublic[];
  turn: { seat: number; hand: number } | null;
  /** 지금 차례 핸드에서 가능한 행동 */
  legal: BjPlayAction[];
  /** 아직 베팅 안 한 자리 */
  waitingBets: number[];
  shoeRemaining: number;
  events: GameEvent[];
  summary: BjSummary | null;
}

/** 블랙잭은 모든 카드가 공개이므로 비공개 정보 없음 */
export type BjPrivate = Record<string, never>;

// ───────────────────────── 상수·카드 ─────────────────────────

export const DECKS = 6;
export const SHOE_SIZE = 52 * DECKS;
/** 25% 미만 남으면 재셔플 */
export const CUT = Math.floor(SHOE_SIZE * 0.25);
export const MAX_BET_MULT = 100;
const MAX_EVENTS = 30;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const SUITS = ['S', 'D', 'H', 'C'] as const;

export const rankOf = (c: Card): string => c.slice(0, -1);

/** 카드 점수 (A는 1로) */
export function cardPoint(c: Card): number {
  const r = rankOf(c);
  if (r === 'A') return 1;
  if (r === 'J' || r === 'Q' || r === 'K') return 10;
  return Number(r);
}

/** 6덱 새 슈 (정렬된 상태) */
export function freshShoe(): Card[] {
  const out: Card[] = [];
  for (let d = 0; d < DECKS; d++) for (const s of SUITS) for (const r of RANKS) out.push(r + s);
  return out;
}

/** 핸드 합계. soft = 에이스 하나를 11로 셈 */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let t = 0;
  let aces = 0;
  for (const c of cards) {
    const p = cardPoint(c);
    if (p === 1) aces++;
    t += p;
  }
  if (aces > 0 && t + 10 <= 21) return { total: t + 10, soft: true };
  return { total: t, soft: false };
}

export const isBlackjack = (cards: readonly Card[]): boolean => cards.length === 2 && handValue(cards).total === 21;

/**
 * 테스트용: 원하는 딜이 나오도록 슈 순서를 만든다.
 * players[i] = 자리 순서 i번째 참가자의 첫 두 장, dealer = [업카드, 홀카드], rest = 그다음 뽑힐 카드들.
 */
export function stackDeal(players: [Card, Card][], dealer: [Card, Card], rest: Card[] = []): Card[] {
  return [...players.map((p) => p[0]), dealer[0], ...players.map((p) => p[1]), dealer[1], ...rest];
}

/** 테스트용: 슈 순서를 고정한 판 시작 (재셔플 없음) */
export function newRoundWithShoe(input: Omit<RoundInput<BjCarry>, 'carry'>, shoe: Card[]): BjState {
  return blackjack.newRound({ ...input, carry: { shoe: shoe.slice(), cut: 0 } });
}

// ───────────────────────── 내부 도우미 ─────────────────────────

function pushEvent(s: BjState, e: Omit<GameEvent, 'id'>): void {
  s.eventSeq += 1;
  s.events.push({ ...e, id: s.eventSeq } as GameEvent);
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}

function seatMaxBet(s: BjState, st: BjSeatState): number {
  const tableMax = s.baseUnit * MAX_BET_MULT;
  return st.stack === null ? tableMax : Math.min(tableMax, st.stack);
}

/** 이 자리가 이미 건 총액 */
const committed = (st: BjSeatState): number => st.hands.reduce((a, h) => a + h.bet, 0);

const canAfford = (st: BjSeatState, extra: number): boolean => st.stack === null || committed(st) + extra <= st.stack;

function tableCards(s: BjState): Card[] {
  const out = [...s.dealer];
  for (const st of s.seats) for (const h of st.hands) out.push(...h.cards);
  return out;
}

/** 슈에서 한 장. 바닥나면 테이블 위 카드를 뺀 새 슈를 섞어 채운다 */
function draw(s: BjState, rng: Rng): Card {
  if (s.shoe.length === 0) {
    const pool = freshShoe();
    for (const c of tableCards(s)) {
      const i = pool.indexOf(c);
      if (i >= 0) pool.splice(i, 1);
    }
    s.shoe = shuffle(pool, rng);
    s.refills += 1;
    pushEvent(s, { t: 'reshuffle', remaining: s.shoe.length });
  }
  return s.shoe.shift() as Card;
}

function seatOf(s: BjState, seat: number): BjSeatState {
  const st = s.seats.find((x) => x.seat === seat);
  if (!st) throw new EngineError('없는 자리입니다');
  return st;
}

const activeSeats = (s: BjState): BjSeatState[] => s.seats.filter((x) => !x.out);

function legalActions(s: BjState): BjPlayAction[] {
  if (s.phase !== 'play' || !s.turn) return [];
  const st = seatOf(s, s.turn.seat);
  const h = st.hands[s.turn.hand];
  if (!h || h.status !== 'playing') return [];
  const out: BjPlayAction[] = ['hit', 'stand'];
  if (h.cards.length === 2 && !h.splitAces && canAfford(st, h.bet)) out.push('double');
  if (
    !st.split &&
    st.hands.length === 1 &&
    h.cards.length === 2 &&
    cardPoint(h.cards[0]) === cardPoint(h.cards[1]) &&
    canAfford(st, h.bet)
  )
    out.push('split');
  return out;
}

/** 손 하나에 카드를 준 뒤 21/버스트 처리 */
function afterCard(s: BjState, seat: number, hi: number): void {
  const h = seatOf(s, seat).hands[hi];
  const v = handValue(h.cards);
  if (v.total > 21) {
    h.status = 'bust';
    pushEvent(s, { t: 'bust', seat, hand: hi, total: v.total });
  } else if (v.total === 21 && h.status === 'playing') {
    h.status = 'stood';
  }
}

/** 다음 행동할 핸드를 찾는다. 없으면 딜러 진행 후 정산 */
function nextTurn(s: BjState, rng: Rng): void {
  for (const st of activeSeats(s)) {
    for (let hi = 0; hi < st.hands.length; hi++) {
      const h = st.hands[hi];
      if (h.status !== 'playing') continue;
      if (h.cards.length === 1) {
        // 스플릿 둘째 핸드: 차례가 오면 두 번째 카드를 받는다
        const c = draw(s, rng);
        h.cards.push(c);
        pushEvent(s, { t: 'hit', seat: st.seat, hand: hi, card: c });
        afterCard(s, st.seat, hi);
        if (h.status !== 'playing') continue;
      }
      s.phase = 'play';
      s.turn = { seat: st.seat, hand: hi };
      return;
    }
  }
  s.turn = null;
  dealerPlay(s, rng);
}

function revealHole(s: BjState): void {
  if (s.holeRevealed) return;
  s.holeRevealed = true;
  const v = handValue(s.dealer);
  pushEvent(s, { t: 'dealer_reveal', card: s.dealer[1], total: v.total, soft: v.soft });
}

function dealerPlay(s: BjState, rng: Rng): void {
  s.phase = 'dealer';
  revealHole(s);
  const live = activeSeats(s).some((st) => st.hands.some((h) => h.status === 'stood' || h.status === 'doubled'));
  if (live) {
    while (handValue(s.dealer).total < 17) {
      const c = draw(s, rng);
      s.dealer.push(c);
      pushEvent(s, { t: 'dealer_hit', card: c, total: handValue(s.dealer).total });
    }
    const t = handValue(s.dealer).total;
    if (t > 21) pushEvent(s, { t: 'dealer_bust', total: t });
    else pushEvent(s, { t: 'dealer_stand', total: t });
  }
  finish(s);
}

function resolveHand(s: BjState, h: BjHand): void {
  const d = handValue(s.dealer).total;
  let r: BjResult;
  if (h.status === 'bust') r = 'bust';
  else if (h.status === 'blackjack') r = s.dealerBlackjack ? 'push' : 'blackjack';
  else if (s.dealerBlackjack) r = 'lose';
  else {
    const p = handValue(h.cards).total;
    if (d > 21 || p > d) r = 'win';
    else if (p === d) r = 'push';
    else r = 'lose';
  }
  h.result = r;
  h.delta = r === 'blackjack' ? Math.floor(h.bet * 1.5) : r === 'win' ? h.bet : r === 'push' ? 0 : -h.bet;
}

function finish(s: BjState): void {
  s.turn = null;
  for (const st of activeSeats(s)) {
    for (const h of st.hands) resolveHand(s, h);
    const delta = st.hands.reduce((a, h) => a + (h.delta ?? 0), 0);
    pushEvent(s, { t: 'result', seat: st.seat, delta, results: st.hands.map((h) => h.result) });
  }
  s.phase = 'done';
}

/** 모두 베팅했으면 카드를 나눈다 */
function dealIfReady(s: BjState, rng: Rng): void {
  const act = activeSeats(s);
  if (act.some((st) => st.bet === null)) return;
  if (act.length === 0) {
    // 아무도 참가하지 않음 → 카드 없이 끝
    s.phase = 'done';
    s.turn = null;
    return;
  }
  for (const st of act) {
    st.hands = [
      { cards: [], bet: st.bet as number, status: 'playing', fromSplit: false, splitAces: false, doubled: false, result: null, delta: null },
    ];
  }
  for (const st of act) st.hands[0].cards.push(draw(s, rng));
  s.dealer.push(draw(s, rng));
  for (const st of act) st.hands[0].cards.push(draw(s, rng));
  s.dealer.push(draw(s, rng));
  // 홀카드는 이벤트에 넣지 않는다
  pushEvent(s, { t: 'deal', up: s.dealer[0] });

  for (const st of act) {
    if (isBlackjack(st.hands[0].cards)) {
      st.hands[0].status = 'blackjack';
      pushEvent(s, { t: 'blackjack', seat: st.seat });
    }
  }
  // 딜러 피크: 업카드가 A 또는 10점이면 홀카드 확인
  const up = cardPoint(s.dealer[0]);
  if ((up === 1 || up === 10) && isBlackjack(s.dealer)) {
    s.dealerBlackjack = true;
    s.holeRevealed = true;
    pushEvent(s, { t: 'dealer_blackjack', card: s.dealer[1] });
    finish(s);
    return;
  }
  s.phase = 'play';
  nextTurn(s, rng);
}

// ───────────────────────── AI (보통) ─────────────────────────

type Move = 'H' | 'S' | 'D' | 'Ds' | 'P';

/** 기본 전략 (멀티덱, S17, 스플릿 후 더블 허용). up = 딜러 업카드 점수 (A=11) */
export function basicStrategy(cards: readonly Card[], up: number, canSplit: boolean): Move {
  const v = handValue(cards);
  if (canSplit && cards.length === 2) {
    const p = cardPoint(cards[0]);
    const pair: Move | null =
      p === 1 || p === 8
        ? 'P'
        : p === 9
          ? up === 7 || up === 10 || up === 11
            ? null
            : 'P'
          : p === 7 || p === 2 || p === 3
            ? up <= 7
              ? 'P'
              : null
            : p === 6
              ? up <= 6
                ? 'P'
                : null
              : p === 4
                ? up === 5 || up === 6
                  ? 'P'
                  : null
                : null;
    if (pair) return pair;
  }
  const t = v.total;
  if (v.soft) {
    if (t >= 19) return 'S';
    if (t === 18) return up >= 3 && up <= 6 ? 'Ds' : up <= 8 ? 'S' : 'H';
    if (t === 17) return up >= 3 && up <= 6 ? 'D' : 'H';
    if (t >= 15) return up >= 4 && up <= 6 ? 'D' : 'H';
    // 소프트 12 (A,A 인데 스플릿 못 할 때): 늘 히트
    if (t <= 12) return 'H';
    return up >= 5 && up <= 6 ? 'D' : 'H';
  }
  if (t >= 17) return 'S';
  if (t >= 13) return up <= 6 ? 'S' : 'H';
  if (t === 12) return up >= 4 && up <= 6 ? 'S' : 'H';
  if (t === 11) return up === 11 ? 'H' : 'D';
  if (t === 10) return up <= 9 ? 'D' : 'H';
  if (t === 9) return up >= 3 && up <= 6 ? 'D' : 'H';
  return 'H';
}

function aiPlay(pub: BjPublic, seat: number, rng: Rng): BjAction {
  const legal = pub.legal;
  const me = pub.seats.find((x) => x.seat === seat);
  const turn = pub.turn;
  if (!me || !turn || turn.seat !== seat || legal.length === 0) return { type: 'stand' };
  const hand = me.hands[turn.hand];
  const upCard = pub.dealer.cards[0];
  const upPt = upCard ? cardPoint(upCard) : 10;
  const up = upPt === 1 ? 11 : upPt;
  const m = basicStrategy(hand.cards, up, legal.includes('split'));
  let pick: BjPlayAction;
  if (m === 'P') pick = 'split';
  else if (m === 'D') pick = legal.includes('double') ? 'double' : 'hit';
  else if (m === 'Ds') pick = legal.includes('double') ? 'double' : 'stand';
  else pick = m === 'H' ? 'hit' : 'stand';
  if (!legal.includes(pick)) pick = 'hit';
  // 약 10%는 다른 합법 행동을 고른다
  if (rng.next() < 0.1) {
    const others = legal.filter((a) => a !== pick);
    if (others.length > 0) pick = others[rng.int(others.length)];
  }
  return { type: pick };
}

// ───────────────────────── 엔진 ─────────────────────────

export const blackjack: Engine<BjState, BjAction, BjCarry, BjPublic, BjPrivate> = {
  game: 'blackjack',

  newRound(input) {
    const { baseUnit, carry, rng } = input;
    if (!(baseUnit > 0)) throw new EngineError('기본 단위가 올바르지 않습니다');
    let shoe: Card[];
    let cut: number;
    let reshuffled = false;
    if (!carry || carry.shoe.length < carry.cut) {
      shoe = shuffle(freshShoe(), rng);
      cut = CUT;
      reshuffled = true;
    } else {
      shoe = carry.shoe.slice();
      cut = carry.cut;
    }
    const seats: BjSeatState[] = [...input.seats]
      .sort((a, b) => a.seat - b.seat)
      .map((si) => {
        const broke = si.stack !== null && si.stack < baseUnit;
        return {
          seat: si.seat,
          kind: si.kind,
          name: si.name,
          stack: si.stack,
          out: broke,
          outReason: broke ? 'stack' : null,
          bet: null,
          hands: [],
          split: false,
        };
      });
    const s: BjState = {
      phase: 'bet',
      baseUnit,
      seats,
      dealer: [],
      holeRevealed: false,
      dealerBlackjack: false,
      shoe,
      cut,
      shoeStart: shoe.length,
      refills: 0,
      turn: null,
      events: [],
      eventSeq: 0,
    };
    if (reshuffled) pushEvent(s, { t: 'reshuffle', remaining: shoe.length });
    for (const st of seats) if (st.out) pushEvent(s, { t: 'sitout', seat: st.seat, reason: 'stack' });
    dealIfReady(s, rng);
    return s;
  },

  pending(s) {
    if (s.phase === 'bet') return activeSeats(s).filter((x) => x.bet === null).map((x) => x.seat);
    if (s.phase === 'play' && s.turn) return [s.turn.seat];
    return [];
  },

  apply(s0, seat, action, rng) {
    if (s0.phase === 'done') throw new EngineError('이미 끝난 판입니다');
    if (!blackjack.pending(s0).includes(seat)) throw new EngineError('지금은 행동할 차례가 아닙니다');
    const s = clone(s0);
    const st = seatOf(s, seat);

    if (s.phase === 'bet') {
      if (action.type === 'sitout') {
        st.out = true;
        st.outReason = 'choice';
        pushEvent(s, { t: 'sitout', seat, reason: 'choice' });
      } else if (action.type === 'bet') {
        const amt = action.amount;
        if (!Number.isInteger(amt)) throw new EngineError('베팅 금액은 정수여야 합니다');
        if (amt < s.baseUnit) throw new EngineError(`최소 베팅은 ${s.baseUnit}입니다`);
        // 기본 단위의 배수만 (블랙잭 3:2 지급이 항상 정수가 되도록: 기본 단위는 100 이상의 짝수)
        if (amt % s.baseUnit !== 0) throw new EngineError(`베팅은 ${s.baseUnit} 단위로만 할 수 있습니다`);
        if (amt > s.baseUnit * MAX_BET_MULT) throw new EngineError(`최대 베팅은 ${s.baseUnit * MAX_BET_MULT}입니다`);
        if (st.stack !== null && amt > st.stack) throw new EngineError('가진 돈보다 많이 걸 수 없습니다');
        st.bet = amt;
        pushEvent(s, { t: 'bet', seat, amount: amt });
      } else {
        throw new EngineError('지금은 베팅할 차례입니다');
      }
      dealIfReady(s, rng);
      return s;
    }

    // play 단계
    if (action.type === 'bet' || action.type === 'sitout') throw new EngineError('베팅 단계가 아닙니다');
    const turn = s.turn as { seat: number; hand: number };
    const legal = legalActions(s);
    if (!legal.includes(action.type)) {
      const msg: Record<BjPlayAction, string> = {
        hit: '지금은 카드를 받을 수 없습니다',
        stand: '지금은 스탠드할 수 없습니다',
        double: '더블다운할 수 없습니다 (첫 두 장일 때만, 금액이 충분해야 함)',
        split: '스플릿할 수 없습니다 (같은 점수의 첫 두 장, 한 번만, 금액이 충분해야 함)',
      };
      throw new EngineError(msg[action.type] ?? '알 수 없는 행동이에요');
    }
    const hi = turn.hand;
    const h = st.hands[hi];
    const seen = action as { hand?: unknown; cards?: unknown };
    if ((typeof seen.hand === 'number' && seen.hand !== hi) || (typeof seen.cards === 'number' && seen.cards !== h.cards.length)) {
      throw new EngineError('이미 지난 차례예요');
    }
    switch (action.type) {
      case 'hit': {
        const c = draw(s, rng);
        h.cards.push(c);
        pushEvent(s, { t: 'hit', seat, hand: hi, card: c });
        afterCard(s, seat, hi);
        break;
      }
      case 'stand':
        h.status = 'stood';
        pushEvent(s, { t: 'stand', seat, hand: hi });
        break;
      case 'double': {
        h.bet *= 2;
        h.doubled = true;
        const c = draw(s, rng);
        h.cards.push(c);
        pushEvent(s, { t: 'double', seat, hand: hi, card: c, bet: h.bet });
        h.status = 'doubled';
        afterCard(s, seat, hi);
        break;
      }
      case 'split': {
        st.split = true;
        const aces = cardPoint(h.cards[0]) === 1;
        const second = h.cards.pop() as Card;
        h.fromSplit = true;
        h.splitAces = aces;
        const h2: BjHand = {
          cards: [second],
          bet: h.bet,
          status: 'playing',
          fromSplit: true,
          splitAces: aces,
          doubled: false,
          result: null,
          delta: null,
        };
        st.hands.push(h2);
        pushEvent(s, { t: 'split', seat, bet: h.bet });
        h.cards.push(draw(s, rng));
        pushEvent(s, { t: 'hit', seat, hand: 0, card: h.cards[1] });
        if (aces) {
          h2.cards.push(draw(s, rng));
          pushEvent(s, { t: 'hit', seat, hand: 1, card: h2.cards[1] });
          h.status = 'stood';
          h2.status = 'stood';
        } else {
          afterCard(s, seat, 0);
        }
        break;
      }
    }
    if (h.status !== 'playing') nextTurn(s, rng);
    return s;
  },

  ai(pub, _priv, seat, rng) {
    if (pub.phase === 'bet') {
      const me = pub.seats.find((x) => x.seat === seat);
      const max = me ? me.maxBet : pub.maxBet;
      const amt = Math.min((1 + rng.int(5)) * pub.baseUnit, max);
      if (amt < pub.minBet) return { type: 'sitout' };
      return { type: 'bet', amount: amt };
    }
    return aiPlay(pub, seat, rng);
  },

  // 판 도중 나간 사람 자리: 베팅 전이면 이번 판은 쉬고, 이미 걸었으면 스탠드 (AI 가 그 사람 칩으로 무작위 베팅·더블하지 않게)
  leftAction(s) {
    return s.phase === 'bet' ? { type: 'sitout' } : { type: 'stand' };
  },

  // 시간 초과: 베팅 단계면 이번 판은 쉰다 (자동 시작을 켜 두고 자리를 비우면 판마다 기본 단위가 자동으로 걸려 칩이 새던 것을 막는다),
  // 이미 걸었으면 스탠드. 쉰 자리는 settle 의 deltas 에서 빠진다 (나간 자리 leftAction 과 같다)
  timeout(s) {
    return s.phase === 'bet' ? { type: 'sitout' } : { type: 'stand' };
  },

  done(s) {
    return s.phase === 'done';
  },

  settle(s): Settlement<BjCarry> {
    if (s.phase !== 'done') throw new EngineError('아직 끝나지 않은 판입니다');
    const deltas: Record<number, number> = {};
    // 쉰 자리(out)는 넣지 않는다: 정산 SQL 은 deltas 에 자리가 있으면 시아코인을 준다 (쉬기만 해도 코인을 받지 않게)
    for (const st of s.seats) if (!st.out) deltas[st.seat] = st.hands.reduce((a, h) => a + (h.delta ?? 0), 0);
    return { deltas, summary: summaryOf(s), carry: { shoe: s.shoe.slice(), cut: s.cut } };
  },

  view(s): View<BjPublic, BjPrivate> {
    const visible: (Card | null)[] = s.holeRevealed ? s.dealer.slice() : s.dealer.length ? [s.dealer[0], null] : [];
    const visCards = visible.filter((c): c is Card => c !== null);
    const dv = visCards.length ? handValue(visCards) : null;
    const done = s.phase === 'done';
    const pub: BjPublic = {
      phase: s.phase,
      baseUnit: s.baseUnit,
      minBet: s.baseUnit,
      maxBet: s.baseUnit * MAX_BET_MULT,
      dealer: {
        cards: visible,
        total: dv ? dv.total : null,
        soft: dv ? dv.soft : false,
        revealed: s.holeRevealed,
        blackjack: s.holeRevealed && s.dealerBlackjack,
      },
      seats: s.seats.map((st) => ({
        seat: st.seat,
        kind: st.kind,
        name: st.name,
        out: st.out,
        outReason: st.outReason,
        bet: st.bet,
        maxBet: seatMaxBet(s, st),
        hands: st.hands.map((h) => {
          const v = handValue(h.cards);
          return {
            cards: h.cards.slice(),
            bet: h.bet,
            total: v.total,
            soft: v.soft,
            status: h.status,
            fromSplit: h.fromSplit,
            doubled: h.doubled,
            result: h.result,
            delta: h.delta,
          };
        }),
        delta: done ? st.hands.reduce((a, h) => a + (h.delta ?? 0), 0) : null,
      })),
      turn: s.turn ? { ...s.turn } : null,
      legal: legalActions(s),
      waitingBets: s.phase === 'bet' ? blackjack.pending(s) : [],
      shoeRemaining: s.shoe.length,
      events: clone(s.events),
      summary: done ? summaryOf(s) : null,
    };
    const priv: Record<number, BjPrivate> = {};
    for (const st of s.seats) priv[st.seat] = {};
    return { public: pub, private: priv };
  },
};

function summaryOf(s: BjState): BjSummary {
  const dv = handValue(s.dealer);
  return {
    dealer: { cards: s.dealer.slice(), total: dv.total, blackjack: s.dealerBlackjack, bust: dv.total > 21 },
    seats: s.seats.map((st) => ({
      seat: st.seat,
      name: st.name,
      out: st.out,
      hands: st.hands.map((h) => ({ bet: h.bet, result: h.result as BjResult, delta: h.delta ?? 0 })),
      delta: st.hands.reduce((a, h) => a + (h.delta ?? 0), 0),
    })),
  };
}
