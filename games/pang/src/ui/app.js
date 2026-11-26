// 시아팡팡 화면: 지도 → 시작 팝업 → 게임(상태 띠·목표·점수·보드·정령 마당) → 결과.
// 기록(별·최고 점수)과 시아코인은 서버(api)가 정한다. 화면은 서버 답을 받기 전에 먼저 보여 주고, 답이 오면 맞춘다.
import * as E from '../game/engine.js';
import * as SPR from '../game/spirits.js';
import * as PangScene from './scene.js';
import LEVELS from '../data/levels.json';

export function startApp(opts) {
const { api, worldHome, openRanking, local } = opts;
const $ = id => document.getElementById(id);
const PI2 = Math.PI * 2;
const STAR = '<svg class="star" viewBox="0 0 24 24"><path d="M12 2.5l2.8 6.2 6.7.6-5.1 4.5 1.5 6.6L12 17l-5.9 3.4 1.5-6.6-5.1-4.5 6.7-.6z"/></svg>';
const STAR_OFF = STAR.replace('class="star"', 'class="star off"');
const CH_DESC = ['정령들과 처음 만나는 숲', '얼음 위 정령을 터뜨려 얼음을 깨요', '상자는 옆에서 터뜨려 부숴요', '구멍 뚫린 구름 위의 판', '두 겹 얼음이 기다려요', '덩굴에 감긴 정령을 풀어 주세요', '쇠 띠 상자는 두 번 때려야 해요', '얼음과 상자가 함께 나와요', '장애물이 마구 섞여요', '모든 장애물이 모인 9×9 성'];
const COMBO = ['', '', '좋아요', '멋져요', '대단해요'];

// ---------- 기록 ----------
// save = 서버의 내 기록 (pang_state). 결과를 보낸 뒤 서버 답으로 다시 맞춘다
const save = { stars: {}, best: {} };
let siaCoins = 0;
function takeState(st) {
  save.stars = { ...(st.stars || {}) }; save.best = { ...(st.best || {}) };
  if (Number.isFinite(st.siaCoins)) siaCoins = st.siaCoins;
}
takeState(opts.state);
const ALL = local && /[?&]all=1\b/.test(location.search);
function unlockedUpTo() { if (ALL) return 100; let n = 1; while (n <= 100 && save.stars[n]) n++; return Math.min(100, n); }

// ---------- map ----------
function renderMap() {
  const open = unlockedUpTo();
  let total = 0; for (const k in save.stars) total += save.stars[k];
  $('totalStars').innerHTML = STAR + ' ' + total + ' / 300';
  $('coinPill').textContent = '🪙 ' + siaCoins.toLocaleString();
  let html = '';
  for (let ch = 0; ch < 10; ch++) {
    const list = LEVELS.filter(l => l.chapter === ch);
    const got = list.reduce((s, l) => s + (save.stars[l.id] || 0), 0);
    html += '<div class="panel chapter"><h2>' + (ch + 1) + '. ' + list[0].name + '<small>' + STAR + ' ' + got + '/30</small></h2><p>' + CH_DESC[ch] + '</p><div class="stages">';
    for (const l of list) {
      const st = save.stars[l.id] || 0, lock = l.id > open, next = l.id === open && !st;
      const cls = ['stage', l.boss ? 'boss' : '', st ? 'done' : '', lock ? 'lock' : '', next ? 'next' : ''].join(' ');
      const stars = lock ? '' : [1, 2, 3].map(n => n <= st ? STAR : STAR_OFF).join('');
      html += '<button class="' + cls + '" data-id="' + l.id + '" aria-label="스테이지 ' + l.id + (lock ? ' 잠김' : '') + '"' + (lock ? ' disabled' : '') + '><b>' + (lock ? '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="5" y="10" width="14" height="10" rx="2" fill="#B8A584"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#B8A584" stroke-width="2.5"/></svg>' : l.id) + '</b><i>' + stars + '</i></button>';
    }
    html += '</div></div>';
  }
  $('chapters').innerHTML = html;
}
$('chapters').addEventListener('click', e => { const b = e.target.closest('.stage'); if (b && !b.disabled) showStart(+b.dataset.id); });
$('worldLink').href = worldHome();
$('rankBtn').onclick = async () => { if (!(await openRanking())) toast('랭킹을 불러오지 못했어요'); };
function toast(msg, ms) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms || 2000);
}

