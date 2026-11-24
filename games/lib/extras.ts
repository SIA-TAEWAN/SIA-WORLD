/**
 * 카드 게임 화면의 곁들이 기능에 쓰는 순수 계산 (화면·저장소를 건드리지 않는다 → vitest 로 검사: _shared/card-extras.test.ts).
 *   포커 힌트 · 홀덤 승률 도우미 · 블랙잭 오늘 기록/연승 · 룰렛 흐름 통계
 * 규칙 엔진의 결과는 바꾸지 않는다: 엔진의 순수 함수를 읽기만 한다.
 */
import { seededRng } from '../../supabase/functions/_shared/engine.ts';
import { HandCat, compareHands, draws, evaluate7, evaluateOpen } from '../../supabase/functions/_shared/poker.ts';
import { estimateEquity } from '../../supabase/functions/_shared/holdem.ts';
import { MULT, seasonCells, type BetKind, type RBet } from '../../supabase/functions/_shared/roulette.ts';
import { applyGo, cardById, scoreCards, type MatgoPlayerPublic, type MatgoPublic } from '../../supabase/functions/_shared/matgo.ts';
import { basicStrategy, cardPoint, type BjPlayAction } from '../../supabase/functions/_shared/blackjack.ts';

// ───────────────────────── 세븐포커: 한 줄 힌트 ─────────────────────────

/**
 * 내 패(비공개 + 공개, 3~6장)에서 한 장만 더 오면 되는 족보 → '플러시까지 1장' (없거나 더 받을 카드가 없으면 null).
 * 이미 그 족보 이상이면 말하지 않는다. 엔진 AI 가 쓰는 draws() 를 그대로 읽는다
 */
export function pokerHint(cards: readonly string[]): string | null {
  if (cards.length < 3 || cards.length >= 7) return null;
  const list = cards.slice();
  let cat: number;
  try {
    cat = (list.length >= 5 ? evaluate7(list) : evaluateOpen(list))?.cat ?? 0;
  } catch {
    return null;
  }
  const d = draws(list);
  // 높은 족보부터 (두 개까지만 말하므로, 낮은 것 때문에 풀하우스·포카드가 잘리지 않게)
  const want: string[] = [];
  if (cat === HandCat.TRIPS) want.push('포카드');
  if (cat === HandCat.TWO_PAIR) want.push('풀하우스');
  if (d.flush4 && cat < HandCat.FLUSH) want.push('플러시');
  if (d.straight4 && cat < HandCat.STRAIGHT) want.push('스트레이트');
  return want.length ? `${want.slice(0, 2).join('·')}까지 1장` : null;
}

// ───────────────────────── 홀덤: 승률 · 팟 오즈 도우미 ─────────────────────────

export interface HoldemAdvice {
  /** 이길 확률 추정 (0~1) */
  equity: number;
  /** 콜이 본전이 되는 최소 승률 (0~1). 낼 돈이 없으면 null */
  need: number | null;
}

const hashOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * 내 패 + 공개 정보(공용 카드 · 남은 상대 수 · 판돈 · 콜 금액)만으로 셈한다. 상대 패는 모른다고 보고 고르게 뽑는다
 * (엔진 AI 와 같은 estimateEquity). 같은 상황이면 늘 같은 값이 나오게 카드로 씨앗을 만든다 (다시 그려도 숫자가 흔들리지 않게)
 */
export function holdemAdvice(i: { hole: readonly string[]; board: readonly string[]; opponents: number; pot: number; call: number }, iters = 200): HoldemAdvice | null {
  if (i.hole.length !== 2 || i.board.length > 5) return null;
  const opp = Math.max(1, Math.min(8, Math.floor(i.opponents)));
  const rng = seededRng(hashOf(`${i.hole.join('')}|${i.board.join('')}|${opp}`));
  let equity: number;
  try {
    equity = estimateEquity(i.hole.slice(), i.board.slice(), opp, rng, iters);
  } catch {
    return null;
  }
  const need = potOddsNeed(i.pot, i.call);
  return { equity, need };
}

const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);

/**
 * '이길 확률 약 62% · 콜하려면 25% 이상'.
 * o.allIn: 올인 콜 — 내 칩이 모자라 남은 만큼만 내는 콜이라 판돈 가운데 내가 딸 수 있는 몫이 다르다 → 어림값이라고 적는다
 */
