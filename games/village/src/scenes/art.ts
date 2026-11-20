import Phaser from 'phaser';
import { BUILDING, BUILDINGS, isGift, isMonument, upgradable, type BuildingType } from '../data/buildings';
import { COLOR, MATGO, RACE, ROULETTE, TABLE } from '../theme';

/**
 * 그림 파일 (SpriteCook, public/art/<이름>.png): 장면이 먼저 불러오고, 못 불러온 이름만 아래 코드 그림으로 채운다.
 * 원본 시트와 만드는 법은 games/village/art/build.py · spritecook-assets.json.
 */

/**
 * 대신 쓰는 그림 (코드로 그린다. DESIGN.md: 굵은 갈색 외곽선 · 밝은 단색 · 흐린 그림자 없음. 색은 shared/theme.js 의 값만).
 * 정식 그림 목록은 games/village/ASSETS.md — 9단계에서 SpriteCook 그림으로 바꾼다 (같은 이름의 텍스처를 그림 파일로 먼저 채우면 된다).
 */

/** 한 칸의 크기 (장면 좌표) */
export const CELL = 96;
/** 건물 그림이 칸 위로 솟는 높이 (가로 한 칸마다) */
export const RISE = 40;
/** 먼 숲 무늬 한 장의 칸 수 */
export const FOREST_CELLS = 8;
/** 텍스처는 2배로 그린다 (확대해도 선명하게) */
const S = 2;

type G = Phaser.GameObjects.Graphics;
const LINE = 3;

/** 건물 그림의 이름. 장식물 · 길은 모습이 하나다 */
export const texKey = (type: BuildingType, look: number) => `b-${type}-${upgradable(type) ? look : 1}`;
/** 건물 그림의 크기 (장면 좌표) */
export const texSize = (w: number, h: number) => ({ w: w * CELL, h: h * CELL + RISE * w });

/** 그림 파일로 먼저 채우는 텍스처 이름 (public/art/<이름>.png) */
export const ART_FILES: string[] = [
  ...BUILDINGS.flatMap((d) => (upgradable(d.id) ? [1, 2, 3] : [1]).map((look) => texKey(d.id, look))),
  'site-1', 'site-2', 'tile-grass', 'tile-meadow',
  ...['rice', 'wood', 'stone', 'cake', 'special'].map((r) => `bubble-${r}`),
  'n-pine', 'n-tree', 'n-bamboo', 'n-bush', 'n-rocks', 'n-flowers',
];

/** 땅 밖 자연물: 그림 이름 · 칸 너비에 대한 크기 · 고르는 비율 (나무가 대부분, 사이사이 덤불 · 바위 · 들꽃) */
const NATURE: readonly { key: string; size: number; weight: number }[] = [
  { key: 'b-tree-1', size: 0.95, weight: 4 },
  { key: 'n-pine', size: 1.0, weight: 4 },
  { key: 'n-tree', size: 1.02, weight: 3 },
  { key: 'n-bamboo', size: 0.88, weight: 2 },
  { key: 'n-bush', size: 0.72, weight: 2 },
  { key: 'n-rocks', size: 0.62, weight: 1 },
  { key: 'n-flowers', size: 0.6, weight: 1 },
];
const NATURE_SUM = NATURE.reduce((a, n) => a + n.weight, 0);
/** 좌표 해시로 자연물 하나를 고른다 (늘 같은 자리에 같은 것). 그림 파일이 없는 것은 b-tree-1 로, 그것도 없으면 null */
export function pickNature(h: number, files: Set<string>): { key: string; size: number } | null {
  let r = (h >>> 7) % NATURE_SUM;
  for (const n of NATURE) {
    if ((r -= n.weight) < 0) return files.has(n.key) ? n : files.has('b-tree-1') ? NATURE[0] : null;
  }
  return null;
}
/** 밤에 빛나는 것: 종류 → 모습 몇부터 (등불 · 사당의 돌 등 · 잔치 마당의 초롱 · 정자의 등 · 기와집의 등) */
export const GLOWS: Partial<Record<BuildingType, number>> = { lantern: 1, shrine: 1, feast: 1, pavilion: 2, house: 3, hall: 3 };

function box(g: G, x: number, y: number, w: number, h: number, r: number, fill: number, line = LINE) {
  g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, r);
  if (line > 0) g.lineStyle(line, COLOR.outline, 1).strokeRoundedRect(x, y, w, h, r);
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
function seg(g: G, x1: number, y1: number, x2: number, y2: number, w = 4, color = COLOR.outline) {
  g.lineStyle(w, color, 1).lineBetween(x1, y1, x2, y2);
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

/** 1×1 그림의 바닥 선 (칸의 아래쪽에서 조금 위) */
const BASE = RISE + CELL - 10;

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
  const w = look === 1 ? 56 : 64;
  box(g, 48 - w / 2, BASE - 44, w, 44, 6, COLOR.panel);
  box(g, 40, BASE - 28, 16, 28, 4, COLOR.inkSoft, 2);
  if (look >= 2) box(g, 48 + w / 2 - 20, BASE - 34, 12, 12, 3, TABLE.blackjack, 2);
  roof(g, 48, BASE - 44 - (look === 1 ? 34 : 38), w + 20, look === 1 ? 40 : 42, look);
  if (look === 3) dot(g, 48 - w / 2 - 2, BASE - 30, 5, COLOR.pink, 2);
}

