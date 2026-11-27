// 판 위 연출: 정령 파티클 · 떠오르는 글자 (시아팡팡 app.js 의 burst / drawParts / drawTexts 와 같은 수치)
import * as SPR from '../../../pang/src/game/spirits.js';
import { COLOR, css, FONT } from '../../../../shared/theme.js';

const PI2 = Math.PI * 2;
const INK = css(COLOR.outline);
const WHITE = css(COLOR.white);
const PC = SPR.PC as Record<string, string>;

interface Part { x: number; y: number; vx: number; vy: number; g: number; l: number; d: number; z: number; c: string; kind: string; rot: number; vr: number }
interface Text { s: string; x: number; y: number; size: number; col: string; l: number; tag?: string; speed: number }

export function createFx() {
  let parts: Part[] = [];
  let texts: Text[] = [];

  /** 정령 k 의 파티클 n 개 (S = 칸 크기) */
  function burst(k: string, X: number, Y: number, n: number, S: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * PI2, sp = (0.6 + Math.random() * 2.4) * S / 50;
      const p: Part = { x: X, y: Y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, l: 1, d: 0.025 + Math.random() * 0.02, z: (2 + Math.random() * 3.5) * S / 50, c: PC[k] || '255,255,255', kind: 'dot', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3 };
      if (k === 'fire') { p.vy -= 1.2 * S / 50; p.g = -0.04; }
      if (k === 'water') { p.g = 0.14; p.vy -= 1.5; }
      if (k === 'leaf') { p.kind = 'leaf'; p.g = 0.04; p.d *= 0.7; }
      if (k === 'earth') { p.kind = 'rock'; p.g = 0.22; p.vy -= 2; p.d *= 0.8; }
      if (k === 'heart') { p.kind = 'heart'; p.g = -0.02; p.vy -= 1; p.z *= 1.2; }
      if (k === 'light') { p.kind = 'star'; p.z *= 1.4; }
      if (k === 'dark') { p.vx *= 0.6; p.vy *= 0.6; }
      if (k === 'wind') p.kind = 'streak';
      parts.push(p);
    }
  }
  /** 반짝이 (판 비우기 · 최고 기록) */
  function sparkle(X: number, Y: number, n: number, S: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * PI2, sp = (1 + Math.random() * 4) * S / 50;
      parts.push({ x: X, y: Y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0.03, l: 1, d: 0.012 + Math.random() * 0.01, z: (3 + Math.random() * 4) * S / 50, c: ['255,245,200', '255,211,77', '255,179,200'][i % 3], kind: 'star', rot: 0, vr: 0 });
    }
  }
  function text(s: string, X: number, Y: number, size: number, col = WHITE, tag?: string, speed = 1) {
    if (tag) texts = texts.filter(t => t.tag !== tag);
    texts.push({ s, x: X, y: Y, size, col, l: 1, tag, speed });
  }

  function draw(x: CanvasRenderingContext2D, k: number) {
    parts = parts.filter(p => p.l > 0);
    if (parts.length > 900) parts.splice(0, parts.length - 900);
    for (const p of parts) {
      p.vy += p.g * k; p.x += p.vx * k; p.y += p.vy * k; p.vx *= Math.pow(0.97, k); p.l -= p.d * k; if (p.vr) p.rot += p.vr * k;
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
        x.fillStyle = 'rgb(' + p.c + ')';
        if (p.kind === 'leaf') { x.beginPath(); x.ellipse(0, 0, p.z * 1.6, p.z * 0.7, 0, 0, PI2); x.fill(); }
        else if (p.kind === 'heart') { SPR.heartPath(x, 0, 0, p.z); x.fill(); }
        else { x.beginPath(); x.moveTo(-p.z, -p.z * 0.4); x.lineTo(0, -p.z); x.lineTo(p.z, -p.z * 0.2); x.lineTo(p.z * 0.5, p.z * 0.8); x.lineTo(-p.z * 0.6, p.z * 0.6); x.closePath(); x.fill(); }
        x.restore();
      }
    }
    x.globalAlpha = 1;
    texts = texts.filter(t => t.l > 0);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    for (const t of texts) {
      t.l -= 0.016 * k * t.speed; t.y -= 0.5 * k;
      const a = Math.min(1, t.l * 2.5), pop = t.l > 0.9 ? 1 + (t.l - 0.9) * 3 : 1;
      x.globalAlpha = a;
      x.font = Math.round(t.size * pop) + 'px ' + FONT;
      x.strokeStyle = INK; x.lineWidth = Math.max(3, t.size * 0.18); x.strokeText(t.s, t.x, t.y);
      x.fillStyle = t.col; x.fillText(t.s, t.x, t.y);
    }
    x.globalAlpha = 1;
  }
  const busy = () => parts.length > 0 || texts.length > 0;
  function clear() { parts = []; texts = []; }
  return { burst, sparkle, text, draw, busy, clear, get texts() { return texts; } };
}
