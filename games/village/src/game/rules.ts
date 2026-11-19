import {
  CAPPED, CONST, COST_MUL, GRID_MAX, HALL_AT, HALL_CAP, HALL_NEED, LAND_NEED, LAND_PRICE, LAND_SIZES, LEVEL_EXP, MARKET_LIMIT, PRICES, RATE_MUL, RES_IDS, START_RES, STORAGE_CAP, UPGRADE_EXP, UPGRADE_SEC,
  kstDay, pricePct, type ResId, type Resources,
} from '../data/balance';
import { BUILDING, isBuildingType, recipeOf, upgradable, type BuildingType } from '../data/buildings';
import { COUNTED, GOALS, type GoalDef, type GoalKind } from '../data/goals';

/**
 * 시아마을의 규칙 (순수 함수). 진짜 계산은 서버 함수(supabase/migrations/047_village.sql + 049 · 050 …)가 서버 시간으로 한다.
 * 여기 있는 것은 같은 식을 옮긴 것으로, 테스트 모드(LocalApi)와 화면의 미리 보기(쌓인 양·진행 막대·살 수 있는지)가 쓴다.
 * 거절 까닭(RuleError 의 글자)은 SQL 의 raise exception 글자와 같다.
 * 시각은 모두 ms (서버 시각 기준).
 */

/** building 짓는 중 · upgrading 업그레이드 중 · done 다 지음 · working 가공 중(방앗간 · 장독대) · stored 보관함 */
export type BuildingState = 'building' | 'upgrading' | 'done' | 'working' | 'stored';

export interface Building {
  id: string;
  type: BuildingType;
  /** 지금 레벨 (업그레이드 중이면 끝나기 전의 레벨) */
  level: number;
  /** 왼쪽 위 칸 (보관함에 있으면 뜻이 없다) */
  x: number;
  y: number;
  state: BuildingState;
  /** 짓기 · 업그레이드 · 가공이 끝나는 시각 (done · stored 이면 null) */
  finishAt: number | null;
  /** 시작한 시각 (진행 막대용) */
  startAt: number | null;
  /** 마지막으로 수확한 시각 (이때부터 생산이 쌓인다) */
  collectedAt: number;
  /** 가공 중인 개수 */
  jobN: number;
  /** 생산량이 바뀌기 전까지 쌓인 양 (보너스는 그 뒤에 쌓이는 것에만 붙는다) */
  banked: number;
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
  /** 지금 목표가 시작된 뒤에 센 횟수 (수확 · 판매 · 가공) */
  goalProgress: number;
  /** 장터: 마지막으로 판 날(kstDay)과 그날 번 엽전 */
  marketDay: number;
  marketSold: number;
  /** 잔치: 시작 · 끝 시각과 보너스(%). 연 적이 없으면 0 */
  feastFrom: number;
  feastUntil: number;
  feastPct: number;
}

export interface VillageState {
  profile: Profile;
  buildings: Building[];
  /** 시아코인 잔액 (SIA WORLD 공통 지갑) */
  sia: number;
}

export type Cost = { rice: number; wood: number; stone: number; coin: number };
const COST_KEYS = ['rice', 'wood', 'stone', 'coin'] as const;

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

