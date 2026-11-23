/**
 * 세븐포커 규칙 엔진 (한국식 세븐 스터드 + 한국식 베팅).
 *
 * ## 카드 표기
 * 2글자 문자열: 숫자 + 무늬. 숫자 '23456789TJQKA' (T = 10), 무늬 'S'(♠) 'D'(◆) 'H'(♥) 'C'(♣).
 * 예: 'AS' = ♠A, 'TD' = ◆10, '2C' = ♣2. 무늬 서열: ♠ > ◆ > ♥ > ♣.
 *
 * ## 진행
 * 1. 참가자 모두 앤티(baseUnit). 사람 자리의 stack(이번 판에 낼 수 있는 최대 금액)이 앤티보다 적으면
 *    이번 판에서 제외한다(excluded, 정산 0). stack이 앤티와 같으면 앤티만 내고 올인 상태로 시작한다.
 *    제외 후 참가자가 2명 미만이면 판을 바로 끝낸다(cancelled, 모두 정산 0).
 * 2. 4장씩 받고(비공개) 동시에 1장 버리고 남은 3장 중 1장을 공개 → 2장 비공개 + 1장 공개.
 * 3. 4구·5구·6구: 공개 카드 1장씩 받고 베팅. 4. 7구(히든): 비공개 1장 받고 마지막 베팅.
 * 5. 쇼다운: 7장 중 좋은 5장. 한 명 빼고 모두 다이하면 그 사람이 카드를 보이지 않고 이긴다.
 * 베팅 순서: 다이·올인하지 않은 사람 중 공개 카드 족보가 가장 높은 사람이 먼저, 그다음 자리 번호 순(시계 방향).
 *
 * ## 베팅 (한 베팅 라운드 안에서. curBet = 이번 라운드 최고 베팅액, myBet = 내가 이번 라운드에 낸 돈)
 * - 체크: 낼 돈이 없을 때(이번 라운드 베팅 없음).
 * - 삥: 라운드 첫 베팅 = baseUnit. 베팅이 없을 때만.
 * - 콜: curBet − myBet 를 낸다.
 * - 따당: 베팅 수준을 2배로. 낼 돈 = 2×curBet − myBet (콜 금액 + curBet 만큼 레이즈). 베팅이 있을 때만.
 * - 하프: 콜 금액을 먼저 판돈에 넣었다고 보고, 그 판돈의 절반만큼 레이즈.
 *         낼 돈 = toCall + floor((pot + toCall) / 2)  (pot = 앤티 포함 지금까지 모인 전체 금액).
 *         베팅이 없을 때(toCall = 0)도 첫 베팅으로 쓸 수 있다(레이즈 1회로 센다).
 * - 다이: 포기.
 * - 레이즈(따당·하프)는 라운드당 최대 3번. 그 뒤로는 콜·다이만(낼 돈이 없으면 체크).
 *   베팅에 응할 수 있는 다른 사람(다이·올인 아닌 사람)이 없으면 삥·따당·하프는 못 한다.
 * - 가진 돈이 모자라면 가진 만큼만 내고 올인. 레이즈 금액이 가진 돈 이상이면 올인 레이즈가 된다.
 *   가진 돈이 콜 금액 이하이면 레이즈는 없고 콜(올인)만 할 수 있다.
 * - AI(stack = null)는 돈이 무한이다.
 * - 라운드 종료: 다이·올인하지 않은 모든 사람이 행동했고 낸 돈이 curBet과 같을 때.
 *
 * ## 족보 비교
 * 로열 스트레이트 플러시 > 스트레이트 플러시(백스트레이트 플러시 > 그 밖의 스트레이트 플러시) > 포카드 > 풀하우스
 * > 플러시 > 스트레이트(마운틴 > 백스트레이트 > 그 밖의 스트레이트) > 트리플 > 투페어 > 원페어 > 하이카드.
 * 같은 족보면 숫자(일반 키커 순서)로 비교하고, 숫자까지 같으면 '결정 카드'의 무늬로 가린다.
 * 결정 카드: 족보를 이루는 카드 중 가장 높은 카드(같은 숫자가 여러 장이면 무늬가 가장 좋은 것).
 *   - 포카드·트리플·풀하우스: 넷/셋 묶음 중 무늬가 가장 좋은 카드
 *   - 투페어: 높은 페어 중 무늬가 좋은 카드, 원페어: 페어 중 무늬가 좋은 카드
 *   - 스트레이트·스트레이트 플러시: 가장 높은 카드(백스트레이트는 A), 플러시·하이카드: 가장 높은 카드
 *   - 로열: 무늬 자체
 * 공개 카드(1~4장) 족보는 포카드/트리플/투페어/원페어/하이카드만 보고 같은 방식으로 비교한다.
 *
 * ## 사이드 팟
 * 올인한 사람들의 누적 기여액을 단계로 나눠 팟을 만든다. 다이한 사람의 돈은 팟에 남지만 받을 자격은 없다.
 * 마지막 팟은 올인하지 않은 생존자들이 대상(아무도 못 받으면 바로 앞 팟에 합친다).
 * 동점(무늬까지 같은 경우는 한 덱에서 불가능하지만 방어적으로 처리)이면 나누고, 나머지는 자리 번호가 가장 빠른 승자에게.
 * 정산: deltas[seat] = 받은 돈 − 낸 돈(앤티 포함). 합은 항상 0.
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
import { cardKey, compareHands, evaluate7, fullDeck, groups, HandCat, RANK_NAME, rankOf, suitOf, type HandValue } from './hand-eval.ts';
import { computeSidePots } from './pots.ts';

// ───────────────────────── 타입 ─────────────────────────

export type PokerPhase = 'choose' | 'bet4' | 'bet5' | 'bet6' | 'bet7' | 'showdown' | 'done';
export type BetType = 'check' | 'bbing' | 'call' | 'ddadang' | 'half' | 'die';

export type PokerAction =
  | { type: 'choose'; discard: string; open: string }
  | { type: 'check' }
  | { type: 'bbing' }
  | { type: 'call' }
  | { type: 'ddadang' }
  | { type: 'half' }
  | { type: 'die' };

/** 다음 판으로 넘길 것이 없다 */
export type PokerCarry = Record<string, never>;

