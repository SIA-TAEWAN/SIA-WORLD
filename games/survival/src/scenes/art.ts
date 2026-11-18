import Phaser from 'phaser';
import { COLOR, FONT, MATGO, TABLE, css } from '../theme';
import { ZODIAC_IDS, type ZodiacId } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { ENEMIES } from '../data/enemies';
import { zodiacFullUrl } from '../assets';

/**
 * 그림 목록. 지금은 캐릭터(십이지 전신 그림)를 빼고 모두 코드로 그린 임시 그림이다 (DESIGN.md 색·외곽선 규칙).
 * 정식 그림은 ASSETS.md 의 파일 이름으로 public/art/<이름>.png 에 넣고, ART_FILES 에 이름을 적으면
 * 그 그림을 먼저 쓰고 못 불러올 때만 코드 그림으로 대신한다 (시아배구·시아레이스와 같은 방식).
 * 쓸 수 있는 이름: ASSETS.md 참고 (예: 'e-imp' 'b-bigDokkaebi' 'p-shuriken' 'i-coin' 'tile-field')
 * (파일이 없는 이름을 적어 두면 판마다 404 요청이 나가므로, 파일을 넣은 것만 적는다)
 */
export const ART_FILES: readonly string[] = [];

export const zKey = (id: ZodiacId) => `z-${id}`;
export const enemyKey = (kind: number) => `e-${ENEMIES[kind].id}`;
export const bossKey = (boss: number) => `b-${BOSSES[boss].id}`;
/** 투사체 그림 (state.ts 의 PROJ 순서) */
export const PROJ_KEYS = ['p-shuriken', 'p-cake', 'p-pearl', 'p-foxfire', 'p-shurikenEvo', 'p-pearlEvo'];
/** 아이템 그림 (data/items.ts 의 ITEM 순서) */
export const ITEM_KEYS = ['i-gemS', 'i-gemM', 'i-gemL', 'i-coin', 'i-cake', 'i-pouch', 'i-talisman', 'i-chest'];
export const tileKey = (map: string) => `tile-${map}`;
/** 피해 숫자 글꼴 (create 에서 숫자 그림으로 만든다) */
export const NUM_FONT = 'nums';

export function preloadArt(scene: Phaser.Scene, char: ZodiacId) {
  const base = import.meta.env.BASE_URL;
  for (const k of ART_FILES) if (!scene.textures.exists(k)) scene.load.image(k, `${base}art/${k}.png`);
  if (ZODIAC_IDS.includes(char) && !scene.textures.exists(zKey(char))) scene.load.image(zKey(char), zodiacFullUrl(char));
}

type G = Phaser.GameObjects.Graphics;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

const line = (g: G, w = 5) => g.lineStyle(w, COLOR.outline, 1);

/** 눈 두 개 (화난 눈썹) */
function eyes(g: G, cx: number, cy: number, gap: number, r: number, color: number = COLOR.outline) {
  g.fillStyle(COLOR.white, 1).fillCircle(cx - gap, cy, r * 1.6).fillCircle(cx + gap, cy, r * 1.6);
  g.fillStyle(color, 1).fillCircle(cx - gap, cy, r).fillCircle(cx + gap, cy, r);
  line(g, Math.max(3, r * 0.9));
  g.lineBetween(cx - gap - r * 2, cy - r * 2.6, cx - gap + r * 1.6, cy - r * 1.4);
  g.lineBetween(cx + gap + r * 2, cy - r * 2.6, cx + gap - r * 1.6, cy - r * 1.4);
}

function horn(g: G, x: number, y: number, w: number, h: number, lean: number) {
  g.fillStyle(COLOR.primary, 1).fillTriangle(x - w / 2, y, x + w / 2, y, x + lean, y - h);
  line(g, 4).strokeTriangle(x - w / 2, y, x + w / 2, y, x + lean, y - h);
}

