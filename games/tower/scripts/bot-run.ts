/**
 * 봇으로 오르며 층마다 숫자를 찍는다 (밸런스 보기): npm run bot -- [씨앗 수] [마지막 층] [첫 씨앗] [시작 층]
 * 시작 층(체크포인트 1·11·…·91)을 주면 그 체크포인트에서 시작한다 (tests/start.ts — 1층부터 오른 봇과 비슷한 레벨·구슬).
 * 끝에 층마다 처음 오른 시간의 평균(분), 구역마다 번 엽전(그 구역 값의 회복약(대) 몇 개)·보스 시간을 찍는다
 * (사람은 봇보다 느리다 — PROGRESS.md '밸런스').
 */
import { botTower } from '../tests/bot';
import { startData } from '../tests/start';
import { newData } from '../src/game/progress';
import { priceOf } from '../src/data';

const runs = Number(process.argv[2] ?? 3);
const last = Number(process.argv[3] ?? 10);
const first = Number(process.argv[4] ?? 1000);
const from = Number(process.argv[5] ?? 1);
const per = new Map<number, number[]>();
const zoneRows: string[] = [];
for (let i = 0; i < runs; i++) {
  const t0 = Date.now();
  const seed = first + i;
  const log = botTower(from > 1 ? startData(seed, from) : newData(seed), last, 4);
  console.log(`씨앗 ${seed}: 죽음 ${log.deaths}, 체크포인트 ${log.data.checkpoint}, 최고 ${log.data.best}층, 레벨 ${log.data.level}, 엽전 ${log.data.coins}, 조각 ${log.data.shards} (${Date.now() - t0}ms)`);
  const seen = new Set<number>();
  for (const f of log.floors) {
    const kh = f.killHits.length ? (f.killHits.reduce((a, b) => a + b, 0) / f.killHits.length).toFixed(1) : '-';
    const sk = Object.entries(f.skills).map(([k, n]) => `${k}${n}`).join(' ');
    console.log(`  ${String(f.floor).padStart(3)}층 ${f.result.padEnd(7)} Lv${f.level} 엽전${f.coins} ${f.time.toFixed(0)}초 처치${f.kills} 평균타수${kh}${f.bossTime ? ` 보스${f.bossTime.toFixed(0)}초` : ''} 물약${f.potions} 구슬[${f.orbs}] 조각${f.shards} ${sk}`);
    if (!seen.has(f.floor)) {
      seen.add(f.floor);
      if (!per.has(f.floor)) per.set(f.floor, []);
      per.get(f.floor)!.push(f.time);
    }
  }
  // 구역마다 번 엽전 (휴식층에서 쓴 것까지) = (x4 뒤 - 구역 앞) + (x0 뒤 - x5 뒤)
  const firstOf = (f: number) => log.floors.find((r) => r.floor === f);
  for (let z = Math.ceil(from / 10); z <= Math.floor(last / 10); z++) {
    const b = z * 10 - 10;
    const c = (f: number) => (f === from - 1 ? startData(seed, from).coins : firstOf(f)?.coins);
    const [c0, c4, c5, c10] = [c(b), c(b + 4), c(b + 5), c(b + 10)];
    if ([c0, c4, c5, c10].some((v) => v === undefined)) continue;
    const earned = c4! - c0! + (c10! - c5!);
    const boss = log.floors.find((r) => r.floor === b + 10 && r.result === 'clear');
    zoneRows.push(`씨앗 ${seed} ${z}구역: 번 엽전 ${earned}냥 = 회복약(대) ${(earned / priceOf('potionL', b + 5)).toFixed(1)}개 · ${b + 9}층 뒤 Lv${firstOf(b + 9)?.level} · 보스 ${boss?.bossTime.toFixed(0)}초`);
  }
}
const rows = [...per.entries()].sort((a, b) => a[0] - b[0]);
console.log('층마다 첫 도전 평균 (분):', rows.map(([f, ts]) => `${f}:${(ts.reduce((a, b) => a + b, 0) / ts.length / 60).toFixed(1)}`).join(' '));
const all = rows.flatMap(([, ts]) => ts);
console.log(`합계 평균 ${(all.reduce((a, b) => a + b, 0) / runs / 60).toFixed(1)}분 (${rows.length}층)`);
for (const r of zoneRows) console.log(r);
