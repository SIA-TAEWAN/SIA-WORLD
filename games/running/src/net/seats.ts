import { LANES, ZODIAC_IDS, ZODIAC_NICK, type ZodiacId } from '../game/constants';
import { hashSeed, makeRng, shuffle } from '../game/rng';

/** 방에 있는 사람이 실시간 채널(Presence)에 올리는 정보 */
export interface PlayerMeta {
  name: string;
  char: ZodiacId;
  ready: boolean;
  /** 방에 들어온 시각 (서버 시각 ms) — 자리 순서와 방장을 정한다 */
  at: number;
  /** 캐릭터를 고른 시각 — 같은 캐릭터를 고르면 먼저 고른 사람 것 */
  pickAt: number;
}

export interface MemberInfo extends PlayerMeta {
  id: string;
}

/** 자리 하나 (한 방은 항상 4자리: 사람이 없으면 AI) */
export interface Seat {
  slot: number;
  /** 사람이면 사용자 ID, AI면 null */
  id: string | null;
  name: string;
  char: ZodiacId;
  ready: boolean;
}

/** 들어온 순서 (같으면 ID 순) — 모든 기기가 같은 순서를 본다 */
export function sortMembers(list: readonly MemberInfo[]): MemberInfo[] {
  return [...list].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 방장: 지금 있는 사람 중 가장 먼저 들어온 사람 (나가면 다음 사람) */
export function hostOf(members: readonly MemberInfo[]): string | undefined {
  return sortMembers(members)[0]?.id;
}

/** 달리는 사람: 먼저 들어온 4명. 그 뒤는 자리가 없다 */
export function players(members: readonly MemberInfo[]): MemberInfo[] {
  return sortMembers(members).slice(0, LANES);
}

/**
 * 내 캐릭터가 다른 사람과 겹치면 먼저 고른 사람 것. 내가 늦었으면 띠 순서로 다음 빈 캐릭터를 돌려준다.
 * 겹치지 않으면 지금 캐릭터 그대로.
 */
export function resolveChar(me: MemberInfo, members: readonly MemberInfo[]): ZodiacId {
  const others = members.filter((m) => m.id !== me.id);
  const lost = others.some((m) => m.char === me.char && (m.pickAt < me.pickAt || (m.pickAt === me.pickAt && m.id < me.id)));
  if (!lost) return me.char;
  const used = new Set(others.map((m) => m.char));
  const start = ZODIAC_IDS.indexOf(me.char);
  for (let i = 1; i <= ZODIAC_IDS.length; i++) {
    const id = ZODIAC_IDS[(start + i) % ZODIAC_IDS.length];
    if (!used.has(id)) return id;
  }
  return me.char;
}

/** AI 캐릭터: 사람이 고르지 않은 것 중에서 방마다 정해진 무작위 순서로 (모든 기기가 같게) */
export function aiChars(roomKey: string, taken: readonly ZodiacId[], n: number): ZodiacId[] {
  const order = shuffle(ZODIAC_IDS, makeRng(hashSeed(`ai:${roomKey}`)));
  return order.filter((c) => !taken.includes(c)).slice(0, n);
}

/** 4자리: 사람(들어온 순) + 남은 자리는 AI */
export function makeSeats(roomKey: string, members: readonly MemberInfo[]): Seat[] {
  const humans = players(members);
  const seats: Seat[] = humans.map((m, slot) => ({ slot, id: m.id, name: m.name, char: m.char, ready: m.ready }));
  const ai = aiChars(roomKey, humans.map((m) => m.char), LANES - seats.length);
  for (const c of ai) seats.push({ slot: seats.length, id: null, name: `AI ${ZODIAC_NICK[c]}`, char: c, ready: true });
  return seats;
}

/** 시작할 수 있는가: 사람이 한 명 이상이고 모두 레디 */
export function allReady(members: readonly MemberInfo[]): boolean {
  const humans = players(members);
  return humans.length > 0 && humans.every((m) => m.ready);
}

/**
 * 경기 중 기준 기기: 출전 명단의 사람 중, 지금 접속해 있고 AI로 넘어가지 않은 첫 사람.
 * (AI를 계산하고 경기 끝을 정한다. 나가면 다음 사람이 넘겨받는다)
 */
export function raceHostOf(roster: readonly { slot: number; id: string | null }[], present: ReadonlySet<string>, taken: readonly boolean[]): string | undefined {
  for (const r of roster) if (r.id && !taken[r.slot] && present.has(r.id)) return r.id;
  return undefined;
}
