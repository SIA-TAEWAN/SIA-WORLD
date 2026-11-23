import Phaser from 'phaser';
import { COLOR, MATGO, ROULETTE, TABLE } from '../theme';
import { SLOT_SIZE, type CharId } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { ENEMIES } from '../data/enemies';
import type { BgId } from '../data/regions';
import { zodiacFullUrl } from '../assets';

/**
 * 그림 목록. 요괴·보스는 시아서바이벌의 SpriteCook 그림(public/art/e-*.png · b-*.png)을 그대로 쓰고,
 * 캐릭터는 공용 십이지 전신 그림(shared/images/zodiac/full) 한 장을 코드로 움직인다.
 * 바닥 무늬 4종 · 배치 칸 · 투사체 7종 · 터지는 이펙트는 SpriteCook 그림이고 (art/build.py 가 만든다),
 * 길·표지판·사거리·고리·광선·체력 바는 코드로 그린다 (DESIGN.md 색·외곽선 규칙).
 * 그림은 ASSETS.md 의 파일 이름으로 public/art/<이름>.png 에 넣고 ART_FILES 에 이름을 적으면
 * 그 그림을 먼저 쓰고, 못 불러올 때만 아래의 코드 그림으로 대신한다 (시아서바이벌과 같은 방식).
 * (파일이 없는 이름을 적어 두면 판마다 404 요청이 나가므로, 파일을 넣은 것만 적는다)
 */
export const ART_FILES: readonly string[] = [
  'e-imp', 'e-wisp', 'e-club', 'e-water', 'e-fox', 'e-bamboo', 'e-guard', 'e-skeleton', 'e-spirit',
  'b-bigDokkaebi', 'b-dueoksini', 'b-bulgasal', 'b-jangsanbeom', 'b-centipede', 'b-gumiho',
  'b-guardCaptain', 'b-yagwanggwi', 'b-imugi', 'b-reaper', 'b-gangcheori', 'b-yeomra',
  'tile-field', 'tile-bamboo', 'tile-palace', 'tile-underworld', 'slot', 'slotOn',
  'p-shuriken', 'p-cake', 'p-venom', 'p-arrow', 'p-stone', 'p-feather', 'p-puppy', 'fx-pop', 'fx-wool', 'fx-coin', 'fx-slash', 'fx-bell',
];
/** 어느 판에서나 쓰는 그림 (바닥 무늬는 그 판의 배경 것만 따로 받는다) */
export const COMMON_ART: readonly string[] = ['slot', 'slotOn', 'p-shuriken', 'p-cake', 'p-venom', 'p-arrow', 'p-stone', 'p-feather', 'p-puppy', 'fx-pop', 'fx-wool', 'fx-coin', 'fx-slash', 'fx-bell'];
/** 바닥 무늬 한 장이 판에서 차지하는 너비 (px): 받은 그림은 4칸, 코드 그림은 2칸(160) */
export const TILE_SPAN = 320;

export const zKey = (id: CharId) => `z-${id}`;
export const enemyKey = (kind: number) => `e-${ENEMIES[kind].id}`;
export const bossKey = (boss: number) => `b-${BOSSES[boss].id}`;
export const tileKey = (bg: BgId) => `tile-${bg}`;
/** 투사체 그림 (state.ts 의 PROJ 순서) */
export const PROJ_KEYS = ['p-shuriken', 'p-cake', 'p-venom', 'p-arrow', 'p-stone', 'p-feather', 'p-puppy'];
/** 강화 단계 표시 (별 1~3개) */
export const pipKey = (lv: number) => `pip-${lv}`;

/** 배경 4종의 바탕색과 길 색 (넓은 면은 DESIGN.md 의 기존 값만 쓴다. 시아서바이벌의 맵 4색과 같다) */
export const BG: Record<BgId, { ground: number; light: number; road: number; dot: number }> = {
  field: { ground: TABLE.matgo, light: MATGO.matLight, road: COLOR.skyBottom, dot: COLOR.emptyLine },
  bamboo: { ground: TABLE.poker, light: ROULETTE.autumn, road: COLOR.skyBottom, dot: COLOR.emptyLine },
  palace: { ground: TABLE.blackjack, light: ROULETTE.spring, road: COLOR.panel, dot: COLOR.lineSoft },
  underworld: { ground: ROULETTE.winter, light: COLOR.track, road: COLOR.panel, dot: COLOR.lineSoft },
};

