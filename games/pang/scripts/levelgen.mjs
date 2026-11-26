// 스테이지 100개의 판 모양·장애물·목표를 만든다 (이동 수와 별 기준은 calibrate.mjs 가 자동 플레이로 채운다).
// build(i, thin): thin 이 작을수록 장애물을 덜 깐다 (자동 플레이가 너무 오래 걸리는 판을 줄일 때)
import * as E from '../src/game/engine.js';

const CHAPTERS = [
  { name: '정령의 숲', kinds: ['fire', 'water', 'leaf', 'wind', 'heart', 'light'] },
  { name: '얼음 호수', kinds: ['water', 'wind', 'light', 'leaf', 'heart', 'fire'] },
  { name: '바위 언덕', kinds: ['earth', 'fire', 'leaf', 'bolt', 'water', 'heart'] },
  { name: '구름 계곡', kinds: ['wind', 'light', 'water', 'bolt', 'heart', 'fire'] },
  { name: '얼음 동굴', kinds: ['water', 'dark', 'light', 'wind', 'earth', 'heart'] },
  { name: '덩굴 숲', kinds: ['leaf', 'earth', 'heart', 'water', 'fire', 'wind'] },
  { name: '번개 산', kinds: ['bolt', 'fire', 'earth', 'dark', 'wind', 'light'] },
  { name: '빛의 신전', kinds: ['light', 'heart', 'water', 'bolt', 'leaf', 'dark'] },
  { name: '어둠 숲', kinds: ['dark', 'earth', 'bolt', 'fire', 'heart', 'leaf'] },
  { name: '정령왕의 성', kinds: null }
];

function holeMask(type, R, C) {
  const h = (r, c) => {
    const cr = (R - 1) / 2, cc = (C - 1) / 2;
    switch (type) {
      case 'corners': return (r + c < 2) || (r + (C - 1 - c) < 2) || ((R - 1 - r) + c < 2) || ((R - 1 - r) + (C - 1 - c) < 2);
      case 'plus': return (r < 2 || r >= R - 2) && (c < 2 || c >= C - 2);
      case 'diamond': return Math.abs(r - cr) + Math.abs(c - cc) > (R + C) / 2 - 2;
      case 'notch': return r < 2 && Math.abs(c - cc) < 1.1;
      case 'pillars': return Math.abs(r - cr) < 1 && (c === 2 || c === C - 3);
      case 'hourglass': return Math.abs(r - cr) < 1.6 && (c === 0 || c === C - 1);
      case 'ring': return Math.abs(r - cr) < 1 && Math.abs(c - cc) < 1;
      case 'stairs': return (r < 2 && c < 2) || (r >= R - 2 && c >= C - 2);
      default: return false;
    }
  };
  return h;
}

function pattern(type, R, C, rnd, ok) {
  const S = new Set();
  const add = (r, c) => { if (ok(r, c)) S.add(r * 64 + c); };
  const sym = (r, c) => { add(r, c); add(r, C - 1 - c); };
  const cr = (R - 1) / 2, cc = (C - 1) / 2;
  const half = Math.ceil(C / 2);
  switch (type) {
    case 'bottom2': for (let r = R - 2; r < R; r++) for (let c = 0; c < C; c++) add(r, c); break;
    case 'bottom3': for (let r = R - 3; r < R; r++) for (let c = 0; c < C; c++) add(r, c); break;
    case 'top2': for (let r = 0; r < 2; r++) for (let c = 0; c < C; c++) add(r, c); break;
    case 'center': for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (Math.abs(r - cr) < 2 && Math.abs(c - cc) < 2) add(r, c); break;
    case 'center3': for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (Math.abs(r - cr) < 1.6 && Math.abs(c - cc) < 2.6) add(r, c); break;
    case 'frame': for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (r === 0 || c === 0 || r === R - 1 || c === C - 1) add(r, c); break;
    case 'xcross': for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (Math.abs((r - cr) - (c - cc)) < 0.6 || Math.abs((r - cr) + (c - cc)) < 0.6) add(r, c); break;
    case 'cols': for (let r = 0; r < R; r++) for (const c of [1, C - 2]) add(r, c); break;
    case 'midrow': for (let c = 0; c < C; c++) { add(Math.floor(cr), c); add(Math.ceil(cr), c); } break;
    case 'checker': for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if ((r + c) % 2 === 0 && r >= R - 4) add(r, c); break;
    case 'all': for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) add(r, c); break;
    case 'sparse': for (let r = 0; r < R; r++) for (let c = 0; c < half; c++) if (rnd() < 0.18) sym(r, c); break;
    case 'dense': for (let r = 0; r < R; r++) for (let c = 0; c < half; c++) if (rnd() < 0.38) sym(r, c); break;
    case 'corners4': for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if ((r < 2 || r >= R - 2) && (c < 2 || c >= C - 2)) add(r, c); break;
    case 'wall': for (let c = 0; c < C; c++) if (c !== Math.floor(cc) && c !== Math.ceil(cc)) add(Math.floor(cr) + 1, c); break;
    case 'twoRows': for (let c = 0; c < C; c++) { add(2, c); add(R - 3, c); } break;
  }
  return S;
}

