import Phaser from 'phaser';
import { COLOR, FONT, MATGO, ROULETTE, TABLE, css } from '../theme';
import { CHAR_IDS, type CharId } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { ENEMIES } from '../data/enemies';
import { zodiacFullUrl } from '../assets';

/**
 * 그림 목록. 요괴 9종·보스 12종은 SpriteCook 으로 만든 그림(public/art)을 쓰고, 나머지는 코드로 그린 임시 그림이다 (DESIGN.md 색·외곽선 규칙).
 * 정식 그림은 ASSETS.md 의 파일 이름으로 public/art/<이름>.png 에 넣고, ART_FILES 에 이름을 적으면
 * 그 그림을 먼저 쓰고 못 불러올 때만 코드 그림으로 대신한다 (시아배구·시아레이스와 같은 방식).
 * 쓸 수 있는 이름: ASSETS.md 참고 (예: 'e-imp' 'b-bigDokkaebi' 'p-shuriken' 'i-coin' 'tile-field')
 * (파일이 없는 이름을 적어 두면 판마다 404 요청이 나가므로, 파일을 넣은 것만 적는다)
 */
export const ART_FILES: readonly string[] = [
  'e-imp', 'e-wisp', 'e-club', 'e-water', 'e-fox', 'e-bamboo', 'e-guard', 'e-skeleton', 'e-spirit',
  'b-bigDokkaebi', 'b-dueoksini', 'b-bulgasal', 'b-jangsanbeom', 'b-centipede', 'b-gumiho',
  'b-guardCaptain', 'b-yagwanggwi', 'b-imugi', 'b-reaper', 'b-gangcheori', 'b-yeomra',
];

export const zKey = (id: CharId) => `z-${id}`;
export const enemyKey = (kind: number) => `e-${ENEMIES[kind].id}`;
export const bossKey = (boss: number) => `b-${BOSSES[boss].id}`;
/** 투사체 그림 (state.ts 의 PROJ 순서) */
export const PROJ_KEYS = ['p-shuriken', 'p-cake', 'p-pearl', 'p-foxfire', 'p-shurikenEvo', 'p-pearlEvo', 'p-feather', 'p-pig', 'p-puppy', 'p-orb', 'p-cakeEvo', 'p-pigEvo'];
/** 장애물 그림 (data/maps.ts 의 terrain.kind) */
export const obstacleKey = (kind: string) => `ob-${kind}`;
/** 맵의 바탕색 (타일을 못 그렸을 때·화면 가장자리) */
export const MAP_BG: Record<string, number> = { field: TABLE.matgo, bamboo: TABLE.poker, palace: TABLE.blackjack, underworld: ROULETTE.winter };
/** 아이템 그림 (data/items.ts 의 ITEM 순서) */
export const ITEM_KEYS = ['i-gemS', 'i-gemM', 'i-gemL', 'i-coin', 'i-cake', 'i-pouch', 'i-talisman', 'i-chest'];
export const tileKey = (map: string) => `tile-${map}`;
/** 피해 숫자 글꼴 (create 에서 숫자 그림으로 만든다) */
export const NUM_FONT = 'nums';

