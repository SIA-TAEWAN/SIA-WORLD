import {
  CAPPED, CONST, COST_MUL, GRID_MAX, HALL_AT, HALL_CAP, HALL_NEED, LAND_NEED, LAND_PRICE, LAND_SIZES, LEVEL_EXP, MARKET_LIMIT, NAME_RE, PRICES, RATE_MUL, RES_IDS, START_RES, STORAGE_CAP, UPGRADE_EXP, UPGRADE_SEC,
  kstDay, pricePct, type ResId, type Resources,
} from '../data/balance';
import { MONUMENTS, type GameStats } from '../data/monuments';
import { BUILDING, isBuildingType, recipeOf, upgradable, type BuildingType } from '../data/buildings';
import { COUNTED, GOALS, type GoalDef } from '../data/goals';
import {
  AFF_BONUS, ASKS, DRAGON_BONUS, RATE_WORKERS, REQ, RESIDENT, RESIDENTS, TASKS, affLevel, isResidentId, mix, type ResidentId, type TaskKind,
} from '../data/residents';

/**
 * 시아마을의 규칙 (순수 함수). 진짜 계산은 서버 함수(supabase/migrations/047_village.sql + 049 ~ 054)가 서버 시간으로 한다.
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
  /** 쌓기 시작한 시각 (적어 둔 양 banked 가 있을 때만 뜻이 있다. 수확할 때만 바뀐다. 없으면 0) */
  accFrom: number;
}

export interface Profile {
  name: string;
  level: number;
  /** 지금 레벨에서 모은 경험치 */
  exp: number;
  resources: Resources;
  landStage: number;
  /** 번영도 (랭킹의 기준)와 그 값이 된 시각. 서버가 상태가 바뀔 때마다 다시 센다 */
  prosperity: number;
  prosperityAt: number;
  /** 받은 칭찬 수 */
  praiseCount: number;
  /** 오늘(praisedDay) 내가 칭찬한 마을들 */
  praisedDay: number;
  praised: string[];
  /** 지금 마을 목표의 번호 (GOALS 의 순서. 끝까지 했으면 GOALS.length) */
  goal: number;
  /** 지금 목표가 시작된 뒤에 센 횟수 (수확 · 판매 · 가공 · 부탁 · 배치) */
  goalProgress: number;
  /** 장터: 마지막으로 판 날(kstDay)과 그날 번 엽전 */
  marketDay: number;
  marketSold: number;
  /** 잔치: 시작 · 끝 시각과 보너스(%). 연 적이 없으면 0 */
  feastFrom: number;
  feastUntil: number;
  feastPct: number;
  /** 지금까지 만든 주민 부탁의 수 (다음 부탁을 정하는 번호) */
  reqSeq: number;
  /** 오늘의 할 일을 정한 날 · 다 끝낸 보상을 받은 날 · 닭의 첫 수확 보너스를 받은 날 (kstDay) */
  dailyDay: number;
  dailyBonusDay: number;
  roosterDay: number;
}

/** 이사 온 주민 */
export interface Resident {
  id: ResidentId;
  /** 친밀도 점수 */
  affinity: number;
  /** 배치한 건물 */
  building: string | null;
  /** 전용 장식물 선물을 받았나 */
  gifted: boolean;
}

/** 주민 부탁 칸 (셋). wait 면 readyAt 에 새 부탁이 온다 */
export interface Ask {
  slot: number;
  state: 'open' | 'wait';
  readyAt: number;
  resident: ResidentId | '';
  res: ResId | '';
  n: number;
  coin: number;
  exp: number;
  aff: number;
}

/** 오늘의 할 일 (셋) */
export interface DailyTask {
  slot: number;
  task: TaskKind;
  n: number;
  progress: number;
  claimed: boolean;
  coin: number;
  exp: number;
}