function star(cx: number, cy: number, points: number, r0: number, r1: number, rot = -Math.PI / 2) {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? r1 : r0;
    const a = rot + (i * Math.PI) / points;
    pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

/** 일반 요괴 그림 크기 (판정 원 지름의 몇 배로 그리나) */
export const ENEMY_DRAW = 2.1;
export const BOSS_DRAW = 2.4;

/** 못 불러온 그림을 코드로 그려 채운다 (외곽선 + 단색, DESIGN.md 임시 그림 규칙) */
export function ensureArt(scene: Phaser.Scene, char: ZodiacId, map: string) {
  // ───── 바닥 타일: 들판 (풀밭 체크 무늬 + 풀포기·꽃) ─────
  make(scene, tileKey('field'), 256, 256, (g) => {
    g.fillStyle(TABLE.matgo, 1).fillRect(0, 0, 256, 256);
    g.fillStyle(MATGO.matLight, 1).fillRect(0, 0, 128, 128).fillRect(128, 128, 128, 128);
    g.lineStyle(4, MATGO.matDark, 1);
    for (const [x, y] of [[34, 40], [176, 30], [90, 150], [210, 190], [40, 216], [150, 96]]) {
      g.lineBetween(x, y, x - 7, y - 13);
      g.lineBetween(x, y, x, y - 16);
      g.lineBetween(x, y, x + 7, y - 13);
    }
    g.fillStyle(COLOR.white, 1).fillCircle(70, 84, 5).fillCircle(196, 118, 5).fillCircle(120, 226, 5);
    g.fillStyle(COLOR.primary, 1).fillCircle(70, 84, 2).fillCircle(196, 118, 2).fillCircle(120, 226, 2);
  });
  // 아직 만들지 않은 맵은 들판 타일을 쓴다 (6단계)
  if (!scene.textures.exists(tileKey(map))) {
    make(scene, tileKey(map), 256, 256, (g) => {
      g.fillStyle(TABLE.matgo, 1).fillRect(0, 0, 256, 256);
      g.fillStyle(MATGO.matLight, 1).fillRect(0, 0, 128, 128).fillRect(128, 128, 128, 128);
    });
  }

  // ───── 일반 요괴 5종 (종류가 한눈에 구분되게 색·모양을 다르게) ─────
  // 꼬마 도깨비: 빨간 동그란 몸 + 뿔 하나
  make(scene, 'e-imp', 96, 96, (g) => {
    horn(g, 48, 26, 20, 22, 4);
    g.fillStyle(COLOR.lose, 1).fillEllipse(48, 56, 64, 58);
    line(g).strokeEllipse(48, 56, 64, 58);
    eyes(g, 48, 52, 12, 4);
    line(g, 4).lineBetween(40, 70, 56, 70);
  });
  // 도깨비불: 파란 불꽃
  make(scene, 'e-wisp', 96, 96, (g) => {
    g.fillStyle(COLOR.teamA, 1).fillTriangle(30, 50, 66, 50, 44, 8).fillCircle(48, 58, 24);
    line(g).strokeCircle(48, 58, 24);
    line(g).lineBetween(28, 46, 44, 8);
    line(g).lineBetween(44, 8, 66, 42);
    g.fillStyle(COLOR.white, 1).fillCircle(48, 62, 13);
    g.fillStyle(COLOR.outline, 1).fillCircle(43, 60, 3).fillCircle(54, 60, 3);
  });
  // 방망이 도깨비: 갈색 네모난 큰 몸 + 뿔 둘 + 방망이
  make(scene, 'e-club', 128, 128, (g) => {
    horn(g, 40, 30, 18, 22, -6);
    horn(g, 76, 30, 18, 22, 6);
    g.fillStyle(COLOR.inkSoft, 1).fillRoundedRect(18, 26, 80, 88, 22);
    line(g, 6).strokeRoundedRect(18, 26, 80, 88, 22);
    eyes(g, 58, 60, 16, 5);
    g.fillStyle(COLOR.white, 1).fillRect(44, 86, 28, 10);
    line(g, 4).strokeRect(44, 86, 28, 10);
    g.fillStyle(COLOR.emptyLine, 1).fillRoundedRect(98, 30, 22, 66, 10);
    line(g).strokeRoundedRect(98, 30, 22, 66, 10);
  });
  // 물귀신: 진한 파란 몸 + 젖은 머리카락
  make(scene, 'e-water', 96, 96, (g) => {
    g.fillStyle(COLOR.skyDeep, 1).fillEllipse(48, 56, 58, 66);
    line(g).strokeEllipse(48, 56, 58, 66);
    line(g, 5);
    for (const x of [30, 42, 54, 66]) g.lineBetween(x, 22, x - 3, 50);
    g.fillStyle(COLOR.white, 1).fillCircle(40, 60, 6).fillCircle(58, 60, 6);
    g.fillStyle(COLOR.skyMid, 1).fillEllipse(48, 78, 16, 8);
  });
  // 여우불: 주황 불꽃 + 뾰족한 귀
  make(scene, 'e-fox', 96, 96, (g) => {
    g.fillStyle(COLOR.primaryDeep, 1).fillTriangle(22, 44, 40, 40, 26, 12).fillTriangle(74, 44, 56, 40, 70, 12).fillCircle(48, 56, 28);
    line(g).strokeTriangle(22, 44, 40, 40, 26, 12);
    line(g).strokeTriangle(74, 44, 56, 40, 70, 12);
    line(g).strokeCircle(48, 56, 28);
    g.fillStyle(COLOR.primaryDeep, 1).fillCircle(48, 56, 25);
    g.fillStyle(COLOR.primaryLight, 1).fillCircle(48, 64, 14);
    eyes(g, 48, 52, 11, 3.5);
  });

  // ───── 들판 보스 3종 ─────
  // 큰 도깨비: 분홍 큰 몸 + 뿔 둘 + 이빨
  make(scene, 'b-bigDokkaebi', 256, 256, (g) => {
    horn(g, 84, 60, 40, 52, -14);
    horn(g, 172, 60, 40, 52, 14);
    g.fillStyle(COLOR.pink, 1).fillEllipse(128, 144, 196, 184);
    line(g, 9).strokeEllipse(128, 144, 196, 184);
    eyes(g, 128, 120, 38, 10);
    g.fillStyle(COLOR.outline, 1).fillRoundedRect(84, 164, 88, 34, 12);
    g.fillStyle(COLOR.white, 1).fillTriangle(92, 164, 112, 164, 102, 186).fillTriangle(144, 164, 164, 164, 154, 186);
  });
  // 두억시니: 갈색 큰 몸 + 외눈 + 큰 방망이
  make(scene, 'b-dueoksini', 256, 256, (g) => {
    horn(g, 104, 50, 44, 44, 0);
    g.fillStyle(COLOR.inkSoft, 1).fillRoundedRect(28, 44, 156, 188, 44);
    line(g, 9).strokeRoundedRect(28, 44, 156, 188, 44);
    g.fillStyle(COLOR.white, 1).fillCircle(106, 112, 30);
    line(g, 7).strokeCircle(106, 112, 30);
    g.fillStyle(COLOR.lose, 1).fillCircle(106, 112, 14);
    line(g, 8).lineBetween(66, 72, 146, 84);
    g.fillStyle(COLOR.white, 1).fillRect(74, 172, 64, 22);
    line(g, 6).strokeRect(74, 172, 64, 22);
    g.lineBetween(96, 172, 96, 194).lineBetween(118, 172, 118, 194);
    g.fillStyle(COLOR.emptyLine, 1).fillRoundedRect(190, 30, 48, 150, 22);
    line(g, 8).strokeRoundedRect(190, 30, 48, 150, 22);
    g.fillStyle(COLOR.outline, 1).fillCircle(214, 60, 6).fillCircle(214, 96, 6).fillCircle(214, 132, 6);
  });
  // 불가살: 잿빛 쇠 몸 + 등의 가시 + 엄니
  make(scene, 'b-bulgasal', 256, 256, (g) => {
    g.fillStyle(COLOR.outline, 1);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i * Math.PI) / 6;
      const x = 128 + Math.cos(a) * 92;
      const y = 136 + Math.sin(a) * 88;
      g.fillTriangle(x - 16, y + 10, x + 16, y + 10, 128 + Math.cos(a) * 126, 136 + Math.sin(a) * 122);
    }
    g.fillStyle(COLOR.draw, 1).fillEllipse(128, 144, 196, 180);
    line(g, 9).strokeEllipse(128, 144, 196, 180);
    g.fillStyle(COLOR.track, 1).fillEllipse(128, 170, 120, 84);
    eyes(g, 128, 118, 40, 10, COLOR.lose);
    g.fillStyle(COLOR.white, 1).fillTriangle(82, 176, 104, 176, 88, 220).fillTriangle(174, 176, 152, 176, 168, 220);
    line(g, 6).strokeTriangle(82, 176, 104, 176, 88, 220);
    line(g, 6).strokeTriangle(174, 176, 152, 176, 168, 220);
  });
  // 그림이 없는 요괴·보스(6단계)는 본보기 그림을 빌려 쓴다
  for (let i = 0; i < ENEMIES.length; i++) if (!scene.textures.exists(enemyKey(i))) make(scene, enemyKey(i), 96, 96, (g) => {
    g.fillStyle(COLOR.draw, 1).fillEllipse(48, 54, 62, 62);
    line(g).strokeEllipse(48, 54, 62, 62);
    eyes(g, 48, 50, 12, 4);
  });
  for (let i = 0; i < BOSSES.length; i++) if (!scene.textures.exists(bossKey(i))) make(scene, bossKey(i), 256, 256, (g) => {
    g.fillStyle(COLOR.draw, 1).fillEllipse(128, 140, 196, 190);
    line(g, 9).strokeEllipse(128, 140, 196, 190);
    eyes(g, 128, 120, 38, 10);
  });

  // ───── 무기 ─────
  const shuriken = (key: string, fill: number) =>
    make(scene, key, 64, 64, (g) => {
      const pts = star(32, 32, 4, 28, 9);
      g.fillStyle(fill, 1).fillPoints(pts, true);
      line(g, 4).strokePoints(pts, true);
      g.fillStyle(COLOR.outline, 1).fillCircle(32, 32, 5);
    });
  shuriken('p-shuriken', COLOR.white);
  shuriken('p-shurikenEvo', COLOR.primary);
  make(scene, 'p-cake', 64, 64, (g) => {
    g.fillStyle(COLOR.white, 1).fillCircle(32, 32, 26);
    line(g).strokeCircle(32, 32, 26);
    g.fillStyle(COLOR.panelStrong, 1).fillCircle(24, 26, 7).fillCircle(40, 38, 5);
  });
  const pearl = (key: string, fill: number) =>
    make(scene, key, 64, 64, (g) => {
      g.fillStyle(fill, 1).fillCircle(32, 32, 26);
      line(g).strokeCircle(32, 32, 26);
      g.fillStyle(COLOR.white, 1).fillCircle(23, 23, 8);
    });
  pearl('p-pearl', COLOR.teamA);
  pearl('p-pearlEvo', COLOR.primary);
  make(scene, 'p-foxfire', 48, 48, (g) => {
    g.fillStyle(COLOR.pink, 1).fillCircle(24, 24, 20);
    line(g, 4).strokeCircle(24, 24, 20);
    g.fillStyle(COLOR.white, 1).fillCircle(24, 24, 8);
  });

  // ───── 범위·이펙트 (흰 그림을 색만 바꿔 쓴다) ─────
  make(scene, 'disc', 256, 256, (g) => g.fillStyle(COLOR.white, 1).fillCircle(128, 128, 126));
  make(scene, 'ring', 256, 256, (g) => g.lineStyle(10, COLOR.white, 1).strokeCircle(128, 128, 121));
  // 부채꼴 베기 (오른쪽을 향한 130도)
  make(scene, 'slash', 256, 256, (g) => {
    const half = (65 * Math.PI) / 180;
    g.fillStyle(COLOR.white, 1).slice(128, 128, 124, -half, half, false).fillPath();
    g.fillStyle(COLOR.white, 1);
  });
  make(scene, 'shadow', 64, 24, (g) => g.fillStyle(COLOR.outline, 1).fillEllipse(32, 12, 60, 20));
  // 내 캐릭터 발밑 원: 적이 많아도 내 자리가 보이게 (흰 바탕 + 노란 테두리)
  make(scene, 'pring', 128, 128, (g) => {
    g.fillStyle(COLOR.white, 0.55).fillCircle(64, 64, 58);
    g.lineStyle(8, COLOR.primary, 1).strokeCircle(64, 64, 58);
    g.lineStyle(3, COLOR.outline, 1).strokeCircle(64, 64, 62);
  });
  make(scene, 'px', 8, 8, (g) => g.fillStyle(COLOR.white, 1).fillRect(0, 0, 8, 8));

  // ───── 필드 아이템 ─────
  const gem = (key: string, fill: number, size: number) =>
    make(scene, key, 48, 48, (g) => {
      const pts = star(24, 24, 2, size, size * 0.62);
      g.fillStyle(fill, 1).fillPoints(pts, true);
      line(g, 4).strokePoints(pts, true);
      g.fillStyle(COLOR.white, 1).fillCircle(24 - size * 0.18, 24 - size * 0.3, size * 0.16);
    });
  gem('i-gemS', COLOR.teamA, 14);
  gem('i-gemM', COLOR.win, 18);
  gem('i-gemL', COLOR.pink, 22);
  make(scene, 'i-coin', 48, 48, (g) => {
    g.fillStyle(COLOR.primary, 1).fillCircle(24, 24, 19);
    line(g, 4).strokeCircle(24, 24, 19);
    g.fillStyle(COLOR.primaryDeep, 1).fillRect(18, 18, 12, 12);
    line(g, 3).strokeRect(18, 18, 12, 12);
  });
  make(scene, 'i-cake', 64, 64, (g) => {
    g.fillStyle(COLOR.white, 1).fillRoundedRect(8, 16, 48, 34, 14);
    line(g).strokeRoundedRect(8, 16, 48, 34, 14);
    g.fillStyle(COLOR.pink, 1).fillCircle(32, 33, 7);
  });
  make(scene, 'i-pouch', 64, 64, (g) => {
    g.fillStyle(COLOR.pink, 1).fillEllipse(32, 40, 46, 40).fillTriangle(20, 22, 44, 22, 32, 6);
    line(g).strokeEllipse(32, 40, 46, 40);
    g.fillStyle(COLOR.primary, 1).fillRoundedRect(20, 16, 24, 9, 4);
    line(g, 3).strokeRoundedRect(20, 16, 24, 9, 4);
    g.fillStyle(COLOR.primary, 1).fillCircle(32, 42, 7);
  });
  make(scene, 'i-talisman', 64, 64, (g) => {
    g.fillStyle(COLOR.primary, 1).fillRect(16, 4, 32, 56);
    line(g).strokeRect(16, 4, 32, 56);
    g.lineStyle(5, COLOR.lose, 1).lineBetween(24, 16, 40, 16).lineBetween(32, 16, 32, 46).lineBetween(24, 32, 40, 32).lineBetween(24, 46, 40, 46);
  });
  make(scene, 'i-chest', 96, 96, (g) => {
    g.fillStyle(COLOR.inkSoft, 1).fillRoundedRect(10, 26, 76, 56, 10);
    line(g, 6).strokeRoundedRect(10, 26, 76, 56, 10);
    g.fillStyle(COLOR.primary, 1).fillRect(10, 44, 76, 12);
    line(g, 4).strokeRect(10, 44, 76, 12);
    g.fillStyle(COLOR.primaryLight, 1).fillRoundedRect(40, 40, 16, 20, 4);
    line(g, 4).strokeRoundedRect(40, 40, 16, 20, 4);
  });

  // 캐릭터 그림을 못 불러오면 동그란 임시 그림
  make(scene, zKey(char), 96, 120, (g) => {
    g.fillStyle(COLOR.primary, 1).fillRoundedRect(8, 8, 80, 104, 36);
    line(g, 5).strokeRoundedRect(8, 8, 80, 104, 36);
    g.fillStyle(COLOR.outline, 1).fillCircle(36, 48, 6).fillCircle(60, 48, 6);
  });

  ensureNumFont(scene);
}

