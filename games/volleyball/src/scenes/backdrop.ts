import Phaser from 'phaser';
import { CEIL, COURT_H, COURT_W, FLOOR_Y, LEFT, RIGHT, type ZodiacId } from '../game/constants';
import { COLOR, MATGO, RACE, ROULETTE, TABLE } from '../theme';

/**
 * 경기장 배경 3종 (경기마다 무작위: 시작 알림의 bg). 벽·바닥·네트의 자리와 크기는 셋 다 같다.
 *   0 낮의 풀밭 마당 (쥐·소·호랑이·토끼)
 *   1 노을 지는 기와지붕 마을 (용·뱀·말·양)
 *   2 밤의 달과 등불 (원숭이·닭·개·돼지)
 * 지금은 코드로 그린 그림이다. public/art/bg-<번호>.png 를 넣고 art.ts 의 ART_FILES 에 'bg-0' 처럼 적으면 그 그림을 쓴다.
 * 색은 DESIGN.md(shared/theme.js) 값만 쓴다.
 */
export const BG_COUNT = 3;
export const BG_NAME = ['낮의 풀밭 마당', '노을 지는 기와지붕 마을', '밤의 달과 등불'] as const;
/** 배경마다 응원 깃발에 걸리는 십이지 네 마리 */
export const BG_ZODIAC: readonly (readonly ZodiacId[])[] = [
  ['rat', 'ox', 'tiger', 'rabbit'],
  ['dragon', 'snake', 'horse', 'sheep'],
  ['monkey', 'rooster', 'dog', 'pig'],
];
/** 바닥 색 [윗면, 옆면] */
const FLOOR: readonly (readonly [number, number])[] = [
  [MATGO.matLight, MATGO.matDark],
  [RACE.track, RACE.trackDark],
  [ROULETTE.winter, COLOR.inkSoft],
];

export const flagKey = (id: ZodiacId) => `flag-${id}`;

type G = Phaser.GameObjects.Graphics;

/** 둥근 언덕 */
function hill(g: G, x: number, w: number, h: number, color: number, alpha = 1) {
  g.fillStyle(color, alpha).fillEllipse(x, FLOOR_Y, w, h * 2);
}

/** 기와지붕 집 한 채 (노을 마을) */
function house(g: G, x: number, w: number, h: number) {
  const top = FLOOR_Y - h;
  // 벽
  g.fillStyle(COLOR.panel, 0.9).fillRect(x - w * 0.36, top + h * 0.38, w * 0.72, h * 0.62);
  g.fillStyle(COLOR.emptyLine, 0.9).fillRect(x - w * 0.36, top + h * 0.38, w * 0.72, 6);
  g.fillStyle(COLOR.primaryLight, 0.9).fillRect(x - w * 0.12, top + h * 0.58, w * 0.24, h * 0.22);
  // 지붕: 끝이 살짝 들린 기와
  g.fillStyle(COLOR.inkSoft, 1);
  g.beginPath();
  g.moveTo(x - w / 2, top + h * 0.42);
  g.lineTo(x - w * 0.42, top + h * 0.28);
  g.lineTo(x - w * 0.16, top + h * 0.06);
  g.lineTo(x + w * 0.16, top + h * 0.06);
  g.lineTo(x + w * 0.42, top + h * 0.28);
  g.lineTo(x + w / 2, top + h * 0.42);
  g.closePath().fillPath();
  g.fillStyle(COLOR.outline, 0.55).fillRect(x - w * 0.2, top + h * 0.02, w * 0.4, 7);
  g.fillStyle(COLOR.outline, 0.25);
  for (let i = -3; i <= 3; i++) g.fillRect(x + i * w * 0.1 - 2, top + h * 0.12, 4, h * 0.26);
}

/** 등불 하나 (밤) */
function lantern(g: G, x: number, y: number, color: number) {
  g.fillStyle(color, 0.22).fillCircle(x, y + 16, 34);
  g.fillStyle(COLOR.outline, 1).fillRect(x - 1.5, y - 12, 3, 14);
  g.fillStyle(color, 1).fillRoundedRect(x - 15, y, 30, 34, 12);
  g.lineStyle(3, COLOR.outline, 1).strokeRoundedRect(x - 15, y, 30, 34, 12);
  g.fillStyle(COLOR.outline, 1).fillRect(x - 9, y - 3, 18, 5).fillRect(x - 9, y + 32, 18, 5);
  g.fillStyle(COLOR.white, 0.55).fillRoundedRect(x - 9, y + 6, 6, 18, 3);
}