export interface PokerPlayer {
  seat: number;
  kind: SeatKind;
  name: string;
  stack: number | null;
  /** 앤티를 낼 돈이 없어 이번 판에서 빠짐 */
  excluded: boolean;
  /** 선택 단계의 4장 (선택 뒤에는 []) */
  choices: string[];
  chosen: boolean;
  down: string[];
  up: string[];
  folded: boolean;
  allIn: boolean;
  /** 이번 베팅 라운드에 낸 돈 */
  betRound: number;
  /** 이번 판에 낸 돈 전체 (앤티 포함) */
  total: number;
  acted: boolean;
  last: string | null;
}

export interface PokerPot {
  amount: number;
  eligible: number[];
}

export interface PokerPotResult extends PokerPot {
  winners: number[];
}

export interface PokerSummary {
  cancelled: boolean;
  uncontested: boolean;
  winners: number[];
  pots: PokerPotResult[];
  /** 쇼다운한 자리의 족보 (uncontested면 빈 객체) */
  hands: Record<number, { name: string; best: string[] }>;
  deltas: Record<number, number>;
  excluded: number[];
}

export interface PokerState {
  phase: PokerPhase;
  /** 3 = 선택 단계, 4~7 = n구 */
  round: number;
  baseUnit: number;
  deck: string[];
  discards: string[];
  players: PokerPlayer[];
  turn: number | null;
  curBet: number;
  raises: number;
  events: GameEvent[];
  nextEventId: number;
  result: PokerSummary | null;
}

export interface PokerActionOption {
  type: BetType;
  /** 이 행동으로 내는 돈 */
  amount: number;
  /** 이 행동으로 올인이 되는가 */
  allIn: boolean;
}

export interface PokerSeatPublic {
  seat: number;
  name: string;
  kind: SeatKind;
  excluded: boolean;
  /** 선택을 마쳤는가 (선택 단계용) */
  chosen: boolean;
  open: string[];
  hiddenCount: number;
  betRound: number;
  total: number;
  folded: boolean;
  allIn: boolean;
  /** 사람: 남은 돈, AI: null(무한) */
  stackLeft: number | null;
  last: string | null;
  /** 공개 카드 족보 이름 (예: 'K 원페어') */
  openLabel: string | null;
}

export interface PokerShowdownHand {
  seat: number;
  cards: string[];
  hand: string;
  best: string[];
}