function drawLumber(g: G, look: number) {
  // 지붕 달린 작업대 (2단계부터)
  if (look >= 2) {
    seg(g, 10, BASE - 2, 10, BASE - 62);
    seg(g, 86, BASE - 2, 86, BASE - 62);
    roof(g, 48, BASE - 94, 90, 34, look);
  }
  // 그루터기와 도끼
  box(g, 8, BASE - 20, 26, 20, 6, COLOR.inkSoft);
  dot(g, 21, BASE - 20, 10, COLOR.panel, 2);
  seg(g, 24, BASE - 24, 36, BASE - 48);
  poly(g, [32, BASE - 54, 46, BASE - 52, 42, BASE - 40, 32, BASE - 44], ROULETTE.winter, 2);
  // 통나무 더미
  const logs = look === 1 ? [[56, BASE - 10], [74, BASE - 10], [65, BASE - 26]] : [[52, BASE - 10], [68, BASE - 10], [84, BASE - 10], [60, BASE - 26], [76, BASE - 26], [68, BASE - 42]];
  for (const [x, y] of logs) {
    dot(g, x, y, 9, COLOR.inkSoft);
    dot(g, x, y, 4, COLOR.panel, 1.5);
  }
}

function drawStorage(g: G, look: number) {
  box(g, 12, BASE - 50, 72, 50, 6, look === 1 ? COLOR.panel : COLOR.panelStrong);
  box(g, 30, BASE - 36, 36, 36, 4, COLOR.inkSoft, 2);
  g.lineStyle(3, COLOR.outline, 1).lineBetween(30, BASE - 36, 66, BASE).lineBetween(66, BASE - 36, 30, BASE).lineBetween(48, BASE - 36, 48, BASE);
  roof(g, 48, BASE - 50 - 36, 92, 42, look);
  if (look === 3) dot(g, 48, BASE - 62, 7, COLOR.primary, 2);
}

/** 장터: 줄무늬 차양 아래 좌판 */
function drawMarket(g: G, look: number) {
  seg(g, 14, BASE, 14, BASE - 66);
  seg(g, 82, BASE, 82, BASE - 66);
  box(g, 10, BASE - 30, 76, 30, 5, COLOR.inkSoft);
  // 좌판 위의 물건
  dot(g, 28, BASE - 34, 8, COLOR.primary, 2);
  dot(g, 48, BASE - 34, 8, COLOR.lose, 2);
  dot(g, 68, BASE - 34, 8, COLOR.win, 2);
  // 차양
  const top = BASE - 96;
  for (let i = 0; i < 4; i++) box(g, 6 + i * 21, top, 21, 30, 4, i % 2 ? COLOR.white : look === 3 ? COLOR.primary : COLOR.pink, 2);
  box(g, 6, top - 6, 84, 10, 4, look === 1 ? COLOR.inkSoft : ROULETTE.winter, 2);
  if (look >= 2) dot(g, 48, top - 12, 7, COLOR.primary, 2);
}

/** 채석장: 돌무더기와 곡괭이 */
function drawQuarry(g: G, look: number) {
  poly(g, [6, BASE, 16, BASE - 40, 40, BASE - 62, 70, BASE - 50, 90, BASE - 20, 90, BASE], ROULETTE.winter);
  g.lineStyle(2, COLOR.outline, 1).lineBetween(40, BASE - 62, 44, BASE - 30).lineBetween(44, BASE - 30, 70, BASE - 50).lineBetween(44, BASE - 30, 30, BASE);
  dot(g, 22, BASE - 8, 9, COLOR.lineSoft, 2);
  dot(g, 70, BASE - 8, 8, COLOR.lineSoft, 2);
  // 곡괭이
  seg(g, 58, BASE - 4, 76, BASE - 64, 5);
  seg(g, 58, BASE - 4, 76, BASE - 64, 2, COLOR.inkSoft);
  poly(g, [62, BASE - 70, 76, BASE - 72, 90, BASE - 60, 76, BASE - 62], COLOR.lineSoft, 2);
  if (look >= 2) {
    // 수레
    box(g, 4, BASE - 26, 30, 16, 3, COLOR.inkSoft, 2);
    dot(g, 12, BASE - 6, 6, COLOR.panel, 2);
    dot(g, 26, BASE - 6, 6, COLOR.panel, 2);
  }
  if (look === 3) dot(g, 40, BASE - 46, 6, COLOR.primary, 2);
}

