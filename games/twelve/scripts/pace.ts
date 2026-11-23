/**
 * 성장 속도 계산 (PRD '성장과 플레이 시간' · '밸런스 도구'): 능력치·드랍·경험치 표만으로 플레이 시간과 레벨 곡선을 본다.
 *   npm run pace                 → 준비된 지형 전부(1~12지형, 4분쯤), 씨앗 3개 평균
 *   npm run pace -- 3 5          → 지형 수, 씨앗 수
 *   npm run pace -- weapons      → 무기 4종 비교 (같은 맵·같은 레벨·같은 등급)
 *
 * 방식: 새 기록에서 시작해 맵을 차례로 깬다. 전투는 자동 조종(tests/bot.ts)이 실제 전투 규칙(src/game/sim.ts)으로 하고,
 * 보상·드랍·레벨·상점·대장간은 게임과 같은 함수(progress.ts · rules.ts)를 그대로 쓴다. 화면·서버는 쓰지 않는다.
 *
 * 가정 (사람은 이렇게 한다고 본다):
 *  - 대원은 그 지형의 고향 대원(쥐 → 소 → 호랑이 → 토끼 → 용 → 뱀 → 말 → 양 → 원숭이 → 닭 → 개 → 돼지), 무기는 그 대원이 잘 다루는 종류.
 *  - 맵에 들어가기 전에: 보관함 받기 → 가장 좋은 무기·방어구·장신구 착용(상점에 더 좋은 것이 있고 돈이 되면 산다)
 *    → 안 쓰는 일반 장비는 분해(강화석이 모자랄 때)하거나 판다 → 무기·방어구 강화 → 물약 채우기(체력 8 · 마력 4).
 *  - 쓰러지면 다시 도전하고, 같은 맵에서 두 번 쓰러질 때마다 바로 앞 맵을 한 번 돌고 온다(사냥).
 *  - 지형 보스는 열쇠가 나올 때까지 다시 잡는다 (40%, 3번째 확정).
 *  - 지형을 끝낼 때마다 정예가 둘씩 나오는 6·7번 맵을 한 번씩 더 돈다 (레어·별 모으기 — PRD: 15시간 중 6시간이 사냥·열쇠·레어).
 *    5지형부터는 두 번씩 (PRD 성장 표: 1~4지형은 지형마다 1시간, 5~8지형은 1시간 15분).
 *    표에는 'N사냥' 줄로 따로 보인다.
 *  - 사람의 시간 = 자동 조종 시간 × HUMAN + 판마다 BETWEEN 초 (결과 화면·쉼터). 자동 조종은 망설이지 않고 길을 알고 있어서 사람보다 빠르다.
 */
import { BAG, POTION, regionTier } from '../src/data/economy';
import { GROWTH_TARGETS, defaultLoadout, expNeed } from '../src/data/growth';
import { heroOf, type HeroId } from '../src/data/heroes';
import { itemDef, itemLevel, itemStats, normalArmor, normalWeapon, type Item } from '../src/data/items';
import { MAPS, mapOf, mapKillMax, type MapDef } from '../src/data/maps';
import { MAPS_PER_REGION, REGIONS_READY, mapLevel, regionOf } from '../src/data/regions';
import { TIER_LEVELS, WEAPON_KINDS, tierAtk, tierForLevel, type WeaponKind } from '../src/data/weapons';
import { roll } from '../src/game/drops';
import { applyReport, bagCount, dropCtx, emptyProfile, equipped, hasKey, heroesOf, isEquipped, loadoutOf, type RunReport, type TwelveProfile } from '../src/game/progress';
import { buy, claim, enhance, equip, scrap, sell, shopTier } from '../src/game/rules';
import { parHits } from '../src/data/mapgen';
import { createRun } from '../src/game/sim';
import { autoplay } from '../tests/bot';

/** 사람 시간 = 자동 조종 시간 × HUMAN + BETWEEN (초) */
const HUMAN = 1.3;
const BETWEEN = 30;
/** 물약을 이만큼 채우고 들어간다 [체력, 마력] */
const POTIONS = [8, 4];
/** 판 최대 시간 (자동 조종이 헤매면 끊는다) */
const MAX_RUN = 1500;
/** 지형을 끝낸 뒤 더 도는 맵 (정예가 둘씩 나온다). 5지형부터는 두 바퀴 — 장비 값·강화 비용·레어 목록이 늘어 사냥이 길어진다 */
const FARM_MAPS = [6, 7];
const farmRounds = (region: number) => (region >= 5 ? 2 : 1);