export function holdemAdviceText(a: HoldemAdvice, o: { allIn?: boolean; short?: boolean } = {}): string {
  const win = `이길 확률 약 ${pct(a.equity)}%`;
  // short: 좁은 조작부용 짧은 글 ('체크 가능')
  if (a.need === null) return `${win} · ${o.short ? '체크 가능' : '돈을 내지 않고 체크할 수 있어요'}`;
  return `${win} · 콜하려면 ${o.allIn ? '약 ' : ''}${pct(a.need)}% 이상`;
}

/** 판돈·콜 금액만으로 다시 셈하는 필요 승률 (승률 추정은 그대로 두고 이 값만 바꿔 끼운다) */
export const potOddsNeed = (pot: number, call: number): number | null => (call > 0 ? call / (Math.max(0, pot) + call) : null);

// ───────────────────────── 블랙잭: 오늘 기록 · 연승 ─────────────────────────

export interface BjDay {
  /** 기록한 날 (기기 날짜 YYYY-MM-DD) */
  day: string;
  rounds: number;
  /** 오늘 딴 칩 − 잃은 칩 */
  net: number;
  /** 오늘 블랙잭 횟수 */
  bj: number;
  /** 지금 이어지는 연승 (날이 바뀌어도 이어진다) */
  streak: number;
  /** 마지막으로 적은 판 ('방:판 번호') — 같은 판을 두 번 적지 않는다 */
  last: string;
}

export const bjDayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 저장해 둔 글(JSON)에서 오늘 기록 읽기. 깨졌거나 없으면 빈 기록, 날이 바뀌었으면 오늘 칸만 비운다 (연승은 이어 간다) */
export function bjLoad(raw: string | null, day: string): BjDay {
  let o: Partial<BjDay> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Partial<BjDay>;
  } catch {
    o = {};
  }
  const streak = Math.max(0, Math.floor(num(o.streak)));
  const last = typeof o.last === 'string' ? o.last : '';
  if (o.day !== day) return { day, rounds: 0, net: 0, bj: 0, streak, last };
  return { day, rounds: Math.max(0, Math.floor(num(o.rounds))), net: Math.round(num(o.net)), bj: Math.max(0, Math.floor(num(o.bj))), streak, last };
}

/** 연승 셈: 딴 판 +1 · 잃은 판 0 · 본전(무승부)은 그대로 */
export const nextStreak = (streak: number, delta: number) => (delta > 0 ? streak + 1 : delta < 0 ? 0 : streak);

/** 판 하나 적기 (이미 적은 판이면 그대로 돌려준다) */
export function bjRecord(s: BjDay, r: { key: string; delta: number; blackjacks: number }): BjDay {
  if (r.key && r.key === s.last) return s;
  return { day: s.day, rounds: s.rounds + 1, net: s.net + r.delta, bj: s.bj + Math.max(0, r.blackjacks), streak: nextStreak(s.streak, r.delta), last: r.key };
}

/**
 * 요즘 적은 판 열쇠들 (최근 12개). 끝난 판을 그릴 때마다 적으므로, 방을 오가다 예전 방의 끝난 판을 다시 보아도 두 번 적지 않게 기억해 둔다.
 * bjSeenLoad: 저장해 둔 글(JSON 배열) 읽기 (깨졌으면 빈 목록), bjSeenAdd: 열쇠 하나 더하기 (이미 있으면 그대로 돌려준다)
 */
export const BJ_SEEN_MAX = 12;
export function bjSeenLoad(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').slice(-BJ_SEEN_MAX) : [];
  } catch {
    return [];
  }
}
export function bjSeenAdd(seen: readonly string[], key: string): readonly string[] {
  return !key || seen.includes(key) ? seen : [...seen, key].slice(-BJ_SEEN_MAX);
}

/** '오늘 3판 · +1,200칩 · 블랙잭 1번' */
export function bjStrip(s: BjDay, fmt: (n: number) => string): string {
  const net = s.net > 0 ? `+${fmt(s.net)}` : s.net < 0 ? `-${fmt(-s.net)}` : '±0';
  return `오늘 ${s.rounds}판 · ${net}칩 · 블랙잭 ${s.bj}번`;
}