/** 방앗간: 작은 집과 물레방아 */
function drawMill(g: G, look: number) {
  box(g, 26, BASE - 44, 58, 44, 6, COLOR.panel);
  box(g, 58, BASE - 26, 14, 26, 4, COLOR.inkSoft, 2);
  roof(g, 55, BASE - 44 - 34, 74, 40, look);
  // 물레방아
  dot(g, 24, BASE - 24, 22, look === 1 ? COLOR.emptyLine : COLOR.inkSoft);
  dot(g, 24, BASE - 24, 13, TABLE.blackjack, 2);
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 4) * i;
    seg(g, 24 - Math.cos(a) * 21, BASE - 24 - Math.sin(a) * 21, 24 + Math.cos(a) * 21, BASE - 24 + Math.sin(a) * 21, 2.5);
  }
  dot(g, 24, BASE - 24, 4, COLOR.primary, 2);
}

/** 장독대: 낮은 단 위의 항아리들 */
function drawJar(g: G, look: number) {
  box(g, 6, BASE - 12, 84, 12, 5, COLOR.lineSoft);
  const jar = (x: number, s: number) => {
    const h = 34 * s;
    box(g, x - 13 * s, BASE - 12 - h, 26 * s, h, 11 * s, COLOR.inkSoft);
    box(g, x - 9 * s, BASE - 12 - h - 5, 18 * s, 8, 4, COLOR.outline, 0);
    box(g, x - 9 * s, BASE - 12 - h - 5, 18 * s, 8, 4, COLOR.emptyLine, 2);
  };
  if (look >= 2) {
    jar(22, 0.8);
    jar(74, 0.8);
  }
  jar(look === 1 ? 32 : 48, look === 1 ? 1 : 1.25);
  if (look === 1) jar(66, 0.85);
  if (look === 3) roof(g, 48, BASE - 96, 92, 26, 3);
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
    seg(g, W / 2, base - 212, W / 2, base - 250);
    poly(g, [W / 2, base - 250, W / 2 + 26, base - 242, W / 2, base - 232], COLOR.pink, 2);
    dot(g, 30, base - 150, 6, COLOR.primary, 2);
    dot(g, W - 30, base - 150, 6, COLOR.primary, 2);
  }
  // 현판
  box(g, W / 2 - 22, base - 88, 44, 14, 3, COLOR.primary, 2);
}

/** 특별 건물 (2×2): 정자 · 잔치 마당 · 십이지 사당 */
function drawPavilion(g: G, look: number) {
  const W = CELL * 2;
  const base = RISE * 2 + CELL * 2 - 10;
  box(g, 20, base - 16, W - 40, 16, 6, COLOR.lineSoft);
  for (const x of [34, 76, W - 88, W - 46]) box(g, x, base - 96, 12, 82, 3, COLOR.cardRed, 2);
  box(g, 30, base - 46, W - 60, 10, 3, COLOR.inkSoft, 2);
  roof(g, W / 2, base - 96 - 60, W - 20, 66, 3);
  dot(g, W / 2, base - 96 - 66, look === 3 ? 12 : 8, COLOR.primary, 2);
  if (look >= 2) for (const x of [28, W - 28]) dot(g, x, base - 78, 7, COLOR.pink, 2);
}
function drawFeast(g: G, look: number) {
  const W = CELL * 2;
  const base = RISE * 2 + CELL * 2 - 10;
  // 멍석
  box(g, 10, base - 76, W - 20, 76, 14, COLOR.primaryLight);
  box(g, 22, base - 64, W - 44, 52, 10, COLOR.panel, 2);
  // 상과 떡
  box(g, 56, base - 54, 80, 30, 6, COLOR.inkSoft);
  for (const x of [72, 96, 120]) dot(g, x, base - 44, 9, COLOR.white, 2);
  dot(g, 96, base - 44, 4, COLOR.pink, 0);
  // 청사초롱 줄
  seg(g, 16, base - 80, 16, base - 150);
  seg(g, W - 16, base - 80, W - 16, base - 150);
  seg(g, 16, base - 146, W - 16, base - 146, 3);
  const n = look === 1 ? 3 : 5;
  for (let i = 0; i < n; i++) box(g, 30 + ((W - 76) / (n - 1)) * i, base - 142, 16, 22, 6, i % 2 ? COLOR.teamA : COLOR.pink, 2);
  if (look === 3) dot(g, W / 2, base - 160, 9, COLOR.primary, 2);
}
function drawShrine(g: G, look: number) {
  const W = CELL * 2;
  const base = RISE * 2 + CELL * 2 - 10;
  box(g, 14, base - 14, W - 28, 14, 5, COLOR.lineSoft);
  box(g, 34, base - 26, W - 68, 14, 5, COLOR.lineSoft);
  box(g, 50, base - 100, W - 100, 76, 6, COLOR.cardRed);
  box(g, 80, base - 76, 32, 52, 4, COLOR.outline, 0);
  box(g, 82, base - 74, 28, 50, 3, COLOR.primaryDeep, 2);
  roof(g, W / 2, base - 100 - 56, W - 44, 62, 3);
  dot(g, W / 2, base - 100 - 64, 9, COLOR.primary, 2);
  // 돌 등
  for (const x of [24, W - 24]) {
    box(g, x - 8, base - 44, 16, 30, 3, ROULETTE.winter, 2);
    box(g, x - 12, base - 60, 24, 18, 4, look >= 2 ? COLOR.primaryLight : COLOR.lineSoft, 2);
  }
  if (look === 3) for (const x of [58, W - 58]) dot(g, x, base - 120, 6, COLOR.primary, 2);
}

