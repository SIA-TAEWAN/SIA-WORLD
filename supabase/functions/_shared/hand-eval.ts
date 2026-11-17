/**
 * 트럼프 족보 판정 (세븐포커 · 텍사스 홀덤 공용).
 *
 * 카드 표기: 2글자 문자열 = 숫자 + 무늬. 숫자 '23456789TJQKA' (T = 10), 무늬 'S'(♠) 'D'(◆) 'H'(♥) 'C'(♣).
 * 5~7장 중 가장 좋은 5장을 고르고, 같은 족보면 숫자(키커)로 비교한다.
 * 게임마다 다른 부분(스트레이트 서열, 무늬 비교)은 EvalOptions로 정한다. 기본값은 세븐포커(KOREAN).
 * 순수 TypeScript (Deno · Node 공용).
 */
import { EngineError } from './engine.ts';

const RANKS = '23456789TJQKA';
/** 무늬 서열 낮은 것 → 높은 것 (♣ < ♥ < ◆ < ♠) */
const SUITS = 'CHDS';

export const rankOf = (c: string): number => RANKS.indexOf(c[0]) + 2;
export const suitOf = (c: string): number => SUITS.indexOf(c[1]);
/** 카드 서열 (숫자 우선, 그다음 무늬) */
export const cardKey = (c: string): number => rankOf(c) * 4 + suitOf(c);

export function fullDeck(): string[] {
  const d: string[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

export function isCard(c: unknown): c is string {
  return typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1]);
}

export const RANK_NAME: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

/** 족보 등급 */
export const HandCat = {
  HIGH: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL: 9,
} as const;

export interface HandValue {
  cat: number;
  /** 같은 등급 안에서 비교할 숫자들 (앞에서부터) */
  ranks: number[];
  /** 결정 카드의 무늬 (0=♣ … 3=♠) */
  suit: number;
  name: string;
  /** 고른 5장 (공개 족보는 그 카드들) */
  cards: string[];
}

/**
 * 게임마다 다른 규칙
 * - straightOrder 'korean'(세븐포커): 마운틴 > 백스트레이트(A-2-3-4-5) > 그 밖 / 'standard'(홀덤): A-2-3-4-5가 가장 낮다
 * - suitTiebreak: 숫자까지 같으면 결정 카드 무늬로 가린다(세븐포커). false면 완전 동점(0)
 */
export interface EvalOptions {
  straightOrder: 'korean' | 'standard';
  suitTiebreak: boolean;
}
export const KOREAN: EvalOptions = { straightOrder: 'korean', suitTiebreak: true };
export const STANDARD: EvalOptions = { straightOrder: 'standard', suitTiebreak: false };

/** a가 b보다 좋으면 양수, 나쁘면 음수, 같으면 0 */
export function compareHands(a: HandValue, b: HandValue, opts: EvalOptions = KOREAN): number {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const n = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < n; i++) {
    const d = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (d !== 0) return d;
  }
  return opts.suitTiebreak ? a.suit - b.suit : 0;
}

/** 숫자별로 묶어 (장수 많은 순, 숫자 높은 순) 정렬. 각 묶음 카드는 서열 높은 순 */
export function groups(cards: string[]): { rank: number; cards: string[] }[] {
  const m = new Map<number, string[]>();
  for (const c of cards) {
    const r = rankOf(c);
    const g = m.get(r);
    if (g) g.push(c);
    else m.set(r, [c]);
  }
  const out = [...m.entries()].map(([rank, cs]) => ({ rank, cards: cs.sort((x, y) => cardKey(y) - cardKey(x)) }));
  out.sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank);
  return out;
}

