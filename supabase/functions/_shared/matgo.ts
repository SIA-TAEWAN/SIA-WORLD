/**
 * 시아맞고 규칙 엔진 (2인 고스톱 · 맞고).
 *
 * engine.ts 규격을 따른다: 순수 TS, 상태는 JSON, 입력 상태는 고치지 않고 새 상태를 돌려준다,
 * 난수는 인자로 받은 Rng만 쓴다, 규칙 위반은 EngineError.
 *
 * 내부에서는 자리를 0/1 "번째"(idx)로 다루고, 바깥(pending·이벤트·view·정산)으로 나갈 때만
 * 실제 자리 번호(SeatInfo.seat)로 바꾼다.
 *
 * 규칙 해석 메모
 * - 바닥에 같은 달 2장이 있고 두 장이 완전히 같은 가치(예: 일반 피 2장)면 선택 없이 자동으로 먹는다.
 * - 처음부터 바닥에 깔린 같은 달 3장은 뻑처럼 쌓여 있다가 4번째 장으로 한꺼번에 먹지만,
 *   실제로 '뻑'이 난 것이 아니므로 피를 빼앗지 않는다. 판 중에 생긴 뻑 더미를 먹을 때만 피 1장.
 * - 폭탄: 같은 달 3장을 한꺼번에 내므로 손패가 상대보다 2장 적어진다. 그만큼 '폭탄 피'(bombFill) 2개를 받아
 *   이후 자기 차례에 손패를 내지 않고 더미만 뒤집을 수 있다({ type: 'flip' }). 손패를 내도 된다.
 *   손패가 비고 bombFill도 0이면 그 사람은 패를 다 쓴 것이다.
 * - 쓸은 매 차례 끝에 바닥이 비었으면(그 차례에 먹은 패가 있을 때) 인정한다.
 * - 고 판단은 차례를 마친 사람만 한다(상대 차례에 피를 빼앗겨 점수가 바뀌어도 그때는 묻지 않는다).
 * - 뻑 보너스: **첫뻑**은 그 판의 자기 첫 차례에 뻑이 났을 때만 (상대에게서 기본금 ×2), **연뻑**은 첫 차례에 첫뻑을 낸 사람이
 *   바로 다음 자기 차례(둘째 차례)에 또 뻑을 냈을 때만 (기본금 ×3 더). 그 밖의 뻑(판 중간에 난 뻑)은 보너스가 없다.
 *   보너스는 판 끝 정산에 합산하고 나가리여도 오간다. 차례는 그 사람이 둔 횟수로 센다: 패 내기·폭탄·폭탄 피 뒤집기가 각각 한 차례
 *   (같은 달 고르기·국진·고/스톱은 그 차례에 딸린 선택이라 세지 않는다).
 *   한 판에 세 번 뻑을 내면 (보너스가 붙었든 아니든 횟수로) 그 자리에서 승리(삼뻑)다. 삼뻑 승리는 7점으로 이긴 것으로 치고
 *   다른 배수(흔들기·폭탄·나가리)는 붙이지 않는다 (기본금 ×7 + 앞서 받은 뻑 보너스). 처음부터 바닥에 깔린 같은 달 3장은 뻑이 아니다.
 */
import { clone, EngineError, shuffle } from './engine.ts';
import type { Engine, GameEvent, Rng, RoundInput, SeatInfo, SeatKind } from './engine.ts';

// ───────────────────────────── 카드 ─────────────────────────────

export type CardKind = 'gwang' | 'yeol' | 'tti' | 'pi';
export type DanKind = 'hong' | 'cheong' | 'cho';
export type GukjinUse = 'yeol' | 'ssangpi';

export interface MatgoCard {
  id: string;
  month: number;
  /** 십이지신 (1월 쥐 … 12월 돼지) */
  animal: string;
  kind: CardKind;
  /** 화면용 이름 (예: '1월 쥐 광') */
  name: string;
  /** 고도리 열끗 (2·4·8월) */
  godori: boolean;
  /** 단 종류 (비띠는 null) */
  dan: DanKind | null;
  /** 쌍피 (피 2장) */
  ssangpi: boolean;
  /** 비광 (12월 광) */
  bigwang: boolean;
  /** 국진 (9월 열끗, 열끗 또는 쌍피로 쓸 수 있음) */
  gukjin: boolean;
}

export const ANIMALS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'] as const;

type CardSpec = [suffix: string, kind: CardKind, extra?: Partial<Pick<MatgoCard, 'godori' | 'dan' | 'ssangpi' | 'bigwang' | 'gukjin'>>];

