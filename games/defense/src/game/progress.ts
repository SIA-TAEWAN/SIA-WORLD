import { COINS, STAR2_LIVES, START_LIVES, SQUAD_SIZE, WAVES, WAVE_SEC, CHAR_IDS, type CharId } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { EXTRAS, ROSTER, STARTERS } from '../data/characters';
import { ENDLESS_ID } from '../data/endless';
import { ENEMIES } from '../data/enemies';
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
  /** 끝내지 않은 판은 20개까지 둔다 (보류했다가 다시 보낼 판이 지워지지 않게 넉넉히. 7일이 지난 것은 따로 지운다) */
  open_runs: 20,
  /** 처치 수 상한 = kills_base + 판 시간 × kills_per_sec (넘으면 비정상 판) */
  kills_base: 50,
  kills_per_sec: 4,
  /** 배치 횟수·명령 수 상한 */
  placed_max: 400,
  cmds_max: 3000,
  /** 3단계 돼지가 벌어 주는 엽전의 한 판 상한 */
  bonus_max: 12,
  /** 끝없는 모드: 시간 상한(웨이브 120) · 넘긴 웨이브마다의 엽전과 한 판 상한 */
  endless_max_time: 3600,
  endless_coin_per_wave: 8,
  endless_coin_cap: 320,
  /** 끝없는 모드: 처치 수가 (도달 웨이브 − from) × per_wave 보다 적으면 비정상 판 */
  endless_kills_from: 4,
  endless_kills_per_wave: 5,
  /** 한 번에 보내는 도감 id 수 (종류마다) */
  codex_max: 40,
} as const;

export type RunMode = 'normal' | 'endless';
/** 도감: 만난 요괴·보스의 id */
export interface Codex {
  enemies: string[];
  bosses: string[];
}

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
  levels: Partial<Record<CharId, number>>;
  upgrades: Upgrades;
  /** 쓸 수 있는 캐릭터 */
  unlocked: CharId[];
  /** 도감: 만난 요괴·보스 */
  codex: Codex;
  /** 끝없는 모드의 최고 기록 (없으면 null): 도달 웨이브와 그때 데려간 캐릭터 */
  endless: { wave: number; squad: CharId[] } | null;
}

/**
 * 스테이지로 열리지 않는 캐릭터(고양이)를 이 계정이 쓸 수 있나 — 출전·레벨업·선택 화면이 모두 p.unlocked 를 보므로 여기 한 곳에서 정한다.
 * 로비에서 시아코인으로 연 계정만 쓴다 (shared/characters.js 의 loadOwnedCharacters → setOwnedExtras. 서버는 071 의 _check_character 가 막는다).
 * 연 목록을 바꾼 뒤에는 cleanProfile 을 다시 거쳐야 p.unlocked 에 반영된다 (main.ts).
 */
let ownedExtras: CharId[] = [];
/** 이 계정이 연 추가 캐릭터 (모르는 id 는 버린다). 처음에는 아무것도 열지 않은 것으로 본다 */
export function setOwnedExtras(list: readonly string[]) {
  ownedExtras = EXTRAS.filter((id) => list.includes(id));
}
export const extraOpen = (id: CharId): boolean => ownedExtras.includes(id);
const openExtras = () => EXTRAS.filter(extraOpen);

export const defaultProfile = (): DefenseProfile => ({ coins: 0, stages: {}, levels: {}, upgrades: {}, unlocked: [...STARTERS, ...openExtras()], codex: { enemies: [], bosses: [] }, endless: null });

/** 도감 합치기: 알려진 id 만, 데이터의 순서대로 (서버의 _defense_codex_merge 와 같다) */
export function mergeCodex(old: Codex | undefined, add: Partial<Codex> | undefined): Codex {
  const pick = (ids: string[], a: unknown, b: unknown) => {
    const got = new Set<string>([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) && b.length <= LIMITS.codex_max ? b : [])].filter((x) => typeof x === 'string'));
    return ids.filter((id) => got.has(id));
  };
  return { enemies: pick(ENEMIES.map((e) => e.id), old?.enemies, add?.enemies), bosses: pick(BOSSES.map((b) => b.id), old?.bosses, add?.bosses) };
}