/** 5장 평가 */
export function evaluate5(cards: string[], opts: EvalOptions = KOREAN): HandValue {
  if (cards.length !== 5) throw new EngineError('5장이어야 합니다');
  const sorted = cards.slice().sort((a, b) => cardKey(b) - cardKey(a));
  const gs = groups(sorted);
  const flush = sorted.every((c) => c[1] === sorted[0][1]);
  let straightTop = 0;
  if (gs.length === 5) {
    const rs = gs.map((g) => g.rank); // 높은 순
    if (rs[0] - rs[4] === 4) straightTop = rs[0];
    else if (rs[0] === 14 && rs[1] === 5 && rs[4] === 2) straightTop = 5; // 백스트레이트 A-2-3-4-5
  }
  // 스트레이트 순위 값: 한국식은 마운틴 15 > 백스트레이트 14 > 일반은 가장 높은 숫자(6~13), 표준은 가장 높은 숫자(백스트레이트 5)
  const straightKey = opts.straightOrder === 'korean' ? (straightTop === 14 ? 15 : straightTop === 5 ? 14 : straightTop) : straightTop;
  // 스트레이트의 결정 카드: 가장 높은 카드, 백스트레이트는 A
  const topCard = straightTop === 5 ? sorted.find((c) => rankOf(c) === 14)! : sorted[0];
  const R = (r: number) => RANK_NAME[r];

  if (flush && straightTop) {
    if (straightTop === 14) {
      return { cat: HandCat.ROYAL, ranks: [], suit: suitOf(topCard), name: '로열 스트레이트 플러시', cards: sorted };
    }
    return {
      cat: HandCat.STRAIGHT_FLUSH,
      ranks: [straightKey],
      suit: suitOf(topCard),
      name: straightTop === 5 ? '백스트레이트 플러시' : `${R(straightTop)} 스트레이트 플러시`,
      cards: sorted,
    };
  }
  const lead = gs[0];
  const leadSuit = suitOf(lead.cards[0]);
  if (lead.cards.length === 4) {
    return { cat: HandCat.QUADS, ranks: [lead.rank, gs[1].rank], suit: leadSuit, name: `${R(lead.rank)} 포카드`, cards: sorted };
  }
  if (lead.cards.length === 3 && gs[1].cards.length === 2) {
    return { cat: HandCat.FULL_HOUSE, ranks: [lead.rank, gs[1].rank], suit: leadSuit, name: `${R(lead.rank)} 풀하우스`, cards: sorted };
  }
  if (flush) {
    return { cat: HandCat.FLUSH, ranks: gs.map((g) => g.rank), suit: suitOf(sorted[0]), name: `${R(gs[0].rank)} 플러시`, cards: sorted };
  }
  if (straightTop) {
    return {
      cat: HandCat.STRAIGHT,
      ranks: [straightKey],
      suit: suitOf(topCard),
      name: straightTop === 14 ? '마운틴' : straightTop === 5 ? '백스트레이트' : `${R(straightTop)} 스트레이트`,
      cards: sorted,
    };
  }
  const ranks = gs.map((g) => g.rank);
  if (lead.cards.length === 3) return { cat: HandCat.TRIPS, ranks, suit: leadSuit, name: `${R(lead.rank)} 트리플`, cards: sorted };
  if (lead.cards.length === 2 && gs[1].cards.length === 2) {
    return { cat: HandCat.TWO_PAIR, ranks, suit: leadSuit, name: `${R(lead.rank)} 투페어`, cards: sorted };
  }
  if (lead.cards.length === 2) return { cat: HandCat.PAIR, ranks, suit: leadSuit, name: `${R(lead.rank)} 원페어`, cards: sorted };
  return { cat: HandCat.HIGH, ranks, suit: leadSuit, name: `${R(lead.rank)} 탑`, cards: sorted };
}

/** 5~7장에서 가장 좋은 5장 */
export function evaluate7(cards: string[], opts: EvalOptions = KOREAN): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new EngineError('5~7장이어야 합니다');
  if (new Set(cards).size !== cards.length || !cards.every(isCard)) throw new EngineError('잘못된 카드');
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]], opts);
            if (!best || compareHands(v, best, opts) > 0) best = v;
          }
  return best!;
}
