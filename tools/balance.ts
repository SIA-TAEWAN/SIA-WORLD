import { autoplay } from '../src/ai/autoplay';
import { TANK_IDS, TANKS } from '../src/game/data';
import { MAP_IDS } from '../src/data/maps';
import type { Difficulty } from '../src/game/types';

const games = Number(process.argv[2] ?? 12);
const diff = (process.argv[3] ?? 'normal') as Difficulty;
const wins: Record<string, number> = {};
const played: Record<string, number> = {};
let totalTurns = 0;
let n = 0;
let draws = 0;
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
        const r = autoplay(a, b, map, seed + g, diff, true);
        played[a] = (played[a] ?? 0) + 1;
        played[b] = (played[b] ?? 0) + 1;
        if (r.winner === 0) wins[a] = (wins[a] ?? 0) + 1;
        else if (r.winner === 1) wins[b] = (wins[b] ?? 0) + 1;
        else draws++;
        totalTurns += r.turns;
        n++;
      }
    }
  }
}
if (process.env.JSON) {
  console.log(JSON.stringify({ wins, played, n, totalTurns, draws }));
  process.exit(0);
}
console.log(`난이도 ${diff}, ${n}판, 평균 ${(totalTurns / n).toFixed(1)}턴, 무승부 ${draws}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const id of TANK_IDS) {
  const rate = ((wins[id] ?? 0) / played[id]) * 100;
  const ok = rate >= 40 && rate <= 60 ? 'OK ' : 'XX ';
  console.log(`${ok}${TANKS[id].name.padEnd(5)} 승률 ${rate.toFixed(1)}% (${wins[id] ?? 0}/${played[id]})`);
}