function build(i, thin) {
  thin = thin || 1;
  const ch = Math.floor((i - 1) / 10), j = (i - 1) % 10, boss = j === 9;
  const rnd = E.rng(i * 7919 + 13);
  const size = (ch >= 3 && boss) || ch === 9 ? 9 : 8;
  const R = size, C = size;
  let kinds;
  if (ch === 9) {
    const all = E.KINDS.slice();
    for (let n = all.length - 1; n > 0; n--) { const m = Math.floor(rnd() * (n + 1)); [all[n], all[m]] = [all[m], all[n]]; }
    kinds = all.slice(0, 6);
  } else kinds = CHAPTERS[ch].kinds.slice();
  let kn = ch <= 2 ? 5 : ch === 3 ? (j % 2 ? 6 : 5) : (j === 0 ? 5 : 6);
  if (ch === 0 && j < 2) kn = 5;
  kinds = kinds.slice(0, kn);

  // holes
  const holeTypes = ['none', 'corners', 'plus', 'notch', 'pillars', 'hourglass', 'ring', 'diamond', 'stairs'];
  let hole = 'none';
  if (ch === 3) hole = ['corners', 'notch', 'plus', 'pillars', 'hourglass', 'ring', 'stairs', 'diamond', 'corners', 'plus'][j];
  else if (ch >= 4) hole = holeTypes[Math.floor(rnd() * holeTypes.length)];
  if (boss && ch >= 4) hole = ['plus', 'diamond', 'corners', 'ring', 'plus', 'stairs'][ch - 4];
  const isHole = holeMask(hole, R, C);
  const grid = [];
  for (let r = 0; r < R; r++) { const row = []; for (let c = 0; c < C; c++) row.push(isHole(r, c) ? 'x' : '.'); grid.push(row); }
  const free = (r, c) => grid[r][c] === '.';
  const put = (set, ch2, cond) => { for (const key of set) { const r = Math.floor(key / 64), c = key % 64; if (grid[r][c] === '.' && (!cond || cond(r, c))) grid[r][c] = ch2; } };

  const goals = [];
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const collect = (n, count) => {
    const ks = kinds.slice();
    for (let q = 0; q < count; q++) { const k = ks.splice(Math.floor(rnd() * ks.length), 1)[0]; goals.push({ t: 'collect', k, n }); }
  };
  const base = Math.round(14 + ch * 2.2 + j * 0.7);
  let intro = null;
  if (i === 1) intro = '같은 정령 3개를 이어 터뜨려 보세요';
  if (i === 2) intro = '4개를 맞추면 강화 정령이 생겨요';
  if (i === 5) intro = '5개를 일자로 맞추면 정령왕 구슬! 아무 정령과 바꿔 보세요';

  if (ch === 0) {
    const plan = ['score', 'c1', 'score', 'c2', 'c1', 'score', 'c2', 'c1', 'c2', 'boss'][j];
    if (plan === 'score') goals.push({ t: 'score', n: 0 });
    if (plan === 'c1') collect(base + 4, 1);
    if (plan === 'c2') collect(base, 2);
    if (plan === 'boss') collect(base + 8, 3);
  } else if (ch === 1) {
    const pats = ['bottom2', 'center', 'frame', 'checker', 'midrow', 'cols', 'bottom3', 'xcross', 'sparse', 'all'];
    put(pattern(pats[j], R, C, rnd, free), '1');
    goals.push({ t: 'ice' });
    if (j === 3 || j === 7) collect(base, 1);
    if (j === 0) intro = '얼음 위 정령을 터뜨리면 얼음이 깨져요';
  } else if (ch === 2) {
    const pats = ['bottom2', 'corners4', 'midrow', 'cols', 'center', 'twoRows', 'frame', 'checker', 'sparse', 'bottom3'];
    put(pattern(pats[j], R, C, rnd, free), 'b');
    goals.push({ t: 'box' });
    if (j % 3 === 2) { put(pattern('sparse', R, C, rnd, free), '1'); goals.push({ t: 'ice' }); }
    if (j === 5 || j === 9) collect(base, 1);
    if (j === 0) intro = '상자 옆에서 정령을 터뜨리면 상자가 부서져요. 땅 강화 정령은 상자를 한꺼번에 때려요';
  } else if (ch === 3) {
    const plan = j % 3;
    if (plan === 0) { put(pattern(pick(['center', 'bottom2', 'midrow']), R, C, rnd, free), '1'); goals.push({ t: 'ice' }); }
    if (plan === 1) collect(base, 2);
    if (plan === 2) { put(pattern(pick(['cols', 'twoRows', 'corners4']), R, C, rnd, free), 'b'); goals.push({ t: 'box' }); }
    if (boss) { put(pattern('sparse', R, C, rnd, free), '1'); if (!goals.some(g => g.t === 'ice')) goals.push({ t: 'ice' }); collect(base, 1); }
    if (j === 0) intro = '구멍 칸은 정령이 건너뛰어 떨어져요';
  } else if (ch === 4) {
    put(pattern(pick(['bottom3', 'center3', 'frame', 'midrow', 'xcross', 'checker']), R, C, rnd, free), '2');
    put(pattern('sparse', R, C, rnd, free), '1');
    goals.push({ t: 'ice' });
    if (j % 2 === 1) collect(base, 1);
    if (j === 0) intro = '두 겹 얼음은 두 번 깨야 해요';
  } else if (ch === 5) {
    put(pattern(pick(['midrow', 'cols', 'twoRows', 'center', 'sparse', 'wall']), R, C, rnd, free), 'v');
    goals.push({ t: 'vine' });
    if (j % 3 === 1) { put(pattern('sparse', R, C, rnd, free), '1'); goals.push({ t: 'ice' }); }
    if (j % 3 === 2) collect(base, 1);
    if (j === 0) intro = '덩굴에 감긴 정령은 움직일 수 없어요. 매치에 넣으면 덩굴이 끊어져요';
  } else if (ch === 6) {
    put(pattern(pick(['twoRows', 'corners4', 'cols', 'wall', 'midrow']), R, C, rnd, free), 'B');
    put(pattern('sparse', R, C, rnd, free), 'b');
    goals.push({ t: 'box' });
    if (j % 2 === 0) { put(pattern(pick(['center', 'sparse']), R, C, rnd, free), 'v'); goals.push({ t: 'vine' }); }
    else collect(base, 1);
    if (j === 0) intro = '쇠 띠 상자는 두 번 때려야 부서져요';
  } else if (ch === 7) {
    put(pattern(pick(['bottom3', 'center3', 'xcross', 'frame']), R, C, rnd, free), '2');
    put(pattern(pick(['cols', 'twoRows', 'corners4', 'sparse']), R, C, rnd, free), 'b');
    goals.push({ t: 'ice' }, { t: 'box' });
    if (boss) collect(base, 1);
  } else if (ch === 8) {
    const a = pick(['ice', 'box', 'vine']);
    if (a !== 'ice') { put(pattern(pick(['bottom2', 'center', 'checker']), R, C, rnd, free), rnd() < 0.5 ? '2' : '1'); goals.push({ t: 'ice' }); }
    if (a !== 'box') { put(pattern(pick(['cols', 'twoRows', 'sparse', 'corners4']), R, C, rnd, free), rnd() < 0.4 ? 'B' : 'b'); goals.push({ t: 'box' }); }
    if (a !== 'vine') { put(pattern(pick(['midrow', 'sparse', 'wall']), R, C, rnd, free), 'v'); goals.push({ t: 'vine' }); }
    if (j % 2 === 1 || boss) collect(base, 1);
  } else {
    put(pattern(pick(['bottom3', 'center3', 'checker', 'xcross']), R, C, rnd, free), '2');
    put(pattern(pick(['cols', 'twoRows', 'corners4']), R, C, rnd, free), rnd() < 0.5 ? 'B' : 'b');
    put(pattern(pick(['midrow', 'sparse']), R, C, rnd, free), 'v');
    goals.push({ t: 'ice' }, { t: 'box' }, { t: 'vine' });
    if (boss) collect(base + 6, 2);
  }
  // thin obstacles so a stage never needs a marathon
  const caps = { ice: Math.round((ch === 7 ? 20 : 26) * thin), box: Math.round(22 * thin), vine: Math.round(12 * thin) };
  const weight = { '1': ['ice', 1], '2': ['ice', 2], 'V': ['vine', 1], 'b': ['box', 1], 'B': ['box', 2], 'v': ['vine', 1] };
  for (const kind of ['ice', 'box', 'vine']) {
    const cells = [];
    let total = 0;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const w = weight[grid[r][c]]; if (w && w[0] === kind) { total += w[1]; if (c <= (C - 1) / 2) cells.push([r, c]); } }
    const hard = (r, c) => { let h = 0; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= R || cc >= C || grid[rr][cc] === 'x') h++; } return h + rnd() * 0.9; };
    cells.forEach(p => { p.h = hard(p[0], p[1]); });
    cells.sort((a, b) => b.h - a.h);
    while (total > caps[kind] && cells.length) {
      const [r, c] = cells.shift();
      for (const cc of new Set([c, C - 1 - c])) { const w = weight[grid[r][cc]]; if (w && w[0] === kind) { total -= w[1]; grid[r][cc] = '.'; } }
    }
  }
  const map = grid.map(r => r.join(''));
  const flat = map.join('');
  const has = { ice: /[12V]/.test(flat), box: /[bB]/.test(flat), vine: /[vV]/.test(flat) };
  for (let q = goals.length - 1; q >= 0; q--) if (has[goals[q].t] === false) goals.splice(q, 1);
  if (!goals.length) collect(base, 1);
  return { id: i, chapter: ch, name: CHAPTERS[ch].name, boss, map, kinds, goals, intro };
}

export { build, CHAPTERS };