/** 피해 숫자 글꼴: 숫자 열 개를 그림 한 장에 그려 두고 비트맵 글자로 쓴다 (숫자가 수십 개 떠도 싸게 그리려고) */
function ensureNumFont(scene: Phaser.Scene) {
  if (scene.cache.bitmapFont.exists(NUM_FONT)) return;
  const W = 40;
  const H = 52;
  const chars = '0123456789';
  const tex = scene.textures.createCanvas(NUM_FONT, W * chars.length, H);
  if (!tex) return;
  const c = tex.getContext();
  c.font = `40px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = 8;
  c.strokeStyle = css(COLOR.outline);
  c.fillStyle = css(COLOR.white);
  for (let i = 0; i < chars.length; i++) {
    c.strokeText(chars[i], W * i + W / 2, H / 2 + 2);
    c.fillText(chars[i], W * i + W / 2, H / 2 + 2);
  }
  tex.refresh();
  // Parse 는 { data, frame, texture } 묶음을 돌려준다 (형 선언에는 글자 자료라고만 적혀 있다)
  const entry = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: NUM_FONT, width: W, height: H, chars, charsPerRow: chars.length, 'offset.x': 0, 'offset.y': 0, 'spacing.x': 0, 'spacing.y': 0, lineSpacing: 0,
  } as Phaser.Types.GameObjects.BitmapText.RetroFontConfig) as unknown as { data: { chars: Record<string, { xAdvance: number }> } };
  // 글자 사이를 좁힌다 (그림 칸은 넉넉하게 잡았다)
  for (const ch of Object.values(entry.data.chars)) ch.xAdvance = 26;
  scene.cache.bitmapFont.add(NUM_FONT, entry);
}