/** 배경을 그린다 (깊이 0~4). 그림 파일(bg-<번호>)을 불러왔으면 그것을 깐다 */
export function drawBackdrop(scene: Phaser.Scene, bg: number) {
  const n = ((Math.floor(bg) % BG_COUNT) + BG_COUNT) % BG_COUNT;
  if (scene.textures.exists(`bg-${n}`)) {
    // 정식 그림: 벽·바닥까지 한 장에 그려져 있다 (720×840)
    scene.add.image(0, 0, `bg-${n}`).setOrigin(0).setDisplaySize(COURT_W, COURT_H).setDepth(0);
    return;
  }
  const g = scene.add.graphics().setDepth(0);
  const cloud = (x: number, y: number, s: number, alpha: number, tint?: number) => {
    const c = scene.add.image(x, y, 'cloud').setScale(s).setAlpha(alpha).setDepth(1);
    if (tint !== undefined) c.setTint(tint);
  };

  if (n === 0) {
    // 낮의 풀밭 마당
    g.fillGradientStyle(COLOR.skyTop, COLOR.skyTop, COLOR.skyMid, COLOR.skyMid, 1).fillRect(0, 0, COURT_W, FLOOR_Y);
    g.fillStyle(COLOR.primaryLight, 0.35).fillCircle(590, 150, 78);
    g.fillStyle(COLOR.primaryLight, 1).fillCircle(590, 150, 52);
    cloud(150, 170, 1, 0.92);
    cloud(430, 250, 0.75, 0.8);
    cloud(300, 100, 0.55, 0.7);
    hill(g, 120, 520, 150, TABLE.matgo, 0.75);
    hill(g, 600, 640, 190, MATGO.matLight, 0.8);
    hill(g, 360, 900, 90, MATGO.matDark, 0.55);
    // 낮은 울타리
    g.fillStyle(COLOR.panel, 0.95);
    for (let x = LEFT + 14; x < RIGHT; x += 46) g.fillRoundedRect(x, FLOOR_Y - 46, 12, 46, { tl: 6, tr: 6, bl: 0, br: 0 });
    g.fillRect(LEFT, FLOOR_Y - 34, RIGHT - LEFT, 7).fillRect(LEFT, FLOOR_Y - 16, RIGHT - LEFT, 7);
  } else if (n === 1) {
    // 노을 지는 기와지붕 마을
    g.fillGradientStyle(ROULETTE.summer, ROULETTE.summer, COLOR.skyBottom, COLOR.skyBottom, 1).fillRect(0, 0, COURT_W, FLOOR_Y);
    g.fillStyle(COLOR.primary, 0.3).fillCircle(360, FLOOR_Y - 150, 190);
    g.fillStyle(COLOR.primaryLight, 0.9).fillCircle(360, FLOOR_Y - 150, 120);
    cloud(140, 150, 0.9, 0.75, COLOR.panelStrong);
    cloud(560, 210, 0.8, 0.7, COLOR.panelStrong);
    cloud(380, 90, 0.5, 0.6, COLOR.white);
    hill(g, 360, 1100, 120, RACE.trackDark, 0.35);
    house(g, 110, 200, 190);
    house(g, 290, 150, 140);
    house(g, 470, 170, 160);
    house(g, 635, 190, 200);
  } else {
    // 밤의 달과 등불
    g.fillGradientStyle(COLOR.skyDeep, COLOR.skyDeep, COLOR.teamA, COLOR.teamA, 1).fillRect(0, 0, COURT_W, FLOOR_Y);
    g.fillStyle(COLOR.white, 0.85);
    for (let i = 0; i < 46; i++) g.fillCircle(LEFT + ((i * 151) % (RIGHT - LEFT)), CEIL + 16 + ((i * 89) % 430), 1.6 + (i % 3) * 0.9);
    g.fillStyle(COLOR.panelStrong, 0.25).fillCircle(540, 300, 96);
    g.fillStyle(COLOR.panelStrong, 1).fillCircle(540, 300, 62);
    g.fillStyle(COLOR.primary, 0.35).fillCircle(520, 282, 14).fillCircle(560, 320, 10).fillCircle(550, 278, 7);
    cloud(180, 330, 0.8, 0.28);
    cloud(300, 420, 0.6, 0.2);
    hill(g, 150, 620, 150, COLOR.skyDeep, 0.6);
    hill(g, 600, 560, 110, COLOR.skyDeep, 0.5);
    // 등불 줄
    g.lineStyle(3, COLOR.outline, 0.9);
    g.beginPath();
    for (let x = LEFT; x <= RIGHT; x += 8) {
      const y = 96 + Math.sin(((x - LEFT) / (RIGHT - LEFT)) * Math.PI) * 26;
      if (x === LEFT) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
    const cols = [COLOR.pink, COLOR.primary, COLOR.win, COLOR.primary, COLOR.pink];
    cols.forEach((c, i) => {
      const x = LEFT + ((RIGHT - LEFT) * (i + 1)) / (cols.length + 1);
      lantern(g, x, 108 + Math.sin(((x - LEFT) / (RIGHT - LEFT)) * Math.PI) * 26, c);
    });
  }

  // 응원 깃발: 이 배경의 십이지 네 마리 (공이 잘 보이게 벽 가까이에만)
  const flags = BG_ZODIAC[n];
  const xs = [LEFT + 52, LEFT + 118, RIGHT - 118, RIGHT - 52];
  const fy = n === 2 ? 210 : 74;
  flags.forEach((id, i) => {
    if (!scene.textures.exists(flagKey(id))) return;
    const f = scene.add.graphics().setDepth(2);
    f.fillStyle(COLOR.white, 0.92).fillCircle(xs[i], fy, 27);
    f.lineStyle(3, COLOR.outline, 0.9).strokeCircle(xs[i], fy, 27);
    scene.add.image(xs[i], fy, flagKey(id)).setDisplaySize(48, 48).setDepth(3).setAlpha(0.95);
  });

  // 바닥 (배경마다 색만 다르다)
  const [top, side] = FLOOR[n];
  const f = scene.add.graphics().setDepth(5);
  f.fillStyle(top, 1).fillRect(0, FLOOR_Y, COURT_W, COURT_H - FLOOR_Y);
  f.fillStyle(side, 1).fillRect(0, FLOOR_Y + 30, COURT_W, COURT_H - FLOOR_Y - 30);
}
