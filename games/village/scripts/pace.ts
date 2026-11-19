/**
 * 성장 속도 시뮬레이션 (PRD 6장: 첫날 레벨 5, 일주일에 12 안팎, 두 달에 30).
 *   npm run pace              → 60일
 *   npm run pace -- 14        → 14일
 *   npm run pace -- 60 3 2    → 60일, 하루 3번, 한 번에 2분
 * 가정: 하루 4번(9시 · 13시 · 18시 · 22시) 들러 4분씩 한다. 들를 때마다 다 거두고, 목표 보상을 받고,
 *       목표가 시키는 일 → 새로 지을 수 있는 건물 → 업그레이드(마을 회관 먼저, 그다음 싼 것) 순으로 자원을 쓴다.
 * 규칙은 게임과 같은 함수(src/game/rules.ts)를 그대로 쓴다. 지금은 1~3단계의 건물 · 경험치(건설 · 업그레이드 · 수확 · 목표)만 들어 있다 —
 * 부탁 · 나머지 건물이 들어오면(4 · 6단계) 다시 돌려 10단계에서 수치를 맞춘다.
 */
import { CONST, LEVEL_EXP } from '../src/data/balance';
import { BUILDING, BUILDINGS, type BuildingType } from '../src/data/buildings';
import { GOALS } from '../src/data/goals';
import {
  RuleError, build, busyCount, claimGoal, countOf, goalStatus, harvest, hallLevel, maxCount, newVillage, placeError, settle, slots, storageCap, stored, upgrade, upgradeCost,
  type VillageState,
} from '../src/game/rules';
import { HALL_NEED, UPGRADE_EXP } from '../src/data/balance';

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
const exp = { build: 0, upgrade: 0, harvest: 0, goal: 0 };
/** 경험치가 어디서 왔나: 앞뒤 차이로 센다 */
const total = () => LEVEL_EXP.slice(0, s.profile.level - 1).reduce((a, b) => a + b, 0) + s.profile.exp;
const tryDo = (fn: () => void): boolean => {
  try {
    fn();
    return true;
  } catch (e) {
    if (e instanceof RuleError) return false;
    throw e;
  }
};
const spot = (type: BuildingType) => {
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (!placeError(s, type, x, y)) return { x, y };
  return null;
};
const can = (rice: number, wood: number) => s.profile.resources.rice >= rice && s.profile.resources.wood >= wood;

function tryBuild(type: BuildingType): boolean {
  const d = BUILDING[type];
  const at = spot(type);
  if (!at || countOf(s, type) >= maxCount(type, s.profile.level) || !can(d.rice, d.wood) || busyCount(s) >= slots(s)) return false;
  return tryDo(() => void build(s, type, at.x, at.y, now, `b${++seq}`));
}
function tryUpgrade(id: string): boolean {
  const b = s.buildings.find((v) => v.id === id)!;
  if (b.state !== 'done' || b.level >= CONST.building_max_level || busyCount(s) >= slots(s)) return false;
  const c = upgradeCost(b.type, b.level);
  if (!can(c.rice, c.wood)) return false;
  return tryDo(() => upgrade(s, id, now));
}

