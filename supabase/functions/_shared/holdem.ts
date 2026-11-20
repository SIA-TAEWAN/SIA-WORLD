/**
 * 텍사스 홀덤 규칙 엔진 (노리밋, 트럼프 52장, 2~4명).
 *
 * ## 칩
 * 바이인 없음: 사람 자리는 stack(지갑의 카지노 칩 전부)으로 한다. AI(stack = null)는 가상의 칩
 * (사람 중 가장 많은 칩과 기본 단위 ×200 중 큰 값)을 갖는다. AI 정산값은 기록용이다.
 * BB를 낼 칩이 없는 사람 자리는 이번 판에서 빠진다(excluded, 정산 0). 참가자가 2명 미만이면 취소.
 *
 * ## 블라인드·버튼
 * SB = 기본 단위, BB = 기본 단위 ×2. 딜러 버튼은 판마다 다음 참가자로 한 칸(carry.button).
 * 3명 이상: 버튼 다음 SB, 그다음 BB. 프리플롭은 BB 다음 사람부터, 플롭부터는 버튼 다음 남은 사람부터.
 * 2명(헤즈업): 버튼이 SB, 상대가 BB. 프리플롭은 버튼(SB)이 먼저, 플롭부터는 BB가 먼저.
 * 블라인드를 다 못 내면 가진 만큼 내고 올인.
 *
 * ## 진행
 * 프리플롭(개인 2장) → 플롭(공용 3장) → 턴(1장) → 리버(1장) → 쇼다운. 각 공용 카드 전에 1장 버린다.
 * 베팅할 수 있는 사람이 1명 이하가 되면(나머지 올인) 남은 공용 카드를 모두 깔고 쇼다운(runout).
 *
 * ## 베팅 (betRound = 이번 라운드에 낸 돈, curBet = 이번 라운드 최고액)
 * - fold, check(낼 돈 없을 때), call(curBet까지, 모자라면 올인 콜)
 * - raise { to }: 이번 라운드 총액을 to로. 베팅이 없을 때는 '베트'.
 *   최소 to = curBet + max(직전 레이즈 폭, BB). 최대 = 내 칩 전부(betRound + 남은 칩).
 *   최소에 못 미치는 금액은 올인일 때만 가능하고, 이런 '모자란 올인 레이즈'는 이미 행동한 사람에게 레이즈 권한을 다시 주지 않는다
 *   (그 사람들은 콜·폴드만).
 * - 라운드 종료: 폴드·올인하지 않은 모두가 행동했고 낸 돈이 curBet과 같을 때.
 * - 시간 초과: 체크할 수 있으면 체크, 아니면 폴드.
 *
 * ## 승부
 * 개인 2장 + 공용 5장 중 최고 5장(hand-eval STANDARD: A-2-3-4-5가 가장 낮은 스트레이트, 무늬 비교 없음).
 * 사이드 팟(pots.ts). 완전 동점이면 팟을 나누고, 나머지 칩은 버튼 다음 자리부터 시계 방향으로 가까운 승자에게.
 * 혼자 남으면 카드를 보이지 않고 팟을 가져간다. 정산: deltas[seat] = 받은 돈 − 낸 돈. 합은 항상 0.
 */
import { clone, EngineError, shuffle, type Engine, type GameEvent, type Rng, type RoundInput, type SeatKind, type Settlement, type View } from './engine.ts';
import { compareHands, evaluate7, fullDeck, HandCat, rankOf, STANDARD, type HandValue } from './hand-eval.ts';
import { computeSidePots, splitPot, type Pot } from './pots.ts';

// ───────────────────────── 타입 ─────────────────────────

export type HoldemPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'done';
export type HoldemAction = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; to: number } | { type: 'allin' };

/** 다음 판으로: 지난 판 버튼 자리 */
export interface HoldemCarry {
  button: number | null;
}

