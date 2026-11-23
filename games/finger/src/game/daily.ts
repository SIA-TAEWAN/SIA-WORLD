import { expectLevel } from '../data/balance';
import { HERO_IDS, HEROES, STAGES, isHeroId, stageOf, type HeroId, type RunResult, type RunSnapshot } from '../sim';

/**
 * 오늘의 도전 (공통 틀: supabase/migrations/082_daily.sql · shared/daily.js, 시아핑거 쪽: 086_finger_daily.sql).
 * 하루(한국 시간) 동안 모두 같은 스테이지를 같은 파티 · 같은 레벨 · 강화 없이 겨룬다. 턴 수가 적을수록 위.
 * 조건은 날짜 글자에서만 만든다 (모든 기기에서 같다). 이 파일은 순수 함수뿐이다 (tests/daily.test.ts).
 */

export const DAILY_GAME = 'finger';
/** 오늘의 스테이지를 고르는 가장 앞 지역 (1지역은 너무 쉽다) */
export const DAILY_FROM_REGION = 2;
/** 오늘의 파티 인원 */
export const DAILY_PARTY = 4;

export type SeedFn = (game: string, day: string, salt?: string) => number;

/** shared/daily.js 의 dailySeed 와 같은 식 (FNV-1a 32비트). 공통 모듈을 못 불렀을 때 · 테스트 모드 · 테스트에서 쓴다 */
export const dailySeed: SeedFn = (game, day, salt = '') => {
  const s = `${game}:${day}:${salt}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/** 기기 시계로 만든 한국 날짜 'YYYY-MM-DD' (테스트 모드 · 서버를 못 부를 때) */
export const localDay = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

export const isDay = (day: unknown): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);

export interface DailyChallenge {
  day: string;
  /** 스테이지 id (2~12지역) */
  stage: string;
  /** 쏘는 순서대로 4명 (십이지만, 관통형 · 반사형이 적어도 하나씩) */
  party: HeroId[];
  /** 모든 대원의 레벨 = 그 지역의 예상 레벨 (data/balance.ts). 공통 강화는 없다 */
  level: number;
}

/** 오늘 고를 수 있는 스테이지 (지역 2부터, 스테이지 데이터 순서) */
export const dailyStages = () => STAGES.filter((s) => s.region >= DAILY_FROM_REGION);

/** 지역 → 오늘의 도전 레벨 (SQL _finger_daily_level 과 같다: tests/sql.test.ts) */
export const dailyLevel = (region: number) => expectLevel(region);

/** 십이지 12명 가운데 4명을 시드로 섞어 뽑는다 (피셔-예이츠 앞 4칸, 칸마다 다른 소금) */
function pickParty(day: string, seed: SeedFn, round: number): HeroId[] {
  const pool: HeroId[] = [...HERO_IDS];
  for (let i = 0; i < DAILY_PARTY; i++) {
    const j = i + (seed(DAILY_GAME, day, `party${round}:${i}`) % (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, DAILY_PARTY);
}

/** 날짜 → 그날의 조건. 같은 날짜면 어느 기기에서나 같다 */
export function dailyChallenge(day: string, seed: SeedFn = dailySeed): DailyChallenge {
  const list = dailyStages();
  const st = list[seed(DAILY_GAME, day, 'stage') % list.length];
  let party: HeroId[] = [];
  // 한 타입만 뽑혔으면 다시 뽑는다 (8번까지 — 그래도 안 되면 그대로)
  for (let round = 0; round < 8; round++) {
    party = pickParty(day, seed, round);
    if (new Set(party.map((id) => HEROES[id].type)).size > 1) break;
  }
  return { day, stage: st.id, party, level: dailyLevel(st.region) };
}

/** 조건 → 대원별 레벨 (buildConfig 입력) */
export const dailyLevels = (c: DailyChallenge): Partial<Record<HeroId, number>> => Object.fromEntries(c.party.map((id) => [id, c.level]));

/** 조건 → 다시 돌리기 스냅숏 (서버 finger_daily_start 가 finger_runs 에 남기는 값과 같다: 보통 판 모양, 강화 없음) */
export const dailySnapshot = (c: DailyChallenge): RunSnapshot => ({
  stage: c.stage,
  mode: 'normal',
  party: [...c.party],
  levels: Object.fromEntries(c.party.map((id) => [id, c.level])),
  upgrades: {},
});

/** 조건이 제대로인가 (서버 finger_daily_start 와 같은 기준) → 틀리면 까닭 */
export function checkDaily(c: DailyChallenge): string | null {
  if (!isDay(c.day)) return 'bad day';
  const st = stageOf(c.stage);
  if (!st || st.region < DAILY_FROM_REGION) return 'bad stage';
  if (!Array.isArray(c.party) || c.party.length !== DAILY_PARTY || new Set(c.party).size !== DAILY_PARTY) return 'bad party';
  if (!c.party.every((id) => isHeroId(id) && (HERO_IDS as readonly string[]).includes(id))) return 'bad party';
  return null;
}

/** 점수 (클수록 좋음): 클리어한 판만, −턴 수. 못 깼으면 null (기록하지 않는다) */
export const dailyScore = (r: Pick<RunResult, 'cleared' | 'turns'>): number | null => (r.cleared && r.turns > 0 ? -r.turns : null);

/** 순위표 한 줄의 글: "12턴" (+ 쓰러진 대원이 있으면 " · 쓰러짐 1") */
export function dailyDetailText(score: number, detail: unknown): string {
  const d = (detail ?? {}) as { turns?: unknown; fallen?: unknown };
  const turns = Number(d.turns) > 0 ? Number(d.turns) : Math.abs(Number(score) || 0);
  const fallen = Math.max(0, Math.floor(Number(d.fallen) || 0));
  return `${turns}턴${fallen > 0 ? ` · 쓰러짐 ${fallen}` : ''}`;
}

/** 서버 daily_ranking 의 모양 (shared/daily.js loadDailyRanking) */
export interface DailyRanking {
  day: string;
  today: string;
  top: { place: number; nickname: string; score: number; detail: unknown; me: boolean }[];
  mine: { place: number; score: number; detail: unknown; plays: number } | null;
  total: number;
}

/** 'YYYY-MM-DD' → '11월 23일' */
export const dayLabel = (day: string) => (isDay(day) ? `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일` : '');
