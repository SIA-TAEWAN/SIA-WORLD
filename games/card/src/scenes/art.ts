/**
 * 코드 그림 (그림 파일을 아직 연결하지 않은 단계 · 그림을 못 읽었을 때). 색은 shared/theme.js 값만 쓴다 (DESIGN.md).
 * 3단계에서 public/art/<이름>.png 를 연결하면 같은 자리에 그림이 들어간다.
 */
import Phaser from 'phaser';
import { COLOR, FONT } from '../theme';
import type { CardKind, Intent, StatusId } from '../game/rules';

export const KIND_COLOR: Record<CardKind, number> = {
  atk: COLOR.cardRed,
  def: COLOR.teamA,
  skill: COLOR.win,
  power: COLOR.accent,
  curse: COLOR.draw,
};
export const RARITY_RING: Record<string, number> = {
  basic: COLOR.lineSoft,
  common: COLOR.white,
  uncommon: COLOR.teamA,
  legend: COLOR.primary,
  hero: COLOR.pink,
  hero2: COLOR.pink,
  curse: COLOR.draw,
};
export const STATUS_COLOR: Record<StatusId | 'str', number> = {
  fire: COLOR.cardRed,
  poison: COLOR.win,
  wet: COLOR.teamA,
  mud: COLOR.inkSoft,
  weak: COLOR.draw,
  str: COLOR.pink,
};
export const STATUS_SHORT: Record<StatusId | 'str', string> = { fire: '화', poison: '독', wet: '젖', mud: '흙', weak: '약', str: '힘' };

/** 요괴 몸 색 (그림 대신) */
const FOE_COLOR: Record<string, number> = {
  bamboo: COLOR.win,
  fox: COLOR.accent,
  acorn: COLOR.inkSoft,
  lynx: COLOR.draw,
  gumiho: COLOR.pink,
  gumihoClone: COLOR.primaryLight,
  jangsanbeom: COLOR.white,
  centipede: COLOR.cardRed,
};
export const foeColor = (id: string) => FOE_COLOR[id] ?? COLOR.skyDeep;

export function txt(scene: Phaser.Scene, x: number, y: number, s: string, size: number, color = COLOR.ink, stroke = 0): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, s, {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color: `#${color.toString(16).padStart(6, '0')}`,
    align: 'center',
  });
  if (stroke) t.setStroke('#2a1a10', stroke);
  t.setOrigin(0.5);
  return t;
}

/** 요괴 코드 그림: 둥근 몸 + 눈 + (보스) 뿔 */
export function drawFoe(g: Phaser.GameObjects.Graphics, id: string, r: number, boss: boolean) {
  g.clear();
  const c = foeColor(id);
  g.fillStyle(COLOR.outline, 0.18);
  g.fillEllipse(0, r * 0.95, r * 1.7, r * 0.4);
  if (boss) {
    g.fillStyle(COLOR.outline, 1);
    g.fillTriangle(-r * 0.7, -r * 0.55, -r * 0.35, -r * 1.25, -r * 0.1, -r * 0.75);
    g.fillTriangle(r * 0.7, -r * 0.55, r * 0.35, -r * 1.25, r * 0.1, -r * 0.75);
  }
  g.lineStyle(3, COLOR.outline, 1);
  g.fillStyle(c, 1);
  g.fillCircle(0, 0, r);
  g.strokeCircle(0, 0, r);
  // 배
  g.fillStyle(COLOR.white, 0.35);
  g.fillEllipse(0, r * 0.35, r * 1.1, r * 0.8);
  // 눈
  const ey = -r * 0.15;
  const ex = r * 0.35;
  g.fillStyle(COLOR.white, 1);
  g.fillCircle(-ex, ey, r * 0.2);
  g.fillCircle(ex, ey, r * 0.2);
  g.fillStyle(COLOR.outline, 1);
  g.fillCircle(-ex + r * 0.04, ey + r * 0.03, r * 0.1);
  g.fillCircle(ex + r * 0.04, ey + r * 0.03, r * 0.1);
  // 성난 눈썹
  g.lineStyle(3, COLOR.outline, 1);
  g.lineBetween(-ex - r * 0.2, ey - r * 0.3, -ex + r * 0.15, ey - r * 0.18);
  g.lineBetween(ex + r * 0.2, ey - r * 0.3, ex - r * 0.15, ey - r * 0.18);
}