export interface HoldemPlayer {
  seat: number;
  kind: SeatKind;
  name: string;
  /** 이번 판 칩 (AI는 가상) */
  stack: number;
  ai: boolean;
  excluded: boolean;
  hole: string[];
  folded: boolean;
  allIn: boolean;
  betRound: number;
  total: number;
  acted: boolean;
  /** 이번 라운드에 레이즈할 수 있는가 (모자란 올인 레이즈는 이미 행동한 사람에게 다시 열어 주지 않는다) */
  mayRaise: boolean;
  last: string | null;
}

export interface HoldemPotResult extends Pot {
  winners: number[];
}

export interface HoldemSummary {
  cancelled: boolean;
  uncontested: boolean;
  winners: number[];
  pots: HoldemPotResult[];
  hands: Record<number, { name: string; best: string[] }>;
  deltas: Record<number, number>;
  excluded: number[];
  board: string[];
}

export interface HoldemState {
  phase: HoldemPhase;
  baseUnit: number;
  sb: number;
  bb: number;
  deck: string[];
  board: string[];
  players: HoldemPlayer[];
  button: number;
  sbSeat: number;
  bbSeat: number;
  turn: number | null;
  curBet: number;
  /** 직전 (완전한) 레이즈 폭 */
  minRaise: number;
  /** 베팅 없이 남은 카드를 모두 깐 판 */
  runout: boolean;
  events: GameEvent[];
  nextEventId: number;
  result: HoldemSummary | null;
}

/** 지금 차례인 사람이 할 수 있는 것 */
export interface HoldemOptions {
  canCheck: boolean;
  canFold: boolean;
  /** 콜 금액 (0이면 콜 없음). 칩이 모자라면 남은 칩 전부 */
  call: number;
  callAllIn: boolean;
  /** 레이즈(베트) 가능 여부와 이번 라운드 총액 범위 */
  canRaise: boolean;
  minTo: number;
  maxTo: number;
  /** 베팅이 없어서 '베트'인가 */
  isBet: boolean;
}

export interface HoldemSeatPublic {
  seat: number;
  name: string;
  kind: SeatKind;
  excluded: boolean;
  folded: boolean;
  allIn: boolean;
  betRound: number;
  total: number;
  /** 사람: 남은 칩, AI: 가상 칩 */
  stackLeft: number;
  holeCount: number;
  last: string | null;
}

export interface HoldemPublic {
  phase: HoldemPhase;
  baseUnit: number;
  sb: number;
  bb: number;
  board: string[];
  pot: number;
  pots: Pot[];
  button: number;
  sbSeat: number;
  bbSeat: number;
  curBet: number;
  turn: number | null;
  options: HoldemOptions | null;
  seats: HoldemSeatPublic[];
  runout: boolean;
  /** 쇼다운한 사람의 개인 카드 (그 전/무혈 승리면 null) */
  showdown: { seat: number; cards: string[]; hand: string; best: string[] }[] | null;
  winners: number[];
  events: GameEvent[];
  summary: HoldemSummary | null;
}

export interface HoldemPrivate {
  seat: number;
  hole: string[];
  /** 지금 내 패 이름 (공용 카드 3장 이상이면 최고 5장 족보) */
  hand: string | null;
}

const EVENT_KEEP = 40;
const LABEL = { fold: '폴드', check: '체크', call: '콜', bet: '베트', raise: '레이즈', allin: '올인' } as const;

// ───────────────────────── 도우미 ─────────────────────────

const inHand = (p: HoldemPlayer) => !p.excluded && !p.folded;
const live = (s: HoldemState) => s.players.filter(inHand);
const participants = (s: HoldemState) => s.players.filter((p) => !p.excluded);
const remaining = (p: HoldemPlayer) => p.stack - p.total;
const potTotal = (s: HoldemState) => s.players.reduce((a, p) => a + p.total, 0);

function findPlayer(s: HoldemState, seat: number): HoldemPlayer {
  const p = s.players.find((x) => x.seat === seat);
  if (!p) throw new EngineError('없는 자리입니다');
  return p;
}

