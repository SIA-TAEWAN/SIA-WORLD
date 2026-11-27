// games/block(시아블록)도 이 파일을 그대로 import 한다 — export 를 바꾸면 block 빌드도 확인할 것
// 정령 9종 그리기 (코드로만 그린다 · 몸 반지름 약 20). 강화 정령('line')·정령왕 구슬('orb') 모양도 여기
const PI2 = Math.PI * 2;
const EYE = { fire: '#4A1A00', water: '#0B2A55', wind: '#1E4A44', bolt: '#3A2266', leaf: '#1F4A17', earth: '#2A1A10', light: '#7A5A10', dark: '#E9D5FF', heart: '#6B1F3A', orb: '#5A4A7A' };
const PC = { fire: '255,150,50', water: '110,185,255', wind: '170,255,230', bolt: '255,240,150', leaf: '120,220,90', earth: '190,135,80', light: '255,245,200', dark: '190,140,255', heart: '255,130,180', orb: '255,255,255' };
const ROCK = [[30, 2], [24, 19], [9, 28], [-10, 27], [-25, 17], [-31, 0], [-24, -18], [-9, -27], [10, -28], [25, -18]];

function rg(x, r, stops, cx, cy) {
  const g = x.createRadialGradient(cx || 0, cy || 0, 0, 0, 0, r);
  stops.forEach((s, i) => g.addColorStop(s[0], s[1]));
  return g;
}
function disc(x, r, stops) { x.fillStyle = rg(x, r, stops); x.beginPath(); x.arc(0, 0, r, 0, PI2); x.fill(); }
function heartPath(x, cx, cy, s) {
  x.beginPath(); x.moveTo(cx, cy + s * 0.9);
  x.bezierCurveTo(cx - s * 1.3, cy + s * 0.1, cx - s * 0.95, cy - s * 1.05, cx, cy - s * 0.42);
  x.bezierCurveTo(cx + s * 0.95, cy - s * 1.05, cx + s * 1.3, cy + s * 0.1, cx, cy + s * 0.9); x.closePath();
}

