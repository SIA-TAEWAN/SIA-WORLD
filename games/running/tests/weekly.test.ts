import { describe, expect, it, vi } from 'vitest';
import { localDailyDay } from '../src/game/daily';
import { tierOfPlace } from '../src/game/ranking';

// shared/ranking-dialog.js 는 실행 중에 불러오는 공통 모듈: Supabase 클라이언트(CDN) 없이 순수 함수만 확인한다
vi.mock('../../../shared/supabase.js', () => ({ supabase: {} }));
const dialogPath = '../../../shared/ranking-dialog.js';
const rankPath = '../../../shared/rank.js';

type Dialog = {
  raceWeekStart(day: string): string | null;
  raceWeekDaysLeft(day: string): number | null;
  raceWeekLeftText(day: string): string;
  raceTierOfPlace(place: number): string;
};
const load = async () => (await import(/* @vite-ignore */ dialogPath)) as Dialog;

/** 한국 시간 'YYYY-MM-DD HH:MM:SS' → epoch ms */
const kst = (s: string) => Date.parse(`${s.replace(' ', 'T')}+09:00`);

describe('주간 랭킹: 한 주 = 한국 시간 월요일 00:00 ~ 일요일 23:59', () => {
  it('그 날이 속한 주의 월요일 (096 _race_week 와 같은 값)', async () => {
    const d = await load();
    expect(d.raceWeekStart('2026-11-22')).toBe('2026-11-16'); // 일
    expect(d.raceWeekStart('2026-11-23')).toBe('2026-11-23'); // 월
    expect(d.raceWeekStart('2026-11-27')).toBe('2026-11-23'); // 금
    expect(d.raceWeekStart('2026-11-29')).toBe('2026-11-23'); // 일
    expect(d.raceWeekStart('2026-11-30')).toBe('2026-11-30'); // 월
    expect(d.raceWeekStart('2027-01-03')).toBe('2026-12-28'); // 해를 넘는 주
    expect(d.raceWeekStart('2028-03-01')).toBe('2028-02-28'); // 윤년
    expect(d.raceWeekStart('bad')).toBeNull();
  });

  it('월요일 0시 경계는 한국 시간으로 (UTC 로는 일요일 15:00)', async () => {
    const d = await load();
    const sun = localDailyDay(kst('2026-11-22 23:59:59'));
    const mon = localDailyDay(kst('2026-11-23 00:00:00'));
    expect([sun, mon]).toEqual(['2026-11-22', '2026-11-23']);
    expect(d.raceWeekStart(sun)).toBe('2026-11-16');
    expect(d.raceWeekStart(mon)).toBe('2026-11-23');
    // UTC 날짜로 셌다면 둘 다 일요일(11-22)이 되었을 시각
    expect(new Date(kst('2026-11-23 00:00:00')).toISOString().slice(0, 10)).toBe('2026-11-22');
  });

  it('이번 주 남은 날 (오늘 포함): 월 7 … 금 3 … 일 1', async () => {
    const d = await load();
    const days = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
    expect(days.map((x) => d.raceWeekDaysLeft(x))).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(d.raceWeekLeftText('2026-11-27')).toBe('이번 주 3일 남음');
    expect(d.raceWeekLeftText('2026-11-29')).toBe('이번 주 오늘 마감');
    expect(d.raceWeekLeftText('2026-11-23')).toBe('이번 주 7일 남음');
    expect(d.raceWeekLeftText('')).toBe('');
  });

  it('등급: 주간은 순위 비율(shared/rank.js tierOfPlace), 최고 기록 탭만 1·2·3위 한 명씩', async () => {
    const d = await load();
    const rank = (await import(/* @vite-ignore */ rankPath)) as { tierOfPlace(p: number, total: number): string };
    // 20명 중: 1·2위 해(10%), 3~6위 달(30%), 7~12위 별(60%), 나머지 구름
    expect([1, 2, 3, 6, 7, 12, 13].map((p) => rank.tierOfPlace(p, 20))).toEqual(['gold', 'gold', 'silver', 'silver', 'bronze', 'bronze', 'white']);
    expect([1, 2, 3, 4].map((p) => d.raceTierOfPlace(p))).toEqual([1, 2, 3, 4].map((p) => tierOfPlace(p)));
  });
});