function emit(s: HoldemState, t: string, extra: Record<string, unknown> = {}): void {
  s.events.push({ id: s.nextEventId++, t, ...extra });
  if (s.events.length > EVENT_KEEP) s.events.splice(0, s.events.length - EVENT_KEEP);
}

function draw(s: HoldemState): string {
  const c = s.deck.shift();
  if (!c) throw new EngineError('카드가 모자랍니다');
  return c;
}

/** 돈 내기 (가진 칩까지). 실제로 낸 금액 */
function put(p: HoldemPlayer, amount: number): number {
  const amt = Math.max(0, Math.min(Math.floor(amount), remaining(p)));
  p.betRound += amt;
  p.total += amt;
  if (remaining(p) <= 0) p.allIn = true;
  return amt;
}

/** 자리 번호 순 원형에서 from 다음 (cands 중) */
function nextAfter(from: number, cands: HoldemPlayer[]): number | null {
  if (!cands.length) return null;
  const seats = cands.map((p) => p.seat).sort((a, b) => a - b);
  return seats.find((x) => x > from) ?? seats[0];
}

/** 버튼 다음 자리부터 시계 방향 순서 (나머지 칩 나누기 순서) */
function orderFromButton(s: HoldemState): number[] {
  const seats = participants(s)
    .map((p) => p.seat)
    .sort((a, b) => a - b);
  const i = seats.findIndex((x) => x > s.button);
  return i < 0 ? seats : [...seats.slice(i), ...seats.slice(0, i)];
}

export function holdemOptions(s: HoldemState, p: HoldemPlayer): HoldemOptions | null {
  if (s.phase === 'done' || s.turn !== p.seat || !inHand(p) || p.allIn) return null;
  const rem = remaining(p);
  const toCall = Math.max(0, s.curBet - p.betRound);
  const call = Math.min(toCall, rem);
  // 내가 레이즈해도 받아 줄 사람이 있어야 한다 (폴드·올인 아닌 다른 사람)
  const others = live(s).filter((o) => o !== p && !o.allIn);
  const maxTo = p.betRound + rem;
  const minTo = Math.min(maxTo, s.curBet + Math.max(s.minRaise, s.bb));
  const canRaise = p.mayRaise && others.length > 0 && rem > toCall;
  return {
    canCheck: toCall === 0,
    canFold: true,
    call: toCall > 0 ? call : 0,
    callAllIn: toCall > 0 && rem <= toCall,
    canRaise,
    minTo: canRaise ? minTo : 0,
    maxTo: canRaise ? maxTo : 0,
    isBet: s.curBet === 0,
  };
}

// ───────────────────────── 진행 ─────────────────────────

function startStreet(s: HoldemState, first: number | null): boolean {
  for (const p of s.players) {
    p.betRound = 0;
    p.acted = false;
    p.mayRaise = true;
  }
  s.curBet = 0;
  s.minRaise = s.bb;
  const actors = live(s).filter((p) => !p.allIn);
  if (actors.length < 2) {
    s.turn = null;
    return false;
  }
  s.turn = first;
  return true;
}

/** 플롭부터: 버튼 다음 남은 사람 (헤즈업이면 BB = 버튼 아닌 사람) */
function firstPostflop(s: HoldemState): number | null {
  const actors = live(s).filter((p) => !p.allIn);
  return nextAfter(s.button, actors);
}

function dealStreet(s: HoldemState): void {
  draw(s); // 버리는 카드
  if (s.phase === 'preflop') {
    s.phase = 'flop';
    s.board.push(draw(s), draw(s), draw(s));
    emit(s, 'flop', { cards: s.board.slice(0, 3) });
  } else if (s.phase === 'flop') {
    s.phase = 'turn';
    s.board.push(draw(s));
    emit(s, 'turn', { card: s.board[3] });
  } else {
    s.phase = 'river';
    s.board.push(draw(s));
    emit(s, 'river', { card: s.board[4] });
  }
}

