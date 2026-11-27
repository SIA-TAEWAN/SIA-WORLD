// 시아팡팡 규칙 엔진: 판 만들기·매치·특수 블록·장애물·목표·보너스 타임·자동 플레이. DOM 없이 돌아가서 테스트·밸런스 스크립트도 그대로 쓴다
const KINDS = ['fire', 'water', 'wind', 'bolt', 'leaf', 'earth', 'light', 'dark', 'heart'];
const NAME = { fire: '불', water: '물', wind: '바람', bolt: '번개', leaf: '풀', earth: '땅', light: '빛', dark: '어둠', heart: '마음' };

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseLevel(L) {
  const rows = L.map.length, cols = L.map[0].length;
  return { rows, cols };
}

function createGame(L, seed) {
  const { rows, cols } = parseLevel(L);
  const G = {
    L, R: rng(seed), rows, cols, cells: [], score: 0, moves: L.moves, nextId: 1, combo: 0,
    goals: [], forced: null, lastSwap: null, state: 'play'
  };
  let ice = 0, box = 0, vine = 0;
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const ch = L.map[r][c];
      const cell = { hole: ch === 'x', ice: 0, box: 0, vine: false, t: null };
      if (ch === '1') cell.ice = 1;
      if (ch === '2') cell.ice = 2;
      if (ch === 'b') cell.box = 1;
      if (ch === 'B') cell.box = 2;
      if (ch === 'v') cell.vine = true;
      if (ch === 'V') { cell.vine = true; cell.ice = 1; }
      ice += cell.ice; box += cell.box; vine += cell.vine ? 1 : 0;
      row.push(cell);
    }
    G.cells.push(row);
  }
  for (const g of L.goals) {
    if (g.t === 'score') G.goals.push({ t: 'score', n: g.n, left: g.n });
    if (g.t === 'collect') G.goals.push({ t: 'collect', k: g.k, n: g.n, left: g.n });
    if (g.t === 'ice') G.goals.push({ t: 'ice', n: ice, left: ice });
    if (g.t === 'box') G.goals.push({ t: 'box', n: box, left: box });
    if (g.t === 'vine') G.goals.push({ t: 'vine', n: vine, left: vine });
  }
  let tries = 0;
  do { fillFresh(G); tries++; } while (!hasMoves(G) && tries < 50);
  return G;
}

function newTile(G, k, sp) { return { id: G.nextId++, k, sp: sp || null }; }
function randKind(G) { return G.L.kinds[Math.floor(G.R() * G.L.kinds.length)]; }
function holdsTile(cell) { return !cell.hole && cell.box === 0; }
function movable(cell) { return cell && holdsTile(cell) && cell.t && !cell.vine; }
function cellAt(G, r, c) { return r >= 0 && c >= 0 && r < G.rows && c < G.cols ? G.cells[r][c] : null; }
function kindAt(G, r, c) { const e = cellAt(G, r, c); return e && e.t && e.t.k !== 'orb' ? e.t.k : null; }

function fillFresh(G) {
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const e = G.cells[r][c];
    if (!holdsTile(e)) { e.t = null; continue; }
    let k, n = 0;
    do { k = randKind(G); n++; } while (n < 30 && ((kindAt(G, r, c - 1) === k && kindAt(G, r, c - 2) === k) || (kindAt(G, r - 1, c) === k && kindAt(G, r - 2, c) === k)));
    e.t = newTile(G, k);
  }
}