export function buildCost(type: BuildingType): Cost {
  const d = BUILDING[type];
  return { rice: d.rice, wood: d.wood, stone: d.stone, coin: d.coin };
}
/** 레벨 n → n+1 업그레이드 값. 돌은 건물 레벨 stone_from 부터 든다 */
export function upgradeCost(type: BuildingType, level: number): Cost {
  const d = BUILDING[type];
  const m = COST_MUL[level - 1];
  return { rice: Math.floor((d.rice * m) / 10), wood: Math.floor((d.wood * m) / 10), stone: level >= CONST.stone_from ? Math.floor((d.upStone * m) / 10) : 0, coin: 0 };
}
export const canPay = (p: Profile, c: Cost) => COST_KEYS.every((k) => p.resources[k] >= c[k]);
export const upgradeSec = (type: BuildingType, level: number) => UPGRADE_SEC[level - 1] * (type === 'hall' ? CONST.hall_sec_mul : 1);
export const upgradeExp = (type: BuildingType, level: number) => UPGRADE_EXP[level - 1] * (type === 'hall' ? CONST.hall_exp_mul : 1);
/** 시간당 생산량 */
export const ratePerHour = (type: BuildingType, level: number) => Math.floor((BUILDING[type].rate * RATE_MUL[level - 1]) / 10);
/** 그 마을 레벨에서 가질 수 있는 개수 */
export function maxCount(type: BuildingType, villageLevel: number): number {
  const d = BUILDING[type];
  if (d.cap > 0) return villageLevel >= d.unlock[0] ? d.cap : 0;
  return d.unlock.filter((l) => l <= villageLevel).length;
}
/** 가진 개수 (보관함에 든 것도 센다) */
export const countOf = (s: VillageState, type: BuildingType) => s.buildings.filter((b) => b.type === type).length;
/** 다음 하나가 열리는 마을 레벨 (더 없으면 null) */
export function nextUnlock(s: VillageState, type: BuildingType): number | null {
  const d = BUILDING[type];
  if (d.cap > 0) return countOf(s, type) < d.cap ? d.unlock[0] : null;
  return d.unlock[countOf(s, type)] ?? null;
}

export const hallLevel = (s: VillageState) => s.buildings.find((b) => b.type === 'hall')?.level ?? 1;
/** 땅에 놓여 있고 다 지어진 건물인가 (짓는 중 · 보관함이 아니다) */
export const standing = (b: Building) => b.state !== 'building' && b.state !== 'stored';

/** 창고 용량: 마을 회관 + 놓여 있는 창고들 */
export function storageCap(s: VillageState): number {
  let cap = HALL_CAP[hallLevel(s) - 1];
  for (const b of s.buildings) if (b.type === 'storage' && standing(b)) cap += STORAGE_CAP[b.level - 1];
  return cap;
}

/** 동시에 지을 수 있는 수 · 지금 짓는 수 */
export const slots = (s: VillageState) => (hallLevel(s) >= CONST.slots3_hall ? CONST.base_slots + 1 : CONST.base_slots);
export const busyCount = (s: VillageState) => s.buildings.filter((b) => b.state === 'building' || b.state === 'upgrading').length;

/** 그 자리에 놓을 수 있나 → 안 되면 까닭 */
export function placeError(s: VillageState, type: BuildingType, x: number, y: number, ignoreId?: string): 'out of land' | 'occupied' | null {
  const d = BUILDING[type];
  const { x0, size } = landRect(s.profile.landStage);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < x0 || y < x0 || x + d.w > x0 + size || y + d.h > x0 + size) return 'out of land';
  for (const b of s.buildings) {
    if (b.id === ignoreId || b.state === 'stored') continue;
    const o = BUILDING[b.type];
    if (b.x < x + d.w && b.x + o.w > x && b.y < y + d.h && b.y + o.h > y) return 'occupied';
  }
  return null;
}

/** 가공: 한 번에 넣을 수 있는 개수 · 하나를 만드는 시간(초) */
export function batchMax(type: BuildingType, level: number): number {
  const r = recipeOf(type);
  return r ? r.base + r.per * (level - 1) : 0;
}
export function unitSec(type: BuildingType, level: number): number {
  const r = recipeOf(type);
  return r ? Math.floor((r.sec * 10) / RATE_MUL[level - 1]) : 0;
}