// ---------- small drawings shared by board and icons ----------
function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
function drawIce(x, S, n) {
  const p = S * 0.06;
  rr(x, -S / 2 + p, -S / 2 + p, S - 2 * p, S - 2 * p, S * 0.16);
  x.fillStyle = n > 1 ? 'rgba(170,225,255,0.55)' : 'rgba(170,225,255,0.3)'; x.fill();
  x.strokeStyle = 'rgba(230,248,255,' + (n > 1 ? 0.95 : 0.7) + ')'; x.lineWidth = n > 1 ? 2.5 : 1.6; x.stroke();
  x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 1.5; x.beginPath();
  x.moveTo(-S * 0.32, -S * 0.12); x.lineTo(-S * 0.14, -S * 0.3);
  if (n > 1) { x.moveTo(S * 0.12, S * 0.32); x.lineTo(S * 0.32, S * 0.12); x.moveTo(-S * 0.3, S * 0.05); x.lineTo(-S * 0.05, -S * 0.2); }
  x.stroke();
}
function drawBox(x, S, n) {
  const p = S * 0.08, w = S - 2 * p;
  rr(x, -w / 2, -w / 2, w, w, S * 0.1); x.fillStyle = '#C8894A'; x.fill();
  x.strokeStyle = '#5A3A1E'; x.lineWidth = Math.max(2, S * 0.05); x.stroke();
  x.strokeStyle = 'rgba(90,58,30,0.55)'; x.lineWidth = Math.max(1.5, S * 0.03); x.beginPath();
  x.moveTo(-w / 2 + 3, -w / 6); x.lineTo(w / 2 - 3, -w / 6); x.moveTo(-w / 2 + 3, w / 6); x.lineTo(w / 2 - 3, w / 6);
  x.moveTo(-w / 2 + 4, -w / 2 + 4); x.lineTo(w / 2 - 4, w / 2 - 4); x.stroke();
  x.fillStyle = 'rgba(255,230,190,0.35)'; x.fillRect(-w / 2 + 4, -w / 2 + 4, w - 8, 3);
  if (n > 1) {
    x.fillStyle = '#9AA4B0'; x.strokeStyle = '#4A5260'; x.lineWidth = 1.5;
    for (const yy of [-w * 0.3, w * 0.22]) { x.fillRect(-w / 2, yy, w, S * 0.1); x.strokeRect(-w / 2, yy, w, S * 0.1); }
    x.fillStyle = '#E8EDF2'; for (const yy of [-w * 0.3, w * 0.22]) for (const xx of [-w * 0.32, w * 0.32]) { x.beginPath(); x.arc(xx, yy + S * 0.05, S * 0.025, 0, PI2); x.fill(); }
  }
}
function drawVine(x, S) {
  x.strokeStyle = '#3E8A2E'; x.lineWidth = Math.max(2.5, S * 0.07); x.lineCap = 'round';
  x.beginPath(); x.moveTo(-S * 0.45, -S * 0.25); x.bezierCurveTo(-S * 0.1, -S * 0.5, S * 0.1, S * 0.5, S * 0.45, S * 0.25); x.stroke();
  x.beginPath(); x.moveTo(-S * 0.45, S * 0.3); x.bezierCurveTo(-S * 0.1, S * 0.05, S * 0.15, -S * 0.45, S * 0.42, -S * 0.32); x.stroke();
  x.strokeStyle = '#6FCB52'; x.lineWidth = Math.max(1, S * 0.025);
  x.beginPath(); x.moveTo(-S * 0.45, -S * 0.25); x.bezierCurveTo(-S * 0.1, -S * 0.5, S * 0.1, S * 0.5, S * 0.45, S * 0.25); x.stroke();
  x.fillStyle = '#6FCB52';
  for (const [a, b, r] of [[-0.25, -0.33, 0.6], [0.28, 0.32, -0.5], [0.05, -0.1, 1.2], [-0.3, 0.2, -1]]) { x.save(); x.translate(a * S, b * S); x.rotate(r); x.beginPath(); x.ellipse(0, 0, S * 0.09, S * 0.045, 0, 0, PI2); x.fill(); x.restore(); }
}
function drawGoalIcon(x, g, T) {
  const W = 34;
  x.clearRect(0, 0, W, W);
  x.save(); x.translate(W / 2, W / 2);
  if (g.t === 'collect') { x.fillStyle = '#2B2350'; rr(x, -16, -16, 32, 32, 9); x.fill(); x.scale(0.62, 0.62); SPR.draw(x, g.k, T, null); }
  else if (g.t === 'ice') { x.fillStyle = '#2B2350'; rr(x, -16, -16, 32, 32, 9); x.fill(); drawIce(x, 30, 2); }
  else if (g.t === 'box') drawBox(x, 32, 1);
  else if (g.t === 'vine') { x.fillStyle = '#2B2350'; rr(x, -16, -16, 32, 32, 9); x.fill(); drawVine(x, 30); }
  else { x.scale(1.3, 1.3); x.fillStyle = '#FFD34D'; x.strokeStyle = '#2A1A10'; x.lineWidth = 1.6; x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.5 : 11; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill(); x.stroke(); }
  x.restore();
}
function goalText(g) {
  if (g.t === 'collect') return E.NAME[g.k] + ' 정령 ' + g.n + '개 모으기';
  if (g.t === 'ice') return '얼음 모두 깨기 (' + g.n + '겹)';
  if (g.t === 'box') return '상자 모두 부수기 (' + g.n + '번)';
  if (g.t === 'vine') return '덩굴 모두 끊기 (' + g.n + '개)';
  return g.n.toLocaleString() + '점 넘기기';
}
const iconCanvases = [];
function iconCanvas(g) {
  const c = document.createElement('canvas'); const d = window.devicePixelRatio || 1;
  c.width = 34 * d; c.height = 34 * d; const x = c.getContext('2d'); x.scale(d, d);
  iconCanvases.push({ x, g }); return c;
}

