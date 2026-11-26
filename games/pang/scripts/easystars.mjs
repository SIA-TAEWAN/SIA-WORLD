// 별 기준만 다시 정한다 (이동 수·판 모양은 그대로). src/data/levels.json 의 stars 를 고친다 (1~2분).
//   node scripts/easystars.mjs            → 전체 (CPU 수만큼 나눠서)
//   node scripts/easystars.mjs 11 20      → 그 범위만 계산해서 표준 출력으로 (작업자용)
// 방법: 자동 플레이 36판을 calibrate.mjs 와 같은 이동 수(사람 몫을 뺀 수)로 돌리고
//   별 2개 = 이긴 판 점수의 하위 10%, 별 3개 = 하위 40%  (처음 기준은 25% · 65%였다 — 2026-11-26 쉽게)
// 바꾼 뒤 npm run sqlrows 로 SQL 스테이지 표도 고친다.
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as E from '../src/game/engine.js';

export const P2 = 0.1, P3 = 0.4;
const N = 36;
const FILE = new URL('../src/data/levels.json', import.meta.url);
const LEVELS = JSON.parse(readFileSync(FILE, 'utf8'));
const q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); if (!a.length) return 0; return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1) + 0.5)))]; };

function stars(L) {
  const margin = L.chapter === 0 ? 3 : L.chapter <= 4 ? 2 : 1;
  const scores = [];
  for (let s = 0; s < N; s++) { const r = E.playBot(L, 5000 + s, { moves: L.moves - margin }); if (r.won) scores.push(r.score); }
  if (scores.length < 4) return L.stars.map((v) => Math.round(v * 0.75 / 100) * 100); // 자동 플레이가 거의 못 깨는 판은 그냥 3/4
  const s2 = Math.round(q(scores, P2) / 100) * 100, s3 = Math.round(q(scores, P3) / 100) * 100;
  // 처음 기준보다 어려워지지는 않게
  const n2 = Math.min(L.stars[0], Math.max(s2, 100));
  return [n2, Math.min(L.stars[1], Math.max(s3, n2 + 300))];
}

const [a, b] = process.argv.slice(2).map(Number);
if (a && b) {
  const out = [];
  for (let id = a; id <= b; id++) out.push({ id, stars: stars(LEVELS[id - 1]) });
  process.send ? process.send(out) : console.log(JSON.stringify(out));
} else {
  const W = Math.max(1, Math.min(10, cpus().length));
  const per = Math.ceil(100 / W);
  const jobs = [];
  for (let w = 0; w < W; w++) {
    const from = w * per + 1, to = Math.min(100, (w + 1) * per);
    if (from > to) break;
    jobs.push(new Promise((res, rej) => { const c = fork(fileURLToPath(import.meta.url), [String(from), String(to)]); c.on('message', res); c.on('error', rej); }));
  }
  const all = (await Promise.all(jobs)).flat();
  for (const r of all) { const L = LEVELS[r.id - 1]; console.log(r.id, L.stars.join('/'), '→', r.stars.join('/')); L.stars = r.stars; }
  writeFileSync(FILE, JSON.stringify(LEVELS));
  console.log('src/data/levels.json 에 썼어요');
}