/** 정자의 영향이 닿는 거리 (칸) · 생산 건물이 쌓아 두는 최대 시간 (초) */
export const pavilionRange = (_s: VillageState) => CONST.pavilion_range;
export const capSec = (_s: VillageState) => CONST.prod_cap_sec;
/** 서 있는 정자 (짓는 중 · 보관함이 아닌) */
export const pavilion = (s: VillageState) => s.buildings.find((v) => v.type === 'pavilion' && (v.state === 'done' || v.state === 'upgrading')) ?? null;
/** 그 칸들이 정자의 둘레 안인가 */
export function nearPavilion(s: VillageState, x: number, y: number, w: number, h: number): boolean {
  const pv = pavilion(s);
  if (!pv) return false;
  const r = pavilionRange(s);
  const p = BUILDING.pavilion;
  return x < pv.x + p.w + r && x + w > pv.x - r && y < pv.y + p.h + r && y + h > pv.y - r;
}
/** 그 건물의 생산 보너스 (%): 정자 둘레에 있으면 pavilion_pct + pavilion_pct_per × (정자 레벨 − 1). 생산 건물이 아니면 0 */
export function ratePct(s: VillageState, b: Building): number {
  const d = BUILDING[b.type];
  if (!d.product || b.state === 'stored') return 0;
  const pv = pavilion(s);
  return pv && nearPavilion(s, b.x, b.y, d.w, d.h) ? CONST.pavilion_pct + CONST.pavilion_pct_per * (pv.level - 1) : 0;
}
/** 보너스를 넣은 시간당 생산량 */
export const effRate = (s: VillageState, b: Building) => Math.floor((ratePerHour(b.type, b.level) * (100 + ratePct(s, b))) / 100);
/** 지금 잔치 중인가 */
export const feasting = (s: VillageState, now: number) => now < s.profile.feastUntil;

/**
 * 생산 건물에 쌓여 있는 양 (state 가 'done' 인 생산 건물):
 *   base  = floor(지난 초 × rate ÷ 3600)                 (지난 초는 최대 12시간)
 *   extra = floor(잔치와 겹친 초 × rate × 잔치 % ÷ 360000)
 *   units = min(banked + base + extra, floor(12시간 × rate × (100 + bonus_room_pct) ÷ 360000))
 */
function accrued(s: VillageState, b: Building, now: number): { units: number; base: number; from: number; rate: number } {
  const rate = effRate(s, b);
  const cap = capSec(s);
  const from = Math.max(b.collectedAt, now - cap * 1000);
  const base = Math.floor((Math.max(0, Math.floor((now - from) / 1000)) * rate) / 3600);
  const p = s.profile;
  const over = Math.max(0, Math.floor((Math.min(now, p.feastUntil) - Math.max(from, p.feastFrom)) / 1000));
  const extra = Math.floor((over * rate * p.feastPct) / 360000);
  return { units: Math.min(b.banked + base + extra, Math.floor((cap * rate * (100 + CONST.bonus_room_pct)) / 360000)), base, from, rate };
}

/** 쌓인 양: 생산 건물은 위의 식, 가공 건물은 다 끝난 묶음 */
export function stored(s: VillageState, b: Building, now: number): number {
  if (b.state === 'working') return b.finishAt !== null && b.finishAt <= now ? b.jobN : 0;
  if (b.state !== 'done' || !BUILDING[b.type].product) return 0;
  return accrued(s, b, now).units;
}
/** 가득 찼나 (12시간 분량) */
export const isFull = (s: VillageState, b: Building, now: number) => b.state === 'done' && !!BUILDING[b.type].product && now - b.collectedAt >= capSec(s) * 1000;

/** 쌓인 양을 건물에 적어 둔다 (생산량이 바뀌기 직전에 부른다) */
function bank(s: VillageState, b: Building, now: number) {
  if (b.state !== 'done' || !BUILDING[b.type].product) return;
  const a = accrued(s, b, now);
  b.banked = a.units;
  b.collectedAt = Math.min(now, a.from + Math.ceil((a.base * 3600) / a.rate) * 1000);
}
function bankAll(s: VillageState, now: number) {
  for (const b of s.buildings) bank(s, b, now);
}

