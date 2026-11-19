import { COINS, STAR2_LIVES, START_LIVES, SQUAD_SIZE, WAVES, WAVE_SEC, ZODIAC_IDS, type ZodiacId } from '../data/balance';
import { ROSTER, STARTERS } from '../data/characters';
import { CHAR_MAX_LV, UPGRADES, levelCost, upgradeCost, upgradeMods, upgradeOf, type Upgrades } from '../data/growth';
import { REGIONS } from '../data/regions';
import { STAGES, stageOf, stagesOf, type StageDef } from '../data/stages';

/**
 * 판 밖 진행 규칙 (별·잠금·엽전·레벨업·강화·해금). 서버 함수(supabase/migrations/048_defense.sql)와 같은 규칙의 기기 쪽 사본이다:
 * 화면은 이 규칙으로 잠금·비용을 미리 보여 주고, 테스트 모드(LocalApi)는 이 규칙으로 저장한다. 실제 값은 서버가 정한다.
 * 검증 상수(LIMITS)는 SQL 의 _defense_const 와 같아야 한다 — tests/sql.test.ts 가 비교한다.
 */

/** 판 검증에 쓰는 값 (SQL 의 _defense_const) */
export const LIMITS = {
  /** 한 판의 시간 상한 (초): 3분 + 남은 요괴·보스 처리 */
  max_time: 900,
  /** 클리어한 판의 최소 시간 (3분 타이머) */
  clear_min_time: 180,
  /** 가장 빠른 배속 */
  max_speed: 2,
  /** 서버가 잰 경과 시간이 (판 시간 ÷ 배속)보다 이만큼까지는 짧아도 된다 */
  time_slack: 15,
  /** 시작 뒤 7일이 지난 판은 받지 않는다 */
  max_age: 604800,
  /** 이보다 짧은 판은 아무것도 주지 않는다 */
  count_min_time: 20,
  /** 시아코인은 60초 넘게 (실제 경과도) 진행한 판에만 */
  coin_min_time: 60,
  /** 끝내지 않은 판은 5개까지 둔다 */
  open_runs: 5,
  /** 처치 수 상한 = kills_base + 판 시간 × kills_per_sec (넘으면 비정상 판) */
  kills_base: 50,
  kills_per_sec: 4,
  /** 배치 횟수·명령 수 상한 */
  placed_max: 400,
  cmds_max: 3000,
  /** 3단계 돼지가 벌어 주는 엽전의 한 판 상한 */
  bonus_max: 12,
} as const;

/** 별 평가 (PRD 3장): ★ 클리어 · ★★ 생명 10 이상 · ★★★ 생명을 하나도 잃지 않음 */
export function starsOf(cleared: boolean, lives: number, startLives: number): 0 | 1 | 2 | 3 {
  if (!cleared || lives <= 0) return 0;
  if (lives >= startLives) return 3;
  return lives >= STAR2_LIVES ? 2 : 1;
}

/** 저장되는 진행 상황 (PRD 11장의 defense_profiles · defense_stages) */
export interface DefenseProfile {
  coins: number;
  /** 스테이지 id → 별 (클리어한 스테이지만) */
  stages: Record<string, number>;
  /** 캐릭터 영구 레벨 (없으면 1) */
  levels: Partial<Record<ZodiacId, number>>;
  upgrades: Upgrades;
  /** 쓸 수 있는 캐릭터 */
  unlocked: ZodiacId[];
}

export const defaultProfile = (): DefenseProfile => ({ coins: 0, stages: {}, levels: {}, upgrades: {}, unlocked: [...STARTERS] });

const isZodiac = (c: unknown): c is ZodiacId => typeof c === 'string' && (ZODIAC_IDS as readonly string[]).includes(c);

/** 저장된 값(또는 서버 답)을 믿을 수 있는 모양으로 고친다 */
export function cleanProfile(raw: unknown): DefenseProfile {
  const d = (raw ?? {}) as Partial<DefenseProfile>;
  const stages: Record<string, number> = {};
  if (d.stages && typeof d.stages === 'object') {
    for (const [id, v] of Object.entries(d.stages)) {
      const n = Math.floor(Number(v));
      if (stageOf(id) && n >= 1) stages[id] = Math.min(3, n);
    }
  }
  const levels: DefenseProfile['levels'] = {};
  if (d.levels && typeof d.levels === 'object') {
    for (const [id, v] of Object.entries(d.levels)) {
      const n = Math.floor(Number(v));
      if (isZodiac(id) && n > 1) levels[id] = Math.min(CHAR_MAX_LV, n);
    }
  }
  const upgrades: Upgrades = {};
  if (d.upgrades && typeof d.upgrades === 'object') {
    for (const u of UPGRADES) {
      const n = Math.floor(Number((d.upgrades as Record<string, unknown>)[u.id]));
      if (n >= 1) upgrades[u.id] = Math.min(u.max, n);
    }
  }
  const got = Array.isArray(d.unlocked) ? d.unlocked.filter(isZodiac) : [];
  // 띠 순서로, 처음 4종은 늘 들어 있다
  const unlocked = ROSTER.map((r) => r.id).filter((id) => STARTERS.includes(id) || got.includes(id));
  return { coins: Math.max(0, Math.floor(Number(d.coins)) || 0), stages, levels, upgrades, unlocked };
}

