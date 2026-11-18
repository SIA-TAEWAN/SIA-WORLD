import Phaser from 'phaser';
import { COLOR } from '../theme';
import { BALL_R, ZODIAC_IDS, type ZodiacId } from '../game/constants';
import { zodiacFullUrl } from '../assets';

/**
 * 그림 목록. 지금은 모두 코드로 그린 그림이다 (DESIGN.md 색·외곽선 규칙).
 * 정식 그림은 ASSETS.md 의 파일 이름으로 public/art/<이름>.png 에 넣고, ART_FILES 에 이름을 적으면
 * 그 그림을 먼저 쓰고 못 불러올 때만 코드 그림으로 대신한다 (시아레이스와 같은 방식).
 * 쓸 수 있는 이름: 'bg-0' 'bg-1' 'bg-2'(배경, scenes/backdrop.ts) · 'ball' · 'net' · 'dust' · 'star' · 'spark'
 * (파일이 없는 이름을 적어 두면 경기마다 404 요청이 나가므로, 파일을 넣은 것만 적는다)
 */
export const ART_FILES: readonly string[] = [];

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

/** 공 그림 크기 (지름 48을 두 배로 그려 두고 줄여 쓴다) */
export const BALL_TEX = BALL_R * 4;

/** 못 불러온 그림을 코드로 그려 채운다 (외곽선 + 단색, DESIGN.md 임시 그림 규칙) */
export function ensureArt(scene: Phaser.Scene, chars: readonly ZodiacId[]) {
  // 배구공: 흰 공 + 노랑·파랑 조각 + 굵은 외곽선
  make(scene, 'ball', BALL_TEX, BALL_TEX, (g) => {
    const c = BALL_TEX / 2;
    const r = c - 5;
    g.fillStyle(COLOR.white, 1).fillCircle(c, c, r);
    g.fillStyle(COLOR.primary, 1).slice(c, c, r, -2.6, -1.1, false).fillPath();
    g.fillStyle(COLOR.teamA, 1).slice(c, c, r, 0.5, 2.0, false).fillPath();
    g.fillStyle(COLOR.white, 1).fillCircle(c, c, r * 0.4);
    g.lineStyle(4, COLOR.outline, 1);
    g.beginPath().arc(c - r * 0.9, c - r * 0.5, r * 1.05, -0.5, 0.95, false).strokePath();
    g.beginPath().arc(c + r * 0.95, c + r * 0.35, r * 1.05, 2.6, 4.1, false).strokePath();
    g.beginPath().arc(c - r * 0.1, c + r * 1.2, r * 1.0, -2.2, -0.9, false).strokePath();
    g.lineStyle(7, COLOR.outline, 1).strokeCircle(c, c, r);
  });
  make(scene, 'shadow', 64, 24, (g) => g.fillStyle(COLOR.outline, 1).fillEllipse(32, 12, 60, 20));
  make(scene, 'dust', 48, 48, (g) => {
    g.fillStyle(COLOR.panel, 1).fillCircle(24, 24, 18);
    g.lineStyle(3, COLOR.emptyLine, 1).strokeCircle(24, 24, 18);
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
  make(scene, 'spark', 64, 32, (g) => g.fillStyle(COLOR.primaryLight, 1).fillTriangle(0, 16, 64, 6, 64, 26));
  make(scene, 'confetti', 12, 12, (g) => g.fillStyle(COLOR.white, 1).fillRect(0, 0, 12, 12));
  make(scene, 'cloud', 200, 96, (g) => {
    g.fillStyle(COLOR.white, 1);
    for (const [x, y, r] of [[52, 58, 30], [92, 44, 38], [140, 56, 32], [100, 66, 30]]) g.fillCircle(x, y, r);
  });
  // 캐릭터 그림을 못 불러오면 동그란 임시 그림
  chars.forEach((id, i) =>
    make(scene, zKey(id), 96, 120, (g) => {
      g.fillStyle([COLOR.primary, COLOR.teamA, COLOR.pink, COLOR.win][i % 4], 1).fillRoundedRect(8, 8, 80, 104, 36);
      line(g, 5).strokeRoundedRect(8, 8, 80, 104, 36);
      g.fillStyle(COLOR.outline, 1).fillCircle(36, 48, 6).fillCircle(60, 48, 6);
    }),
  );
}
