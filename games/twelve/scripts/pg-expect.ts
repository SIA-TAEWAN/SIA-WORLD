/**
 * 서버 확인용 기대값: `npx vite-node scripts/pg-expect.ts > expect.json`
 * 정해 둔 순서(맵 깨기 · 쓰러지기 · 상점 · 대장간 · 가방 · 끝없는 탑)를 기기 규칙(src/game/progress.ts · rules.ts · drops.ts · tower.ts)으로 돌려,
 * 단계마다의 기록을 JSON 으로 낸다. scripts/pg-check.mjs 가 같은 순서를 078_twelve.sql · 094_twelve_full.sql 의 RPC 로 돌려 맞춰 본다.
 * 장비 id 는 서버와 기기가 다르게 붙으므로, 장비는 '번호 순서로 몇 번째인지'로 가리킨다.
 */
import { regionTier } from '../src/data/economy';
import { mapKillMax, mapOf } from '../src/data/maps';
import { REGIONS_READY, type Mode } from '../src/data/regions';
import { towerRareRate } from '../src/data/tower';
import { roll } from '../src/game/drops';
import { applyReport, bagCount, checkStart, emptyProfile, setMode, type FinishResult, type RunReport, type TwelveProfile } from '../src/game/progress';
import { buy, claim, enhance, equip, scrap, sell, setLock, unequip } from '../src/game/rules';
import { TOWER_TAG, applyTowerFloor, beginTower, checkTowerFloor, checkTowerStart, endTower, type TowerFloorResult, type TowerRun } from '../src/game/tower';

const p = emptyProfile();
const steps: unknown[] = [];

const sorted = (q: TwelveProfile) => [...q.items].sort((a, b) => Number(a.id) - Number(b.id));
/** 장비 id 를 순서 번호로 바꾼 기록 */
function canon(q: TwelveProfile) {
  const list = sorted(q);
  const at = (id: string | null) => (id === null ? null : list.findIndex((it) => it.id === id));
  return {
    level: q.level,
    exp: q.exp,
    coins: q.coins,
    stones: q.stones,
    mode: q.mode,
    hero: q.hero,
    bag: q.bag,
    potions: structuredClone(q.potions),
    eq: { weapon: at(q.eq.weapon), armor: at(q.eq.armor), acc: at(q.eq.acc) },
    items: list.map((it) => ({ base: it.base, plus: it.plus, lock: it.lock, box: it.box })),
    maps: structuredClone(q.maps),
    keys: structuredClone(q.keys),
    pity: structuredClone(q.pity),
    codex: [...q.codex].sort(),
    // 날짜(at)는 맞춰 보지 않는다
    tower: q.tower ? { floor: q.tower.floor, time: q.tower.time, level: q.tower.level, hero: q.tower.hero, cps: { ...q.tower.cps } } : null,
  };
}
const canonResult = (r: FinishResult) => ({ ...r, siaCoin: undefined, items: r.items.map((it) => ({ base: it.base, box: it.box })) });
const idAt = (i: number) => sorted(p)[i].id;

function play(map: string, seed: number, over: Partial<RunReport> = {}) {
  const m = mapOf(map)!;
  const mode = over.mode ?? 'normal';
  const max = mapKillMax(m, mode);
  const report: RunReport = { run: '', map, mode, hero: 'rat', time: 100, cleared: true, kills: { ...max.kinds }, elites: max.elites, boss: !!m.boss, chest: true, deaths: 0, ...over };
  const result = applyReport(p, report, seed);
  steps.push({ op: 'play', map, mode, seed, report: { time: report.time, cleared: report.cleared, kills: report.kills, elites: report.elites, boss: report.boss, chest: report.chest, deaths: report.deaths, potions: report.potions ?? null }, result: canonResult(result), state: canon(p) });
}
/** RPC 하나: fn · 인자(items = 장비 순서 번호) · 기기 규칙의 결과(why = 거절 까닭) */
function rpc(fn: string, args: Record<string, unknown>, why: string | null) {
  steps.push({ op: 'rpc', fn, args, why, state: canon(p) });
}
const pity = (region: number, elite: number, boss: number, key: number) => {
  p.pity.normal[String(region)] = { elite, boss, key };
  steps.push({ op: 'pity', region, elite, boss, key });
};