export interface PokerPublic {
  phase: PokerPhase;
  round: number;
  baseUnit: number;
  pot: number;
  pots: PokerPot[];
  curBet: number;
  raises: number;
  maxRaises: number;
  turn: number | null;
  /** turn 자리가 할 수 있는 행동과 금액 */
  actions: PokerActionOption[];
  seats: PokerSeatPublic[];
  /** 쇼다운 때 다이하지 않은 사람의 7장 (그 전/무혈 승리면 null) */
  showdown: PokerShowdownHand[] | null;
  winners: number[];
  events: GameEvent[];
  summary: PokerSummary | null;
}

export interface PokerPrivate {
  seat: number;
  /** 선택 단계에서 고를 4장 (선택 전에만) */
  choices: string[];
  /** 내 비공개 카드 */
  hidden: string[];
  /** 내 공개 카드 (선택 단계에서는 내가 고른 공개 예정 카드) */
  open: string[];
  /** 내 패 전체 족보 이름 */
  hand: string | null;
}

export const MAX_RAISES = 3;
const EVENT_KEEP = 30;

// ───────────────────────── 카드·족보 (hand-eval.ts, 세븐포커 규칙 = KOREAN) ─────────────────────────

export { rankOf, suitOf, cardKey, fullDeck, HandCat, compareHands, evaluate5, evaluate7 } from './hand-eval.ts';
export type { HandValue } from './hand-eval.ts';

/** 공개 카드(1~4장) 족보: 포카드/트리플/투페어/원페어/하이카드만 */
export function evaluateOpen(cards: string[]): HandValue | null {
  if (cards.length === 0) return null;
  const gs = groups(cards);
  const lead = gs[0];
  const ranks = gs.map((g) => g.rank);
  const suit = suitOf(lead.cards[0]);
  const R = RANK_NAME[lead.rank];
  const sorted = cards.slice().sort((a, b) => cardKey(b) - cardKey(a));
  if (lead.cards.length === 4) return { cat: HandCat.QUADS, ranks, suit, name: `${R} 포카드`, cards: sorted };
  if (lead.cards.length === 3) return { cat: HandCat.TRIPS, ranks, suit, name: `${R} 트리플`, cards: sorted };
  if (lead.cards.length === 2 && gs[1]?.cards.length === 2) return { cat: HandCat.TWO_PAIR, ranks, suit, name: `${R} 투페어`, cards: sorted };
  if (lead.cards.length === 2) return { cat: HandCat.PAIR, ranks, suit, name: `${R} 원페어`, cards: sorted };
  return { cat: HandCat.HIGH, ranks, suit, name: `${R} 탑`, cards: sorted };
}

/** 몇 장이든 지금 알 수 있는 가장 좋은 족보 (5장 이상이면 전체 족보, 미만이면 공개 족보 방식) */
function evaluateAny(cards: string[]): HandValue | null {
  return cards.length >= 5 ? evaluate7(cards) : evaluateOpen(cards);
}

// ───────────────────────── 내부 도우미 ─────────────────────────

const LABEL: Record<BetType, string> = { check: '체크', bbing: '삥', call: '콜', ddadang: '따당', half: '하프', die: '다이' };

const inHand = (p: PokerPlayer) => !p.excluded && !p.folded;
const live = (s: PokerState) => s.players.filter(inHand);
const participants = (s: PokerState) => s.players.filter((p) => !p.excluded);
const remaining = (p: PokerPlayer) => (p.stack === null ? Infinity : p.stack - p.total);
const potTotal = (s: PokerState) => s.players.reduce((a, p) => a + p.total, 0);

function findPlayer(s: PokerState, seat: number): PokerPlayer {
  const p = s.players.find((x) => x.seat === seat);
  if (!p) throw new EngineError('없는 자리입니다');
  return p;
}

function emit(s: PokerState, t: string, extra: Record<string, unknown> = {}): void {
  s.events.push({ id: s.nextEventId++, t, ...extra });
  if (s.events.length > EVENT_KEEP) s.events.splice(0, s.events.length - EVENT_KEEP);
}

function draw(s: PokerState): string {
  const c = s.deck.pop();
  if (!c) throw new EngineError('덱이 비었습니다');
  return c;
}

/** 돈 내기 (가진 돈까지만). 실제로 낸 금액 */
function put(p: PokerPlayer, amount: number): number {
  const amt = Math.max(0, Math.min(amount, remaining(p)));
  p.betRound += amt;
  p.total += amt;
  if (remaining(p) <= 0) p.allIn = true;
  return amt;
}