/** 같은 띠를 화면용 HTML 로: 손익을 <b> 로 감싼다 (잃었으면 class="minus"). 숫자·정해진 글자뿐이라 따로 이스케이프할 것이 없다 */
export function bjStripHtml(s: BjDay, fmt: (n: number) => string): string {
  const net = s.net > 0 ? `+${fmt(s.net)}` : s.net < 0 ? `-${fmt(-s.net)}` : '±0';
  return `오늘 ${s.rounds}판 · <b${s.net < 0 ? ' class="minus"' : ''}>${net}칩</b> · 블랙잭 ${s.bj}번`;
}

/** 이 연승에서 컷인을 띄우는가 (3 · 5연승) */
export const streakCutin = (streak: number): string | null => (streak === 3 || streak === 5 ? `${streak}연승!` : null);

// ───────────────────────── 룰렛: 흐름 통계 ─────────────────────────

export interface RouletteStats {
  /** 센 판 수 (공개 상태의 history: 최근 20판까지) */
  n: number;
  /** 띠(칸 0~11)별 나온 횟수 */
  counts: number[];
  /** 계절(봄·여름·가을·겨울)별 횟수 */
  seasons: number[];
  yang: number;
  yin: number;
  /** 띠별로 마지막에 나온 뒤 지난 판 수 (이 기록 안에 한 번도 없으면 n) */
  gaps: number[];
  /** 가장 오래 안 나온 띠 (기록이 없으면 null) */
  cold: { cell: number; gap: number } | null;
  /** 끝에서부터 이어지는 음양 (0 = 양, 1 = 음) */
  yyRun: { side: number; len: number } | null;
  /** 끝에서부터 이어지는 계절 */
  seasonRun: { season: number; len: number } | null;
  /** 끝에서부터 이어지는 같은 띠 */
  cellRun: { cell: number; len: number } | null;
}

/** 칸 → 계절 번호 (0 봄 … 3 겨울) */
export const seasonOfCell = (cell: number) => [0, 1, 2, 3].find((t) => seasonCells(t).includes(cell)) ?? 0;

const tailRun = (xs: readonly number[]) => {
  if (!xs.length) return null;
  const v = xs[xs.length - 1];
  let len = 0;
  for (let i = xs.length - 1; i >= 0 && xs[i] === v; i--) len++;
  return { v, len };
};

export function rouletteStats(history: readonly number[]): RouletteStats {
  const h = history.filter((x) => Number.isInteger(x) && x >= 0 && x < 12);
  const counts = Array<number>(12).fill(0);
  const seasons = Array<number>(4).fill(0);
  const gaps = Array<number>(12).fill(h.length);
  let yang = 0;
  h.forEach((cell, i) => {
    counts[cell]++;
    seasons[seasonOfCell(cell)]++;
    if (cell % 2 === 0) yang++;
    gaps[cell] = h.length - 1 - i;
  });
  let cold: RouletteStats['cold'] = null;
  if (h.length) for (let c = 0; c < 12; c++) if (!cold || gaps[c] > cold.gap) cold = { cell: c, gap: gaps[c] };
  const yy = tailRun(h.map((c) => c % 2));
  const sr = tailRun(h.map(seasonOfCell));
  const cr = tailRun(h);
  return {
    n: h.length,
    counts,
    seasons,
    yang,
    yin: h.length - yang,
    gaps,
    cold,
    yyRun: yy && { side: yy.v, len: yy.len },
    seasonRun: sr && { season: sr.v, len: sr.len },
    cellRun: cr && { cell: cr.v, len: cr.len },
  };
}

/** 비율(%) — 합이 0이면 0 */
export const share = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/**
 * 눈에 띄는 흐름 한 줄씩: '용 14판째 안 나옴' · '양 4연속' · '봄 3연속' · '쥐 2연속'.
 * names: 칸 → 띠 이름, seasonNames: 계절 이름. 지난 결과일 뿐 다음 결과와는 상관없다 (휠은 매번 고르게 뽑는다)
 */
