import {
  CONST, COST_MUL, GRID_MAX, HALL_AT, HALL_CAP, HALL_NEED, LAND_SIZES, LEVEL_EXP, RATE_MUL, RES_IDS, START_RES, STORAGE_CAP, UPGRADE_EXP, UPGRADE_SEC,
  type ResId, type Resources,
} from '../data/balance';
import { BUILDING, isBuildingType, type BuildingType } from '../data/buildings';
import { GOALS, type GoalDef } from '../data/goals';

/**
 * 시아마을의 규칙 (순수 함수). 진짜 계산은 서버 함수(supabase/migrations/047_village.sql)가 서버 시간으로 한다.
 * 여기 있는 것은 같은 식을 옮긴 것으로, 테스트 모드(LocalApi)와 화면의 미리 보기(쌓인 양·진행 막대·살 수 있는지)가 쓴다.
 * 거절 까닭(RuleError 의 글자)은 SQL 의 raise exception 글자와 같다.
 * 시각은 모두 ms (서버 시각 기준).
 */

export type BuildingState = 'building' | 'upgrading' | 'done';

export interface Building {
  id: string;
  type: BuildingType;
  /** 지금 레벨 (업그레이드 중이면 끝나기 전의 레벨) */
  level: number;
  x: number;
  y: number;
  state: BuildingState;
  /** 짓기·업그레이드가 끝나는 시각 (done 이면 null) */
  finishAt: number | null;
  /** 짓기·업그레이드를 시작한 시각 (진행 막대용. done 이면 null) */
  startAt: number | null;
  /** 마지막으로 수확한 시각 (이때부터 생산이 쌓인다) */
  collectedAt: number;
  /** 배치한 주민 (6단계) */
  resident: string | null;
}

export interface Profile {
  name: string;
  level: number;
  /** 지금 레벨에서 모은 경험치 */
  exp: number;
  resources: Resources;
  landStage: number;
  prosperity: number;
  /** 지금 마을 목표의 번호 (GOALS 의 순서. 끝까지 했으면 GOALS.length) */
  goal: number;
  /** 지금 목표가 시작된 뒤의 수확 횟수 */
  goalProgress: number;
}

export interface VillageState {
  profile: Profile;
  buildings: Building[];
}

export class RuleError extends Error {}
const fail = (why: string): never => {
  throw new RuleError(why);
};

// ───────────────────────── 값 읽기 ─────────────────────────

/** 지금 단계의 땅: 20×20 한가운데의 정사각형 */
export function landRect(stage: number): { x0: number; size: number } {
  const size = LAND_SIZES[Math.max(0, Math.min(LAND_SIZES.length - 1, stage))];
  return { x0: (GRID_MAX - size) / 2, size };
}

/** 레벨 n → n+1 업그레이드 값 */
export function upgradeCost(type: BuildingType, level: number): { rice: number; wood: number } {
  const d = BUILDING[type];
  const m = COST_MUL[level - 1];
  return { rice: Math.floor((d.rice * m) / 10), wood: Math.floor((d.wood * m) / 10) };
}
export const upgradeSec = (type: BuildingType, level: number) => UPGRADE_SEC[level - 1] * (type === 'hall' ? CONST.hall_sec_mul : 1);
export const upgradeExp = (type: BuildingType, level: number) => UPGRADE_EXP[level - 1] * (type === 'hall' ? CONST.hall_exp_mul : 1);
/** 시간당 생산량 */
export const ratePerHour = (type: BuildingType, level: number) => Math.floor((BUILDING[type].rate * RATE_MUL[level - 1]) / 10);
/** 그 마을 레벨에서 지을 수 있는 개수 */
export const maxCount = (type: BuildingType, villageLevel: number) => BUILDING[type].unlock.filter((l) => l <= villageLevel).length;
export const countOf = (s: VillageState, type: BuildingType) => s.buildings.filter((b) => b.type === type).length;
/** 다음 한 채가 열리는 마을 레벨 (더 없으면 null) */
export function nextUnlock(s: VillageState, type: BuildingType): number | null {
  return BUILDING[type].unlock[countOf(s, type)] ?? null;
}