export function preloadArt(scene: Phaser.Scene, char: CharId) {
  const base = import.meta.env.BASE_URL;
  for (const k of ART_FILES) if (!scene.textures.exists(k)) scene.load.image(k, `${base}art/${k}.png`);
  if (CHAR_IDS.includes(char) && !scene.textures.exists(zKey(char))) scene.load.image(zKey(char), zodiacFullUrl(char));
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
export function ensureArt(scene: Phaser.Scene, char: CharId, map: string) {
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
  ensureMapArt(scene, map);

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
  ensureFoes(scene);
  // 그림이 없는 요괴·보스는 회색 임시 그림
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
  // 한가위 보름달떡 (달떡의 진화): 노란 보름달
  make(scene, 'p-cakeEvo', 64, 64, (g) => {
    g.fillStyle(COLOR.primary, 1).fillCircle(32, 32, 27);
    line(g).strokeCircle(32, 32, 27);
    g.fillStyle(COLOR.primaryLight, 1).fillCircle(23, 24, 8).fillCircle(41, 39, 7).fillCircle(42, 20, 4);
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
  // 여의봉: 길게 뻗는 막대 (왼쪽 끝이 손잡이)
  make(scene, 'beam', 256, 64, (g) => {
    g.fillStyle(COLOR.lose, 1).fillRoundedRect(2, 14, 252, 36, 16);
    line(g, 5).strokeRoundedRect(2, 14, 252, 36, 16);
    g.fillStyle(COLOR.primary, 1).fillRoundedRect(2, 14, 30, 36, 12).fillRoundedRect(224, 14, 30, 36, 12);
    line(g, 4).strokeRoundedRect(2, 14, 30, 36, 12);
    line(g, 4).strokeRoundedRect(224, 14, 30, 36, 12);
  });
  // 깃털 (오른쪽을 향함)
  make(scene, 'p-feather', 64, 64, (g) => {
    g.fillStyle(COLOR.white, 1).fillEllipse(32, 32, 54, 18);
    line(g, 4).strokeEllipse(32, 32, 54, 18);
    g.lineStyle(3, COLOR.lose, 1).lineBetween(8, 32, 56, 32);
  });
  // 복돼지 (오른쪽을 향함). 황금 복돼지(진화)는 같은 모양에 몸이 노랗다
  const pig = (key: string, body: number, snout: number, ear: number, coin: number) =>
    make(scene, key, 96, 96, (g) => {
      g.fillStyle(ear, 1).fillTriangle(30, 22, 44, 30, 26, 40).fillTriangle(56, 20, 70, 30, 52, 34);
      g.fillStyle(body, 1).fillCircle(46, 50, 34);
      line(g, 6).strokeCircle(46, 50, 34);
      g.fillStyle(snout, 1).fillEllipse(72, 54, 26, 22);
      line(g, 4).strokeEllipse(72, 54, 26, 22);
      g.fillStyle(COLOR.outline, 1).fillCircle(68, 54, 3).fillCircle(77, 54, 3).fillCircle(52, 40, 4);
      g.fillStyle(coin, 1).fillCircle(30, 62, 9);
      line(g, 3).strokeCircle(30, 62, 9);
    });
  pig('p-pig', COLOR.skyBottom, COLOR.pink, COLOR.pink, COLOR.primary);
  pig('p-pigEvo', COLOR.primary, COLOR.primaryLight, COLOR.primaryDeep, COLOR.primaryDeep);
  // 동료 강아지 (오른쪽을 향함)
  make(scene, 'p-puppy', 96, 96, (g) => {
    g.fillStyle(COLOR.inkSoft, 1).fillEllipse(28, 34, 18, 30).fillEllipse(60, 30, 18, 30);
    g.fillStyle(COLOR.emptyLine, 1).fillCircle(46, 52, 30);
    line(g, 6).strokeCircle(46, 52, 30);
    g.fillStyle(COLOR.white, 1).fillEllipse(58, 62, 26, 20);
    g.fillStyle(COLOR.outline, 1).fillCircle(66, 56, 5).fillCircle(42, 46, 4).fillCircle(58, 44, 4);
    g.fillStyle(COLOR.pink, 1).fillEllipse(60, 70, 10, 8);
  });
  // 여우구슬 (구미호의 탄막)
  make(scene, 'p-orb', 48, 48, (g) => {
    g.fillStyle(COLOR.primaryDeep, 1).fillCircle(24, 24, 20);
    line(g, 4).strokeCircle(24, 24, 20);
    g.fillStyle(COLOR.primaryLight, 1).fillCircle(24, 24, 10);
    g.fillStyle(COLOR.white, 1).fillCircle(19, 19, 4);
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

/** 맵별 바닥 타일과 장애물 (맵마다 분위기가 한눈에 다르게) */
function ensureMapArt(scene: Phaser.Scene, map: string) {
  // 대나무 숲: 민트빛 흙바닥 + 떨어진 댓잎
  make(scene, tileKey('bamboo'), 256, 256, (g) => {
    g.fillStyle(TABLE.poker, 1).fillRect(0, 0, 256, 256);
    g.fillStyle(ROULETTE.autumn, 1);
    for (const [x, y, w] of [[20, 30, 90], [150, 80, 80], [60, 150, 110], [170, 200, 70], [10, 220, 60]]) g.fillRoundedRect(x, y, w, 26, 13);
    g.lineStyle(4, COLOR.win, 1);
    for (const [x, y] of [[50, 60], [200, 40], [120, 120], [30, 180], [210, 160], [140, 230]]) {
      g.lineBetween(x, y, x + 16, y - 8);
      g.lineBetween(x, y, x + 14, y + 8);
    }
  });
  // 달빛 궁궐: 푸른 밤의 돌바닥 (네모난 박석)
  make(scene, tileKey('palace'), 256, 256, (g) => {
    g.fillStyle(TABLE.blackjack, 1).fillRect(0, 0, 256, 256);
    g.fillStyle(ROULETTE.spring, 1);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.fillRoundedRect(x * 128 + 8 + (y % 2) * 0, y * 128 + 8, 112, 112, 10);
    g.fillStyle(COLOR.white, 0.5).fillCircle(40, 40, 5).fillCircle(190, 170, 4).fillCircle(110, 210, 3);
    g.lineStyle(3, COLOR.teamA, 0.6).lineBetween(30, 100, 60, 90).lineBetween(170, 60, 200, 72).lineBetween(150, 220, 186, 212);
  });
  // 황천길: 잿빛 길 + 금 간 자국 + 푸른 불빛
  make(scene, tileKey('underworld'), 256, 256, (g) => {
    g.fillStyle(ROULETTE.winter, 1).fillRect(0, 0, 256, 256);
    g.lineStyle(5, COLOR.draw, 1);
    g.lineBetween(20, 40, 70, 70).lineBetween(70, 70, 60, 120).lineBetween(180, 30, 210, 90).lineBetween(120, 170, 170, 200).lineBetween(170, 200, 150, 240).lineBetween(30, 200, 70, 190);
    g.fillStyle(COLOR.teamA, 0.55).fillCircle(120, 60, 9).fillCircle(220, 190, 7).fillCircle(40, 140, 6);
    g.fillStyle(COLOR.white, 0.8).fillCircle(120, 60, 4).fillCircle(220, 190, 3).fillCircle(40, 140, 2.5);
  });
  if (!scene.textures.exists(tileKey(map))) {
    make(scene, tileKey(map), 256, 256, (g) => g.fillStyle(MAP_BG[map] ?? TABLE.matgo, 1).fillRect(0, 0, 256, 256));
  }
  // 대나무 포기: 초록 대 세 줄기 + 마디 + 잎
  make(scene, obstacleKey('scatter'), 128, 128, (g) => {
    for (const [x, h] of [[44, 100], [64, 116], [84, 96]]) {
      g.fillStyle(COLOR.win, 1).fillRoundedRect(x - 9, 124 - h, 18, h, 8);
      line(g, 4).strokeRoundedRect(x - 9, 124 - h, 18, h, 8);
      line(g, 3);
      for (let y = 124 - h + 26; y < 118; y += 26) g.lineBetween(x - 9, y, x + 9, y);
    }
    g.fillStyle(MATGO.matLight, 1).fillEllipse(30, 34, 40, 14).fillEllipse(100, 28, 40, 14).fillEllipse(96, 60, 34, 12);
    line(g, 3).strokeEllipse(30, 34, 40, 14).strokeEllipse(100, 28, 40, 14).strokeEllipse(96, 60, 34, 12);
  });
  // 궁궐 담: 크림색 돌 + 기와지붕
  make(scene, obstacleKey('walls'), 128, 128, (g) => {
    g.fillStyle(COLOR.panel, 1).fillRoundedRect(10, 34, 108, 86, 12);
    line(g, 6).strokeRoundedRect(10, 34, 108, 86, 12);
    line(g, 3).lineBetween(10, 76, 118, 76).lineBetween(64, 34, 64, 76).lineBetween(38, 76, 38, 120).lineBetween(90, 76, 90, 120);
    g.fillStyle(COLOR.skyDeep, 1).fillRoundedRect(2, 8, 124, 34, 12);
    line(g, 6).strokeRoundedRect(2, 8, 124, 34, 12);
    line(g, 3);
    for (let x = 26; x < 120; x += 24) g.lineBetween(x, 10, x, 40);
  });
  // 삼도천 물길: 푸른 물 + 물결 (외곽선은 얇게, 바닥에 깔린 느낌)
  make(scene, obstacleKey('pools'), 128, 128, (g) => {
    g.fillStyle(COLOR.skyDeep, 1).fillCircle(64, 64, 62);
    g.fillStyle(COLOR.teamA, 1).fillCircle(64, 64, 55);
    g.lineStyle(5, COLOR.skyMid, 1);
    g.beginPath().arc(48, 54, 22, 3.6, 5.4, false).strokePath();
    g.beginPath().arc(80, 84, 20, 3.6, 5.4, false).strokePath();
    g.beginPath().arc(56, 96, 14, 3.6, 5.4, false).strokePath();
  });
}

/** 맵 전용 요괴 4종과 나머지 보스 9종 (색·모양이 서로 다르게) */
function ensureFoes(scene: Phaser.Scene) {
  // 죽순 요괴: 초록 죽순 + 눈
  make(scene, 'e-bamboo', 96, 96, (g) => {
    g.fillStyle(COLOR.win, 1).fillTriangle(48, 6, 16, 84, 80, 84);
    line(g).strokeTriangle(48, 6, 16, 84, 80, 84);
    g.lineStyle(4, COLOR.outline, 1).lineBetween(34, 44, 62, 44).lineBetween(26, 64, 70, 64);
    eyes(g, 48, 58, 10, 3.5);
  });
  // 수문장 요괴: 잿빛 갑옷 + 파란 투구 술
  make(scene, 'e-guard', 128, 128, (g) => {
    g.fillStyle(COLOR.teamA, 1).fillTriangle(64, 4, 50, 30, 78, 30);
    g.fillStyle(COLOR.draw, 1).fillRoundedRect(22, 26, 84, 92, 20);
    line(g, 6).strokeRoundedRect(22, 26, 84, 92, 20);
    g.fillStyle(COLOR.track, 1).fillRoundedRect(34, 74, 60, 36, 8);
    line(g, 4).strokeRoundedRect(34, 74, 60, 36, 8);
    g.lineBetween(64, 74, 64, 110).lineBetween(34, 92, 94, 92);
    eyes(g, 64, 54, 14, 4.5);
  });
  // 해골 병사: 흰 해골 + 검은 눈구멍
  make(scene, 'e-skeleton', 96, 96, (g) => {
    g.fillStyle(COLOR.panel, 1).fillCircle(48, 44, 30).fillRoundedRect(32, 60, 32, 24, 6);
    line(g).strokeCircle(48, 44, 30);
    line(g, 4).strokeRoundedRect(32, 60, 32, 24, 6);
    g.fillStyle(COLOR.outline, 1).fillCircle(37, 44, 8).fillCircle(59, 44, 8).fillTriangle(48, 52, 43, 60, 53, 60);
    g.lineBetween(42, 66, 42, 82).lineBetween(54, 66, 54, 82);
  });
  // 원혼: 옅은 하늘빛 유령 (꼬리가 흐느적)
  make(scene, 'e-spirit', 96, 96, (g) => {
    g.fillStyle(COLOR.skyMid, 1).fillCircle(48, 40, 28).fillTriangle(22, 48, 74, 48, 34, 90).fillTriangle(40, 50, 74, 48, 66, 80);
    line(g).strokeCircle(48, 40, 28);
    g.fillStyle(COLOR.skyMid, 1).fillCircle(48, 42, 25);
    g.fillStyle(COLOR.outline, 1).fillEllipse(38, 38, 9, 13).fillEllipse(58, 38, 9, 13).fillEllipse(48, 56, 10, 7);
  });

  const body = (g: G, fill: number, w = 196, h = 184) => {
    g.fillStyle(fill, 1).fillEllipse(128, 144, w, h);
    line(g, 9).strokeEllipse(128, 144, w, h);
  };
  // 장산범: 온몸이 흰 긴 털, 붉은 눈
  make(scene, 'b-jangsanbeom', 256, 256, (g) => {
    body(g, COLOR.white, 190, 190);
    line(g, 7);
    for (let i = 0; i < 9; i++) g.lineBetween(52 + i * 19, 150, 46 + i * 20, 236);
    g.fillStyle(COLOR.white, 1).fillTriangle(60, 86, 92, 60, 100, 100).fillTriangle(196, 86, 164, 60, 156, 100);
    line(g, 7).strokeTriangle(60, 86, 92, 60, 100, 100).strokeTriangle(196, 86, 164, 60, 156, 100);
    eyes(g, 128, 120, 36, 10, COLOR.lose);
    g.fillStyle(COLOR.outline, 1).fillRoundedRect(96, 150, 64, 20, 8);
  });
  // 왕지네: 초록 마디 몸 + 주황 다리 + 큰 집게
  make(scene, 'b-centipede', 256, 256, (g) => {
    g.lineStyle(8, COLOR.primaryDeep, 1);
    for (let i = 0; i < 4; i++) g.lineBetween(30, 110 + i * 34, 226, 110 + i * 34);
    g.fillStyle(COLOR.win, 1).fillEllipse(128, 196, 130, 80).fillEllipse(128, 150, 150, 86);
    line(g, 8).strokeEllipse(128, 196, 130, 80).strokeEllipse(128, 150, 150, 86);
    g.fillStyle(COLOR.win, 1).fillEllipse(128, 100, 170, 110);
    line(g, 9).strokeEllipse(128, 100, 170, 110);
    g.fillStyle(COLOR.lose, 1).fillTriangle(70, 60, 96, 66, 64, 20).fillTriangle(186, 60, 160, 66, 192, 20);
    line(g, 6).strokeTriangle(70, 60, 96, 66, 64, 20).strokeTriangle(186, 60, 160, 66, 192, 20);
    eyes(g, 128, 96, 34, 9);
  });
  // 구미호: 주황 여우 + 부채처럼 펼친 꼬리 아홉
  make(scene, 'b-gumiho', 256, 256, (g) => {
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i + 0.5) * (Math.PI / 9);
      const x = 128 + Math.cos(a) * 96;
      const y = 150 + Math.sin(a) * 96;
      g.fillStyle(COLOR.primaryDeep, 1).fillEllipse(x, y, 40, 40);
      line(g, 5).strokeEllipse(x, y, 40, 40);
      g.fillStyle(COLOR.white, 1).fillCircle(128 + Math.cos(a) * 108, 150 + Math.sin(a) * 108, 10);
    }
    body(g, COLOR.primaryDeep, 160, 150);
    g.fillStyle(COLOR.primaryDeep, 1).fillTriangle(70, 110, 100, 96, 76, 50).fillTriangle(186, 110, 156, 96, 180, 50);
    line(g, 7).strokeTriangle(70, 110, 100, 96, 76, 50).strokeTriangle(186, 110, 156, 96, 180, 50);
    g.fillStyle(COLOR.white, 1).fillEllipse(128, 172, 80, 50);
    eyes(g, 128, 132, 30, 8, COLOR.pink);
    g.fillStyle(COLOR.outline, 1).fillCircle(128, 160, 7);
  });
  // 수문장 대장: 파란 갑옷 + 큰 노란 방패
  make(scene, 'b-guardCaptain', 256, 256, (g) => {
    g.fillStyle(COLOR.lose, 1).fillTriangle(128, 6, 100, 58, 156, 58);
    g.fillStyle(COLOR.teamA, 1).fillRoundedRect(40, 50, 176, 186, 40);
    line(g, 9).strokeRoundedRect(40, 50, 176, 186, 40);
    eyes(g, 118, 108, 30, 9);
    g.fillStyle(COLOR.primary, 1).fillRoundedRect(120, 130, 116, 110, 24);
    line(g, 8).strokeRoundedRect(120, 130, 116, 110, 24);
    g.fillStyle(COLOR.primaryDeep, 1).fillCircle(178, 185, 22);
    line(g, 6).strokeCircle(178, 185, 22);
  });
  // 야광귀: 짙은 남색 몸 + 노랗게 빛나는 눈 + 뾰족한 벙거지
  make(scene, 'b-yagwanggwi', 256, 256, (g) => {
    g.fillStyle(COLOR.outline, 1).fillTriangle(128, 4, 60, 96, 196, 96);
    body(g, COLOR.skyDeep, 180, 176);
    g.fillStyle(COLOR.outline, 1).fillEllipse(128, 92, 200, 30);
    g.fillStyle(COLOR.primaryLight, 1).fillCircle(96, 136, 20).fillCircle(160, 136, 20);
    line(g, 6).strokeCircle(96, 136, 20).strokeCircle(160, 136, 20);
    g.fillStyle(COLOR.outline, 1).fillCircle(96, 136, 7).fillCircle(160, 136, 7);
    g.fillStyle(COLOR.white, 1).fillRoundedRect(100, 180, 56, 16, 6);
    line(g, 4).strokeRoundedRect(100, 180, 56, 16, 6);
  });
  // 이무기: 똬리를 튼 큰 뱀 (파란 비늘 + 흰 배 + 작은 뿔)
  make(scene, 'b-imugi', 256, 256, (g) => {
    g.fillStyle(COLOR.teamA, 1).fillEllipse(128, 190, 220, 100);
    line(g, 9).strokeEllipse(128, 190, 220, 100);
    g.fillStyle(COLOR.white, 1).fillEllipse(128, 204, 150, 44);
    g.fillStyle(COLOR.primary, 1).fillTriangle(92, 60, 108, 62, 88, 26).fillTriangle(164, 60, 148, 62, 168, 26);
    g.fillStyle(COLOR.teamA, 1).fillEllipse(128, 110, 150, 130);
    line(g, 9).strokeEllipse(128, 110, 150, 130);
    eyes(g, 128, 98, 32, 9, COLOR.primaryDeep);
    g.lineStyle(6, COLOR.lose, 1).lineBetween(128, 150, 128, 176).lineBetween(128, 176, 116, 188).lineBetween(128, 176, 140, 188);
  });
  // 저승사자: 검은 갓 + 검은 도포 + 흰 얼굴 + 명부
  make(scene, 'b-reaper', 256, 256, (g) => {
    g.fillStyle(COLOR.outline, 1).fillRoundedRect(52, 110, 152, 136, 36);
    g.fillStyle(COLOR.white, 1).fillEllipse(128, 116, 110, 104);
    line(g, 8).strokeEllipse(128, 116, 110, 104);
    g.fillStyle(COLOR.outline, 1).fillEllipse(128, 70, 220, 30).fillRoundedRect(88, 14, 80, 60, 14);
    g.fillStyle(COLOR.outline, 1).fillCircle(106, 118, 9).fillCircle(150, 118, 9);
    g.lineStyle(5, COLOR.outline, 1).lineBetween(110, 146, 146, 146);
    g.fillStyle(COLOR.panelStrong, 1).fillRoundedRect(150, 170, 70, 56, 8);
    line(g, 6).strokeRoundedRect(150, 170, 70, 56, 8);
    g.lineStyle(4, COLOR.lose, 1).lineBetween(162, 186, 208, 186).lineBetween(162, 200, 208, 200).lineBetween(162, 214, 196, 214);
  });
  // 강철이: 붉은 몸 + 노란 뿔 + 불꽃 갈기
  make(scene, 'b-gangcheori', 256, 256, (g) => {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i * Math.PI) / 6;
      const x = 128 + Math.cos(a) * 88;
      const y = 140 + Math.sin(a) * 84;
      g.fillStyle(i % 2 ? COLOR.primary : COLOR.primaryDeep, 1).fillTriangle(x - 18, y + 12, x + 18, y + 12, 128 + Math.cos(a) * 128, 140 + Math.sin(a) * 124);
    }
    body(g, COLOR.lose, 196, 180);
    horn(g, 88, 70, 30, 44, -10);
    horn(g, 168, 70, 30, 44, 10);
    eyes(g, 128, 120, 38, 10, COLOR.primary);
    g.fillStyle(COLOR.outline, 1).fillRoundedRect(86, 164, 84, 30, 12);
    g.fillStyle(COLOR.primary, 1).fillTriangle(104, 180, 152, 180, 128, 214);
  });
  // 염라대왕: 붉은 도포 + 금관 + 흰 수염
  make(scene, 'b-yeomra', 256, 256, (g) => {
    g.fillStyle(COLOR.cardRed, 1).fillRoundedRect(28, 70, 200, 176, 44);
    line(g, 9).strokeRoundedRect(28, 70, 200, 176, 44);
    g.fillStyle(COLOR.skyBottom, 1).fillEllipse(128, 116, 130, 110);
    line(g, 8).strokeEllipse(128, 116, 130, 110);
    g.fillStyle(COLOR.primary, 1).fillRoundedRect(64, 22, 128, 46, 10);
    line(g, 8).strokeRoundedRect(64, 22, 128, 46, 10);
    g.fillStyle(COLOR.lose, 1).fillCircle(128, 44, 10);
    g.fillStyle(COLOR.white, 1).fillTriangle(88, 146, 168, 146, 128, 226);
    line(g, 6).strokeTriangle(88, 146, 168, 146, 128, 226);
    eyes(g, 128, 108, 30, 9);
  });
}