const isChar = (c: unknown): c is CharId => typeof c === 'string' && (CHAR_IDS as readonly string[]).includes(c);

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
      if (isChar(id) && n > 1) levels[id] = Math.min(CHAR_MAX_LV, n);
    }
  }
  const upgrades: Upgrades = {};
  if (d.upgrades && typeof d.upgrades === 'object') {
    for (const u of UPGRADES) {
      const n = Math.floor(Number((d.upgrades as Record<string, unknown>)[u.id]));
      if (n >= 1) upgrades[u.id] = Math.min(u.max, n);
    }
  }
  const got = Array.isArray(d.unlocked) ? d.unlocked.filter(isChar) : [];
  // 띠 순서로 (고양이는 맨 뒤), 처음 4종은 늘 들어 있다. 고양이는 서버의 해금 목록(unlocked_characters)에 없고 extraOpen 으로 정한다
  const extras = openExtras();
  const unlocked = ROSTER.map((r) => r.id).filter((id) => STARTERS.includes(id) || extras.includes(id) || (got.includes(id) && !EXTRAS.includes(id)));
  const e = d.endless as { wave?: unknown; squad?: unknown } | null | undefined;
  const wave = Math.floor(Number(e?.wave)) || 0;
  const endless = wave >= 1 ? { wave, squad: (Array.isArray(e?.squad) ? e.squad : []).filter(isChar) } : null;
  return { coins: Math.max(0, Math.floor(Number(d.coins)) || 0), stages, levels, upgrades, unlocked, codex: mergeCodex(d.codex, undefined), endless };
}

export const totalStars = (p: DefenseProfile) => Object.values(p.stages).reduce((a, b) => a + b, 0);
export const clearedCount = (p: DefenseProfile) => Object.keys(p.stages).length;
export const regionStars = (p: DefenseProfile, region: number) => stagesOf(region).reduce((a, s) => a + (p.stages[s.id] ?? 0), 0);
export const charLevel = (p: DefenseProfile, id: CharId) => p.levels[id] ?? 1;
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
  return squad.length >= 1 && squad.length <= SQUAD_SIZE && new Set(squad).size === squad.length && squad.every((c) => isChar(c) && p.unlocked.includes(c));
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
  /** 이 판에서 만난 요괴·보스 (도감) */
  codex: Codex;
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
  unlocked: CharId[];
  /** 정상 범위의 판인가 (아니면 아무것도 받지 못한다) */
  valid: boolean;
  /** 끝없는 모드: 이번 판의 도달 웨이브(스테이지 판은 0) · 최고 기록 · 새 기록인가 */
  wave: number;
  bestWave: number;
  newRecord: boolean;
}

/** 도달 웨이브: 넘긴 웨이브 + 1 (서버도 판 시간으로 이렇게 센다) */
export const waveOf = (time: number) => Math.floor(time / WAVE_SEC) + 1;
/** 끝없는 모드의 엽전: 넘긴 웨이브마다, 상한까지 */
export const endlessCoins = (time: number) => Math.min(LIMITS.endless_coin_cap, Math.floor(time / WAVE_SEC) * LIMITS.endless_coin_per_wave);

/** 실패·포기한 판의 엽전: 클리어 보상 × 끝낸 웨이브 수 ÷ 15 (= 40% × 끝낸 웨이브 / 6). PRD 3장: 포기해도 일부 지급 */
export function partialCoins(stage: StageDef, time: number): number {
  const done = Math.max(0, Math.min(WAVES, Math.floor(time / WAVE_SEC)));
  return Math.floor((stage.coins * done) / COINS.failDiv);
}

