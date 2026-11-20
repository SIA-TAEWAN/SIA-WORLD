import type { PilotOptions } from '../game/autopilot';
import { HERO_IDS, HEROES, type HeroId } from '../sim';

/**
 * 밸런스 곡선 (PRD "밸런스 목표"): 1~5지역은 강화 없이(레벨 1~초반) 깨지고, 6지역부터는 레벨을 올려야 깨진다.
 * 지역별 '예상 레벨' = 그 지역에 처음 들어갈 때 4단계 보상·가격표로 모을 수 있는 엽전으로 파티 4명을 올린 레벨 (구현 메모 참고).
 * 밸런스 보정(npm run calib)은 자동 플레이어를 예상 레벨보다 낮게(testLevel) 두고 깨지도록 요괴 체력을 맞춘다
 * — 자동 플레이어는 한 턴을 끝까지 내다보므로 사람보다 강하다.
 */

/** 지역 1~12 의 예상 레벨 */
export const EXPECT_LEVEL = [1, 2, 3, 4, 5, 8, 11, 14, 17, 19, 22, 25];

export const expectLevel = (region: number) => EXPECT_LEVEL[Math.max(1, Math.min(12, region)) - 1];

/** 자동 플레이어 여유: 1~5지역은 2레벨, 6~8지역은 3레벨, 9지역부터는 5레벨 낮춰서도 깨야 한다 (8단계: 사람 흉내 측정에서 늦은 지역이 너무 어려웠다) */
export const testLevel = (region: number) => Math.max(1, expectLevel(region) - (region <= 5 ? 2 : region <= 8 ? 3 : 5));

/** 레벨 배율 (heroes.ts heroStats 와 같은 식: 레벨당 +4%) */
export const levelGrow = (lv: number) => 1 + 0.04 * (lv - 1);

/** 요괴 공격 배율: 예상 레벨의 대원 체력에 맞추고, 지역마다 1.5%씩 더 아프게 (8단계: 3% 는 사람에게 늦은 지역 전멸이 잦았다) */
/** 지역별 공격 덜기: 사람 흉내 측정에서 전멸이 유독 잦은 지역 (10 저승사자 되살아남·연속 공격, 12 염라대왕 부르기·불길) */
export const ATK_EASE: Partial<Record<number, number>> = { 10: 0.75, 12: 0.8 };
export const atkMulOf = (region: number) => Math.round(levelGrow(expectLevel(region)) * (1 + 0.015 * (region - 1)) * (ATK_EASE[region] ?? 1) * 100) / 100;

/** 그 지역을 처음 할 때 열려 있는 대원 (n지역 5번째를 깨면 합류 → n+1지역부터) */
export const heroesOpenAt = (region: number): HeroId[] => HERO_IDS.filter((id) => HEROES[id].unlockRegion < region);

/** 보정용 파티: 그때 열린 대원 중 가장 늦게 합류한 4명 (합류 순서대로 쏜다) */
export const partyFor = (region: number): HeroId[] => heroesOpenAt(region).slice(-4);

/** 보정 목표: 자동 플레이어가 testLevel 에서 이 턴 안에 깨는 가장 큰 요괴 체력 */
export const TURN_GOAL = { normal: 17, boss: 20 };
/** 이 지역부터는 요괴 공격 배율도 보정한다: testLevel 에서 통과하고 예상 레벨에서도 깨는 가장 센 공격까지 올린 몫의 ATK_KEEP 만큼 */
export const ATK_FROM = 6;
export const ATK_KEEP = 0;
/**
 * 보정에 쓰는 자동 플레이어 (8단계): 각도를 30° 간격으로만 보고 힘은 둘. 기본 자동 플레이어(10° 간격 · 힘 셋)는
 * 사람보다 너무 강해서, 그 기준으로 맞춘 판은 사람이 예상 레벨에서 30턴 넘게 걸리거나 6지역부터 거의 못 깼다.
 */
export const CALIB_PILOT: PilotOptions = { coarse: 300, powers: [60, 100] };
/** 별 기준 턴 = max(testLevel 턴, 예상 레벨 턴 + PAR_SLACK) */
export const PAR_SLACK = 7;

/** 끝없는 탑을 재는 파티 (scripts/tower.ts · tests): 레벨 level 이 예상 레벨인 가장 늦은 지역(2지역 이상 — 탑은 1-5 를 깨야 열린다)에 들어갈 때의 파티 */
export function towerParty(level: number): HeroId[] {
  let region = 2;
  for (let r = 2; r <= 12; r++) if (expectLevel(r) <= level) region = r;
  return partyFor(region);
}
