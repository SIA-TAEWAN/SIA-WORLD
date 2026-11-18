/**
 * 밸런스 표를 화면 없이 뽑는다:  npm run balance  (판 수: npm run balance -- 200)
 * - 무기별 초당 피해 (허수아비 기준)
 * - 캐릭터별 생존 시간 (강화 0, 들판, '보통 실력' 정책)
 * - 강화 수준별 생존 시간·클리어 비율
 */
import { CHARACTERS } from '../src/data/characters';
import { MAPS } from '../src/data/maps';
import { presetUpgrades } from '../src/data/upgrades';
import { average, dpsTable } from '../src/game/policy';

const runs = Math.max(4, Number(process.argv[2]) || 40);
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

console.log('■ 무기별 초당 피해 (허수아비 37마리, 60초)');
for (const row of dpsTable()) console.log(`  ${row.name.padEnd(8, '　')} ${row.dps.map((d) => d.toFixed(1).padStart(7)).join('')}`);

const t0 = Date.now();
console.log(`\n■ 캐릭터별 생존 시간 (강화 0, 들판, ${runs}판)`);
let total = 0;
for (const c of CHARACTERS) {
  const a = average({ char: c.id, map: 'field' }, runs);
  total += a.time;
  console.log(`  ${c.name.padEnd(4, '　')} 평균 ${mmss(a.time)}  (${mmss(a.minTime)}~${mmss(a.maxTime)})  처치 ${a.kills.toFixed(0).padStart(5)}  레벨 ${a.level.toFixed(1).padStart(4)}  엽전 ${a.coins.toFixed(0).padStart(4)}  클리어 ${(a.clearRate * 100).toFixed(0)}%`);
}
console.log(`  전체 평균 ${mmss(total / CHARACTERS.length)}`);

for (const map of MAPS.filter((m) => m.ready)) {
  console.log(`\n■ 강화 수준별 (${map.name}, 호랑이, ${runs}판)`);
  for (const upg of [0, 5, 10, 15, 22, 34, 49]) {
    const a = average({ char: 'tiger', map: map.id, upgrades: presetUpgrades(upg) }, runs);
    console.log(`  강화 ${String(upg).padStart(2)}  평균 ${mmss(a.time)}  처치 ${a.kills.toFixed(0).padStart(5)}  레벨 ${a.level.toFixed(1).padStart(4)}  엽전 ${a.coins.toFixed(0).padStart(4)}  클리어 ${(a.clearRate * 100).toFixed(0)}%`);
  }
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}초)`);