function findGroups(G) {
  const runs = [];
  for (let r = 0; r < G.rows; r++) {
    let s = 0;
    for (let c = 1; c <= G.cols; c++) {
      const k0 = kindAt(G, r, s);
      if (c < G.cols && k0 && kindAt(G, r, c) === k0) continue;
      if (k0 && c - s >= 3) { const cells = []; for (let i = s; i < c; i++) cells.push([r, i]); runs.push({ cells, k: k0 }); }
      s = c;
    }
  }
  for (let c = 0; c < G.cols; c++) {
    let s = 0;
    for (let r = 1; r <= G.rows; r++) {
      const k0 = kindAt(G, s, c);
      if (r < G.rows && k0 && kindAt(G, r, c) === k0) continue;
      if (k0 && r - s >= 3) { const cells = []; for (let i = s; i < r; i++) cells.push([i, c]); runs.push({ cells, k: k0 }); }
      s = r;
    }
  }
  if (!runs.length) return [];
  const parent = runs.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const owner = new Map();
  runs.forEach((run, i) => {
    for (const [r, c] of run.cells) {
      const key = r * 64 + c;
      if (owner.has(key)) parent[find(i)] = find(owner.get(key)); else owner.set(key, i);
    }
  });
  const groups = new Map();
  runs.forEach((run, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, { k: run.k, cells: new Map(), longest: run, maxLen: 0 });
    const g = groups.get(root);
    for (const [r, c] of run.cells) g.cells.set(r * 64 + c, [r, c]);
    if (run.cells.length > g.maxLen) { g.maxLen = run.cells.length; g.longest = run; }
  });
  const out = [];
  for (const g of groups.values()) {
    const cells = [...g.cells.values()];
    let sp = null;
    if (g.maxLen >= 5) sp = 'orb';
    else if (g.maxLen === 4 || cells.length >= 5) sp = 'line';
    out.push({ k: g.k, cells, sp, longest: g.longest.cells });
  }
  return out;
}

function adjacent(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1; }

function swapTiles(G, a, b) {
  const A = G.cells[a[0]][a[1]], B = G.cells[b[0]][b[1]];
  const t = A.t; A.t = B.t; B.t = t;
}

function canSwap(G, a, b) {
  return adjacent(a, b) && movable(cellAt(G, a[0], a[1])) && movable(cellAt(G, b[0], b[1]));
}

// returns {ok, kind:'match'|'orb'|'combo'}
function swap(G, a, b) {
  if (G.state !== 'play' || !canSwap(G, a, b)) return { ok: false };
  const A = G.cells[a[0]][a[1]].t, B = G.cells[b[0]][b[1]].t;
  G.combo = 0;
  if (A.sp === 'orb' || B.sp === 'orb') {
    G.moves--;
    G.lastSwap = [a, b];
    const forced = [];
    if (A.sp === 'orb' && B.sp === 'orb') {
      A.sp = null; B.sp = null;
      for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) { const e = G.cells[r][c]; if (holdsTile(e) && e.t) forced.push([r, c]); else if (e.box) forced.push([r, c]); }
      G.orbVis = { r: b[0], c: b[1], k: 'all', cells: forced.slice() };
    } else {
      const orbPos = A.sp === 'orb' ? a : b, other = A.sp === 'orb' ? B : A, oPos = A.sp === 'orb' ? b : a;
      G.cells[orbPos[0]][orbPos[1]].t.sp = null;
      const k = other.k, toLine = other.sp === 'line';
      forced.push(orbPos);
      const targets = [];
      for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
        const e = G.cells[r][c];
        if (holdsTile(e) && e.t && e.t.k === k) { if (toLine && !e.t.sp) e.t.sp = 'line'; forced.push([r, c]); targets.push([r, c]); }
      }
      G.orbVis = { r: orbPos[0], c: orbPos[1], k, cells: targets, line: toLine };
      void oPos;
    }
    G.forced = forced;
    return { ok: true, kind: 'orb' };
  }
  if (A.sp && B.sp) {
    G.moves--; G.lastSwap = [a, b];
    swapTiles(G, a, b);
    G.forced = [a, b];
    return { ok: true, kind: 'combo' };
  }
  swapTiles(G, a, b);
  if (!findGroups(G).length) { swapTiles(G, a, b); return { ok: false, bounce: true }; }
  G.moves--; G.lastSwap = [a, b];
  return { ok: true, kind: 'match' };
}

