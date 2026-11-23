import { END_AFTER_FIRST, END_AFTER_GO, LANES, ZODIAC_IDS, ZODIAC_NICK, type AiLevel, type ZodiacId } from '../game/constants';
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
  /** 기기 판본 (CLIENT_VERSION). 예전 기기에는 없다 */
  ver?: number;
  /** AI 난이도: 방장의 값이 그 방의 난이도 (다른 사람은 방장 것을 따라 둔다). 예전 기기에는 없다 → 보통 */
  level?: AiLevel;
}

/** 이 기기의 판본. 기기끼리 주고받는 내용이 바뀌면 올린다 (더 새 판본이 방에 있으면 새로고침 안내) */
export const CLIENT_VERSION = 5;

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
  // 다시 고르는 건 십이지 12개 안에서만 (추가 캐릭터는 열어야 쓴다). 내가 추가 캐릭터면 start = -1 → 쥐부터
  const start = (ZODIAC_IDS as readonly ZodiacId[]).indexOf(me.char);
  for (let i = 1; i <= ZODIAC_IDS.length; i++) {
    const id = ZODIAC_IDS[(start + i) % ZODIAC_IDS.length];
    if (!used.has(id)) return id;
  }
  return me.char;
}

/** AI 캐릭터: 사람이 고르지 않은 십이지 중에서 (추가 캐릭터는 고르지 않는다) 방마다 정해진 무작위 순서로 (모든 기기가 같게) */
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

/** 기준 기기 후보에서 빼는 위치 공백 (ms): 이만큼 위치가 안 오면 화면이 멈춘 기기로 본다 */
export const HOST_SILENT_MS = 1500;
/** 조용했던 기기가 다시 '자리 잡은' 후보가 되려면 위치가 이만큼 이어져 와야 한다 (기준 기기가 오락가락하지 않게) */
export const HOST_BACK_MS = 1500;
/** 기준 기기가 없어 끝 알림이 안 올 때, 끝날 시각에서 이만큼 더 기다렸다가 스스로 끝낸다 (초) */
export const FALLBACK_MARGIN = 4;

/** 한 사람에게서 위치를 받은 기록: 마지막으로 받은 시각과, 끊기지 않고 이어져 온 시작 시각 */
export interface Heard {
  last: number;
  since: number;
}

/** 위치를 하나 받았다. HOST_SILENT_MS 보다 오래 끊겼다가 오면 새로 이어지기 시작한 것으로 본다 */
export function noteHeard(h: Heard | undefined, now: number): Heard {
  if (!h || now - h.last > HOST_SILENT_MS) return { last: now, since: now };
  return { last: Math.max(h.last, now), since: h.since };
}

/** 지금도 위치가 오고 있는가 */
export function isFresh(h: Heard | undefined, now: number): boolean {
  return !!h && now - h.last <= HOST_SILENT_MS;
}

/** 위치가 오고 있고, 끊겼다 돌아왔다면 HOST_BACK_MS 이상 이어져 왔는가 */
export function isSettled(h: Heard | undefined, now: number): boolean {
  return isFresh(h, now) && now - h!.since >= HOST_BACK_MS;
}

/**
 * 경기 중 기준 기기: 출전 명단 순서로, 지금 접속해 있고 AI로 넘어가지 않은 사람 중
 * 위치가 오고 있는 첫 사람 (화면이 멈춘 기기는 건너뛴다).
 * - heard 를 주면: 자리 잡은(isSettled) 사람을 먼저, 그런 사람이 없으면 위치가 오는(isFresh) 사람을 고른다.
 *   돌아온 기기는 HOST_BACK_MS 동안 다른 후보에게 밀리므로 기준 기기가 오락가락하지 않는다.
 * - 모든 기기가 같은 위치 흐름을 받으므로 같은 사람을 고른다 (도착 시각 차이만큼 잠깐 어긋날 수 있다).
 * (AI를 계산하고 경기 끝을 정한다. 나가거나 멈추면 다음 사람이 넘겨받는다)
 */
export function raceHostOf(
  roster: readonly { slot: number; id: string | null }[],
  present: ReadonlySet<string>,
  taken: readonly boolean[],
  heard?: { get(id: string): Heard | undefined },
  now = 0,
): string | undefined {
  const ok = (r: { slot: number; id: string | null }): r is { slot: number; id: string } => !!r.id && !taken[r.slot] && present.has(r.id);
  if (!heard) {
    for (const r of roster) if (ok(r)) return r.id;
    return undefined;
  }
  for (const r of roster) if (ok(r) && isSettled(heard.get(r.id), now)) return r.id;
  for (const r of roster) if (ok(r) && isFresh(heard.get(r.id), now)) return r.id;
  return undefined;
}

/**
 * 기준 기기가 아닌 기기가 끝 알림 없이 스스로 끝낼 때인가.
 * t: GO부터 흐른 초, firstMs: 가장 빠른 도착 기록(ms, 아무도 도착 안 했으면 null)
 */
export function fallbackEndDue(t: number, firstMs: number | null): boolean {
  if (t > END_AFTER_GO + FALLBACK_MARGIN) return true;
  return firstMs !== null && t > firstMs / 1000 + END_AFTER_FIRST + FALLBACK_MARGIN;
}