/** 사이드 팟 (설명은 파일 머리말, 계산은 pots.ts) */
export function computePots(s: PokerState): PokerPot[] {
  return computeSidePots(participants(s));
}

/** 지금 turn 자리가 할 수 있는 행동 */
function options(s: PokerState, p: PokerPlayer): PokerActionOption[] {
  if (!s.phase.startsWith('bet') || s.turn !== p.seat || !inHand(p) || p.allIn) return [];
  const rem = remaining(p);
  const toCall = s.curBet - p.betRound;
  const others = s.players.some((o) => o !== p && inHand(o) && !o.allIn);
  const mk = (type: BetType, amt: number): PokerActionOption =>
    amt >= rem ? { type, amount: rem, allIn: true } : { type, amount: amt, allIn: false };
  const res: PokerActionOption[] = [];
  if (toCall <= 0) res.push({ type: 'check', amount: 0, allIn: false });
  if (s.curBet === 0 && others) res.push(mk('bbing', s.baseUnit));
  if (toCall > 0) res.push(mk('call', toCall));
  const canRaise = others && s.raises < MAX_RAISES && rem > toCall;
  if (canRaise && s.curBet > 0) res.push(mk('ddadang', 2 * s.curBet - p.betRound));
  if (canRaise) res.push(mk('half', toCall + Math.floor((potTotal(s) + toCall) / 2)));
  res.push({ type: 'die', amount: 0, allIn: false });
  return res;
}

/** 공개 카드 족보가 가장 좋은 사람 */
function bestOpenSeat(players: PokerPlayer[]): number {
  let best: PokerPlayer | null = null;
  let bv: HandValue | null = null;
  for (const p of players) {
    const v = evaluateOpen(p.up);
    if (!best || (v && (!bv || compareHands(v, bv) > 0))) {
      best = p;
      bv = v;
    }
  }
  return best!.seat;
}

/** 자리 번호 순으로 from 다음 자리 (원형) */
function nextSeatAfter(from: number, cands: PokerPlayer[]): number {
  const seats = cands.map((p) => p.seat).sort((a, b) => a - b);
  return seats.find((x) => x > from) ?? seats[0];
}

/** 베팅 라운드 시작 (가능하면). 베팅할 사람이 2명 미만이면 false */
function startBetting(s: PokerState): boolean {
  for (const p of s.players) {
    p.betRound = 0;
    p.acted = false;
  }
  s.curBet = 0;
  s.raises = 0;
  const actors = live(s).filter((p) => !p.allIn);
  if (actors.length < 2) {
    s.turn = null;
    return false;
  }
  s.turn = bestOpenSeat(actors);
  return true;
}

/** 다음 카드 돌리기 → 베팅 시작. 베팅이 필요 없으면 계속 돌리고 7구 뒤 쇼다운 */
function advance(s: PokerState): void {
  for (;;) {
    if (live(s).length <= 1) return finishUncontested(s);
    if (s.round >= 7) return showdown(s);
    s.round += 1;
    s.phase = `bet${s.round}` as PokerPhase;
    for (const p of live(s)) {
      const c = draw(s);
      if (s.round === 7) {
        p.down.push(c);
        emit(s, 'deal', { seat: p.seat, round: s.round, hidden: true });
      } else {
        p.up.push(c);
        emit(s, 'deal', { seat: p.seat, round: s.round, card: c });
      }
    }
    if (startBetting(s)) return;
  }
}

/** 행동 뒤 진행 */
function progress(s: PokerState): void {
  if (live(s).length <= 1) return finishUncontested(s);
  const need = live(s).filter((p) => !p.allIn && (!p.acted || p.betRound < s.curBet));
  if (need.length === 0) {
    s.turn = null;
    return advance(s);
  }
  s.turn = nextSeatAfter(s.turn ?? -1, need);
}

function finish(s: PokerState, pots: PokerPotResult[], uncontested: boolean, hands: PokerSummary['hands']): void {
  const won: Record<number, number> = {};
  for (const pot of pots) {
    if (pot.winners.length === 0) continue;
    const share = Math.floor(pot.amount / pot.winners.length);
    let rem = pot.amount - share * pot.winners.length;
    for (const w of pot.winners.slice().sort((a, b) => a - b)) {
      won[w] = (won[w] ?? 0) + share + rem;
      rem = 0;
    }
  }
  const deltas: Record<number, number> = {};
  // 이번 판에서 빠진 자리(excluded)는 넣지 않는다: 정산 SQL 은 deltas 에 자리가 있으면 시아코인을 준다
  for (const p of s.players) if (!p.excluded) deltas[p.seat] = (won[p.seat] ?? 0) - p.total;
  const winners = [...new Set(pots.flatMap((p) => p.winners))].sort((a, b) => a - b);
  for (const w of winners) emit(s, 'win', { seat: w, amount: won[w] ?? 0 });
  s.phase = 'done';
  s.turn = null;
  s.result = {
    cancelled: false,
    uncontested,
    winners,
    pots,
    hands,
    deltas,
    excluded: s.players.filter((p) => p.excluded).map((p) => p.seat),
  };
}

