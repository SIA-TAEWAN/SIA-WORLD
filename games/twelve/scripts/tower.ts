/**
 * 끝없는 탑을 자동 조종이 몇 층까지 오르는지: npm run tower  (-- 3 = 씨앗 수)
 * 레벨마다 그 레벨에 낄 수 있는 일반 무기·방어구(강화 없음)와 체력 물약(소) 5 · 마력 물약(소) 3개로 1층부터 쓰러질 때까지 오른다.
 * 층 사이에는 게임과 같이 체력·마력이 조금 차고(TOWER.heal), 보스 층을 넘으면 가득 찬다.
 * 자동 조종은 예고를 빠짐없이 피하므로 사람보다 높이 오른다 — 층 난이도·보상의 큰 틀을 보는 용도다.
 */
import { tierDef, tierHp } from '../src/data/economy';
import { defaultLoadout } from '../src/data/growth';
import { TOWER, floorKind, towerCoins, towerFloor, towerStones } from '../src/data/tower';
import { TIER_LEVELS } from '../src/data/weapons';
import { createRun } from '../src/game/sim';
import { autoplay } from '../tests/bot';

const seeds = Math.max(1, Number(process.argv[2]) || 3);
const MAX_FLOOR = 200;
const tierOf = (level: number) => TIER_LEVELS.reduce((t, lv, i) => (level >= lv ? i : t), 0);

function climb(level: number, seed: number) {
  const tier = tierOf(level);
  const lo = { ...defaultLoadout('ox', level, 'sword', tier), armorHp: tierHp(tier), armorDef: tierDef(tier) };
  let stock = [[5, 0, 0], [3, 0, 0]];
  let carry: { hp: number; mp: number } | undefined;
  let time = 0;
  let coins = 0;
  let stones = 0;
  for (let f = 1; f <= MAX_FLOOR; f++) {
    const s = createRun(towerFloor(f), 'normal', lo, { seed: seed * 7919 + f, stock, carry });
    const r = autoplay(s, 600);
    if (r.phase !== 'clear') return { floor: f - 1, time, coins, stones };
    time += r.time;
    coins += towerCoins(f);
    stones += towerStones(f);
    const heal = floorKind(f) === 'boss' ? 1 : TOWER.heal;
    carry = { hp: Math.min(s.stats.hp, s.p.hp + s.stats.hp * heal), mp: Math.min(s.stats.mp, s.p.mp + s.stats.mp * heal) };
    stock = s.stock.map((x) => [...x]);
  }
  return { floor: MAX_FLOOR, time, coins, stones };
}

console.log(`끝없는 탑 — 자동 조종이 오르는 층 (씨앗 ${seeds}개 평균 · 일반 장비 · 강화 없음 · 체력 물약 5 마력 물약 3)\n`);
console.log('| 레벨 | 장비 등급 | 오른 층 | 걸린 시간(분) | 층마다(초) | 엽전 | 강화석 |');
console.log('|---|---|---|---|---|---|---|');
for (const level of [1, 5, 9, 13, 18, 27, 36]) {
  const runs = Array.from({ length: seeds }, (_, i) => climb(level, i + 1));
  const avg = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
  const floors = avg((r) => r.floor);
  console.log(`| ${level} | ${tierOf(level)} | ${floors.toFixed(1)} (${runs.map((r) => r.floor).join(' · ')}) | ${(avg((r) => r.time) / 60).toFixed(1)} | ${floors ? (avg((r) => r.time) / floors).toFixed(1) : '-'} | ${Math.round(avg((r) => r.coins))} | ${avg((r) => r.stones).toFixed(1)} |`);
}