export function rouletteNotes(s: RouletteStats, names: readonly string[], seasonNames: readonly string[]): string[] {
  const out: string[] = [];
  if (s.cellRun && s.cellRun.len >= 2) out.push(`${names[s.cellRun.cell]} ${s.cellRun.len}연속`);
  if (s.yyRun && s.yyRun.len >= 3) out.push(`${s.yyRun.side === 0 ? '양' : '음'} ${s.yyRun.len}연속`);
  if (s.seasonRun && s.seasonRun.len >= 3) out.push(`${seasonNames[s.seasonRun.season]} ${s.seasonRun.len}연속`);
  if (s.cold && s.cold.gap >= 8) out.push(`${names[s.cold.cell]} ${s.cold.gap}판째 안 나옴`);
  return out;
}

// ───────────────────────── 맞고: 고/스톱 판단 도우미 · 족보 진행 ─────────────────────────

const flatCap = (p: MatgoPlayerPublic) => [...p.captured.gwang, ...p.captured.yeol, ...p.captured.tti, ...p.captured.pi];

export interface MatgoStopPreview {
  /** 고 보너스까지 넣은 점수 */
  score: number;
  /** 붙는 배수 이름 ('피박' · '광박' · '멍박' · '고박' · '흔들기' · '폭탄' · '나가리 ×2') */
  multipliers: string[];
  multiplier: number;
  /** 점수 금액 = 점수 × 점당 × 배수 (엔진 summarize 의 amount 와 같은 식) */
  amount: number;
  /** 뻑 보너스까지 넣어 내가 받는 금액 (상대가 가진 냥이 모자라면 실제로는 그만큼까지만 받는다) */
  total: number;
}

/**
 * 지금 스톱하면 받을 금액 미리 보기 (seat 가 고/스톱을 고르는 중일 때). 공개 상태만으로 셈한다.
 * 식은 엔진(matgo.ts summarize)과 같다: (족보 점수 + 고 보너스) × 고 배수 × 점당 × 박·흔들기·폭탄·나가리 배수.
 * 엔진을 건드리지 않으려고 여기 따로 두고, 검사(card-extras.test.ts)가 실제로 스톱한 결과와 같은지 여러 판으로 견준다
 */
export function matgoStopPreview(pub: MatgoPublic, seat: number, baseUnit: number): MatgoStopPreview | null {
  const me = pub.players[seat];
  const oppSeat = pub.seats.find((x) => x !== seat);
  const opp = oppSeat === undefined ? undefined : pub.players[oppSeat];
  if (!me || !opp) return null;
  const ws = scoreCards(flatCap(me), pub.gukjinAs);
  const ls = scoreCards(flatCap(opp), pub.gukjinAs);
  const score = applyGo(ws.total, me.go);
  const multipliers: string[] = [];
  let multiplier = 1;
  const mul = (label: string, x: number) => {
    multipliers.push(label);
    multiplier *= x;
  };
  if (ws.piPoints > 0 && ls.counts.pi >= 1 && ls.counts.pi <= 7) mul('피박', 2);
  if (ws.gwangPoints > 0 && ls.counts.gwang === 0) mul('광박', 2);
  if (ws.counts.yeol >= 7) mul('멍박', 2);
  if (opp.go > 0) mul('고박', 2);
  for (let i = 0; i < me.shakes + opp.shakes; i++) mul('흔들기', 2);
  for (let i = 0; i < me.bombs + opp.bombs; i++) mul('폭탄', 2);
  if (pub.nagariMul > 1) mul(`나가리 ×${pub.nagariMul}`, pub.nagariMul);
  const amount = score * baseUnit * multiplier;
  return { score, multipliers, multiplier, amount, total: amount + ((me.ppeokBonus ?? 0) - (opp.ppeokBonus ?? 0)) * baseUnit };
}

/** 배수 이름을 짧게 모은다: ['피박','흔들기','흔들기'] → '피박 ×2 · 흔들기 ×4' */
export function matgoMulText(multipliers: readonly string[]): string {
  const m = new Map<string, number>();
  for (const x of multipliers) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([k, n]) => (k.includes('×') ? k : `${k} ×${2 ** n}`)).join(' · ');
}

