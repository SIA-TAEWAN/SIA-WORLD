import Phaser from 'phaser';
import { COLOR, RACE } from '../theme';
import { ZODIAC_IDS, type ZodiacId } from '../game/constants';
import { zodiacFullUrl } from '../assets';

/**
 * 그림 목록. public/art/<이름>.png (SpriteCook, 원본 asset id: spritecook-assets.json) 를 쓰고,
 * 파일을 못 불러오면 아래 코드 그림(임시 그림)으로 대신한다.
 */
export const ART_FILES = ['track', 'sky', 'stands', 'hurdle', 'banana', 'log', 'mudShort', 'mudLong', 'boost', 'marker', 'flag', 'dust', 'splash', 'star', 'spark'] as const;
export type ArtKey = (typeof ART_FILES)[number];

export const zKey = (id: ZodiacId) => `z-${id}`;

export function preloadArt(scene: Phaser.Scene, chars: readonly ZodiacId[]) {
  const base = import.meta.env.BASE_URL;
  for (const k of ART_FILES) if (!scene.textures.exists(k)) scene.load.image(k, `${base}art/${k}.png`);
  for (const id of chars) if (ZODIAC_IDS.includes(id) && !scene.textures.exists(zKey(id))) scene.load.image(zKey(id), zodiacFullUrl(id));
}

type G = Phaser.GameObjects.Graphics;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

const line = (g: G, w = 4) => g.lineStyle(w, COLOR.outline, 1);

