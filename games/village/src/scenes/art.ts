import Phaser from 'phaser';
import { BUILDINGS, type BuildingType } from '../data/buildings';
import { COLOR, MATGO, RACE, ROULETTE, TABLE } from '../theme';

/**
 * 임시 그림 (코드로 그린다. DESIGN.md: 굵은 갈색 외곽선 · 밝은 단색 · 흐린 그림자 없음. 색은 shared/theme.js 의 값만).
 * 정식 그림 목록은 games/village/ASSETS.md — 9단계에서 SpriteCook 그림으로 바꾼다 (같은 이름의 텍스처를 그림 파일로 먼저 채우면 된다).
 */

/** 한 칸의 크기 (장면 좌표) */
export const CELL = 96;
/** 건물 그림이 칸 위로 솟는 높이 (가로 한 칸마다) */
export const RISE = 40;
/** 텍스처는 2배로 그린다 (확대해도 선명하게) */
const S = 2;

type G = Phaser.GameObjects.Graphics;
const LINE = 3;

export const texKey = (type: BuildingType, look: number) => `b-${type}-${look}`;
/** 건물 그림의 크기 (장면 좌표) */
export const texSize = (w: number, h: number) => ({ w: w * CELL, h: h * CELL + RISE * w });

function box(g: G, x: number, y: number, w: number, h: number, r: number, fill: number, line = LINE) {
  g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, r);
  g.lineStyle(line, COLOR.outline, 1).strokeRoundedRect(x, y, w, h, r);
}
function poly(g: G, pts: number[], fill: number, line = LINE) {
  const p: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < pts.length; i += 2) p.push(new Phaser.Math.Vector2(pts[i], pts[i + 1]));
  g.fillStyle(fill, 1).fillPoints(p, true);
  g.lineStyle(line, COLOR.outline, 1).strokePoints(p, true, true);
}
function dot(g: G, x: number, y: number, r: number, fill: number, line = LINE) {
  g.fillStyle(fill, 1).fillCircle(x, y, r);
  if (line > 0) g.lineStyle(line, COLOR.outline, 1).strokeCircle(x, y, r);
}

/** 지붕: 초가(노랑, 둥글게) · 널(주황) · 기와(잿빛, 처마 끝이 들림) */
function roof(g: G, cx: number, top: number, w: number, h: number, look: number) {
  const l = cx - w / 2;
  const r = cx + w / 2;
  if (look === 1) {
    box(g, l, top, w, h, Math.min(h * 0.9, w / 2), COLOR.primary);
    g.lineStyle(2, COLOR.primaryDeep, 1).lineBetween(l + w * 0.25, top + h * 0.45, l + w * 0.3, top + h - 5).lineBetween(l + w * 0.7, top + h * 0.45, l + w * 0.75, top + h - 5);
  } else if (look === 2) {
    poly(g, [l - 4, top + h, l + w * 0.2, top, r - w * 0.2, top, r + 4, top + h], RACE.trackDark);
    g.lineStyle(2, COLOR.outline, 1).lineBetween(l + 6, top + h * 0.55, r - 6, top + h * 0.55);
  } else {
    poly(g, [l - 8, top + h - 6, l - 2, top + h * 0.55, l + w * 0.22, top, r - w * 0.22, top, r + 2, top + h * 0.55, r + 8, top + h - 6, r, top + h, l, top + h], ROULETTE.winter);
    box(g, l + w * 0.2, top - 5, w * 0.6, 9, 4, COLOR.primary, 2);
  }
}

function drawPaddy(g: G, look: number) {
  const top = RISE;
  box(g, 5, top + 5, CELL - 10, CELL - 12, 12, look === 1 ? COLOR.inkSoft : COLOR.emptyLine);
  box(g, 12, top + 12, CELL - 24, CELL - 26, 8, TABLE.blackjack, 2);
  const n = look === 1 ? 3 : 4;
  const tuft = look === 3 ? COLOR.primary : COLOR.win;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < n; c++) {
      const x = 12 + ((CELL - 24) / (n + 1)) * (c + 1);
      const y = top + 26 + r * 19;
      g.lineStyle(3, COLOR.outline, 1).lineBetween(x, y + 6, x, y - 5).lineBetween(x, y + 6, x - 5, y - 2).lineBetween(x, y + 6, x + 5, y - 2);
      g.lineStyle(1.5, tuft, 1).lineBetween(x, y + 5, x, y - 4).lineBetween(x, y + 5, x - 4, y - 2).lineBetween(x, y + 5, x + 4, y - 2);
      if (look === 3) dot(g, x, y - 6, 2.5, COLOR.primaryLight, 1.5);
    }
  }
}