function finishUncontested(s: PokerState): void {
  const w = live(s)[0];
  const amount = potTotal(s);
  finish(s, [{ amount, eligible: [w.seat], winners: [w.seat] }], true, {});
}

function showdown(s: PokerState): void {
  s.phase = 'showdown';
  const alive = live(s);
  const vals: Record<number, HandValue> = {};
  const hands: PokerSummary['hands'] = {};
  for (const p of alive) {
    const v = evaluate7([...p.down, ...p.up]);
    vals[p.seat] = v;
    hands[p.seat] = { name: v.name, best: v.cards };
  }
  emit(s, 'showdown', { seats: alive.map((p) => p.seat) });
  for (const p of alive) {
    const v = vals[p.seat];
    if (v.cat === HandCat.ROYAL) emit(s, 'royal', { seat: p.seat });
    else if (v.cat === HandCat.STRAIGHT_FLUSH) emit(s, 'straight_flush', { seat: p.seat });
    else if (v.cat === HandCat.QUADS) emit(s, 'four_kind', { seat: p.seat });
  }
  const pots: PokerPotResult[] = computePots(s).map((pot) => {
    let best: HandValue | null = null;
    let winners: number[] = [];
    for (const seat of pot.eligible) {
      const v = vals[seat];
      const c = best ? compareHands(v, best) : 1;
      if (c > 0) {
        best = v;
        winners = [seat];
      } else if (c === 0) winners.push(seat);
    }
    return { ...pot, winners };
  });
  finish(s, pots, false, hands);
}

function revealChoices(s: PokerState): void {
  emit(s, 'reveal', { cards: Object.fromEntries(participants(s).map((p) => [p.seat, p.up[0]])) });
  advance(s);
}

// ───────────────────────── AI ─────────────────────────

/** 남은 3장의 잠재력 (선택 단계) */
function keepScore(cards: string[]): number {
  const gs = groups(cards);
  let sc = cards.reduce((a, c) => a + rankOf(c), 0) / 10;
  if (gs[0].cards.length === 3) sc += 80;
  else if (gs[0].cards.length === 2) sc += 30 + gs[0].rank;
  const suits = new Map<string, number>();
  for (const c of cards) suits.set(c[1], (suits.get(c[1]) ?? 0) + 1);
  const maxSuit = Math.max(...suits.values());
  if (maxSuit === 3) sc += 15;
  else if (maxSuit === 2) sc += 4;
  const rs = [...new Set(cards.map(rankOf))].sort((a, b) => a - b);
  if (rs.length === 3 && rs[2] - rs[0] <= 4) sc += 10;
  return sc;
}

function aiChoose(choices: string[]): PokerAction {
  let bestScore = -Infinity;
  let discard = choices[0];
  for (const d of choices) {
    const sc = keepScore(choices.filter((c) => c !== d));
    if (sc > bestScore) {
      bestScore = sc;
      discard = d;
    }
  }
  const keep = choices.filter((c) => c !== discard);
  const gs = groups(keep);
  // 페어가 있으면 페어가 아닌 카드를, 아니면 가장 낮은 카드를 공개 (정보를 덜 준다)
  let open: string;
  if (gs[0].cards.length === 2) open = gs[1].cards[0];
  else open = keep.slice().sort((a, b) => cardKey(a) - cardKey(b))[0];
  return { type: 'choose', discard, open };
}

/** 드로우 가능성 (같은 무늬 4장, 연속 4숫자) */
export function draws(cards: string[]): { flush4: boolean; straight4: boolean } {
  const suits = new Map<string, number>();
  for (const c of cards) suits.set(c[1], (suits.get(c[1]) ?? 0) + 1);
  const flush4 = Math.max(0, ...suits.values()) >= 4;
  const rs = new Set(cards.map(rankOf));
  if (rs.has(14)) rs.add(1);
  let straight4 = false;
  for (let lo = 1; lo <= 10; lo++) {
    let n = 0;
    for (let r = lo; r < lo + 5; r++) if (rs.has(r)) n++;
    if (n >= 4) straight4 = true;
  }
  return { flush4, straight4 };
}