/** 상대 위험 한 줄: '상대 5점 · 손패 3장' (+ '위험!' — 맞고는 7점부터 스톱할 수 있으므로 5점 이상이면 가깝다) */
export function matgoRiskText(opp: Pick<MatgoPlayerPublic, 'score' | 'handCount' | 'bombFill' | 'go'>): string {
  const left = opp.handCount + (opp.bombFill ?? 0);
  const near = opp.score >= 5 && left > 0;
  return `상대 ${opp.score}점${opp.go ? ` (${opp.go}고)` : ''} · 손패 ${left}장${left === 0 ? ' · 더 못 내요' : near ? ' · 위험!' : ''}`;
}

export interface MatgoChip {
  text: string;
  /** 박 경고 (분홍 꼬리표) */
  warn?: boolean;
}

/**
 * 자리 판에 붙일 족보 진행·박 경고 칸 (급한 것부터): '피 6장 · 피박 위험' · '광박 위험' · '고도리 2/3' · '청단 2/3' · '광 2장'.
 * 세 장 족보는 두 장을 모았고 남은 한 장을 상대가 먹지 않았을 때만 (이미 못 이루는 족보는 말하지 않는다).
 * 다 이룬 족보는 점수 내역에 나오므로 여기서는 뺀다
 */
export function matgoChips(me: MatgoPlayerPublic, opp: MatgoPlayerPublic): MatgoChip[] {
  const out: MatgoChip[] = [];
  const mine = flatCap(me).map(cardById);
  const theirs = flatCap(opp).map(cardById);
  // 박 경고: 상대가 그 족보로 점수를 냈거나 곧 낼 때
  if (me.piCount >= 1 && me.piCount <= 7 && opp.piCount >= 8) out.push({ text: `피 ${me.piCount}장 · 피박 위험`, warn: true });
  if (me.captured.gwang.length === 0 && opp.captured.gwang.length >= 2) out.push({ text: '광박 위험', warn: true });
  if (opp.captured.yeol.length >= 6) out.push({ text: '멍박 위험', warn: true });
  const set = (name: string, has: (c: (typeof mine)[number]) => boolean) => {
    const n = mine.filter(has).length;
    if (n === 2 && !theirs.some(has)) out.push({ text: `${name} 2/3` });
  };
  set('고도리', (c) => !!c.godori);
  set('홍단', (c) => c.dan === 'hong');
  set('청단', (c) => c.dan === 'cheong');
  set('초단', (c) => c.dan === 'cho');
  if (me.captured.gwang.length === 2) out.push({ text: '광 2장' });
  return out;
}

// ───────────────────────── 세븐포커: 판 요약 한 줄 ─────────────────────────

interface StoryEvent {
  t: string;
  seat?: number;
  [k: string]: unknown;
}
export interface PokerStoryInput {
  /** 이번 판의 사건 (오래된 것부터. 앞부분이 잘려 있어도 된다) */
  events: readonly StoryEvent[];
  /** winners = 모든 팟 승자의 합집합(자리 번호순)이라 동점 목록이 아니다. pots 가 있으면 그것으로 주인공·동점을 정한다 */
  summary: {
    cancelled: boolean;
    uncontested: boolean;
    winners: number[];
    hands: Record<number, { name: string }>;
    pots?: readonly { eligible: readonly number[]; winners: readonly number[] }[];
  } | null;
  /** 쇼다운한 자리의 7장 (엔진 순서: 비공개 2장 · 7구 히든 · 공개 4장) */
  showdown?: readonly { seat: number; cards: readonly string[] }[] | null;
  nameOf(seat: number): string;
  /** 무혈 승리한 사람의 패가 약했는지 아는 경우 (내 패일 때만 안다): true 면 '뻥카' */
  bluff?: boolean;
}

const RAISES: Record<string, string> = { bbing: '삥', ddadang: '따당', half: '하프' };

/** 6구까지의 족보로 앞서던 자리들 (7구 히든 = cards[2] 를 뺀 6장) */
function leadersBefore7(showdown: readonly { seat: number; cards: readonly string[] }[]): number[] | null {
  if (showdown.length < 2 || showdown.some((h) => h.cards.length !== 7)) return null;
  try {
    const vals = showdown.map((h) => ({ seat: h.seat, v: evaluate7(h.cards.filter((_, i) => i !== 2)) }));
    let best = vals[0];
    for (const x of vals) if (compareHands(x.v, best.v) > 0) best = x;
    return vals.filter((x) => compareHands(x.v, best.v) === 0).map((x) => x.seat);
  } catch {
    return null;
  }
}