/** 이 판에 필요한 그림만 받는다: 나오는 요괴·보스와 데려간 캐릭터 */
export function preloadArt(scene: Phaser.Scene, keys: readonly string[], squad: readonly CharId[]) {
  const base = import.meta.env.BASE_URL;
  for (const k of keys) if (ART_FILES.includes(k) && !scene.textures.exists(k)) scene.load.image(k, `${base}art/${k}.png`);
  for (const id of squad) if (!scene.textures.exists(zKey(id))) scene.load.image(zKey(id), zodiacFullUrl(id));
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

function star(cx: number, cy: number, r0: number, r1: number) {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? r1 : r0;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

/** 못 불러온 요괴·보스·캐릭터 그림을 대신하는 동그란 얼굴 (색만 다르다) */
function blob(g: G, size: number, color: number, horns: boolean) {
  const c = size / 2;
  if (horns) {
    g.fillStyle(COLOR.primary, 1).fillTriangle(c - size * 0.28, c - size * 0.2, c - size * 0.1, c - size * 0.3, c - size * 0.22, c - size * 0.48);
    g.fillTriangle(c + size * 0.28, c - size * 0.2, c + size * 0.1, c - size * 0.3, c + size * 0.22, c - size * 0.48);
  }
  g.fillStyle(color, 1).fillCircle(c, c + size * 0.04, size * 0.36);
  line(g, Math.max(4, size * 0.05)).strokeCircle(c, c + size * 0.04, size * 0.36);
  g.fillStyle(COLOR.white, 1).fillCircle(c - size * 0.12, c, size * 0.08).fillCircle(c + size * 0.12, c, size * 0.08);
  g.fillStyle(COLOR.outline, 1).fillCircle(c - size * 0.1, c, size * 0.04).fillCircle(c + size * 0.14, c, size * 0.04);
}

/** 코드 그림을 만든다. 받은 그림이 있으면 그대로 두고, 없는 것만 채운다 */
export function ensureArt(scene: Phaser.Scene, bg: BgId, squad: readonly CharId[]) {
  // ───── 바닥 타일: 바탕색 + 밝은 체크 무늬 (들판은 풀포기·꽃) ─────
  const c = BG[bg];
  make(scene, tileKey(bg), 160, 160, (g) => {
    g.fillStyle(c.ground, 1).fillRect(0, 0, 160, 160);
    g.fillStyle(c.light, 1).fillRect(0, 0, 80, 80).fillRect(80, 80, 80, 80);
    if (bg !== 'field') return;
    g.lineStyle(3, MATGO.matDark, 1);
    for (const [x, y] of [[24, 30], [118, 22], [60, 104], [140, 128], [26, 146]]) {
      g.lineBetween(x, y, x - 5, y - 10);
      g.lineBetween(x, y, x, y - 12);
      g.lineBetween(x, y, x + 5, y - 10);
    }
    g.fillStyle(COLOR.white, 1).fillCircle(98, 64, 4).fillCircle(46, 62, 4);
    g.fillStyle(COLOR.primary, 1).fillCircle(98, 64, 1.6).fillCircle(46, 62, 1.6);
  });

  // ───── 배치 칸: 빈 칸(크림 + 점선 느낌의 연한 테두리) · 놓인 칸(노란 받침) · 고른 칸의 테두리 ─────
  const S = SLOT_SIZE * 2;
  make(scene, 'slot', S, S, (g) => {
    g.fillStyle(COLOR.panel, 1).fillRoundedRect(4, 4, S - 8, S - 8, 26);
    g.lineStyle(6, COLOR.emptyLine, 1).strokeRoundedRect(4, 4, S - 8, S - 8, 26);
    // 가운데 더하기 표시: 여기에 놓을 수 있다
    g.fillStyle(COLOR.emptyLine, 1).fillRoundedRect(S / 2 - 16, S / 2 - 4, 32, 8, 4).fillRoundedRect(S / 2 - 4, S / 2 - 16, 8, 32, 4);
  });
  make(scene, 'slotOn', S, S, (g) => {
    g.fillStyle(COLOR.outline, 1).fillRoundedRect(4, 12, S - 8, S - 12, 26);
    g.fillStyle(COLOR.panelStrong, 1).fillRoundedRect(4, 4, S - 8, S - 16, 26);
    line(g, 6).strokeRoundedRect(4, 4, S - 8, S - 16, 26);
  });
  make(scene, 'sel', S + 24, S + 24, (g) => {
    g.lineStyle(10, COLOR.outline, 1).strokeRoundedRect(8, 8, S + 8, S + 8, 32);
    g.lineStyle(6, COLOR.primary, 1).strokeRoundedRect(8, 8, S + 8, S + 8, 32);
  });
  // ───── 강화 단계: 별 1~3개 ─────
  for (let lv = 1; lv <= 3; lv++) {
    make(scene, pipKey(lv), 96, 36, (g) => {
      for (let i = 0; i < lv; i++) {
        const x = 48 + (i - (lv - 1) / 2) * 28;
        g.fillStyle(COLOR.primary, 1).fillPoints(star(x, 18, 14, 6.5), true);
        line(g, 3.5).strokePoints(star(x, 18, 14, 6.5), true);
      }
    });
  }

  // ───── 투사체 ─────
  // 표창: 네 갈래 별
  make(scene, 'p-shuriken', 48, 48, (g) => {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? 7 : 21;
      const a = (i * Math.PI) / 4;
      pts.push(new Phaser.Math.Vector2(24 + Math.cos(a) * r, 24 + Math.sin(a) * r));
    }
    g.fillStyle(COLOR.white, 1).fillPoints(pts, true);
    line(g, 4).strokePoints(pts, true);
    g.fillStyle(COLOR.outline, 1).fillCircle(24, 24, 4);
  });
  // 달떡: 둥근 흰 떡
  make(scene, 'p-cake', 64, 64, (g) => {
    g.fillStyle(COLOR.white, 1).fillCircle(32, 32, 24);
    line(g, 5).strokeCircle(32, 32, 24);
    g.fillStyle(COLOR.pink, 1).fillCircle(24, 36, 4).fillCircle(40, 36, 4);
    g.fillStyle(COLOR.outline, 1).fillCircle(26, 28, 3).fillCircle(38, 28, 3);
  });

  // 독 방울: 초록 물방울
  make(scene, 'p-venom', 48, 48, (g) => {
    g.fillStyle(COLOR.win, 1).fillCircle(24, 28, 14).fillTriangle(14, 22, 34, 22, 24, 4);
    line(g, 4).strokeCircle(24, 28, 14);
    g.fillStyle(COLOR.white, 1).fillCircle(19, 26, 4);
  });
  // 화살: 오른쪽을 향한 굵은 화살 (나는 쪽으로 돌린다)
  make(scene, 'p-arrow', 64, 32, (g) => {
    g.fillStyle(COLOR.outline, 1).fillRect(6, 12, 40, 8);
    g.fillStyle(COLOR.primary, 1).fillTriangle(40, 4, 62, 16, 40, 28);
    line(g, 4).strokeTriangle(40, 4, 62, 16, 40, 28);
    g.fillStyle(COLOR.pink, 1).fillTriangle(2, 6, 14, 16, 2, 26);
  });
  // 돌멩이
  make(scene, 'p-stone', 48, 48, (g) => {
    g.fillStyle(COLOR.inkSoft, 1).fillCircle(24, 24, 15);
    line(g, 4).strokeCircle(24, 24, 15);
    g.fillStyle(COLOR.emptyLine, 1).fillCircle(19, 19, 5);
  });
  // 깃털
  make(scene, 'p-feather', 48, 48, (g) => {
    g.fillStyle(COLOR.white, 1).fillEllipse(24, 24, 36, 16);
    line(g, 3.5).strokeEllipse(24, 24, 36, 16);
    line(g, 3).lineBetween(8, 24, 40, 24);
  });
  // 강아지: 갈색 동그란 얼굴 + 귀
  make(scene, 'p-puppy', 64, 64, (g) => {
    g.fillStyle(COLOR.inkSoft, 1).fillEllipse(14, 22, 16, 24).fillEllipse(50, 22, 16, 24);
    g.fillStyle(COLOR.emptyLine, 1).fillCircle(32, 34, 22);
    line(g, 5).strokeCircle(32, 34, 22);
    g.fillStyle(COLOR.outline, 1).fillCircle(24, 30, 3.5).fillCircle(40, 30, 3.5).fillCircle(32, 40, 4.5);
  });
  // 광선: 왼쪽 끝(손)에서 오른쪽으로 뻗는 띠
  make(scene, 'beam', 256, 40, (g) => {
    g.fillStyle(COLOR.outline, 1).fillRoundedRect(0, 4, 256, 32, 16);
    g.fillStyle(COLOR.primary, 1).fillRoundedRect(3, 8, 250, 24, 12);
    g.fillStyle(COLOR.white, 1).fillRoundedRect(6, 15, 244, 10, 5);
  });

  // ───── 이펙트: 고리 · 원판 · 발톱 자국 · 네모 한 점(체력 바) · 그림자 ─────
  make(scene, 'ring', 256, 256, (g) => {
    g.lineStyle(14, COLOR.white, 1).strokeCircle(128, 128, 114);
  });
  make(scene, 'disc', 256, 256, (g) => {
    g.fillStyle(COLOR.white, 1).fillCircle(128, 128, 126);
  });
  make(scene, 'slash', 256, 256, (g) => {
    // 오른쪽을 향한 발톱 자국 세 줄
    g.lineStyle(16, COLOR.white, 1);
    for (const dy of [-44, 0, 44]) {
      g.beginPath();
      g.arc(96, 128 + dy, 96, -0.55, 0.55);
      g.strokePath();
    }
  });
  // 요괴가 쓰러질 때의 별 모양 번쩍임 · 흰 연기 (받은 그림이 없을 때)
  make(scene, 'fx-pop', 192, 192, (g) => {
    g.fillStyle(COLOR.primaryLight, 1).fillPoints(star(96, 96, 90, 44), true);
    g.fillStyle(COLOR.white, 1).fillPoints(star(96, 96, 56, 28), true);
  });
  make(scene, 'fx-wool', 192, 192, (g) => {
    g.fillStyle(COLOR.white, 1).fillCircle(66, 104, 46).fillCircle(122, 104, 50).fillCircle(96, 74, 48);
  });
  // 엽전: 가운데 네모 구멍이 난 노란 동전 (돼지가 기운을 벌 때)
  make(scene, 'fx-coin', 64, 64, (g) => {
    g.fillStyle(COLOR.primary, 1).fillCircle(32, 32, 27);
    line(g, 5).strokeCircle(32, 32, 27);
    g.fillStyle(COLOR.outline, 1).fillRect(24, 24, 16, 16);
  });
  make(scene, 'px', 8, 8, (g) => {
    g.fillStyle(COLOR.white, 1).fillRect(0, 0, 8, 8);
  });
  make(scene, 'shadow', 96, 40, (g) => {
    g.fillStyle(COLOR.outline, 1).fillEllipse(48, 20, 92, 36);
  });
  // 멈춘 요괴 머리 위의 별 (소의 방울)
  make(scene, 'dizzy', 40, 40, (g) => {
    g.fillStyle(COLOR.primary, 1).fillPoints(star(20, 20, 17, 8), true);
    line(g, 3.5).strokePoints(star(20, 20, 17, 8), true);
  });

  // ───── 못 불러온 그림 대신 ─────
  ENEMIES.forEach((_e, i) => make(scene, enemyKey(i), 128, 128, (g) => blob(g, 128, i % 2 ? COLOR.teamA : COLOR.lose, true)));
  BOSSES.forEach((_b, i) => make(scene, bossKey(i), 256, 256, (g) => blob(g, 256, COLOR.pink, true)));
  for (const id of squad) make(scene, zKey(id), 128, 128, (g) => blob(g, 128, COLOR.primary, false));
}
