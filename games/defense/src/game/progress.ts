import { COINS, STAR2_LIVES, WAVES, WAVE_SEC } from '../data/balance';
import { REGIONS } from '../data/regions';
import { STAGES, stageOf, stagesOf, type StageDef } from '../data/stages';

/**
 * 판 밖 진행 규칙 (별·잠금·엽전). 화면과 저장(net/api.ts)이 함께 쓴다.
 * 4단계에서 서버 함수(SQL)가 같은 규칙으로 결과를 정하게 되면, 이 파일이 그 규칙의 기기 쪽 사본이 된다
 * (시아서바이벌의 game/progress.ts ↔ _survival_const 와 같은 방식).
 */

/** 별 평가 (PRD 3장): ★ 클리어 · ★★ 생명 10 이상 · ★★★ 생명을 하나도 잃지 않음 */
export function starsOf(cleared: boolean, lives: number, startLives: number): 0 | 1 | 2 | 3 {
  if (!cleared || lives <= 0) return 0;
  if (lives >= startLives) return 3;
  return lives >= STAR2_LIVES ? 2 : 1;
}

/** 저장되는 진행 상황 (PRD 11장의 defense_profiles · defense_stages 가운데 1~3단계에 필요한 것) */
export interface DefenseProfile {
  coins: number;
  /** 스테이지 id → 별 (클리어한 스테이지만) */
  stages: Record<string, number>;
}

export const defaultProfile = (): DefenseProfile => ({ coins: 0, stages: {} });

/** 저장된 값을 믿을 수 있는 모양으로 고친다 */
export function cleanProfile(raw: unknown): DefenseProfile {
  const d = (raw ?? {}) as Partial<DefenseProfile>;
  const stages: Record<string, number> = {};
  if (d.stages && typeof d.stages === 'object') {
    for (const [id, v] of Object.entries(d.stages)) {
      const n = Math.floor(Number(v));
      if (stageOf(id) && n >= 1) stages[id] = Math.min(3, n);
    }
  }
  return { coins: Math.max(0, Math.floor(Number(d.coins)) || 0), stages };
}

export const totalStars = (p: DefenseProfile) => Object.values(p.stages).reduce((a, b) => a + b, 0);
export const clearedCount = (p: DefenseProfile) => Object.keys(p.stages).length;
export const regionStars = (p: DefenseProfile, region: number) => stagesOf(region).reduce((a, s) => a + (p.stages[s.id] ?? 0), 0);
/** 그 지역의 스테이지를 모두 클리어했나 (스테이지 데이터가 없는 지역은 false) */
export function regionCleared(p: DefenseProfile, region: number): boolean {
  const list = stagesOf(region);
  return list.length > 0 && list.every((s) => p.stages[s.id] !== undefined);
}

/** 지역이 열렸나: 1지역은 처음부터, 그 뒤는 앞 지역 보스 클리어 + 필요 별 (PRD 6장) */
export function regionOpen(p: DefenseProfile, region: number): boolean {
  if (region <= 1) return true;
  const def = REGIONS[region - 1];
  return !!def && regionCleared(p, region - 1) && totalStars(p) >= def.stars;
}

/** 스테이지가 열렸나: 지역이 열려 있고, 그 지역의 앞 스테이지를 클리어했다 */
export function stageOpen(p: DefenseProfile, stage: StageDef): boolean {
  if (!regionOpen(p, stage.region)) return false;
  return stage.no <= 1 || p.stages[`${stage.region}-${stage.no - 1}`] !== undefined;
}

/** 끝없는 모드(끝없는 고개)는 1지역을 클리어하면 열린다 (모드 자체는 7단계) */
export const endlessOpen = (p: DefenseProfile) => regionCleared(p, 1);

/** 판이 끝났을 때 저장하러 보내는 것 */
export interface RunReport {
  stage: string;
  cleared: boolean;
  /** 남은 생명 · 시작 생명 */
  lives: number;
  startLives: number;
  /** 판이 끝난 시각 (초) */
  time: number;
  kills: number;
}

/** 저장 결과 (결과 화면에 보여 준다) */
export interface FinishResult {
  /** 이번 판의 별 · 지금까지의 최고 별 · 이번에 새로 딴 별 수 */
  stars: number;
  bestStars: number;
  newStars: number;
  firstClear: boolean;
  /** 받은 엽전: 합계 = 기본(클리어 보상 또는 실패·포기 때의 일부) + 첫 클리어 보상 + 별 보상 */
  coins: number;
  baseCoins: number;
  firstCoins: number;
  starCoins: number;
  /** 이 판으로 새로 열린 스테이지 id (없으면 null) */
  opened: string | null;
}

/** 실패·포기한 판의 엽전: 클리어 보상의 일부 × 끝낸 웨이브 비율 (PRD 3장: 포기해도 그때까지 얻은 엽전 일부 지급) */
export function partialCoins(stage: StageDef, time: number): number {
  const done = Math.max(0, Math.min(WAVES, Math.floor(time / WAVE_SEC)));
  return Math.floor(stage.coins * COINS.failRate * (done / WAVES));
}

/** 판 결과를 진행 상황에 반영한다 → 새 진행 상황과 결과. 모르는 스테이지·잠긴 스테이지면 오류 */
export function applyRun(p: DefenseProfile, r: RunReport): { profile: DefenseProfile; result: FinishResult } {
  const stage = stageOf(r.stage);
  if (!stage) throw new Error('no stage');
  if (!stageOpen(p, stage)) throw new Error('stage locked');
  const stars = starsOf(r.cleared, r.lives, r.startLives);
  const before = p.stages[stage.id] ?? 0;
  const firstClear = stars > 0 && before === 0;
  const newStars = Math.max(0, stars - before);
  const baseCoins = stars > 0 ? stage.coins : partialCoins(stage, r.time);
  const firstCoins = firstClear ? stage.firstCoins : 0;
  const starCoins = newStars * COINS.perStar;
  const coins = baseCoins + firstCoins + starCoins;
  const stages = stars > before ? { ...p.stages, [stage.id]: stars } : p.stages;
  const profile: DefenseProfile = { coins: p.coins + coins, stages };
  // 새로 열린 스테이지: 이 판 전에는 잠겨 있었고 지금은 열린 것 가운데 첫 번째
  const opened = firstClear ? (STAGES.find((x) => !stageOpen(p, x) && stageOpen(profile, x))?.id ?? null) : null;
  return { profile, result: { stars, bestStars: Math.max(before, stars), newStars, firstClear, coins, baseCoins, firstCoins, starCoins, opened } };
}