/**
 * 판 결과 창 한 줄: '어흥이의 하프에 2명 다이' · '7구 역전! 깡총이의 플러시' · '올인 승부! …' (없으면 null).
 * 사건(events)과 결과 요약(summary), 쇼다운 카드만으로 셈한다
 */
export function pokerStory(i: PokerStoryInput): string | null {
  const r = i.summary;
  if (!r || r.cancelled || !r.winners.length) return null;
  // 주인공 = 메인팟(겨룬 사람이 둘 이상인 첫 팟)의 승자. 혼자만 자격인 남는 팟·사이드팟 승자는 주인공도 동점도 아니다
  const main = r.pots?.find((p) => p.eligible.length >= 2 && p.winners.length > 0) ?? r.pots?.find((p) => p.winners.length > 0);
  const top = main ? [...main.winners].sort((a, b) => a - b) : r.winners;
  const w = top[0];
  const who = i.nameOf(w);
  if (r.uncontested) {
    // 이긴 사람의 마지막 올림(삥·따당·하프) 뒤에 다이한 사람 수
    let at = -1;
    let how = '';
    i.events.forEach((e, k) => {
      if (e.seat === w && RAISES[e.t]) {
        at = k;
        how = RAISES[e.t];
      }
    });
    const allDies = i.events.filter((e) => e.t === 'die').length;
    if (at < 0) return allDies ? `모두 다이! ${who}의 무혈 승리` : `${who}의 무혈 승리`;
    const dies = i.events.slice(at + 1).filter((e) => e.t === 'die').length;
    if (!dies) return `${who}의 무혈 승리`;
    return `${who}의 ${i.bluff ? '뻥카' : how}에 ${dies}명 다이`;
  }
  if (top.length > 1) return `동점! ${top.map(i.nameOf).join(' · ')} 판돈 나눔`;
  const hand = r.hands[w]?.name ?? '';
  const of = hand ? `${who}의 ${hand}` : who;
  const lead = i.showdown ? leadersBefore7(i.showdown) : null;
  if (lead && !lead.includes(w)) return `7구 역전! ${of}`;
  if (i.events.some((e) => e.t === 'allin')) return `올인 승부! ${of} 승리`;
  const n = i.showdown?.length ?? Object.keys(r.hands).length;
  return n >= 2 ? `${n}명 쇼다운 · ${of} 승리` : null;
}

// ───────────────────────── 포커·홀덤: 진짜 승자 · 돌려받은 팟 ─────────────────────────

/** 판 결과 중 승자를 가르는 데 쓰는 부분 (세븐포커 · 홀덤 요약 공용) */
export interface PotWinSummary {
  uncontested: boolean;
  /** 모든 팟 승자의 합집합 — 아무도 못 받은 베팅을 돌려받은 사람(refund 팟)도 들어 있다 */
  winners: readonly number[];
  /** refund: 가장 많이 낸 사람 혼자 낸 몫을 돌려주는 팟 (엔진 pots.ts 가 판 끝에 가른다) */
  pots?: readonly { amount?: number; eligible: readonly number[]; winners: readonly number[]; refund?: boolean }[];
}

/**
 * 진짜 승자 (자리 번호순): 무혈 승리면 winners, 아니면 돌려받는 팟(refund)이 아닌 팟의 승자.
 * 혼자만 대상인 팟이라도 다이한 사람의 돈이 들어 있으면 딴 것이다 — 돌려받음은 refund 팟뿐
 */
export function potRealWinners(r: PotWinSummary | null | undefined): number[] {
  if (!r) return [];
  if (r.uncontested || !r.pots?.length) return [...r.winners].sort((a, b) => a - b);
  const out = new Set<number>();
  for (const p of r.pots) if (!p.refund) for (const w of p.winners) out.add(w);
  return out.size ? [...out].sort((a, b) => a - b) : [...r.winners].sort((a, b) => a - b);
}

/** 이 자리의 'win' 사건이 돌려받은 것뿐인가 (진짜 승자가 아닌데 받았다). 결과를 모르면 false */
export const potRefundOnly = (seat: number, r: PotWinSummary | null | undefined): boolean => !!r && r.winners.includes(seat) && !potRealWinners(r).includes(seat);

