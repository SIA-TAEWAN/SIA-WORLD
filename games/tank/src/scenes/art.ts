import Phaser from 'phaser';
import type { MapTheme } from '../data/maps';
import { MAP_H, type Terrain } from '../physics/terrain';

export { TEAM_COLORS, TEAM_NAMES } from '../ui/teams';

export const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

function rgb(c: string) {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
}

function mix(a: readonly number[], b: readonly number[], t: number) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 좌표별로 늘 같은 값을 주는 해시 노이즈 (0~1) */
function hash2(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 부드러운 값 노이즈 (돌멩이·얼룩 무늬용) */
function vnoise(x: number, y: number, s: number) {
  const gx = x / s;
  const gy = y / s;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const FLOWERS = [
  [255, 255, 255],
  [255, 226, 77],
  [255, 138, 180],
  [140, 190, 255],
];

/** SpriteCook 땅 질감 (public/tex): 맵별로 흙·모래·바위 */
export const TERRAIN_TEX: Record<string, 'soil' | 'sand' | 'rock'> = { valley: 'soil', target: 'soil', sphinx: 'sand', sky: 'rock', ledge: 'rock' };
export interface TexPixels {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** 픽셀별 지형 색(풀·흙 그라데이션·돌·맵 장식)을 미리 계산한다. tex가 있으면 흙 부분은 그 질감을 바둑판처럼 깐다 */
export function buildTerrainArt(t: Terrain, theme: MapTheme, mapId = 'valley', tex?: TexPixels): Uint8ClampedArray {
  const art = new Uint8ClampedArray(t.w * t.h * 4);
  const grass = rgb(theme.grass);
  const grassDark = rgb(theme.grassDark);
  const top = rgb(theme.dirtTop);
  const bottom = rgb(theme.dirtBottom);
  const speck = rgb(theme.speck);
  const rock = [120, 110, 112];
  const stoneLight = [240, 206, 140];
  const stoneDark = [196, 150, 88];
  // 아래쪽 공기까지 거리 (떠 있는 섬 밑면을 어둡게)
  const under = new Uint16Array(t.w * t.h);
  for (let x = 0; x < t.w; x++) {
    let run = 999;
    for (let y = t.h - 1; y >= 0; y--) {
      const i = y * t.w + x;
      run = t.data[i] ? (y === t.h - 1 ? 999 : run + 1) : 0;
      under[i] = Math.min(run, 999);
    }
  }
  for (let x = 0; x < t.w; x++) {
    let depth = 999;
    for (let y = 0; y < t.h; y++) {
      const i = y * t.w + x;
      const solid = t.data[i] === 1;
      depth = solid ? depth + 1 : -1;
      const d = solid ? depth : 999;
      let c: number[];
      const blob = vnoise(x, y, 7);
      if (mapId === 'sphinx' && y < 586 && Math.min(Math.abs(x - 545), Math.abs(x - 1055)) < 34 && d >= 2) {
        // 석상: 매끈한 돌 + 얼굴
        const cx = Math.abs(x - 545) < 34 ? 545 : 1055;
        const dx = x - cx;
        c = mix([226, 190, 128], [170, 128, 74], Math.min(1, (y - 470) / 120));
        if (y > 478 && y < 486 && (Math.abs(dx + 8) < 3 || Math.abs(dx - 8) < 3)) c = [70, 50, 40];
        else if (y > 494 && y < 497 && Math.abs(dx) < 7) c = [140, 100, 60];
        else if (y < 520 && Math.abs(dx) > 18) c = y % 8 < 4 ? mix(c, [60, 90, 170], 0.6) : mix(c, [255, 220, 120], 0.45); // 두건 줄무늬
        if (y >= 520 && (y - 520) % 10 < 1.2) c = mix(c, [150, 110, 60], 0.6);
      } else if (mapId === 'sphinx' && y < 586 && Math.abs(x - 800) < 272 && d >= 3) {
        // 피라미드 벽돌: 왼쪽 면은 밝게, 오른쪽 면은 어둡게
        const row = Math.floor(y / 13);
        const off = row % 2 ? 13 : 0;
        const mortar = y % 13 < 1.5 || (x + off) % 26 < 1.5;
        c = mix(stoneLight, stoneDark, x < 800 ? 0.15 : 0.55);
        c = mix(c, [255, 255, 255], (hash2(Math.floor((x + off) / 26), row) - 0.5) * 0.12);
        if (mortar) c = mix(c, stoneDark, 0.7);
      } else if (d < 6) {
        c = [...grass];
        // 풀 끝 밝은 하이라이트
        if (d < 2) c = mix(c, [255, 255, 255], 0.18);
        if (mapId === 'valley' && d < 3 && hash2(x, y) < 0.025) c = [...FLOWERS[Math.floor(hash2(y, x) * 4)]];
      } else if (d < 10) c = [...grassDark];
      else if (tex) {
        // 질감 + 깊을수록 조금 어둡게, 풀 바로 아래는 맵 색을 살짝 섞는다
        const o = ((y % tex.h) * tex.w + (x % tex.w)) * 4;
        c = [tex.data[o], tex.data[o + 1], tex.data[o + 2]];
        c = mix(c, bottom, Math.min(1, y / t.h) * 0.3);
        if (d < 22) c = mix(c, top, (1 - (d - 10) / 12) * 0.35);
      } else {
        c = mix(top, bottom, Math.min(1, y / t.h + 0.1));
        // 흙 속 돌멩이
        if (blob > 0.82) c = mix(c, mapId === 'sphinx' ? [236, 200, 140] : rock, (blob - 0.82) * 4.5);
        const r = hash2(x * 3 + 1, y * 7 + 5);
        if (r < 0.06) c = mix(c, speck, 0.8);
        else if (r < 0.1) c = mix(c, [255, 255, 255], 0.12);
        // 지층 줄무늬
        if (Math.sin(y * 0.09 + Math.sin(x * 0.01) * 2) > 0.92) c = mix(c, bottom, 0.25);
      }
      // 떠 있는 땅 밑면은 바위색으로 어둡게
      const u = under[i];
      if (solid && u < 14 && y < t.h - 1) c = mix(c, [70, 52, 40], (1 - u / 14) * 0.55);
      const o = i * 4;
      art[o] = c[0];
      art[o + 1] = c[1];
      art[o + 2] = c[2];
      art[o + 3] = 255;
    }
  }
  return art;
}

/** 폭발·연기·파편에 쓰는 작은 텍스처들 */
export function makeFxTextures(scene: Phaser.Scene) {
  if (scene.textures.exists('fx-soft')) return;
  // 가장자리가 흐린 원 (불꽃·빛)
  const soft = scene.textures.createCanvas('fx-soft', 64, 64)!;
  const c = soft.context;
  const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = grd;
  c.fillRect(0, 0, 64, 64);
  soft.refresh();
  const g = scene.make.graphics({}, false);
  // 연기 뭉치 (동글동글)
  g.fillStyle(0xffffff).fillCircle(20, 22, 13).fillCircle(32, 16, 12).fillCircle(42, 24, 13).fillCircle(30, 30, 14);
  g.generateTexture('fx-puff', 60, 46);
  g.clear();
  // 흙 파편
  g.fillStyle(0xffffff).fillRoundedRect(0, 0, 8, 7, 2);
  g.generateTexture('fx-chunk', 8, 7);
  g.clear();
  // 불티 (길쭉한 선)
  g.fillStyle(0xffffff).fillRoundedRect(0, 0, 14, 4, 2);
  g.generateTexture('fx-spark', 14, 4);
  g.clear();
  // 포구 불꽃 (별)
  g.fillStyle(0xffffff).beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 6 : 16;
    const a = (i / 10) * Math.PI * 2;
    if (i === 0) g.moveTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
    else g.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
  }
  g.closePath().fillPath();
  g.generateTexture('fx-star', 32, 32);
  g.destroy();
}

type G = Phaser.GameObjects.Graphics;

function cloud(g: G, cx: number, cy: number, s: number) {
  g.fillEllipse(cx, cy, 90 * s, 34 * s)
    .fillEllipse(cx - 30 * s, cy + 6 * s, 60 * s, 26 * s)
    .fillEllipse(cx + 32 * s, cy + 5 * s, 64 * s, 28 * s)
    .fillEllipse(cx + 5 * s, cy - 12 * s, 54 * s, 30 * s);
}

/** 하늘·구름·맵별 먼 풍경 배경 */
export function drawBackground(scene: Phaser.Scene, theme: MapTheme, mapId: string, w: number) {
  const layers: Phaser.GameObjects.GameObject[] = [];
  // 하늘 그라데이션은 캔버스 뒤 CSS 배경으로 그린다 (줌과 무관하게 화면 전체를 덮음)
  const canvas = scene.game.canvas.parentElement;
  if (canvas) canvas.style.background = `linear-gradient(${theme.skyTop}, ${theme.skyBottom})`;

  // 맵 그림 (SpriteCook): 화면을 덮을 만큼 키우고, 카메라가 움직이면 조금만 따라 움직인다 (먼 풍경)
  if (canvas) {
    const IMG_W = 1600;
    const IMG_H = 900;
    const url = `${import.meta.env.BASE_URL}bg/${mapId}.jpg`;
    const sky = `linear-gradient(${theme.skyTop}, ${theme.skyBottom})`;
    // 하늘색 안개를 한 겹 얹어 먼 풍경처럼 (실제 지형과 헷갈리지 않게)
    const haze = `linear-gradient(${theme.skyBottom}55, ${theme.skyBottom}55)`;
    canvas.style.background = `${haze}, url(${url}) no-repeat, ${sky}`;
    const cam = scene.cameras.main;
    let last = '';
    const follow = () => {
      const vw = canvas.clientWidth;
      const vh = canvas.clientHeight;
      if (!vw || !vh) return;
      const k = Math.max(vw / IMG_W, vh / IMG_H) * 1.15;
      const iw = IMG_W * k;
      const ih = IMG_H * k;
      const view = cam.worldView;
      const fx = Math.max(0, Math.min(1, view.centerX / w));
      const fy = Math.max(0, Math.min(1, view.centerY / MAP_H));
      const pos = `${Math.round(-(iw - vw) * fx)}px ${Math.round(-(ih - vh) * (0.4 + fy * 0.6))}px`;
      const key = `${Math.round(iw)}:${pos}`;
      if (key === last) return;
      last = key;
      canvas.style.backgroundSize = `auto, ${Math.round(iw)}px ${Math.round(ih)}px, auto`;
      canvas.style.backgroundPosition = `0 0, ${pos}, 0 0`;
    };
    follow();
    scene.events.on('postupdate', follow);
    scene.events.once('shutdown', () => scene.events.off('postupdate', follow));
  }

  // 구름
  const cloudY = [70, 130, 200, 90, 160];
  for (let i = 0; i < 5; i++) {
    const c = scene.add.graphics().setDepth(-80).setScrollFactor(0.2 + (i % 3) * 0.15, 0.5);
    const cx = (i * 263) % (w + 300);
    const cy = cloudY[i % cloudY.length] + (i % 2) * 30;
    const s = 0.7 + (i % 3) * 0.25;
    c.fillStyle(hex(theme.cloud), 0.75);
    cloud(c, cx, cy, s);
    scene.tweens.add({ targets: c, x: 60, duration: 20000 + i * 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    layers.push(c);
  }

  // 스카이 맵: 맵 아래 낭떠러지를 덮는 구름 바다 (지형 앞)
  if (mapId === 'sky') {
    const sea = scene.add.graphics().setDepth(-1);
    sea.fillStyle(0xffffff, 0.92);
    for (let x = -1200; x < w + 1200; x += 90) cloud(sea, x, 845 + Math.sin(x * 0.02) * 12, 1.8);
    sea.fillRect(-1200, 855, w + 2400, 900);
    scene.tweens.add({ targets: sea, x: 40, duration: 9000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  // 새 떼
  for (let i = 0; i < 4; i++) {
    const b = scene.add.graphics().setDepth(-82).setScrollFactor(0.5, 0.7);
    b.lineStyle(2.5, mapId === 'sphinx' ? 0x7a4a3a : 0x2d3a5a, 0.7);
    b.beginPath().arc(-6, 0, 6, Math.PI * 1.15, Math.PI * 1.9).strokePath();
    b.beginPath().arc(6, 0, 6, Math.PI * 1.1, Math.PI * 1.85).strokePath();
    const y = 120 + i * 45;
    b.setPosition(-300 - i * 140, y);
    scene.tweens.add({ targets: b, scaleY: 0.4, duration: 260 + i * 40, yoyo: true, repeat: -1 });
    scene.tweens.add({ targets: b, x: w + 600, y: y - 60, duration: 42000 + i * 5000, repeat: -1, delay: i * 2500 });
  }
  return layers;
}