let now = 0;
/** 한 번 손을 댄다 (5초마다 부른다) → 무언가 했으면 true */
function act(): boolean {
  const before = total();
  settle(s, now);
  exp.build += total() - before; // 끝난 짓기 · 업그레이드 (나눠 세지는 않는다)
  const g = goalStatus(s);
  if (g?.done) {
    const b0 = total();
    claimGoal(s, now);
    exp.goal += total() - b0;
    return true;
  }
  // 목표가 시키는 일 먼저
  if (g?.def.kind === 'build' && tryBuild(g.def.type as BuildingType)) return true;
  if (g?.def.kind === 'upgrade') {
    const t = s.buildings.filter((b) => b.type === g.def.type && b.state === 'done').sort((a, b) => b.level - a.level)[0];
    if (t && tryUpgrade(t.id)) return true;
  }
  for (const type of ['paddy', 'lumber', 'storage', 'house'] as BuildingType[]) if (tryBuild(type)) return true;
  const hall = s.buildings.find((b) => b.type === 'hall')!;
  if (hall.level < CONST.building_max_level && s.profile.level >= HALL_NEED[hall.level - 1] && tryUpgrade(hall.id)) return true;
  // 마을 회관을 올릴 수 있는데 자원만 모자라면 다른 데 쓰지 않고 모은다
  const saving = hall.state === 'done' && hall.level < CONST.building_max_level && s.profile.level >= HALL_NEED[hall.level - 1];
  if (saving) return false;
  const ups = s.buildings
    .filter((b) => b.type !== 'hall' && b.state === 'done' && b.level < hallLevel(s))
    .sort((a, b) => upgradeCost(a.type, a.level).wood + upgradeCost(a.type, a.level).rice - upgradeCost(b.type, b.level).wood - upgradeCost(b.type, b.level).rice);
  for (const b of ups) if (tryUpgrade(b.id)) return true;
  return false;
}
function harvestAll() {
  const s0 = total();
  settle(s, now);
  exp.build += total() - s0;
  const ids = s.buildings.filter((b) => stored(b, now) >= 1).map((b) => b.id);
  if (ids.length === 0) return;
  const b0 = total();
  harvest(s, ids, now);
  exp.harvest += total() - b0;
}

const rows: string[] = [];
let wasted = 0;
let top = 1;
for (let day = 0; day < DAYS; day++) {
  for (const h of HOURS) {
    const start = (day * 24 + h) * HOUR;
    // 가득 차서 버려진 생산 (12시간 상한 · 창고 용량 때문에 못 거둔 양은 따로 세지 않는다)
    for (const b of s.buildings) if (BUILDING[b.type].product && b.state === 'done' && start - b.collectedAt > CONST.prod_cap_sec * 1000) wasted++;
    for (now = start; now <= start + MINUTES * 60_000; now += 5000) {
      if (now === start || now + 5000 > start + MINUTES * 60_000) harvestAll();
      for (let i = 0; i < 6 && act(); i++);
      for (let l = top + 1; l <= s.profile.level; l++) reached[l] = now;
      top = s.profile.level;
    }
  }
  if ([1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30, 45, 60].includes(day + 1) || day + 1 === DAYS) {
    const r = s.profile.resources;
    const kinds = BUILDINGS.map((d) => `${d.name} ${s.buildings.filter((b) => b.type === d.id).map((b) => b.level).join('·') || '-'}`).join(' / ');
    rows.push(`${String(day + 1).padStart(3)}일째 끝  레벨 ${String(s.profile.level).padStart(2)}  누적 경험치 ${String(total()).padStart(6)}  (목표 ${String(s.profile.goal).padStart(2)}/${GOALS.length}, 쌀 ${r.rice} 나무 ${r.wood} / 창고 ${storageCap(s)})  ${kinds}`);
  }
}

console.log(`\n시아마을 성장 속도 — 하루 ${HOURS.length}번(${HOURS.join('·')}시) × ${MINUTES}분, ${DAYS}일\n`);
console.log(rows.join('\n'));
console.log('\n레벨별 도달 시각 (시작 = 첫날 9시)');
const line: string[] = [];
for (let l = 2; l <= s.profile.level; l++) {
  const t = reached[l] - 9 * HOUR;
  line.push(`Lv${l} ${t < 24 * HOUR ? `${(t / HOUR).toFixed(1)}시간` : `${(t / (24 * HOUR)).toFixed(1)}일`}`);
}
console.log(line.join('  '));
const sum = exp.build + exp.harvest + exp.goal;
console.log(`\n경험치 출처: 건설·업그레이드 ${Math.round((exp.build / sum) * 100)}% · 수확 ${Math.round((exp.harvest / sum) * 100)}% · 마을 목표 ${Math.round((exp.goal / sum) * 100)}%  (합 ${sum})`);
console.log(`12시간 넘게 거두지 못한 건물 (창고가 가득 찼을 때 포함, 들를 때마다 센 수): ${wasted}`);
console.log('목표 속도 (PRD): 첫날 레벨 5 · 일주일에 12 안팎 · 두 달에 30\n');