/** 라운드가 끝나면 다음 공용 카드 → 베팅. 베팅이 필요 없으면 계속 깔고 쇼다운 */
function advance(s: HoldemState): void {
  for (;;) {
    if (live(s).length <= 1) return finishUncontested(s);
    if (s.phase === 'river') return showdown(s);
    dealStreet(s);
    if (startStreet(s, firstPostflop(s))) return;
    // 베팅할 사람이 없다 (올인): 남은 공용 카드를 차례로 깐다 (화면은 한 장씩 천천히 공개)
    if (!s.runout) {
      s.runout = true;
      emit(s, 'runout', {});
    }
  }
}

function progress(s: HoldemState): void {
  if (live(s).length <= 1) return finishUncontested(s);
  const need = live(s).filter((p) => !p.allIn && (!p.acted || p.betRound < s.curBet));
  if (need.length === 0) {
    s.turn = null;
    return advance(s);
  }
  s.turn = nextAfter(s.turn ?? -1, need);
}

function finish(s: HoldemState, pots: HoldemPotResult[], uncontested: boolean, hands: HoldemSummary['hands']): void {
  const order = orderFromButton(s);
  const won: Record<number, number> = {};
  for (const pot of pots) {
    const share = splitPot(pot.amount, pot.winners, order);
    for (const [seat, v] of Object.entries(share)) won[Number(seat)] = (won[Number(seat)] ?? 0) + v;
  }
  const deltas: Record<number, number> = {};
  // 이번 판에서 빠진 자리(excluded)는 넣지 않는다: 정산 SQL 은 deltas 에 자리가 있으면 시아코인을 준다
  for (const p of s.players) if (!p.excluded) deltas[p.seat] = (won[p.seat] ?? 0) - p.total;
  const winners = [...new Set(pots.flatMap((p) => p.winners))].sort((a, b) => a - b);
  for (const w of winners) {
    const pl = findPlayer(s, w);
    emit(s, 'win', { seat: w, amount: won[w] ?? 0, allIn: pl.allIn });
  }
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
    board: s.board.slice(),
  };
}

function finishUncontested(s: HoldemState): void {
  const w = live(s)[0];
  finish(s, [{ amount: potTotal(s), eligible: [w.seat], winners: [w.seat] }], true, {});
}

function showdown(s: HoldemState): void {
  const alive = live(s);
  const vals: Record<number, HandValue> = {};
  const hands: HoldemSummary['hands'] = {};
  for (const p of alive) {
    const v = evaluate7([...p.hole, ...s.board], STANDARD);
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
  const pots: HoldemPotResult[] = computeSidePots(participants(s)).map((pot) => {
    let best: HandValue | null = null;
    let winners: number[] = [];
    for (const seat of pot.eligible) {
      const v = vals[seat];
      const c = best ? compareHands(v, best, STANDARD) : 1;
      if (c > 0) {
        best = v;
        winners = [seat];
      } else if (c === 0) winners.push(seat);
    }
    return { ...pot, winners };
  });
  finish(s, pots, false, hands);
}

// ───────────────────────── AI ─────────────────────────

/** 시작 패 점수 (0~1) */
export function preflopStrength(hole: string[]): number {
  const [a, b] = hole.map(rankOf).sort((x, y) => y - x);
  const suited = hole[0][1] === hole[1][1];
  if (a === b) return Math.min(1, 0.5 + (a - 2) * 0.04); // 22 = 0.5, AA = 0.98
  let sc = (a + b - 4) / 48; // 높은 카드일수록
  if (a === 14) sc += 0.12;
  if (suited) sc += 0.06;
  const gap = a - b;
  if (gap === 1) sc += 0.05;
  else if (gap === 2) sc += 0.02;
  else if (gap >= 5) sc -= 0.06;
  return Math.max(0, Math.min(0.95, sc));
}

/** 공개 정보만으로 승률 추정 (몬테카를로). opponents: 아직 남은 상대 수 */
export function estimateEquity(hole: string[], board: string[], opponents: number, rng: Rng, iters = 160): number {
  const known = new Set([...hole, ...board]);
  const rest = fullDeck().filter((c) => !known.has(c));
  let score = 0;
  for (let it = 0; it < iters; it++) {
    // 필요한 장수만큼 앞에서 섞기
    const need = 5 - board.length + opponents * 2;
    const d = rest.slice();
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(d.length - i);
      [d[i], d[j]] = [d[j], d[i]];
    }
    const full = [...board, ...d.slice(0, 5 - board.length)];
    const mine = evaluate7([...hole, ...full], STANDARD);
    let k = 5 - board.length;
    let lose = false;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      const ov = evaluate7([d[k], d[k + 1], ...full], STANDARD);
      k += 2;
      const c = compareHands(mine, ov, STANDARD);
      if (c < 0) {
        lose = true;
        break;
      }
      if (c === 0) ties++;
    }
    if (!lose) score += ties ? 1 / (ties + 1) : 1;
  }
  return score / iters;
}

