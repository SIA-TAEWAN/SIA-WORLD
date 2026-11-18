/**
 * 밸런스 표를 화면 없이 뽑는다:  npm run balance  (판 수: npm run balance -- 200)
 * - 무기 12종(+진화 3종)의 초당 피해 (허수아비 기준)
 * - 캐릭터별 생존 시간 (강화 0, 들판, '보통 실력' 정책)
 * - 맵 4종 × 강화 수준별 생존 시간·클리어 비율 (PRD 7장의 밸런스 목표와 견줘 보는 표)
 *   한 부분만: npm run balance -- 40 maps | chars | dps
 */
import { CHARACTERS } from '../src/data/characters';
import { MAPS } from '../src/data/maps';
import { presetUpgrades } from '../src/data/upgrades';
import { average, dpsTable } from '../src/game/policy';

const runs = Math.max(2, Number(process.argv[2]) || 40);
const only = process.argv[3] ?? '';
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const t0 = Date.now();

if (!only || only === 'dps') {
  console.log('■ 무기별 초당 피해 (허수아비 40마리, 60초, 레벨 1~5)');
  for (const row of dpsTable()) console.log(`  ${row.name.padEnd(8, '　')} ${row.dps.map((d) => d.toFixed(1).padStart(7)).join('')}`);
}

if (!only || only === 'chars') {
  console.log(`\n■ 캐릭터별 생존 시간 (강화 0, 들판, ${runs}판)`);
  let total = 0;
  for (const c of CHARACTERS) {
    const a = average({ char: c.id, map: 'field' }, runs);
    total += a.time;
    console.log(`  ${c.name.padEnd(4, '　')} 평균 ${mmss(a.time)}  (${mmss(a.minTime)}~${mmss(a.maxTime)})  처치 ${a.kills.toFixed(0).padStart(5)}  레벨 ${a.level.toFixed(1).padStart(4)}  엽전 ${a.coins.toFixed(0).padStart(4)}  클리어 ${(a.clearRate * 100).toFixed(0)}%`);
  }
  console.log(`  전체 평균 ${mmss(total / CHARACTERS.length)}`);
}

if (!only || only === 'maps') {
  // PRD 7장의 목표: 들판 10 · 대나무 숲 22 · 달빛 궁궐 34 · 황천길 44 레벨쯤에서 클리어
  const levels = [0, 10, 22, 34, 44, 49];
  console.log(`\n■ 맵 × 강화 수준 (호랑이, ${runs}판): 평균 생존 시간 / 클리어 비율 / 평균 엽전`);
  console.log(`  ${'맵'.padEnd(6, '　')}${levels.map((l) => `강화 ${String(l).padStart(2)}`.padStart(20)).join('')}`);
  for (const map of MAPS.filter((m) => m.ready)) {
    const cells = levels.map((upg) => {
      const a = average({ char: 'tiger', map: map.id, upgrades: presetUpgrades(upg) }, runs);
      return `${mmss(a.time)} ${(a.clearRate * 100).toFixed(0).padStart(3)}% ${a.coins.toFixed(0).padStart(5)}닢`.padStart(20);
    });
    console.log(`  ${map.name.padEnd(6, '　')}${cells.join('')}`);
  }
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}초)`);