/** 달마다 4장 (실제 화투 구성) */
const MONTH_SPECS: CardSpec[][] = [
  /* 1월 */ [['gwang', 'gwang'], ['tti', 'tti', { dan: 'hong' }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 2월 */ [['yeol', 'yeol', { godori: true }], ['tti', 'tti', { dan: 'hong' }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 3월 */ [['gwang', 'gwang'], ['tti', 'tti', { dan: 'hong' }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 4월 */ [['yeol', 'yeol', { godori: true }], ['tti', 'tti', { dan: 'cho' }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 5월 */ [['yeol', 'yeol'], ['tti', 'tti', { dan: 'cho' }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 6월 */ [['yeol', 'yeol'], ['tti', 'tti', { dan: 'cheong' }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 7월 */ [['yeol', 'yeol'], ['tti', 'tti', { dan: 'cho' }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 8월 */ [['gwang', 'gwang'], ['yeol', 'yeol', { godori: true }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 9월 */ [['yeol', 'yeol', { gukjin: true }], ['tti', 'tti', { dan: 'cheong' }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 10월 */ [['yeol', 'yeol'], ['tti', 'tti', { dan: 'cheong' }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 11월 */ [['gwang', 'gwang'], ['ssangpi', 'pi', { ssangpi: true }], ['pi1', 'pi'], ['pi2', 'pi']],
  /* 12월 */ [['gwang', 'gwang', { bigwang: true }], ['yeol', 'yeol'], ['tti', 'tti'], ['ssangpi', 'pi', { ssangpi: true }]],
];

const DAN_NAME: Record<DanKind, string> = { hong: '홍단', cheong: '청단', cho: '초단' };

function cardName(month: number, animal: string, kind: CardKind, f: Required<NonNullable<CardSpec[2]>>): string {
  let k: string;
  if (kind === 'gwang') k = f.bigwang ? '비광' : '광';
  else if (kind === 'yeol') k = f.godori ? '고도리' : f.gukjin ? '국진' : '열끗';
  else if (kind === 'tti') k = f.dan ? DAN_NAME[f.dan] : '비띠';
  else k = f.ssangpi ? '쌍피' : '피';
  return `${month}월 ${animal} ${k}`;
}

/** 화투 48장 (달 순서) */
export const CARDS: readonly MatgoCard[] = MONTH_SPECS.flatMap((specs, i) => {
  const month = i + 1;
  const animal = ANIMALS[i];
  return specs.map(([suffix, kind, extra]) => {
    const f = { godori: false, dan: null as DanKind | null, ssangpi: false, bigwang: false, gukjin: false, ...extra };
    return {
      id: `m${String(month).padStart(2, '0')}-${suffix}`,
      month,
      animal,
      kind,
      name: cardName(month, animal, kind, f),
      ...f,
    };
  });
});

const CARD_MAP: Record<string, MatgoCard> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const GUKJIN_ID = 'm09-yeol';
const GODORI_IDS = CARDS.filter((c) => c.godori).map((c) => c.id);

export function cardById(id: string): MatgoCard {
  const c = CARD_MAP[id];
  if (!c) throw new EngineError(`없는 카드: ${id}`);
  return c;
}
const monthOf = (id: string) => cardById(id).month;

// ───────────────────────────── 점수 ─────────────────────────────

export interface ScoreLine {
  label: string;
  points: number;
}

export interface MatgoScore {
  total: number;
  lines: ScoreLine[];
  /** 광으로 얻은 점수 (광박 판정용) */
  gwangPoints: number;
  /** 피로 얻은 점수 (피박 판정용) */
  piPoints: number;
  /** 장수 (피는 쌍피를 2장으로 센다) */
  counts: { gwang: number; yeol: number; tti: number; pi: number };
}

/** 국진을 고려한 카드 분류 (국진을 쌍피로 쓰면 피) */
function effKind(c: MatgoCard, gukjinAs: GukjinUse | null): CardKind {
  return c.gukjin && gukjinAs === 'ssangpi' ? 'pi' : c.kind;
}
function piValue(c: MatgoCard, gukjinAs: GukjinUse | null): number {
  if (effKind(c, gukjinAs) !== 'pi') return 0;
  return c.ssangpi || c.gukjin ? 2 : 1;
}

/** 먹은 패로 족보 점수 계산 (고 보너스 제외). gukjinAs가 null이면 국진은 열끗으로 본다 */
export function scoreCards(ids: readonly string[], gukjinAs: GukjinUse | null = null): MatgoScore {
  const cards = ids.map(cardById);
  const lines: ScoreLine[] = [];
  const gw = cards.filter((c) => c.kind === 'gwang');
  const yeol = cards.filter((c) => effKind(c, gukjinAs) === 'yeol');
  const tti = cards.filter((c) => c.kind === 'tti');
  const pi = cards.reduce((n, c) => n + piValue(c, gukjinAs), 0);

  let gwangPoints = 0;
  if (gw.length === 5) gwangPoints = 15;
  else if (gw.length === 4) gwangPoints = 4;
  else if (gw.length === 3) gwangPoints = gw.some((c) => c.bigwang) ? 2 : 3;
  if (gwangPoints > 0) {
    const label = gw.length === 3 && gw.some((c) => c.bigwang) ? '비삼광' : `${gw.length}광`;
    lines.push({ label, points: gwangPoints });
  }

  if (yeol.length >= 5) lines.push({ label: `열끗 ${yeol.length}장`, points: yeol.length - 4 });
  if (GODORI_IDS.every((id) => ids.includes(id))) lines.push({ label: '고도리', points: 5 });

  if (tti.length >= 5) lines.push({ label: `띠 ${tti.length}장`, points: tti.length - 4 });
  for (const dan of ['hong', 'cheong', 'cho'] as DanKind[]) {
    if (tti.filter((c) => c.dan === dan).length === 3) lines.push({ label: DAN_NAME[dan], points: 3 });
  }

  const piPoints = pi >= 10 ? pi - 9 : 0;
  if (piPoints > 0) lines.push({ label: `피 ${pi}장`, points: piPoints });

  return {
    total: lines.reduce((n, l) => n + l.points, 0),
    lines,
    gwangPoints,
    piPoints,
    counts: { gwang: gw.length, yeol: yeol.length, tti: tti.length, pi },
  };
}

/** 고 보너스 적용: 1고 +1, 2고 +2, 3고부터는 (+2 후) 고 하나마다 ×2 */
export function applyGo(base: number, go: number): number {
  const bonus = Math.min(go, 2);
  const mul = 2 ** Math.max(0, go - 2);
  return (base + bonus) * mul;
}

// ───────────────────────────── 상태 · 행동 ─────────────────────────────

export type MatgoPhase = 'play' | 'choose' | 'gukjin' | 'goStop' | 'done';

export type MatgoAction =
  | { type: 'play'; card: string; shake?: boolean }
  | { type: 'bomb'; month: number }
  | { type: 'flip' }
  | { type: 'choose'; card: string }
  | { type: 'gukjin'; as: GukjinUse }
  | { type: 'go' }
  | { type: 'stop' };

export interface MatgoCarry {
  /** 다음 판 선 (자리 번호) */
  first: number;
  /** 다음 판 나가리 배수 (1, 2, 4, 8 …) */
  nagari: number;
}

/** 한 차례 진행 중 정보 (낸 패·뒤집은 패는 아직 바닥에 놓지 않고 여기 둔다) */
export interface TurnCtx {
  mode: 'play' | 'bomb' | 'filler';
  played: string[];
  /** 낸 패의 달 (폭탄 피면 null) */
  month: number | null;
  /** 낼 때 바닥에 있던 같은 달 패 */
  floorBefore: string[];
  /** 같은 달 2장 중 고른 패 */
  playPick: string | null;
  flipped: string | null;
  /** 뒤집은 패와 같은 달의 바닥 패 (낸 패와 다른 달일 때) */
  flipFloor: string[];
  flipPick: string | null;
}

export interface MatgoState {
  v: 1;
  /** idx → 자리 번호 */
  seats: number[];
  names: string[];
  kinds: SeatKind[];
  stacks: (number | null)[];
  baseUnit: number;
  /** 이번 판에 적용되는 나가리 배수 */
  nagariMul: number;
  /** 선 (idx) */
  first: number;
  phase: MatgoPhase;
  /** 지금 차례 (idx) */
  turn: number;
  hands: string[][];
  floor: string[];
  /** 더미 (앞이 맨 위) — 절대 view에 넣지 않는다 */
  pile: string[];
  captured: string[][];
  /** 판 중에 뻑이 나서 쌓인 달 */
  ppeok: number[];
  /** 이번 판에 각자 낸 뻑 횟수 (idx 순). 예전에 저장된 상태에는 없을 수 있다 */
  ppeokCount?: number[];
  /**
   * 이번 판에 각자 둔 차례 수 (idx 순): 패 내기·폭탄·폭탄 피 뒤집기를 한 번씩 센다. 예전에 저장된 상태에는 없다
   * (그런 판을 이어 두면 차례를 알 수 없으므로 그 뒤의 뻑에는 보너스가 붙지 않는다)
   */
  turns?: number[];
  /**
   * 뻑 보너스로 받을 몫 (idx 순, 기본금의 몇 배): 첫 차례 뻑 2, 이어서 둘째 차례에도 뻑이면 +3.
   * 예전에 저장된 상태에는 없다 → 그 판에서 이미 난 뻑은 그때 규칙(횟수 기준: 첫 뻑 2, 두 번째 3)으로 셈한다
   */
  ppeokUnits?: number[];
  /** 삼뻑으로 이긴 사람 (idx). 없으면 null */
  samPpeok?: number | null;
  gukjinAs: GukjinUse | null;
  go: number[];
  /** 마지막 고 때 점수 (이보다 올라야 다시 고/스톱을 묻는다) */
  goScore: number[];
  shakes: number[];
  bombs: number[];
  /** 남은 폭탄 피 (손패 없이 뒤집기만 하는 차례) */
  fill: number[];
  ctx: TurnCtx | null;
  /** 'choose' 단계의 선택지 */
  choice: { stage: 'play' | 'flip'; options: string[] } | null;
  chongtong: { idx: number; month: number } | null;
  /** 이긴 사람 (idx). 나가리·진행 중이면 null */
  winner: number | null;
  /** 바닥 4장 때문에 다시 섞은 횟수 */
  redeals: number;
  events: GameEvent[];
  evSeq: number;
  /**
   * 혼자 하는 판(사람 1명 + AI)을 기기에서 진행할 때 싣는 값 (solo.ts: 씨앗과 지금까지의 행동 수).
   * 엔진은 건드리지 않고 그대로 넘긴다 (apply 는 상태를 통째로 복사한다). 절대 view 에 넣지 않는다
   */
  solo?: { seed: number; n: number };
}

// ───────────────────────────── 화면 ─────────────────────────────

export interface FloorGroup {
  month: number;
  cards: string[];
  /** 같은 달 3장이 쌓여 있음 (뻑 또는 처음부터 3장) */
  stacked: boolean;
  /** 판 중에 생긴 뻑 더미 (먹으면 피 1장) */
  ppeok: boolean;
}

export interface CapturedGroups {
  gwang: string[];
  yeol: string[];
  tti: string[];
  pi: string[];
}

export interface MatgoPlayerPublic {
  seat: number;
  name: string;
  kind: SeatKind;
  captured: CapturedGroups;
  score: number;
  breakdown: ScoreLine[];
  /** 피 장수 (쌍피 2장) */
  piCount: number;
  go: number;
  shakes: number;
  bombs: number;
  handCount: number;
  bombFill: number;
  /** 이번 판에 낸 뻑 횟수 (세 번이면 삼뻑) */
  ppeok: number;
  /** 뻑 보너스로 받을 몫 (기본금의 몇 배: 첫뻑 2, 연뻑까지 5, 없으면 0) */
  ppeokBonus: number;
  /** 이번 판에 둔 차례 수 (예전 상태에서 이어 온 판이면 null) */
  turns: number | null;
}

export type MatgoChoice =
  | { kind: 'play'; seat: number; canFlip: boolean }
  | { kind: 'choose'; seat: number; stage: 'play' | 'flip'; options: string[] }
  | { kind: 'gukjin'; seat: number }
  | { kind: 'goStop'; seat: number; score: number; go: number };

export interface MatgoSummary {
  result: 'win' | 'nagari';
  winner: number | null;
  loser: number | null;
  chongtong: boolean;
  breakdown: ScoreLine[];
  baseScore: number;
  goCount: number;
  goBonus: number;
  goMultiplier: number;
  /** 고 보너스까지 반영한 최종 점수 */
  score: number;
  multipliers: string[];
  multiplier: number;
  baseUnit: number;
  amount: number;
  /** 실제로 오간 금액 (뻑 보너스 포함, 내는 사람이 가진 만큼까지) */
  paid: number;
  nextNagari: number;
  /** 삼뻑(세 번째 뻑)으로 끝난 판 */
  samPpeok: boolean;
  /**
   * 뻑: 뻑을 낸 자리마다 횟수와 보너스로 받을 금액 (첫 차례 뻑 = 첫뻑 기본금 ×2, 이어서 둘째 차례 뻑 = 연뻑 ×3. 그 밖의 뻑은 0).
   * units = 기본금의 몇 배인가 (0 · 2 · 5). 예전 판 결과에는 없을 수 있다
   */
  ppeoks: { seat: number; count: number; bonus: number; units?: number }[];
  /** 자리별 최종 증감 (점수 금액 + 뻑 보너스, 내는 사람이 가진 만큼까지) */
  net: Record<number, number>;
}

/** 뻑 보너스 배수: 첫뻑(자기 첫 차례의 뻑) ×2, 연뻑(이어서 둘째 차례에도 뻑) ×3 */
export const PPEOK_BONUS = [2, 3] as const;
/** 삼뻑 승리 점수 */
export const SAM_PPEOK_SCORE = 7;
/**
 * 예전 규칙 (횟수 기준: 첫 뻑 2, 두 번째 3) — 새 칸(ppeokUnits)이 없는 예전 저장 상태를 셈할 때만 쓴다.
 * 뻑 횟수 → 받을 보너스 (기본금의 몇 배인가)
 */
export function ppeokBonusUnits(count: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(count, PPEOK_BONUS.length); i++) n += PPEOK_BONUS[i];
  return n;
}

/**
 * 이번 뻑에 붙는 보너스 (기본금의 몇 배).
 * turn = 그 사람의 몇 번째 차례에 난 뻑인가 (모르면 null), before = 그 사람이 앞서 낸 뻑 횟수, units = 그 사람이 이미 받은 몫
 *   첫 차례의 뻑 → 첫뻑 2 · 첫뻑을 낸 사람의 둘째 차례 뻑 → 연뻑 3 · 그 밖 → 0
 */
export function ppeokBonusFor(turn: number | null, before: number, units: number): number {
  if (turn === 1 && before === 0) return PPEOK_BONUS[0];
  if (turn === 2 && before === 1 && units === PPEOK_BONUS[0]) return PPEOK_BONUS[1];
  return 0;
}

export interface MatgoPublic {
  phase: MatgoPhase;
  /** 지금 행동할 자리 (끝났으면 null) */
  turn: number | null;
  first: number;
  seats: number[];
  floor: FloorGroup[];
  players: Record<number, MatgoPlayerPublic>;
  pileCount: number;
  nagariMul: number;
  gukjinAs: GukjinUse | null;
  /** 이번 차례에 낸 패·뒤집은 패 (선택 대기 중일 때) */
  turnCards: { played: string[]; flipped: string | null } | null;
  choice: MatgoChoice | null;
  events: GameEvent[];
  result: MatgoSummary | null;
}

export interface MatgoPrivate {
  hand: string[];
  /** 흔들 수 있는 달 (손에 3장, 바닥 0장) */
  shakeable: number[];
  /** 폭탄 가능한 달 (손에 3장, 바닥 1장) */
  bombable: number[];
}

// ───────────────────────────── 도우미 ─────────────────────────────

const MAX_EVENTS = 30;

function ev(s: MatgoState, t: string, idx: number | null, data: Record<string, unknown> = {}): void {
  s.evSeq += 1;
  const e: GameEvent = { id: s.evSeq, t, ...data };
  if (idx !== null) e.seat = s.seats[idx];
  s.events.push(e);
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}

const sameMonth = (ids: readonly string[], m: number) => ids.filter((id) => monthOf(id) === m);
const outOfCards = (s: MatgoState, i: number) => s.hands[i].length === 0 && s.fill[i] === 0;

/** 두 카드가 완전히 같은 가치인가 (같으면 고를 필요가 없다) */
function equivalent(a: string, b: string): boolean {
  const x = cardById(a), y = cardById(b);
  return (
    x.kind === y.kind && x.ssangpi === y.ssangpi && x.dan === y.dan && x.godori === y.godori &&
    x.bigwang === y.bigwang && x.gukjin === y.gukjin
  );
}

function shakeableMonths(hand: string[], floor: string[]): number[] {
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) if (sameMonth(hand, m).length === 3 && sameMonth(floor, m).length === 0) out.push(m);
  return out;
}
function bombableMonths(hand: string[], floor: string[]): number[] {
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) if (sameMonth(hand, m).length === 3 && sameMonth(floor, m).length === 1) out.push(m);
  return out;
}

// ───────────────────────────── 시작 ─────────────────────────────

export interface Deal {
  hands: [string[], string[]];
  floor: string[];
  pile: string[];
}

/**
 * 섞인 48장으로 패 나누기: 앞 10장 = 첫째 자리 손패, 다음 10장 = 둘째 자리, 다음 8장 = 바닥, 나머지 20장 = 더미.
 * 바닥에 같은 달 4장이 깔리면 무효(null) → 다시 섞는다.
 */
export function dealOrder(order: readonly string[]): Deal | null {
  if (order.length !== 48) throw new EngineError('카드는 48장이어야 합니다');
  const floor = order.slice(20, 28);
  for (let m = 1; m <= 12; m++) if (sameMonth(floor, m).length === 4) return null;
  return { hands: [order.slice(0, 10), order.slice(10, 20)], floor, pile: order.slice(28) };
}

interface SetupOpts {
  seats: SeatInfo[];
  baseUnit: number;
  nagariMul: number;
  first: number;
  turn: number;
  hands: string[][];
  floor: string[];
  pile: string[];
  captured: string[][];
  redeals: number;
}

function setup(o: SetupOpts): MatgoState {
  if (o.seats.length !== 2) throw new EngineError('맞고는 2명이 합니다');
  const s: MatgoState = {
    v: 1,
    seats: o.seats.map((x) => x.seat),
    names: o.seats.map((x) => x.name),
    kinds: o.seats.map((x) => x.kind),
    stacks: o.seats.map((x) => x.stack),
    baseUnit: o.baseUnit,
    nagariMul: o.nagariMul,
    first: o.first,
    phase: 'play',
    turn: o.turn,
    hands: o.hands.map((h) => h.slice()),
    floor: o.floor.slice(),
    pile: o.pile.slice(),
    captured: o.captured.map((c) => c.slice()),
    ppeok: [],
    ppeokCount: [0, 0],
    turns: [0, 0],
    ppeokUnits: [0, 0],
    samPpeok: null,
    gukjinAs: null,
    go: [0, 0],
    goScore: [0, 0],
    shakes: [0, 0],
    bombs: [0, 0],
    fill: [0, 0],
    ctx: null,
    choice: null,
    chongtong: null,
    winner: null,
    redeals: o.redeals,
    events: [],
    evSeq: 0,
  };
  // 총통: 처음 받은 손패에 같은 달 4장 → 즉시 승리 (둘 다면 선 우선)
  for (const i of [o.first, 1 - o.first]) {
    for (let m = 1; m <= 12; m++) {
      const four = sameMonth(s.hands[i], m);
      if (four.length === 4) {
        s.chongtong = { idx: i, month: m };
        s.winner = i;
        s.phase = 'done';
        ev(s, 'chongtong', i, { month: m, cards: four });
        return s;
      }
    }
  }
  return s;
}

/** 테스트용: 손패·바닥·더미를 직접 정해 상태 만들기 (총통 판정은 실제와 같이 한다) */
export interface MatgoTestSetup {
  hands: [string[], string[]];
  floor: string[];
  pile: string[];
  captured?: [string[], string[]];
  /** 차례 (idx 0/1, 기본 0) */
  turn?: number;
  /** 선 (idx 0/1, 기본 turn) */
  first?: number;
  seats?: SeatInfo[];
  baseUnit?: number;
  nagariMul?: number;
  go?: [number, number];
  goScore?: [number, number];
  ppeok?: number[];
  /** 이번 판에 각자 이미 낸 뻑 횟수 */
  ppeokCount?: [number, number];
  /** 이번 판에 각자 이미 둔 차례 수 (기본 0) */
  turns?: [number, number];
  /** 각자 이미 받은 뻑 보너스 몫 (기본금의 몇 배, 기본 0) */
  ppeokUnits?: [number, number];
  gukjinAs?: GukjinUse | null;
  fill?: [number, number];
}

export function makeTestState(o: MatgoTestSetup): MatgoState {
  const all = [...o.hands[0], ...o.hands[1], ...o.floor, ...o.pile, ...(o.captured?.[0] ?? []), ...(o.captured?.[1] ?? [])];
  all.forEach(cardById);
  if (new Set(all).size !== all.length) throw new EngineError('카드가 중복되었습니다');
  const turn = o.turn ?? 0;
  const s = setup({
    seats: o.seats ?? [
      { seat: 0, kind: 'human', name: '나', stack: null },
      { seat: 1, kind: 'ai', name: 'AI 호랑이', stack: null },
    ],
    baseUnit: o.baseUnit ?? 100,
    nagariMul: o.nagariMul ?? 1,
    first: o.first ?? turn,
    turn,
    hands: o.hands,
    floor: o.floor,
    pile: o.pile,
    captured: o.captured ?? [[], []],
    redeals: 0,
  });
  if (o.go) s.go = o.go.slice();
  if (o.goScore) s.goScore = o.goScore.slice();
  if (o.ppeok) s.ppeok = o.ppeok.slice();
  if (o.ppeokCount) s.ppeokCount = o.ppeokCount.slice();
  if (o.turns) s.turns = o.turns.slice();
  if (o.ppeokUnits) s.ppeokUnits = o.ppeokUnits.slice();
  if (o.gukjinAs !== undefined) s.gukjinAs = o.gukjinAs;
  if (o.fill) s.fill = o.fill.slice();
  return s;
}

// ───────────────────────────── 진행 ─────────────────────────────

function idxOf(s: MatgoState, seat: number): number {
  const i = s.seats.indexOf(seat);
  if (i < 0) throw new EngineError(`없는 자리: ${seat}`);
  return i;
}

/** 상대 피 1장 빼앗기: 일반 피 → 없으면 쌍피(국진 쌍피 포함) → 없으면 없음 */
function stealPi(s: MatgoState, thief: number, reason: string): void {
  const victim = 1 - thief;
  const cap = s.captured[victim];
  const normal = cap.find((id) => {
    const c = cardById(id);
    return c.kind === 'pi' && !c.ssangpi;
  });
  const ssang = cap.find((id) => {
    const c = cardById(id);
    return c.ssangpi || (c.gukjin && s.gukjinAs === 'ssangpi');
  });
  const id = normal ?? ssang;
  if (!id) return;
  s.captured[victim] = cap.filter((x) => x !== id);
  s.captured[thief].push(id);
  ev(s, 'steal', thief, { from: s.seats[victim], card: id, reason });
}

function doPlay(s: MatgoState, me: number, a: MatgoAction): void {
  const hand = s.hands[me];
  if (a.type === 'play') {
    if (!hand.includes(a.card)) throw new EngineError('손에 없는 패입니다');
    const m = monthOf(a.card);
    const floorM = sameMonth(s.floor, m);
    if (a.shake) {
      const three = sameMonth(hand, m);
      if (three.length !== 3 || floorM.length !== 0) throw new EngineError('흔들 수 없는 패입니다');
      s.shakes[me] += 1;
      ev(s, 'shake', me, { month: m, cards: three });
    }
    s.hands[me] = hand.filter((x) => x !== a.card);
    s.ctx = { mode: 'play', played: [a.card], month: m, floorBefore: floorM, playPick: null, flipped: null, flipFloor: [], flipPick: null };
    ev(s, 'play', me, { cards: [a.card] });
    if (floorM.length === 2) {
      if (!equivalent(floorM[0], floorM[1])) {
        s.phase = 'choose';
        s.choice = { stage: 'play', options: floorM };
        return;
      }
      s.ctx.playPick = floorM[0];
    }
    doFlip(s, me);
  } else if (a.type === 'bomb') {
    const three = sameMonth(hand, a.month);
    const floorM = sameMonth(s.floor, a.month);
    if (three.length !== 3 || floorM.length !== 1) throw new EngineError('폭탄을 낼 수 없습니다');
    s.hands[me] = hand.filter((x) => !three.includes(x));
    s.bombs[me] += 1;
    s.fill[me] += 2;
    s.ctx = { mode: 'bomb', played: three, month: a.month, floorBefore: floorM, playPick: null, flipped: null, flipFloor: [], flipPick: null };
    ev(s, 'bomb', me, { month: a.month, cards: three });
    doFlip(s, me);
  } else if (a.type === 'flip') {
    if (s.fill[me] <= 0) throw new EngineError('폭탄 피가 없습니다');
    s.fill[me] -= 1;
    s.ctx = { mode: 'filler', played: [], month: null, floorBefore: [], playPick: null, flipped: null, flipFloor: [], flipPick: null };
    doFlip(s, me);
  } else {
    throw new EngineError('지금은 패를 낼 차례입니다');
  }
}

function doFlip(s: MatgoState, me: number): void {
  const c = s.ctx!;
  const f = s.pile.shift();
  if (f === undefined) return finalize(s, me);
  c.flipped = f;
  ev(s, 'flip', me, { card: f });
  const fm = monthOf(f);
  if (fm === c.month) return finalize(s, me);
  c.flipFloor = sameMonth(s.floor, fm);
  if (c.flipFloor.length === 2) {
    if (!equivalent(c.flipFloor[0], c.flipFloor[1])) {
      s.phase = 'choose';
      s.choice = { stage: 'flip', options: c.flipFloor.slice() };
      return;
    }
    c.flipPick = c.flipFloor[0];
  }
  finalize(s, me);
}

/** 차례 마무리: 먹기·뻑·쪽·따닥·쓸·피 빼앗기 */
function finalize(s: MatgoState, me: number): void {
  const c = s.ctx!;
  const take: string[] = [];
  const toFloor: string[] = [];
  const steals: string[] = [];
  const eatPpeok = (m: number) => {
    if (s.ppeok.includes(m)) {
      s.ppeok = s.ppeok.filter((x) => x !== m);
      ev(s, 'ppeok_eat', me, { month: m });
      steals.push('뻑 먹기');
    }
  };
  const flipSame = c.flipped !== null && monthOf(c.flipped) === c.month;
  let sam = false;

  if (c.mode === 'bomb') {
    take.push(...c.played, ...c.floorBefore);
    steals.push('폭탄');
  } else if (c.mode === 'play') {
    const P = c.played[0];
    const k = c.floorBefore.length;
    const m = c.month!;
    if (flipSame) {
      const F = c.flipped!;
      if (k === 0) {
        take.push(P, F);
        ev(s, 'jjok', me, { month: m });
        steals.push('쪽');
      } else if (k === 1) {
        toFloor.push(P, F);
        s.ppeok.push(m);
        const counts = s.ppeokCount ?? [0, 0];
        // 예전 저장 상태(새 칸 없음): 이미 난 뻑은 그때 규칙대로 셈해 두고, 차례를 모르므로 이번 뻑에는 보너스가 없다
        const units = s.ppeokUnits ?? counts.map(ppeokBonusUnits);
        const bonus = ppeokBonusFor(s.turns ? s.turns[me] : null, counts[me], units[me]);
        units[me] += bonus;
        counts[me] += 1;
        s.ppeokCount = counts;
        s.ppeokUnits = units;
        // count: 이 사람이 이번 판에 낸 몇 번째 뻑인가 (3이면 삼뻑 승리) · bonus: 이번 뻑에 붙은 보너스 (첫뻑 2 · 연뻑 3 · 없으면 0)
        ev(s, 'ppeok', me, { month: m, count: counts[me], bonus });
        sam = counts[me] >= 3;
      } else {
        take.push(P, F, ...c.floorBefore);
        ev(s, 'ttadak', me, { month: m });
        steals.push('따닥');
        eatPpeok(m);
      }
    } else if (k === 0) toFloor.push(P);
    else if (k === 1) take.push(P, c.floorBefore[0]);
    else if (k === 2) take.push(P, c.playPick!);
    else {
      take.push(P, ...c.floorBefore);
      eatPpeok(m);
    }
  }

  if (c.flipped !== null && !flipSame) {
    const F = c.flipped;
    const j = c.flipFloor.length;
    if (j === 0) toFloor.push(F);
    else if (j === 1) take.push(F, c.flipFloor[0]);
    else if (j === 2) take.push(F, c.flipPick!);
    else {
      take.push(F, ...c.flipFloor);
      eatPpeok(monthOf(F));
    }
  }

  s.floor = s.floor.filter((id) => !take.includes(id)).concat(toFloor);
  s.captured[me].push(...take);
  if (take.length > 0) ev(s, 'capture', me, { cards: take });
  if (take.length > 0 && s.floor.length === 0) {
    ev(s, 'sseul', me);
    steals.push('쓸');
  }
  for (const r of steals) stealPi(s, me, r);

  s.ctx = null;
  s.choice = null;
  if (sam) {
    // 삼뻑: 그 자리에서 승리
    s.phase = 'done';
    s.winner = me;
    s.samPpeok = me;
    ev(s, 'samppeok', me);
    return;
  }
  if (take.includes(GUKJIN_ID) && s.gukjinAs === null) {
    s.phase = 'gukjin';
    return;
  }
  afterTurn(s, me);
}

function afterTurn(s: MatgoState, me: number): void {
  s.phase = 'play';
  const sc = scoreCards(s.captured[me], s.gukjinAs).total;
  if (sc >= 7 && sc > s.goScore[me]) {
    if (outOfCards(s, me)) return finish(s, me, true);
    s.phase = 'goStop';
    return;
  }
  nextTurn(s, me);
}

function nextTurn(s: MatgoState, me: number): void {
  const other = 1 - me;
  if (outOfCards(s, me) && outOfCards(s, other)) {
    s.phase = 'done';
    s.winner = null;
    ev(s, 'nagari', null, { next: s.nagariMul * 2 });
    return;
  }
  s.phase = 'play';
  s.turn = outOfCards(s, other) ? me : other;
}

function finish(s: MatgoState, w: number, auto: boolean): void {
  s.phase = 'done';
  s.winner = w;
  const sc = scoreCards(s.captured[w], s.gukjinAs).total;
  ev(s, 'stop', w, { score: sc, auto });
  const sum = summarize(s)!;
  const loser = 1 - w;
  const map: Record<string, string> = { 피박: 'pibak', 광박: 'gwangbak', 멍박: 'meongbak', 고박: 'gobak' };
  for (const label of sum.multipliers) if (map[label]) ev(s, map[label], loser);
}

// ───────────────────────────── 정산 ─────────────────────────────

/** 뻑 보너스와 최종 증감: 점수 금액(amount, 이긴 사람 w)에 뻑 보너스를 더하고, 내는 사람이 가진 만큼까지만 */
function ppeokSettle(s: MatgoState, w: number | null, amount: number) {
  const counts = s.ppeokCount ?? [0, 0];
  // 예전 저장 상태(새 칸 없음)는 그때 규칙(횟수 기준)으로
  const units = s.ppeokUnits ?? counts.map(ppeokBonusUnits);
  const bonus = units.map((n) => n * s.baseUnit);
  const ppeoks = s.seats.map((seat, i) => ({ seat, count: counts[i], bonus: bonus[i], units: units[i] })).filter((x) => x.count > 0);
  // 첫째 자리(idx 0)가 받는 금액 (음수면 낸다)
  let d0 = bonus[0] - bonus[1] + (w === 0 ? amount : w === 1 ? -amount : 0);
  const cap = (stack: number | null, v: number) => (stack === null ? v : Math.min(v, Math.max(0, stack)));
  d0 = d0 < 0 ? -cap(s.stacks[0], -d0) : cap(s.stacks[1], d0);
  const net: Record<number, number> = { [s.seats[0]]: d0 === 0 ? 0 : d0, [s.seats[1]]: d0 === 0 ? 0 : -d0 };
  return { ppeoks, net, paid: Math.abs(d0) };
}

function summarize(s: MatgoState): MatgoSummary | null {
  if (s.phase !== 'done') return null;
  if (s.winner === null) {
    return {
      result: 'nagari', winner: null, loser: null, chongtong: false, breakdown: [], baseScore: 0, goCount: 0,
      goBonus: 0, goMultiplier: 1, score: 0, multipliers: [], multiplier: 1, baseUnit: s.baseUnit, amount: 0,
      nextNagari: s.nagariMul * 2, samPpeok: false, ...ppeokSettle(s, null, 0),
    };
  }
  const w = s.winner, l = 1 - w;
  const multipliers: string[] = [];
  let multiplier = 1;
  const mul = (label: string, x: number) => {
    multipliers.push(label);
    multiplier *= x;
  };
  let breakdown: ScoreLine[];
  let baseScore: number, goCount = 0, goBonus = 0, goMultiplier = 1, score: number;

  const sam = s.samPpeok === w;
  if (sam) {
    breakdown = [{ label: '삼뻑', points: SAM_PPEOK_SCORE }];
    baseScore = score = SAM_PPEOK_SCORE;
  } else if (s.chongtong) {
    breakdown = [{ label: '총통', points: 7 }];
    baseScore = score = 7;
  } else {
    const ws = scoreCards(s.captured[w], s.gukjinAs);
    const ls = scoreCards(s.captured[l], s.gukjinAs);
    breakdown = ws.lines.slice();
    baseScore = ws.total;
    goCount = s.go[w];
    goBonus = Math.min(goCount, 2);
    goMultiplier = 2 ** Math.max(0, goCount - 2);
    if (goBonus > 0) breakdown.push({ label: `${goCount}고`, points: goBonus });
    score = applyGo(baseScore, goCount);
    if (ws.piPoints > 0 && ls.counts.pi >= 1 && ls.counts.pi <= 7) mul('피박', 2);
    if (ws.gwangPoints > 0 && ls.counts.gwang === 0) mul('광박', 2);
    if (ws.counts.yeol >= 7) mul('멍박', 2);
    if (s.go[l] > 0) mul('고박', 2);
    if (goMultiplier > 1) multipliers.push(`${goCount}고 ×${goMultiplier}`); // 점수에 이미 반영 (표시용)
  }
  // 삼뻑 승리는 다른 배수 없이 7점
  if (!sam) {
    for (let i = 0; i < s.shakes[0] + s.shakes[1]; i++) mul('흔들기', 2);
    for (let i = 0; i < s.bombs[0] + s.bombs[1]; i++) mul('폭탄', 2);
    if (s.nagariMul > 1) mul(`나가리 ×${s.nagariMul}`, s.nagariMul);
  }

  const amount = score * s.baseUnit * multiplier;
  return {
    result: 'win', winner: s.seats[w], loser: s.seats[l], chongtong: !sam && s.chongtong !== null, breakdown, baseScore,
    goCount, goBonus, goMultiplier, score, multipliers, multiplier, baseUnit: s.baseUnit, amount, nextNagari: 1,
    samPpeok: sam, ...ppeokSettle(s, w, amount),
  };
}

// ───────────────────────────── 화면 ─────────────────────────────

function groupCaptured(ids: string[], gukjinAs: GukjinUse | null): CapturedGroups {
  const g: CapturedGroups = { gwang: [], yeol: [], tti: [], pi: [] };
  for (const id of ids) g[effKind(cardById(id), gukjinAs)].push(id);
  return g;
}

function publicView(s: MatgoState): MatgoPublic {
  const players: Record<number, MatgoPlayerPublic> = {};
  s.seats.forEach((seat, i) => {
    const sc = scoreCards(s.captured[i], s.gukjinAs);
    players[seat] = {
      seat, name: s.names[i], kind: s.kinds[i], captured: groupCaptured(s.captured[i], s.gukjinAs),
      score: sc.total, breakdown: sc.lines, piCount: sc.counts.pi, go: s.go[i], shakes: s.shakes[i],
      bombs: s.bombs[i], handCount: s.hands[i].length, bombFill: s.fill[i], ppeok: s.ppeokCount?.[i] ?? 0,
      ppeokBonus: (s.ppeokUnits ?? (s.ppeokCount ?? [0, 0]).map(ppeokBonusUnits))[i] ?? 0, turns: s.turns?.[i] ?? null,
    };
  });
  const floor: FloorGroup[] = [];
  for (let m = 1; m <= 12; m++) {
    const cards = sameMonth(s.floor, m);
    if (cards.length) floor.push({ month: m, cards, stacked: cards.length >= 3, ppeok: s.ppeok.includes(m) });
  }
  const seat = s.seats[s.turn];
  let choice: MatgoChoice | null = null;
  if (s.phase === 'play') choice = { kind: 'play', seat, canFlip: s.fill[s.turn] > 0 };
  else if (s.phase === 'choose') choice = { kind: 'choose', seat, stage: s.choice!.stage, options: s.choice!.options.slice() };
  else if (s.phase === 'gukjin') choice = { kind: 'gukjin', seat };
  else if (s.phase === 'goStop') {
    choice = { kind: 'goStop', seat, score: scoreCards(s.captured[s.turn], s.gukjinAs).total, go: s.go[s.turn] };
  }
  return {
    phase: s.phase,
    turn: s.phase === 'done' ? null : seat,
    first: s.seats[s.first],
    seats: s.seats.slice(),
    floor,
    players,
    pileCount: s.pile.length,
    nagariMul: s.nagariMul,
    gukjinAs: s.gukjinAs,
    turnCards: s.ctx ? { played: s.ctx.played.slice(), flipped: s.ctx.flipped } : null,
    choice,
    events: clone(s.events),
    result: summarize(s),
  };
}

// ───────────────────────────── AI (보통) ─────────────────────────────

const flatCaptured = (g: CapturedGroups) => [...g.gwang, ...g.yeol, ...g.tti, ...g.pi];

/** 카드 가치: 광 > 고도리·단 완성 > 쌍피 > 피, 상대가 노리는 패는 가로채기 가산 */
function cardValue(id: string, mine: string[], opp: string[]): number {
  const c = cardById(id);
  let v = 0;
  const count = (ids: string[], f: (x: MatgoCard) => boolean) => ids.filter((x) => f(cardById(x))).length;
  if (c.kind === 'gwang') {
    v = c.bigwang ? 6 : 9;
    if (count(mine, (x) => x.kind === 'gwang') >= 2) v += 3;
    if (count(opp, (x) => x.kind === 'gwang') >= 2) v += 4;
  } else if (c.kind === 'yeol') {
    v = c.gukjin ? 2.5 : 1.5;
    if (c.godori) {
      v = 3;
      const my = count(mine, (x) => x.godori), op = count(opp, (x) => x.godori);
      if (my === 2) v += 5;
      else if (my === 1) v += 1;
      if (op === 2) v += 5;
    }
  } else if (c.kind === 'tti') {
    v = c.dan ? 2 : 1.2;
    if (c.dan) {
      const my = count(mine, (x) => x.dan === c.dan), op = count(opp, (x) => x.dan === c.dan);
      if (my === 2) v += 5;
      else if (my === 1) v += 1;
      if (op === 2) v += 5;
    }
  } else {
    v = c.ssangpi ? 2.5 : 1;
  }
  return v;
}

function aiPlay(pub: MatgoPublic, priv: MatgoPrivate, seat: number, rng: Rng): MatgoAction {
  const me = pub.players[seat];
  const oppSeat = pub.seats.find((x) => x !== seat)!;
  const op = pub.players[oppSeat];
  const mine = flatCaptured(me.captured), opp = flatCaptured(op.captured);
  const hand = priv.hand;
  if (hand.length === 0) return { type: 'flip' };
  const floorOf = (m: number) => pub.floor.find((g) => g.month === m)?.cards ?? [];
  const val = (id: string) => cardValue(id, mine, opp);

  type Opt = { a: MatgoAction; score: number };
  const opts: Opt[] = [];
  for (const m of priv.bombable) {
    const ids = [...sameMonth(hand, m), ...floorOf(m)];
    opts.push({ a: { type: 'bomb', month: m }, score: 20 + ids.reduce((n, id) => n + val(id), 0) });
  }
  if (me.bombFill > 0) opts.push({ a: { type: 'flip' }, score: 0.2 });
  const seen = new Set([...mine, ...opp, ...pub.floor.flatMap((g) => g.cards), ...hand]);
  for (const id of hand) {
    const m = monthOf(id);
    const fl = floorOf(m);
    let score: number;
    if (fl.length === 0) score = -0.3 - 0.2 * val(id);
    else if (fl.length === 1) {
      score = val(id) + val(fl[0]);
      // 뻑: 이 달 패가 손에 이것뿐인데 아직 못 본 같은 달 패가 남아 있으면 뻑이 날 수 있다.
      // 뻑이 나면 먹을 패를 바닥에 쌓아 두게 된다(감점). 다만 보너스가 붙는 때 — 내 첫 차례(첫뻑 ×2), 첫뻑 뒤의 둘째 차례(연뻑 ×3) —
      // 에는 덜 피한다. 이미 두 번 냈으면 세 번째는 바로 승리(삼뻑)라 오히려 노린다
      const unseen = CARDS.filter((x) => x.month === m && !seen.has(x.id)).length;
      if (sameMonth(hand, m).length === 1) {
        const risk = unseen >= 2 ? 1 : unseen === 1 ? 1 / 3 : 0;
        const made = me.ppeok ?? 0;
        const bonus = ppeokBonusFor(typeof me.turns === 'number' ? me.turns + 1 : null, made, me.ppeokBonus ?? 0);
        score += risk * (made >= 2 ? 6 : bonus === PPEOK_BONUS[1] ? -1.5 : bonus === PPEOK_BONUS[0] ? -2.4 : -3);
      }
    } else if (fl.length === 2) score = val(id) + Math.max(...fl.map(val));
    else score = val(id) + fl.reduce((n, x) => n + val(x), 0) + 2;
    const shake = priv.shakeable.includes(m) && me.score >= op.score;
    opts.push({ a: shake ? { type: 'play', card: id, shake: true } : { type: 'play', card: id }, score });
  }
  // 약 15%는 최선이 아닌 아무 패
  if (rng.next() < 0.15) return opts[rng.int(opts.length)].a;
  let best = opts[0];
  for (const o of opts) if (o.score > best.score) best = o;
  return best.a;
}

function aiDecide(pub: MatgoPublic, priv: MatgoPrivate | undefined, seat: number, rng: Rng): MatgoAction {
  const ch = pub.choice;
  if (!ch || ch.seat !== seat) throw new EngineError('지금 행동할 차례가 아닙니다');
  const me = pub.players[seat];
  const oppSeat = pub.seats.find((x) => x !== seat)!;
  const op = pub.players[oppSeat];
  switch (ch.kind) {
    case 'goStop': {
      const handLeft = priv?.hand.length ?? 0;
      const stop = op.score >= 5 || handLeft <= 3 || me.go >= 2;
      return stop ? { type: 'stop' } : { type: 'go' };
    }
    case 'gukjin': {
      const mine = flatCaptured(me.captured);
      const y = scoreCards(mine, 'yeol').total, p = scoreCards(mine, 'ssangpi').total;
      return { type: 'gukjin', as: y > p ? 'yeol' : 'ssangpi' };
    }
    case 'choose': {
      const mine = flatCaptured(me.captured), opp = flatCaptured(op.captured);
      let best = ch.options[0];
      for (const id of ch.options) if (cardValue(id, mine, opp) > cardValue(best, mine, opp)) best = id;
      return { type: 'choose', card: best };
    }
    case 'play':
      if (!priv) throw new EngineError('손패 정보가 없습니다');
      return aiPlay(pub, priv, seat, rng);
  }
}

// ───────────────────────────── 엔진 ─────────────────────────────

export const matgo: Engine<MatgoState, MatgoAction, MatgoCarry, MatgoPublic, MatgoPrivate> = {
  game: 'matgo',

  newRound(input: RoundInput<MatgoCarry>): MatgoState {
    if (input.seats.length !== 2) throw new EngineError('맞고는 2명이 합니다');
    const ids = CARDS.map((c) => c.id);
    let deal: Deal | null = null;
    let redeals = 0;
    for (;;) {
      deal = dealOrder(shuffle(ids, input.rng));
      if (deal) break;
      redeals += 1;
    }
    const carryFirst = input.carry ? input.seats.findIndex((x) => x.seat === input.carry!.first) : -1;
    const first = carryFirst >= 0 ? carryFirst : input.rng.int(2);
    // 선이 먼저 받는다
    const hands = first === 0 ? deal.hands : [deal.hands[1], deal.hands[0]];
    return setup({
      seats: input.seats,
      baseUnit: input.baseUnit,
      nagariMul: Math.max(1, input.carry?.nagari ?? 1),
      first,
      turn: first,
      hands,
      floor: deal.floor,
      pile: deal.pile,
      captured: [[], []],
      redeals,
    });
  },

  pending(s: MatgoState): number[] {
    return s.phase === 'done' ? [] : [s.seats[s.turn]];
  },

  apply(s0: MatgoState, seat: number, action: MatgoAction, _rng: Rng): MatgoState {
    if (s0.phase === 'done') throw new EngineError('판이 끝났습니다');
    const me = idxOf(s0, seat);
    if (me !== s0.turn) throw new EngineError('차례가 아닙니다');
    const s = clone(s0);
    switch (s.phase) {
      case 'play':
        // 한 차례를 둔다 (패 내기 · 폭탄 · 폭탄 피 뒤집기). 규칙 위반이면 아래에서 던져져 이 복사본은 버려진다
        if (s.turns) s.turns[me] += 1;
        doPlay(s, me, action);
        break;
      case 'choose': {
        if (action.type !== 'choose') throw new EngineError('먹을 패를 골라야 합니다');
        if (!s.choice!.options.includes(action.card)) throw new EngineError('고를 수 없는 패입니다');
        const stage = s.choice!.stage;
        s.choice = null;
        s.phase = 'play';
        if (stage === 'play') {
          s.ctx!.playPick = action.card;
          doFlip(s, me);
        } else {
          s.ctx!.flipPick = action.card;
          finalize(s, me);
        }
        break;
      }
      case 'gukjin':
        if (action.type !== 'gukjin' || (action.as !== 'yeol' && action.as !== 'ssangpi')) {
          throw new EngineError('국진을 열끗/쌍피 중에서 골라야 합니다');
        }
        s.gukjinAs = action.as;
        ev(s, 'gukjin', me, { as: action.as });
        afterTurn(s, me);
        break;
      case 'goStop':
        if (action.type === 'go') {
          s.go[me] += 1;
          s.goScore[me] = scoreCards(s.captured[me], s.gukjinAs).total;
          ev(s, 'go', me, { count: s.go[me] });
          nextTurn(s, me);
        } else if (action.type === 'stop') {
          finish(s, me, false);
        } else throw new EngineError('고 또는 스톱을 골라야 합니다');
        break;
    }
    return s;
  },

  ai(pub, priv, seat, rng) {
    return aiDecide(pub, priv, seat, rng);
  },

  timeout(s, seat, rng) {
    if (!matgo.pending(s).includes(seat)) throw new EngineError('차례가 아닙니다');
    const v = matgo.view(s);
    return aiDecide(v.public, v.private[seat], seat, rng);
  },

  done(s) {
    return s.phase === 'done';
  },

  settle(s) {
    const sum = summarize(s);
    if (!sum) throw new EngineError('판이 아직 끝나지 않았습니다');
    const deltas: Record<number, number> = { [s.seats[0]]: sum.net[s.seats[0]] ?? 0, [s.seats[1]]: sum.net[s.seats[1]] ?? 0 };
    const carry: MatgoCarry =
      sum.winner === null ? { first: s.seats[s.first], nagari: s.nagariMul * 2 } : { first: sum.winner, nagari: 1 };
    return { deltas, summary: sum, carry };
  },

  view(s) {
    const priv: Record<number, MatgoPrivate> = {};
    s.seats.forEach((seat, i) => {
      priv[seat] = {
        hand: s.hands[i].slice(),
        shakeable: shakeableMonths(s.hands[i], s.floor),
        bombable: bombableMonths(s.hands[i], s.floor),
      };
    });
    return { public: publicView(s), private: priv };
  },
};