// ---------- popups ----------
function popup(html, bind) { $('pop').innerHTML = html; $('overlay').classList.remove('hidden'); bind && bind($('pop')); const b = $('pop').querySelector('.btn.primary'); if (b) b.focus({ preventScroll: true }); }
function closePop() { $('overlay').classList.add('hidden'); iconCanvases.length = 0; if (G) buildGoals(); }
function goalList(goals, live) {
  const wrap = document.createElement('div'); wrap.className = 'goalist';
  for (const g of goals) {
    const row = document.createElement('div');
    row.appendChild(iconCanvas(g));
    const s = document.createElement('span'); s.textContent = goalText(g);
    if (live) { s.className = g.left <= 0 ? 'ok' : 'no'; if (g.left > 0) s.textContent += ' · ' + g.left + ' 남음'; }
    row.appendChild(s); wrap.appendChild(row);
  }
  return wrap;
}
function showStart(id) {
  const L = LEVELS[id - 1];
  iconCanvases.length = 0;
  const goals = E.createGame(L, 1).goals;
  const best = save.best[id], st = save.stars[id] || 0;
  popup('<h3>스테이지 ' + id + '</h3><div class="chap">' + (L.chapter + 1) + '장 ' + L.name + (L.boss ? ' · 보스' : '') + '</div><div class="gl"></div><div class="info">이동 ' + L.moves + '번 · 정령 ' + L.kinds.length + '종</div>' + (L.intro ? '<div class="intro"></div>' : '') + (best ? '<div class="info">최고 ' + best.toLocaleString() + '점 ' + [1, 2, 3].map(n => n <= st ? STAR : STAR_OFF).join('') + '</div>' : '') + '<div class="row"><button class="btn" data-a="close">닫기</button><button class="btn primary" data-a="go">시작</button></div>', p => {
    p.querySelector('.gl').replaceWith(goalList(goals, false));
    if (L.intro) p.querySelector('.intro').textContent = L.intro;
    p.querySelector('[data-a=close]').onclick = () => { closePop(); };
    p.querySelector('[data-a=go]').onclick = () => { closePop(); startStage(id); };
  });
}
function showPause() {
  if (!G || phase === 'end') return;
  popup('<h3>멈춤</h3><div class="chap">스테이지 ' + L.id + '</div><div class="row"><button class="btn" data-a="map">지도로</button><button class="btn" data-a="retry">다시 하기</button></div><div class="row"><button class="btn primary" data-a="go">계속하기</button></div>', p => {
    p.querySelector('[data-a=go]').onclick = closePop;
    p.querySelector('[data-a=retry]').onclick = () => { closePop(); startStage(L.id); };
    p.querySelector('[data-a=map]').onclick = () => { closePop(); toMap(); };
  });
}
function showResult(win) {
  phase = 'end';
  const id = L.id, score = G.score, run = runId;
  const st = win ? (E.stars(G) || 1) : 0;
  const prevBest = save.best[id] || 0;
  if (win) { save.stars[id] = Math.max(save.stars[id] || 0, st); save.best[id] = Math.max(prevBest, score); }
  let html;
  if (win) {
    const last = id === 100;
    html = '<h3>' + (last ? '정령왕의 성을 지켰어요!' : '클리어!') + '</h3><div class="chap">스테이지 ' + id + '</div><div class="bigstars">' + [1, 2, 3].map(n => n <= st ? STAR : STAR_OFF).join('') + '</div><div class="score">' + score.toLocaleString() + '점</div><div class="info">' + (score > prevBest ? '최고 기록!' : '최고 ' + save.best[id].toLocaleString() + '점') + '</div><div class="info coin">기록을 보내는 중…</div>' +
      '<div class="row"><button class="btn" data-a="map">지도</button><button class="btn" data-a="retry">다시 하기</button></div>' + (last ? '' : '<div class="row"><button class="btn primary" data-a="next">다음 스테이지</button></div>');
  } else {
    html = '<h3>아쉬워요</h3><div class="chap">스테이지 ' + id + ' · 이동을 모두 썼어요</div><div class="gl"></div><div class="info coin">기록을 보내는 중…</div><div class="row"><button class="btn" data-a="map">지도</button><button class="btn primary" data-a="retry">다시 하기</button></div>';
  }
  iconCanvases.length = 0;
  popup(html, p => {
    const gl = p.querySelector('.gl'); if (gl) gl.replaceWith(goalList(G.goals, true));
    p.querySelector('[data-a=map]').onclick = () => { closePop(); toMap(); };
    p.querySelector('[data-a=retry]').onclick = () => { closePop(); startStage(id); };
    const n = p.querySelector('[data-a=next]'); if (n) n.onclick = () => { closePop(); showStart(id + 1); };
  });
  const line = $('pop').querySelector('.coin');
  api.finish(run, id, win, score, swaps).then(r => {
    save.stars[id] = Math.max(save.stars[id] || 0, r.stars); save.best[id] = Math.max(save.best[id] || 0, r.best);
    if (Number.isFinite(r.siaCoins)) siaCoins = r.siaCoins;
    if (line && line.isConnected) line.textContent = r.gotCoin ? '🪙 시아코인 +1' : '기록을 저장했어요';
  }).catch(err => {
    if (line && line.isConnected) line.textContent = err && err.message === 'too fast' ? '기록이 너무 빨라 저장하지 않았어요' : '기록을 저장하지 못했어요. 인터넷 연결을 확인해 주세요';
  });
}
$('pauseBtn').onclick = showPause;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('overlay').classList.contains('hidden')) { if (phase !== 'end') closePop(); } else if (G) showPause(); } });

// ---------- game state ----------
let hintCache = null;
let G = null, L = null, phase = 'none', wait = 0, idle = 0, sel = null, down = null, shake = 0;
const sprites = new Map();
let dying = [], parts = [], fx = [], texts = [];
const cv = $('board'), x = cv.getContext('2d');
let S = 50, dpr = 1, BW = 400, BH = 400;
function resize() {
  if (!G) return;
  dpr = window.devicePixelRatio || 1;
  BW = cv.clientWidth || 400; S = BW / G.cols; BH = S * G.rows;
  cv.style.height = BH + 'px';
  cv.width = Math.round(BW * dpr); cv.height = Math.round(BH * dpr);
}
new ResizeObserver(() => resize()).observe(cv);
const scene = PangScene.create($('scene'), SPR);
function layoutScene() {
  const wrap = $('sceneWrap');
  if (!G) return;
  wrap.classList.remove('hidden');
  const top = wrap.getBoundingClientRect().top + window.scrollY;
  const avail = window.innerHeight - top - 62;
  if (avail < 110) { wrap.classList.add('hidden'); scene.st.on = false; return; }
  const H = Math.min(320, Math.round(avail));
  $('scene').style.height = H + 'px';
  scene.resize($('scene').clientWidth || BW, H);
  scene.st.on = true;
}
window.addEventListener('resize', () => { if (G) layoutScene(); });