function effectCells(G, r, c, k, sp) {
  const out = [];
  const add = (rr, cc) => { if (cellAt(G, rr, cc) && !G.cells[rr][cc].hole) out.push([rr, cc]); };
  const extra = {};
  if (sp === 'orb') {
    const count = {};
    for (const row of G.cells) for (const e of row) if (e.t && e.t.k !== 'orb') count[e.t.k] = (count[e.t.k] || 0) + 1;
    let best = null, bn = -1;
    for (const kk in count) if (count[kk] > bn) { bn = count[kk]; best = kk; }
    for (let rr = 0; rr < G.rows; rr++) for (let cc = 0; cc < G.cols; cc++) { const e = G.cells[rr][cc]; if (e.t && e.t.k === best) out.push([rr, cc]); }
    extra.k = best;
    return { cells: out, extra };
  }
  switch (k) {
    case 'fire': for (let cc = 0; cc < G.cols; cc++) add(r, cc); break;
    case 'water': for (let rr = 0; rr < G.rows; rr++) add(rr, c); break;
    case 'bolt': for (let cc = 0; cc < G.cols; cc++) add(r, cc); for (let rr = 0; rr < G.rows; rr++) if (rr !== r) add(rr, c); break;
    case 'leaf': for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add(r + dr, c + dc); break;
    case 'dark': for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) add(r + dr, c + dc); break;
    case 'light': for (let d = -Math.max(G.rows, G.cols); d <= Math.max(G.rows, G.cols); d++) { add(r + d, c + d); if (d) add(r + d, c - d); } break;
    case 'heart': for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (Math.abs(dr) + Math.abs(dc) <= 2) add(r + dr, c + dc); break;
    case 'earth': for (let d = -2; d <= 2; d++) { add(r + d, c); if (d) add(r, c + d); } extra.quake = true; break;
    case 'wind': {
      add(r, c);
      const pri = [], rest = [];
      for (let rr = 0; rr < G.rows; rr++) for (let cc = 0; cc < G.cols; cc++) {
        if (rr === r && cc === c) continue;
        const e = G.cells[rr][cc];
        if (e.hole) continue;
        const want = e.box > 0 || e.ice > 0 || e.vine || (e.t && G.goals.some(g => g.t === 'collect' && g.left > 0 && g.k === e.t.k));
        if (want) pri.push([rr, cc]); else if (e.t) rest.push([rr, cc]);
      }
      const pick = arr => arr.splice(Math.floor(G.R() * arr.length), 1)[0];
      let n = 8;
      while (n > 0 && pri.length) { out.push(pick(pri)); n--; }
      while (n > 0 && rest.length) { out.push(pick(rest)); n--; }
      extra.targets = out.slice(1);
      break;
    }
  }
  return { cells: out, extra };
}

function goal(G, t, k, n) {
  for (const g of G.goals) if (g.t === t && (t !== 'collect' || g.k === k)) g.left = Math.max(0, g.left - n);
}

