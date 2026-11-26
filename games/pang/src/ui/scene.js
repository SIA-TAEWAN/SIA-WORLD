// 정령 마당: 보드 아래 빈 공간에 챕터 배경을 깔고 그 판의 정령들이 뛰어논다. 정령을 터뜨리면 같은 속성 정령이 능력을 쓴다
const PI2 = Math.PI * 2;
const R = Math.random;

function lerpCol(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function sky(x, W, H, top, bot) { const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bot); x.fillStyle = g; x.fillRect(0, 0, W, H); }
function hills(x, W, H, baseY, amp, col, seed, n) {
  x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
  for (let i = 0; i <= 40; i++) { const t = i / 40, X = t * W; const Y = baseY - amp * (0.55 + 0.45 * Math.sin(t * PI2 * (n || 1.3) + seed)) * (0.7 + 0.3 * Math.sin(t * 9 + seed * 2)); x.lineTo(X, Y); }
  x.lineTo(W, H); x.closePath(); x.fill();
}
function peaks(x, W, H, baseY, hgt, col, snow, seed, count) {
  const rnd = mul(seed);
  for (let i = 0; i < count; i++) {
    const cx = (i + 0.5) / count * W + (rnd() - 0.5) * W / count * 0.6, h = hgt * (0.7 + rnd() * 0.5), w = h * (1.1 + rnd() * 0.5);
    x.fillStyle = col; x.beginPath(); x.moveTo(cx - w, baseY); x.lineTo(cx, baseY - h); x.lineTo(cx + w, baseY); x.closePath(); x.fill();
    if (snow) { x.fillStyle = snow; x.beginPath(); x.moveTo(cx - w * 0.32, baseY - h * 0.68); x.lineTo(cx, baseY - h); x.lineTo(cx + w * 0.32, baseY - h * 0.68); x.lineTo(cx + w * 0.14, baseY - h * 0.6); x.lineTo(cx, baseY - h * 0.7); x.lineTo(cx - w * 0.15, baseY - h * 0.6); x.closePath(); x.fill(); }
  }
}
function mul(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function cloud(x, X, Y, s, col) { x.fillStyle = col; x.beginPath(); x.arc(X, Y, s, 0, PI2); x.arc(X + s * 0.9, Y + s * 0.2, s * 0.75, 0, PI2); x.arc(X - s * 0.9, Y + s * 0.25, s * 0.7, 0, PI2); x.arc(X + s * 0.3, Y - s * 0.45, s * 0.7, 0, PI2); x.fill(); }
function roundTree(x, X, gy, h, trunk, leaf, leaf2) {
  x.fillStyle = trunk; x.fillRect(X - h * 0.06, gy - h * 0.55, h * 0.12, h * 0.55);
  x.fillStyle = leaf; x.beginPath(); x.arc(X, gy - h * 0.7, h * 0.3, 0, PI2); x.arc(X - h * 0.2, gy - h * 0.55, h * 0.22, 0, PI2); x.arc(X + h * 0.2, gy - h * 0.55, h * 0.22, 0, PI2); x.fill();
  if (leaf2) { x.fillStyle = leaf2; x.beginPath(); x.arc(X - h * 0.08, gy - h * 0.8, h * 0.12, 0, PI2); x.fill(); }
}
function pine(x, X, gy, h, col, snow) {
  x.fillStyle = '#6A4A30'; x.fillRect(X - h * 0.05, gy - h * 0.18, h * 0.1, h * 0.18);
  for (let i = 0; i < 3; i++) {
    const y0 = gy - h * 0.15 - i * h * 0.25, w = h * (0.32 - i * 0.07);
    x.fillStyle = col; x.beginPath(); x.moveTo(X - w, y0); x.lineTo(X, y0 - h * 0.4); x.lineTo(X + w, y0); x.closePath(); x.fill();
    if (snow) { x.fillStyle = snow; x.beginPath(); x.moveTo(X - w * 0.45, y0 - h * 0.22); x.lineTo(X, y0 - h * 0.4); x.lineTo(X + w * 0.45, y0 - h * 0.22); x.quadraticCurveTo(X, y0 - h * 0.17, X - w * 0.45, y0 - h * 0.22); x.fill(); }
  }
}

// static background for chapter ch, drawn once into an offscreen canvas
function paintBg(x, ch, W, H, gy) {
  const rnd = mul(ch * 101 + 7);
  switch (ch) {
    case 0:
      sky(x, W, H, '#BFE8FF', '#EAF8DC');
      hills(x, W, H, gy - H * 0.22, H * 0.16, '#A8DB86', 1, 1.1);
      for (let i = 0; i < 7; i++) roundTree(x, (i + 0.3 + rnd() * 0.4) / 7 * W, gy - H * 0.04, H * (0.42 + rnd() * 0.2), '#8A5A34', i % 2 ? '#6CC05A' : '#5BB04D', '#8ED474');
      x.fillStyle = '#7CC08A'; x.fillRect(0, gy, W, H - gy);
      for (let i = 0; i < 30; i++) { x.fillStyle = ['#FFF4C2', '#FFB3C8', '#FFFFFF'][i % 3]; x.beginPath(); x.arc(rnd() * W, gy + 4 + rnd() * (H - gy - 6), 2.2, 0, PI2); x.fill(); }
      break;
    case 1:
      sky(x, W, H, '#CFEFFF', '#F4FBFF');
      peaks(x, W, H, gy - H * 0.1, H * 0.55, '#C9DFF2', '#FFFFFF', 11, 4);
      for (let i = 0; i < 9; i++) pine(x, (i + 0.2 + rnd() * 0.6) / 9 * W, gy - H * 0.08, H * (0.3 + rnd() * 0.15), '#4F8E9A', '#F4FAFF');
      x.fillStyle = '#F4FAFF'; x.fillRect(0, gy - H * 0.08, W, H);
      x.fillStyle = '#BDE9F7'; x.beginPath(); x.ellipse(W * 0.5, gy + (H - gy) * 0.45, W * 0.42, (H - gy) * 0.42 + H * 0.06, 0, 0, PI2); x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < 6; i++) { const X = W * (0.2 + rnd() * 0.6), Y = gy + (H - gy) * (0.2 + rnd() * 0.5); x.moveTo(X, Y); x.lineTo(X + 20 + rnd() * 30, Y - 4); }
      x.stroke();
      break;
    case 2:
      sky(x, W, H, '#FFE3B8', '#FFF4DD');
      hills(x, W, H, gy - H * 0.25, H * 0.2, '#D9A86C', 3, 0.9);
      hills(x, W, H, gy - H * 0.1, H * 0.12, '#C8935A', 5, 1.6);
      for (let i = 0; i < 6; i++) { const X = rnd() * W, s = H * (0.05 + rnd() * 0.05); x.fillStyle = '#A8743F'; x.beginPath(); x.ellipse(X, gy - s * 0.3, s * 1.4, s, 0, Math.PI, 0); x.fill(); x.fillStyle = 'rgba(255,240,210,0.4)'; x.beginPath(); x.ellipse(X - s * 0.4, gy - s * 0.8, s * 0.4, s * 0.18, -0.3, 0, PI2); x.fill(); }
      x.fillStyle = '#E2B77A'; x.fillRect(0, gy, W, H - gy);
      for (let i = 0; i < 18; i++) { x.fillStyle = 'rgba(150,100,50,0.35)'; x.beginPath(); x.ellipse(rnd() * W, gy + 5 + rnd() * (H - gy - 8), 4, 2, 0, 0, PI2); x.fill(); }
      break;
    case 3:
      sky(x, W, H, '#8FCBFF', '#E6F5FF');
      for (let i = 0; i < 5; i++) cloud(x, rnd() * W, H * (0.25 + rnd() * 0.25), H * (0.07 + rnd() * 0.05), 'rgba(255,255,255,0.75)');
      for (let i = 0; i < 9; i++) cloud(x, (i / 8) * W, gy + H * 0.04, H * 0.11, '#FFFFFF');
      x.fillStyle = '#FFFFFF'; x.fillRect(0, gy + H * 0.04, W, H);
      x.fillStyle = 'rgba(160,200,240,0.35)'; for (let i = 0; i < 8; i++) { x.beginPath(); x.ellipse(rnd() * W, gy + (H - gy) * 0.6, 26, 5, 0, 0, PI2); x.fill(); }
      break;
    case 4:
      sky(x, W, H, '#2E4A7A', '#5A7FB8');
      for (let i = 0; i < 14; i++) { const X = rnd() * W, h = H * (0.1 + rnd() * 0.22), w = 6 + rnd() * 8; x.fillStyle = i % 2 ? '#BFE8FF' : '#9FD9F5'; x.beginPath(); x.moveTo(X - w, 0); x.lineTo(X, h); x.lineTo(X + w, 0); x.closePath(); x.fill(); }
      x.fillStyle = '#6E93C8'; x.fillRect(0, gy, W, H - gy);
      for (let i = 0; i < 8; i++) { const X = rnd() * W, h = H * (0.08 + rnd() * 0.1); x.fillStyle = 'rgba(190,235,255,0.85)'; x.beginPath(); x.moveTo(X - 7, gy + 2); x.lineTo(X - 2, gy - h); x.lineTo(X + 6, gy + 2); x.closePath(); x.fill(); }
      break;
    case 5:
      sky(x, W, H, '#2F6B3A', '#6FB060');
      for (let i = 0; i < 8; i++) { const X = rnd() * W; x.fillStyle = 'rgba(30,70,30,0.5)'; x.beginPath(); x.ellipse(X, gy - H * 0.2, H * 0.25, H * 0.1, rnd() - 0.5, 0, PI2); x.fill(); }
      x.strokeStyle = '#2E6B24'; x.lineWidth = 3;
      for (let i = 0; i < 10; i++) { const X = rnd() * W, L = H * (0.25 + rnd() * 0.35); x.beginPath(); x.moveTo(X, 0); x.quadraticCurveTo(X + 14, L * 0.5, X - 4, L); x.stroke(); x.fillStyle = '#6FCB52'; for (let j = 1; j < 4; j++) { x.beginPath(); x.ellipse(X + 4, L * j / 4, 6, 3, 0.6, 0, PI2); x.fill(); } }
      x.fillStyle = '#4F8A3E'; x.fillRect(0, gy, W, H - gy);
      break;
    case 6:
      sky(x, W, H, '#4E517E', '#9294BE');
      peaks(x, W, H, gy, H * 0.65, '#3E3F63', null, 66, 3);
      for (let i = 0; i < 4; i++) cloud(x, rnd() * W, H * (0.12 + rnd() * 0.12), H * 0.09, 'rgba(70,70,110,0.9)');
      x.fillStyle = '#6E6A80'; x.fillRect(0, gy, W, H - gy);
      break;
    case 7:
      sky(x, W, H, '#FFF1C7', '#FFE08A');
      x.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(W * 0.5, -10); x.lineTo(W * (i / 5) - 30, gy); x.lineTo(W * (i / 5) + 10, gy); x.closePath(); x.fill(); }
      for (let i = 0; i < 6; i++) { const X = (i + 0.5) / 6 * W, w = Math.max(14, W * 0.035); x.fillStyle = '#FFF8E8'; x.fillRect(X - w / 2, gy - H * 0.55, w, H * 0.55); x.strokeStyle = '#C9A86A'; x.lineWidth = 2; x.strokeRect(X - w / 2, gy - H * 0.55, w, H * 0.55); x.fillStyle = '#F2DFB5'; x.fillRect(X - w * 0.8, gy - H * 0.6, w * 1.6, H * 0.06); }
      x.fillStyle = '#F2DFB5'; x.fillRect(0, gy - H * 0.64, W, H * 0.05);
      x.fillStyle = '#F5E6C8'; x.fillRect(0, gy, W, H - gy); x.fillStyle = '#E8D3A8'; x.fillRect(0, gy, W, 4);
      break;
    case 8:
      sky(x, W, H, '#1E1638', '#3A2A5E');
      x.fillStyle = '#FFF4C2'; x.beginPath(); x.arc(W * 0.8, H * 0.22, H * 0.09, 0, PI2); x.fill(); x.fillStyle = '#1E1638'; x.beginPath(); x.arc(W * 0.8 + H * 0.04, H * 0.2, H * 0.08, 0, PI2); x.fill();
      for (let i = 0; i < 30; i++) { x.fillStyle = 'rgba(255,255,255,' + (0.3 + rnd() * 0.6) + ')'; x.fillRect(rnd() * W, rnd() * H * 0.5, 1.5, 1.5); }
      for (let i = 0; i < 9; i++) { const X = (i + rnd()) / 9 * W, h = H * (0.5 + rnd() * 0.35); x.fillStyle = '#120E24'; x.fillRect(X - 4, gy - h * 0.5, 8, h * 0.5); x.beginPath(); x.moveTo(X - h * 0.2, gy - h * 0.35); x.lineTo(X, gy - h); x.lineTo(X + h * 0.2, gy - h * 0.35); x.closePath(); x.fill(); }
      x.fillStyle = '#2A2244'; x.fillRect(0, gy, W, H - gy);
      break;
    case 9:
      sky(x, W, H, '#5E4F9A', '#F2A6C8');
      for (let i = 0; i < 25; i++) { x.fillStyle = 'rgba(255,255,255,' + (0.4 + rnd() * 0.5) + ')'; x.fillRect(rnd() * W, rnd() * H * 0.45, 1.5, 1.5); }
      { const cx = W * 0.5, base = gy - H * 0.02, w = Math.min(W * 0.5, H * 1.4), hh = H * 0.42;
        x.fillStyle = '#4A3F7A'; x.fillRect(cx - w / 2, base - hh, w, hh);
        for (const [dx, th] of [[-0.5, 1.45], [-0.18, 1.7], [0.18, 1.7], [0.5, 1.45]]) { const tx = cx + dx * w, tw = w * 0.12; x.fillRect(tx - tw / 2, base - hh * th, tw, hh * th); x.beginPath(); x.moveTo(tx - tw * 0.7, base - hh * th); x.lineTo(tx, base - hh * th - tw * 1.3); x.lineTo(tx + tw * 0.7, base - hh * th); x.closePath(); x.fill(); x.fillStyle = '#FF7FA6'; x.fillRect(tx, base - hh * th - tw * 2, 1.5, tw * 0.8); x.beginPath(); x.moveTo(tx + 1.5, base - hh * th - tw * 2); x.lineTo(tx + tw * 0.6, base - hh * th - tw * 1.8); x.lineTo(tx + 1.5, base - hh * th - tw * 1.6); x.fill(); x.fillStyle = '#4A3F7A'; }
        x.fillStyle = '#FFD34D'; for (let i = 0; i < 6; i++) { x.fillRect(cx - w * 0.35 + i * w * 0.14, base - hh * 0.6, w * 0.04, hh * 0.15); }
        x.fillStyle = '#2E2550'; x.beginPath(); x.arc(cx, base, w * 0.08, Math.PI, 0); x.fill(); }
      x.fillStyle = '#5A4E8A'; x.fillRect(0, gy, W, H - gy);
      break;
  }
}