/** 장터: 오늘 그 자원 100개의 값 · 오늘 더 벌 수 있는 엽전 */
export const priceOf = (res: ResId, now: number) => {
  const p = PRICES.find((v) => v.res === res);
  return p ? Math.floor((p.base * pricePct(kstDay(now), p.idx)) / 100) : 0;
};
export const sellCoins = (res: ResId, n: number, now: number) => {
  const p = PRICES.find((v) => v.res === res);
  return p ? Math.floor((n * p.base * pricePct(kstDay(now), p.idx)) / 10000) : 0;
};
export const market = (s: VillageState) => s.buildings.find((b) => b.type === 'market' && b.state === 'done') ?? null;
export function sellLeft(s: VillageState, now: number): number {
  const m = market(s);
  if (!m) return 0;
  return Math.max(0, MARKET_LIMIT[m.level - 1] - (s.profile.marketDay === kstDay(now) ? s.profile.marketSold : 0));
}

/** 지금 목표와 진행 */
export function goalStatus(s: VillageState): { def: GoalDef; have: number; done: boolean } | null {
  const def = GOALS[s.profile.goal];
  if (!def) return null;
  let have = 0;
  if (def.kind === 'build') have = s.buildings.filter((b) => b.type === def.type && b.state !== 'building').length;
  else if (def.kind === 'upgrade') have = Math.max(0, ...s.buildings.filter((b) => b.type === def.type && b.state !== 'building').map((b) => b.level));
  else if (def.kind === 'deco') have = s.buildings.filter((b) => BUILDING[b.type].kind === 'deco').length;
  else if (def.kind === 'level') have = s.profile.level;
  else have = s.profile.goalProgress;
  return { def, have: Math.min(have, def.n), done: have >= def.n };
}

// ───────────────────────── 상태 바꾸기 (모두 s 를 직접 고친다: 부르는 쪽이 사본을 넘긴다) ─────────────────────────