function toMap() { G = null; phase = 'none'; $('game').classList.add('hidden'); $('map').classList.remove('hidden'); renderMap(); }
let runId = null, swaps = 0, starting = false;
async function startStage(id) {
  if (starting) return;
  starting = true;
  try { runId = await api.start(id); }
  catch (err) {
    starting = false;
    popup('<h3>시작하지 못했어요</h3><div class="chap">' + (err && err.message === 'locked stage' ? '아직 열리지 않은 스테이지예요' : '인터넷 연결을 확인하고 다시 시도해 주세요') + '</div><div class="row"><button class="btn primary" data-a="ok">확인</button></div>', p => { p.querySelector('[data-a=ok]').onclick = () => { closePop(); toMap(); }; });
    return;
  }
  starting = false; swaps = 0;
  L = LEVELS[id - 1];
  G = E.createGame(L, (Date.now() ^ (id * 2654435761)) >>> 0);
  $('map').classList.add('hidden'); $('game').classList.remove('hidden');
  $('stageName').innerHTML = '';
  const a = document.createElement('span'); a.textContent = '스테이지 ' + id; const b = document.createElement('small'); b.textContent = (L.chapter + 1) + '장 ' + L.name + (L.boss ? ' · 보스' : '');
  $('stageName').append(a, b);
  sprites.clear(); dying = []; parts = []; fx = []; texts = []; sel = null; down = null; idle = 0; hintCache = null; iconCanvases.length = 0;
  resize();
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) { const t = G.cells[r][c].t; if (t) sprites.set(t.id, { x: c, y: r - G.rows - 1 - (G.cols - c) * 0.15, vy: 0, pop: 0, land: 0 }); }
  buildGoals(); hud();
  const s2 = L.stars[0], s3 = L.stars[1], max = s3 * 1.15;
  $('mk2').innerHTML = STAR; $('mk3').innerHTML = STAR + STAR;
  $('mk2').style.left = (s2 / max * 100) + '%'; $('mk3').style.left = (s3 / max * 100) + '%';
  window.scrollTo({ top: 0 });
  scene.setup(L.chapter, L.kinds);
  layoutScene();
  phase = 'falling';
}
let goalEls = [];
function buildGoals() {
  if (!G) return;
  const box = $('goals'); box.innerHTML = ''; goalEls = [];
  for (const g of G.goals) {
    const d = document.createElement('div'); d.className = 'goal';
    d.appendChild(iconCanvas(g));
    const n = document.createElement('span'); d.appendChild(n); box.appendChild(d);
    goalEls.push({ d, n, g, last: null });
  }
}
let lastMoves = -1, lastScore = -1;
function hud() {
  if (!G) return;
  if (G.moves !== lastMoves) { lastMoves = G.moves; $('movesNum').textContent = G.moves; $('movesBox').classList.toggle('low', G.moves <= 5); }
  if (G.score !== lastScore) { lastScore = G.score; $('scoreNum').textContent = G.score.toLocaleString(); $('scoreFill').style.width = Math.min(100, G.score / (L.stars[1] * 1.15) * 100) + '%'; }
  for (const e of goalEls) {
    const v = e.g.t === 'score' ? Math.max(0, e.g.left) : e.g.left;
    if (v !== e.last) { e.last = v; e.n.textContent = v <= 0 ? '완료' : (e.g.t === 'score' ? v.toLocaleString() : v); e.d.classList.toggle('ok', v <= 0); }
  }
}

// ---------- input ----------
function cellFromEvent(e) {
  const b = cv.getBoundingClientRect();
  const c = Math.floor((e.clientX - b.left) / b.width * G.cols), r = Math.floor((e.clientY - b.top) / b.height * G.rows);
  return [r, c, e.clientX, e.clientY];
}
cv.addEventListener('pointerdown', e => {
  if (!G || phase !== 'idle') return;
  const [r, c, px, py] = cellFromEvent(e);
  if (r < 0 || c < 0 || r >= G.rows || c >= G.cols) return;
  down = { r, c, px, py, moved: false };
  try { cv.setPointerCapture(e.pointerId); } catch (er) { }
});
cv.addEventListener('pointermove', e => {
  if (!down || down.moved || phase !== 'idle') return;
  const b = cv.getBoundingClientRect(), cell = b.width / G.cols;
  const dx = e.clientX - down.px, dy = e.clientY - down.py;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > cell * 0.35) {
    down.moved = true;
    const t = Math.abs(dx) > Math.abs(dy) ? [down.r, down.c + Math.sign(dx)] : [down.r + Math.sign(dy), down.c];
    trySwap([down.r, down.c], t);
  }
});
cv.addEventListener('pointerup', () => {
  if (down && !down.moved && phase === 'idle') {
    const p = [down.r, down.c];
    if (sel && Math.abs(sel[0] - p[0]) + Math.abs(sel[1] - p[1]) === 1) trySwap(sel, p);
    else if (sel && sel[0] === p[0] && sel[1] === p[1]) sel = null;
    else sel = E.movable(G.cells[p[0]][p[1]]) ? p : null;
  }
  down = null;
});
function trySwap(a, b) {
  sel = null; idle = 0;
  if (b[0] < 0 || b[1] < 0 || b[0] >= G.rows || b[1] >= G.cols) return;
  if (!E.canSwap(G, a, b)) { nudge(a, b); return; }
  const res = E.swap(G, a, b);
  if (!res.ok) { nudge(a, b); return; }
  swaps++;
  phase = res.kind === 'orb' ? 'resolve' : 'swapping';
  if (res.kind === 'orb') { wait = 0; }
}
function nudge(a, b) {
  const A = G.cells[a[0]] && G.cells[a[0]][a[1]], B = cellAt(b);
  const dr = b[0] - a[0], dc = b[1] - a[1];
  if (A && A.t && sprites.get(A.t.id)) sprites.get(A.t.id).nudge = { dr, dc, t: 0 };
  if (B && B.t && sprites.get(B.t.id) && E.movable(B)) sprites.get(B.t.id).nudge = { dr: -dr, dc: -dc, t: 0 };
}
function cellAt(p) { return p[0] >= 0 && p[1] >= 0 && p[0] < G.rows && p[1] < G.cols ? G.cells[p[0]][p[1]] : null; }

