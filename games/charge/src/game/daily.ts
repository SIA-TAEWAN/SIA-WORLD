import { BOSS_ART, BOSS_IDS, METER, type BossId } from '../data/balance';
import { ENDLESS_SEG, dailyBossShift } from '../data/stages';

/**
 * 오늘의 도전 — 오늘의 길 (공통 틀: shared/daily.js · 082_daily.sql, 기록: 085_charge_daily.sql).
 * 하루(한국 시간) 동안 모두 같은 코스를 달린다. 코스는 날짜 문자열에서 만든 씨앗 하나로 정해진다.
 * 점수 = 달린 거리(m). 여기는 순수 함수만 둔다 (서버 호출은 net/world.ts, 화면은 ui/app.ts).
 */

export const DAILY_GAME = 'charge';
const SALT = 'road';

/** shared/daily.js 의 dailySeed 와 같은 식 (FNV-1a 32비트). 공통 모듈을 못 불러올 때(테스트 모드 등)도 같은 코스가 나오게 여기에도 둔다 */
export function dailySeed(game: string, day: string, salt = ''): number {
  const s = `${game}:${day}:${salt}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 'YYYY-MM-DD' 인가 */
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 기기 시계로 만든 한국 날짜 (서버에 묻지 못할 때만) */
export const localDay = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** '2026-11-23' → '11월 23일' */
export const dayLabel = (day: string) => (isDay(day) ? `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일` : '');

export interface DailyCourse {
  day: string;
  /** 코스 씨앗 (dailyStage · endlessSegment 에 넘긴다) */
  seed: number;
  /** 처음 만나는 지역 보스 3마리: 나오는 거리(m)와 이름 */
  bosses: { meters: number; id: BossId; name: string }[];
}

/** 그날의 코스. seedFn 은 shared/daily.js 의 dailySeed (없으면 같은 식의 위 함수) */
export function dailyCourse(day: string, seedFn: (game: string, day: string, salt?: string) => number = dailySeed): DailyCourse {
  const seed = seedFn(DAILY_GAME, day, SALT) >>> 0;
  const shift = dailyBossShift(seed);
  // 지역 보스는 3구간마다 (stages.ts endlessSegment: k % 3 === 2)
  const bosses = [0, 1, 2].map((i) => {
    const id = BOSS_IDS[(i + shift) % BOSS_IDS.length];
    return { meters: Math.round(((i * 3 + 3) * ENDLESS_SEG) / METER), id, name: BOSS_ART[id].name };
  });
  return { day, seed, bosses };
}

export interface DailyRow {
  place: number;
  nickname: string;
  meters: number;
  kills: number;
  me: boolean;
}
export interface DailyRanking {
  day: string;
  /** 서버의 오늘 (답에 없으면 null) */
  today: string | null;
  top: DailyRow[];
  total: number;
  mine: { place: number; meters: number; kills: number; plays: number } | null;
}

const num = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/** daily_ranking 답 → 화면용 (모양이 이상하면 null: 화면은 조용히 숨긴다) */
export function normalizeDaily(v: unknown): DailyRanking | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { day?: unknown; today?: unknown; top?: unknown; mine?: unknown; total?: unknown };
  if (!isDay(o.day) || !Array.isArray(o.top)) return null;
  const top = (o.top as { place?: unknown; nickname?: unknown; score?: unknown; detail?: { kills?: unknown } | null; me?: unknown }[])
    .map((t) => ({ place: num(t?.place), nickname: String(t?.nickname ?? ''), meters: num(t?.score), kills: num(t?.detail?.kills), me: t?.me === true }))
    .filter((t) => t.place >= 1);
  const m = o.mine as { place?: unknown; score?: unknown; detail?: { kills?: unknown } | null; plays?: unknown } | null | undefined;
  const mine = m && num(m.place) >= 1 ? { place: num(m.place), meters: num(m.score), kills: num(m.detail?.kills), plays: num(m.plays) } : null;
  return { day: o.day, today: isDay(o.today) ? o.today : null, top, total: Math.max(top.length, num(o.total)), mine };
}

/** 순위의 날이 서버의 오늘이 아닌가 (자정을 넘겨 끝난 판 등). 서버의 오늘을 모르면 오늘로 본다 */
export const isPastDay = (r: DailyRanking) => r.today !== null && r.today !== r.day;

/** 결과 창 한 줄: "오늘 3위 · 12명 중". 기록된 날이 서버의 오늘이 아니면 날짜로: "11월 22일 3위 · 12명 중" */
export const placeText = (r: DailyRanking) => (r.mine ? `${isPastDay(r) ? dayLabel(r.day) : '오늘'} ${r.mine.place}위 · ${r.total.toLocaleString()}명 중` : '');
