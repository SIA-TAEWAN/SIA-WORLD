/**
 * 봇으로 1층부터 오르며 층마다 숫자를 찍는다 (밸런스 보기): npm run bot -- [씨앗 수] [마지막 층]
 */
import { botTower } from '../tests/bot';
import { newData } from '../src/game/progress';

const runs = Number(process.argv[2] ?? 3);
const last = Number(process.argv[3] ?? 10);
for (let i = 0; i < runs; i++) {
  const t0 = Date.now();
  const log = botTower(newData(1000 + i), last);
  console.log(`씨앗 ${1000 + i}: 죽음 ${log.deaths}, 체크포인트 ${log.data.checkpoint}, 레벨 ${log.data.level}, 엽전 ${log.data.coins}, 조각 ${log.data.shards} (${Date.now() - t0}ms)`);
  for (const f of log.floors) {
    const kh = f.killHits.length ? (f.killHits.reduce((a, b) => a + b, 0) / f.killHits.length).toFixed(1) : '-';
    console.log(`  ${String(f.floor).padStart(2)}층 ${f.result.padEnd(7)} Lv${f.level} 엽전${f.coins} ${f.time.toFixed(0)}초 처치${f.kills} 평균타수${kh}${f.bossTime ? ` 보스${f.bossTime.toFixed(0)}초` : ''} 구슬[${f.orbs}] 조각${f.shards}`);
  }
}