function drawHouse(g: G, look: number) {
  const base = RISE + CELL - 8;
  const w = look === 1 ? 56 : 64;
  box(g, 48 - w / 2, base - 44, w, 44, 6, COLOR.panel);
  box(g, 40, base - 28, 16, 28, 4, COLOR.inkSoft, 2);
  if (look >= 2) box(g, 48 + w / 2 - 20, base - 34, 12, 12, 3, TABLE.blackjack, 2);
  roof(g, 48, base - 44 - (look === 1 ? 34 : 38), w + 20, look === 1 ? 40 : 42, look);
  if (look === 3) dot(g, 48 - w / 2 - 2, base - 30, 5, COLOR.pink, 2);
}

function drawLumber(g: G, look: number) {
  const base = RISE + CELL - 8;
  // 그루터기와 도끼
  box(g, 10, base - 22, 26, 22, 6, COLOR.inkSoft);
  dot(g, 23, base - 22, 10, COLOR.panel, 2);
  g.lineStyle(4, COLOR.outline, 1).lineBetween(26, base - 26, 40, base - 52);
  poly(g, [36, base - 58, 50, base - 56, 46, base - 44, 36, base - 48], ROULETTE.winter, 2);
  // 통나무 더미
  const logs = look === 1 ? [[62, base - 12], [78, base - 12], [70, base - 26]] : [[56, base - 12], [72, base - 12], [86, base - 12], [64, base - 26], [80, base - 26], [72, base - 40]];
  for (const [x, y] of logs) {
    dot(g, x, y, 9, COLOR.inkSoft);
    dot(g, x, y, 4, COLOR.panel, 1.5);
  }
  if (look >= 2) {
    // 지붕 달린 작업대
    g.lineStyle(4, COLOR.outline, 1).lineBetween(8, base - 2, 8, base - 70).lineBetween(90, base - 2, 90, base - 70);
    roof(g, 49, base - 100, 92, 34, look);
  }
}

function drawStorage(g: G, look: number) {
  const base = RISE + CELL - 8;
  box(g, 12, base - 50, 72, 50, 6, look === 1 ? COLOR.panel : COLOR.panelStrong);
  box(g, 30, base - 36, 36, 36, 4, COLOR.inkSoft, 2);
  g.lineStyle(3, COLOR.outline, 1).lineBetween(30, base - 36, 66, base).lineBetween(66, base - 36, 30, base).lineBetween(48, base - 36, 48, base);
  roof(g, 48, base - 50 - 36, 92, 42, look);
  if (look === 3) dot(g, 48, base - 62, 7, COLOR.primary, 2);
}

function drawHall(g: G, look: number) {
  const W = CELL * 2;
  const base = RISE * 2 + CELL * 2 - 10;
  // 돌 기단
  box(g, 10, base - 18, W - 20, 18, 6, COLOR.lineSoft);
  // 벽과 기둥
  box(g, 26, base - 92, W - 52, 76, 6, COLOR.panel);
  for (const x of [26, 70, W - 82, W - 38]) box(g, x, base - 92, 12, 76, 3, COLOR.cardRed, 2);
  box(g, 82, base - 64, 28, 48, 4, COLOR.inkSoft, 2);
  g.lineStyle(2, COLOR.outline, 1).lineBetween(96, base - 64, 96, base - 16);
  box(g, 44, base - 74, 22, 20, 3, TABLE.blackjack, 2);
  box(g, W - 66, base - 74, 22, 20, 3, TABLE.blackjack, 2);
  // 지붕 (2단계부터 2층)
  roof(g, W / 2, base - 92 - 52, W - 8, 60, 3);
  if (look >= 2) {
    box(g, 58, base - 92 - 52 - 28, W - 116, 32, 4, COLOR.panel);
    roof(g, W / 2, base - 92 - 52 - 28 - 40, W - 72, 46, 3);
  }
  if (look === 3) {
    // 깃발과 금빛 장식
    g.lineStyle(4, COLOR.outline, 1).lineBetween(W / 2, base - 212, W / 2, base - 250);
    poly(g, [W / 2, base - 250, W / 2 + 26, base - 242, W / 2, base - 232], COLOR.pink, 2);
    dot(g, 30, base - 150, 6, COLOR.primary, 2);
    dot(g, W - 30, base - 150, 6, COLOR.primary, 2);
  }
  // 현판
  box(g, W / 2 - 22, base - 88, 44, 14, 3, COLOR.primary, 2);
}