// ───────────────────────── 장식물 · 길 ─────────────────────────

const DECO: Partial<Record<BuildingType, (g: G) => void>> = {
  tree(g) {
    box(g, 42, BASE - 30, 12, 30, 3, COLOR.inkSoft, 2.5);
    dot(g, 48, BASE - 52, 28, COLOR.win);
    dot(g, 38, BASE - 60, 7, MATGO.matLight, 0);
  },
  haystack(g) {
    poly(g, [14, BASE, 26, BASE - 46, 48, BASE - 64, 70, BASE - 46, 82, BASE], COLOR.primary);
    g.lineStyle(2, COLOR.primaryDeep, 1).lineBetween(34, BASE - 6, 40, BASE - 44).lineBetween(48, BASE - 6, 48, BASE - 52).lineBetween(62, BASE - 6, 56, BASE - 44);
    box(g, 22, BASE - 36, 52, 7, 3, COLOR.inkSoft, 2);
  },
  flower(g) {
    box(g, 8, BASE - 22, 80, 22, 10, COLOR.inkSoft);
    const cols = [COLOR.pink, COLOR.primary, COLOR.white, COLOR.teamA, COLOR.pink];
    cols.forEach((c, i) => {
      const x = 18 + i * 15;
      const y = BASE - 28 - (i % 2) * 8;
      seg(g, x, BASE - 14, x, y, 3, COLOR.win);
      dot(g, x, y, 7, c, 2);
      dot(g, x, y, 2.5, COLOR.primaryDeep, 0);
    });
  },
  scarecrow(g) {
    seg(g, 48, BASE, 48, BASE - 60, 5);
    seg(g, 22, BASE - 40, 74, BASE - 40, 5);
    poly(g, [30, BASE - 48, 66, BASE - 48, 62, BASE - 18, 34, BASE - 18], COLOR.teamA, 2.5);
    dot(g, 48, BASE - 62, 12, COLOR.panel, 2.5);
    poly(g, [30, BASE - 70, 66, BASE - 70, 48, BASE - 90], COLOR.primary, 2.5);
  },
  stonewall(g) {
    const rows = [[8, 30, 54, 76], [18, 42, 66]];
    rows.forEach((xs, r) => xs.forEach((x) => box(g, x - 4, BASE - 20 - r * 18, 24, 20, 7, r ? COLOR.lineSoft : ROULETTE.winter, 2.5)));
  },
  bench(g) {
    for (const x of [16, 76]) box(g, x - 4, BASE - 14, 8, 14, 2, COLOR.inkSoft, 2);
    box(g, 8, BASE - 28, 80, 16, 5, COLOR.emptyLine);
    g.lineStyle(2, COLOR.inkSoft, 1).lineBetween(28, BASE - 26, 28, BASE - 14).lineBetween(48, BASE - 26, 48, BASE - 14).lineBetween(68, BASE - 26, 68, BASE - 14);
  },
  lantern(g) {
    seg(g, 48, BASE, 48, BASE - 62, 5);
    box(g, 36, BASE - 8, 24, 8, 3, COLOR.lineSoft, 2);
    box(g, 34, BASE - 84, 28, 30, 8, COLOR.primaryLight);
    box(g, 30, BASE - 90, 36, 9, 4, COLOR.cardRed, 2);
    box(g, 30, BASE - 58, 36, 7, 3, COLOR.cardRed, 2);
  },
  well(g) {
    seg(g, 22, BASE - 20, 22, BASE - 70);
    seg(g, 74, BASE - 20, 74, BASE - 70);
    roof(g, 48, BASE - 92, 76, 26, 2);
    box(g, 14, BASE - 34, 68, 34, 10, ROULETTE.winter);
    box(g, 22, BASE - 30, 52, 12, 6, TABLE.blackjack, 2);
  },
  jangseung(g) {
    box(g, 34, BASE - 84, 28, 84, 8, COLOR.inkSoft);
    dot(g, 42, BASE - 66, 4, COLOR.white, 2);
    dot(g, 54, BASE - 66, 4, COLOR.white, 2);
    box(g, 40, BASE - 54, 16, 8, 3, COLOR.cardRed, 2);
    box(g, 30, BASE - 96, 36, 14, 5, COLOR.outline, 0);
    box(g, 32, BASE - 94, 32, 10, 4, COLOR.emptyLine, 2);
  },
  sotdae(g) {
    seg(g, 48, BASE, 48, BASE - 84, 5);
    seg(g, 48, BASE, 48, BASE - 84, 2, COLOR.inkSoft);
    box(g, 38, BASE - 8, 20, 8, 3, COLOR.lineSoft, 2);
    // 새
    poly(g, [30, BASE - 92, 56, BASE - 100, 66, BASE - 90, 52, BASE - 84], COLOR.panel, 2.5);
    poly(g, [66, BASE - 90, 76, BASE - 88, 66, BASE - 84], COLOR.primary, 2);
  },
  pond(g) {
    box(g, 6, BASE - 44, 84, 44, 22, ROULETTE.winter);
    box(g, 14, BASE - 38, 68, 32, 16, TABLE.blackjack, 2);
    dot(g, 34, BASE - 20, 9, COLOR.win, 2);
    dot(g, 60, BASE - 26, 7, COLOR.win, 2);
    dot(g, 60, BASE - 28, 4, COLOR.pink, 1.5);
  },
  stonetower(g) {
    [[48, 26], [48, 21], [48, 16], [48, 11], [48, 7]].forEach(([x, r], i) => {
      const y = BASE - 12 - i * 19;
      box(g, x - r, y - 8, r * 2, 20, 9, i % 2 ? COLOR.lineSoft : ROULETTE.winter, 2.5);
    });
  },
  road(g) {
    box(g, 3, RISE + 3, CELL - 6, CELL - 6, 12, COLOR.lineSoft, 0);
    for (const [x, y, r] of [[22, 22, 9], [58, 18, 7], [78, 44, 8], [36, 52, 10], [66, 72, 9], [20, 76, 7]]) dot(g, x, RISE + y, r, COLOR.emptyLine, 0);
  },
};