/**
 * 지금 포기하면 받을 엽전 (applyRun · 서버와 같은 계산): (끝낸 웨이브 몫 + 돼지 엽전) × 엽전 획득 강화. 너무 짧은 판은 0.
 * time: 판 시간(초, 내림). bonus: 3단계 돼지가 벌어 준 엽전. 처치 수 검사(isValid)는 보지 않는다 (정상 판이면 늘 통과)
 */
export function quitCoins(stage: StageDef, time: number, mode: RunMode, squad: readonly string[], bonus: number, up: Upgrades | undefined): number {
  if (time < LIMITS.count_min_time) return 0;
  const base = mode === 'endless' ? endlessCoins(time) : partialCoins(stage, time);
  const pig = squad.includes('pig') ? Math.min(LIMITS.bonus_max, bonus) : 0;
  return Math.floor(((base + pig) * (100 + upgradeMods(up).coinPct)) / 100);
}

/**
 * 받을 수 없는 판이면 그 까닭 (서버의 raise exception 글자와 같다), 받을 수 있으면 null.
 * elapsed: 판을 시작한 뒤 실제로 흐른 시간(초). startLives: 시작할 때 적어 둔 시작 생명
 */
export function rejectReason(r: RunReport, elapsed: number, startLives: number, mode: RunMode = 'normal'): string | null {
  const ints = [r.time, r.lives, r.kills, r.placed, r.cmds, r.bonus];
  if (ints.some((v) => !Number.isInteger(v))) return 'bad result';
  if (r.time < 0 || r.time > (mode === 'endless' ? LIMITS.endless_max_time : LIMITS.max_time)) return 'bad time';
  // 끝없는 모드에는 클리어가 없다
  if (mode === 'endless' && r.cleared) return 'bad result';
  if (r.lives < 0 || r.lives > startLives || r.kills < 0 || r.placed < 0 || r.cmds < 0 || r.bonus < 0) return 'bad result';
  if (r.placed > LIMITS.placed_max || r.cmds > LIMITS.cmds_max || r.placed > r.cmds) return 'bad result';
  // 클리어: 3분을 채웠고, 생명이 남았고, 캐릭터를 하나 이상 놓았다 (시작 명령 + 배치 명령)
  if (r.cleared && (r.time < LIMITS.clear_min_time || r.lives < 1 || r.placed < 1 || r.cmds < 2)) return 'bad result';
  if (elapsed < r.time / LIMITS.max_speed - LIMITS.time_slack) return 'too early';
  if (elapsed > LIMITS.max_age) return 'too late';
  return null;
}

/** 정상 범위의 판인가 (처치 수 상한. 끝없는 모드는 도달 웨이브에 걸맞은 처치 수도) */
export const isValid = (r: RunReport, mode: RunMode = 'normal') =>
  r.kills <= LIMITS.kills_base + r.time * LIMITS.kills_per_sec &&
  (mode !== 'endless' || r.kills >= Math.max(0, waveOf(r.time) - LIMITS.endless_kills_from) * LIMITS.endless_kills_per_wave);

/** 판 하나가 실제로 쓴 최소 시간 (초): 가장 빠른 배속 기준 (겹치는 판 확인용) */
export const minRealTime = (time: number) => Math.max(0, time / LIMITS.max_speed - LIMITS.time_slack);