// 1) 1지형을 처음부터 끝까지 (씨앗을 정해 두고)
for (let n = 1; n <= 8; n++) play(`1-${n}`, 1000 + n * 37);
// 2) 보스 다시 잡기: 열쇠 확정 보정(3번째) · 별 보상은 한 번만
for (let n = 0; n < 4; n++) play('1-8', 5000 + n * 911, { time: 400, deaths: 1, chest: false });
// 3) 쓰러진 판: 경험치만, 쓴 물약은 빠진다
play('1-5', 77, { cleared: false, kills: { imp: 3 }, elites: 0, chest: false, potions: [[2, 0, 0], [1, 0, 0]] });
// 4) 레어 확정 보정: 정예 100마리째 · 보스 8번째 (아직 없는 것부터)
pity(1, 99, 0, 0);
play('1-3', 31337);
pity(1, 0, 7, 0);
play('1-8', 4242);
// 5) 상점
rpc('twelve_buy', { p_what: 'potion:0:1', p_n: 2 }, buy(p, 'potion:0:1', 2));
rpc('twelve_buy', { p_what: 'potion:1:2', p_n: 99 }, buy(p, 'potion:1:2', 99));
rpc('twelve_buy', { p_what: 'w-bow-0', p_n: 1 }, buy(p, 'w-bow-0'));
rpc('twelve_buy', { p_what: 'w-bow-1', p_n: 1 }, buy(p, 'w-bow-1'));
rpc('twelve_buy', { p_what: 'r-n1-1', p_n: 1 }, buy(p, 'r-n1-1'));
rpc('twelve_buy', { p_what: 'bag', p_n: 1 }, buy(p, 'bag'));
// 6) 착용 · 잠금 · 대장간 (장비는 번호 순서로 가리킨다: 0 = 나무 칼, 2 = 나무 활, 4 = 나무 갑옷)
rpc('twelve_equip', { item: 2 }, equip(p, idAt(2)));
rpc('twelve_unequip', { p_slot: 'armor' }, unequip(p, 'armor'));
rpc('twelve_unequip', { p_slot: 'weapon' }, unequip(p, 'weapon'));
rpc('twelve_equip', { item: 4 }, equip(p, idAt(4)));
for (let n = 0; n < 3; n++) rpc('twelve_enhance', { item: 2 }, enhance(p, idAt(2)));
rpc('twelve_lock', { item: 1, p_on: true }, setLock(p, idAt(1), true));
rpc('twelve_sell', { items: [1] }, sell(p, [idAt(1)]));
rpc('twelve_sell', { items: [2] }, sell(p, [idAt(2)]));
rpc('twelve_lock', { item: 1, p_on: false }, setLock(p, idAt(1), false));
{
  const id = idAt(1);
  rpc('twelve_sell', { items: [1] }, sell(p, [id]));
}
{
  const id = idAt(2);
  rpc('twelve_scrap', { items: [2] }, scrap(p, [id]));
}
// 7) 가방 채우기 → 드랍이 보관함으로 → 꺼내기
p.coins += 30000;
steps.push({ op: 'coins', add: 30000 });
while (bagCount(p) < p.bag) rpc('twelve_buy', { p_what: 'a-0', p_n: 1 }, buy(p, 'a-0'));
rpc('twelve_buy', { p_what: 'a-0', p_n: 1 }, buy(p, 'a-0'));
for (let n = 0; n < 3; n++) play('1-8', 9000 + n * 13, { time: 300 });
rpc('twelve_claim', { items: [] }, claim(p, []));
{
  const last = sorted(p).findIndex((it) => !it.box && !Object.values(p.eq).includes(it.id) && it.base === 'a-0');
  const id = idAt(last);
  rpc('twelve_scrap', { items: [last] }, scrap(p, [id]));
}
rpc('twelve_claim', { items: [] }, claim(p, []));

