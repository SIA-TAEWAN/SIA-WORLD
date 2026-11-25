/**
 * 봇으로 1층부터 오르며 층마다 숫자를 찍는다 (밸런스 보기): npm run bot -- [씨앗 수] [마지막 층] [첫 씨앗]
 * 끝에 층마다 처음 오른 시간의 평균(분)을 찍는다 (사람은 봇보다 느리다 — PROGRESS.md '밸런스').
 */
import { botTower } from '../tests/bot';
import { newData } from '../src/game/progress';

const runs = Number(process.argv[2] ?? 3);
const last = Number(process.argv[3] ?? 10);
const first = Number(process.argv[4] ?? 1000);
const per = new Map<number, number[]>();
for (let i = 0; i < runs; i++) {
  const t0 = Date.now();
  const seed = first + i;
  const log = botTower(newData(seed), last, 4);
  console.log(`씨앗 ${seed}: 죽음 ${log.deaths}, 체크포인트 ${log.data.checkpoint}, 레벨 ${log.data.level}, 엽전 ${log.data.coins}, 조각 ${log.data.shards} (${Date.now() - t0}ms)`);
  const seen = new Set<number>();
  for (const f of log.floors) {
    const kh = f.killHits.length ? (f.killHits.reduce((a, b) => a + b, 0) / f.killHits.length).toFixed(1) : '-';
    const sk = Object.entries(f.skills).map(([k, n]) => `${k}${n}`).join(' ');
    console.log(`  ${String(f.floor).padStart(2)}층 ${f.result.padEnd(7)} Lv${f.level} 엽전${f.coins} ${f.time.toFixed(0)}초 처치${f.kills} 평균타수${kh}${f.bossTime ? ` 보스${f.bossTime.toFixed(0)}초` : ''} 물약${f.potions} 구슬[${f.orbs}] 조각${f.shards} ${sk}`);
    if (!seen.has(f.floor)) {
      seen.add(f.floor);
      if (!per.has(f.floor)) per.set(f.floor, []);
      per.get(f.floor)!.push(f.time);
    }
  }
}
const rows = [...per.entries()].sort((a, b) => a[0] - b[0]);
console.log('층마다 첫 도전 평균 (분):', rows.map(([f, ts]) => `${f}:${(ts.reduce((a, b) => a + b, 0) / ts.length / 60).toFixed(1)}`).join(' '));
const all = rows.flatMap(([, ts]) => ts);
console.log(`합계 평균 ${(all.reduce((a, b) => a + b, 0) / runs / 60).toFixed(1)}분 (${rows.length}층)`);