/** 이 자리가 돌려받은 금액 (refund 팟 합계, 무혈 승리면 0) */
export function potRefundOf(seat: number, r: PotWinSummary | null | undefined): number {
  if (!r || r.uncontested || !r.pots) return 0;
  return r.pots.reduce((a, p) => a + (p.refund && p.winners.includes(seat) ? (p.amount ?? 0) : 0), 0);
}

// ───────────────────────── 홀덤: 미리 고르기 (남의 차례에 예약) ─────────────────────────

/** 예약: 체크/폴드 (체크할 수 있으면 체크, 아니면 폴드) · 콜 (예약할 때의 베팅 금액 curBet 을 적어 둔다) */
export type HoldemBook = { kind: 'checkfold' } | { kind: 'call'; curBet: number };

/** 베팅 금액이 바뀌면 콜 예약은 취소 (체크/폴드 예약은 그대로) */
export const holdemBookKeep = (b: HoldemBook | null, curBet: number): HoldemBook | null => (b && b.kind === 'call' && b.curBet !== curBet ? null : b);

/** 내 차례가 왔을 때 예약을 행동으로 (실행하지 않으면 null) */
export function holdemBookAction(b: HoldemBook | null, o: { canCheck: boolean; call: number }, curBet: number): 'check' | 'fold' | 'call' | null {
  const k = holdemBookKeep(b, curBet);
  if (!k) return null;
  if (k.kind === 'checkfold') return o.canCheck ? 'check' : 'fold';
  // 콜 예약: 낼 돈이 없으면(체크 가능) 체크
  return o.canCheck ? 'check' : o.call > 0 ? 'call' : null;
}

/** 남의 차례에 내가 콜하려면 낼 칩 (남은 칩까지만) */
export const holdemToCall = (curBet: number, betRound: number, stackLeft: number) => Math.max(0, Math.min(curBet - betRound, stackLeft));

// ───────────────────────── 블랙잭: 베팅 금액 · 기본 전략 힌트 ─────────────────────────

/** 베팅 금액을 기본 단위(min)의 배수로, min ~ max 안으로 */
export function bjClampBet(amount: number, min: number, max: number): number {
  if (!(min > 0)) return 0;
  const top = Math.max(min, Math.floor(max / min) * min);
  const v = Math.floor((Number.isFinite(amount) ? amount : 0) / min) * min;
  return Math.max(min, Math.min(top, v));
}
/** 칩을 눌러 더하기 (상한·잔액 안) */
export const bjAddBet = (cur: number, chip: number, min: number, max: number) => bjClampBet(cur + chip, min, max);
/** 지난 판 금액의 2배 (상한·잔액 안) */
export const bjDoubleBet = (last: number, min: number, max: number) => bjClampBet(last * 2, min, max);

/**
 * 기본 전략 추천 (엔진 AI 와 같은 basicStrategy 표 · 같은 고르기, 무작위 실수는 없다).
 * cards = 내 핸드, up = 딜러의 보이는 카드, legal = 지금 할 수 있는 행동 → 추천 행동 (없으면 null)
 */
export function bjHint(cards: readonly string[], up: string | null | undefined, legal: readonly BjPlayAction[]): BjPlayAction | null {
  if (!cards.length || !legal.length || !up) return null;
  const pt = cardPoint(up);
  const m = basicStrategy(cards, pt === 1 ? 11 : pt, legal.includes('split'));
  let pick: BjPlayAction;
  if (m === 'P') pick = 'split';
  else if (m === 'D') pick = legal.includes('double') ? 'double' : 'hit';
  else if (m === 'Ds') pick = legal.includes('double') ? 'double' : 'stand';
  else pick = m === 'H' ? 'hit' : 'stand';
  if (!legal.includes(pick)) pick = legal.includes('hit') ? 'hit' : legal[0];
  return pick;
}

// ───────────────────────── 룰렛: 되돌리기 · 2배 · 자주 쓰는 배치 · 따라 걸기 ─────────────────────────

const R_TARGETS: Record<BetKind, number> = { zodiac: 12, pair: 12, season: 4, yinyang: 2 };
const rSum = (bs: readonly RBet[]) => bs.reduce((a, b) => a + b.amount, 0);
const rCopy = (bs: readonly RBet[]): RBet[] => bs.map((b) => ({ kind: b.kind, target: b.target, amount: b.amount }));