export interface VillageState {
  profile: Profile;
  buildings: Building[];
  /** 시아코인 잔액 (SIA WORLD 공통 지갑) */
  sia: number;
  /** 이사 온 순서대로 */
  residents: Resident[];
  requests: Ask[];
  daily: DailyTask[];
  /** 열린 기념물 (PRD 9장) */
  monuments: BuildingType[];
  /**
   * 관리자 계정 (profiles.is_admin, 062): 마을 레벨은 늘 최고 · 땅은 끝까지 열림, 짓기 · 사기에 개수 · 해금 · 건설 슬롯 제한이 없고
   * 짓기 · 업그레이드 · 땅 넓히기에 아무 값도 내지 않는다 (마을 회관은 하나, 자리 확인 · 최고 레벨 10 은 그대로).
   * 063: 가공 재료 · 판 자원(장터 하루 한도도 없음) · 잔치 떡 · 부탁한 자원도 내지 않는다 (받는 것은 그대로). 번영도 랭킹에 나오지 않는다
   */
  admin: boolean;
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
/** 레벨 n → n+1 업그레이드 값. 돌은 건물 레벨 stone_from 부터, 엽전은 coin_from 부터 든다 */
export function upgradeCost(type: BuildingType, level: number): Cost {
  const d = BUILDING[type];
  const m = COST_MUL[level - 1];
  return { rice: Math.floor((d.rice * m) / 10), wood: Math.floor((d.wood * m) / 10), stone: level >= CONST.stone_from ? Math.floor((d.upStone * m) / 10) : 0,
    coin: level >= CONST.coin_from ? Math.floor(((d.rice + d.wood) * m * CONST.up_coin_pct) / 1000) : 0,
  };
}
export const canPay = (p: Profile, c: Cost) => COST_KEYS.every((k) => p.resources[k] >= c[k]);
/** 관리자는 아무 값도 내지 않는다: 실제로 내는 값 (쌀 · 나무 · 돌 · 엽전) · 시아코인 */
export const FREE: Cost = { rice: 0, wood: 0, stone: 0, coin: 0 };
export const payOf = (s: VillageState, c: Cost): Cost => (s.admin ? FREE : c);
export const siaOf = (s: VillageState, n: number): number => (s.admin ? 0 : n);
/** 하나 더 가질 수 있나 (관리자는 마을 회관 말고는 제한이 없다) */
export const canHaveMore = (s: VillageState, type: BuildingType): boolean =>
  (s.admin && type !== 'hall') || countOf(s, type) < maxCount(type, s.profile.level);
export const upgradeExp = (type: BuildingType, level: number) => UPGRADE_EXP[level - 1] * (type === 'hall' ? CONST.hall_exp_mul : 1);
/** 시간당 생산량 (보너스 없이) */
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

// ───────────────────────── 주민 ─────────────────────────

export const residentOf = (s: VillageState, id: ResidentId) => s.residents.find((r) => r.id === id) ?? null;
/** 그 주민이 일하고 있는 건물 (제 일터에 배치되어 있고, 그 건물이 서 있을 때) */
export function workplace(s: VillageState, id: ResidentId): Building | null {
  const r = residentOf(s, id);
  if (!r || !r.building) return null;
  const b = s.buildings.find((v) => v.id === r.building);
  return b && b.type === RESIDENT[id].work && standing(b) ? b : null;
}
/** 그 주민의 보너스 (%): 일터가 있는 주민은 일하고 있을 때, 닭 · 개는 이사 와 있을 때. 아니면 0 */
export function residentPct(s: VillageState, id: ResidentId): number {
  const r = residentOf(s, id);
  if (!r) return 0;
  if (RESIDENT[id].work !== '' && !workplace(s, id)) return 0;
  return (id === 'dragon' ? DRAGON_BONUS : AFF_BONUS)[affLevel(r.affinity) - 1];
}
/** 그 건물에서 일하는 주민들 */
export const workersAt = (s: VillageState, b: Building) => s.residents.filter((r) => r.building === b.id && workplace(s, r.id)?.id === b.id).map((r) => r.id);
/** 짓기 · 업그레이드에 걸리는 시간: 용이 마을 회관에 있으면 줄어든다 */
export const timeCut = (s: VillageState, sec: number) => Math.floor((sec * (100 - residentPct(s, 'dragon'))) / 100);
export const buildSec = (s: VillageState, type: BuildingType) => timeCut(s, BUILDING[type].buildSec);
export const upgradeSec = (s: VillageState, type: BuildingType, level: number) => timeCut(s, UPGRADE_SEC[level - 1] * (type === 'hall' ? CONST.hall_sec_mul : 1));

/** 창고 용량: 마을 회관 + 놓여 있는 창고들 (쥐가 있는 창고는 더 크다) */
export function storageCap(s: VillageState): number {
  let cap = HALL_CAP[hallLevel(s) - 1];
  const rat = workplace(s, 'rat');
  for (const b of s.buildings) {
    if (b.type !== 'storage' || !standing(b)) continue;
    cap += rat?.id === b.id ? Math.floor((STORAGE_CAP[b.level - 1] * (100 + residentPct(s, 'rat'))) / 100) : STORAGE_CAP[b.level - 1];
  }
  return cap;
}

/** 동시에 지을 수 있는 수 · 지금 짓는 수 */
export const slots = (s: VillageState) => (hallLevel(s) >= CONST.slots3_hall ? CONST.base_slots + 1 : CONST.base_slots);
export const busyCount = (s: VillageState) => s.buildings.filter((b) => b.state === 'building' || b.state === 'upgrading').length;
/** 하나 더 짓기 시작할 수 있나 (관리자는 건설 슬롯 제한이 없다) */
export const slotFree = (s: VillageState) => s.admin || busyCount(s) < slots(s);
/** 업그레이드의 레벨 조건: 마을 회관은 마을 레벨(HALL_NEED)이, 다른 건물은 마을 회관 레벨이 상한 (관리자는 없다) */
export function upgradeGate(s: VillageState, b: Building): 'village level' | 'hall level' | null {
  if (s.admin) return null;
  if (b.type === 'hall') return s.profile.level < HALL_NEED[b.level - 1] ? 'village level' : null;
  return b.level >= hallLevel(s) ? 'hall level' : null;
}
/** 땅 넓히기의 마을 레벨 조건을 채웠나 (관리자는 늘) */
export const landOpen = (s: VillageState) => s.admin || s.profile.level >= LAND_NEED[s.profile.landStage];

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

/** 가공: 한 번에 넣을 수 있는 개수 · 하나를 만드는 시간(초. 토끼 · 뱀이 있으면 더 빨리) */
export function batchMax(type: BuildingType, level: number): number {
  const r = recipeOf(type);
  return r ? r.base + r.per * (level - 1) : 0;
}
export function unitSec(s: VillageState, b: Building): number {
  const r = recipeOf(b.type);
  if (!r) return 0;
  const worker: ResidentId = b.type === 'mill' ? 'rabbit' : 'snake';
  const pct = workplace(s, worker)?.id === b.id ? residentPct(s, worker) : 0;
  return Math.floor((Math.floor((r.sec * 10) / RATE_MUL[b.level - 1]) * 100) / (100 + pct));
}

/** 정자의 영향이 닿는 거리 (칸. 양이 정자에 있으면 한 칸 더) · 생산 건물이 쌓아 두는 최대 시간 (초. 개가 있으면 15시간) */
export const pavilionRange = (s: VillageState) => CONST.pavilion_range + (workplace(s, 'sheep') ? REQ.sheep_range : 0);
export const capSec = (s: VillageState) => (residentOf(s, 'dog') ? REQ.dog_cap_sec : CONST.prod_cap_sec);
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
/** 그 건물의 생산 보너스 (%): 정자 둘레 + 그 건물에서 일하는 주민(소 · 호랑이 · 원숭이). 생산 건물이 아니면 0 */
export function ratePct(s: VillageState, b: Building): number {
  const d = BUILDING[b.type];
  if (!d.product || b.state === 'stored') return 0;
  const pv = pavilion(s);
  let pct = pv && nearPavilion(s, b.x, b.y, d.w, d.h) ? CONST.pavilion_pct + CONST.pavilion_pct_per * (pv.level - 1) : 0;
  for (const id of RATE_WORKERS) if (workplace(s, id)?.id === b.id) pct += residentPct(s, id);
  return pct;
}
/** 보너스를 넣은 시간당 생산량 */
export const effRate = (s: VillageState, b: Building) => Math.floor((ratePerHour(b.type, b.level) * (100 + ratePct(s, b))) / 100);
/** 지금 잔치 중인가 */
export const feasting = (s: VillageState, now: number) => now < s.profile.feastUntil;

/** 쌓기 시작한 시각: 적어 둔 양이 있으면 그때의 시작 시각, 없으면 마지막 수확 시각 (SQL _village_acc_start) */
export const accStart = (b: Building) => (b.banked > 0 && b.accFrom > 0 ? b.accFrom : b.collectedAt);

/**
 * 생산 건물에 쌓여 있는 양 (state 가 'done' 인 생산 건물. SQL _village_units):
 *   fin   = min(지금, 쌓기 시작한 시각 + 최대 시간)      (최대 12시간. 개가 있으면 15시간. 이 뒤로는 쌓이지 않는다)
 *   base  = floor((fin − 마지막 수확)의 초 × rate ÷ 3600)
 *   extra = floor(잔치와 겹친 초 × rate × 잔치 % ÷ 360000) (마지막 수확 ~ fin)
 *   units = min(banked + base + extra, floor(최대 시간 × rate × (100 + bonus_room_pct) ÷ 360000))
 *   next  = 다음 마지막 수확 시각: min(지금, 마지막 수확 + ceil(base × 3600 ÷ rate) 초 + (지금 − fin))
 *           (거둔 개수만큼의 시간만 쓰고 1개가 되다 만 시간은 남긴다. 상한에서 잘린 fin ~ 지금은 버린다)
 * 옮기기 · 주민 배치로 쌓인 양을 적어 두어도(banked) 쌓기 시작한 시각은 그대로라, 합계는 그 시각부터 최대 시간까지의 양을 넘지 않는다.
 */
function accrued(s: VillageState, b: Building, now: number): { units: number; next: number } {
  const rate = effRate(s, b);
  const cap = capSec(s);
  const fin = Math.min(now, accStart(b) + cap * 1000);
  const base = Math.floor((Math.max(0, Math.floor((fin - b.collectedAt) / 1000)) * rate) / 3600);
  const used = b.collectedAt + Math.ceil((base * 3600) / rate) * 1000;
  const p = s.profile;
  const over = Math.max(0, Math.floor((Math.min(fin, p.feastUntil) - Math.max(b.collectedAt, p.feastFrom)) / 1000));
  const extra = Math.floor((over * rate * p.feastPct) / 360000);
  return { units: Math.min(b.banked + base + extra, storedMax(s, b)), next: Math.min(now, used + (now - fin)) };
}
/** 보통 때 쌓이는 최대 양 = 최대 시간 × 시간당 생산량 (잔치·적어 둔 양이 없을 때 가득 찬 양. 화면에 보이는 "최대 n시간 분량") */
export const normalMax = (s: VillageState, b: Building) => Math.floor((capSec(s) * effRate(s, b)) / 3600);
/** 생산 건물에 쌓일 수 있는 최대 양 (최대 시간 × 시간당 생산량에 bonus_room_pct 만큼 여유: 잔치 · 적어 둔 양도 이 안에서) */
export const storedMax = (s: VillageState, b: Building) => Math.floor((capSec(s) * effRate(s, b) * (100 + CONST.bonus_room_pct)) / 360000);

/** 쌓인 양: 생산 건물은 위의 식, 가공 건물은 다 끝난 묶음 */
export function stored(s: VillageState, b: Building, now: number): number {
  if (b.state === 'working') return b.finishAt !== null && b.finishAt <= now ? b.jobN : 0;
  if (b.state !== 'done' || !BUILDING[b.type].product) return 0;
  return accrued(s, b, now).units;
}
/** 가득 찼나 */
export const isFull = (s: VillageState, b: Building, now: number) => b.state === 'done' && !!BUILDING[b.type].product && now - accStart(b) >= capSec(s) * 1000;

/** 쌓인 양을 건물에 적어 둔다 (생산량이 바뀌기 직전에 부른다) */
function bank(s: VillageState, b: Building | null, now: number) {
  if (!b || b.state !== 'done' || !BUILDING[b.type].product) return;
  const a = accrued(s, b, now);
  b.accFrom = accStart(b);
  b.banked = a.units;
  b.collectedAt = a.next;
}
function bankAll(s: VillageState, now: number) {
  for (const b of s.buildings) bank(s, b, now);
}

/** 장터: 오늘 그 자원 100개의 값 · n개를 팔면 받는 엽전 (돼지가 있으면 더) · 하루 한도 (말이 있으면 더) · 오늘 더 벌 수 있는 엽전 */
export const priceOf = (s: VillageState, res: ResId, now: number) => sellCoins(s, res, 100, now);
export function sellCoins(s: VillageState, res: ResId, n: number, now: number): number {
  const p = PRICES.find((v) => v.res === res);
  return p ? Math.floor((n * p.base * pricePct(kstDay(now), p.idx) * (100 + residentPct(s, 'pig'))) / 1000000) : 0;
}
export const market = (s: VillageState) => s.buildings.find((b) => b.type === 'market' && b.state === 'done') ?? null;
export function marketLimit(s: VillageState): number {
  const m = market(s);
  return m ? Math.floor((MARKET_LIMIT[m.level - 1] * (100 + residentPct(s, 'horse'))) / 100) : 0;
}
export const sellLeft = (s: VillageState, now: number) => Math.max(0, marketLimit(s) - (s.profile.marketDay === kstDay(now) ? s.profile.marketSold : 0));

/**
 * 번영도 (PRD 11장) = 건물 레벨 합 + 장식물 · 특별 건물 · 기념물의 번영도 점수 + 주민 친밀도 + 받은 칭찬.
 * 땅에 놓여 있고 다 지어진 것만 센다 (짓는 중 · 보관함은 빼고).
 */
export function prosperityOf(s: VillageState): number {
  let n = 0;
  for (const b of s.buildings) {
    if (!standing(b)) continue;
    const d = BUILDING[b.type];
    if (d.kind === 'main' || d.kind === 'special') n += b.level;
    n += d.points;
  }
  for (const r of s.residents) n += affLevel(r.affinity) * CONST.aff_points;
  return n + s.profile.praiseCount * CONST.praise_points;
}
/** 번영도를 다시 세어 적는다 (서버는 답을 보내기 직전에 한다). 값이 바뀌면 달성 시각도 바뀐다 */
export function refresh(s: VillageState, now: number): void {
  const v = prosperityOf(s);
  if (v !== s.profile.prosperity) {
    s.profile.prosperity = v;
    s.profile.prosperityAt = now;
  }
}
/** 오늘 더 칭찬할 수 있는 횟수 */
export const praiseLeft = (s: VillageState, now: number) => CONST.praise_per_day - (s.profile.praisedDay === kstDay(now) ? s.profile.praised.length : 0);

/** 지금 목표와 진행 */
export function goalStatus(s: VillageState): { def: GoalDef; have: number; done: boolean } | null {
  const def = GOALS[s.profile.goal];
  if (!def) return null;
  let have = 0;
  if (def.kind === 'build') have = s.buildings.filter((b) => b.type === def.type && b.state !== 'building').length;
  else if (def.kind === 'upgrade') have = Math.max(0, ...s.buildings.filter((b) => b.type === def.type && b.state !== 'building').map((b) => b.level));
  else if (def.kind === 'deco') have = s.buildings.filter((b) => BUILDING[b.type].kind === 'deco').length;
  else if (def.kind === 'resident') have = s.residents.length;
  else if (def.kind === 'level') have = s.profile.level;
  else have = s.profile.goalProgress;
  return { def, have: Math.min(have, def.n), done: have >= def.n };
}

/** 주민 부탁 하나를 정한다 (번호 · 마을 레벨 · 이사 온 주민으로 정해진다) */
export function makeAsk(seq: number, level: number, residents: ResidentId[]): Omit<Ask, 'slot' | 'state' | 'readyAt'> {
  const pool = ASKS.filter((a) => a.from <= level);
  const a = pool[mix(seq, 2) % pool.length];
  const n = Math.max(1, Math.floor((a.base * (2 + (mix(seq, 3) % 4)) * (20 + level * a.grow)) / 20));
  const v = Math.floor((n * a.worth) / 100);
  return {
    resident: residents[mix(seq, 1) % residents.length], res: a.res, n,
    coin: Math.floor((v * 3) / 2) + 10, exp: Math.floor((v * CONST.req_exp_pct) / 100) + 5 + level * 2, aff: 2 + (mix(seq, 4) % 3),
  };
}

/** 오늘의 할 일 셋을 정한다 (날짜 · 마을 레벨로 정해진다) */
export function makeDaily(day: number, level: number): DailyTask[] {
  const pool = TASKS.filter((t) => t.from <= level);
  const start = mix(day, 5) % pool.length;
  const need = LEVEL_EXP[Math.min(level, LEVEL_EXP.length) - 1];
  return [0, 1, 2].map((i) => {
    const t = pool[(start + i) % pool.length];
    return { slot: i, task: t.task, n: t.base + t.per * level, progress: 0, claimed: false, coin: 20 + level * 5, exp: Math.floor((need * CONST.daily_exp_pct) / 100) + 10 };
  });
}
/** 오늘의 할 일을 다 끝냈을 때의 추가 보상 */
export function dailyBonus(level: number): { coin: number; exp: number } {
  const need = LEVEL_EXP[Math.min(level, LEVEL_EXP.length) - 1];
  return { coin: 50 + level * 10, exp: Math.floor((need * CONST.daily_exp_pct * 2) / 100) + 20 };
}

// ───────────────────────── 상태 바꾸기 (모두 s 를 직접 고친다: 부르는 쪽이 사본을 넘긴다) ─────────────────────────

export function newVillage(now: number, hallId = 'hall'): VillageState {
  return {
    profile: {
      name: '', level: 1, exp: 0, resources: { ...START_RES }, landStage: 0, prosperity: 0, prosperityAt: now, praiseCount: 0, praisedDay: 0, praised: [], goal: 0, goalProgress: 0, marketDay: 0, marketSold: 0,
      feastFrom: 0, feastUntil: 0, feastPct: 0, reqSeq: 0, dailyDay: 0, dailyBonusDay: 0, roosterDay: 0,
    },
    buildings: [{ id: hallId, type: 'hall', level: 1, x: HALL_AT.x, y: HALL_AT.y, state: 'done', finishAt: null, startAt: null, collectedAt: now, jobN: 0, banked: 0, accFrom: 0 }],
    sia: 0,
    residents: [],
    requests: [],
    daily: [],
    monuments: [],
    admin: false,
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

/** 한 일을 센다: 지금 마을 목표가 그 종류를 세고 있으면 그 횟수에, 오늘의 할 일에 그 종류가 있으면 거기에 */
function progress(s: VillageState, kind: string, type: BuildingType | '', n: number) {
  if (n <= 0) return;
  const g = GOALS[s.profile.goal];
  if (g && COUNTED.includes(g.kind) && g.kind === kind && (g.type === '' || g.type === type)) s.profile.goalProgress += n;
  for (const t of s.daily) if (t.task === kind && !t.claimed) t.progress = Math.min(t.n, t.progress + n);
}

/**
 * 서버가 모든 요청의 처음에 하는 일:
 *   1. 끝난 짓기 · 업그레이드를 마무리한다 (경험치. 생산은 끝난 시각부터)
 *   2. 마을 레벨이 되고 빈 주민 집이 있으면 주민이 순서대로 이사 온다
 *   3. 기다리던 부탁 칸에 새 부탁을 넣는다
 *   4. 날이 바뀌었으면 오늘의 할 일을 새로 정한다
 */
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
  // 이사: 순서대로, 마을 레벨이 되고 빈 집이 있을 때
  const houses = s.buildings.filter((b) => b.type === 'house' && standing(b)).length;
  for (const d of RESIDENTS) {
    if (residentOf(s, d.id)) continue;
    if (s.profile.level < d.level || houses <= s.residents.length) break;
    s.residents.push({ id: d.id, affinity: 0, building: null, gifted: false });
  }
  // 부탁: 주민이 있으면 칸 셋. 기다림이 끝난 칸에 새 부탁
  if (s.residents.length > 0) {
    for (let i = s.requests.length; i < REQ.slots; i++) s.requests.push({ slot: i, state: 'wait', readyAt: now, resident: '', res: '', n: 0, coin: 0, exp: 0, aff: 0 });
    const ids = s.residents.map((r) => r.id);
    for (const q of s.requests) {
      if (q.state !== 'wait' || q.readyAt > now) continue;
      Object.assign(q, makeAsk(++s.profile.reqSeq, s.profile.level, ids), { state: 'open', readyAt: 0 });
    }
  }
  // 오늘의 할 일
  const day = kstDay(now);
  if (s.profile.dailyDay !== day) {
    s.daily = makeDaily(day, s.profile.level);
    s.profile.dailyDay = day;
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
  // 아직 하나도 못 가지는 것은 'locked', 지금 레벨의 개수를 다 가졌으면 'limit' (관리자는 마을 회관만)
  if (!canHaveMore(s, type)) fail(have === 0 ? 'locked' : 'limit');
  if (d.buildSec > 0 && !slotFree(s)) fail('no slot');
  const why = placeError(s, type, x, y);
  if (why) fail(why);
  // 관리자는 아무 값도 내지 않는다
  const cost = payOf(s, buildCost(type));
  if (!canPay(s.profile, cost)) fail('not enough');
  // 특별 건물은 일반 자원과 함께 시아코인을 낸다
  const sia = siaOf(s, d.sia);
  if (sia > s.sia) fail('not enough coin');
  pay(s.profile, cost);
  s.sia -= sia;
  const b: Building = { id, type, level: 1, x, y, state: 'building', finishAt: now + buildSec(s, type) * 1000, startAt: now, collectedAt: now, jobN: 0, banked: 0, accFrom: 0 };
  s.buildings.push(b);
  if (d.buildSec > 0) progress(s, 'construct', '', 1);
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
 * bonus: 닭의 첫 수확 보너스 (%. 생산 건물에만)
 */
function collect(s: VillageState, b: Building, now: number, cap: number, bonus = 0): { have: number; got: number; res: ResId | null; job: boolean } {
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
  if (a.units <= 0) return none;
  const have = a.units + Math.floor((a.units * bonus) / 100);
  const got = Math.max(0, Math.min(have, room(res)));
  s.profile.resources[res] += got;
  // 거둔 만큼의 시간만 쓴다 (1개가 되다 만 시간은 남는다). 쌓기 시작한 시각은 지운다
  b.banked = 0;
  b.accFrom = 0;
  b.collectedAt = a.next;
  return { have, got, res, job: false };
}

export interface HarvestResult {
  /** 건물별로 창고에 들어간 양 (거둔 건물은 0 이어도 들어 있다) */
  per: Record<string, number>;
  gained: Partial<Record<ResId, number>>;
  exp: number;
  /** 창고가 가득 차서 버린 양 (0 이면 다 담았다) */
  lost: number;
  /** 닭의 첫 수확 보너스 (%. 받지 않았으면 0) */
  rooster: number;
}

export function harvest(s: VillageState, ids: string[], now: number): HarvestResult {
  settle(s, now);
  if (ids.length === 0 || ids.length > CONST.harvest_max) fail('bad request');
  const cap = storageCap(s);
  const day = kstDay(now);
  // 닭: 그날의 첫 수확에 보너스
  const bonus = s.profile.roosterDay !== day ? residentPct(s, 'rooster') : 0;
  const out: HarvestResult = { per: {}, gained: {}, exp: 0, lost: 0, rooster: 0 };
  let total = 0;
  let jobExp = 0;
  let count = 0;
  for (const id of [...new Set(ids)]) {
    const b = s.buildings.find((v) => v.id === id);
    if (!b) continue;
    const { have, got, res, job } = collect(s, b, now, cap, bonus);
    if (have <= 0 || !res) continue;
    out.per[id] = got;
    if (got > 0) out.gained[res] = (out.gained[res] ?? 0) + got;
    out.lost += have - got;
    if (job) {
      jobExp += have * recipeOf(b.type)!.exp;
      progress(s, 'craft', b.type, have);
    } else {
      total += have;
      count++;
    }
    progress(s, 'harvest', '', 1);
  }
  // 생산 건물을 하나라도 거뒀을 때만 그날의 보너스를 쓴 것으로 친다 (가공만 거둔 것은 아니다)
  if (bonus > 0 && count > 0) {
    s.profile.roosterDay = day;
    out.rooster = bonus;
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
  const gate = upgradeGate(s, b);
  if (gate) fail(gate);
  if (!slotFree(s)) fail('no slot');
  const c = payOf(s, upgradeCost(b.type, b.level));
  if (!canPay(s.profile, c)) fail('not enough');
  // 쌓여 있던 것은 먼저 거둔다 (창고에 들어가는 만큼, 넘친 것은 버린다. 경험치·목표 횟수는 없다)
  collect(s, b, now, storageCap(s));
  pay(s.profile, c);
  const sec = upgradeSec(s, b.type, b.level);
  b.state = 'upgrading';
  b.startAt = now;
  b.finishAt = now + sec * 1000;
  progress(s, 'construct', '', 1);
}

/** 가공 시작: 재료를 내고 n개를 만든다 (다 끝나면 수확으로 거둔다) */
export function craft(s: VillageState, id: string, n: number, now: number): void {
  settle(s, now);
  const b = s.buildings.find((v) => v.id === id) ?? fail('no building');
  const r = recipeOf(b.type) ?? fail('no recipe');
  if (b.state !== 'done') fail('busy');
  if (!Number.isInteger(n) || n < 1 || n > batchMax(b.type, b.level)) fail('bad count');
  // 관리자는 재료를 내지 않는다 (063)
  const need = (res: ResId) => (s.admin ? 0 : (r.in1 === res ? r.n1 * n : 0) + (r.in2 === res ? r.n2 * n : 0));
  for (const k of RES_IDS) if (s.profile.resources[k] < need(k)) fail('not enough');
  for (const k of RES_IDS) s.profile.resources[k] -= need(k);
  const unit = unitSec(s, b);
  b.state = 'working';
  b.jobN = n;
  b.startAt = now;
  b.finishAt = now + n * unit * 1000;
}

/** 장터에서 팔기 → 받은 엽전. 시세는 서버 날짜로 정해지고, 하루에 벌 수 있는 엽전에 한도가 있다 */
export function sell(s: VillageState, res: string, n: number, now: number): number {
  settle(s, now);
  if (!market(s)) fail('no market');
  const price = PRICES.find((v) => v.res === res) ?? fail('bad resource');
  if (!Number.isInteger(n) || n < 1 || n > 1000000) fail('bad count');
  const p = s.profile;
  // 관리자는 판 자원이 줄지 않고 하루 한도가 없다 (엽전은 받는다. 063)
  if (!s.admin && p.resources[price.res] < n) fail('not enough');
  const day = kstDay(now);
  const sold = p.marketDay === day ? p.marketSold : 0;
  const coins = sellCoins(s, price.res, n, now);
  if (coins < 1) fail('too few');
  if (!s.admin && sold + coins > marketLimit(s)) fail('sell limit');
  if (!s.admin) p.resources[price.res] -= n;
  p.resources.coin += coins;
  p.marketDay = day;
  p.marketSold = Math.min(sold + coins, 2e9);
  progress(s, 'sell', '', coins);
  return coins;
}

/** 보관함에 넣기 (마을 회관은 안 된다. 쌓여 있던 것은 먼저 거둔다. 거기서 일하던 주민은 쉰다) */
export function store(s: VillageState, id: string, now: number): void {
  settle(s, now);
  const b = s.buildings.find((v) => v.id === id) ?? fail('no building');
  if (b.type === 'hall') fail('cannot store');
  if (b.state !== 'done') fail(b.state === 'stored' ? 'stored' : 'busy');
  if (b.type === 'pavilion') bankAll(s, now);
  collect(s, b, now, storageCap(s));
  b.state = 'stored';
  b.banked = 0;
  for (const r of s.residents) if (r.building === b.id) r.building = null;
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
  if (!landOpen(s)) fail('village level');
  const price = siaOf(s, LAND_PRICE[stage]);
  if (s.sia < price) fail('not enough coin');
  s.sia -= price;
  s.profile.landStage = stage + 1;
}

/** 관리자의 마을: 마을 레벨은 최고(경험치 0), 땅은 끝까지 (SQL village_state). 바뀌었으면 true */
export function adminBoost(s: VillageState): boolean {
  if (!s.admin) return false;
  const p = s.profile;
  const top = LAND_SIZES.length - 1;
  if (p.level === CONST.max_level && p.exp === 0 && p.landStage === top) return false;
  p.level = CONST.max_level;
  p.exp = 0;
  p.landStage = top;
  return true;
}

/**
 * 관리자: 내 마을을 주어진 모양(전시 마을, data/showcase.ts 의 makeShowcase)으로 바꾼다 (SQL village_admin_set_state).
 *   건물 · 주민을 새로 넣는다 (id 는 idFor 로 새로. 주민의 배치는 보낸 id 로 이어 준다). 짓는 중 · 가공 중인 것은 없다 (다 지은 것 · 보관함)
 *   자리가 틀리면(땅 밖 · 겹침) · 마을 회관이 땅 위에 하나가 아니면 'bad state' 로 통째로 거절 (s 는 그대로)
 *   부탁 · 오늘의 할 일 · 잔치 · 장터 기록은 비우고 다시 정한다. 받은 칭찬 · 시아코인은 그대로, 이름은 규칙에 맞을 때만
 *   기념물: 보낸 목록 + 놓인 기념물 + 이미 열린 것
 */
export function adminSetState(s: VillageState, input: VillageState, now: number, idFor: () => string): void {
  settle(s, now);
  if (!s.admin) fail('not admin');
  const raw = (input ?? {}) as Partial<VillageState>;
  if (!Array.isArray(raw.buildings) || raw.buildings.length > 500) fail('bad state');
  const ip = (raw.profile ?? {}) as Partial<Profile>;
  const ir = (ip.resources ?? {}) as Partial<Resources>;
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d);
  const next = cloneState(s);
  const p = next.profile;
  if (typeof ip.name === 'string' && ip.name.length >= 1 && ip.name.length <= CONST.name_max && NAME_RE.test(ip.name)) p.name = ip.name;
  Object.assign(p, {
    level: CONST.max_level, exp: 0, landStage: n(ip.landStage, 0, LAND_SIZES.length - 1, LAND_SIZES.length - 1), goal: n(ip.goal, 0, GOALS.length, 0), goalProgress: 0,
    marketDay: 0, marketSold: 0, feastFrom: 0, feastUntil: 0, feastPct: 0, dailyDay: -1, dailyBonusDay: 0, roosterDay: 0,
  });
  p.resources = Object.fromEntries(RES_IDS.map((k) => [k, n(ir[k], 0, 1e9, 0)])) as Resources;
  next.buildings = [];
  next.residents = [];
  next.requests = [];
  next.daily = [];
  const ids = new Map<string, string>();
  for (const v of raw.buildings as unknown[]) {
    const e = (v ?? {}) as Partial<Building>;
    if (typeof v !== 'object' || v === null || !isBuildingType(e.type)) return fail('bad state');
    const kept = e.state === 'stored' && e.type !== 'hall';
    const b: Building = {
      id: idFor(), type: e.type, level: upgradable(e.type) ? n(e.level, 1, CONST.building_max_level, 1) : 1, x: 0, y: 0, state: kept ? 'stored' : 'done',
      finishAt: null, startAt: null, collectedAt: now, jobN: 0, banked: 0, accFrom: 0,
    };
    if (!kept) {
      b.x = n(e.x, -1, 99, -1);
      b.y = n(e.y, -1, 99, -1);
      if (typeof e.x !== 'number' || typeof e.y !== 'number' || placeError(next, e.type, b.x, b.y)) return fail('bad state');
    }
    next.buildings.push(b);
    if (typeof e.id === 'string') ids.set(e.id, b.id);
  }
  if (next.buildings.filter((b) => b.type === 'hall').length !== 1) fail('bad state');
  for (const v of Array.isArray(raw.residents) ? raw.residents : []) {
    const e = (v ?? {}) as Partial<Resident>;
    if (!isResidentId(e.id) || residentOf(next, e.id)) continue;
    let at = typeof e.building === 'string' ? (ids.get(e.building) ?? null) : null;
    const to = at ? next.buildings.find((b) => b.id === at) : null;
    if (!to || to.type !== RESIDENT[e.id].work || to.state !== 'done') at = null;
    next.residents.push({ id: e.id, affinity: n(e.affinity, 0, 1e6, 0), building: at, gifted: e.gifted === true });
  }
  next.residents.sort((a, b) => RESIDENTS.findIndex((d) => d.id === a.id) - RESIDENTS.findIndex((d) => d.id === b.id));
  const sent = Array.isArray(raw.monuments) ? raw.monuments : [];
  next.monuments = MONUMENTS.map((m) => m.id).filter((id) => s.monuments.includes(id) || sent.includes(id) || next.buildings.some((b) => b.type === id));
  // 부탁 · 오늘의 할 일을 다시 정한다
  settle(next, now);
  Object.assign(s, next);
}

/** 잔치 열기: 떡을 내면 하루 동안 마을 전체 생산이 늘어난다 */
export function feast(s: VillageState, now: number): void {
  settle(s, now);
  const f = s.buildings.find((b) => b.type === 'feast' && b.state === 'done') ?? fail('no feast');
  const p = s.profile;
  if (now < p.feastUntil) fail('feast active');
  // 관리자는 떡을 내지 않는다 (063)
  const cake = s.admin ? 0 : CONST.feast_cake;
  if (p.resources.cake < cake) fail('not enough');
  // 지난 잔치의 몫까지 쌓인 양을 적어 둔 다음에 새 잔치를 연다
  bankAll(s, now);
  p.resources.cake -= cake;
  p.feastFrom = now;
  p.feastUntil = now + CONST.feast_sec * 1000;
  p.feastPct = CONST.feast_pct + CONST.feast_pct_per * (f.level - 1);
  addExp(p, CONST.feast_exp);
}

/**
 * 주민 배치: 제 일터(RESIDENT.work)인 서 있는 건물에만. buildingId 가 null 이면 쉬게 한다.
 * 생산량이 바뀌는 주민(소 · 호랑이 · 원숭이 · 양)은 그때까지 쌓인 양을 먼저 적어 둔다.
 */
export function assign(s: VillageState, residentId: string, buildingId: string | null, now: number): void {
  settle(s, now);
  if (!isResidentId(residentId)) return fail('no resident');
  const r = residentOf(s, residentId) ?? fail('no resident');
  const def = RESIDENT[residentId];
  if (def.work === '') fail('no work');
  let to: Building | null = null;
  if (buildingId !== null) {
    to = s.buildings.find((v) => v.id === buildingId) ?? fail('no building');
    if (to.type !== def.work || !standing(to)) fail('wrong building');
  }
  if (residentId === 'sheep') bankAll(s, now);
  else if (RATE_WORKERS.includes(residentId)) {
    bank(s, workplace(s, residentId), now);
    bank(s, to, now);
  }
  r.building = to ? to.id : null;
  if (to) progress(s, 'assign', '', 1);
}

/**
 * 부탁 들어주기: 자원을 내고 엽전 · 경험치 · 친밀도를 받는다. 그 칸은 wait_done 초 뒤에 새 부탁이 온다.
 * 친밀도가 5단계가 되면 전용 장식물이 보관함으로 들어온다 (giftId: 그 건물의 id).
 * → 선물을 받았으면 그 건물
 */
export function requestDone(s: VillageState, slot: number, now: number, giftId: string): Building | null {
  settle(s, now);
  const q = s.requests.find((v) => v.slot === slot) ?? fail('no request');
  if (q.state !== 'open' || q.res === '' || q.resident === '') return fail('no request');
  const p = s.profile;
  // 관리자는 부탁한 자원을 내지 않는다 (받는 것은 그대로. 063)
  if (!s.admin) {
    if (p.resources[q.res] < q.n) fail('not enough');
    p.resources[q.res] -= q.n;
  }
  p.resources.coin += q.coin;
  const r = residentOf(s, q.resident);
  let gift: Building | null = null;
  if (r) {
    // 사당이 서 있으면 친밀도가 더 빨리 오른다
    const shrine = s.buildings.some((b) => b.type === 'shrine' && standing(b));
    const add = shrine ? Math.floor((q.aff * (100 + REQ.shrine_pct)) / 100) : q.aff;
    const before = affLevel(r.affinity);
    const after = affLevel(r.affinity + add);
    // 생산량을 올리는 주민의 단계가 오르면 그때까지 쌓인 양을 먼저 적어 둔다 (양은 정자의 둘레가 그대로라 바뀌는 것이 없다)
    if (after > before && RATE_WORKERS.includes(r.id)) bank(s, workplace(s, r.id), now);
    r.affinity += add;
    if (after >= 5 && !r.gifted) {
      r.gifted = true;
      gift = { id: giftId, type: `gift_${r.id}` as BuildingType, level: 1, x: 0, y: 0, state: 'stored', finishAt: null, startAt: null, collectedAt: now, jobN: 0, banked: 0, accFrom: 0 };
      s.buildings.push(gift);
    }
  }
  const exp = q.exp;
  Object.assign(q, { state: 'wait', readyAt: now + REQ.wait_done * 1000, resident: '', res: '', n: 0, coin: 0, exp: 0, aff: 0 });
  progress(s, 'request', '', 1);
  addExp(p, exp);
  return gift;
}

/** 부탁 넘기기: 그 칸은 wait_skip 초 뒤에 새 부탁이 온다 */
export function requestSkip(s: VillageState, slot: number, now: number): void {
  settle(s, now);
  const q = s.requests.find((v) => v.slot === slot) ?? fail('no request');
  if (q.state !== 'open') fail('no request');
  Object.assign(q, { state: 'wait', readyAt: now + REQ.wait_skip * 1000, resident: '', res: '', n: 0, coin: 0, exp: 0, aff: 0 });
}

/** 오늘의 할 일 보상: slot 0 … 2 는 그 일, 3 은 셋을 다 끝낸 추가 보상 (하루 한 번) */
export function dailyClaim(s: VillageState, slot: number, now: number): void {
  settle(s, now);
  const p = s.profile;
  if (slot === 3) {
    if (s.daily.length < 3 || s.daily.some((t) => !t.claimed)) fail('not done');
    if (p.dailyBonusDay === p.dailyDay) fail('claimed');
    const b = dailyBonus(p.level);
    p.dailyBonusDay = p.dailyDay;
    p.resources.coin += b.coin;
    addExp(p, b.exp);
    return;
  }
  const t = s.daily.find((v) => v.slot === slot) ?? fail('no task');
  if (t.claimed) fail('claimed');
  if (t.progress < t.n) fail('not done');
  t.claimed = true;
  p.resources.coin += t.coin;
  addExp(p, t.exp);
}

/** 마을 이름 바꾸기: 한글 · 영문 · 숫자 · 띄어쓰기, name_max 글자까지 */
export function rename(s: VillageState, name: string, now: number): void {
  settle(s, now);
  if (typeof name !== 'string' || name.length < 1 || name.length > CONST.name_max || !NAME_RE.test(name)) fail('bad name');
  s.profile.name = name;
}

/** 칭찬하기 (주는 쪽): 하루 praise_per_day 번, 같은 마을은 하루 한 번, 내 마을은 안 된다. 엽전을 조금 받는다 */
export function praiseGive(s: VillageState, me: string, target: string, now: number): void {
  settle(s, now);
  if (target === me) fail('self');
  const p = s.profile;
  const day = kstDay(now);
  const today = p.praisedDay === day ? p.praised : [];
  if (today.includes(target)) fail('already praised');
  if (today.length >= CONST.praise_per_day) fail('praise limit');
  p.praisedDay = day;
  p.praised = [...today, target];
  p.resources.coin += CONST.praise_coin;
}
/** 칭찬받기 (받는 쪽): 받은 칭찬 수가 오른다 → 번영도 */
export function praiseTake(s: VillageState): void {
  s.profile.praiseCount++;
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
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map((x) => (x ?? {}) as Record<string, unknown>) : []);

/** 서버(또는 기기 저장소)가 준 상태를 믿을 수 있는 모양으로 */
export function cleanState(raw: unknown): VillageState {
  const r = (raw ?? {}) as { profile?: Record<string, unknown>; buildings?: unknown; residents?: unknown; requests?: unknown; daily?: unknown; sia?: unknown; now?: unknown; monuments?: unknown; admin?: unknown };
  const p = r.profile ?? {};
  const res = (p.resources ?? {}) as Record<string, unknown>;
  const resources = Object.fromEntries(RES_IDS.map((k) => [k, int(res[k], 0, 1e12, 0)])) as Resources;
  const buildings: Building[] = [];
  for (const b of list(r.buildings)) {
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
      accFrom: Number(b.accFrom) || 0,
    });
  }
  const residents: Resident[] = [];
  for (const v of list(r.residents)) {
    if (!isResidentId(v.id) || residents.some((x) => x.id === v.id)) continue;
    residents.push({ id: v.id, affinity: int(v.affinity, 0, 1e6, 0), building: typeof v.building === 'string' ? v.building : null, gifted: v.gifted === true });
  }
  // 이사 온 순서 = 십이지 순서
  residents.sort((a, b) => RESIDENTS.findIndex((d) => d.id === a.id) - RESIDENTS.findIndex((d) => d.id === b.id));
  const requests: Ask[] = [];
  for (const v of list(r.requests)) {
    const open = v.state === 'open' && isResidentId(v.resident) && RES_IDS.includes(v.res as ResId);
    requests.push({
      slot: int(v.slot, 0, 9, 0), state: open ? 'open' : 'wait', readyAt: open ? 0 : Number(v.readyAt) || 0,
      resident: open ? (v.resident as ResidentId) : '', res: open ? (v.res as ResId) : '', n: open ? int(v.n, 0, 1e9, 0) : 0,
      coin: open ? int(v.coin, 0, 1e9, 0) : 0, exp: open ? int(v.exp, 0, 1e9, 0) : 0, aff: open ? int(v.aff, 0, 1000, 0) : 0,
    });
  }
  requests.sort((a, b) => a.slot - b.slot);
  const daily: DailyTask[] = [];
  for (const v of list(r.daily)) {
    if (!TASKS.some((t) => t.task === v.task)) continue;
    daily.push({ slot: int(v.slot, 0, 9, 0), task: v.task as TaskKind, n: int(v.n, 1, 1e9, 1), progress: int(v.progress, 0, 1e9, 0), claimed: v.claimed === true, coin: int(v.coin, 0, 1e9, 0), exp: int(v.exp, 0, 1e9, 0) });
  }
  daily.sort((a, b) => a.slot - b.slot);
  return {
    profile: {
      name: typeof p.name === 'string' ? p.name : '', level: int(p.level, 1, CONST.max_level, 1), exp: int(p.exp, 0, 1e9, 0), resources,
      landStage: int(p.landStage, 0, LAND_SIZES.length - 1, 0), prosperity: int(p.prosperity, 0, 1e9, 0), prosperityAt: int(p.prosperityAt, 0, 1e15, 0), praiseCount: int(p.praiseCount, 0, 1e9, 0),
      // 서버는 오늘 칭찬한 마을만 보낸다 (날짜는 그 답의 서버 시각)
      praisedDay: p.praisedDay !== undefined ? int(p.praisedDay, -1e6, 1e6, 0) : typeof r.now === 'number' ? kstDay(r.now) : 0,
      praised: Array.isArray(p.praised) ? p.praised.filter((x): x is string => typeof x === 'string') : [],
      goal: int(p.goal, 0, 9999, 0), goalProgress: int(p.goalProgress, 0, 1e9, 0),
      marketDay: int(p.marketDay, -1e6, 1e6, 0), marketSold: int(p.marketSold, 0, 1e9, 0),
      feastFrom: int(p.feastFrom, 0, 1e15, 0), feastUntil: int(p.feastUntil, 0, 1e15, 0), feastPct: int(p.feastPct, 0, 1000, 0),
      reqSeq: int(p.reqSeq, 0, 1e9, 0), dailyDay: int(p.dailyDay, -1e6, 1e6, 0), dailyBonusDay: int(p.dailyBonusDay, -1e6, 1e6, 0), roosterDay: int(p.roosterDay, -1e6, 1e6, 0),
    },
    buildings,
    sia: int(r.sia, 0, 1e12, 0),
    residents,
    requests,
    daily,
    monuments: MONUMENTS.map((m) => m.id).filter((id) => Array.isArray(r.monuments) && r.monuments.includes(id)),
    admin: r.admin === true,
  };
}

export const cloneState = (s: VillageState): VillageState => ({
  ...s,
  profile: { ...s.profile, resources: { ...s.profile.resources }, praised: [...s.profile.praised] },
  buildings: s.buildings.map((b) => ({ ...b })),
  residents: s.residents.map((r) => ({ ...r })),
  requests: s.requests.map((q) => ({ ...q })),
  daily: s.daily.map((t) => ({ ...t })),
  monuments: [...s.monuments],
});

// ───────────────────────── 8단계: 기념물 ─────────────────────────

/**
 * 조건을 채운 기념물을 연다 (PRD 9장): 보관함으로 들어온다. 한 번 열린 것은 다시 잠기지 않는다.
 * stats: 서버가 다른 게임의 기록 표에서 읽은 값. idFor: 새 건물의 id. → 이번에 열린 기념물
 */
export function grantMonuments(s: VillageState, stats: Partial<GameStats>, now: number, idFor: (type: BuildingType) => string): Building[] {
  const got: Building[] = [];
  for (const m of MONUMENTS) {
    if (s.monuments.includes(m.id) || (stats[m.stat] ?? 0) < m.need) continue;
    s.monuments.push(m.id);
    const b: Building = { id: idFor(m.id), type: m.id, level: 1, x: 0, y: 0, state: 'stored', finishAt: null, startAt: null, collectedAt: now, jobN: 0, banked: 0, accFrom: 0 };
    s.buildings.push(b);
    got.push(b);
  }
  s.monuments.sort((a, b) => MONUMENTS.findIndex((m) => m.id === a) - MONUMENTS.findIndex((m) => m.id === b));
  return got;
}