// 8) 끝없는 탑: 시작 검사 → 층 보고(검사 · 보상 · 기록 · 체크포인트) → 끝. sec = 앞 보고부터 서버 시계로 흐른 시간
let now = 1_700_000_000_000;
let tw: TowerRun | null = null;
let tn = 0;
function towerStart(floor: number, seed: number) {
  const why = checkTowerStart(p, floor, 'rat');
  if (!why) {
    if (tw) tw.done = true;
    tw = beginTower(p, floor, 'rat', `t${tn++}`, seed, now);
  }
  steps.push({ op: 'tower_start', floor, seed, why, base: why ? 0 : tw!.base, state: canon(p) });
}
const canonFloor = (r: TowerFloorResult) => ({ ...r, siaCoin: undefined, items: r.items.map((it) => ({ base: it.base, box: it.box })) });
/** time = 이 판에서 지금까지 논 시간 */
function towerFloor(floor: number, time: number, sec: number, potions: number[][] | null = null) {
  const at = now + sec * 1000;
  const why = checkTowerFloor(tw!, floor, time, potions ?? undefined, at);
  let result: unknown = null;
  if (!why) {
    now = at;
    result = canonFloor(applyTowerFloor(p, tw!, floor, time, potions ?? undefined, at));
  }
  steps.push({ op: 'tower_floor', floor, time, sec, potions, why, result, state: canon(p) });
}
function towerEnd(potions: number[][] | null = null) {
  const why = endTower(p, tw!, potions ?? undefined);
  steps.push({ op: 'tower_end', potions, why, state: canon(p) });
}
/** n 층을 sec 초씩 걸려 오른다 */
const towerClimb = (n: number, sec: number) => {
  for (let i = 0; i < n; i++) towerFloor(tw!.floor + 1, tw!.played + sec, sec);
};
towerStart(2, 1);
towerStart(11, 1);
towerStart(1, 4242);
towerFloor(2, 20, 20);
towerFloor(1, 1, 20);
towerFloor(1, 30, 10);
towerClimb(2, 20);
towerFloor(3, 60, 20, [[1, 0, 0], [1, 0, 0]]);
towerClimb(7, 20);
towerFloor(11, 220, 20, [[1, 0], [0, 0, 0]]);
towerEnd([[0, 1, 0], [0, 0, 0]]);
towerFloor(11, 220, 20);
towerEnd();
// 체크포인트(11층)에서 시작: 10층까지의 시간이 더해진다
towerStart(21, 2);
towerStart(11, 99);
towerClimb(10, 15);
towerEnd();
// 더 빨리 10층: 체크포인트 시간만 줄어든다. 끝내지 않고 새 판을 시작하면 앞 판은 끝난다
towerStart(1, 31337);
towerClimb(12, 10);
towerStart(21, 5);
towerClimb(5, 12);
// 보상 판정을 넉넉히 (가방이 꽉 차 있어 장비는 보관함으로 간다)
for (let k = 0; k < 6; k++) {
  towerStart(1, 1000 + k * 7717);
  towerClimb(20, 10);
}
towerEnd();

// 9) 2지형부터 준비된 마지막 지형까지 차례로 (094 의 맵 표 · 지형 등급이 오른 드랍 · 레벨 차이 보정 · 지형이 열리며 오르는 상점 등급)
for (let r = 2; r <= REGIONS_READY; r++) for (let n = 1; n <= 8; n++) play(`${r}-${n}`, 20000 + r * 1000 + n * 37, { time: 200 });
// 보스의 선물(10~12지형 보스 첫 처치의 강화석 꾸러미)은 한 번만: 다시 잡으면 없다
for (const r of [9, 10, 12]) if (r <= REGIONS_READY) play(`${r}-8`, 31000 + r, { time: 200 });
rpc('twelve_buy', { p_what: `w-spear-${regionTier(REGIONS_READY, 'normal')}`, p_n: 1 }, buy(p, `w-spear-${regionTier(REGIONS_READY, 'normal')}`));

