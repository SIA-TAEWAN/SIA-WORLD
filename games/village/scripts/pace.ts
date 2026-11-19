/**
 * 성장 속도 시뮬레이션 (PRD 6장: 첫날 레벨 5, 일주일에 12 안팎, 두 달에 30).
 *   npm run pace              → 60일
 *   npm run pace -- 14        → 14일
 *   npm run pace -- 60 3 2    → 60일, 하루 3번, 한 번에 2분
 * 가정: 하루 4번(9시 · 13시 · 18시 · 22시) 들러 4분씩 한다. 시아코인은 쓰지 않는다 (없어도 레벨 30 까지 가야 한다).
 *   들를 때마다: 다 거두고 → 목표 보상을 받고 → 목표가 시키는 일 → 새로 지을 수 있는 건물 → 업그레이드(마을 회관 먼저, 그다음 싼 것)
 *   → 남는 쌀로 떡, 떡으로 특산품 → 창고가 차면 장터에 판다 → 엽전이 남으면 장식물.
 * 규칙은 게임과 같은 함수(src/game/rules.ts)를 그대로 쓴다.
 */
import { CAPPED, CONST, HALL_NEED, LEVEL_EXP, UPGRADE_EXP } from '../src/data/balance';
import { BUILDING, BUILDINGS, recipeOf, upgradable, type BuildingType } from '../src/data/buildings';
import { GOALS } from '../src/data/goals';
import {
  RuleError, batchMax, build, buildCost, busyCount, canPay, claimGoal, countOf, craft, goalStatus, harvest, hallLevel, market, maxCount, newVillage, placeError, sell, sellCoins, sellLeft,
  settle, slots, storageCap, store, stored, upgrade, upgradeCost, type VillageState,
} from '../src/game/rules';

// 수치를 바꿔 보는 실험용 (파일을 고치기 전에): PACE_EXP='40,70,…' 레벨 표 · PACE_DIV=20 수확 경험치 나누는 값 · PACE_UP='15,30,…' 업그레이드 경험치
if (process.env.PACE_EXP) LEVEL_EXP.splice(0, LEVEL_EXP.length, ...process.env.PACE_EXP.split(',').map(Number));
if (process.env.PACE_UP) UPGRADE_EXP.splice(0, UPGRADE_EXP.length, ...process.env.PACE_UP.split(',').map(Number));
if (process.env.PACE_DIV) (CONST as { harvest_exp_div: number }).harvest_exp_div = Number(process.env.PACE_DIV);
const DAYS = Number(process.argv[2]) || 60;
const VISITS = Number(process.argv[3]) || 4;
const MINUTES = Number(process.argv[4]) || 4;
const HOUR = 3600_000;
const HOURS = { 1: [20], 2: [9, 21], 3: [9, 15, 22], 4: [9, 13, 18, 22], 5: [8, 12, 15, 19, 23], 6: [8, 11, 14, 17, 20, 23] }[VISITS] ?? [9, 13, 18, 22];

let seq = 0;
const s: VillageState = newVillage(9 * HOUR);
const reached: Record<number, number> = { 1: 0 };
const exp = { build: 0, harvest: 0, goal: 0, other: 0 };
const total = () => LEVEL_EXP.slice(0, s.profile.level - 1).reduce((a, b) => a + b, 0) + s.profile.exp;
/** 경험치가 어디서 왔나: 앞뒤 차이로 센다 */
function tally<T>(kind: keyof typeof exp, fn: () => T): T {
  const b0 = total();
  const out = fn();
  exp[kind] += total() - b0;
  return out;
}
const tryDo = (fn: () => void): boolean => {
  try {
    fn();
    return true;
  } catch (e) {
    if (e instanceof RuleError) return false;
    throw e;
  }
};
/** 빈 칸 수 · 앞으로 지을 일반 건물에 남겨 둘 칸 수 (처음 땅 8×8 기준) */
const cellsOf = (kind?: string) => s.buildings.filter((b) => b.state !== 'stored' && (!kind || BUILDING[b.type].kind === kind)).reduce((n, b) => n + BUILDING[b.type].w * BUILDING[b.type].h, 0);
const freeCells = () => 64 - cellsOf();
const MAIN_CELLS = BUILDINGS.filter((d) => d.kind === 'main').reduce((n, d) => n + d.w * d.h * d.unlock.length, 0);
const reserve = () => MAIN_CELLS - cellsOf('main');
const spot = (type: BuildingType) => {
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (!placeError(s, type, x, y)) return { x, y };
  return null;
};

