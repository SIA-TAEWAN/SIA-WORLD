/**
 * 오늘의 도전: SIA WORLD 공통 모듈(shared/daily.js)을 실행 중에 불러와 쓴다 (빌드에 넣지 않는다: 로비와 같은 로그인 세션).
 * 테스트 모드(?local=1)는 서버 없이 기기 시계의 날짜와 조건만으로 한다 (순위 없음).
 * 조건 계산은 game/daily.ts (순수 함수).
 */
import { DAILY_GAME, cleanDailyRanking, dailyChallenge, dailySeed, isDay, localDay, type DailyChallenge, type DailyRanking } from '../game/daily';
import { LOCAL_MODE } from './api';

interface DailyModule {
  dailyToday(): Promise<string>;
  dailySeed(game: string, day: string, salt?: string): number;
  loadDailyRanking(game: string, day?: string | null): Promise<unknown>;
}

let mod: Promise<DailyModule> | null = null;
function shared(): Promise<DailyModule> {
  mod ??= import(/* @vite-ignore */ new URL('shared/daily.js', new URL('../../', document.baseURI)).href) as Promise<DailyModule>;
  mod.catch(() => (mod = null));
  return mod;
}

/** 오늘의 조건 (날짜는 서버의 한국 날짜). 공통 모듈을 못 불러오면 null → 화면은 안내하고 돌아간다 */
export async function loadDailyChallenge(): Promise<DailyChallenge | null> {
  if (LOCAL_MODE) return dailyChallenge(localDay());
  try {
    const m = await shared();
    const day = await m.dailyToday();
    if (!isDay(day)) return null;
    return dailyChallenge(day, typeof m.dailySeed === 'function' ? m.dailySeed : dailySeed);
  } catch {
    return null;
  }
}

/** 그날 순위 (상위 50명 + 내 기록). 못 읽으면 null (던지지 않는다). 테스트 모드에는 순위가 없다 */
export async function loadDailyRank(day: string): Promise<DailyRanking | null> {
  if (LOCAL_MODE) return null;
  try {
    return cleanDailyRanking(await (await shared()).loadDailyRanking(DAILY_GAME, day));
  } catch {
    return null;
  }
}