/** AI 실수 확률: 이만큼은 사람에게 유리한 쪽으로 잘못 고른다 (난이도 10% 낮춤. AI 는 돈을 잃어도 된다) */
export const AI_MISTAKE = 0.1;

function aiAct(pub: HoldemPublic, priv: HoldemPrivate | undefined, seat: number, rng: Rng): HoldemAction {
  const a = aiPlan(pub, priv, seat, rng);
  const o = pub.options!;
  // 실수는 진짜 AI 자리에만: 판 도중 나간 사람 자리는 AI 가 대신 두지만 그 사람의 실제 칩이다 (난수는 똑같이 하나 쓴다)
  const roll = rng.next();
  if (roll >= AI_MISTAKE || pub.seats.find((x) => x.seat === seat)?.kind !== 'ai') return a;
  // 레이즈·올인 → 콜·체크만 (값을 덜 뽑는다), 콜 → 폴드 (판을 내준다), 폴드 → 콜 (사람의 큰 패에 따라간다)
  if (a.type === 'raise' || a.type === 'allin') return o.call > 0 ? { type: 'call' } : o.canCheck ? { type: 'check' } : a;
  if (a.type === 'call') return { type: 'fold' };
  if (a.type === 'fold' && o.call > 0) return { type: 'call' };
  return a;
}

function aiPlan(pub: HoldemPublic, priv: HoldemPrivate | undefined, seat: number, rng: Rng): HoldemAction {
  const o = pub.options;
  if (!o) throw new EngineError('차례가 아닙니다');
  const hole = priv?.hole ?? [];
  const opponents = pub.seats.filter((x) => x.seat !== seat && !x.folded && !x.excluded).length;
  const pot = Math.max(pub.bb, pub.pot);
  const bluff = rng.next() < 0.1;
  const raiseTo = (frac: number): HoldemAction | null => {
    if (!o.canRaise) return null;
    const to = Math.round(Math.max(o.minTo, Math.min(o.maxTo, pub.curBet + pot * frac)));
    return to >= o.maxTo ? { type: 'allin' } : { type: 'raise', to };
  };
  const passive = (): HoldemAction => (o.canCheck ? { type: 'check' } : { type: 'fold' });

  let strength: number;
  if (pub.board.length === 0 || hole.length < 2) {
    strength = hole.length === 2 ? preflopStrength(hole) : 0.3;
    // 프리플롭: 강함 → 레이즈, 보통 → 콜, 약함 → 폴드(공짜면 체크)
    if (strength >= 0.62 || (bluff && o.canRaise)) return raiseTo(strength >= 0.85 ? 1 : 0.6) ?? (o.call ? { type: 'call' } : passive());
    if (strength >= 0.35) {
      if (o.canCheck) return { type: 'check' };
      return o.call <= pub.bb * 4 || o.call <= pot * 0.3 ? { type: 'call' } : { type: 'fold' };
    }
    if (o.canCheck) return { type: 'check' };
    return o.call <= pub.bb && rng.next() < 0.4 ? { type: 'call' } : { type: 'fold' };
  }
  strength = estimateEquity(hole, pub.board, Math.max(1, opponents), rng);
  const potOdds = o.call > 0 ? o.call / (pot + o.call) : 0;
  if (strength >= 0.72) return raiseTo(strength >= 0.88 ? 1 : 0.66) ?? (o.call ? { type: 'call' } : passive());
  if (bluff && o.canCheck && o.canRaise) return raiseTo(0.5) ?? passive();
  if (o.canCheck) return strength >= 0.55 && rng.next() < 0.4 ? (raiseTo(0.5) ?? { type: 'check' }) : { type: 'check' };
  if (strength >= potOdds + 0.08) return { type: 'call' };
  return { type: 'fold' };
}