// ---------- effects ----------
const PCOL = SPR.PC;
function cxy(r, c) { return [(c + 0.5) * S, (r + 0.5) * S]; }
function burst(k, X, Y, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * PI2, sp = (0.6 + Math.random() * 2.4) * S / 50;
    const p = { x: X, y: Y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, l: 1, d: 0.025 + Math.random() * 0.02, z: (2 + Math.random() * 3.5) * S / 50, c: PCOL[k] || '255,255,255', kind: 'dot', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3 };
    if (k === 'fire') { p.vy -= 1.2 * S / 50; p.g = -0.04; }
    if (k === 'water') { p.g = 0.14; p.vy -= 1.5; }
    if (k === 'leaf') { p.kind = 'leaf'; p.g = 0.04; p.d *= 0.7; }
    if (k === 'earth') { p.kind = 'rock'; p.g = 0.22; p.vy -= 2; p.d *= 0.8; }
    if (k === 'heart') { p.kind = 'heart'; p.g = -0.02; p.vy -= 1; p.z *= 1.2; }
    if (k === 'light') { p.kind = 'star'; p.z *= 1.4; }
    if (k === 'dark') { p.vx *= 0.6; p.vy *= 0.6; }
    if (k === 'wind') { p.kind = 'streak'; }
    parts.push(p);
  }
}
function chips(X, Y, col, n, kind) {
  for (let i = 0; i < n; i++) { const a = Math.random() * PI2, sp = (1 + Math.random() * 2.5) * S / 50; parts.push({ x: X, y: Y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, g: 0.2, l: 1, d: 0.03, z: (2 + Math.random() * 3) * S / 50, c: col, kind: kind || 'rock', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4 }); }
}
function floatText(s, X, Y, size, col) { texts.push({ s, x: X, y: Y, size, col: col || '#FFFFFF', l: 1 }); }

function applyEvent(ev) {
  let sx = 0, sy = 0;
  for (const c of ev.cleared) {
    const sp = sprites.get(c.id);
    const X = sp ? (sp.x + 0.5) * S : (c.c + 0.5) * S, Y = sp ? (sp.y + 0.5) * S : (c.r + 0.5) * S;
    dying.push({ x: X, y: Y, k: c.k, sp: c.sp, t: 0 });
    sprites.delete(c.id);
    burst(c.k === 'orb' ? 'light' : c.k, X, Y, c.sp ? 14 : 8);
    sx += X; sy += Y;
  }
  for (const b of ev.blasts) {
    const [X, Y] = cxy(b.r, b.c);
    fx.push({ type: b.k, r: b.r, c: b.c, X, Y, t: 0, dur: b.k === 'orb' ? 0.6 : 0.5, cells: b.cells, targets: b.targets, target: b.target });
    if (b.k === 'earth') shake = Math.max(shake, 10);
    if (b.k === 'dark' || b.k === 'orb' || b.k === 'bolt') shake = Math.max(shake, 5);
  }
  for (const c of ev.created) {
    sprites.set(c.id, { x: c.c, y: c.r, vy: 0, pop: 1, land: 0 });
    const [X, Y] = cxy(c.r, c.c); burst(c.k === 'orb' ? 'light' : c.k, X, Y, 10);
    floatText(c.sp === 'orb' ? '정령왕 구슬!' : '강화 정령!', X, Math.max(S * 0.4, Y - S * 0.9), 15, '#FFF4C2');
  }
  for (const [r, c, left] of ev.boxHits) { const [X, Y] = cxy(r, c); chips(X, Y, left ? '154,164,176' : '200,137,74', 8, 'rock'); }
  for (const [r, c] of ev.iceHits) { const [X, Y] = cxy(r, c); chips(X, Y, '200,235,255', 6, 'shard'); }
  for (const [r, c] of ev.vines) { const [X, Y] = cxy(r, c); for (let i = 0; i < 5; i++) burst('leaf', X, Y, 1); }
  const cnt = {};
  for (const c of ev.cleared) if (c.k !== 'orb') cnt[c.k] = (cnt[c.k] || 0) + (c.sp ? 4 : 1);
  for (const b of ev.blasts) if (b.k !== 'orb') cnt[b.k] = (cnt[b.k] || 0) + 6;
  for (const k in cnt) scene.ability(k, cnt[k]);
  if (ev.combo >= 3) scene.cheer();
  if (ev.cleared.length) {
    sx /= ev.cleared.length; sy /= ev.cleared.length;
    if (ev.gain) floatText('+' + ev.gain.toLocaleString(), sx, sy + S * 0.15, 18);
  }
  if (ev.combo >= 2 && G.state === 'play') floatText(ev.combo >= 5 ? '정령 폭풍!' : COMBO[ev.combo] + '!', BW / 2, BH * 0.42, 30 + Math.min(10, ev.combo * 2), ev.combo >= 5 ? '#FFB3C8' : '#FFE066');
  if (ev.movesAdded) floatText('이동 +' + ev.movesAdded, BW / 2, BH * 0.25, 26, '#FF9EC4');
}

// ---------- update ----------
function syncSprites() {
  for (let c = 0; c < G.cols; c++) {
    const fresh = [];
    for (let r = 0; r < G.rows; r++) { const t = G.cells[r][c].t; if (t && !sprites.has(t.id)) fresh.push([r, t]); }
    fresh.forEach(([r, t], i) => sprites.set(t.id, { x: c, y: i - fresh.length - 0.4, vy: 0, pop: 0, land: 0 }));
  }
}
function targets() {
  const m = new Map();
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) { const t = G.cells[r][c].t; if (t) m.set(t.id, [r, c, t]); }
  return m;
}
let TG = new Map();
function updateSprites(k) {
  TG = targets();
  let moving = false;
  for (const [id, sp] of sprites) {
    const tg = TG.get(id);
    if (!tg) { sprites.delete(id); continue; }
    const [r, c] = tg;
    const dx = c - sp.x; sp.x += dx * Math.min(1, 0.32 * k); if (Math.abs(c - sp.x) < 0.01) sp.x = c; else moving = true;
    if (sp.y < r) { sp.vy += (G.state === 'bonus' ? 0.04 : 0.02) * k; sp.y = Math.min(r, sp.y + sp.vy * k); if (sp.y >= r) { sp.y = r; if (sp.vy > 0.08) sp.land = 1; sp.vy = 0; } else moving = true; }
    else if (sp.y > r) { sp.y += (r - sp.y) * Math.min(1, 0.32 * k); if (Math.abs(r - sp.y) < 0.01) sp.y = r; else moving = true; }
    if (sp.pop > 0) sp.pop = Math.max(0, sp.pop - 0.08 * k);
    if (sp.land > 0) sp.land = Math.max(0, sp.land - 0.12 * k);
    if (sp.nudge) { sp.nudge.t += 0.07 * k; if (sp.nudge.t >= 1) sp.nudge = null; }
  }
  return moving;
}