/** 영웅 코드 그림 (그림을 못 읽었을 때) */
export function drawHero(g: Phaser.GameObjects.Graphics, r: number) {
  g.clear();
  g.fillStyle(COLOR.outline, 0.18);
  g.fillEllipse(0, r * 0.95, r * 1.6, r * 0.35);
  g.lineStyle(3, COLOR.outline, 1);
  g.fillStyle(COLOR.accent, 1);
  g.fillCircle(-r * 0.62, -r * 0.7, r * 0.28);
  g.fillCircle(r * 0.62, -r * 0.7, r * 0.28);
  g.strokeCircle(-r * 0.62, -r * 0.7, r * 0.28);
  g.strokeCircle(r * 0.62, -r * 0.7, r * 0.28);
  g.fillCircle(0, 0, r);
  g.strokeCircle(0, 0, r);
  g.fillStyle(COLOR.white, 1);
  g.fillEllipse(0, r * 0.3, r * 1.1, r * 0.75);
  g.fillStyle(COLOR.outline, 1);
  g.fillCircle(-r * 0.32, -r * 0.12, r * 0.1);
  g.fillCircle(r * 0.32, -r * 0.12, r * 0.1);
  g.fillStyle(COLOR.pink, 0.5);
  g.fillCircle(-r * 0.55, r * 0.15, r * 0.12);
  g.fillCircle(r * 0.55, r * 0.15, r * 0.12);
}

/** 의도 아이콘 (5종) */
export function drawIntent(g: Phaser.GameObjects.Graphics, kind: Intent, s: number) {
  g.clear();
  const col: Record<Intent, number> = { atk: COLOR.pink, def: COLOR.teamA, buff: COLOR.win, debuff: COLOR.inkSoft, unknown: COLOR.draw };
  g.lineStyle(3, COLOR.outline, 1);
  g.fillStyle(col[kind], 1);
  if (kind === 'atk') {
    // 칼
    g.fillTriangle(-s * 0.15, s * 0.25, s * 0.15, s * 0.25, 0, -s * 0.6);
    g.strokeTriangle(-s * 0.15, s * 0.25, s * 0.15, s * 0.25, 0, -s * 0.6);
    g.fillStyle(COLOR.outline, 1);
    g.fillRect(-s * 0.32, s * 0.22, s * 0.64, s * 0.1);
    g.fillRect(-s * 0.06, s * 0.3, s * 0.12, s * 0.28);
  } else if (kind === 'def') {
    g.beginPath();
    g.moveTo(-s * 0.45, -s * 0.45);
    g.lineTo(s * 0.45, -s * 0.45);
    g.lineTo(s * 0.4, s * 0.1);
    g.lineTo(0, s * 0.55);
    g.lineTo(-s * 0.4, s * 0.1);
    g.closePath();
    g.fillPath();
    g.strokePath();
  } else if (kind === 'buff') {
    g.fillTriangle(-s * 0.45, 0, s * 0.45, 0, 0, -s * 0.55);
    g.strokeTriangle(-s * 0.45, 0, s * 0.45, 0, 0, -s * 0.55);
    g.fillRect(-s * 0.18, 0, s * 0.36, s * 0.5);
    g.strokeRect(-s * 0.18, 0, s * 0.36, s * 0.5);
  } else if (kind === 'debuff') {
    g.fillCircle(0, 0, s * 0.45);
    g.strokeCircle(0, 0, s * 0.45);
    g.lineStyle(3, COLOR.white, 1);
    g.beginPath();
    g.arc(0, 0, s * 0.25, 0, Math.PI * 1.5);
    g.strokePath();
  } else {
    g.fillCircle(0, 0, s * 0.45);
    g.strokeCircle(0, 0, s * 0.45);
  }
}

/** 카드 가운데 그림 자리 (종류 기호) */
export function drawKindGlyph(g: Phaser.GameObjects.Graphics, kind: CardKind, s: number) {
  g.lineStyle(3, COLOR.outline, 1);
  g.fillStyle(COLOR.white, 1);
  if (kind === 'atk') {
    g.fillTriangle(-s * 0.12, s * 0.3, s * 0.12, s * 0.3, s * 0.35, -s * 0.5);
    g.strokeTriangle(-s * 0.12, s * 0.3, s * 0.12, s * 0.3, s * 0.35, -s * 0.5);
    g.fillStyle(COLOR.outline, 1);
    g.fillRect(-s * 0.3, s * 0.28, s * 0.5, s * 0.1);
  } else if (kind === 'def') {
    drawIntent(g, 'def', s);
  } else if (kind === 'skill') {
    const pts: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? s * 0.2 : s * 0.48;
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }
    g.fillPoints(pts, true);
    g.strokePoints(pts, true);
  } else if (kind === 'power') {
    g.fillCircle(0, 0, s * 0.3);
    g.strokeCircle(0, 0, s * 0.3);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g.lineBetween(Math.cos(a) * s * 0.38, Math.sin(a) * s * 0.38, Math.cos(a) * s * 0.52, Math.sin(a) * s * 0.52);
    }
  } else {
    g.fillStyle(COLOR.draw, 1);
    g.fillCircle(0, 0, s * 0.4);
    g.strokeCircle(0, 0, s * 0.4);
  }
}