function stepClear(G) {
  const forced = G.forced || [];
  G.forced = null;
  const groups = findGroups(G);
  if (!groups.length && !forced.length) { G.lastSwap = null; return null; }
  G.combo++;
  const ev = { combo: G.combo, cleared: [], blasts: [], created: [], boxHits: [], iceHits: [], vines: [], gain: 0, movesAdded: 0, quake: false };
  if (G.orbVis) { ev.blasts.push({ k: 'orb', r: G.orbVis.r, c: G.orbVis.c, cells: G.orbVis.cells, target: G.orbVis.k }); G.orbVis = null; }
  const set = new Map();
  const matched = new Set();
  const addCell = (r, c) => { const key = r * 64 + c; if (!set.has(key)) set.set(key, [r, c]); };
  const creates = [];
  for (const g of groups) {
    for (const [r, c] of g.cells) { addCell(r, c); matched.add(r * 64 + c); }
    if (g.sp) {
      let pos = null;
      if (G.lastSwap) for (const p of [G.lastSwap[1], G.lastSwap[0]]) if (g.cells.some(q => q[0] === p[0] && q[1] === p[1])) { pos = p; break; }
      if (!pos) {
        // 가운데에서 가까운 칸부터, 덩굴 없는 칸 (덩굴 칸은 타일이 남아 특수 블록이 생기지 못한다)
        const mid = Math.floor(g.longest.length / 2);
        const order = g.longest.map((p, i) => [p, Math.abs(i - mid)]).sort((a, b) => a[1] - b[1]).map(q => q[0]);
        pos = order.find(p => !G.cells[p[0]][p[1]].vine) || g.longest[mid];
      }
      creates.push({ r: pos[0], c: pos[1], k: g.sp === 'orb' ? 'orb' : g.k, sp: g.sp });
    }
  }
  for (const [r, c] of forced) addCell(r, c);
  // expand specials
  const triggered = new Set();
  const queue = [...set.values()];
  while (queue.length) {
    const [r, c] = queue.shift();
    const e = G.cells[r][c];
    if (!e.t || !e.t.sp || triggered.has(e.t.id)) continue;
    triggered.add(e.t.id);
    const { cells, extra } = effectCells(G, r, c, e.t.k, e.t.sp);
    ev.blasts.push({ k: e.t.sp === 'orb' ? 'orb' : e.t.k, r, c, cells, target: extra.k, targets: extra.targets });
    if (e.t.k === 'heart' && e.t.sp === 'line' && G.state === 'play') { G.moves++; ev.movesAdded++; }
    if (extra.quake) ev.quake = true;
    for (const [rr, cc] of cells) { const key = rr * 64 + cc; if (!set.has(key)) { set.set(key, [rr, cc]); queue.push([rr, cc]); } }
  }
  const hitBox = new Set(), hitIce = new Set();
  const doBox = (r, c) => {
    const key = r * 64 + c, e = G.cells[r][c];
    if (e.box <= 0 || hitBox.has(key)) return;
    hitBox.add(key); e.box--; goal(G, 'box', null, 1); ev.gain += 40; ev.boxHits.push([r, c, e.box]);
  };
  const doIce = (r, c) => {
    const key = r * 64 + c, e = G.cells[r][c];
    if (e.ice <= 0 || hitIce.has(key)) return;
    hitIce.add(key); e.ice--; goal(G, 'ice', null, 1); ev.gain += 40; ev.iceHits.push([r, c, e.ice]);
  };
  if (ev.quake) {
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) { doBox(r, c); doIce(r, c); }
  }
  for (const [r, c] of set.values()) {
    const e = G.cells[r][c];
    if (e.hole) continue;
    if (e.box > 0) { doBox(r, c); continue; }
    if (!e.t) continue;
    if (e.vine) {
      e.vine = false; goal(G, 'vine', null, 1); ev.gain += 60; ev.vines.push([r, c]);
      if (e.t.sp && triggered.has(e.t.id)) e.t.sp = null;
      continue;
    }
    ev.cleared.push({ r, c, k: e.t.k, sp: e.t.sp, id: e.t.id });
    ev.gain += 20 * (G.state === 'bonus' ? 1 : G.combo);
    if (e.t.k !== 'orb') goal(G, 'collect', e.t.k, 1);
    doIce(r, c);
    e.t = null;
  }
  for (const key of matched) {
    const r = Math.floor(key / 64), c = key % 64;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = cellAt(G, r + dr, c + dc); if (n && n.box > 0) doBox(r + dr, c + dc); }
  }
  for (const cr of creates) {
    const e = G.cells[cr.r][cr.c];
    if (e.t || !holdsTile(e)) continue;
    e.t = newTile(G, cr.k, cr.sp);
    ev.created.push({ r: cr.r, c: cr.c, k: cr.k, sp: cr.sp, id: e.t.id });
    ev.gain += cr.sp === 'orb' ? 300 : 100;
  }
  G.score += ev.gain;
  goalScore(G);
  G.lastSwap = null;
  return ev;
}