function step(dt) {
  const k = Math.min(3, dt * 60);
  const moving = updateSprites(k);
  if (phase === 'idle') idle += dt;
  if (phase === 'swapping' || phase === 'falling') { if (!moving) phase = 'resolve'; }
  else if (phase === 'clearing') { wait -= dt; if (wait <= 0) { E.gravity(G); syncSprites(); phase = 'falling'; } }
  else if (phase === 'wait') { wait -= dt; if (wait <= 0) phase = nextPhase; }
  if (phase === 'resolve') {
    const ev = E.stepClear(G);
    if (ev) { applyEvent(ev); wait = G.state === 'bonus' ? 0.14 : ev.blasts.length ? 0.34 : 0.2; phase = 'clearing'; }
    else afterSettle(E.settle(G));
  }
  hud();
}
let nextPhase = 'idle';
function later(t, p) { wait = t; nextPhase = p; phase = 'wait'; }
function afterSettle(r) {
  if (r === 'idle') { phase = 'idle'; idle = 0; }
  else if (r === 'shuffle') { floatText('섞는 중', BW / 2, BH / 2, 28); for (const sp of sprites.values()) sp.pop = 1; later(0.8, 'idle'); }
  else if (r === 'win') { floatText('목표 달성!', BW / 2, BH * 0.4, 34, '#FFE066'); if (G.moves > 0) floatText('보너스 타임', BW / 2, BH * 0.55, 24, '#FFF4C2'); later(1.1, 'bonus'); }
  else if (r === 'bonus') phase = 'bonus';
  else if (r === 'done') later(0.6, 'resultWin');
  else if (r === 'lose') later(0.5, 'resultLose');
}
function bonusTick() {
  const n = G.moves > 8 ? 3 : G.moves > 3 ? 2 : 1;
  const bs = E.bonusStep(G, n);
  if (bs) { for (const b of bs) { const [X, Y] = cxy(b.r, b.c); burst('light', X, Y, 10); floatText('+200', X, Y - S * 0.4, 14, '#FFF4C2'); } later(0.15, 'resolve'); }
  else afterSettle(E.settle(G));
}

