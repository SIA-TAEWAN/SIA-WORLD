import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { TANK_IDS, TANKS } from '../src/game/data';

/** 밸런스 측정을 CPU 코어 수만큼 나눠 돌린다: npm run balance:par -- [판 수] [난이도] */
const games = process.argv[2] ?? '6' // 맵이 하나라 예전(3맵×2판)과 같은 판 수;
const diff = process.argv[3] ?? 'normal';
const N = Math.max(2, cpus().length - 1);
const t0 = Date.now();
const runs = Array.from({ length: N }, (_, i) =>
  new Promise<{ wins: Record<string, number>; played: Record<string, number>; n: number; totalTurns: number; draws: number; long: number; maxTurns: number; capped: number }>((res, rej) => {
    const p = spawn(process.execPath, ['--import', 'tsx', 'tools/balance.ts', games, diff], { env: { ...process.env, SHARD: `${i}/${N}`, JSON: '1' } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('close', (c) => (c === 0 ? res(JSON.parse(out.trim().split('\n').pop()!)) : rej(new Error(`shard ${i} exit ${c}`))));
  }),
);
const all = await Promise.all(runs);
const wins: Record<string, number> = {};
const played: Record<string, number> = {};
let n = 0;
let turns = 0;
let draws = 0;
// SUDDEN=30 npm run balance:par … 로 서든데스를 켜고 잴 수 있다 (판 길이 비교)
let long = 0;
let capped = 0;
let maxTurns = 0;
for (const r of all) {
  for (const [k, v] of Object.entries(r.wins)) wins[k] = (wins[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.played)) played[k] = (played[k] ?? 0) + v;
  n += r.n;
  turns += r.totalTurns;
  draws += r.draws;
  long += r.long;
  capped += r.capped;
  maxTurns = Math.max(maxTurns, r.maxTurns);
}
console.log(`난이도 ${diff}, ${n}판, 평균 ${(turns / n).toFixed(1)}턴, 무승부 ${draws}, ${((Date.now() - t0) / 1000).toFixed(1)}s (${N}개 병렬)`);
console.log(`서든데스 ${process.env.SUDDEN || '끔'} · 30턴 넘긴 판 ${long} · 가장 긴 판 ${maxTurns}턴 · 200턴 한도에 걸린 판 ${capped}`);
const rows = TANK_IDS.map((id) => ({ id, rate: ((wins[id] ?? 0) / played[id]) * 100 })).sort((a, b) => b.rate - a.rate);
for (const { id, rate } of rows) {
  const ok = rate >= 40 && rate <= 60 ? 'OK ' : 'XX ';
  console.log(`${ok}${TANKS[id].zodiac} ${TANKS[id].animal.padEnd(3)} ${TANKS[id].name.padEnd(4)} 승률 ${rate.toFixed(1)}% (${wins[id] ?? 0}/${played[id]})`);
}
