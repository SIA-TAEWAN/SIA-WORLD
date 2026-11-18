import type { ZodiacId } from '../game/constants';

/** 한 방에 앉는 사람 수 (1:1) */
export const SEATS = 2;

/** 방에 있는 사람이 실시간 채널(Presence)에 올리는 정보 */
export interface PlayerMeta {
  name: string;
  char: ZodiacId;
  /** 레디 (결과 화면의 '다시하기'도 레디와 같다) */
  ready: boolean;
  /** 방에 들어온 시각 (서버 시각 ms) — 먼저 들어온 사람이 왼쪽(방장) */
  at: number;
  /** 방을 만들 때 적은 방 이름 (비우면 '○○의 방') */
  title: string;
}

export interface MemberInfo extends PlayerMeta {
  id: string;
}

/** 들어온 순서 (같으면 ID 순) — 모든 기기가 같은 순서를 본다 */
export function sortMembers(list: readonly MemberInfo[]): MemberInfo[] {
  return [...list].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 방장: 지금 있는 사람 중 가장 먼저 들어온 사람 (나가면 남은 사람) */
export function hostOf(members: readonly MemberInfo[]): string | undefined {
  return sortMembers(members)[0]?.id;
}

/** 경기하는 두 사람: [왼쪽(방장), 오른쪽]. 세 번째부터는 자리가 없다 */
export function players(members: readonly MemberInfo[]): MemberInfo[] {
  return sortMembers(members).slice(0, SEATS);
}

/** 내 자리: 0 왼쪽 · 1 오른쪽 · -1 자리 없음(방이 가득 참) */
export function seatOf(members: readonly MemberInfo[], id: string): 0 | 1 | -1 {
  const i = players(members).findIndex((m) => m.id === id);
  return i === 0 ? 0 : i === 1 ? 1 : -1;
}

/** 시작할 수 있는가: 두 사람이 모두 있고 둘 다 레디 */
export function bothReady(members: readonly MemberInfo[]): boolean {
  const p = players(members);
  return p.length === SEATS && p.every((m) => m.ready);
}

/** 방 이름: 방장이 적은 이름, 없으면 '○○의 방' */
export function roomTitle(members: readonly MemberInfo[]): string {
  const host = sortMembers(members)[0];
  if (!host) return '';
  return cleanTitle(host.title) || `${String(host.name ?? '').slice(0, 12) || '이름 없음'}의 방`;
}

/** 방 이름 다듬기: 앞뒤 빈칸 없이 16자까지 */
export const cleanTitle = (raw: unknown) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