/** 못 불러온 그림을 코드로 그려 채운다 (외곽선 + 단색, DESIGN.md 임시 그림 규칙) */
export function ensureArt(scene: Phaser.Scene, chars: readonly ZodiacId[]) {
  make(scene, 'track', 128, 128, (g) => {
    g.fillStyle(RACE.track, 1).fillRect(0, 0, 128, 128);
    g.fillStyle(RACE.trackDark, 0.35);
    for (let i = 0; i < 14; i++) g.fillCircle((i * 53) % 128, (i * 37 + 11) % 128, 2 + (i % 3));
  });
  make(scene, 'sky', 256, 128, (g) => {
    g.fillGradientStyle(COLOR.skyTop, COLOR.skyTop, COLOR.skyMid, COLOR.skyMid, 1).fillRect(0, 0, 256, 128);
    g.fillStyle(COLOR.white, 0.9);
    for (const [x, y, r] of [[50, 40, 16], [70, 36, 20], [92, 42, 14], [180, 70, 14], [198, 66, 18], [216, 72, 12]]) g.fillCircle(x, y, r);
  });
  make(scene, 'stands', 256, 128, (g) => {
    g.fillStyle(COLOR.panel, 1).fillRect(0, 34, 256, 94);
    line(g).strokeRect(-4, 34, 264, 100);
    const cols = [COLOR.teamA, COLOR.pink, COLOR.primary, COLOR.win, COLOR.white];
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 9; i++) {
        const x = 14 + i * 28 + (row % 2) * 14;
        const y = 56 + row * 26;
        g.fillStyle(cols[(i + row * 2) % cols.length], 1).fillCircle(x, y, 9);
        g.lineStyle(2, COLOR.outline, 1).strokeCircle(x, y, 9);
      }
    g.fillStyle(COLOR.pink, 1).fillRect(0, 18, 256, 18);
    line(g, 3).strokeRect(-4, 18, 264, 18);
  });
  make(scene, 'hurdle', 96, 128, (g) => {
    g.fillStyle(COLOR.white, 1);
    line(g, 5);
    g.fillRect(14, 26, 12, 96).strokeRect(14, 26, 12, 96);
    g.fillRect(70, 26, 12, 96).strokeRect(70, 26, 12, 96);
    g.fillStyle(COLOR.pink, 1).fillRoundedRect(6, 10, 84, 26, 8).strokeRoundedRect(6, 10, 84, 26, 8);
    g.fillStyle(COLOR.white, 1).fillRect(34, 12, 12, 22).fillRect(58, 12, 12, 22);
  });
  make(scene, 'banana', 96, 64, (g) => {
    g.fillStyle(COLOR.primary, 1);
    line(g, 5);
    g.beginPath();
    g.arc(48, 10, 40, 0.25, Math.PI - 0.25, false);
    g.arc(48, -6, 44, Math.PI - 0.5, 0.5, true);
    g.closePath().fillPath().strokePath();
    g.fillStyle(COLOR.outline, 1).fillCircle(14, 30, 4).fillCircle(82, 30, 4);
  });
  make(scene, 'log', 128, 128, (g) => {
    g.fillStyle(COLOR.emptyLine, 1).fillCircle(64, 64, 58);
    line(g, 6).strokeCircle(64, 64, 58);
    g.fillStyle(COLOR.skyBottom, 1).fillCircle(64, 64, 40);
    g.lineStyle(4, COLOR.emptyLine, 1).strokeCircle(64, 64, 26).strokeCircle(64, 64, 12);
    line(g, 4).strokeCircle(64, 64, 40);
    g.lineStyle(5, COLOR.outline, 1).lineBetween(64, 6, 64, 22);
  });
  for (const [key, w] of [['mudShort', 256], ['mudLong', 512]] as const)
    make(scene, key, w, 64, (g) => {
      g.fillStyle(COLOR.inkSoft, 1).fillEllipse(w / 2, 34, w - 10, 50);
      line(g, 5).strokeEllipse(w / 2, 34, w - 10, 50);
      g.fillStyle(COLOR.outline, 1);
      for (let i = 0; i < w / 50; i++) g.fillEllipse(30 + i * 48, 30 + (i % 2) * 10, 26, 10);
    });
  make(scene, 'boost', 128, 48, (g) => {
    g.fillStyle(COLOR.teamA, 1).fillRoundedRect(4, 8, 120, 34, 12);
    line(g, 5).strokeRoundedRect(4, 8, 120, 34, 12);
    g.fillStyle(COLOR.primary, 1);
    for (const x of [22, 54, 86]) g.fillTriangle(x, 14, x + 20, 25, x, 36);
  });
  make(scene, 'start', 48, 128, (g) => {
    g.fillStyle(COLOR.white, 1).fillRect(12, 0, 24, 128);
    line(g, 4).lineBetween(12, 0, 12, 128).lineBetween(36, 0, 36, 128);
  });
  make(scene, 'finish', 64, 128, (g) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 3; x++) g.fillStyle((x + y) % 2 ? COLOR.outline : COLOR.white, 1).fillRect(8 + x * 16, y * 16, 16, 16);
    line(g, 4).lineBetween(8, 0, 8, 128).lineBetween(56, 0, 56, 128);
  });
  make(scene, 'flag', 64, 64, (g) => {
    g.fillStyle(COLOR.outline, 1).fillRect(8, 4, 6, 58);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) g.fillStyle((x + y) % 2 ? COLOR.outline : COLOR.white, 1).fillRect(14 + x * 11, 6 + y * 11, 11, 11);
    line(g, 3).strokeRect(14, 6, 44, 33);
  });
  make(scene, 'marker', 96, 64, (g) => {
    g.fillStyle(COLOR.panel, 1).fillRoundedRect(4, 4, 88, 42, 12);
    line(g, 4).strokeRoundedRect(4, 4, 88, 42, 12);
    g.fillStyle(COLOR.outline, 1).fillRect(44, 46, 8, 18);
  });
  make(scene, 'dust', 48, 48, (g) => {
    g.fillStyle(COLOR.panel, 1).fillCircle(24, 24, 18);
    g.lineStyle(3, COLOR.emptyLine, 1).strokeCircle(24, 24, 18);
  });
  make(scene, 'splash', 48, 48, (g) => {
    g.fillStyle(COLOR.inkSoft, 1).fillCircle(24, 28, 14).fillTriangle(12, 24, 24, 2, 36, 24);
    line(g, 3).strokeCircle(24, 28, 14);
  });
  make(scene, 'star', 64, 64, (g) => {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 12 : 28;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(new Phaser.Math.Vector2(32 + Math.cos(a) * r, 32 + Math.sin(a) * r));
    }
    g.fillStyle(COLOR.primary, 1).fillPoints(pts, true);
    line(g, 4).strokePoints(pts, true);
  });
  make(scene, 'spark', 64, 32, (g) => {
    g.fillStyle(COLOR.primaryLight, 1).fillTriangle(0, 16, 64, 6, 64, 26);
  });
  // 색종이 (코드 그림만 쓴다)
  make(scene, 'confetti', 12, 12, (g) => g.fillStyle(COLOR.white, 1).fillRect(0, 0, 12, 12));
  make(scene, 'shadow', 64, 24, (g) => g.fillStyle(COLOR.outline, 1).fillEllipse(32, 12, 60, 20));
  // 캐릭터 그림을 못 불러오면 동그란 임시 그림
  chars.forEach((id, i) =>
    make(scene, zKey(id), 96, 120, (g) => {
      g.fillStyle([COLOR.primary, COLOR.teamA, COLOR.pink, COLOR.win][i % 4], 1).fillRoundedRect(8, 8, 80, 104, 36);
      line(g, 5).strokeRoundedRect(8, 8, 80, 104, 36);
      g.fillStyle(COLOR.outline, 1).fillCircle(36, 48, 6).fillCircle(60, 48, 6);
    }),
  );
}
