import { describe, expect, it, vi } from 'vitest';
import { DAILY_GAME, dailyLabel, dailyMs, dailyRoomKey, dailyTrack, dailyTrackSeed, isDailyDay, isDailyRoomKey, localDailyDay, retryDaily } from '../src/game/daily';
import { makeRng } from '../src/game/rng';
import { trackProblems } from '../src/game/track';

// shared/daily.js 는 실행 중에 불러오는 공통 모듈: Supabase 클라이언트(CDN) 없이 순수 함수만 확인한다
vi.mock('../../../shared/supabase.js', () => ({ supabase: {} }));
const sharedPath = '../../../shared/daily.js';
/** 방 코드 규칙 (서버 race_go · src/net/room.ts 의 validRoomCode 와 같은 식) */
const validRoomCode = (c: string) => /^[a-z0-9]{4,24}$/.test(c);

describe('오늘의 도전: 날짜 → 트랙', () => {
  it('같은 날짜면 같은 시드·같은 트랙, 날짜가 다르면 다른 트랙', () => {
    expect(dailyTrackSeed('2026-11-23')).toBe(dailyTrackSeed('2026-11-23'));
    expect(dailyTrack('2026-11-23')).toEqual(dailyTrack('2026-11-23'));
    expect(dailyTrackSeed('2026-11-23')).not.toBe(dailyTrackSeed('2026-11-24'));
    expect(JSON.stringify(dailyTrack('2026-11-23'))).not.toBe(JSON.stringify(dailyTrack('2026-11-24')));
  });

  it('공통 모듈(shared/daily.js)의 dailySeed · localDailyDay 와 같은 값', async () => {
    const shared = (await import(/* @vite-ignore */ sharedPath)) as {
      dailySeed(game: string, day: string, salt?: string): number;
      localDailyDay(now?: number): string;
      DAILY_GAMES: string[];
    };
    expect(shared.DAILY_GAMES).toContain(DAILY_GAME);
    for (const day of ['2026-01-01', '2026-11-23', '2027-02-28', '2028-02-29']) {
      expect(dailyTrackSeed(day)).toBe(shared.dailySeed(DAILY_GAME, day, 'track'));
    }
    for (const now of [0, Date.UTC(2026, 10, 23, 14, 59, 59), Date.UTC(2026, 10, 23, 15, 0, 0), Date.UTC(2026, 11, 31, 23, 0, 0)]) {
      expect(localDailyDay(now)).toBe(shared.localDailyDay(now));
    }
  });

  it('1년 치 트랙이 모두 배치 규칙에 맞는다', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 366; i++) {
      const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      expect(isDailyDay(day)).toBe(true);
      expect(trackProblems(dailyTrack(day))).toEqual([]);
      const seed = dailyTrackSeed(day);
      expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true);
      seeds.add(seed);
    }
    expect(seeds.size).toBe(366);
  });

  it('한국 시간으로 날짜가 바뀐다 (UTC 15시 = 한국 자정)', () => {
    expect(localDailyDay(Date.UTC(2026, 10, 23, 14, 59, 59))).toBe('2026-11-23');
    expect(localDailyDay(Date.UTC(2026, 10, 23, 15, 0, 0))).toBe('2026-11-24');
  });

  it('날짜 모양 검사와 표시', () => {
    expect(isDailyDay('2026-11-23')).toBe(true);
    for (const bad of ['2026-13-01', '2026-02-30', '2026-1-1', '', 'today', null, 20261123]) expect(isDailyDay(bad)).toBe(false);
    expect(dailyLabel('2026-11-23')).toBe('11월 23일');
    expect(dailyLabel('2026-01-05')).toBe('1월 5일');
    expect(dailyLabel('x')).toBe('');
  });

  it('전용 방 코드: daily 로 시작하고 방 코드 규칙(서버 race_go)에 맞는다', () => {
    const rng = makeRng(7);
    const keys = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const k = dailyRoomKey(rng);
      expect(isDailyRoomKey(k)).toBe(true);
      expect(validRoomCode(k)).toBe(true);
      expect(k).toHaveLength(13);
      keys.add(k);
    }
    expect(keys.size).toBe(200);
    expect(isDailyRoomKey(dailyRoomKey(() => 0.999999999))).toBe(true);
    expect(isDailyRoomKey('abc234')).toBe(false);
    expect(isDailyRoomKey('daily')).toBe(false);
  });

  it('순위 줄의 기록: detail.ms, 없으면 점수(-ms)', () => {
    expect(dailyMs({ score: -31000, detail: { ms: 31000 } })).toBe(31000);
    expect(dailyMs({ score: -31000, detail: {} })).toBe(31000);
    expect(dailyMs({ score: -31000 })).toBe(31000);
    expect(dailyMs({ score: 5, detail: { ms: 'x' } })).toBeNull();
    expect(dailyMs(null)).toBeNull();
  });
});

describe('오늘의 도전: 기록 넣기 다시 시도', () => {
  it('통신이 실패하면 두 번까지 다시 하고, 되면 기록된 날짜를 돌려준다', async () => {
    let n = 0;
    const day = await retryDaily(async () => (++n < 3 ? { done: false } : { done: true, day: '2026-11-23' }), 3, 0);
    expect(day).toBe('2026-11-23');
    expect(n).toBe(3);
  });

  it('끝내 실패하면 null, 서버가 거절했으면 다시 하지 않는다', async () => {
    let n = 0;
    expect(await retryDaily(async () => (n++, { done: false }), 3, 0)).toBeNull();
    expect(n).toBe(3);
    n = 0;
    expect(await retryDaily(async () => (n++, { done: true, day: null }), 3, 0)).toBeNull();
    expect(n).toBe(1);
  });
});