let now = 0;
function tryBuild(type: BuildingType): boolean {
  const d = BUILDING[type];
  if (d.sia > 0 || countOf(s, type) >= maxCount(type, s.profile.level) || !canPay(s.profile, buildCost(type)) || (d.buildSec > 0 && busyCount(s) >= slots(s))) return false;
  const at = spot(type);
  return !!at && tryDo(() => void build(s, type, at.x, at.y, now, `b${++seq}`));
}
function tryUpgrade(id: string): boolean {
  const b = s.buildings.find((v) => v.id === id)!;
  if (b.state !== 'done' || !upgradable(b.type) || b.level >= CONST.building_max_level || busyCount(s) >= slots(s)) return false;
  if (!canPay(s.profile, upgradeCost(b.type, b.level))) return false;
  return tryDo(() => upgrade(s, id, now));
}

/** 한 번 손을 댄다 (5초마다 부른다) → 무언가 했으면 true */
function act(): boolean {
  tally('build', () => settle(s, now));
  const g = goalStatus(s);
  if (g?.done) {
    tally('goal', () => claimGoal(s, now));
    return true;
  }
  // 목표가 시키는 일 먼저
  if (g?.def.kind === 'build' && tryBuild(g.def.type as BuildingType)) return true;
  if (g?.def.kind === 'upgrade') {
    const t = s.buildings.filter((b) => b.type === g.def.type && b.state === 'done').sort((a, b) => b.level - a.level)[0];
    if (t && tryUpgrade(t.id)) return true;
  }
  if (g?.def.kind === 'deco') {
    // 자리가 없으면 놓여 있는 장식물을 보관함에 넣고 산다 (보관함에 든 것도 센다)
    if (freeCells() - reserve() < 1) {
      const placed = s.buildings.find((b) => BUILDING[b.type].kind === 'deco' && b.state === 'done');
      if (placed) tryDo(() => store(s, placed.id, now));
    }
    for (const d of BUILDINGS) if (d.kind === 'deco' && d.coin > 0 && tryBuild(d.id)) return true;
  }
  for (const type of ['paddy', 'lumber', 'quarry', 'storage', 'house', 'market', 'mill', 'jar'] as BuildingType[]) if (tryBuild(type)) return true;
  const hall = s.buildings.find((b) => b.type === 'hall')!;
  const hallOpen = hall.level < CONST.building_max_level && s.profile.level >= HALL_NEED[hall.level - 1];
  if (hallOpen && tryUpgrade(hall.id)) return true;
  // 마을 회관을 올릴 수 있는데 자원만 모자라면 다른 데 쓰지 않고 모은다
  if (hallOpen && hall.state === 'done') return false;
  const price = (b: { type: BuildingType; level: number }) => {
    const c = upgradeCost(b.type, b.level);
    return c.rice + c.wood + c.stone;
  };
  const ups = s.buildings.filter((b) => b.type !== 'hall' && upgradable(b.type) && b.state === 'done' && b.level < hallLevel(s)).sort((a, b) => price(a) - price(b));
  for (const b of ups) if (tryUpgrade(b.id)) return true;
  return false;
}

/** 들를 때 한 번: 가공을 돌리고, 넘치는 것은 팔고, 엽전이 남으면 꾸민다 */
function chores() {
  const cap = storageCap(s);
  const r = s.profile.resources;
  // 떡이 있으면 특산품, 쌀이 넉넉하면 떡
  for (const b of s.buildings.filter((v) => v.type === 'jar' && v.state === 'done')) {
    const rc = recipeOf('jar')!;
    const n = Math.min(batchMax(b.type, b.level), Math.floor(r.cake / rc.n1), Math.floor(r.rice / rc.n2));
    if (n >= 1) tryDo(() => craft(s, b.id, n, now));
  }
  for (const b of s.buildings.filter((v) => v.type === 'mill' && v.state === 'done')) {
    const n = Math.min(batchMax(b.type, b.level), Math.floor((r.rice - cap * 0.4) / 3));
    if (n >= 1) tryDo(() => craft(s, b.id, n, now));
  }
  // 창고의 90% 를 넘은 자원은 30% 를 판다. 특산품은 다 판다
  if (market(s)) {
    for (const k of CAPPED) {
      if (r[k] < cap * 0.9) continue;
      let n = Math.floor(r[k] * 0.3);
      while (n > 0 && sellCoins(k, n, now) > sellLeft(s, now)) n = Math.floor(n * 0.8);
      if (n > 0 && sellCoins(k, n, now) >= 1) tryDo(() => void sell(s, k, n, now));
    }
    let n = r.special;
    while (n > 0 && sellCoins('special', n, now) > sellLeft(s, now)) n--;
    if (n > 0) tryDo(() => void sell(s, 'special', n, now));
  }
  // 엽전이 값의 두 배를 넘으면 장식물을 하나 놓는다 (비싼 것부터)
  const decos = BUILDINGS.filter((d) => d.kind === 'deco' && d.coin > 0).sort((a, b) => b.coin - a.coin);
  if (freeCells() - reserve() >= 1) for (const d of decos) if (r.coin >= d.coin * 2 && tally('build', () => tryBuild(d.id))) break;
}