/** 주민 선물: 받침 위의 선물 꾸러미 (주민마다 리본 색이 다르다) */
const GIFT_COLORS = [ROULETTE.winter, COLOR.inkSoft, RACE.track, COLOR.pink, COLOR.win, TABLE.poker, RACE.trackDark, COLOR.white, COLOR.primaryDeep, COLOR.cardRed, COLOR.emptyLine, ROULETTE.summer];
function drawGift(g: G, i: number) {
  box(g, 14, BASE - 12, 68, 12, 5, COLOR.lineSoft);
  box(g, 24, BASE - 56, 48, 44, 8, COLOR.primaryLight);
  box(g, 43, BASE - 56, 10, 44, 0, GIFT_COLORS[i % GIFT_COLORS.length], 2);
  box(g, 24, BASE - 40, 48, 10, 0, GIFT_COLORS[i % GIFT_COLORS.length], 2);
  dot(g, 40, BASE - 62, 9, GIFT_COLORS[i % GIFT_COLORS.length], 2.5);
  dot(g, 56, BASE - 62, 9, GIFT_COLORS[i % GIFT_COLORS.length], 2.5);
  dot(g, 48, BASE - 58, 5, COLOR.primary, 2);
}

/** 기념물: 돌 받침 위의 상징 (게임마다 모양이 다르다) */
const plinth = (g: G, gold = false) => box(g, 12, BASE - 14, 72, 14, 5, gold ? COLOR.primary : ROULETTE.winter);
const MON: Partial<Record<BuildingType, (g: G) => void>> = {
  mon_tank1(g) { plinth(g); box(g, 26, BASE - 34, 44, 20, 6, COLOR.inkSoft); poly(g, [40, BASE - 44, 76, BASE - 62, 82, BASE - 52, 48, BASE - 30], COLOR.lineSoft); dot(g, 34, BASE - 16, 9, COLOR.inkSoft, 2.5); dot(g, 62, BASE - 16, 9, COLOR.inkSoft, 2.5); },
  mon_tank10(g) { plinth(g, true); box(g, 26, BASE - 34, 44, 20, 6, COLOR.primaryDeep); poly(g, [40, BASE - 44, 76, BASE - 62, 82, BASE - 52, 48, BASE - 30], COLOR.primary); dot(g, 34, BASE - 16, 9, COLOR.primary, 2.5); dot(g, 62, BASE - 16, 9, COLOR.primary, 2.5); dot(g, 80, BASE - 66, 6, COLOR.white, 2); },
  mon_volley1(g) { plinth(g); seg(g, 20, BASE - 14, 20, BASE - 70, 5); seg(g, 76, BASE - 14, 76, BASE - 70, 5); box(g, 20, BASE - 68, 56, 24, 2, COLOR.white, 2.5); g.lineStyle(1.5, COLOR.lineSoft, 1); for (let x = 30; x < 76; x += 10) g.lineBetween(x, BASE - 66, x, BASE - 46); g.lineBetween(22, BASE - 56, 74, BASE - 56); dot(g, 48, BASE - 26, 10, COLOR.primaryLight, 2.5); },
  mon_volley10(g) { plinth(g, true); seg(g, 30, BASE - 14, 30, BASE - 84, 5); poly(g, [32, BASE - 84, 78, BASE - 72, 32, BASE - 52], COLOR.cardRed); dot(g, 46, BASE - 70, 6, COLOR.primary, 2); dot(g, 30, BASE - 86, 5, COLOR.primary, 2); },
  mon_race1(g) { plinth(g); seg(g, 30, BASE - 14, 30, BASE - 84, 5); box(g, 32, BASE - 84, 44, 30, 2, COLOR.white, 2.5); g.fillStyle(COLOR.outline, 1); for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) g.fillRect(32 + i * 11, BASE - 84 + j * 10, 11, 10); },
  mon_race2(g) { plinth(g); box(g, 14, BASE - 70, 10, 58, 3, RACE.trackDark); box(g, 72, BASE - 70, 10, 58, 3, RACE.trackDark); box(g, 10, BASE - 86, 76, 20, 8, COLOR.cardRed); box(g, 24, BASE - 81, 48, 10, 3, COLOR.white, 2); },
  mon_surv_field(g) { plinth(g); statue(g, COLOR.lineSoft); poly(g, [36, BASE - 74, 40, BASE - 90, 46, BASE - 76], COLOR.primary, 2); poly(g, [50, BASE - 76, 56, BASE - 90, 60, BASE - 74], COLOR.primary, 2); },
  mon_surv_bamboo(g) { plinth(g); statue(g, COLOR.white); poly(g, [32, BASE - 70, 34, BASE - 92, 46, BASE - 78], COLOR.white, 2.5); poly(g, [50, BASE - 78, 62, BASE - 92, 64, BASE - 70], COLOR.white, 2.5); for (const x of [18, 78]) dot(g, x, BASE - 30, 8, COLOR.pink, 2); },
  mon_surv_palace(g) { plinth(g); g.lineStyle(13, COLOR.outline, 1).beginPath().arc(48, BASE - 44, 22, Math.PI * 0.2, Math.PI * 1.9).strokePath(); g.lineStyle(8, COLOR.win, 1).beginPath().arc(48, BASE - 44, 22, Math.PI * 0.2, Math.PI * 1.9).strokePath(); dot(g, 68, BASE - 56, 11, COLOR.win, 2.5); dot(g, 71, BASE - 59, 2.5, COLOR.outline, 0); dot(g, 48, BASE - 44, 7, COLOR.primary, 2); },
  mon_surv_underworld(g) { plinth(g, true); statue(g, COLOR.cardRed); box(g, 28, BASE - 92, 40, 12, 3, COLOR.outline, 0); box(g, 36, BASE - 100, 24, 10, 3, COLOR.outline, 0); seg(g, 22, BASE - 86, 22, BASE - 74, 3); seg(g, 74, BASE - 86, 74, BASE - 74, 3); },
  mon_def3(g) { for (const x of [26, 66]) seg(g, x, BASE, x - 2, BASE - 56, 6); seg(g, 26, BASE - 20, 66, BASE - 36, 3); seg(g, 66, BASE - 20, 26, BASE - 36, 3); box(g, 16, BASE - 68, 64, 14, 3, COLOR.emptyLine); roof(g, 48, BASE - 96, 70, 26, 2); },
  mon_def6(g) { box(g, 8, BASE - 50, 80, 50, 4, ROULETTE.winter); box(g, 34, BASE - 34, 28, 34, 12, COLOR.inkSoft); g.fillStyle(ROULETTE.winter, 1).fillRect(34, BASE - 3, 28, 3); roof(g, 48, BASE - 78, 92, 28, 3); },
  mon_def9(g) { box(g, 10, BASE - 16, 76, 16, 4, ROULETTE.winter); for (const x of [20, 46, 70]) box(g, x, BASE - 52, 7, 36, 2, COLOR.cardRed, 2.5); roof(g, 48, BASE - 76, 88, 26, 3); box(g, 30, BASE - 96, 36, 14, 3, COLOR.panel); roof(g, 48, BASE - 112, 54, 18, 3); },
  mon_def12(g) { box(g, 14, BASE - 12, 68, 12, 4, COLOR.primary); [0, 1, 2, 3].forEach((i) => { const w = 60 - i * 12; box(g, 48 - w / 2 + 5, BASE - 30 - i * 24, w - 10, 20, 3, COLOR.panel, 2.5); roof(g, 48, BASE - 40 - i * 24, w + 6, 12, 3); }); dot(g, 48, BASE - 116, 6, COLOR.primary, 2); },
  mon_matgo(g) { for (const x of [18, 72]) box(g, x, BASE - 16, 7, 16, 2, COLOR.inkSoft, 2); box(g, 8, BASE - 30, 80, 16, 5, COLOR.emptyLine); box(g, 20, BASE - 52, 18, 26, 3, COLOR.cardRed, 2.5); dot(g, 29, BASE - 40, 5, COLOR.white, 0); box(g, 42, BASE - 56, 18, 26, 3, COLOR.outline, 2.5); dot(g, 51, BASE - 46, 6, COLOR.primary, 0); box(g, 62, BASE - 50, 18, 26, 3, COLOR.cardRed, 2.5); dot(g, 71, BASE - 36, 4, COLOR.pink, 0); },
  mon_casino(g) { box(g, 8, BASE - 22, 80, 22, 10, ROULETTE.winter); box(g, 16, BASE - 18, 64, 10, 5, COLOR.teamA, 2); box(g, 42, BASE - 54, 12, 36, 4, COLOR.lineSoft); box(g, 28, BASE - 62, 40, 10, 5, ROULETTE.winter); dot(g, 48, BASE - 72, 9, COLOR.primary, 2.5); for (const [x, y] of [[26, BASE - 44], [70, BASE - 44], [20, BASE - 30], [76, BASE - 30]]) dot(g, x, y, 3.5, COLOR.teamA, 1.5); },
};
/** 석상의 몸 (서바이벌 보스 석상의 바탕) */
function statue(g: G, fill: number) {
  box(g, 30, BASE - 48, 36, 36, 10, fill);
  dot(g, 48, BASE - 62, 19, fill);
  dot(g, 41, BASE - 64, 3, COLOR.outline, 0);
  dot(g, 55, BASE - 64, 3, COLOR.outline, 0);
  seg(g, 42, BASE - 54, 54, BASE - 54, 3);
}