const args = process.argv.slice(2);
const pad = (v: string | number, n: number) => String(v).padStart(n);
const padEnd = (v: string | number, n: number) => String(v).padEnd(n);
/** 한글은 두 칸으로 센다 (표 줄 맞춤) */
const width = (s: string) => [...s].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
const cell = (v: string | number, n: number) => ' '.repeat(Math.max(0, n - width(String(v)))) + String(v);
const min = (sec: number) => (sec / 60).toFixed(1);

// ---------- 쉼터에서 하는 일 ----------

const defOf = (it: Item) => itemDef(it.base)!;
const power = (it: Item) => {
  const d = defOf(it);
  const st = itemStats(d, it.plus);
  return d.slot === 'weapon' ? st.atk : d.slot === 'armor' ? st.hp + st.def * 8 : d.tier + 1;
};
const ACC_ORDER = ['crit', 'speed', 'potion', 'mp', 'coin'];

function prepare(p: TwelveProfile, map: MapDef): HeroId {
  const home = regionOf(map.region).home;
  const hero = heroesOf(p).includes(home) ? home : p.hero;
  p.hero = hero;
  const kind: WeaponKind = heroOf(hero).weapon;
  claim(p);

  // 무기·방어구: 가방에서 가장 좋은 것, 상점에 더 좋은 것이 있으면 산다
  const wearable = (it: Item) => !it.box && p.level >= itemLevel(defOf(it));
  const best = (ok: (it: Item) => boolean) => p.items.filter((it) => wearable(it) && ok(it)).sort((a, b) => power(b) - power(a) || defOf(b).tier - defOf(a).tier)[0];
  const tier = Math.min(shopTier(p), tierForLevel(p.level));
  for (const [slot, base, ok] of [
    ['weapon', normalWeapon(kind, tier), (it: Item) => defOf(it).kind === kind],
    ['armor', normalArmor(tier), (it: Item) => defOf(it).slot === 'armor'],
  ] as const) {
    let top = best(ok);
    const shop = itemDef(base)!;
    const shopPower = slot === 'weapon' ? itemStats(shop, 0).atk : itemStats(shop, 0).hp + itemStats(shop, 0).def * 8;
    // 강화한 낮은 등급(+9 = 다음 등급 일반과 같다)보다 새 등급을 사서 다시 강화하는 쪽이 낫다
    if ((!top || shopPower > power(top) || (!defOf(top).rare && defOf(top).tier < tier && shopPower >= power(top))) && p.coins >= shop.buy + 40 && bagCount(p) < p.bag && !buy(p, base)) top = best(ok);
    if (top) equip(p, top.id);
  }
  const acc = p.items.filter((it) => wearable(it) && defOf(it).slot === 'acc').sort((a, b) => defOf(b).tier - defOf(a).tier || ACC_ORDER.indexOf(defOf(a).stat!) - ACC_ORDER.indexOf(defOf(b).stat!))[0];
  if (acc) equip(p, acc.id);

  // 안 쓰는 장비: 레어는 두고, 일반 무기·방어구·남는 장신구는 분해(강화석이 모자라면)하거나 판다
  const spare = p.items.filter((it) => !isEquipped(p, it.id) && !defOf(it).rare).map((it) => it.id);
  for (const id of spare) {
    if (p.stones < 6) scrap(p, [id]);
    else sell(p, [id]);
  }
  // 강화: 물약 값은 남겨 두고, 무기 먼저
  for (const slot of ['weapon', 'armor'] as const) {
    const it = equipped(p, slot);
    while (it && p.coins >= 150 && !enhance(p, it.id)) {
      /* 될 때까지 */
    }
  }
  // 물약 (소)
  for (const k of [0, 1]) {
    const have = p.potions[k].reduce((a, b) => a + b, 0);
    for (let i = have; i < POTIONS[k] && p.coins >= POTION.price[k][0]; i++) buy(p, `potion:${k}:0`);
  }
  return hero;
}

// ---------- 판 하나 ----------

interface RunOut {
  cleared: boolean;
  /** 자동 조종이 쓴 시간 (초) */
  sim: number;
  exp: number;
  gear: number;
  potions: number;
}