const DRAW: Record<BuildingType, (g: G, look: number) => void> = { hall: drawHall, paddy: drawPaddy, house: drawHouse, lumber: drawLumber, storage: drawStorage };

/** 짓는 중인 터: 흙바닥 + 나무 틀 */
function drawSite(g: G, w: number, h: number) {
  const top = RISE * w;
  box(g, 6, top + 6, w * CELL - 12, h * CELL - 14, 12, RACE.track);
  const l = 14;
  const r = w * CELL - 14;
  const b = top + h * CELL - 14;
  const t = top - RISE * w * 0.3 + 20;
  g.lineStyle(7, COLOR.outline, 1).lineBetween(l, b, l, t).lineBetween(r, b, r, t).lineBetween(l, t, r, t).lineBetween(l, b, r, t).lineBetween(l, (b + t) / 2, r, (b + t) / 2);
  g.lineStyle(3, COLOR.emptyLine, 1).lineBetween(l, b, l, t).lineBetween(r, b, r, t).lineBetween(l, t, r, t).lineBetween(l, b, r, t).lineBetween(l, (b + t) / 2, r, (b + t) / 2);
}

/** 수확 방울 안의 자원 그림 */
function drawRes(g: G, res: string, cx: number, cy: number) {
  if (res === 'rice') {
    for (const [dx, dy, a] of [[-7, 4, -0.5], [7, 4, 0.5], [0, -6, 0]] as const) {
      g.save();
      g.translateCanvas(cx + dx, cy + dy);
      g.rotateCanvas(a);
      g.fillStyle(COLOR.white, 1).fillEllipse(0, 0, 11, 17);
      g.lineStyle(2.5, COLOR.outline, 1).strokeEllipse(0, 0, 11, 17);
      g.restore();
    }
  } else {
    box(g, cx - 15, cy - 7, 30, 14, 7, COLOR.inkSoft, 2.5);
    dot(g, cx + 10, cy, 6, COLOR.panel, 2);
  }
}

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.scaleCanvas(S, S);
  draw(g);
  g.generateTexture(key, Math.ceil(w * S), Math.ceil(h * S));
  g.destroy();
}

export const BUBBLE = 64;

export function makeTextures(scene: Phaser.Scene) {
  for (const d of BUILDINGS) {
    const sz = texSize(d.w, d.h);
    for (const look of [1, 2, 3]) make(scene, texKey(d.id, look), sz.w, sz.h, (g) => DRAW[d.id](g, look));
  }
  for (const w of [1, 2]) {
    const sz = texSize(w, w);
    make(scene, `site-${w}`, sz.w, sz.h, (g) => drawSite(g, w, w));
  }
  for (const res of ['rice', 'wood']) {
    make(scene, `bubble-${res}`, BUBBLE, BUBBLE + 10, (g) => {
      poly(g, [BUBBLE / 2 - 9, BUBBLE - 12, BUBBLE / 2 + 9, BUBBLE - 12, BUBBLE / 2, BUBBLE + 6], COLOR.white);
      dot(g, BUBBLE / 2, BUBBLE / 2 - 2, BUBBLE / 2 - 5, COLOR.white);
      g.fillStyle(COLOR.white, 1).fillRect(BUBBLE / 2 - 7, BUBBLE - 16, 14, 8);
      drawRes(g, res, BUBBLE / 2, BUBBLE / 2 - 2);
    });
  }
  // 땅 밖의 나무
  make(scene, 'tree', CELL, CELL, (g) => {
    box(g, 42, 58, 12, 26, 3, COLOR.inkSoft, 2.5);
    dot(g, 48, 40, 26, TABLE.matgo);
    dot(g, 38, 34, 6, MATGO.matLight, 0);
  });
}
