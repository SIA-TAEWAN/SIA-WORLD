import { isCharId, type ZodiacId } from '../game/constants';

/** 방 채널로 주고받는 '경기 시작' 알림과 그 검사 (순수 모듈) */

/** 경기에 나서는 사람 (시작할 때 방장이 정해서 보낸다) */
export interface StartPlayer {
  id: string;
  name: string;
  char: ZodiacId;
}

/** 경기 시작 알림 */
export interface StartMsg {
  t: 'start';
  /** 경기 번호: 방장이 서버 시각(ms)으로 만든 숫자. 결과 저장 때 방 코드와 함께 이 경기를 가리킨다 */
  matchNo: number;
  /** 첫 서브를 정하는 시드 */
  seed: number;
  /** 배경 번호 0~2 */
  bg: number;
  /** 카운트다운이 끝나고 경기가 시작되는 시각 (서버 시각 ms) — 두 기기가 같은 순간에 시작한다 */
  startAt: number;
  /** [왼쪽(방장), 오른쪽] */
  players: [StartPlayer, StartPlayer];
}

/** 한 경기가 이보다 길어지면 끝난 것으로 본다 (끝 알림을 못 받았을 때) */
export const MATCH_MAX_MS = 35 * 60 * 1000;

/** 받은 시작 알림의 시작 시각이 지금보다 이만큼 넘게 앞이면(미래) 잘못된 것으로 본다 */
const START_AHEAD_MAX_MS = 30 * 1000;

/** 방장이 '경기 끝'과 함께 알리는 결과 (정상 종료일 때만) */
export interface EndInfo {
  score: [number, number];
  winner: 0 | 1;
  /** 방장이 모은 하이라이트 (game/highlight.ts packHighlight) */
  hl?: [number, number, number, number];
}

/**
 * 받은 시작 알림을 검사하고 다듬는다. 잘못된 것은 null (버린다).
 * 숫자가 아니거나 범위를 벗어난 값, 사람 정보가 빠진 것은 받지 않는다.
 */
export function cleanStart(raw: unknown, now: number): StartMsg | null {
  const s = raw as Partial<StartMsg> | null;
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!s || typeof s !== 'object' || !fin(s.matchNo) || s.matchNo <= 0 || !fin(s.startAt) || !fin(s.seed)) return null;
  if (s.startAt > now + START_AHEAD_MAX_MS || s.startAt < now - MATCH_MAX_MS) return null;
  if (!Array.isArray(s.players) || s.players.length !== 2) return null;
  const ps: StartPlayer[] = [];
  for (const p of s.players as unknown[]) {
    const v = p as Partial<StartPlayer> | null;
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id || v.id.length > 64) return null;
    ps.push({ id: v.id, name: String(v.name ?? '').slice(0, 12) || '이름 없음', char: isCharId(v.char) ? v.char : 'tiger' });
  }
  if (ps[0].id === ps[1].id) return null;
  const bg = fin(s.bg) ? ((Math.floor(s.bg) % 3) + 3) % 3 : 0;
  return { t: 'start', matchNo: Math.floor(s.matchNo), seed: Math.floor(Math.abs(s.seed)) % 0x7fffffff, bg, startAt: s.startAt, players: [ps[0], ps[1]] };
}