export function newVillage(now: number, hallId = 'hall'): VillageState {
  return {
    profile: { name: '', level: 1, exp: 0, resources: { ...START_RES }, landStage: 0, prosperity: 0, goal: 0, goalProgress: 0, marketDay: 0, marketSold: 0, feastFrom: 0, feastUntil: 0, feastPct: 0 },
    buildings: [{ id: hallId, type: 'hall', level: 1, x: HALL_AT.x, y: HALL_AT.y, state: 'done', finishAt: null, startAt: null, collectedAt: now, jobN: 0, banked: 0 }],
    sia: 0,
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

/** 지금 목표가 그 종류를 세고 있으면 횟수를 더한다 */
function progress(s: VillageState, kind: GoalKind, type: BuildingType | '', n: number) {
  const g = GOALS[s.profile.goal];
  if (n > 0 && g && COUNTED.includes(g.kind) && g.kind === kind && (g.type === '' || g.type === type)) s.profile.goalProgress += n;
}

/** 끝난 짓기·업그레이드를 마무리한다 (서버는 모든 요청의 처음에 이것을 한다) */
export function settle(s: VillageState, now: number): void {
  const due = s.buildings
    .filter((b) => (b.state === 'building' || b.state === 'upgrading') && b.finishAt !== null && b.finishAt <= now)
    .sort((a, b) => a.finishAt! - b.finishAt!);
  for (const b of due) {
    // 정자가 다 지어지거나 레벨이 오르면 그 전까지 쌓인 양을 먼저 적어 둔다
    if (b.type === 'pavilion') bankAll(s, now);
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

function pay(p: Profile, c: Cost) {
  if (!canPay(p, c)) fail('not enough');
  for (const k of COST_KEYS) p.resources[k] -= c[k];
}

export function build(s: VillageState, type: string, x: number, y: number, now: number, id: string): Building {
  settle(s, now);
  if (!isBuildingType(type)) return fail('bad type');
  const d = BUILDING[type];
  const have = countOf(s, type);
  // 아직 하나도 못 가지는 것은 'locked', 지금 레벨의 개수를 다 가졌으면 'limit'
  if (have >= maxCount(type, s.profile.level)) fail(have === 0 ? 'locked' : 'limit');
  if (d.buildSec > 0 && busyCount(s) >= slots(s)) fail('no slot');
  const why = placeError(s, type, x, y);
  if (why) fail(why);
  if (!canPay(s.profile, buildCost(type))) fail('not enough');
  // 특별 건물은 일반 자원과 함께 시아코인을 낸다
  if (d.sia > s.sia) fail('not enough coin');
  pay(s.profile, buildCost(type));
  s.sia -= d.sia;
  const b: Building = { id, type, level: 1, x, y, state: 'building', finishAt: now + d.buildSec * 1000, startAt: now, collectedAt: now, jobN: 0, banked: 0 };
  s.buildings.push(b);
  // 0초짜리(장식물 · 길)는 바로 끝난다
  settle(s, now);
  return b;
}

export function move(s: VillageState, id: string, x: number, y: number, now: number): void {
  settle(s, now);
  const b = s.buildings.find((v) => v.id === id) ?? fail('no building');
  if (b.state === 'stored') fail('stored');
  const why = placeError(s, b.type, x, y, id);
  if (why) fail(why);
  // 정자를 옮기면 모든 생산 건물의, 생산 건물을 옮기면 그 건물의 쌓인 양을 먼저 적어 둔다 (보너스가 바뀌므로)
  if (b.type === 'pavilion') bankAll(s, now);
  else bank(s, b, now);
  b.x = x;
  b.y = y;
}

/**
 * 건물 하나를 거둔다 → have 쌓여 있던 양 · got 창고에 들어간 양.
 * 건물은 비워진다: 창고에 들어가는 만큼만 담고 넘친 것은 버린다 (경험치는 쌓여 있던 양으로 준다 —
 * 창고가 가득 차도 수확 경험치가 끊기지 않아야 마을이 멈추지 않는다).
 */
function collect(s: VillageState, b: Building, now: number, cap: number): { have: number; got: number; res: ResId | null; job: boolean } {
  const none = { have: 0, got: 0, res: null, job: false };
  const room = (res: ResId) => (CAPPED.includes(res) ? cap - s.profile.resources[res] : Infinity);
  if (b.state === 'working') {
    // 가공: 묶음이 다 끝나야 거둔다
    const r = recipeOf(b.type);
    if (!r || b.finishAt === null || b.finishAt > now) return none;
    const have = b.jobN;
    const got = Math.max(0, Math.min(have, room(r.out)));
    s.profile.resources[r.out] += got;
    b.state = 'done';
    b.finishAt = null;
    b.startAt = null;
    b.jobN = 0;
    b.collectedAt = now;
    return { have, got, res: r.out, job: true };
  }
  const res = BUILDING[b.type].product;
  if (!res || b.state !== 'done') return none;
  const a = accrued(s, b, now);
  const have = a.units;
  if (have <= 0) return none;
  const got = Math.max(0, Math.min(have, room(res)));
  s.profile.resources[res] += got;
  // 거둔 만큼의 시간만 쓴다 (1개가 되다 만 시간은 남는다)
  b.banked = 0;
  b.collectedAt = Math.min(now, a.from + Math.ceil((a.base * 3600) / a.rate) * 1000);
  return { have, got, res, job: false };
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
  let total = 0;
  let jobExp = 0;
  for (const id of [...new Set(ids)]) {
    const b = s.buildings.find((v) => v.id === id);
    if (!b) continue;
    const { have, got, res, job } = collect(s, b, now, cap);
    if (have <= 0 || !res) continue;
    out.per[id] = got;
    if (got > 0) out.gained[res] = (out.gained[res] ?? 0) + got;
    out.lost += have - got;
    if (job) {
      jobExp += have * recipeOf(b.type)!.exp;
      progress(s, 'craft', b.type, have);
    } else total += have;
    progress(s, 'harvest', '', 1);
  }
  out.exp = Math.floor(total / CONST.harvest_exp_div) + jobExp;
  addExp(s.profile, out.exp);
  return out;
}

export function upgrade(s: VillageState, id: string, now: number): void {
  settle(s, now);
  const b = s.buildings.find((v) => v.id === id) ?? fail('no building');
  if (!upgradable(b.type)) fail('no upgrade');
  if (b.state !== 'done') fail('busy');
  if (b.level >= CONST.building_max_level) fail('max level');
  if (b.type === 'hall') {
    if (s.profile.level < HALL_NEED[b.level - 1]) fail('village level');
  } else if (b.level >= hallLevel(s)) fail('hall level');
  if (busyCount(s) >= slots(s)) fail('no slot');
  const c = upgradeCost(b.type, b.level);
  if (!canPay(s.profile, c)) fail('not enough');
  // 쌓여 있던 것은 먼저 거둔다 (창고에 들어가는 만큼, 넘친 것은 버린다. 경험치·목표 횟수는 없다)
  collect(s, b, now, storageCap(s));
  pay(s.profile, c);
  b.state = 'upgrading';
  b.startAt = now;
  b.finishAt = now + upgradeSec(b.type, b.level) * 1000;
}

/** 가공 시작: 재료를 내고 n개를 만든다 (다 끝나면 수확으로 거둔다) */
export function craft(s: VillageState, id: string, n: number, now: number): void {
  settle(s, now);
  const b = s.buildings.find((v) => v.id === id) ?? fail('no building');
  const r = recipeOf(b.type) ?? fail('no recipe');
  if (b.state !== 'done') fail('busy');
  if (!Number.isInteger(n) || n < 1 || n > batchMax(b.type, b.level)) fail('bad count');
  const need = (res: ResId) => (r.in1 === res ? r.n1 * n : 0) + (r.in2 === res ? r.n2 * n : 0);
  for (const k of RES_IDS) if (s.profile.resources[k] < need(k)) fail('not enough');
  for (const k of RES_IDS) s.profile.resources[k] -= need(k);
  b.state = 'working';
  b.jobN = n;
  b.startAt = now;
  b.finishAt = now + n * unitSec(b.type, b.level) * 1000;
}

/** 장터에서 팔기 → 받은 엽전. 시세는 서버 날짜로 정해지고, 하루에 벌 수 있는 엽전에 한도가 있다 */
export function sell(s: VillageState, res: string, n: number, now: number): number {
  settle(s, now);
  const m = market(s) ?? fail('no market');
  const price = PRICES.find((v) => v.res === res) ?? fail('bad resource');
  if (!Number.isInteger(n) || n < 1 || n > 1000000) fail('bad count');
  const p = s.profile;
  if (p.resources[price.res] < n) fail('not enough');
  const day = kstDay(now);
  const sold = p.marketDay === day ? p.marketSold : 0;
  const coins = sellCoins(price.res, n, now);
  if (coins < 1) fail('too few');
  if (sold + coins > MARKET_LIMIT[m.level - 1]) fail('sell limit');
  p.resources[price.res] -= n;
  p.resources.coin += coins;
  p.marketDay = day;
  p.marketSold = sold + coins;
  progress(s, 'sell', '', coins);
  return coins;
}

/** 보관함에 넣기 (마을 회관은 안 된다. 쌓여 있던 것은 먼저 거둔다) */
export function store(s: VillageState, id: string, now: number): void {
  settle(s, now);
  const b = s.buildings.find((v) => v.id === id) ?? fail('no building');
  if (b.type === 'hall') fail('cannot store');
  if (b.state !== 'done') fail(b.state === 'stored' ? 'stored' : 'busy');
  if (b.type === 'pavilion') bankAll(s, now);
  collect(s, b, now, storageCap(s));
  b.state = 'stored';
  b.banked = 0;
}

/** 보관함에서 꺼내 놓기 (생산은 놓은 순간부터 다시 쌓인다) */
export function place(s: VillageState, id: string, x: number, y: number, now: number): void {
  settle(s, now);
  const b = s.buildings.find((v) => v.id === id) ?? fail('no building');
  if (b.state !== 'stored') fail('not stored');
  const why = placeError(s, b.type, x, y, id);
  if (why) fail(why);
  if (b.type === 'pavilion') bankAll(s, now);
  b.x = x;
  b.y = y;
  b.state = 'done';
  b.collectedAt = now;
  b.banked = 0;
}

/** 땅 넓히기: 시아코인과 마을 레벨 조건. 건물 좌표는 그대로다 */
export function expand(s: VillageState, now: number): void {
  settle(s, now);
  const stage = s.profile.landStage;
  if (stage >= LAND_SIZES.length - 1) fail('max land');
  if (s.profile.level < LAND_NEED[stage]) fail('village level');
  if (s.sia < LAND_PRICE[stage]) fail('not enough coin');
  s.sia -= LAND_PRICE[stage];
  s.profile.landStage = stage + 1;
}

/** 잔치 열기: 떡을 내면 하루 동안 마을 전체 생산이 늘어난다 */
export function feast(s: VillageState, now: number): void {
  settle(s, now);
  const f = s.buildings.find((b) => b.type === 'feast' && b.state === 'done') ?? fail('no feast');
  const p = s.profile;
  if (now < p.feastUntil) fail('feast active');
  if (p.resources.cake < CONST.feast_cake) fail('not enough');
  // 지난 잔치의 몫까지 쌓인 양을 적어 둔 다음에 새 잔치를 연다
  bankAll(s, now);
  p.resources.cake -= CONST.feast_cake;
  p.feastFrom = now;
  p.feastUntil = now + CONST.feast_sec * 1000;
  p.feastPct = CONST.feast_pct + CONST.feast_pct_per * (f.level - 1);
  addExp(p, CONST.feast_exp);
}

export function claimGoal(s: VillageState, now: number): GoalDef {
  settle(s, now);
  const g = goalStatus(s) ?? fail('no goal');
  if (!g.done) fail('not done');
  // 보상은 창고 용량을 넘겨도 받는다 (다음 수확부터 용량이 적용된다)
  for (const k of COST_KEYS) s.profile.resources[k] += g.def[k];
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
const STATES: readonly BuildingState[] = ['building', 'upgrading', 'done', 'working', 'stored'];

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
    const state: BuildingState = STATES.includes(b.state as BuildingState) ? (b.state as BuildingState) : 'done';
    const timed = state === 'building' || state === 'upgrading' || state === 'working';
    buildings.push({
      id: b.id, type: b.type, level: int(b.level, 1, CONST.building_max_level, 1), x: int(b.x, 0, GRID_MAX - 1, 0), y: int(b.y, 0, GRID_MAX - 1, 0), state,
      finishAt: timed ? Number(b.finishAt) || 0 : null,
      startAt: timed ? Number(b.startAt) || 0 : null,
      collectedAt: Number(b.collectedAt) || 0,
      jobN: state === 'working' ? int(b.jobN, 0, 1e6, 0) : 0,
      banked: int(b.banked, 0, 1e12, 0),
    });
  }
  return {
    profile: {
      name: typeof p.name === 'string' ? p.name : '', level: int(p.level, 1, CONST.max_level, 1), exp: int(p.exp, 0, 1e9, 0), resources,
      landStage: int(p.landStage, 0, LAND_SIZES.length - 1, 0), prosperity: int(p.prosperity, 0, 1e9, 0), goal: int(p.goal, 0, 9999, 0), goalProgress: int(p.goalProgress, 0, 1e9, 0),
      marketDay: int(p.marketDay, -1e6, 1e6, 0), marketSold: int(p.marketSold, 0, 1e9, 0),
      feastFrom: int(p.feastFrom, 0, 1e15, 0), feastUntil: int(p.feastUntil, 0, 1e15, 0), feastPct: int(p.feastPct, 0, 1000, 0),
    },
    buildings,
    sia: int((raw as { sia?: unknown } | null)?.sia, 0, 1e12, 0),
  };
}

export const cloneState = (s: VillageState): VillageState => ({ ...s, profile: { ...s.profile, resources: { ...s.profile.resources } }, buildings: s.buildings.map((b) => ({ ...b })) });