// ---------- draw ----------
function drawBoard(T) {
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, BW, BH);
  if (shake > 0.3) { x.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.6); shake *= 0.86; } else shake = 0;
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const e = G.cells[r][c];
    if (e.hole) continue;
    x.fillStyle = (r + c) % 2 ? '#352B5E' : '#3C3268';
    rr(x, c * S + 1.5, r * S + 1.5, S - 3, S - 3, S * 0.18); x.fill();
    if (e.ice) { x.save(); x.translate((c + 0.5) * S, (r + 0.5) * S); drawIce(x, S, e.ice); x.restore(); }
  }
  // hint
  if (phase !== 'idle') hintCache = null;
  else if (idle > 5 && !hintCache) hintCache = E.hint(G) || 'none';
  const hint = hintCache && hintCache !== 'none' ? hintCache : null;
  if (sel) { x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 3; rr(x, sel[1] * S + 2, sel[0] * S + 2, S - 4, S - 4, S * 0.18); x.stroke(); }
  x.save(); x.beginPath(); x.rect(0, 0, BW, BH); x.clip();
  const sc = S / 50;
  for (const [id, sp] of sprites) {
    const tg = TG.get(id); if (!tg) continue;
    const t = tg[2];
    let X = (sp.x + 0.5) * S, Y = (sp.y + 0.5) * S;
    if (sp.nudge) { const a = Math.sin(sp.nudge.t * Math.PI) * 0.3; X += sp.nudge.dc * a * S; Y += sp.nudge.dr * a * S; }
    if (Y < -S) continue;
    let s = sc * (1 - sp.pop * 0.6 + sp.pop * Math.sin(sp.pop * Math.PI) * 0.8);
    let sy = 1;
    if (sp.land) { sy = 1 - Math.sin(sp.land * Math.PI) * 0.12; }
    if (hint && ((hint[0][0] === tg[0] && hint[0][1] === tg[1]) || (hint[1][0] === tg[0] && hint[1][1] === tg[1]))) s *= 1 + 0.1 * Math.abs(Math.sin(T * 5));
    x.save(); x.translate(X, Y + (1 - sy) * S * 0.3); x.scale(s, s * sy);
    SPR.draw(x, t.sp === 'orb' ? 'orb' : t.k, T + (id % 17) * 0.37, t.sp === 'line' ? 'line' : null);
    x.restore();
  }
  x.restore();
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const e = G.cells[r][c];
    if (e.box) { x.save(); x.translate((c + 0.5) * S, (r + 0.5) * S); drawBox(x, S, e.box); x.restore(); }
    if (e.vine && e.t) { x.save(); x.translate((c + 0.5) * S, (r + 0.5) * S); drawVine(x, S); x.restore(); }
  }
  // dying sprites
  dying = dying.filter(d => d.t < 1);
  for (const d of dying) { d.t += 0.09; x.save(); x.globalAlpha = Math.max(0, 1 - d.t); x.translate(d.x, d.y); const s = sc * (1 + d.t * 0.7); x.scale(s, s); SPR.draw(x, d.sp === 'orb' ? 'orb' : d.k, T, null); x.restore(); }
  drawFx(T);
  drawParts();
  drawTexts();
}
function jagged(x0, y0, x1, y1, n, amp) { x.moveTo(x0, y0); const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L; for (let i = 1; i < n; i++) { const f = i / n, o = (Math.random() - 0.5) * amp * 2; x.lineTo(x0 + dx * f + nx * o, y0 + dy * f + ny * o); } x.lineTo(x1, y1); }
function drawFx(T) {
  fx = fx.filter(f => f.t < f.dur);
  x.save(); x.globalCompositeOperation = 'lighter';
  for (const f of fx) {
    f.t += 1 / 60; const p = f.t / f.dur, a = 1 - p, X = f.X, Y = f.Y;
    if (f.type === 'fire') {
      const h = S * (0.5 + 0.3 * Math.sin(p * Math.PI)), w = BW * Math.min(1, p * 3);
      const g = x.createLinearGradient(0, Y - h / 2, 0, Y + h / 2); g.addColorStop(0, 'rgba(255,90,20,0)'); g.addColorStop(0.5, 'rgba(255,200,90,' + a + ')'); g.addColorStop(1, 'rgba(255,90,20,0)');
      x.fillStyle = g; x.fillRect(X - w, Y - h / 2, w * 2, h);
      if (Math.random() < 0.8) burst('fire', X + (Math.random() - 0.5) * w * 2, Y, 1);
    } else if (f.type === 'water') {
      const w = S * (0.55 + 0.25 * Math.sin(p * Math.PI)), h = BH * Math.min(1, p * 3);
      const g = x.createLinearGradient(X - w / 2, 0, X + w / 2, 0); g.addColorStop(0, 'rgba(60,140,255,0)'); g.addColorStop(0.5, 'rgba(160,215,255,' + a + ')'); g.addColorStop(1, 'rgba(60,140,255,0)');
      x.fillStyle = g; x.beginPath();
      for (let yy = -h; yy <= h; yy += 8) x.lineTo(X - w / 2 + Math.sin(yy * 0.08 + T * 10) * 4, Y + yy);
      for (let yy = h; yy >= -h; yy -= 8) x.lineTo(X + w / 2 + Math.sin(yy * 0.08 + T * 10 + 1) * 4, Y + yy);
      x.fill();
      if (Math.random() < 0.7) burst('water', X, Y + (Math.random() - 0.5) * h * 2, 1);
    } else if (f.type === 'bolt') {
      x.lineJoin = 'round';
      for (const [w, c] of [[S * 0.22, 'rgba(170,120,255,' + a * 0.4 + ')'], [S * 0.07, 'rgba(255,250,210,' + a + ')']]) {
        x.strokeStyle = c; x.lineWidth = w; x.beginPath(); jagged(0, Y, BW, Y, 12, S * 0.18); jagged(X, 0, X, BH, 12, S * 0.18); x.stroke();
      }
    } else if (f.type === 'light') {
      const L2 = Math.max(BW, BH) * 1.5 * Math.min(1, p * 3);
      x.strokeStyle = 'rgba(255,245,200,' + a + ')'; x.lineCap = 'round';
      for (const [w, al] of [[S * 0.5, 0.25], [S * 0.16, 1]]) { x.globalAlpha = al; x.lineWidth = w; x.beginPath(); x.moveTo(X - L2, Y - L2); x.lineTo(X + L2, Y + L2); x.moveTo(X - L2, Y + L2); x.lineTo(X + L2, Y - L2); x.stroke(); }
      x.globalAlpha = 1;
      if (Math.random() < 0.6) { const d = (Math.random() - 0.5) * L2 * 1.4, s = Math.random() < 0.5 ? 1 : -1; burst('light', X + d, Y + d * s, 1); }
    } else if (f.type === 'leaf') {
      if (f.t < 0.05) for (let i = 0; i < 26; i++) burst('leaf', X + (Math.random() - 0.5) * S * 3, Y + (Math.random() - 0.5) * S * 3, 1);
      x.fillStyle = 'rgba(140,230,110,' + a * 0.35 + ')'; rr(x, X - S * 1.5 * (0.6 + p * 0.4), Y - S * 1.5 * (0.6 + p * 0.4), S * 3 * (0.6 + p * 0.4), S * 3 * (0.6 + p * 0.4), S * 0.3); x.fill();
    } else if (f.type === 'dark') {
      const r = S * 2.6 * (1 - p);
      const g = x.createRadialGradient(X, Y, 0, X, Y, S * 2.6); g.addColorStop(0, 'rgba(150,80,230,' + a * 0.6 + ')'); g.addColorStop(1, 'rgba(60,20,120,0)');
      x.fillStyle = g; x.beginPath(); x.arc(X, Y, S * 2.6, 0, PI2); x.fill();
      x.strokeStyle = 'rgba(210,170,255,' + a + ')'; x.lineWidth = 3; x.beginPath(); x.arc(X, Y, Math.max(1, r), 0, PI2); x.stroke();
      for (let i = 0; i < 4; i++) { const an = Math.random() * PI2, rr2 = S * (1 + Math.random() * 1.6); parts.push({ x: X + Math.cos(an) * rr2, y: Y + Math.sin(an) * rr2, vx: -Math.cos(an) * rr2 * 0.06, vy: -Math.sin(an) * rr2 * 0.06, g: 0, l: 1, d: 0.06, z: 2 * S / 50, c: '205,160,255', kind: 'dot' }); }
    } else if (f.type === 'heart') {
      x.strokeStyle = 'rgba(255,170,205,' + a + ')'; x.lineWidth = 4 * a + 1;
      SPR.heartPath(x, X, Y + S * 0.3 * p, S * (0.4 + p * 1.9)); x.stroke();
      if (f.t < 0.05) for (let i = 0; i < 14; i++) burst('heart', X, Y, 1);
    } else if (f.type === 'earth') {
      if (f.t < 0.05) { for (let i = 0; i < 18; i++) chips(X, Y, i % 2 ? '176,122,70' : '140,92,50', 1); }
      x.strokeStyle = 'rgba(230,170,100,' + a * 0.8 + ')'; x.lineWidth = S * 0.2;
      x.beginPath(); x.moveTo(X - S * 2.5 * Math.min(1, p * 3), Y); x.lineTo(X + S * 2.5 * Math.min(1, p * 3), Y); x.moveTo(X, Y - S * 2.5 * Math.min(1, p * 3)); x.lineTo(X, Y + S * 2.5 * Math.min(1, p * 3)); x.stroke();
    } else if (f.type === 'wind') {
      const tg = f.targets || [];
      for (const [r, c] of tg) {
        const [tx, ty] = cxy(r, c), q = Math.min(1, p * 2.2);
        const mx = (X + tx) / 2 + (ty - Y) * 0.3, my = (Y + ty) / 2 - (tx - X) * 0.3;
        const px = (1 - q) * (1 - q) * X + 2 * (1 - q) * q * mx + q * q * tx, py = (1 - q) * (1 - q) * Y + 2 * (1 - q) * q * my + q * q * ty;
        x.fillStyle = 'rgba(190,255,235,' + a + ')'; x.beginPath(); x.arc(px, py, S * 0.16, 0, PI2); x.fill();
        x.strokeStyle = 'rgba(170,255,230,' + a * 0.8 + ')'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, S * 0.3, T * 8, T * 8 + 4); x.stroke();
      }
    } else if (f.type === 'orb') {
      const tg = f.cells || [];
      x.lineCap = 'round';
      for (const [r, c] of tg) { const [tx, ty] = cxy(r, c); x.strokeStyle = 'rgba(255,255,255,' + a * 0.7 + ')'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(X, Y); x.lineTo(X + (tx - X) * Math.min(1, p * 3), Y + (ty - Y) * Math.min(1, p * 3)); x.stroke(); }
      const g = x.createRadialGradient(X, Y, 0, X, Y, S * 2); g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(X, Y, S * 2, 0, PI2); x.fill();
    }
  }
  x.restore();
}
function drawParts() {
  parts = parts.filter(p => p.l > 0);
  if (parts.length > 900) parts.splice(0, parts.length - 900);
  for (const p of parts) {
    p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.97; p.l -= p.d; if (p.vr) p.rot += p.vr;
    const a = Math.max(0, Math.min(1, p.l * 1.4));
    if (p.kind === 'dot' || p.kind === 'star' || p.kind === 'streak') {
      x.globalCompositeOperation = 'lighter';
      x.fillStyle = 'rgba(' + p.c + ',' + a * 0.85 + ')';
      if (p.kind === 'star') { const z = p.z * Math.sin(Math.max(0, p.l) * Math.PI); x.beginPath(); x.moveTo(p.x, p.y - z); x.lineTo(p.x + z * 0.25, p.y - z * 0.25); x.lineTo(p.x + z, p.y); x.lineTo(p.x + z * 0.25, p.y + z * 0.25); x.lineTo(p.x, p.y + z); x.lineTo(p.x - z * 0.25, p.y + z * 0.25); x.lineTo(p.x - z, p.y); x.lineTo(p.x - z * 0.25, p.y - z * 0.25); x.closePath(); x.fill(); }
      else if (p.kind === 'streak') { x.strokeStyle = 'rgba(' + p.c + ',' + a * 0.8 + ')'; x.lineWidth = 2; x.lineCap = 'round'; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x - p.vx * 4, p.y - p.vy * 4); x.stroke(); }
      else { x.beginPath(); x.arc(p.x, p.y, Math.max(0.5, p.z * p.l), 0, PI2); x.fill(); }
      x.globalCompositeOperation = 'source-over';
    } else {
      x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.globalAlpha = a;
      if (p.kind === 'leaf') { x.fillStyle = 'rgb(' + p.c + ')'; x.beginPath(); x.ellipse(0, 0, p.z * 1.6, p.z * 0.7, 0, 0, PI2); x.fill(); }
      else if (p.kind === 'heart') { x.fillStyle = 'rgb(' + p.c + ')'; SPR.heartPath(x, 0, 0, p.z); x.fill(); }
      else if (p.kind === 'shard') { x.fillStyle = 'rgba(' + p.c + ',0.9)'; x.beginPath(); x.moveTo(0, -p.z); x.lineTo(p.z * 0.6, p.z * 0.5); x.lineTo(-p.z * 0.5, p.z * 0.6); x.closePath(); x.fill(); }
      else { x.fillStyle = 'rgb(' + p.c + ')'; x.beginPath(); x.moveTo(-p.z, -p.z * 0.4); x.lineTo(0, -p.z); x.lineTo(p.z, -p.z * 0.2); x.lineTo(p.z * 0.5, p.z * 0.8); x.lineTo(-p.z * 0.6, p.z * 0.6); x.closePath(); x.fill(); }
      x.restore();
    }
  }
  x.globalAlpha = 1;
}
function drawTexts() {
  texts = texts.filter(t => t.l > 0);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  for (const t of texts) {
    t.l -= 0.016; t.y -= 0.5;
    const a = Math.min(1, t.l * 2.5), pop = t.l > 0.9 ? 1 + (t.l - 0.9) * 3 : 1;
    x.globalAlpha = a;
    x.font = Math.round(t.size * pop) + "px Jua, 'Apple SD Gothic Neo', sans-serif";
    x.strokeStyle = '#2A1A10'; x.lineWidth = Math.max(3, t.size * 0.18); x.strokeText(t.s, t.x, t.y);
    x.fillStyle = t.col; x.fillText(t.s, t.x, t.y);
  }
  x.globalAlpha = 1;
}

// ---------- loop ----------
let last = performance.now(), T0 = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; T0 += dt;
  if (G && phase !== 'none') {
    if (phase === 'bonus') bonusTick();
    else if (phase === 'resultWin') showResult(true);
    else if (phase === 'resultLose') showResult(false);
    if (G) { if (phase !== 'end' || dying.length || parts.length) step(dt); drawBoard(T0); if (scene.st.on) { scene.update(dt); scene.draw(); } }
  }
  for (const ic of iconCanvases) drawGoalIcon(ic.x, ic.g, T0);
  requestAnimationFrame(frame);
}
renderMap();
requestAnimationFrame(frame);
if (local) window.__pang = { get G() { return G; }, get phase() { return phase; }, startStage, showStart, LEVELS, trySwap, hint: () => G && E.hint(G) };
}