export const hallLevel = (s: VillageState) => s.buildings.find((b) => b.type === 'hall')?.level ?? 1;

/** 창고 용량: 마을 회관 + 다 지은 창고들 */
export function storageCap(s: VillageState): number {
  let cap = HALL_CAP[hallLevel(s) - 1];
  for (const b of s.buildings) if (b.type === 'storage' && b.state !== 'building') cap += STORAGE_CAP[b.level - 1];
  return cap;
}

/** 동시에 지을 수 있는 수 · 지금 짓는 수 */
export const slots = (s: VillageState) => (hallLevel(s) >= CONST.slots3_hall ? CONST.base_slots + 1 : CONST.base_slots);
export const busyCount = (s: VillageState) => s.buildings.filter((b) => b.state !== 'done').length;

/** 그 자리에 놓을 수 있나 → 안 되면 까닭 */
export function placeError(s: VillageState, type: BuildingType, x: number, y: number, ignoreId?: string): 'out of land' | 'occupied' | null {
  const d = BUILDING[type];
  const { x0, size } = landRect(s.profile.landStage);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < x0 || y < x0 || x + d.w > x0 + size || y + d.h > x0 + size) return 'out of land';
  for (const b of s.buildings) {
    if (b.id === ignoreId) continue;
    const o = BUILDING[b.type];
    if (b.x < x + d.w && b.x + o.w > x && b.y < y + d.h && b.y + o.h > y) return 'occupied';
  }
  return null;
}

/** 쌓인 양: floor(지난 초 × 시간당 생산량 ÷ 3600), 최대 12시간 분량 */
export function stored(b: Building, now: number): number {
  if (b.state !== 'done' || !BUILDING[b.type].product) return 0;
  const sec = Math.min(CONST.prod_cap_sec, Math.max(0, Math.floor((now - b.collectedAt) / 1000)));
  return Math.floor((sec * ratePerHour(b.type, b.level)) / 3600);
}
/** 가득 찼나 (12시간 분량) */
export const isFull = (b: Building, now: number) => b.state === 'done' && !!BUILDING[b.type].product && now - b.collectedAt >= CONST.prod_cap_sec * 1000;

/** 지금 목표와 진행 */
export function goalStatus(s: VillageState): { def: GoalDef; have: number; done: boolean } | null {
  const def = GOALS[s.profile.goal];
  if (!def) return null;
  let have = 0;
  if (def.kind === 'build') have = s.buildings.filter((b) => b.type === def.type && b.state !== 'building').length;
  else if (def.kind === 'upgrade') have = Math.max(0, ...s.buildings.filter((b) => b.type === def.type && b.state !== 'building').map((b) => b.level));
  else if (def.kind === 'harvest') have = s.profile.goalProgress;
  else have = s.profile.level;
  return { def, have: Math.min(have, def.n), done: have >= def.n };
}

// ───────────────────────── 상태 바꾸기 (모두 s 를 직접 고친다: 부르는 쪽이 사본을 넘긴다) ─────────────────────────

export function newVillage(now: number, hallId = 'hall'): VillageState {
  return {
    profile: { name: '', level: 1, exp: 0, resources: { ...START_RES }, landStage: 0, prosperity: 0, goal: 0, goalProgress: 0 },
    buildings: [{ id: hallId, type: 'hall', level: 1, x: HALL_AT.x, y: HALL_AT.y, state: 'done', finishAt: null, startAt: null, collectedAt: now, resident: null }],
  };
}

/** 경험치를 더하고 오른 레벨 수를 돌려준다 */
export function addExp(p: Profile, n: number): number {
  let ups = 0;
  p.exp += Math.max(0, Math.floor(n));
  while (p.level < CONST.max_level && p.exp >= LEVEL_EXP[p.level - 1]) {
    p.exp -= LEVEL_EXP[p.level - 1];
    p.level++;
    ups++;
  }
  if (p.level >= CONST.max_level) p.exp = 0;
  return ups;
}

