// 스테이지 100개를 만들고 자동 플레이로 이동 수·별 기준을 정해 src/data/levels.json 에 쓴다 (몇 분 걸린다).
//   node scripts/calibrate.mjs            → 전체 (CPU 수만큼 나눠서)
//   node scripts/calibrate.mjs 11 20      → 그 범위만 계산해서 표준 출력으로 (작업자용)
// 방법 (PRD '100스테이지 구성'):
//   1. 목표 클리어율(챕터가 갈수록 낮게, 보스는 12%p 낮게)에 맞는 이동 수를 자동 플레이 36판의 분포에서 고른다
//   2. 자동 플레이가 34수를 넘게 쓰면 장애물을 줄여 다시 (구석·구멍 옆처럼 깨기 어려운 칸부터 뺀다)
//   3. 사람 몫으로 챕터 1은 +3, 2~5는 +2, 그 뒤는 +1수
//   4. 별 2개 = 이긴 판 점수의 하위 25%, 별 3개 = 하위 65%
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as E from '../src/game/engine.js';
import { build } from './levelgen.mjs';

const N = 36;
const q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); if (!a.length) return 0; return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1) + 0.5)))]; };
function target(L) {
  const ch = L.chapter, j = (L.id - 1) % 10;
  let t = 0.95 - ch * 0.04;
  if (j === 0) t += 0.04;
  if (j === 4) t += 0.03;
  if (j === 9) t -= 0.12;
  t -= (j % 3) * 0.015;
  return Math.max(0.42, Math.min(0.97, t));
}
function calibrate(id) {
  for (let thin = 1; thin > 0.15; thin -= 0.2) {
    const L = build(id, thin);
    const tq = target(L);
    let M, scores = [], wr = 0;
    const scoreOnly = L.goals.length === 1 && L.goals[0].t === 'score';
    if (scoreOnly) {
      M = { 1: 14, 3: 16, 6: 18 }[L.id] || 18;
      const pre = [];
      for (let s = 0; s < N; s++) pre.push(E.playBot({ ...L, goals: [{ t: 'score', n: 1e12 }] }, 1000 + s, { moves: M }).score);
      L.goals[0].n = Math.round(q(pre, 1 - tq) / 100) * 100;
    } else {
      const used = [];
      for (let s = 0; s < N; s++) { const r = E.playBot(L, 1000 + s, { moves: 300 }); used.push(r.won ? r.used : 300); }
      M = Math.max(10, Math.min(50, q(used, tq)));
    }
    for (let it = 0; it < 4; it++) {
      let wins = 0; scores = [];
      for (let s = 0; s < N; s++) { const r = E.playBot(L, 5000 + s + it * 100, { moves: M }); if (r.won) { wins++; scores.push(r.score); } }
      wr = wins / N;
      if (wr < tq - 0.12 && M < 50) M++; else if (wr > tq + 0.12 && M > 10) M--; else break;
    }
    if (M > 34 && thin > 0.3) continue;
    const margin = L.chapter === 0 ? 3 : L.chapter <= 4 ? 2 : 1;
    const s2 = Math.round(q(scores, 0.25) / 100) * 100, s3 = Math.round(q(scores, 0.65) / 100) * 100;
    return { id: L.id, chapter: L.chapter, name: L.name, boss: L.boss, map: L.map, kinds: L.kinds, goals: L.goals, moves: M + margin, stars: [Math.max(s2, 100), Math.max(s3, s2 + 500)], intro: L.intro || undefined, botWin: Math.round(wr * 100) / 100 };
  }
}

const [a, b] = process.argv.slice(2).map(Number);
if (a && b) {
  const out = [];
  for (let id = a; id <= b; id++) out.push(calibrate(id));
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
  const all = (await Promise.all(jobs)).flat().sort((x, y) => x.id - y.id);
  for (const L of all) console.log(L.id, L.name, 'moves', L.moves, 'bot', L.botWin, 'stars', L.stars.join('/'));
  writeFileSync(new URL('../src/data/levels.json', import.meta.url), JSON.stringify(all.map(({ botWin, ...L }) => L)));
  console.log('src/data/levels.json 에 썼어요');
}