function playRun(p: TwelveProfile, map: MapDef, seed: number, deaths: number): RunOut {
  const hero = prepare(p, map);
  const dropSeed = roll(seed, 99, 1);
  const s = createRun(map, 'normal', loadoutOf(p, hero), { seed, stock: p.potions, drops: dropCtx(p, map.id, 'normal', dropSeed) });
  autoplay(s, MAX_RUN, { chest: true });
  const report: RunReport = {
    run: '', map: map.id, mode: 'normal', hero, time: Math.floor(s.t), cleared: s.phase === 'clear', kills: { ...s.kills }, elites: s.eliteKills, boss: s.bossDead, chest: s.chest, deaths,
    potions: s.used.map((r) => [...r]),
  };
  const r = applyReport(p, report, dropSeed);
  return { cleared: report.cleared, sim: s.t, exp: r.exp, gear: r.items.filter((it) => !itemDef(it.base)?.rare && itemDef(it.base)?.slot !== 'acc').length, potions: s.potionsUsed };
}

interface Row {
  id: string;
  name: string;
  level: number;
  enemies: number;
  par: number;
  /** 판 수 (사냥 포함) · 쓰러진 횟수 */
  runs: number;
  deaths: number;
  /** 깬 판의 사람 시간 (초) · 이 맵에 쓴 사람 시간 전부 · 누적 */
  clear: number;
  total: number;
  clock: number;
  /** 도착 레벨 (소수 = 다음 레벨까지 모은 비율) */
  lv: number;
  coins: number;
  gear: number;
  bag: number;
  weapon: string;
  /** 깬 판에서 쓴 물약 수 · 깬 판의 자동 조종 시간 */
  potions: number;
  sim: number;
}

function journey(seed: number, regions: number): Row[] {
  const p = emptyProfile();
  const rows: Row[] = [];
  let clock = 0;
  let n = 0;
  const human = (o: RunOut) => o.sim * HUMAN + BETWEEN;
  for (const map of MAPS.filter((m) => m.region <= regions)) {
    const row: Row = { id: map.id, name: map.name, level: mapLevel(map.region, map.no, 'normal'), enemies: mapKillMax(map, 'normal').total, par: map.par, runs: 0, deaths: 0, clear: 0, total: 0, clock: 0, lv: 0, coins: 0, gear: 0, bag: 0, weapon: '', potions: 0, sim: 0 };
    const go = (m: MapDef, deaths: number) => {
      const o = playRun(p, m, roll(seed, 7, ++n), deaths);
      row.runs++;
      row.total += human(o);
      row.gear += o.gear;
      return o;
    };
    for (;;) {
      const o = go(map, row.deaths);
      if (o.cleared) {
        row.clear = human(o);
        row.potions = o.potions;
        row.sim = o.sim;
        break;
      }
      row.deaths++;
      if (row.deaths >= 12) break; // 못 깬다 (표에 ✗ 로 보인다)
      // 두 번 쓰러질 때마다 앞 맵에서 사냥
      const prev = mapOf(`${map.region}-${map.no - 1}`) ?? mapOf(`${map.region - 1}-${MAPS_PER_REGION}`);
      if (row.deaths % 2 === 0 && prev) go(prev, 0);
    }
    // 열쇠가 나올 때까지 보스를 다시 잡는다
    if (map.boss && row.clear) for (let i = 0; i < 6 && !hasKey(p, map.region); i++) go(map, 0);
    clock += row.total;
    row.clock = clock;
    row.lv = p.level + (expNeed(p.level) ? p.exp / expNeed(p.level) : 0);
    row.coins = p.coins;
    row.bag = bagCount(p);
    const w = equipped(p, 'weapon');
    row.weapon = w ? `${TIER_LEVELS[defOf(w).tier]}${defOf(w).rare ? '★' : ''}+${w.plus}` : '-';
    rows.push(row);
    if (!row.clear) break;
    if (!map.boss) continue;
    // 레어·별 모으기: 6·7번 맵을 한 번씩 더
    const farm: Row = { ...row, id: `${map.region}사냥`, name: '사냥', level: 0, enemies: 0, par: 0, runs: 0, deaths: 0, clear: 0, total: 0, gear: 0, potions: 0, sim: 0 };
    for (const no of Array.from({ length: farmRounds(map.region) }, () => FARM_MAPS).flat()) {
      const o = playRun(p, mapOf(`${map.region}-${no}`)!, roll(seed, 7, ++n), 0);
      farm.runs++;
      farm.total += human(o);
      farm.gear += o.gear;
      if (!o.cleared) farm.deaths++;
    }
    prepare(p, map);
    clock += farm.total;
    farm.clock = clock;
    farm.lv = p.level + (expNeed(p.level) ? p.exp / expNeed(p.level) : 0);
    farm.coins = p.coins;
    farm.bag = bagCount(p);
    const fw = equipped(p, 'weapon');
    farm.weapon = fw ? `${TIER_LEVELS[defOf(fw).tier]}${defOf(fw).rare ? '★' : ''}+${fw.plus}` : '-';
    rows.push(farm);
  }
  return rows;
}

