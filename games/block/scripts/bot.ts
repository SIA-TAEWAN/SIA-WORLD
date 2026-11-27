/**
 * 손맛 맞추기: 자동 플레이로 판 길이 · 점수 분포를 본다.  npm run bot -- [판 수] [noise]
 * (사람은 자동 플레이보다 못하므로 사람 평균은 이보다 낮다)
 */
import { botGame } from '../src/bot.ts';
import { newGame } from '../src/rules.ts';

const runs = Number(process.argv[2] ?? 100), noise = Number(process.argv[3] ?? 1);
const rows: { score: number; moves: number; lines: number; maxCombo: number; perfects: number; mercies: number }[] = [];
const t0 = Date.now();
for (let i = 1; i <= runs; i++) rows.push(botGame(i * 7919, newGame, noise, 5000).state);
const q = (k: keyof (typeof rows)[0], p: number) => { const a = rows.map(r => r[k]).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
for (const k of ['score', 'moves', 'lines', 'maxCombo', 'perfects', 'mercies'] as const) {
  console.log(k.padEnd(9), '10%', q(k, 0.1), ' 50%', q(k, 0.5), ' 90%', q(k, 0.9), ' max', q(k, 0.999));
}
console.log(`${runs}판 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
