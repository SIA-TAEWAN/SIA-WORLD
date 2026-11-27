// 정령 블록 칸 그림: 정령 색 바탕 + 정령 얼굴 (시아팡팡 정령 그림을 칸 크기에 맞게). 칸이 작아도 색 + 모양으로 구별된다.
import * as SPR from '../../../pang/src/game/spirits.js';
import { SPIRITS } from '../rules.ts';

/** 칸 바탕 색 [밝은 위, 아래, 외곽선] — 정령 9종이 서로 겹치지 않게 (시아팡팡 정령 빛 색 PC 를 진하게) */
export const TILE: Record<string, [string, string, string]> = {
  fire: ['#FFB067', '#F26A21', '#8A3510'],
  water: ['#8FD0FF', '#2F86E8', '#123E7A'],
  wind: ['#A8F5DD', '#2FBF9C', '#145A4C'],
  bolt: ['#FFF09A', '#F4C21C', '#7A5A08'],
  leaf: ['#B5EE8C', '#4FAE36', '#21561A'],
  earth: ['#E0B080', '#9C6436', '#4A2A12'],
  light: ['#FFFFFF', '#F3E6BE', '#9A7A2A'],
  dark: ['#B48BF0', '#5B2FA8', '#24104C'],
  heart: ['#FFC2DA', '#F2649C', '#7A1F48'],
};
const GREY: [string, string, string] = ['#B8B4C4', '#7E7990', '#3E3A4C'];

function rr(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, r: number) {
  x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
}
export { rr };

const cache = new Map<string, HTMLCanvasElement>();
/** spirit 번호 (−1 = 회색: 게임 끝) · 칸 크기 s (CSS px) · dpr */
export function tile(spirit: number, s: number, dpr: number, grey = false): HTMLCanvasElement {
  const px = Math.max(4, Math.round(s * dpr));
  const key = spirit + ':' + px + (grey ? 'g' : '');
  let c = cache.get(key);
  if (c) return c;
  if (cache.size > 120) { for (const v of cache.values()) { v.width = 0; v.height = 0; } cache.clear(); }
  c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d')!;
  const k = SPIRITS[spirit] ?? 'light';
  const [top, bot, line] = grey ? GREY : TILE[k];
  const pad = px * 0.04, w = px - pad * 2, r = px * 0.2;
  const g = x.createLinearGradient(0, pad, 0, pad + w);
  g.addColorStop(0, top); g.addColorStop(1, bot);
  rr(x, pad, pad, w, w, r); x.fillStyle = g; x.fill();
  x.lineWidth = Math.max(1, px * 0.05); x.strokeStyle = line; x.stroke();
  // 윗부분 반짝임
  x.save(); rr(x, pad, pad, w, w, r); x.clip();
  x.fillStyle = 'rgba(255,255,255,0.28)'; x.beginPath(); x.ellipse(px * 0.38, px * 0.2, px * 0.34, px * 0.13, -0.25, 0, Math.PI * 2); x.fill();
  x.restore();
  // 정령 얼굴 (몸 반지름 약 20 → 칸의 약 70%)
  x.save();
  x.translate(px / 2, px / 2 + px * 0.02);
  const sc = (px * 0.7) / 50;
  x.scale(sc, sc);
  if (grey) x.globalAlpha = 0.35;
  SPR.draw(x, k, 0.4, null, null);
  x.restore();
  if (grey) { rr(x, pad, pad, w, w, r); x.fillStyle = 'rgba(70,66,86,0.35)'; x.fill(); }
  cache.set(key, c);
  return c;
}
