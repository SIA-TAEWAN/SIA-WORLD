import { autoplay } from '../src/ai/autoplay';
import { TANK_IDS, TANKS } from '../src/game/data';
import type { MapId } from '../src/data/maps';
/** 밸런스 측정은 뒷동산 맵만 (열두빛은 TANK_IDS에 없어 빠진다) */
const MAP_IDS: MapId[] = ['valley'];
import type { Difficulty } from '../src/game/types';

const games = Number(process.argv[2] ?? 12);
const diff = (process.argv[3] ?? 'normal') as Difficulty;
const wins: Record<string, number> = {};
const played: Record<string, number> = {};
let totalTurns = 0;
let n = 0;
let draws = 0;
// SUDDEN=30 이면 서든데스(그 턴 뒤 물이 차오름)를 켜고 잰다. 판 길이 비교용으로 긴 판 수·가장 긴 판도 센다
const sudden = Number(process.env.SUDDEN ?? 0);
let long = 0;
let maxTurns = 0;
let capped = 0;
const t0 = Date.now();
// SHARD=i/n 이면 조합 일부만 (병렬 실행용), JSON=1 이면 결과를 JSON으로
const [si, sn] = (process.env.SHARD ?? '0/1').split('/').map(Number);
let pair = 0;
for (const a of TANK_IDS) {
  for (const b of TANK_IDS) {
    if (a === b) continue;
    if (pair++ % sn !== si) continue;
    for (const map of MAP_IDS) {
      for (let g = 0; g < games; g++) {
        const seed = (TANK_IDS.indexOf(a) * 7919 + TANK_IDS.indexOf(b) * 104729 + g * 2654435761 + map.length * 31) >>> 0;
        const r = autoplay(a, b, map, seed + g, diff, true, sudden);
        played[a] = (played[a] ?? 0) + 1;
        played[b] = (played[b] ?? 0) + 1;
        if (r.winner === 0) wins[a] = (wins[a] ?? 0) + 1;
        else if (r.winner === 1) wins[b] = (wins[b] ?? 0) + 1;
        else draws++;
        totalTurns += r.turns;
        if (r.turns > 30) long++;
        if (r.turns >= 200) capped++;
        maxTurns = Math.max(maxTurns, r.turns);
        n++;
      }
    }
  }
}
if (process.env.JSON) {
  console.log(JSON.stringify({ wins, played, n, totalTurns, draws, long, maxTurns, capped }));
  process.exit(0);
}
console.log(`난이도 ${diff}, ${n}판, 평균 ${(totalTurns / n).toFixed(1)}턴, 무승부 ${draws}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`서든데스 ${sudden || '끔'} · 30턴 넘긴 판 ${long} · 가장 긴 판 ${maxTurns}턴 · 200턴 한도에 걸린 판 ${capped}`);
for (const id of TANK_IDS) {
  const rate = ((wins[id] ?? 0) / played[id]) * 100;
  const ok = rate >= 40 && rate <= 60 ? 'OK ' : 'XX ';
  console.log(`${ok}${TANKS[id].name.padEnd(5)} 승률 ${rate.toFixed(1)}% (${wins[id] ?? 0}/${played[id]})`);
}