function goalScore(G) { for (const g of G.goals) if (g.t === 'score') g.left = Math.max(0, g.n - G.score); }

function gravity(G) {
  const spawned = [];
  for (let c = 0; c < G.cols; c++) {
    const slots = [];
    for (let r = 0; r < G.rows; r++) { const e = G.cells[r][c]; if (holdsTile(e) && !(e.t && e.vine)) slots.push(r); }
    const tiles = slots.map(r => G.cells[r][c].t).filter(Boolean);
    let ti = tiles.length - 1;
    for (let i = slots.length - 1; i >= 0; i--) G.cells[slots[i]][c].t = ti >= 0 ? tiles[ti--] : null;
    let n = 0;
    for (let i = slots.length - 1; i >= 0; i--) {
      const e = G.cells[slots[i]][c];
      if (!e.t) { e.t = newTile(G, randKind(G)); n++; }
    }
    if (n) {
      let order = 0;
      for (let i = 0; i < slots.length; i++) { const e = G.cells[slots[i]][c]; if (e.t.id >= G.nextId - 1000000 && !e.t._seen) { /* noop */ } void order; }
    }
    spawned.push(n);
  }
  return spawned;
}

function goalsDone(G) { return G.goals.every(g => g.left <= 0); }

function hasMoves(G) {
  let specials = 0;
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const e = G.cells[r][c];
    if (!movable(e)) continue;
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const n = cellAt(G, r + dr, c + dc);
      if (!movable(n)) continue;
      if (e.t.sp === 'orb' || n.t.sp === 'orb' || (e.t.sp && n.t.sp)) return true;
      swapTiles(G, [r, c], [r + dr, c + dc]);
      const ok = findGroups(G).length > 0;
      swapTiles(G, [r, c], [r + dr, c + dc]);
      if (ok) return true;
    }
    if (e.t.sp) specials++;
  }
  return false;
}

function shuffle(G) {
  const pos = [];
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) if (movable(G.cells[r][c]) && !G.cells[r][c].t.sp) pos.push([r, c]);
  for (let tries = 0; tries < 60; tries++) {
    for (const [r, c] of pos) {
      let k, n = 0;
      do { k = randKind(G); n++; } while (n < 30 && ((kindAt(G, r, c - 1) === k && kindAt(G, r, c - 2) === k) || (kindAt(G, r - 1, c) === k && kindAt(G, r - 2, c) === k)));
      G.cells[r][c].t.k = k;
    }
    if (!findGroups(G).length && hasMoves(G)) return true;
  }
  return false;
}

// after cascade settles: decide state
function settle(G) {
  if (G.state === 'play') {
    if (goalsDone(G)) { G.state = 'bonus'; return 'win'; }
    if (G.moves <= 0) { G.state = 'lose'; return 'lose'; }
    if (!hasMoves(G)) { shuffle(G); return 'shuffle'; }
    return 'idle';
  }
  if (G.state === 'bonus') {
    if (G.moves > 0) return 'bonus';
    G.state = 'done';
    return 'done';
  }
  return G.state;
}

function bonusStep(G, n) {
  if (G.moves <= 0) return null;
  n = Math.max(1, Math.min(n || 1, G.moves));
  const pos = [];
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) { const e = G.cells[r][c]; if (movable(e) && !e.t.sp) pos.push([r, c]); }
  const out = [];
  G.forced = [];
  for (let i = 0; i < n; i++) {
    G.moves--; G.score += 200;
    if (!pos.length) continue;
    const p = pos.splice(Math.floor(G.R() * pos.length), 1)[0];
    const e = G.cells[p[0]][p[1]];
    e.t.sp = 'line';
    G.forced.push(p);
    out.push({ r: p[0], c: p[1], k: e.t.k, id: e.t.id });
  }
  goalScore(G);
  return out.length ? out : null;
}

