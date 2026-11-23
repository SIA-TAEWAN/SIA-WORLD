import { hashSeed } from './rng';
import { makeTrack, type Obstacle, type ObstacleKind } from './track';

/**
 * 오늘의 도전 (공통 틀: shared/daily.js · supabase/migrations/082_daily.sql, 레이스 쪽: 083_race_daily.sql)
 * 오늘의 트랙: 날짜 문자열에서 만든 시드로 방해물을 놓는다. 모든 기기가 같은 날 같은 트랙을 달린다.
 * 여기는 순수 함수만 둔다 (화면·통신 없음).
 */

/** shared/daily.js 의 DAILY_GAMES 에 적힌 이 게임의 이름 */
export const DAILY_GAME = 'running';

/** 'YYYY-MM-DD' 모양인가 */
export function isDailyDay(day: unknown): day is string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** 기기 시계로 만든 한국 날짜 (서버를 못 부를 때·테스트 모드). shared/daily.js 의 localDailyDay 와 같은 계산 */
export function localDailyDay(now = Date.now()): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 그날의 트랙 시드. shared/daily.js 의 dailySeed('running', day, 'track') 와 같은 값
 * (둘 다 `게임:날짜:소금` 문자열의 FNV-1a 32비트. tests/daily.test.ts 가 같은지 확인한다)
 */
export function dailyTrackSeed(day: string): number {
  return hashSeed(`${DAILY_GAME}:${day}:track`);
}

/** 그날의 방해물 배치 */
export function dailyTrack(day: string): Obstacle[] {
  return makeTrack(dailyTrackSeed(day));
}

/** 방해물 그림 글자 (방법 안내와 같은 것) */
export const OBSTACLE_ICON: Record<ObstacleKind, string> = {
  mudShort: '🟤',
  mudLong: '🟫',
  hurdle: '🚧',
  banana: '🍌',
  log: '🪵',
  boost: '⚡',
  bar: '🚩',
};
export const OBSTACLE_NAME: Record<ObstacleKind, string> = {
  mudShort: '진흙',
  mudLong: '긴 진흙',
  hurdle: '허들',
  banana: '바나나',
  log: '통나무',
  boost: '부스트 발판',
  bar: '낮은 막대',
};

/** '2026-11-23' → '11월 23일' */
export function dailyLabel(day: string): string {
  if (!isDailyDay(day)) return '';
  const [, m, d] = day.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/**
 * 오늘의 도전 전용 방 코드: 'daily' + 영문 소문자·숫자 8자 (서버 083 은 이 모양의 방에서 혼자 달린 판만 받는다).
 * 방 목록에 올리지 않고 주소에도 넣지 않아 다른 사람이 들어오지 않는다.
 */
export function dailyRoomKey(rand: () => number = Math.random): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = 'daily';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(rand() * chars.length) % chars.length];
  return s;
}
export const isDailyRoomKey = (key: string) => /^daily[a-z0-9]{4,19}$/.test(key);

/** 순위 한 줄의 기록 (ms). detail.ms 가 없으면 점수(-ms)에서. 이상한 값이면 null */
export function dailyMs(row: { score?: unknown; detail?: unknown } | null | undefined): number | null {
  if (!row) return null;
  const d = (row.detail ?? {}) as { ms?: unknown };
  const ms = Number.isFinite(Number(d.ms)) && Number(d.ms) > 0 ? Number(d.ms) : -Number(row.score);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** 오늘의 도전 기록 넣기: 통신 실패(done=false)면 잠깐 쉬고 다시 (모두 tries 번). 끝내 실패하면 null */
export async function retryDaily(
  call: () => Promise<{ done: true; day: string | null } | { done: false }>,
  tries = 3,
  waitMs = 1200,
): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    if (i > 0 && waitMs > 0) await new Promise((r) => setTimeout(r, waitMs * i));
    const r = await call();
    if (r.done) return r.day;
  }
  return null;
}