/** 끝난 짓기·업그레이드를 마무리한다 (서버는 모든 요청의 처음에 이것을 한다) */
export function settle(s: VillageState, now: number): void {
  const due = s.buildings.filter((b) => b.state !== 'done' && b.finishAt !== null && b.finishAt <= now).sort((a, b) => a.finishAt! - b.finishAt!);
  for (const b of due) {
    if (b.state === 'building') addExp(s.profile, BUILDING[b.type].buildExp);
    else {
      addExp(s.profile, upgradeExp(b.type, b.level));
      b.level++;
    }
    // 생산은 다 지은 순간부터 쌓인다
    b.collectedAt = b.finishAt!;
    b.state = 'done';
    b.finishAt = null;
    b.startAt = null;
  }
}

function pay(p: Profile, rice: number, wood: number) {
  if (p.resources.rice < rice || p.resources.wood < wood) fail('not enough');
  p.resources.rice -= rice;
  p.resources.wood -= wood;
}

export function build(s: VillageState, type: string, x: number, y: number, now: number, id: string): Building {
  settle(s, now);
  if (!isBuildingType(type)) return fail('bad type');
  const d = BUILDING[type];
  const have = countOf(s, type);
  // 아직 하나도 못 짓는 건물은 'locked', 지금 레벨의 개수를 다 지었으면 'limit'
  if (have >= maxCount(type, s.profile.level)) fail(have === 0 ? 'locked' : 'limit');
  if (busyCount(s) >= slots(s)) fail('no slot');
  const why = placeError(s, type, x, y);
  if (why) fail(why);
  pay(s.profile, d.rice, d.wood);
  const b: Building = { id, type, level: 1, x, y, state: 'building', finishAt: now + d.buildSec * 1000, startAt: now, collectedAt: now, resident: null };
  s.buildings.push(b);
  // 0초짜리 건물은 바로 끝난다
  settle(s, now);
  return b;
}

export function move(s: VillageState, id: string, x: number, y: number, now: number): void {
  settle(s, now);
  const b = s.buildings.find((v) => v.id === id) ?? fail('no building');
  const why = placeError(s, b.type, x, y, id);
  if (why) fail(why);
  b.x = x;
  b.y = y;
}

/**
 * 건물 하나를 거둔다 → have 쌓여 있던 양 · got 창고에 들어간 양.
 * 건물은 비워진다: 창고에 들어가는 만큼만 담고 넘친 것은 버린다 (경험치는 쌓여 있던 양으로 준다 —
 * 창고가 가득 차도 수확 경험치가 끊기지 않아야 마을이 멈추지 않는다).
 */
function collect(s: VillageState, b: Building, now: number, cap: number): { have: number; got: number } {
  const res = BUILDING[b.type].product;
  if (!res || b.state !== 'done') return { have: 0, got: 0 };
  const rate = ratePerHour(b.type, b.level);
  const from = Math.max(b.collectedAt, now - CONST.prod_cap_sec * 1000);
  const have = Math.floor((Math.max(0, Math.floor((now - from) / 1000)) * rate) / 3600);
  if (have <= 0) return { have: 0, got: 0 };
  const got = Math.max(0, Math.min(have, cap - s.profile.resources[res]));
  s.profile.resources[res] += got;
  // 거둔 만큼의 시간만 쓴다 (1개가 되다 만 시간은 남는다)
  b.collectedAt = Math.min(now, from + Math.ceil((have * 3600) / rate) * 1000);
  return { have, got };
}

export interface HarvestResult {
  /** 건물별로 창고에 들어간 양 (거둔 건물은 0 이어도 들어 있다) */
  per: Record<string, number>;
  gained: Partial<Record<ResId, number>>;
  exp: number;
  /** 창고가 가득 차서 버린 양 (0 이면 다 담았다) */
  lost: number;
}

export function harvest(s: VillageState, ids: string[], now: number): HarvestResult {
  settle(s, now);
  if (ids.length === 0 || ids.length > CONST.harvest_max) fail('bad request');
  const cap = storageCap(s);
  const out: HarvestResult = { per: {}, gained: {}, exp: 0, lost: 0 };
  let count = 0;
  let total = 0;
  for (const id of [...new Set(ids)]) {
    const b = s.buildings.find((v) => v.id === id);
    if (!b) continue;
    const { have, got } = collect(s, b, now, cap);
    if (have <= 0) continue;
    const res = BUILDING[b.type].product!;
    out.per[id] = got;
    if (got > 0) out.gained[res] = (out.gained[res] ?? 0) + got;
    out.lost += have - got;
    total += have;
    count++;
  }
  out.exp = Math.floor(total / CONST.harvest_exp_div);
  if (GOALS[s.profile.goal]?.kind === 'harvest') s.profile.goalProgress += count;
  addExp(s.profile, out.exp);
  return out;
}