// ---------- 표 ----------

function paceTable(regions: number, seeds: number) {
  const all = Array.from({ length: seeds }, (_, i) => journey(1000 + i * 77, regions));
  const count = Math.min(...all.map((r) => r.length));
  const avg = (i: number, f: (r: Row) => number) => all.reduce((a, r) => a + f(r[i]), 0) / all.length;
  console.log(`시아열두길 pace — 보통 모드 1~${regions}지형, 씨앗 ${seeds}개 평균 (사람 시간 = 자동 조종 × ${HUMAN} + 판마다 ${BETWEEN}초)`);
  console.log('');
  console.log('| 맵 | 권장Lv | 요괴 | 별 시간 | 깬 판(분) | 판 수 | 쓰러짐 | 맵 시간(분) | 누적(시간) | 도착 Lv | 무기 | 물약 | 엽전 | 일반 장비 | 가방 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const ends: { region: number; hours: number; lv: number; first: number; maps: number }[] = [];
  let firstSum = 0;
  let mapCount = 0;
  let regionNo = 0;
  for (let i = 0; i < count; i++) {
    const r = all[0][i];
    const farm = r.name === '사냥';
    if (farm) {
      console.log(
        `| ${cell(r.id, 5)} |    |     |      |      | ${pad(avg(i, (x) => x.runs).toFixed(1), 4)} | ${pad(avg(i, (x) => x.deaths).toFixed(1), 3)} | ${pad(min(avg(i, (x) => x.total)), 5)} | ${pad((avg(i, (x) => x.clock) / 3600).toFixed(2), 5)} | ${pad(avg(i, (x) => x.lv).toFixed(1), 5)} | ${cell(r.weapon, 6)} |      | ${pad(Math.round(avg(i, (x) => x.coins)), 5)} | ${pad(avg(i, (x) => x.gear).toFixed(1), 4)} | ${pad(Math.round(avg(i, (x) => x.bag)), 2)} |`,
      );
      ends.push({ region: ++regionNo, hours: avg(i, (x) => x.clock) / 3600, lv: avg(i, (x) => x.lv), first: firstSum, maps: ++mapCount && mapCount - 1 });
      mapCount--;
      continue;
    }
    mapCount++;
    const stuck = all.some((a) => !a[i].clear);
    const clear = avg(i, (x) => x.clear);
    firstSum += clear;
    console.log(
      `| ${padEnd(r.id, 5)} | ${pad(r.level, 2)} | ${pad(r.enemies, 3)} | ${pad(min(r.par), 4)} | ${pad(stuck ? '✗' : min(clear), 4)} | ${pad(avg(i, (x) => x.runs).toFixed(1), 4)} | ${pad(avg(i, (x) => x.deaths).toFixed(1), 3)} | ${pad(min(avg(i, (x) => x.total)), 5)} | ${pad((avg(i, (x) => x.clock) / 3600).toFixed(2), 5)} | ${pad(avg(i, (x) => x.lv).toFixed(1), 5)} | ${cell(r.weapon, 6)} | ${pad(avg(i, (x) => x.potions).toFixed(1), 4)} | ${pad(Math.round(avg(i, (x) => x.coins)), 5)} | ${pad(avg(i, (x) => x.gear).toFixed(1), 4)} | ${pad(Math.round(avg(i, (x) => x.bag)), 2)} |`,
    );
    if (process.env.PACE_PAR) {
      const m = mapOf(r.id)!;
      const h = parHits(m.region, m.no, m.groups, !!m.boss);
      console.log(`   별 시간 ÷ 사람이 깬 시간 = ${(r.par / (avg(i, (x) => x.sim) * HUMAN)).toFixed(2)}  [fit] ${m.rows.length} ${h.hits.toFixed(0)} ${h.bossHits.toFixed(0)} ${(avg(i, (x) => x.sim) * HUMAN).toFixed(0)}`);
    }
  }
  console.log('');
  console.log('| 구간 | 누적 시간 | 도착 Lv | 맵 한 판 평균(분) | 마지막 맵 권장 Lv |');
  console.log('|---|---|---|---|---|');
  let prev = 0;
  let prevMaps = 0;
  for (const e of ends) {
    console.log(`| 1~${e.region}지형 | ${e.hours.toFixed(2)}시간 | Lv ${e.lv.toFixed(1)} | ${min((e.first - prev) / (e.maps - prevMaps))} | ${mapLevel(e.region, MAPS_PER_REGION, 'normal')} |`);
    prev = e.first;
    prevMaps = e.maps;
  }
  console.log('');
  // PRD 성장 표와 견주기: 표의 구간(1~4지형 4시간 Lv25 · 5~8지형 9시간 Lv45 · 9~12지형 15시간 Lv65) 사이는 지형 수로 고르게 나눈다
  const last = ends[ends.length - 1];
  if (last) {
    const marks = [{ region: 0, hours: 0, level: 1 }, ...GROWTH_TARGETS.filter((g) => g.mode === 'normal')];
    const hi = marks.find((m) => m.region >= last.region) ?? marks[marks.length - 1];
    const lo = marks[marks.indexOf(hi) - 1] ?? marks[0];
    const f = hi.region === lo.region ? 1 : (last.region - lo.region) / (hi.region - lo.region);
    console.log(`목표 (PRD 성장 표: 보통 1~${hi.region}지형 약 ${hi.hours}시간에 Lv${hi.level}, 맵 한 판 5~6분) → 1~${last.region}지형: 약 ${(lo.hours + (hi.hours - lo.hours) * f).toFixed(1)}시간, Lv ${(lo.level + (hi.level - lo.level) * f).toFixed(0)} 안팎`);
    console.log(`결과: ${last.hours.toFixed(2)}시간, Lv ${last.lv.toFixed(1)}, 맵 한 판 평균 ${min(last.first / last.maps)}분 (첫 클리어 판 기준)`);
  }
  if (ends.length < regions) console.log(`\n✗ ${all[0][count - 1].id} 에서 막혔어요 (12번 쓰러짐) — 요괴가 너무 세거나 경험치가 모자라요`);
  console.log(`\n가방: ${BAG.size}칸에서 시작. '일반 장비' = 그 맵에 쓴 판들에서 떨어진 일반 무기·방어구 수, '가방' = 쉼터에서 정리한 뒤 다음 맵에 들고 간 칸 수`);
}

/** 무기 4종 비교: 같은 맵을 그 맵 권장 레벨 +2, 그 지형 등급의 일반 무기·방어구로 */
function weaponTable() {
  console.log('무기 비교 — 같은 맵 · 권장 레벨 +2 · 그 지형 등급의 일반 무기 · 물약 체력 8 마력 4 · 씨앗 3개 평균 (자동 조종 시간)');
  console.log('');
  console.log(`| 맵 | ${WEAPON_KINDS.map((k) => padEnd(k, 16)).join(' | ')} |`);
  console.log(`|---|${WEAPON_KINDS.map(() => '---').join('|')}|`);
  for (const id of ['1-2', '1-5', '1-8', '2-3', '2-6', '2-8', '3-3', '3-6', '3-8', '4-3', '4-6', '4-8', '5-3', '5-6', '5-8', '6-3', '6-6', '6-8', '7-3', '7-6', '7-8', '8-3', '8-6', '8-8', '9-3', '9-6', '9-8', '10-3', '10-6', '10-8', '11-3', '11-6', '11-8', '12-3', '12-6', '12-8']) {
    const m = mapOf(id);
    if (!m) continue;
    const lv = mapLevel(m.region, m.no, 'normal') + 2;
    const tier = Math.min(regionTier(m.region, 'normal'), tierForLevel(lv));
    const armor = itemStats(itemDef(normalArmor(tier))!, 0);
    const cols = WEAPON_KINDS.map((k) => {
      let t = 0;
      let hp = 0;
      let ok = 0;
      for (const seed of [3, 4, 5]) {
        const s = createRun(m, 'normal', { ...defaultLoadout(regionOf(m.region).home, lv, k, tier), weaponAtk: tierAtk(tier), armorHp: armor.hp, armorDef: armor.def }, { seed, potions: [POTIONS[0], POTIONS[1]] });
        const r = autoplay(s, MAX_RUN);
        t += r.time;
        hp += r.hpLeft;
        if (r.phase === 'clear') ok++;
      }
      return padEnd(`${min(t / 3)}분 ${ok}/3 ♥${Math.round((hp / 3) * 100)}%`, 16);
    });
    console.log(`| ${padEnd(id, 3)} | ${cols.join(' | ')} |`);
  }
}

if (args[0] === 'weapons') weaponTable();
else paceTable(Math.max(1, Math.min(REGIONS_READY, Number(args[0]) || REGIONS_READY)), Math.max(1, Number(args[1]) || 3));