/** 놓은 칩 전부 2배 (놓은 것이 없거나 한도를 넘으면 null) */
export function rlDouble(bets: readonly RBet[], max: number): RBet[] | null {
  if (!bets.length || rSum(bets) * 2 > max) return null;
  return bets.map((b) => ({ kind: b.kind, target: b.target, amount: b.amount * 2 }));
}

/** 다른 사람의 확정 배치를 내 놓기로 (따라 걸기). 비었거나 한도를 넘으면 null */
export function rlFollow(bets: readonly RBet[] | undefined, max: number): RBet[] | null {
  if (!bets?.length || rSum(bets) > max) return null;
  return rCopy(bets);
}

/** 되돌리기 기록: 바꾸기 직전의 배치를 쌓아 둔다 (최근 30번) */
export const RL_UNDO_MAX = 30;
export const rlPush = (log: readonly RBet[][], bets: readonly RBet[]): RBet[][] => [...log, rCopy(bets)].slice(-RL_UNDO_MAX);
/** 한 번 되돌리기 → 남은 기록과 되돌린 배치 (기록이 없으면 null) */
export function rlUndo(log: readonly RBet[][]): { log: RBet[][]; bets: RBet[] } | null {
  if (!log.length) return null;
  return { log: log.slice(0, -1), bets: rCopy(log[log.length - 1]) };
}

/** 자주 쓰는 배치 칸 수 */
export const RL_PRESETS = 3;
/** 저장한 배치 한 칸: 금액은 기본 단위의 몇 배인지로 적는다 (기본 단위가 다른 방에서도 쓴다) */
export type RlPreset = { kind: BetKind; target: number; units: number }[];

/** 저장해 둔 글(JSON)에서 배치 칸 읽기. 깨졌거나 잘못된 칸은 빈 칸(null) */
export function rlPresetsLoad(raw: string | null): (RlPreset | null)[] {
  const out: (RlPreset | null)[] = Array<RlPreset | null>(RL_PRESETS).fill(null);
  let v: unknown = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    return out;
  }
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < RL_PRESETS; i++) {
    const slot: unknown = v[i];
    if (!Array.isArray(slot) || !slot.length || slot.length > 60) continue;
    const ok = slot.every((b: unknown) => {
      const x = b as Partial<RlPreset[number]> | null;
      return (
        !!x &&
        typeof x === 'object' &&
        typeof x.kind === 'string' &&
        Object.prototype.hasOwnProperty.call(MULT, x.kind) &&
        Number.isInteger(x.target) &&
        (x.target as number) >= 0 &&
        (x.target as number) < R_TARGETS[x.kind as BetKind] &&
        Number.isInteger(x.units) &&
        (x.units as number) >= 1 &&
        (x.units as number) <= 1000
      );
    });
    if (ok) out[i] = (slot as RlPreset).map((b) => ({ kind: b.kind, target: b.target, units: b.units }));
  }
  return out;
}

/** 지금 배치를 저장용으로 (비었거나 기본 단위의 배수가 아닌 금액이 있으면 null) */
export function rlToPreset(bets: readonly RBet[], base: number): RlPreset | null {
  if (!bets.length || !(base > 0) || bets.some((b) => b.amount < base || b.amount % base !== 0)) return null;
  return bets.map((b) => ({ kind: b.kind, target: b.target, units: b.amount / base }));
}

/** 저장한 배치를 이 방의 금액으로 (빈 칸이거나 한도를 넘으면 null) */
export function rlFromPreset(p: RlPreset | null, base: number, max: number): RBet[] | null {
  if (!p?.length) return null;
  const bets = p.map((b) => ({ kind: b.kind, target: b.target, amount: b.units * base }));
  return rSum(bets) > max ? null : bets;
}

/** 약한 패인가 (원페어 이하) — 무혈 승리가 '뻥카'였는지 가릴 때 */
export function pokerWeak(cards: readonly string[]): boolean {
  if (!cards.length) return false;
  try {
    const v = cards.length >= 5 ? evaluate7(cards.slice()) : evaluateOpen(cards.slice());
    return (v?.cat ?? 0) <= HandCat.PAIR;
  } catch {
    return false;
  }
}