function harvestAll() {
  tally('build', () => settle(s, now));
  const ids = s.buildings.filter((b) => stored(s, b, now) >= 1).map((b) => b.id);
  if (ids.length > 0) tally('harvest', () => harvest(s, ids, now));
}

const rows: string[] = [];
let top = 1;
for (let day = 0; day < DAYS; day++) {
  for (const h of HOURS) {
    const start = (day * 24 + h) * HOUR;
    for (now = start; now <= start + MINUTES * 60_000; now += 5000) {
      const first = now === start;
      const last = now + 5000 > start + MINUTES * 60_000;
      if (first || last) harvestAll();
      for (let i = 0; i < 6 && act(); i++);
      if (first || last) chores();
      for (let l = top + 1; l <= s.profile.level; l++) reached[l] = now;
      top = s.profile.level;
    }
  }
  if ([1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30, 45, 60].includes(day + 1) || day + 1 === DAYS) {
    const r = s.profile.resources;
    const kinds = BUILDINGS.filter((d) => d.kind === 'main')
      .map((d) => `${d.name} ${s.buildings.filter((b) => b.type === d.id).map((b) => b.level).join('·') || '-'}`)
      .join(' / ');
    const decos = s.buildings.filter((b) => BUILDING[b.type].kind === 'deco').length;
    rows.push(
      `${String(day + 1).padStart(3)}일째 끝  레벨 ${String(s.profile.level).padStart(2)}  누적 경험치 ${String(total()).padStart(6)}  (목표 ${String(s.profile.goal).padStart(3)}/${GOALS.length}, 쌀 ${r.rice} 나무 ${r.wood} 돌 ${r.stone} 떡 ${r.cake} 엽전 ${r.coin} / 창고 ${storageCap(s)}, 장식물 ${decos})  ${kinds}`,
    );
  }
}

console.log(`\n시아마을 성장 속도 — 하루 ${HOURS.length}번(${HOURS.join('·')}시) × ${MINUTES}분, ${DAYS}일, 시아코인 0\n`);
console.log(rows.join('\n'));
console.log('\n레벨별 도달 시각 (시작 = 첫날 9시)');
const line: string[] = [];
for (let l = 2; l <= s.profile.level; l++) {
  const t = reached[l] - 9 * HOUR;
  line.push(`Lv${l} ${t < 24 * HOUR ? `${(t / HOUR).toFixed(1)}시간` : `${(t / (24 * HOUR)).toFixed(1)}일`}`);
}
console.log(line.join('  '));
const sum = exp.build + exp.harvest + exp.goal + exp.other || 1;
const pct = (n: number) => `${Math.round((n / sum) * 100)}%`;
console.log(`\n경험치 출처: 건설·업그레이드 ${pct(exp.build)} · 수확·가공 ${pct(exp.harvest)} · 마을 목표 ${pct(exp.goal)}${exp.other ? ` · 부탁·오늘의 할 일 ${pct(exp.other)}` : ''}  (합 ${sum})`);
const cells = s.buildings.filter((b) => b.state !== 'stored').reduce((n, b) => n + BUILDING[b.type].w * BUILDING[b.type].h, 0);
console.log(`쓴 칸 ${cells}/64 (처음 땅 8×8)`);
console.log('목표 속도 (PRD): 첫날 레벨 5 · 일주일에 12 안팎 · 두 달에 30\n');
