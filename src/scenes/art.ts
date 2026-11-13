import Phaser from 'phaser';
import type { TankId } from '../game/data';
import { TANKS } from '../game/data';
import type { MapTheme } from '../data/maps';
import type { Terrain } from '../physics/terrain';

export const TEAM_COLORS = ['#3d8bff', '#ff4d6d'] as const;
export const TEAM_NAMES = ['A팀', 'B팀'] as const;

export const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

function rgb(c: string) {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
}

function mix(a: readonly number[], b: readonly number[], t: number) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 픽셀별 지형 색(풀·흙 그라데이션·알갱이)을 미리 계산한다 */
export function buildTerrainArt(t: Terrain, theme: MapTheme): Uint8ClampedArray {
  const art = new Uint8ClampedArray(t.w * t.h * 4);
  const grass = rgb(theme.grass);
  const grassDark = rgb(theme.grassDark);
  const top = rgb(theme.dirtTop);
  const bottom = rgb(theme.dirtBottom);
  const speck = rgb(theme.speck);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let x = 0; x < t.w; x++) {
    let depth = 999;
    for (let y = 0; y < t.h; y++) {
      const i = y * t.w + x;
      const solid = t.data[i] === 1;
      depth = solid ? depth + 1 : -1;
      const d = solid ? depth : 999;
      let c: number[];
      if (d < 6) c = [...grass];
      else if (d < 10) c = [...grassDark];
      else {
        c = mix(top, bottom, Math.min(1, y / t.h + 0.1));
        const r = rnd();
        if (r < 0.06) c = mix(c, speck, 0.8);
        else if (r < 0.1) c = mix(c, [255, 255, 255], 0.12);
        // 지층 줄무늬
        if (Math.sin(y * 0.09 + Math.sin(x * 0.01) * 2) > 0.92) c = mix(c, bottom, 0.25);
      }
      const o = i * 4;
      art[o] = c[0];
      art[o + 1] = c[1];
      art[o + 2] = c[2];
      art[o + 3] = 255;
    }
  }
  return art;
}

/** 탱크 몸체 텍스처를 그린다 (오른쪽을 보는 모습, 원점 = 바닥 중앙) */
export function makeTankTextures(scene: Phaser.Scene) {
  for (const id of Object.keys(TANKS) as TankId[]) {
    const key = `tank-${id}`;
    if (scene.textures.exists(key)) continue;
    const def = TANKS[id];
    const g = scene.make.graphics({}, false);
    const W = 48;
    const H = 40;
    const ox = W / 2;
    const oy = H - 2;
    const body = hex(def.color);
    const accent = hex(def.accent);
    const outline = 0x3a2a1e;

    // 그림자
    g.fillStyle(0x000000, 0.18).fillEllipse(ox, oy + 1, 38, 5);

    // 특수 장식 (몸체 뒤)
    if (id === 'sparrow') {
      g.fillStyle(accent).lineStyle(2, outline).beginPath();
      g.moveTo(ox - 6, oy - 20).lineTo(ox - 20, oy - 30).lineTo(ox - 13, oy - 18).closePath().fillPath().strokePath();
    }

    // 무한궤도
    g.fillStyle(0x4a4a58).lineStyle(2, outline).fillRoundedRect(ox - 17, oy - 9, 34, 9, 4).strokeRoundedRect(ox - 17, oy - 9, 34, 9, 4);
    g.fillStyle(0x9aa0b0);
    for (let i = 0; i < 4; i++) g.fillCircle(ox - 11 + i * 7.3, oy - 4.5, 2.4);

    // 몸체
    g.fillStyle(body).lineStyle(2, outline).fillRoundedRect(ox - 15, oy - 17, 30, 10, 4).strokeRoundedRect(ox - 15, oy - 17, 30, 10, 4);
    g.fillStyle(0xffffff, 0.35).fillRoundedRect(ox - 12, oy - 16, 18, 3, 1.5);

    if (id === 'driller') {
      g.fillStyle(0xc9ced8).lineStyle(2, outline).beginPath();
      g.moveTo(ox + 13, oy - 16).lineTo(ox + 24, oy - 12).lineTo(ox + 13, oy - 8).closePath().fillPath().strokePath();
      g.lineStyle(1, 0x6b7280).lineBetween(ox + 16, oy - 15, ox + 18, oy - 9).lineBetween(ox + 19, oy - 14, ox + 21, oy - 10);
    }
    if (id === 'bolt') {
      g.fillStyle(accent).beginPath();
      g.moveTo(ox - 4, oy - 17).lineTo(ox - 8, oy - 12).lineTo(ox - 5, oy - 12).lineTo(ox - 8, oy - 8).lineTo(ox - 1, oy - 13).lineTo(ox - 4, oy - 13).lineTo(ox - 1, oy - 17).closePath().fillPath();
    }

    // 머리(돔)
    const domeR = id === 'bubble' ? 10 : 9;
    g.fillStyle(body).lineStyle(2, outline).fillCircle(ox, oy - 18, domeR).strokeCircle(ox, oy - 18, domeR);
    g.fillStyle(0xffffff, 0.4).fillCircle(ox - 3, oy - 22, 3);
    // 눈
    g.fillStyle(0xffffff).fillEllipse(ox + 3, oy - 19, 5, 6).fillEllipse(ox + 8, oy - 19, 5, 6);
    g.fillStyle(0x1e1e2a).fillCircle(ox + 4, oy - 19, 1.6).fillCircle(ox + 9, oy - 19, 1.6);
    // 볼터치
    g.fillStyle(0xff7a9a, 0.6).fillCircle(ox + 1, oy - 14.5, 1.6);

    if (id === 'bubble') {
      g.fillStyle(accent, 0.25).lineStyle(2, accent, 0.9).fillCircle(ox, oy - 19, 15).strokeCircle(ox, oy - 19, 15);
      g.fillStyle(0xffffff, 0.7).fillCircle(ox - 6, oy - 26, 2.5);
    }
    if (id === 'bolt') {
      g.fillStyle(accent).lineStyle(1.5, outline).fillTriangle(ox - 2, oy - 27, ox + 2, oy - 27, ox, oy - 33).strokeTriangle(ox - 2, oy - 27, ox + 2, oy - 27, ox, oy - 33);
    }
    if (id === 'sparrow') {
      g.fillStyle(accent).fillTriangle(ox - 4, oy - 26, ox + 1, oy - 27, ox - 2, oy - 31);
    }

    g.generateTexture(key, W, H);
    g.destroy();
  }
}