/** 판 결과를 진행 상황에 반영한다 → 새 진행 상황과 결과. 모르는 스테이지·잠긴 스테이지면 오류 */
export function applyRun(p: DefenseProfile, r: RunReport, squad: readonly string[] = [], mode: RunMode = 'normal'): { profile: DefenseProfile; result: FinishResult } {
  const none = { stars: 0, bestStars: 0, newStars: 0, firstClear: false, coins: 0, baseCoins: 0, firstCoins: 0, starCoins: 0, opened: null, unlocked: [] as CharId[], wave: 0, bestWave: p.endless?.wave ?? 0, newRecord: false };
  const pigBonus = squad.includes('pig') ? Math.min(LIMITS.bonus_max, r.bonus) : 0;
  const coinMul = 100 + upgradeMods(p.upgrades).coinPct;
  if (mode === 'endless') {
    // 끝없는 모드: 도달 웨이브가 기록이고, 엽전은 넘긴 웨이브마다 (상한까지)
    if (r.stage !== ENDLESS_ID) throw new Error('bad stage');
    if (!endlessOpen(p)) throw new Error('endless locked');
    const valid = isValid(r, 'endless');
    if (!valid || r.time < LIMITS.count_min_time) return { profile: p, result: { ...none, valid } };
    const wave = waveOf(r.time);
    const baseCoins = endlessCoins(r.time);
    const coins = Math.floor(((baseCoins + pigBonus) * coinMul) / 100);
    const newRecord = wave > (p.endless?.wave ?? 0);
    const profile: DefenseProfile = { ...p, coins: p.coins + coins, codex: mergeCodex(p.codex, r.codex), endless: newRecord ? { wave, squad: squad.filter(isChar) } : p.endless };
    return { profile, result: { ...none, coins, baseCoins, valid, wave, bestWave: Math.max(wave, p.endless?.wave ?? 0), newRecord } };
  }
  const stage = stageOf(r.stage);
  if (!stage || stage.id === ENDLESS_ID) throw new Error('bad stage');
  if (!stageOpen(p, stage)) throw new Error('stage locked');
  const before = p.stages[stage.id] ?? 0;
  const valid = isValid(r);
  // 너무 짧은 판·비정상 판: 아무것도 주지 않는다
  if (!valid || r.time < LIMITS.count_min_time) return { profile: p, result: { ...none, bestStars: before, valid } };
  const stars = starsOf(r.cleared, r.lives, r.startLives);
  const firstClear = stars > 0 && before === 0;
  const newStars = Math.max(0, stars - before);
  const baseCoins = stars > 0 ? stage.coins : partialCoins(stage, r.time);
  const firstCoins = firstClear ? stage.firstCoins : 0;
  const starCoins = newStars * COINS.perStar;
  // 3단계 돼지가 벌어 준 엽전: 돼지를 데려간 판에서만, 상한까지
  const coins = Math.floor(((baseCoins + firstCoins + starCoins + pigBonus) * coinMul) / 100);
  const stages = stars > before ? { ...p.stages, [stage.id]: stars } : p.stages;
  // 캐릭터 해금: 그 지역의 보스 스테이지를 처음 클리어했을 때 (PRD 4장)
  const unlocked: CharId[] = [];
  if (firstClear && stage.no === 5) {
    for (const c of ROSTER) if (c.unlockRegion === stage.region && !p.unlocked.includes(c.id)) unlocked.push(c.id);
  }
  const profile: DefenseProfile = { ...p, coins: p.coins + coins, stages, codex: mergeCodex(p.codex, r.codex), unlocked: ROSTER.map((c) => c.id).filter((id) => p.unlocked.includes(id) || unlocked.includes(id)) };
  // 새로 열린 스테이지: 이 판 전에는 잠겨 있었고 지금은 열린 것 가운데 첫 번째
  const opened = firstClear ? (STAGES.find((x) => !stageOpen(p, x) && stageOpen(profile, x))?.id ?? null) : null;
  return { profile, result: { ...none, stars, bestStars: Math.max(before, stars), newStars, firstClear, coins, baseCoins, firstCoins, starCoins, opened, unlocked, valid } };
}

/** 새로 열린 스테이지 (서버 답에는 없어서 앞뒤 진행 상황을 비교해 찾는다) */
export const openedBy = (before: DefenseProfile, after: DefenseProfile): string | null =>
  STAGES.find((x) => !stageOpen(before, x) && stageOpen(after, x))?.id ?? null;

/** 캐릭터 레벨업 → 새 진행 상황. 안 되면 오류(까닭) */
export function levelUp(p: DefenseProfile, id: string): DefenseProfile {
  if (!isChar(id)) throw new Error('bad character');
  // 서버와 같다: 시아코인으로 여는 캐릭터는 071 _check_character 의 'locked character'
  if (EXTRAS.includes(id) && !extraOpen(id)) throw new Error('locked character');
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