// 10) 최종보스맵 (094 의 twelve_start · twelve_finish): 열쇠 12개가 모이기 전에는 'need keys' → 지형 보스를 다시 잡아 열쇠를 채운다(40% · 3번째 확정)
//     → 열림 → 첫 처치(강화석 꾸러미 · 보통 모드 클리어) → 다시 잡으면 꾸러미 없음 → 쓰러진 판
const tryStart = (map: string, mode: Mode = 'normal') => steps.push({ op: 'start', map, mode, why: checkStart(p, map, mode, 'rat'), state: canon(p) });
if (REGIONS_READY >= 12) {
  // 어려움 모드는 보통 모드를 끝내기 전에는 잠겨 있다
  rpc('twelve_set_mode', { p_mode: 'hard' }, setMode(p, 'hard'));
  tryStart('1-1', 'hard');
  tryStart('final');
  for (let r = 2; r <= 12; r++) for (let k = 0; k < 3 && !p.keys.normal.includes(r); k++) play(`${r}-8`, 40000 + r * 100 + k, { time: 200 });
  tryStart('final');
  play('final', 77001, { time: 300 });
  play('final', 77002, { time: 300, deaths: 1, chest: false });
  play('final', 77003, { time: 120, cleared: false, kills: { imp: 2 }, elites: 0, boss: false, chest: false });

  // 11) 어려움 모드 (094 의 twelve_set_mode · _twelve_region_open · 맵 표의 어려움 줄): 전환 → 상점 등급(Lv72 는 어려움 1지형) →
  //     96맵을 차례로 (어려움 전용 레어 · 등급 8~11 드랍 · 별 24개 보상 · 보스의 선물) → 열쇠 12개 → 어려움 최종보스(진짜 끝) → 보통으로 돌아갔다가 다시
  rpc('twelve_set_mode', { p_mode: 'easy' }, setMode(p, 'easy'));
  rpc('twelve_set_mode', { p_mode: 'hard' }, setMode(p, 'hard'));
  tryStart('1-2', 'hard');
  tryStart('final', 'hard');
  p.coins += 400000;
  steps.push({ op: 'coins', add: 400000 });
  // 가방이 꽉 차 있으니(7번 순서) 나무 갑옷 하나를 분해해 자리를 낸다
  const freeSlot = () => {
    const i = sorted(p).findIndex((it) => !it.box && !Object.values(p.eq).includes(it.id) && it.base === 'a-0');
    const id = idAt(i);
    rpc('twelve_scrap', { items: [i] }, scrap(p, [id]));
  };
  freeSlot();
  rpc('twelve_buy', { p_what: 'w-sword-8', p_n: 1 }, buy(p, 'w-sword-8'));
  rpc('twelve_buy', { p_what: 'w-sword-9', p_n: 1 }, buy(p, 'w-sword-9'));
  for (let r = 1; r <= 12; r++) for (let n = 1; n <= 8; n++) play(`${r}-${n}`, 50000 + r * 1000 + n * 37, { mode: 'hard', time: 250 });
  freeSlot();
  rpc('twelve_buy', { p_what: 'w-sword-11', p_n: 1 }, buy(p, 'w-sword-11'));
  tryStart('final', 'hard');
  for (let r = 1; r <= 12; r++) for (let k = 0; k < 3 && !p.keys.hard.includes(r); k++) play(`${r}-8`, 60000 + r * 100 + k, { mode: 'hard', time: 250 });
  tryStart('final', 'hard');
  play('final', 88001, { mode: 'hard', time: 400 });
  play('final', 88002, { mode: 'hard', time: 400, deaths: 1 });
  rpc('twelve_set_mode', { p_mode: 'normal' }, setMode(p, 'normal'));
  play('1-1', 88003);
  rpc('twelve_set_mode', { p_mode: 'hard' }, setMode(p, 'hard'));
  // 끝없는 탑: 장비 등급과 레어 목록에 어려움에서 연 지형이 들어간다 (여의 · 어려움 전용 레어)
  // 레어는 드물어서(정예·보스 층에서만) 레어가 나오는 씨앗을 골라 쓴다 — 레어 목록(보통 12지형 + 어려움 12지형)에서 고르는 길을 지나가게
  const rareSeeds: number[] = [];
  for (let seed = 70000; rareSeeds.length < 4; seed++) {
    if ([25, 30, 35, 40, 45, 50].some((f) => roll(seed, TOWER_TAG.rare, f) % 10000 < towerRareRate(f))) rareSeeds.push(seed);
  }
  for (const seed of rareSeeds) {
    towerStart(21, seed);
    towerClimb(30, 10);
  }
  towerEnd();
}

const rolls = [[1, 1, 1], [123456789, 12, 1], [2147483647, 7, 250], [0, 3, 2], [4242, 25, 10], [99, 27, 20]].map(([s, t, n]) => ({ seed: s, tag: t, n, value: roll(s, t, n) }));
console.log(JSON.stringify({ first: canon(emptyProfile()), rolls, steps }));