// draws a spirit centred at origin, body radius ~20 units
function draw(x, k, T, sp, look) {
  const lx = look ? look[0] : 0, ly = look ? look[1] : 0;
  x.save();
  x.globalCompositeOperation = 'lighter';
  if (sp === 'line') {
    const p = 0.5 + 0.5 * Math.sin(T * 6);
    disc(x, 30, [[0, 'rgba(' + PC[k] + ',' + (0.35 + p * 0.25) + ')'], [1, 'rgba(' + PC[k] + ',0)']]);
  }
  let eyeY = -1, eyeGap = 6.5;
  if (k === 'fire') {
    for (let i = -1; i <= 1; i++) {
      const h = 14 + 5 * Math.sin(T * 9 + i * 2), bx = i * 7;
      x.fillStyle = 'rgba(255,160,50,0.55)';
      x.beginPath(); x.moveTo(bx - 5, -4); x.quadraticCurveTo(bx - 3, -h * 0.6, bx + Math.sin(T * 7 + i) * 2, -h - 6); x.quadraticCurveTo(bx + 3, -h * 0.6, bx + 5, -4); x.fill();
    }
    disc(x, 21, [[0, 'rgba(255,255,230,1)'], [0.4, 'rgba(255,190,70,0.85)'], [1, 'rgba(255,100,30,0)']]);
  } else if (k === 'water') {
    x.globalCompositeOperation = 'source-over';
    disc(x, 27, [[0, 'rgba(80,160,255,0.3)'], [0.4, 'rgba(80,160,255,0.12)'], [1, 'rgba(80,160,255,0)']]);
    x.beginPath();
    for (let i = 0; i <= 24; i++) { const th = i / 24 * PI2, r = 22 * (1 + 0.06 * Math.sin(3 * th + T * 3) + 0.04 * Math.sin(5 * th - T * 2)); i ? x.lineTo(Math.cos(th) * r, Math.sin(th) * r) : x.moveTo(r, 0); }
    x.closePath(); x.fillStyle = rg(x, 22, [[0, 'rgba(170,220,255,0.95)'], [0.5, 'rgba(100,180,255,0.75)'], [1, 'rgba(80,160,255,0)']]); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.45)'; x.beginPath(); x.ellipse(-6, -8, 4.5, 2.5, -0.5, 0, PI2); x.fill();
  } else if (k === 'wind') {
    // 살랑이는 바람: 물결 모양 바람결 세 줄이 왼쪽에서 오른쪽으로 흘러가며 나타났다 사라지고, 몸은 좌우로 살짝 기울어진다 (도는 모양 없음 — 강화 정령의 도는 고리와 헷갈리지 않게)
    x.rotate(Math.sin(T * 1.8) * 0.09);
    x.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const ph = (T * 0.55 + i * 0.33) % 1, y0 = -11 + i * 11 + (i === 1 ? 0 : Math.sin(T * 1.3 + i) * 1.2);
      const x0 = -28 + ph * 14, len = 28 + (i === 1 ? 6 : 0);
      x.strokeStyle = 'rgba(190,255,235,' + (Math.sin(ph * Math.PI) * 0.75).toFixed(3) + ')';
      x.lineWidth = i === 1 ? 2.4 : 1.7;
      x.beginPath();
      for (let s = 0; s <= 14; s++) { const u = s / 14, X = x0 + u * len, Y = y0 + Math.sin(u * 5.5 - T * 4 + i * 1.7) * 2.4 * Math.sin(u * Math.PI); s ? x.lineTo(X, Y) : x.moveTo(X, Y); }
      if (i === 1) { const ex = x0 + len; x.quadraticCurveTo(ex + 6, y0 - 1, ex + 4, y0 - 5); x.quadraticCurveTo(ex + 1, y0 - 7, ex - 1, y0 - 4); }
      x.stroke();
    }
    disc(x, 19, [[0, 'rgba(240,255,250,1)'], [0.4, 'rgba(160,255,225,0.6)'], [1, 'rgba(100,220,200,0)']]);
  } else if (k === 'bolt') {
    const f = 0.92 + 0.16 * Math.abs(Math.sin(T * 23) * Math.sin(T * 7));
    disc(x, 22 * f, [[0, 'rgba(255,255,240,0.9)'], [0.35, 'rgba(255,235,130,0.7)'], [1, 'rgba(170,110,255,0)']]);
    x.save(); x.scale(f, f);
    const pts = [[5, -19], [-11, 3], [-1.5, 3], [-6, 19], [12, -5], [2, -5], [8, -19]];
    x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath();
    x.lineJoin = 'round'; x.strokeStyle = 'rgba(180,130,255,0.55)'; x.lineWidth = 5; x.stroke();
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = 'rgba(255,248,190,0.97)'; x.fill();
    x.strokeStyle = 'rgba(255,210,60,0.9)'; x.lineWidth = 1.6; x.stroke();
    x.restore();
    x.globalCompositeOperation = 'lighter';
    const ph = Math.floor(T * 5) % 7;
    if (ph === 0 || ph === 3) {
      const a = (Math.floor(T * 5) * 2.4) % PI2;
      x.strokeStyle = 'rgba(255,250,210,0.9)'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(Math.cos(a) * 14, Math.sin(a) * 14);
      x.lineTo(Math.cos(a + 0.25) * 20, Math.sin(a + 0.25) * 20); x.lineTo(Math.cos(a - 0.1) * 25, Math.sin(a - 0.1) * 25); x.stroke();
    }
    eyeY = -2; eyeGap = 8;
  } else if (k === 'leaf') {
    disc(x, 20, [[0, 'rgba(230,255,200,1)'], [0.4, 'rgba(130,220,100,0.85)'], [1, 'rgba(60,160,60,0)']]);
    x.globalCompositeOperation = 'source-over';
    x.strokeStyle = '#5FAE4E'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, -12); x.lineTo(0, -19); x.stroke();
    x.fillStyle = '#7BD36A'; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(s * 5, -20, 5, 2.5, s * 0.6, 0, PI2); x.fill(); }
    const a = T * 1.5;
    x.save(); x.translate(Math.cos(a) * 20, Math.sin(a) * 8); x.rotate(a); x.fillStyle = 'rgba(120,210,90,0.9)'; x.beginPath(); x.ellipse(0, 0, 5, 2.2, 0, 0, PI2); x.fill(); x.restore();
  } else if (k === 'earth') {
    disc(x, 30, [[0, 'rgba(230,160,80,0.25)'], [1, 'rgba(230,160,80,0)']]);
    x.globalCompositeOperation = 'source-over';
    const bob = Math.sin(T * 1.3) * 0.6;
    const orb = [0, 1].map(i => { const a = T * 1.2 + i * Math.PI; return { a, X: Math.cos(a) * 25, Y: Math.sin(a) * 7 + 5 }; });
    const stone = (o, i) => { x.save(); x.translate(o.X, o.Y); x.rotate(o.a * 1.5); x.fillStyle = i ? 'rgba(176,122,70,0.9)' : 'rgba(140,92,50,0.9)'; x.beginPath(); x.moveTo(-4, -2); x.lineTo(-1, -4); x.lineTo(4, -1.5); x.lineTo(3, 3.5); x.lineTo(-3, 3.5); x.closePath(); x.fill(); x.restore(); };
    orb.forEach((o, i) => { if (Math.sin(o.a) < 0) stone(o, i); });
    x.save(); x.translate(0, bob); x.scale(0.72, 0.72);
    x.beginPath(); ROCK.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath();
    x.fillStyle = rg(x, 33, [[0, 'rgba(214,160,100,1)'], [0.55, 'rgba(160,108,60,0.95)'], [0.82, 'rgba(122,78,40,0.55)'], [1, 'rgba(110,70,36,0)']], -6, -8); x.fill();
    x.fillStyle = 'rgba(124,184,90,0.75)'; x.beginPath(); x.ellipse(-7, -24, 11, 4.5, -0.2, 0, PI2); x.fill(); x.beginPath(); x.ellipse(8, -25, 6, 3.5, 0.3, 0, PI2); x.fill();
    x.strokeStyle = 'rgba(70,40,18,0.45)'; x.lineWidth = 2; x.lineCap = 'round';
    x.beginPath(); x.moveTo(17, -12); x.lineTo(11, -5); x.lineTo(16, 3); x.moveTo(-20, 8); x.lineTo(-13, 14); x.stroke();
    x.fillStyle = 'rgba(255,235,200,0.35)'; x.beginPath(); x.ellipse(-13, -12, 6, 3.5, -0.6, 0, PI2); x.fill();
    x.restore();
    orb.forEach((o, i) => { if (Math.sin(o.a) >= 0) stone(o, i); });
    eyeY = -1 + bob;
  } else if (k === 'light') {
    for (let i = 0; i < 6; i++) {
      const a = T * 0.6 + i * Math.PI / 3, L = 24 + 4 * Math.sin(T * 2 + i);
      x.fillStyle = 'rgba(255,240,180,0.16)'; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a - 0.12) * L, Math.sin(a - 0.12) * L); x.lineTo(Math.cos(a + 0.12) * L, Math.sin(a + 0.12) * L); x.closePath(); x.fill();
    }
    disc(x, 19, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,245,200,0.9)'], [1, 'rgba(255,220,130,0)']]);
  } else if (k === 'dark') {
    disc(x, 27, [[0, 'rgba(110,50,180,0.45)'], [0.4, 'rgba(90,40,160,0.2)'], [1, 'rgba(60,20,120,0)']]);
    for (let i = 0; i < 3; i++) { const a = T * 2 + i * 2.09, r = 22 - ((T * 14 + i * 5) % 14); x.fillStyle = 'rgba(205,160,255,0.8)'; x.beginPath(); x.arc(Math.cos(a) * r, Math.sin(a) * r * 0.7, 1.6, 0, PI2); x.fill(); }
    x.globalCompositeOperation = 'source-over';
    disc(x, 18, [[0, 'rgba(0,0,0,1)'], [0.4, 'rgba(18,6,36,0.95)'], [1, 'rgba(90,40,150,0)']]);
  } else if (k === 'heart') {
    const ph = (T * 1.25) % 1, beat = Math.exp(-Math.pow((ph - 0.1) / 0.05, 2)) + 0.6 * Math.exp(-Math.pow((ph - 0.28) / 0.05, 2));
    const s = 15 * (1 + beat * 0.08);
    disc(x, 30, [[0, 'rgba(255,110,170,0.4)'], [1, 'rgba(255,110,170,0)']]);
    x.globalCompositeOperation = 'source-over';
    heartPath(x, 0, 1, s);
    x.fillStyle = rg(x, s * 1.35, [[0, 'rgba(255,236,244,1)'], [0.45, 'rgba(255,135,182,0.95)'], [0.78, 'rgba(255,95,155,0.5)'], [1, 'rgba(255,80,145,0)']], -3, -4); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.5)'; x.beginPath(); x.ellipse(-8, -8, 3.5, 2, -0.7, 0, PI2); x.fill();
    x.fillStyle = 'rgba(255,90,140,0.5)'; for (const sd of [-1, 1]) { x.beginPath(); x.ellipse(sd * 10, 4, 3, 1.8, 0, 0, PI2); x.fill(); }
    const fp = (T * 0.6) % 1;
    x.globalAlpha = Math.sin(fp * Math.PI) * 0.9; x.fillStyle = 'rgba(255,160,200,1)'; heartPath(x, 14 + Math.sin(T * 3) * 2, -8 - fp * 16, 3.2); x.fill(); x.globalAlpha = 1;
    eyeY = -1; eyeGap = 5.5;
  } else if (k === 'orb') {
    disc(x, 28, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    const cols = ['255,150,50', '110,185,255', '170,255,230', '255,240,150', '120,220,90', '190,135,80', '255,245,200', '190,140,255', '255,130,180'];
    cols.forEach((c, i) => { const a = T * 2.2 + i * PI2 / 9; x.fillStyle = 'rgba(' + c + ',0.95)'; x.beginPath(); x.arc(Math.cos(a) * 17, Math.sin(a) * 17, 3.2, 0, PI2); x.fill(); });
    disc(x, 15, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(240,230,255,0.85)'], [1, 'rgba(200,180,255,0)']]);
  }
  x.globalCompositeOperation = 'source-over';
  const bl = ((T * 60) % 220) < 6;
  x.fillStyle = EYE[k];
  for (const s of [-1, 1]) { x.beginPath(); x.ellipse(s * eyeGap + lx, eyeY + ly, 2.8, bl ? 0.8 : 4.2, 0, 0, PI2); x.fill(); }
  x.strokeStyle = EYE[k]; x.lineWidth = 1.6; x.lineCap = 'round';
  x.beginPath(); x.arc(lx, eyeY + 4.5 + ly, 2.6, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
  if (sp === 'line') {
    x.save(); x.rotate(T * 1.5);
    x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 2; x.setLineDash([5, 4]);
    x.beginPath(); x.arc(0, 0, 23, 0, PI2); x.stroke(); x.setLineDash([]); x.restore();
    const dirs = { fire: [0, Math.PI], water: [Math.PI / 2, -Math.PI / 2], bolt: [0, Math.PI / 2, Math.PI, -Math.PI / 2], light: [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4] }[k];
    x.fillStyle = '#FFFFFF';
    if (dirs) for (const a of dirs) { x.save(); x.rotate(a); x.beginPath(); x.moveTo(30, 0); x.lineTo(24, -4.5); x.lineTo(24, 4.5); x.closePath(); x.fill(); x.restore(); }
    else { const p = 1 + 0.12 * Math.sin(T * 6); x.strokeStyle = 'rgba(' + PC[k] + ',0.9)'; x.lineWidth = 2; x.beginPath(); if (k === 'leaf') x.rect(-26 * p, -26 * p, 52 * p, 52 * p); else if (k === 'dark') x.arc(0, 0, 28 * p, 0, PI2); else if (k === 'heart') { heartPath(x, 0, 2, 22 * p); } else if (k === 'earth') { for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; x.moveTo(Math.cos(a) * 25, Math.sin(a) * 25); x.lineTo(Math.cos(a) * 31 * p, Math.sin(a) * 31 * p); } } else x.arc(0, 0, 28 * p, 0.3, 5.5); x.stroke(); }
  }
  x.restore();
}

const api = { draw, heartPath, PC, EYE };
export default api;
export { draw, heartPath, PC, EYE };