function create(canvas, PS) {
  const x = canvas.getContext('2d');
  const st = { ch: 0, kinds: [], W: 0, H: 0, dpr: 1, bg: null, actors: [], parts: [], fx: [], ambient: [], flowers: [], shake: 0, flash: 0, t: 0, on: false };

  function setup(ch, kinds) {
    st.ch = ch; st.kinds = kinds.slice(); st.parts = []; st.fx = []; st.flowers = []; st.ambient = [];
    st.actors = kinds.map((k, i) => ({ k, x: (i + 0.5) / kinds.length, y: 0, vy: 0, vx: (R() < 0.5 ? -1 : 1) * (0.03 + R() * 0.04), face: 1, pause: R() * 2, busy: 0, T: R() * 10, squash: 0 }));
    st.bg = null;
  }
  function resize(W, H) {
    st.dpr = window.devicePixelRatio || 1; st.W = W; st.H = H;
    canvas.width = Math.round(W * st.dpr); canvas.height = Math.round(H * st.dpr);
    st.bg = null;
  }
  function gy() { return st.H * 0.8; }
  function size() { return Math.max(0.55, Math.min(1.15, st.H / 190)); }
  function buildBg() {
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const bx = c.getContext('2d'); bx.scale(st.dpr, st.dpr); paintBg(bx, st.ch, st.W, st.H, gy()); st.bg = c;
  }
  function actorPos(a) { return [a.x * st.W, gy() - 20 * size() - a.y]; }

  function hop(a, v) { if (a.y <= 0.5) a.vy = v || (3 + R() * 1.5) * size(); }
  function ability(k, power) {
    const a = st.actors.find(q => q.k === k);
    if (!a) return;
    power = Math.min(12, power || 3);
    const [X, Y] = actorPos(a), s = size();
    a.busy = 0.6; a.squash = 1;
    const n = Math.round(8 + power * 2.5);
    const P = (o) => st.parts.push(Object.assign({ x: X, y: Y, vx: 0, vy: 0, g: 0, l: 1, d: 0.02, z: 3 * s, c: '255,255,255', kind: 'dot', rot: 0, vr: 0 }, o));
    switch (k) {
      case 'fire': hop(a, 2.5 * s); for (let i = 0; i < n; i++) P({ vx: a.face * (2.5 + R() * 3.5) * s, vy: (R() - 0.7) * 1.6 * s, g: -0.03, d: 0.022 + R() * 0.015, z: (3 + R() * 4) * s, c: R() < 0.5 ? '255,170,60' : '255,110,40' }); break;
      case 'water': for (let i = 0; i < n; i++) P({ vx: (R() - 0.5) * 2 * s, vy: -(4 + R() * 3.5) * s, g: 0.18 * s, d: 0.012, z: (2 + R() * 2.5) * s, c: '130,200,255', kind: 'drop' }); st.fx.push({ type: 'ripple', x: X, y: gy() + 4, t: 0, dur: 0.9 }); break;
      case 'wind': st.fx.push({ type: 'gust', x: X, y: Y, t: 0, dur: 1, dir: a.face }); for (const b of st.actors) if (b !== a) { b.vx += a.face * 0.08; hop(b, 2 * s); } for (let i = 0; i < n; i++) P({ x: X, y: Y - 20 * s + R() * 30 * s, vx: a.face * (4 + R() * 4) * s, vy: (R() - 0.5) * s, d: 0.02, c: '190,255,235', kind: 'streak' }); break;
      case 'bolt': st.fx.push({ type: 'bolt', x: X, y: Y, t: 0, dur: 0.35 }); st.flash = 0.35; hop(a, 3 * s); for (let i = 0; i < n; i++) { const an = R() * PI2, sp = (2 + R() * 3) * s; P({ vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, d: 0.04, z: 2 * s, c: '255,245,170' }); } break;
      case 'leaf': for (let i = 0; i < Math.min(8, 2 + power); i++) st.flowers.push({ x: X + (R() - 0.5) * 90 * s, t: 0, life: 6 + R() * 3, c: ['#FFB3C8', '#FFF4C2', '#FFFFFF', '#FFD34D'][i % 4], h: (8 + R() * 8) * s }); for (let i = 0; i < n; i++) P({ vx: (R() - 0.5) * 4 * s, vy: -(1 + R() * 3) * s, g: 0.05, d: 0.012, z: (3 + R() * 2) * s, c: '120,210,90', kind: 'leaf', rot: R() * 6, vr: (R() - 0.5) * 0.3 }); break;
      case 'earth': hop(a, 4.2 * s); a.stomp = true; break;
      case 'light': st.fx.push({ type: 'ring', x: X, y: Y, t: 0, dur: 0.8 }); for (let i = 0; i < n; i++) { const an = R() * PI2, r = (15 + R() * 60) * s; P({ x: X + Math.cos(an) * r, y: Y + Math.sin(an) * r * 0.6, vy: -0.3 * s, d: 0.025, z: (4 + R() * 4) * s, c: '255,245,200', kind: 'star' }); } break;
      case 'dark': st.fx.push({ type: 'hole', x: X, y: Y - 40 * s, t: 0, dur: 1.1 }); for (let i = 0; i < n * 1.5; i++) { const an = R() * PI2, r = (40 + R() * 80) * s; P({ x: X + Math.cos(an) * r, y: Y - 40 * s + Math.sin(an) * r * 0.6, vx: -Math.cos(an) * r * 0.035, vy: -Math.sin(an) * r * 0.021, d: 0.03, z: 2 * s, c: '205,160,255' }); } break;
      case 'heart': hop(a, 3 * s); for (const b of st.actors) { if (b === a) continue; const [bx, by] = actorPos(b); P({ vx: (bx - X) / 45, vy: (by - Y) / 45 - 2.2 * s, g: 0.1 * s, d: 0.022, z: 5 * s, c: '255,140,185', kind: 'heart', target: b }); } for (let i = 0; i < n * 0.5; i++) P({ vx: (R() - 0.5) * 2 * s, vy: -(1 + R() * 2) * s, d: 0.015, z: (3 + R() * 3) * s, c: '255,160,200', kind: 'heart' }); break;
    }
  }
  /** 정령 마당을 누르면 (W·H 안의 좌표) 가장 가까운 정령이 고유 스킬을 쓴다. 너무 자주는 안 되게 정령마다 0.5초 쉼. 쓴 정령 kind 또는 null */
  function tap(px, py) {
    const s = size(), reach = 44 * s;
    let best = null, bd = Infinity;
    for (const a of st.actors) { const [X, Y] = actorPos(a), d = Math.hypot(px - X, py - Y); if (d < bd) { bd = d; best = a; } }
    if (!best || bd > reach) return null;
    const now = st.t;
    if (best.tapAt && now - best.tapAt < 0.5) return null;
    best.tapAt = now;
    ability(best.k, 6);
    return best.k;
  }
  function cheer() { for (const a of st.actors) hop(a, (3 + R() * 2) * size()); }

  function update(dt) {
    const s = size(), k = dt * 60;
    st.t += dt;
    for (const a of st.actors) {
      a.T += dt;
      if (a.busy > 0) a.busy -= dt;
      if (a.pause > 0) a.pause -= dt;
      else {
        a.x += a.vx * dt * 0.3 * (st.W > 0 ? 400 / st.W : 1);
        if (a.x < 0.07) { a.x = 0.07; a.vx = Math.abs(a.vx); } if (a.x > 0.93) { a.x = 0.93; a.vx = -Math.abs(a.vx); }
        if (R() < 0.006) { a.pause = 0.8 + R() * 1.8; }
        if (R() < 0.012) hop(a, (2 + R() * 1.5) * s);
        if (R() < 0.004) a.vx = -a.vx;
      }
      a.vx = Math.sign(a.vx || 1) * Math.min(0.2, Math.max(0.03, Math.abs(a.vx) * (1 - 0.01 * k)));
      if (Math.abs(a.vx) > 0.001) a.face = Math.sign(a.vx);
      if (a.y > 0 || a.vy > 0) { a.y += a.vy * k; a.vy -= 0.25 * s * k; if (a.y <= 0) { a.y = 0; a.vy = 0; a.squash = Math.max(a.squash, 0.6); if (a.stomp) { a.stomp = false; land(a); } } }
      if (a.squash > 0) a.squash = Math.max(0, a.squash - 0.08 * k);
    }
    // ambient
    const ch = st.ch;
    if ((ch === 1 || ch === 4) && R() < 0.5) st.ambient.push({ x: R() * st.W, y: -4, vx: (R() - 0.5) * 0.4, vy: 0.5 + R() * 0.8, z: 1 + R() * 2, l: 1, c: '255,255,255', kind: 'snow' });
    if ((ch === 0 || ch === 5) && R() < 0.04) st.ambient.push({ x: R() * st.W, y: -6, vx: 0.3 + R() * 0.4, vy: 0.4 + R() * 0.4, z: 3 + R() * 2, l: 1, c: ch ? '111,203,82' : '140,210,100', kind: 'leaf', rot: R() * 6 });
    if (ch === 8 && R() < 0.06) st.ambient.push({ x: R() * st.W, y: gy() - R() * st.H * 0.5, vx: (R() - 0.5) * 0.5, vy: (R() - 0.5) * 0.3, z: 2, l: 1, c: '220,255,120', kind: 'fly', ph: R() * 6 });
    if (ch === 7 && R() < 0.08) st.ambient.push({ x: R() * st.W, y: R() * gy(), vx: 0, vy: -0.2, z: 2 + R() * 2, l: 1, c: '255,250,220', kind: 'twinkle' });
    if (ch === 3 && R() < 0.01) st.ambient.push({ x: -60, y: st.H * (0.15 + R() * 0.3), vx: 0.3 + R() * 0.3, vy: 0, z: st.H * 0.07, l: 1, kind: 'cloud' });
    if (ch === 6 && R() < 0.003) { st.flash = 0.25; st.fx.push({ type: 'bolt', x: R() * st.W, y: gy() - st.H * 0.3, t: 0, dur: 0.25, far: true }); }
    if (ch === 9 && R() < 0.05) st.ambient.push({ x: R() * st.W, y: -4, vx: (R() - 0.5) * 0.3, vy: 0.4 + R() * 0.4, z: 3, l: 1, c: '255,180,210', kind: 'petal', rot: R() * 6 });
    for (const p of st.ambient) {
      p.x += p.vx * k; p.y += p.vy * k;
      if (p.kind === 'fly') { p.ph += dt * 3; p.x += Math.sin(p.ph) * 0.4; p.l -= 0.004 * k; }
      else if (p.kind === 'twinkle') p.l -= 0.012 * k;
      else if (p.y > gy() + 6 || p.x > st.W + 80) p.l = 0;
      if (p.rot != null) p.rot += 0.03 * k;
    }
    st.ambient = st.ambient.filter(p => p.l > 0).slice(-220);
    for (const p of st.parts) {
      p.vy += p.g * k; p.x += p.vx * k; p.y += p.vy * k; p.l -= p.d * k; if (p.vr) p.rot += p.vr * k;
      if (p.kind === 'drop' && p.y > gy() + 3) { p.l = 0; if (R() < 0.3) st.fx.push({ type: 'ripple', x: p.x, y: gy() + 4, t: 0, dur: 0.5, small: true }); }
      if (p.kind === 'heart' && p.target && p.l < 0.25 && !p.hit) { p.hit = true; hop(p.target, 3 * size()); }
    }
    st.parts = st.parts.filter(p => p.l > 0).slice(-500);
    for (const f of st.fx) f.t += dt;
    st.fx = st.fx.filter(f => f.t < f.dur);
    for (const f of st.flowers) f.t += dt;
    st.flowers = st.flowers.filter(f => f.t < f.life).slice(-30);
    if (st.shake > 0.3) st.shake *= Math.pow(0.86, k); else st.shake = 0;
    if (st.flash > 0) st.flash -= dt;
  }
  function land(a) {
    const s = size(), [X] = actorPos(a);
    st.shake = 9; st.fx.push({ type: 'quake', x: X, y: gy(), t: 0, dur: 0.6 });
    for (let i = 0; i < 16; i++) st.parts.push({ x: X + (R() - 0.5) * 30 * s, y: gy(), vx: (R() - 0.5) * 5 * s, vy: -(2 + R() * 4) * s, g: 0.22 * s, l: 1, d: 0.02, z: (2 + R() * 3) * s, c: R() < 0.5 ? '176,122,70' : '140,92,50', kind: 'rock', rot: R() * 6, vr: (R() - 0.5) * 0.3 });
    for (let i = 0; i < 6; i++) st.parts.push({ x: X + (R() - 0.5) * 50 * s, y: gy() - 4, vx: (R() - 0.5) * 1.5, vy: -0.3, g: 0, l: 1, d: 0.015, z: (8 + R() * 8) * s, c: '200,170,130', kind: 'dust' });
    for (const b of st.actors) if (b !== a) hop(b, 2.5 * s);
  }

  function draw() {
    if (!st.on || !st.W) return;
    if (!st.bg) buildBg();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, canvas.width, canvas.height);
    x.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    if (st.shake) x.translate((R() - 0.5) * st.shake, (R() - 0.5) * st.shake * 0.5);
    x.drawImage(st.bg, 0, 0, st.W, st.H);
    const s = size(), G0 = gy();
    for (const p of st.ambient) {
      x.globalAlpha = Math.min(1, p.l * 2);
      if (p.kind === 'snow') { x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(p.x, p.y, p.z, 0, PI2); x.fill(); }
      else if (p.kind === 'leaf' || p.kind === 'petal') { x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.fillStyle = 'rgb(' + p.c + ')'; x.beginPath(); x.ellipse(0, 0, p.z * 1.5, p.z * 0.6, 0, 0, PI2); x.fill(); x.restore(); }
      else if (p.kind === 'fly') { x.globalCompositeOperation = 'lighter'; const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7); g.addColorStop(0, 'rgba(230,255,140,0.9)'); g.addColorStop(1, 'rgba(230,255,140,0)'); x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, 7, 0, PI2); x.fill(); x.globalCompositeOperation = 'source-over'; }
      else if (p.kind === 'twinkle') { x.fillStyle = 'rgba(255,255,255,' + Math.sin(p.l * Math.PI) + ')'; star4(p.x, p.y, p.z * 1.5); }
      else if (p.kind === 'cloud') { cloud(x, p.x, p.y, p.z, 'rgba(255,255,255,0.8)'); }
    }
    x.globalAlpha = 1;
    for (const f of st.flowers) {
      const g = Math.min(1, f.t * 3), fade = Math.min(1, (f.life - f.t) * 1.5);
      x.globalAlpha = fade; x.strokeStyle = '#4E9A3A'; x.lineWidth = 2; x.beginPath(); x.moveTo(f.x, G0 + 2); x.lineTo(f.x, G0 + 2 - f.h * g); x.stroke();
      x.fillStyle = f.c; for (let i = 0; i < 5; i++) { const an = i / 5 * PI2 + f.t; x.beginPath(); x.arc(f.x + Math.cos(an) * 3.5 * g * s, G0 + 2 - f.h * g + Math.sin(an) * 3.5 * g * s, 2.6 * g * s, 0, PI2); x.fill(); }
      x.fillStyle = '#FFD34D'; x.beginPath(); x.arc(f.x, G0 + 2 - f.h * g, 2 * g * s, 0, PI2); x.fill();
    }
    x.globalAlpha = 1;
    // fx behind actors
    for (const f of st.fx) {
      const p = f.t / f.dur, a = 1 - p;
      if (f.type === 'ripple') { x.strokeStyle = 'rgba(200,235,255,' + a + ')'; x.lineWidth = 2; x.beginPath(); x.ellipse(f.x, f.y, (f.small ? 8 : 20) + p * (f.small ? 14 : 50), (f.small ? 2 : 5) + p * (f.small ? 3 : 10), 0, 0, PI2); x.stroke(); }
      if (f.type === 'quake') { x.strokeStyle = 'rgba(90,58,30,' + a + ')'; x.lineWidth = 2.5; x.beginPath(); for (const d of [-1, 1]) { x.moveTo(f.x, f.y); x.lineTo(f.x + d * 20 * s, f.y + 5); x.lineTo(f.x + d * 40 * s * Math.min(1, p * 3), f.y + 2); } x.stroke(); }
      if (f.type === 'hole') { const r = 30 * s * (1 - p * 0.5); const g = x.createRadialGradient(f.x, f.y, 0, f.x, f.y, r * 1.8); g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(0.45, 'rgba(60,20,110,' + a * 0.8 + ')'); g.addColorStop(1, 'rgba(120,60,200,0)'); x.fillStyle = g; x.beginPath(); x.arc(f.x, f.y, r * 1.8, 0, PI2); x.fill(); x.strokeStyle = 'rgba(200,160,255,' + a + ')'; x.lineWidth = 2; x.beginPath(); x.arc(f.x, f.y, r, f.t * 8, f.t * 8 + 4.5); x.stroke(); }
      if (f.type === 'ring') { x.globalCompositeOperation = 'lighter'; x.strokeStyle = 'rgba(255,240,190,' + a + ')'; x.lineWidth = 4 * a + 1; x.beginPath(); x.arc(f.x, f.y, 10 + p * 90 * s, 0, PI2); x.stroke(); x.globalCompositeOperation = 'source-over'; }
      if (f.type === 'gust') { x.strokeStyle = 'rgba(200,255,240,' + a * 0.8 + ')'; x.lineWidth = 2; x.lineCap = 'round'; for (let i = 0; i < 4; i++) { const yy = f.y - 30 * s + i * 14 * s, x0 = f.x + f.dir * p * st.W * 0.8; x.beginPath(); x.moveTo(x0 - f.dir * 60 * s, yy); x.quadraticCurveTo(x0, yy - 8, x0 + f.dir * 30 * s, yy + 4); x.stroke(); x.beginPath(); x.arc(x0 + f.dir * 30 * s, yy - 4, 6 * s, 0, 4); x.stroke(); } }
    }
    // actors
    for (const a of st.actors) {
      const [X, Y] = actorPos(a);
      x.fillStyle = 'rgba(0,0,0,' + (0.18 - Math.min(0.12, a.y / 400)) + ')'; x.beginPath(); x.ellipse(X, G0 + 2, 16 * s * (1 - Math.min(0.5, a.y / 200)), 4 * s, 0, 0, PI2); x.fill();
      const sq = Math.sin(a.squash * Math.PI) * 0.15;
      const bob = a.y <= 0 && a.pause <= 0 ? Math.abs(Math.sin(a.T * 9)) * 2.5 * s : 0;
      x.save(); x.translate(X, Y - bob + sq * 16 * s); x.scale(s * (1 + sq) * 0.95, s * (1 - sq) * 0.95);
      if (a.busy > 0) { x.globalCompositeOperation = 'lighter'; const gl = x.createRadialGradient(0, 0, 0, 0, 0, 40); gl.addColorStop(0, 'rgba(' + PS.PC[a.k] + ',' + Math.min(0.7, a.busy) + ')'); gl.addColorStop(1, 'rgba(' + PS.PC[a.k] + ',0)'); x.fillStyle = gl; x.beginPath(); x.arc(0, 0, 40, 0, PI2); x.fill(); x.globalCompositeOperation = 'source-over'; }
      PS.draw(x, a.k, a.T * (a.busy > 0 ? 1.6 : 1), null, [a.face * 2.5, 0]);
      x.restore();
    }
    // fx in front
    for (const f of st.fx) {
      const p = f.t / f.dur, a = 1 - p;
      if (f.type === 'bolt') {
        x.globalCompositeOperation = 'lighter'; x.lineJoin = 'round';
        for (const [w, c] of [[f.far ? 5 : 9, 'rgba(170,120,255,' + a * 0.45 + ')'], [f.far ? 1.5 : 3, 'rgba(255,250,210,' + a + ')']]) {
          x.strokeStyle = c; x.lineWidth = w; x.beginPath(); let px = f.x + (R() - 0.5) * 30, py = 0; x.moveTo(px, py);
          const steps = 8; for (let i = 1; i <= steps; i++) { py = f.y * i / steps; px = f.x + (i === steps ? 0 : (R() - 0.5) * 26); x.lineTo(px, py); }
          x.stroke();
        }
        x.globalCompositeOperation = 'source-over';
      }
    }
    for (const p of st.parts) {
      const a = Math.max(0, Math.min(1, p.l * 1.5));
      if (p.kind === 'dot' || p.kind === 'streak' || p.kind === 'star') {
        x.globalCompositeOperation = 'lighter';
        if (p.kind === 'streak') { x.strokeStyle = 'rgba(' + p.c + ',' + a * 0.8 + ')'; x.lineWidth = 2; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x - p.vx * 5, p.y - p.vy * 5); x.stroke(); }
        else if (p.kind === 'star') { x.fillStyle = 'rgba(' + p.c + ',' + Math.sin(Math.max(0, p.l) * Math.PI) + ')'; star4(p.x, p.y, p.z); }
        else { x.fillStyle = 'rgba(' + p.c + ',' + a * 0.85 + ')'; x.beginPath(); x.arc(p.x, p.y, Math.max(0.5, p.z * p.l), 0, PI2); x.fill(); }
        x.globalCompositeOperation = 'source-over';
      } else {
        x.save(); x.globalAlpha = a; x.translate(p.x, p.y); x.rotate(p.rot || 0);
        if (p.kind === 'drop') { x.fillStyle = 'rgba(' + p.c + ',0.9)'; x.beginPath(); x.arc(0, 0, p.z, 0, PI2); x.fill(); }
        else if (p.kind === 'leaf') { x.fillStyle = 'rgb(' + p.c + ')'; x.beginPath(); x.ellipse(0, 0, p.z * 1.6, p.z * 0.7, 0, 0, PI2); x.fill(); }
        else if (p.kind === 'heart') { x.fillStyle = 'rgb(' + p.c + ')'; PS.heartPath(x, 0, 0, p.z); x.fill(); }
        else if (p.kind === 'dust') { x.globalAlpha = a * 0.45; x.fillStyle = 'rgb(' + p.c + ')'; x.beginPath(); x.arc(0, 0, p.z * (1.5 - p.l * 0.5), 0, PI2); x.fill(); }
        else { x.fillStyle = 'rgb(' + p.c + ')'; x.beginPath(); x.moveTo(-p.z, -p.z * 0.4); x.lineTo(0, -p.z); x.lineTo(p.z, -p.z * 0.2); x.lineTo(p.z * 0.5, p.z * 0.8); x.lineTo(-p.z * 0.6, p.z * 0.6); x.closePath(); x.fill(); }
        x.restore();
      }
    }
    if (st.flash > 0) { x.fillStyle = 'rgba(255,255,240,' + Math.min(0.5, st.flash) + ')'; x.fillRect(0, 0, st.W, st.H); }
  }
  function star4(X, Y, z) { x.beginPath(); x.moveTo(X, Y - z); x.lineTo(X + z * 0.25, Y - z * 0.25); x.lineTo(X + z, Y); x.lineTo(X + z * 0.25, Y + z * 0.25); x.lineTo(X, Y + z); x.lineTo(X - z * 0.25, Y + z * 0.25); x.lineTo(X - z, Y); x.lineTo(X - z * 0.25, Y - z * 0.25); x.closePath(); x.fill(); }

  return { st, setup, resize, update, draw, ability, cheer, tap };
}
export { create };
export default { create };