/** AI 실수 확률: 이만큼은 사람에게 유리한 쪽으로 잘못 고른다 (난이도 10% 낮춤. AI 는 돈을 잃어도 된다) */
export const AI_MISTAKE = 0.1;

function aiBet(pub: PokerPublic, priv: PokerPrivate | undefined, seat: number, rng: Rng): PokerAction {
  const a = aiBetPlan(pub, priv, seat, rng);
  // 실수는 진짜 AI 자리에만: 판 도중 나간 사람 자리는 AI 가 대신 두지만 그 사람의 실제 칩이다 (난수는 똑같이 하나 쓴다)
  const roll = rng.next();
  if (roll >= AI_MISTAKE || pub.seats.find((x) => x.seat === seat)?.kind !== 'ai') return a;
  const has = (t: BetType) => pub.actions.some((x) => x.type === t);
  // 레이즈 → 콜·체크만 (값을 덜 뽑는다), 콜 → 다이 (판을 내준다), 다이 → 콜 (사람의 큰 패에 따라간다)
  if (a.type === 'half' || a.type === 'ddadang' || a.type === 'bbing') return has('call') ? { type: 'call' } : has('check') ? { type: 'check' } : a;
  if (a.type === 'call' && has('die')) return { type: 'die' };
  if (a.type === 'die' && has('call')) return { type: 'call' };
  return a;
}

function aiBetPlan(pub: PokerPublic, priv: PokerPrivate | undefined, seat: number, rng: Rng): PokerAction {
  const acts = pub.actions;
  const has = (t: BetType) => acts.some((a) => a.type === t);
  const me = pub.seats.find((x) => x.seat === seat);
  const mine = [...(priv?.hidden ?? []), ...(me?.open ?? [])];
  const v = evaluateAny(mine);
  const cat = v?.cat ?? 0;
  const BASE = [0.12, 0.32, 0.5, 0.65, 0.75, 0.8, 0.9, 0.97, 1, 1];
  let strength = BASE[cat];
  if (cat === HandCat.HIGH && v && v.ranks[0] >= 13) strength += 0.05;
  if (cat === HandCat.PAIR && v) strength += (v.ranks[0] - 2) / 120;
  if (pub.round < 7 && cat < HandCat.STRAIGHT) {
    const d = draws(mine);
    if (d.flush4) strength += 0.2;
    else if (d.straight4) strength += 0.12;
  }
  // 상대 공개 패와 비교
  for (const o of pub.seats) {
    if (o.seat === seat || o.folded || o.excluded) continue;
    const ov = evaluateOpen(o.open);
    if (!ov) continue;
    if (ov.cat > cat) strength -= 0.2;
    if (ov.cat >= HandCat.TRIPS && cat <= HandCat.TRIPS) strength -= 0.1;
  }
  const call = acts.find((a) => a.type === 'call');
  const potNow = Math.max(1, pub.pot);
  const pick = (...ts: BetType[]): PokerAction | null => {
    for (const t of ts) if (has(t)) return { type: t } as PokerAction;
    return null;
  };
  const bluff = rng.next() < 0.1;
  if (strength >= 0.7 || bluff) {
    const raise = rng.next() < 0.6 ? pick('half', 'ddadang', 'bbing') : pick('ddadang', 'half', 'bbing');
    return raise ?? pick('call', 'check', 'die')!;
  }
  if (strength >= 0.35) {
    if (has('check')) return (strength >= 0.5 && rng.next() < 0.4 ? pick('bbing') : null) ?? { type: 'check' };
    if (call && call.amount <= potNow * (strength >= 0.5 ? 2 : 0.8)) return { type: 'call' };
    return pick('die')!;
  }
  if (has('check')) return { type: 'check' };
  // 약한 패: 싼 콜은 가끔 따라간다 (초반)
  if (call && pub.round <= 5 && call.amount <= pub.baseUnit && rng.next() < 0.5) return { type: 'call' };
  return { type: 'die' };
}

// ───────────────────────── 엔진 ─────────────────────────