// ───────────────────────── 엔진 ─────────────────────────

export const holdem: Engine<HoldemState, HoldemAction, HoldemCarry, HoldemPublic, HoldemPrivate> = {
  game: 'holdem',
  // 판 도중 나간 사람: 공짜면 체크, 아니면 폴드. AI 가 그 사람 돈으로 계속 걸지 않는다
  leftUsesTimeout: true,

  newRound(input: RoundInput<HoldemCarry>): HoldemState {
    const { baseUnit, rng } = input;
    if (input.seats.length < 2 || input.seats.length > 4) throw new EngineError('텍사스 홀덤은 2~4명입니다');
    if (!(baseUnit > 0)) throw new EngineError('기본 단위가 잘못되었습니다');
    const seats = input.seats.slice().sort((a, b) => a.seat - b.seat);
    if (new Set(seats.map((x) => x.seat)).size !== seats.length) throw new EngineError('자리 번호가 겹칩니다');
    const sb = baseUnit;
    const bb = baseUnit * 2;
    const humanMax = Math.max(0, ...seats.filter((x) => x.stack !== null).map((x) => x.stack!));
    const aiStack = Math.max(baseUnit * 200, humanMax);
    const s: HoldemState = {
      phase: 'preflop',
      baseUnit,
      sb,
      bb,
      deck: shuffle(fullDeck(), rng),
      board: [],
      players: seats.map((x) => ({
        seat: x.seat,
        kind: x.kind,
        name: x.name,
        stack: x.stack === null ? aiStack : Math.max(0, Math.floor(x.stack)),
        ai: x.stack === null,
        excluded: x.stack !== null && x.stack < bb,
        hole: [],
        folded: false,
        allIn: false,
        betRound: 0,
        total: 0,
        acted: false,
        mayRaise: true,
        last: null,
      })),
      button: -1,
      sbSeat: -1,
      bbSeat: -1,
      turn: null,
      curBet: 0,
      minRaise: bb,
      runout: false,
      events: [],
      nextEventId: 1,
      result: null,
    };
    const ps = participants(s);
    if (ps.length < 2) {
      s.phase = 'done';
      const deltas: Record<number, number> = {};
      for (const p of s.players) if (!p.excluded) deltas[p.seat] = 0;
      s.result = { cancelled: true, uncontested: false, winners: [], pots: [], hands: {}, deltas, excluded: s.players.filter((p) => p.excluded).map((p) => p.seat), board: [] };
      return s;
    }
    // 버튼: 지난 판 버튼 다음 참가자 (첫 판은 무작위)
    const prev = input.carry?.button;
    s.button = typeof prev === 'number' ? nextAfter(prev, ps)! : ps[rng.int(ps.length)].seat;
    if (ps.length === 2) {
      s.sbSeat = s.button;
      s.bbSeat = nextAfter(s.button, ps)!;
    } else {
      s.sbSeat = nextAfter(s.button, ps)!;
      s.bbSeat = nextAfter(s.sbSeat, ps)!;
    }
    emit(s, 'button', { seat: s.button });
    const sbP = findPlayer(s, s.sbSeat);
    const bbP = findPlayer(s, s.bbSeat);
    emit(s, 'blind', { seat: sbP.seat, amount: put(sbP, sb), kind: 'sb' });
    emit(s, 'blind', { seat: bbP.seat, amount: put(bbP, bb), kind: 'bb' });
    for (const p of [sbP, bbP]) if (p.allIn) emit(s, 'allin', { seat: p.seat, amount: p.total });
    s.curBet = Math.max(sbP.betRound, bbP.betRound);
    s.minRaise = bb;
    // 2장씩 (SB부터 한 장씩 두 바퀴)
    const dealOrder = orderFromButton(s);
    for (let r = 0; r < 2; r++) for (const seat of dealOrder) findPlayer(s, seat).hole.push(draw(s));
    for (const seat of dealOrder) emit(s, 'deal', { seat, count: 2 });
    // 프리플롭 첫 행동: 헤즈업이면 버튼(SB), 아니면 BB 다음
    const actors = live(s).filter((p) => !p.allIn);
    const first = ps.length === 2 ? (sbP.allIn ? nextAfter(sbP.seat, actors) : sbP.seat) : nextAfter(s.bbSeat, actors);
    s.turn = actors.length ? first : null;
    // 블라인드만으로 더 베팅할 사람이 없으면 (모두 올인 등) 바로 진행
    if (actors.length === 0 || (actors.length === 1 && actors[0].betRound >= s.curBet)) {
      s.turn = null;
      advance(s);
    }
    return s;
  },

  pending(s: HoldemState): number[] {
    if (s.phase === 'done' || s.turn === null) return [];
    return [s.turn];
  },

  apply(s0: HoldemState, seat: number, action: HoldemAction, _rng: Rng): HoldemState {
    if (s0.phase === 'done') throw new EngineError('이미 끝난 판입니다');
    const s = clone(s0);
    const p = findPlayer(s, seat);
    if (p.excluded) throw new EngineError('이번 판에 참가하지 않은 자리입니다');
    if (s.turn !== seat) throw new EngineError('차례가 아닙니다');
    if (!action || typeof action !== 'object') throw new EngineError('잘못된 행동입니다');
    const o = holdemOptions(s, p);
    if (!o) throw new EngineError('차례가 아닙니다');

    if (action.type === 'fold') {
      p.folded = true;
      p.last = LABEL.fold;
      emit(s, 'fold', { seat });
    } else if (action.type === 'check') {
      if (!o.canCheck) throw new EngineError('지금은 체크할 수 없습니다');
      p.last = LABEL.check;
      emit(s, 'check', { seat });
    } else if (action.type === 'call') {
      if (o.call <= 0) throw new EngineError('콜할 금액이 없습니다');
      const amt = put(p, o.call);
      p.last = p.allIn ? LABEL.allin : LABEL.call;
      emit(s, 'call', { seat, amount: amt });
      if (p.allIn) emit(s, 'allin', { seat, amount: p.total });
    } else if (action.type === 'raise' || action.type === 'allin') {
      let to: number;
      if (action.type === 'allin') {
        to = p.betRound + remaining(p);
        if (to <= s.curBet) {
          // 콜 금액보다 적거나 같은 올인 = 올인 콜
          const amt = put(p, remaining(p));
          p.last = LABEL.allin;
          emit(s, 'call', { seat, amount: amt });
          emit(s, 'allin', { seat, amount: p.total });
          p.acted = true;
          p.mayRaise = false;
          progress(s);
          return s;
        }
        if (!o.canRaise) throw new EngineError('지금은 레이즈할 수 없습니다');
      } else {
        if (!o.canRaise) throw new EngineError('지금은 레이즈할 수 없습니다');
        to = Math.floor(Number(action.to));
        if (!Number.isFinite(to)) throw new EngineError('금액이 잘못되었습니다');
        if (to > o.maxTo) throw new EngineError('가진 칩보다 많습니다');
        if (to < o.minTo && to !== o.maxTo) throw new EngineError(`최소 ${o.minTo}까지 올려야 합니다`);
      }
      const isBet = s.curBet === 0;
      const raiseBy = to - s.curBet;
      put(p, to - p.betRound);
      const full = raiseBy >= Math.max(s.minRaise, s.bb);
      if (full) {
        s.minRaise = raiseBy;
        // 완전한 레이즈: 다른 사람 모두 다시 행동하고 레이즈도 할 수 있다
        for (const x of s.players) if (x !== p && inHand(x) && !x.allIn) {
          x.acted = false;
          x.mayRaise = true;
        }
      } else {
        // 모자란 올인 레이즈: 다시 맞춰야 하지만 레이즈 권한은 그대로
        for (const x of s.players) if (x !== p && inHand(x) && !x.allIn) x.acted = false;
      }
      s.curBet = Math.max(s.curBet, p.betRound);
      p.last = p.allIn ? LABEL.allin : isBet ? LABEL.bet : LABEL.raise;
      emit(s, isBet ? 'bet' : 'raise', { seat, to: p.betRound });
      if (p.allIn) emit(s, 'allin', { seat, amount: p.total });
    } else {
      throw new EngineError('잘못된 행동입니다');
    }
    p.acted = true;
    p.mayRaise = false;
    progress(s);
    return s;
  },

  ai(pub: HoldemPublic, priv: HoldemPrivate | undefined, seat: number, rng: Rng): HoldemAction {
    if (pub.turn !== seat || !pub.options) throw new EngineError('차례가 아닙니다');
    return aiAct(pub, priv, seat, rng);
  },

  timeout(s: HoldemState, seat: number, _rng: Rng): HoldemAction {
    if (s.turn !== seat) throw new EngineError('차례가 아닙니다');
    const o = holdemOptions(s, findPlayer(s, seat));
    return o?.canCheck ? { type: 'check' } : { type: 'fold' };
  },

  done(s: HoldemState): boolean {
    return s.phase === 'done';
  },

  settle(s: HoldemState): Settlement<HoldemCarry> {
    if (s.phase !== 'done' || !s.result) throw new EngineError('아직 끝나지 않았습니다');
    return { deltas: { ...s.result.deltas }, summary: clone(s.result), carry: { button: s.button >= 0 ? s.button : null } };
  },

  view(s: HoldemState): View<HoldemPublic, HoldemPrivate> {
    const atShowdown = s.phase === 'done' && !!s.result && !s.result.uncontested && !s.result.cancelled;
    const turnPlayer = s.turn === null ? null : (s.players.find((p) => p.seat === s.turn) ?? null);
    const pub: HoldemPublic = {
      phase: s.phase,
      baseUnit: s.baseUnit,
      sb: s.sb,
      bb: s.bb,
      board: s.board.slice(),
      pot: potTotal(s),
      pots: computeSidePots(participants(s)),
      button: s.button,
      sbSeat: s.sbSeat,
      bbSeat: s.bbSeat,
      curBet: s.curBet,
      turn: s.turn,
      options: turnPlayer ? holdemOptions(s, turnPlayer) : null,
      seats: s.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        kind: p.kind,
        excluded: p.excluded,
        folded: p.folded,
        allIn: p.allIn,
        betRound: p.betRound,
        total: p.total,
        stackLeft: remaining(p),
        holeCount: p.hole.length,
        last: p.last,
      })),
      runout: s.runout,
      showdown: atShowdown
        ? live(s).map((p) => ({ seat: p.seat, cards: p.hole.slice(), hand: s.result!.hands[p.seat]?.name ?? '', best: s.result!.hands[p.seat]?.best ?? [] }))
        : null,
      winners: s.result?.winners.slice() ?? [],
      events: clone(s.events),
      summary: s.result ? clone(s.result) : null,
    };
    const priv: Record<number, HoldemPrivate> = {};
    for (const p of participants(s)) {
      const all = [...p.hole, ...s.board];
      priv[p.seat] = {
        seat: p.seat,
        hole: p.hole.slice(),
        hand: all.length >= 5 ? evaluate7(all, STANDARD).name : p.hole.length === 2 && p.hole[0][0] === p.hole[1][0] ? `${p.hole[0][0] === 'T' ? '10' : p.hole[0][0]} 포켓 페어` : null,
      };
    }
    return { public: pub, private: priv };
  },
};
