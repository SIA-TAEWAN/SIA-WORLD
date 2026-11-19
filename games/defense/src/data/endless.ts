import { BOSSES } from './bosses';
import type { GroupDef, StageDef, WaveDef } from './stages';

/**
 * 끝없는 모드 — 끝없는 고개 (PRD 6장). 1지역을 클리어하면 열린다.
 * 3분 제한 없이 30초짜리 웨이브가 끝없이 이어지고 점점 강해진다. 생명이 0이 될 때까지 버티고, 도달한 웨이브가 기록된다.
 * 맵은 하나(아래)이고, 웨이브는 미리 적어 두지 않고 웨이브 번호로 그때그때 만든다 (endlessWave: 같은 번호면 언제나 같은 웨이브 — 난수를 쓰지 않는다).
 * 엽전 규칙의 값은 서버(048_defense.sql 의 _defense_const)와 같아야 한다 (game/progress.ts 의 LIMITS, tests/sql.test.ts).
 */
export const ENDLESS_ID = 'endless';

export const ENDLESS_STAGE: StageDef = {
  id: ENDLESS_ID, region: 0, no: 0, name: '끝없는 고개', energy: 300, hp: 1,
  // 세 번 굽이치는 긴 길 + 공중 경로
  routes: [
    { id: 'main', pts: [[-1, 1], [7, 1], [7, 4], [1, 4], [1, 7], [7, 7], [7, 9], [4, 9], [4, 11]] },
    { id: 'air', air: true, pts: [[-1, -1], [4, 11]] },
  ],
  slots: [[2, 2], [4, 2], [6, 2], [8, 2], [3, 3], [5, 3], [0, 5], [2, 5], [4, 5], [6, 5], [3, 6], [5, 6], [3, 8], [5, 8], [6, 8], [8, 8], [3, 10], [5, 10]],
  waves: [],
  coins: 0, firstCoins: 0,
};

/** 웨이브 번호(0부터)가 이 값 이상이면 그 요괴가 나오기 시작한다 */
const FROM: [string, number][] = [['imp', 0], ['wisp', 1], ['club', 3], ['water', 5], ['fox', 7], ['bamboo', 9], ['guard', 11], ['skeleton', 13], ['spirit', 15]];
/** 요괴 한 마리의 무게 (꼬마 도깨비 = 1): 웨이브 예산을 마릿수로 바꾼다 */
const WEIGHT: Record<string, number> = { imp: 1, wisp: 0.6, club: 3.6, water: 2, fox: 1, bamboo: 1.5, guard: 3, skeleton: 2, spirit: 1.5 };
/** 보스는 이 웨이브마다 (5번째, 10번째 …) */
export const ENDLESS_BOSS_EVERY = 5;

/** w번째 웨이브(0부터)의 요괴 무리와 체력 배율 */
export function endlessWave(w: number): WaveDef {
  const pool = FROM.filter(([, from]) => w >= from).map(([id]) => id);
  // 웨이브마다 마릿수가 조금씩 늘어난다
  const budget = 10 * (1 + 0.16 * w);
  const kinds = Math.min(pool.length, w === 0 ? 1 : w < 6 ? 2 : 3);
  const picked: string[] = [];
  for (let k = 0; picked.length < kinds; k++) {
    // 새로 나온 요괴(묶음의 끝)를 자주, 나머지는 번호에 따라 돌아가며
    const id = k === 0 ? pool[pool.length - 1 - (w % Math.min(3, pool.length))] : pool[(w * 5 + k * 3) % pool.length];
    if (!picked.includes(id)) picked.push(id);
  }
  const share = kinds === 1 ? [1] : kinds === 2 ? [0.58, 0.42] : [0.45, 0.32, 0.23];
  const groups: GroupDef[] = picked.map((enemy, k) => {
    const count = Math.max(2, Math.round((budget * share[k]) / WEIGHT[enemy]));
    const at = k === 0 ? (w === 0 ? 2 : 0) : Math.round((28 * k) / kinds - 2);
    return { enemy, count, at, gap: Math.max(0.35, Math.min(2.4, Math.floor(((27.5 - at) / count) * 10) / 10)) };
  });
  // 체력은 웨이브마다 일정하게 더해진다 (곱으로 늘리면 캐릭터 레벨의 차이가 한두 웨이브로 줄어든다)
  return { groups, hp: 1.1 + 0.45 * w };
}

/** w번째 웨이브에 나오는 보스 (없으면 null): 보스 번호와 체력 배율. 12종이 차례로 돌아가며 한 바퀴 돌 때마다 더 단단해진다 */
export function endlessBoss(w: number): { boss: number; hp: number } | null {
  if ((w + 1) % ENDLESS_BOSS_EVERY !== 0) return null;
  const n = (w + 1) / ENDLESS_BOSS_EVERY - 1;
  return { boss: n % BOSSES.length, hp: 0.8 * 1.3 ** n };
}

/** 끝없는 모드의 엽전: 넘긴 웨이브마다, 상한까지 */
export const ENDLESS_COINS = { perWave: 8, cap: 320 };
/** 시간 상한 (초): 웨이브 120 */
export const ENDLESS_MAX_SEC = 3600;