export const totalStars = (p: DefenseProfile) => Object.values(p.stages).reduce((a, b) => a + b, 0);
export const clearedCount = (p: DefenseProfile) => Object.keys(p.stages).length;
export const regionStars = (p: DefenseProfile, region: number) => stagesOf(region).reduce((a, s) => a + (p.stages[s.id] ?? 0), 0);
export const charLevel = (p: DefenseProfile, id: ZodiacId) => p.levels[id] ?? 1;
export const upgradeLevel = (p: DefenseProfile, id: string) => (p.upgrades as Record<string, number | undefined>)[id] ?? 0;
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

/** 이 판의 시작 생명 (공통 강화 포함). 서버는 판을 시작할 때 이 값을 적어 둔다 */
export const startLivesOf = (stage: StageDef, up: Upgrades | undefined) => (stage.lives ?? START_LIVES) + upgradeMods(up).lives;

/** 출전 명단이 올바른가: 1~5종, 겹치지 않고, 모두 해금된 캐릭터 */
export function squadOk(p: DefenseProfile, squad: readonly string[]): boolean {
  return squad.length >= 1 && squad.length <= SQUAD_SIZE && new Set(squad).size === squad.length && squad.every((c) => isZodiac(c) && p.unlocked.includes(c));
}

/** 판이 끝났을 때 저장하러 보내는 것 */
export interface RunReport {
  /** 판 id (판을 시작할 때 서버가 준다) */
  run: string;
  stage: string;
  cleared: boolean;
  /** 남은 생명 · 시작 생명 */
  lives: number;
  startLives: number;
  /** 판이 끝난 시각 (초) */
  time: number;
  kills: number;
  /** 배치한 횟수 · 명령 수 (싼 정합성 검사용) */
  placed: number;
  cmds: number;
  /** 3단계 돼지가 벌어 준 엽전 */
  bonus: number;
}

/** 저장 결과 (결과 화면에 보여 준다) */
export interface FinishResult {
  /** 이번 판의 별 · 지금까지의 최고 별 · 이번에 새로 딴 별 수 */
  stars: number;
  bestStars: number;
  newStars: number;
  firstClear: boolean;
  /** 받은 엽전: 합계 = (기본 + 첫 클리어 + 별 + 돼지) × 엽전 획득 강화 */
  coins: number;
  baseCoins: number;
  firstCoins: number;
  starCoins: number;
  /** 이 판으로 새로 열린 스테이지 id (없으면 null) · 새로 해금된 캐릭터 */
  opened: string | null;
  unlocked: ZodiacId[];
  /** 정상 범위의 판인가 (아니면 아무것도 받지 못한다) */
  valid: boolean;
}

/** 실패·포기한 판의 엽전: 클리어 보상 × 끝낸 웨이브 수 ÷ 15 (= 40% × 끝낸 웨이브 / 6). PRD 3장: 포기해도 일부 지급 */
export function partialCoins(stage: StageDef, time: number): number {
  const done = Math.max(0, Math.min(WAVES, Math.floor(time / WAVE_SEC)));
  return Math.floor((stage.coins * done) / COINS.failDiv);
}

/**
 * 받을 수 없는 판이면 그 까닭 (서버의 raise exception 글자와 같다), 받을 수 있으면 null.
 * elapsed: 판을 시작한 뒤 실제로 흐른 시간(초). startLives: 시작할 때 적어 둔 시작 생명
 */
export function rejectReason(r: RunReport, elapsed: number, startLives: number): string | null {
  const ints = [r.time, r.lives, r.kills, r.placed, r.cmds, r.bonus];
  if (ints.some((v) => !Number.isInteger(v))) return 'bad result';
  if (r.time < 0 || r.time > LIMITS.max_time) return 'bad time';
  if (r.lives < 0 || r.lives > startLives || r.kills < 0 || r.placed < 0 || r.cmds < 0 || r.bonus < 0) return 'bad result';
  if (r.placed > LIMITS.placed_max || r.cmds > LIMITS.cmds_max || r.placed > r.cmds) return 'bad result';
  // 클리어: 3분을 채웠고, 생명이 남았고, 캐릭터를 하나 이상 놓았다 (시작 명령 + 배치 명령)
  if (r.cleared && (r.time < LIMITS.clear_min_time || r.lives < 1 || r.placed < 1 || r.cmds < 2)) return 'bad result';
  if (elapsed < r.time / LIMITS.max_speed - LIMITS.time_slack) return 'too early';
  if (elapsed > LIMITS.max_age) return 'too late';
  return null;
}