export function upgrade(s: VillageState, id: string, now: number): void {
  settle(s, now);
  const b = s.buildings.find((v) => v.id === id) ?? fail('no building');
  if (b.state !== 'done') fail('busy');
  if (b.level >= CONST.building_max_level) fail('max level');
  if (b.type === 'hall') {
    if (s.profile.level < HALL_NEED[b.level - 1]) fail('village level');
  } else if (b.level >= hallLevel(s)) fail('hall level');
  if (busyCount(s) >= slots(s)) fail('no slot');
  const c = upgradeCost(b.type, b.level);
  if (s.profile.resources.rice < c.rice || s.profile.resources.wood < c.wood) fail('not enough');
  // 쌓여 있던 것은 먼저 거둔다 (창고에 들어가는 만큼, 넘친 것은 버린다. 경험치·목표 횟수는 없다)
  collect(s, b, now, storageCap(s));
  pay(s.profile, c.rice, c.wood);
  b.state = 'upgrading';
  b.startAt = now;
  b.finishAt = now + upgradeSec(b.type, b.level) * 1000;
}

export function claimGoal(s: VillageState, now: number): GoalDef {
  settle(s, now);
  const g = goalStatus(s) ?? fail('no goal');
  if (!g.done) fail('not done');
  // 보상은 창고 용량을 넘겨도 받는다 (다음 수확부터 용량이 적용된다)
  s.profile.resources.rice += g.def.rice;
  s.profile.resources.wood += g.def.wood;
  s.profile.goal++;
  s.profile.goalProgress = 0;
  addExp(s.profile, g.def.exp);
  return g.def;
}

// ───────────────────────── 서버 답 다듬기 ─────────────────────────

const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};

/** 서버(또는 기기 저장소)가 준 상태를 믿을 수 있는 모양으로 */
export function cleanState(raw: unknown): VillageState {
  const r = (raw ?? {}) as { profile?: Record<string, unknown>; buildings?: unknown[] };
  const p = r.profile ?? {};
  const res = (p.resources ?? {}) as Record<string, unknown>;
  const resources = Object.fromEntries(RES_IDS.map((k) => [k, int(res[k], 0, 1e12, 0)])) as Resources;
  const buildings: Building[] = [];
  for (const v of Array.isArray(r.buildings) ? r.buildings : []) {
    const b = (v ?? {}) as Record<string, unknown>;
    if (!isBuildingType(b.type) || typeof b.id !== 'string') continue;
    const state: BuildingState = b.state === 'building' || b.state === 'upgrading' ? b.state : 'done';
    buildings.push({
      id: b.id, type: b.type, level: int(b.level, 1, CONST.building_max_level, 1), x: int(b.x, 0, GRID_MAX - 1, 0), y: int(b.y, 0, GRID_MAX - 1, 0), state,
      finishAt: state === 'done' ? null : Number(b.finishAt) || 0,
      startAt: state === 'done' ? null : Number(b.startAt) || 0,
      collectedAt: Number(b.collectedAt) || 0,
      resident: typeof b.resident === 'string' ? b.resident : null,
    });
  }
  return {
    profile: {
      name: typeof p.name === 'string' ? p.name : '', level: int(p.level, 1, CONST.max_level, 1), exp: int(p.exp, 0, 1e9, 0), resources,
      landStage: int(p.landStage, 0, LAND_SIZES.length - 1, 0), prosperity: int(p.prosperity, 0, 1e9, 0), goal: int(p.goal, 0, 9999, 0), goalProgress: int(p.goalProgress, 0, 1e9, 0),
    },
    buildings,
  };
}

export const cloneState = (s: VillageState): VillageState => ({ profile: { ...s.profile, resources: { ...s.profile.resources } }, buildings: s.buildings.map((b) => ({ ...b })) });
