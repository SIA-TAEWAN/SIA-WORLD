import { LANES, ZODIAC_IDS, ZODIAC_NICK, type ZodiacId } from './constants';
import { makeRng, shuffle } from './rng';

/** 자리 하나의 주인: 나 · 오늘 1위의 고스트 · AI */
export type SeatRole = 'me' | 'ghost' | 'ai';

export interface LineupSeat {
  slot: number;
  role: SeatRole;
  char: ZodiacId;
}

/**
 * 오늘의 도전 한 판의 자리 (순수 함수): 0번 자리는 나, 고스트가 있으면 1번, 나머지는 AI 로 4자리를 채운다.
 * - 그날 1위 고스트가 있으면(ghostChar) 나 + 고스트 1 + AI 2, 없으면(null) 나 + AI 3명.
 * - 고스트는 다른 사람이라 내 캐릭터와 같아도 된다. AI 는 나·고스트와 겹치지 않는 십이지 중에서 seed 로 정한 무작위
 *   (추가 캐릭터인 고양이는 AI 로 나오지 않는다).
 */
export function lineup(myChar: ZodiacId, ghostChar: ZodiacId | null, seed: number): LineupSeat[] {
  const seats: LineupSeat[] = [{ slot: 0, role: 'me', char: myChar }];
  if (ghostChar) seats.push({ slot: 1, role: 'ghost', char: ghostChar });
  const taken = new Set<ZodiacId>([myChar, ...(ghostChar ? [ghostChar] : [])]);
  const ai = shuffle(ZODIAC_IDS, makeRng(seed >>> 0)).filter((c) => !taken.has(c));
  for (const c of ai) {
    if (seats.length >= LANES) break;
    seats.push({ slot: seats.length, role: 'ai', char: c });
  }
  return seats;
}

/** AI 이름표: "AI 어흥이" (DESIGN.md) */
export const aiName = (c: ZodiacId) => `AI ${ZODIAC_NICK[c]}`;