function stars(G) {
  if (G.state !== 'done' && G.state !== 'bonus') return 0;
  const s = G.L.stars || [0, 0];
  return G.score >= s[1] ? 3 : G.score >= s[0] ? 2 : 1;
}

function resolveAll(G, onEvent) {
  let ev, n = 0;
  while ((ev = stepClear(G))) { gravity(G); if (onEvent) onEvent(ev); if (++n > 200) break; }
}

// ---- bot (heuristic) ----
function evalSwap(G, a, b) {
  const A = G.cells[a[0]][a[1]].t, B = G.cells[b[0]][b[1]].t;
  if (A.sp === 'orb' && B.sp === 'orb') return 60;
  if (A.sp === 'orb' || B.sp === 'orb') {
    const o = A.sp === 'orb' ? B : A;
    let n = 0;
    for (const row of G.cells) for (const e of row) if (e.t && e.t.k === o.k) n++;
    return n * (o.sp ? 3 : 1.4) + 8;
  }
  if (A.sp && B.sp) return 30;
  swapTiles(G, a, b);
  const groups = findGroups(G);
  let v = 0;
  for (const g of groups) {
    for (const [r, c] of g.cells) {
      const e = G.cells[r][c];
      v += 1;
      if (e.ice) v += 1.6;
      if (e.vine) v += 2.2;
      if (e.t.sp) v += 7;
      if (G.goals.some(q => q.t === 'collect' && q.left > 0 && q.k === e.t.k)) v += 1.4;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = cellAt(G, r + dr, c + dc); if (n && n.box > 0) v += 1.8; }
      v += r * 0.04;
    }
    if (g.sp === 'line') v += 5;
    if (g.sp === 'orb') v += 12;
  }
  swapTiles(G, a, b);
  return groups.length ? v : -1;
}

function botMove(G, noise) {
  let best = null, bv = -1;
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const a = [r, c], b = [r + dr, c + dc];
    if (!canSwap(G, a, b)) continue;
    const v = evalSwap(G, a, b);
    if (v < 0) continue;
    const vv = v + (noise ? G.R() * noise : 0);
    if (vv > bv) { bv = vv; best = [a, b]; }
  }
  return best;
}

function hint(G) { return botMove(G, 0); }

function playBot(L, seed, opts) {
  opts = opts || {};
  const G = createGame(Object.assign({}, L, { moves: opts.moves || L.moves }), seed);
  let used = 0;
  while (G.state === 'play') {
    const m = botMove(G, opts.noise == null ? 1.5 : opts.noise);
    if (!m) { shuffle(G); continue; }
    const res = swap(G, m[0], m[1]);
    if (!res.ok) { shuffle(G); continue; }
    used++;
    resolveAll(G);
    const s = settle(G);
    if (s === 'win') break;
    if (s === 'lose') break;
    if (used > 400) break;
  }
  const won = G.state === 'bonus';
  const preBonus = G.score;
  if (won) {
    while (G.moves > 0) { bonusStep(G); resolveAll(G); }
    G.state = 'done';
  }
  return { won, used, score: G.score, preBonus, goals: G.goals };
}

const api = { KINDS, NAME, rng, createGame, swap, canSwap, stepClear, gravity, settle, bonusStep, goalsDone, hasMoves, shuffle, stars, hint, botMove, playBot, resolveAll, findGroups, movable };
export default api;
export { KINDS, NAME, rng, createGame, swap, canSwap, stepClear, gravity, settle, bonusStep, goalsDone, hasMoves, shuffle, stars, hint, botMove, playBot, resolveAll, findGroups, movable };