export const poker: Engine<PokerState, PokerAction, PokerCarry, PokerPublic, PokerPrivate> = {
  game: 'poker',
  // 판 도중 나간 사람: 공짜면 체크, 아니면 다이 (고르기 단계는 정해진 자동 고르기). AI 가 그 사람 돈으로 계속 걸지 않는다
  leftUsesTimeout: true,

  newRound(input: RoundInput<PokerCarry>): PokerState {
    const { baseUnit, rng } = input;
    if (input.seats.length < 2 || input.seats.length > 4) throw new EngineError('세븐포커는 2~4명입니다');
    if (!(baseUnit > 0)) throw new EngineError('기본 단위가 잘못되었습니다');
    const seats = input.seats.slice().sort((a, b) => a.seat - b.seat);
    if (new Set(seats.map((x) => x.seat)).size !== seats.length) throw new EngineError('자리 번호가 겹칩니다');
    const s: PokerState = {
      phase: 'choose',
      round: 3,
      baseUnit,
      deck: shuffle(fullDeck(), rng),
      discards: [],
      players: seats.map((x) => ({
        seat: x.seat,
        kind: x.kind,
        name: x.name,
        stack: x.stack,
        // 사람인데 앤티를 낼 돈이 없으면 이번 판 제외
        excluded: x.stack !== null && x.stack < baseUnit,
        choices: [],
        chosen: false,
        down: [],
        up: [],
        folded: false,
        allIn: false,
        betRound: 0,
        total: 0,
        acted: false,
        last: null,
      })),
      turn: null,
      curBet: 0,
      raises: 0,
      events: [],
      nextEventId: 1,
      result: null,
    };
    const ps = participants(s);
    if (ps.length < 2) {
      s.phase = 'done';
      const deltas: Record<number, number> = {};
      for (const p of s.players) if (!p.excluded) deltas[p.seat] = 0;
      s.result = {
        cancelled: true,
        uncontested: false,
        winners: [],
        pots: [],
        hands: {},
        deltas,
        excluded: s.players.filter((p) => p.excluded).map((p) => p.seat),
      };
      return s;
    }
    for (const p of ps) {
      put(p, baseUnit);
      p.betRound = 0;
      emit(s, 'ante', { seat: p.seat, amount: baseUnit });
      if (p.allIn) emit(s, 'allin', { seat: p.seat, amount: p.total });
    }
    for (let i = 0; i < 4; i++) for (const p of ps) p.choices.push(draw(s));
    for (const p of ps) emit(s, 'deal', { seat: p.seat, round: 3, count: 4, hidden: true });
    return s;
  },

  pending(s: PokerState): number[] {
    if (s.phase === 'choose') return participants(s).filter((p) => !p.chosen).map((p) => p.seat);
    if (s.phase === 'done' || s.turn === null) return [];
    return [s.turn];
  },

  apply(s0: PokerState, seat: number, action: PokerAction, _rng: Rng): PokerState {
    if (s0.phase === 'done') throw new EngineError('이미 끝난 판입니다');
    const s = clone(s0);
    const p = findPlayer(s, seat);
    if (p.excluded) throw new EngineError('이번 판에 참가하지 않은 자리입니다');
    if (!action || typeof action !== 'object') throw new EngineError('잘못된 행동입니다');

    if (s.phase === 'choose') {
      if (action.type !== 'choose') throw new EngineError('카드를 고를 차례입니다');
      if (p.chosen) throw new EngineError('이미 골랐습니다');
      const { discard, open } = action;
      if (!p.choices.includes(discard) || !p.choices.includes(open) || discard === open) {
        throw new EngineError('버릴 카드와 공개할 카드를 다르게, 내 카드 중에서 골라야 합니다');
      }
      p.down = p.choices.filter((c) => c !== discard && c !== open);
      p.up = [open];
      s.discards.push(discard);
      p.choices = [];
      p.chosen = true;
      emit(s, 'choose', { seat });
      if (participants(s).every((x) => x.chosen)) revealChoices(s);
      return s;
    }

    if (action.type === 'choose') throw new EngineError('카드 고르기 단계가 아닙니다');
    if (s.turn !== seat) throw new EngineError('차례가 아닙니다');
    const opt = options(s, p).find((o) => o.type === action.type);
    if (!opt) throw new EngineError(`지금은 ${LABEL[action.type as BetType] ?? action.type}을(를) 할 수 없습니다`);

    if (opt.type === 'die') {
      p.folded = true;
      p.last = LABEL.die;
      emit(s, 'die', { seat });
    } else {
      const amt = opt.type === 'check' ? 0 : put(p, opt.amount);
      if (p.betRound > s.curBet) {
        s.curBet = p.betRound;
        for (const o of s.players) if (o !== p) o.acted = false;
      }
      if (opt.type === 'ddadang' || opt.type === 'half') s.raises += 1;
      p.last = p.allIn ? '올인' : LABEL[opt.type];
      emit(s, opt.type, { seat, amount: amt });
      if (p.allIn) emit(s, 'allin', { seat, amount: p.total });
    }
    p.acted = true;
    progress(s);
    return s;
  },

  ai(pub: PokerPublic, priv: PokerPrivate | undefined, seat: number, rng: Rng): PokerAction {
    if (pub.phase === 'choose') {
      if (!priv || priv.choices.length !== 4) throw new EngineError('고를 카드가 없습니다');
      return aiChoose(priv.choices);
    }
    if (pub.turn !== seat || pub.actions.length === 0) throw new EngineError('차례가 아닙니다');
    return aiBet(pub, priv, seat, rng);
  },

  timeout(s: PokerState, seat: number, _rng: Rng): PokerAction {
    const p = findPlayer(s, seat);
    if (s.phase === 'choose') {
      if (p.excluded || p.chosen) throw new EngineError('고를 차례가 아닙니다');
      // 가장 낮은 카드를 버리고, 남은 것 중 가장 낮은 카드를 공개
      const sorted = p.choices.slice().sort((a, b) => cardKey(a) - cardKey(b));
      return { type: 'choose', discard: sorted[0], open: sorted[1] };
    }
    if (s.turn !== seat) throw new EngineError('차례가 아닙니다');
    return options(s, p).some((o) => o.type === 'check') ? { type: 'check' } : { type: 'die' };
  },

  done(s: PokerState): boolean {
    return s.phase === 'done';
  },

  settle(s: PokerState): Settlement<PokerCarry> {
    if (s.phase !== 'done' || !s.result) throw new EngineError('아직 끝나지 않았습니다');
    return { deltas: { ...s.result.deltas }, summary: clone(s.result), carry: {} };
  },

  view(s: PokerState): View<PokerPublic, PokerPrivate> {
    const choosing = s.phase === 'choose';
    const atShowdown = s.phase === 'done' && !!s.result && !s.result.uncontested && !s.result.cancelled;
    const seats: PokerSeatPublic[] = s.players.map((p) => {
      const open = choosing ? [] : p.up.slice();
      const hiddenCount = p.excluded ? 0 : choosing ? (p.chosen ? 3 : 4) : p.down.length;
      return {
        seat: p.seat,
        name: p.name,
        kind: p.kind,
        excluded: p.excluded,
        chosen: p.chosen,
        open,
        hiddenCount,
        betRound: p.betRound,
        total: p.total,
        folded: p.folded,
        allIn: p.allIn,
        stackLeft: p.stack === null ? null : p.stack - p.total,
        last: p.last,
        openLabel: evaluateOpen(open)?.name ?? null,
      };
    });
    const turnPlayer = s.turn === null ? null : s.players.find((p) => p.seat === s.turn) ?? null;
    const pub: PokerPublic = {
      phase: s.phase,
      round: s.round,
      baseUnit: s.baseUnit,
      pot: potTotal(s),
      pots: computePots(s),
      curBet: s.curBet,
      raises: s.raises,
      maxRaises: MAX_RAISES,
      turn: s.turn,
      actions: turnPlayer ? options(s, turnPlayer) : [],
      seats,
      showdown: atShowdown
        ? live(s).map((p) => ({
            seat: p.seat,
            cards: [...p.down, ...p.up],
            hand: s.result!.hands[p.seat]?.name ?? '',
            best: s.result!.hands[p.seat]?.best ?? [],
          }))
        : null,
      winners: s.result?.winners.slice() ?? [],
      events: clone(s.events),
      summary: s.result ? clone(s.result) : null,
    };
    const priv: Record<number, PokerPrivate> = {};
    for (const p of participants(s)) {
      const mine = [...p.down, ...p.up];
      priv[p.seat] = {
        seat: p.seat,
        choices: p.choices.slice(),
        hidden: p.down.slice(),
        open: p.up.slice(),
        hand: evaluateAny(mine)?.name ?? null,
      };
    }
    return { public: pub, private: priv };
  },
};