/** 정상 범위의 판인가 (처치 수 상한) */
export const isValid = (r: RunReport) => r.kills <= LIMITS.kills_base + r.time * LIMITS.kills_per_sec;

/** 판 하나가 실제로 쓴 최소 시간 (초): 가장 빠른 배속 기준 (겹치는 판 확인용) */
export const minRealTime = (time: number) => Math.max(0, time / LIMITS.max_speed - LIMITS.time_slack);

/** 판 결과를 진행 상황에 반영한다 → 새 진행 상황과 결과. 모르는 스테이지·잠긴 스테이지면 오류 */
export function applyRun(p: DefenseProfile, r: RunReport, squad: readonly string[] = []): { profile: DefenseProfile; result: FinishResult } {
  const stage = stageOf(r.stage);
  if (!stage) throw new Error('bad stage');
  if (!stageOpen(p, stage)) throw new Error('stage locked');
  const before = p.stages[stage.id] ?? 0;
  const valid = isValid(r);
  // 너무 짧은 판·비정상 판: 아무것도 주지 않는다
  if (!valid || r.time < LIMITS.count_min_time) {
    return { profile: p, result: { stars: 0, bestStars: before, newStars: 0, firstClear: false, coins: 0, baseCoins: 0, firstCoins: 0, starCoins: 0, opened: null, unlocked: [], valid } };
  }
  const stars = starsOf(r.cleared, r.lives, r.startLives);
  const firstClear = stars > 0 && before === 0;
  const newStars = Math.max(0, stars - before);
  const baseCoins = stars > 0 ? stage.coins : partialCoins(stage, r.time);
  const firstCoins = firstClear ? stage.firstCoins : 0;
  const starCoins = newStars * COINS.perStar;
  // 3단계 돼지가 벌어 준 엽전: 돼지를 데려간 판에서만, 상한까지
  const bonus = squad.includes('pig') ? Math.min(LIMITS.bonus_max, r.bonus) : 0;
  const coins = Math.floor(((baseCoins + firstCoins + starCoins + bonus) * (100 + upgradeMods(p.upgrades).coinPct)) / 100);
  const stages = stars > before ? { ...p.stages, [stage.id]: stars } : p.stages;
  // 캐릭터 해금: 그 지역의 보스 스테이지를 처음 클리어했을 때 (PRD 4장)
  const unlocked: ZodiacId[] = [];
  if (firstClear && stage.no === 5) {
    for (const c of ROSTER) if (c.unlockRegion === stage.region && !p.unlocked.includes(c.id)) unlocked.push(c.id);
  }
  const profile: DefenseProfile = { ...p, coins: p.coins + coins, stages, unlocked: ROSTER.map((c) => c.id).filter((id) => p.unlocked.includes(id) || unlocked.includes(id)) };
  // 새로 열린 스테이지: 이 판 전에는 잠겨 있었고 지금은 열린 것 가운데 첫 번째
  const opened = firstClear ? (STAGES.find((x) => !stageOpen(p, x) && stageOpen(profile, x))?.id ?? null) : null;
  return { profile, result: { stars, bestStars: Math.max(before, stars), newStars, firstClear, coins, baseCoins, firstCoins, starCoins, opened, unlocked, valid } };
}

/** 새로 열린 스테이지 (서버 답에는 없어서 앞뒤 진행 상황을 비교해 찾는다) */
export const openedBy = (before: DefenseProfile, after: DefenseProfile): string | null =>
  STAGES.find((x) => !stageOpen(before, x) && stageOpen(after, x))?.id ?? null;

/** 캐릭터 레벨업 → 새 진행 상황. 안 되면 오류(까닭) */
export function levelUp(p: DefenseProfile, id: string): DefenseProfile {
  if (!isZodiac(id)) throw new Error('bad character');
  if (!p.unlocked.includes(id)) throw new Error('character locked');
  const cost = levelCost(charLevel(p, id));
  if (cost === null) throw new Error('max level');
  if (p.coins < cost) throw new Error('not enough coins');
  return { ...p, coins: p.coins - cost, levels: { ...p.levels, [id]: charLevel(p, id) + 1 } };
}

/** 공통 강화 한 단계 → 새 진행 상황. 안 되면 오류(까닭) */
export function buyUpgrade(p: DefenseProfile, key: string): DefenseProfile {
  const u = upgradeOf(key);
  if (!u) throw new Error('bad upgrade');
  const cost = upgradeCost(key, upgradeLevel(p, key));
  if (cost === null) throw new Error('max level');
  if (p.coins < cost) throw new Error('not enough coins');
  return { ...p, coins: p.coins - cost, upgrades: { ...p.upgrades, [u.id]: upgradeLevel(p, key) + 1 } };
}