/** 하늘·구름·먼 산 배경 */
export function drawBackground(scene: Phaser.Scene, theme: MapTheme, mapId: string, w: number) {
  const layers: Phaser.GameObjects.GameObject[] = [];
  // 하늘 그라데이션은 캔버스 뒤 CSS 배경으로 그린다 (줌과 무관하게 화면 전체를 덮음)
  const canvas = scene.game.canvas.parentElement;
  if (canvas) canvas.style.background = `linear-gradient(${theme.skyTop}, ${theme.skyBottom})`;

  // 태양
  const sun = scene.add.graphics().setScrollFactor(0.05).setDepth(-95);
  sun.fillStyle(0xfff6b0, 0.5).fillCircle(1250, 60, 70).fillStyle(0xfff8d0, 1).fillCircle(1250, 60, 44);

  // 먼 산
  const far = scene.add.graphics().setScrollFactor(0.4, 0.6).setDepth(-90);
  far.fillStyle(hex(theme.far), mapId === 'sky' ? 0.0 : 0.85);
  far.beginPath();
  far.moveTo(-200, 900);
  for (let x = -200; x <= w + 400; x += 40) {
    const y = 470 + Math.sin(x * 0.006) * 70 + Math.sin(x * 0.017 + 1) * 30;
    far.lineTo(x, mapId === 'sphinx' ? 520 + Math.abs(((x / 300) % 2) - 1) * -120 + 60 : y);
  }
  far.lineTo(w + 400, 900).closePath().fillPath();

  // 구름
  const cloudY = mapId === 'sky' ? [80, 160, 720, 780, 640] : [70, 130, 200, 90, 160];
  for (let i = 0; i < 9; i++) {
    const c = scene.add.graphics().setDepth(-80).setScrollFactor(0.2 + (i % 3) * 0.15, 0.5);
    const cx = (i * 263) % (w + 300);
    const cy = cloudY[i % cloudY.length] + (i % 2) * 30;
    const s = 0.7 + (i % 3) * 0.25;
    c.fillStyle(hex(theme.cloud), 0.9);
    c.fillEllipse(cx, cy, 90 * s, 34 * s).fillEllipse(cx - 30 * s, cy + 6 * s, 60 * s, 26 * s).fillEllipse(cx + 32 * s, cy + 5 * s, 64 * s, 28 * s).fillEllipse(cx + 5 * s, cy - 12 * s, 54 * s, 30 * s);
    scene.tweens.add({ targets: c, x: 60, duration: 20000 + i * 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    layers.push(c);
  }
  return layers;
}
