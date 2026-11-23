/**
 * 카드 게임 화면의 곁들이 기능에 쓰는 순수 계산 (화면·저장소를 건드리지 않는다 → vitest 로 검사: _shared/card-extras.test.ts).
 *   포커 힌트 · 홀덤 승률 도우미 · 블랙잭 오늘 기록/연승 · 룰렛 흐름 통계
 * 규칙 엔진의 결과는 바꾸지 않는다: 엔진의 순수 함수를 읽기만 한다.
 */
import { seededRng } from '../../supabase/functions/_shared/engine.ts';
import { HandCat, draws, evaluate7, evaluateOpen } from '../../supabase/functions/_shared/poker.ts';
import { estimateEquity } from '../../supabase/functions/_shared/holdem.ts';
import { seasonCells } from '../../supabase/functions/_shared/roulette.ts';

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
  const want: string[] = [];
  if (d.flush4 && cat < HandCat.FLUSH) want.push('플러시');
  if (d.straight4 && cat < HandCat.STRAIGHT) want.push('스트레이트');
  if (cat === HandCat.TWO_PAIR) want.push('풀하우스');
  if (cat === HandCat.TRIPS) want.push('포카드');
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
export function holdemAdvice(i: { hole: readonly string[]; board: readonly string[]; opponents: number; pot: number; call: number }, iters = 400): HoldemAdvice | null {
  if (i.hole.length !== 2 || i.board.length > 5) return null;
  const opp = Math.max(1, Math.min(8, Math.floor(i.opponents)));
  const rng = seededRng(hashOf(`${i.hole.join('')}|${i.board.join('')}|${opp}`));
  let equity: number;
  try {
    equity = estimateEquity(i.hole.slice(), i.board.slice(), opp, rng, iters);
  } catch {
    return null;
  }
  const need = i.call > 0 ? i.call / (Math.max(0, i.pot) + i.call) : null;
  return { equity, need };
}

const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);

/** '이길 확률 약 62% · 콜하려면 25% 이상' */
export function holdemAdviceText(a: HoldemAdvice): string {
  const win = `이길 확률 약 ${pct(a.equity)}%`;
  return a.need === null ? `${win} · 돈을 내지 않고 체크할 수 있어요` : `${win} · 콜하려면 ${pct(a.need)}% 이상`;
}

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

/** '오늘 3판 · +1,200칩 · 블랙잭 1번' */
export function bjStrip(s: BjDay, fmt: (n: number) => string): string {
  const net = s.net > 0 ? `+${fmt(s.net)}` : s.net < 0 ? `-${fmt(-s.net)}` : '±0';
  return `오늘 ${s.rounds}판 · ${net}칩 · 블랙잭 ${s.bj}번`;
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