const MAIN: Partial<Record<BuildingType, (g: G, look: number) => void>> = {
  hall: drawHall, paddy: drawPaddy, house: drawHouse, lumber: drawLumber, storage: drawStorage, market: drawMarket, quarry: drawQuarry, mill: drawMill, jar: drawJar,
  pavilion: drawPavilion, feast: drawFeast, shrine: drawShrine,
};

/** 짓는 중인 터: 다진 흙바닥 + 말뚝과 줄 + 쌓아 둔 널빤지와 삽 */
function drawSite(g: G, w: number, h: number) {
  const top = RISE * w;
  const W = w * CELL;
  const H = h * CELL;
  box(g, 8, top + 10, W - 16, H - 20, 14, RACE.track);
  // 흙더미
  box(g, W * 0.12, top + H - 44, W * 0.34, 30, 14, RACE.trackDark, 2.5);
  // 널빤지
  for (let i = 0; i < 3; i++) box(g, W * 0.5, top + H - 26 - i * 9, W * 0.36, 9, 3, COLOR.emptyLine, 2);
  // 네 귀퉁이 말뚝과 줄
  const posts = [[14, top + 16], [W - 14, top + 16], [14, top + H - 14], [W - 14, top + H - 14]];
  g.lineStyle(2.5, COLOR.cardRed, 1).strokeRect(14, top + 8, W - 28, H - 30);
  for (const [x, y] of posts) box(g, x - 4, y - 18, 8, 22, 3, COLOR.inkSoft, 2);
  // 삽
  seg(g, W * 0.3, top + H - 40, W * 0.38, top + H - 78, 5);
  seg(g, W * 0.3, top + H - 40, W * 0.38, top + H - 78, 2, COLOR.emptyLine);
  poly(g, [W * 0.24, top + H - 40, W * 0.36, top + H - 44, W * 0.33, top + H - 26, W * 0.26, top + H - 24], ROULETTE.winter, 2);
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
  } else if (res === 'wood') {
    box(g, cx - 15, cy - 7, 30, 14, 7, COLOR.inkSoft, 2.5);
    dot(g, cx + 10, cy, 6, COLOR.panel, 2);
  } else if (res === 'stone') {
    poly(g, [cx - 14, cy + 10, cx - 10, cy - 6, cx + 2, cy - 13, cx + 13, cy - 4, cx + 15, cy + 10], ROULETTE.winter, 2.5);
  } else if (res === 'cake') {
    box(g, cx - 14, cy - 10, 28, 20, 9, COLOR.white, 2.5);
    dot(g, cx, cy, 4.5, COLOR.pink, 1.5);
  } else {
    // 특산품: 작은 항아리
    box(g, cx - 11, cy - 9, 22, 22, 9, COLOR.inkSoft, 2.5);
    box(g, cx - 8, cy - 14, 16, 7, 3, COLOR.emptyLine, 2);
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
export const BUBBLE_RES = ['rice', 'wood', 'stone', 'cake', 'special'] as const;

export function makeTextures(scene: Phaser.Scene, files: Set<string> = new Set()) {
  let gifts = 0;
  for (const d of BUILDINGS) {
    const sz = texSize(d.w, d.h);
    const main = MAIN[d.id];
    if (main) for (const look of [1, 2, 3]) make(scene, texKey(d.id, look), sz.w, sz.h, (g) => main(g, look));
    else if (isGift(d.id)) {
      const i = gifts++;
      make(scene, texKey(d.id, 1), sz.w, sz.h, (g) => drawGift(g, i));
    } else if (isMonument(d.id)) make(scene, texKey(d.id, 1), sz.w, sz.h, (g) => MON[d.id]?.(g));
    else make(scene, texKey(d.id, 1), sz.w, sz.h, (g) => DECO[d.id]?.(g));
  }
  for (const w of [1, 2]) {
    const sz = texSize(w, w);
    make(scene, `site-${w}`, sz.w, sz.h, (g) => drawSite(g, w, w));
  }
  for (const res of BUBBLE_RES) {
    make(scene, `bubble-${res}`, BUBBLE, BUBBLE + 10, (g) => {
      poly(g, [BUBBLE / 2 - 9, BUBBLE - 12, BUBBLE / 2 + 9, BUBBLE - 12, BUBBLE / 2, BUBBLE + 6], COLOR.white);
      dot(g, BUBBLE / 2, BUBBLE / 2 - 2, BUBBLE / 2 - 5, COLOR.white);
      g.fillStyle(COLOR.white, 1).fillRect(BUBBLE / 2 - 7, BUBBLE - 16, 14, 8);
      drawRes(g, res, BUBBLE / 2, BUBBLE / 2 - 2);
    });
  }
  // 땅 밖의 나무
  const outTree = (g: G, x: number, y: number) => {
    box(g, x + 42, y + 58, 12, 26, 3, COLOR.inkSoft, 2.5);
    dot(g, x + 48, y + 40, 26, TABLE.matgo);
    dot(g, x + 38, y + 34, 6, MATGO.matLight, 0);
  };
  make(scene, 'tree', CELL, CELL, (g) => outTree(g, 0, 0));
  // 밤의 등불 빛: 가운데가 밝은 노란 동그라미 (더하기로 겹친다)
  make(scene, 'glow', 128, 128, (g) => {
    for (let i = 10; i >= 1; i--) g.fillStyle(COLOR.primaryLight, 0.06 + (10 - i) * 0.012).fillCircle(64, 64, i * 6.2);
  });
  // 더 먼 숲: FOREST_CELLS 칸 한 장을 되풀이해 깐다 (나무는 가장자리에 걸치지 않게, 1배로 그려 가볍게)
  // 나무 그림 파일이 있으면 그것을 찍어 만든다 (땅 밖 가까운 나무와 같은 그림)
  if (!scene.textures.exists('forest') && files.has(texKey('tree', 1))) {
    const T = FOREST_CELLS * CELL;
    // TileSprite 는 DynamicTexture 를 못 쓰므로 캔버스 텍스처에 그린다
    const ct = scene.textures.createCanvas('forest', T, T);
    if (ct) {
      const c = ct.getContext();
      // 들판 무늬가 있으면 그 위에 겹쳐 깔리므로 바탕은 비워 둔다 (VillageScene 이 tile-meadow 를 아래에 깐다)
      if (!files.has('tile-meadow')) {
        c.fillStyle = `#${MATGO.matDark.toString(16).padStart(6, '0')}`;
        c.fillRect(0, 0, T, T);
      }
      c.filter = 'brightness(0.88) saturate(0.9)';
      for (let y = 0; y < FOREST_CELLS; y++) {
        for (let x = 0; x < FOREST_CELLS; x++) {
          const h = ((x * 73856093) ^ (y * 19349663) ^ 0x5bd1e995) >>> 0;
          if (h % 3 !== 0) continue;
          const n = pickNature(h, files);
          if (!n) continue;
          const src = scene.textures.get(n.key).getSourceImage() as HTMLImageElement;
          const tw = CELL * n.size;
          const th = (tw * src.height) / src.width;
          const ox = Math.min(T - tw - 2, Math.max(2, x * CELL + (CELL - tw) / 2 + (h % 17) - 8));
          const oy = Math.min(T - th - 2, Math.max(2, y * CELL + CELL - th + ((h >> 5) % 17) - 8 + CELL * 0.6));
          c.drawImage(src, ox, oy, tw, th);
        }
      }
      ct.refresh();
    }
  }
  if (!scene.textures.exists('forest')) {
    const T = FOREST_CELLS * CELL;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(MATGO.matDark, 1).fillRect(0, 0, T, T);
    for (let y = 0; y < FOREST_CELLS; y++) {
      for (let x = 0; x < FOREST_CELLS; x++) {
        const h = ((x * 73856093) ^ (y * 19349663) ^ 0x5bd1e995) >>> 0;
        if (h % 3 !== 0) continue;
        const ox = Math.min(T - CELL - 2, Math.max(2, x * CELL + (h % 17) - 8));
        const oy = Math.min(T - CELL - 2, Math.max(2, y * CELL + ((h >> 5) % 17) - 8));
        outTree(g, ox, oy);
      }
    }
    g.generateTexture('forest', T, T);
    g.destroy();
  }
}

/** 그 건물이 만드는 것의 방울 그림 이름 (없으면 null) */
export function bubbleKey(type: BuildingType, craftOut: string | null): string | null {
  const res = craftOut ?? BUILDING[type].product;
  return res && (BUBBLE_RES as readonly string[]).includes(res) ? `bubble-${res}` : null;
}
