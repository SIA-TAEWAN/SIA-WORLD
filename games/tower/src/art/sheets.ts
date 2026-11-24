/**
 * 임시 도트 그림 (코드로 그린 플레이스홀더). 같은 이름의 PNG 가 public/art/ 에 있고 manifest.json 에 적혀 있으면 그 파일을 쓴다 (ASSETS.md).
 *
 * 캐릭터 레이어 시트: 한 칸 32×32, 가로 8칸 × 세로 4줄 = 256×128.
 *   가로: 0 대기 · 1~4 걷기 · 5~7 공격 /  세로: 0 아래 · 1 왼쪽 · 2 오른쪽 · 3 위.
 *   모든 레이어(몸·얼굴·옷·머리)가 같은 칸에 같은 자세로 그려져 겹치면 한 사람이 된다. 그리는 순서 몸 → 얼굴 → 옷 → 머리.
 * 타일 시트: 16×16 칸을 가로 한 줄로 (TILE_ORDER 순서).
 * 적 시트: 한 칸 size×size, 가로 4칸 (0·1 걷기, 2 공격 준비, 3 맞음).
 */
import { COLOR, ROULETTE, css } from '../theme';
import type { Look } from '../game/progress';

export const FRAME = 32;
export const COLS = 8;
export const ROWS = 4;
export const SHEET_W = FRAME * COLS;
export const SHEET_H = FRAME * ROWS;
export const TS = 16;
export const frameIndex = (dir: number, col: number) => dir * COLS + col;
/** 걷기 칸 (시간 → 1~4) */
export const walkCol = (t: number) => 1 + (Math.floor(t * 8) % 4);
/** 공격 칸 (0~1 진행 → 5~7) */
export const attackCol = (f: number) => 5 + Math.min(2, Math.floor(f * 3));

/** 레이어 파일 이름 (public/art/char/<이름>.png) */
export const layerNames = (look: Look) => [`body_${look.sex}`, `face_${look.face}`, `outfit_${look.outfit}`, `hair_${look.sex}${look.hair}`];
export const ALL_LAYERS = ['body_m', 'body_f', ...[0, 1, 2, 3].flatMap((i) => [`face_${i}`, `outfit_${i}`, `hair_m${i}`, `hair_f${i}`])];

const C = {
  outline: css(COLOR.outline),
  white: css(COLOR.white),
  skin: '#ffd9b8',
  skinShade: '#f2b98f',
  blush: css(COLOR.pink),
  shoe: css(COLOR.inkSoft),
};
const HAIR_M = ['#6b4226', css(COLOR.outline), css(COLOR.inkSoft), '#4a2f1c'];
const HAIR_F = [css(COLOR.outline), '#8a4a2a', '#6b4226', css(COLOR.primaryDeep)];
/** 옷 4벌: 파랑 도포 · 분홍 저고리 · 노랑 조끼 · 초록 무복 (DESIGN.md 의 팀·강조 색) */
const OUTFIT = [
  { top: css(COLOR.teamA), low: css(COLOR.skyDeep), trim: css(COLOR.panel) },
  { top: css(COLOR.pink), low: css(COLOR.panel), trim: css(COLOR.primary) },
  { top: css(COLOR.primary), low: css(COLOR.inkSoft), trim: css(COLOR.outline) },
  { top: css(COLOR.win), low: css(COLOR.outline), trim: css(COLOR.primary) },
];

interface Pose {
  /** 0 아래 · 2 오른쪽 · 3 위 (왼쪽은 오른쪽을 뒤집는다) */
  dir: number;
  bob: number;
  /** 걷기 다리 (-1 · 0 · 1) */
  leg: number;
  /** 공격 팔 (-1 없음, 0 뒤로, 1 앞으로, 2 휘두른 뒤) */
  arm: number;
}
const poseOf = (dir: number, col: number): Pose => {
  const walk = col >= 1 && col <= 4 ? col - 1 : -1;
  return {
    dir,
    bob: walk === 1 || walk === 3 ? -1 : col >= 5 && col <= 6 ? 0 : 0,
    leg: walk === 0 ? 1 : walk === 2 ? -1 : 0,
    arm: col >= 5 ? col - 5 : -1,
  };
};

type Px = (x: number, y: number, w: number, h: number, c: string) => void;
type Painter = (px: Px, p: Pose) => void;

/** 시트 한 장 (왼쪽 줄은 오른쪽 줄을 뒤집어 만든다). outline = 바깥 테두리를 두를지 */
function sheet(paint: Painter, outline = true): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = SHEET_W;
  cv.height = SHEET_H;
  const g = cv.getContext('2d')!;
  const one = document.createElement('canvas');
  one.width = one.height = FRAME;
  const o = one.getContext('2d')!;
  for (let dir = 0; dir < ROWS; dir++) {
    for (let col = 0; col < COLS; col++) {
      o.clearRect(0, 0, FRAME, FRAME);
      const px: Px = (x, y, w, h, c) => {
        o.fillStyle = c;
        o.fillRect(x, y, w, h);
      };
      paint(px, poseOf(dir === 1 ? 2 : dir, col));
      if (outline) addOutline(o);
      g.save();
      if (dir === 1) {
        g.translate(col * FRAME + FRAME, dir * FRAME);
        g.scale(-1, 1);
        g.drawImage(one, 0, 0);
      } else g.drawImage(one, col * FRAME, dir * FRAME);
      g.restore();
    }
  }
  return cv;
}

/** 그림 바깥에 1칸 진한 갈색 테두리 */
function addOutline(o: CanvasRenderingContext2D, size = FRAME) {
  const img = o.getImageData(0, 0, size, size);
  const a = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && a[(y * size + x) * 4 + 3] > 100;
  const out: number[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) out.push(x, y);
  o.fillStyle = C.outline;
  for (let i = 0; i < out.length; i += 2) o.fillRect(out[i], out[i + 1], 1, 1);
}

// ---------- 캐릭터 레이어 ----------
const HEAD = { x: 10, y: 5, w: 12, h: 11 };
function bodyPaint(sex: 'm' | 'f'): Painter {
  return (px, p) => {
    const b = p.bob;
    const side = p.dir === 2;
    // 다리 (발)
    if (side) {
      px(13 + p.leg * 2, 24, 3, 5, C.skinShade);
      px(16 - p.leg * 2, 24, 3, 5, C.skin);
      px(13 + p.leg * 2, 29, 4, 2, C.shoe);
      px(16 - p.leg * 2, 29, 4, 2, C.shoe);
    } else {
      px(12, 24, 3, 5 - (p.leg > 0 ? 1 : 0), C.skin);
      px(17, 24, 3, 5 - (p.leg < 0 ? 1 : 0), C.skin);
      px(12, 29 - (p.leg > 0 ? 1 : 0), 3, 2, C.shoe);
      px(17, 29 - (p.leg < 0 ? 1 : 0), 3, 2, C.shoe);
    }
    // 몸통
    const tw = sex === 'f' ? 8 : 10;
    const tx = side ? 12 : 16 - tw / 2;
    px(tx, 16 + b, side ? 8 : tw, 9, C.skin);
    // 팔
    if (p.arm >= 0) attackArm(px, p, C.skin);
    else if (side) px(15 + p.leg, 18 + b, 3, 6, C.skinShade);
    else {
      px(tx - 2, 17 + b, 2, 6, C.skin);
      px(tx + tw, 17 + b, 2, 6, C.skin);
    }
    // 머리
    px(HEAD.x, HEAD.y + b, HEAD.w, HEAD.h, C.skin);
    px(HEAD.x + 1, HEAD.y - 1 + b, HEAD.w - 2, 1, C.skin);
    px(HEAD.x + 1, HEAD.y + HEAD.h + b, HEAD.w - 2, 1, C.skin);
    if (side) px(HEAD.x + HEAD.w, HEAD.y + 5 + b, 1, 3, C.skin);
  };
}
/** 공격하는 팔 (몸·옷이 같은 자리에 그린다) */
function attackArm(px: Px, p: Pose, c: string, sleeve = false) {
  const b = p.bob;
  const len = sleeve ? 3 : 6;
  if (p.dir === 2) {
    if (p.arm === 0) px(11, 15 + b, 3, len, c);
    else if (p.arm === 1) px(18, 18 + b, sleeve ? 3 : 8, 3, c);
    else px(17, 20 + b, sleeve ? 3 : 6, 3, c);
  } else if (p.dir === 0) {
    px(9, 17 + b, 2, 6, c);
    if (p.arm === 0) px(21, 14 + b, 2, len, c);
    else if (p.arm === 1) px(20, 20 + b, 3, sleeve ? 3 : 8, c);
    else px(17, 22 + b, sleeve ? 3 : 6, 3, c);
  } else {
    px(21, 17 + b, 2, 6, c);
    if (p.arm === 0) px(9, 18 + b, 2, len, c);
    else if (p.arm === 1) px(9, 9 + b, 3, sleeve ? 3 : 8, c);
    else px(10, 12 + b, 3, sleeve ? 3 : 6, c);
  }
}

function facePaint(v: number): Painter {
  return (px, p) => {
    if (p.dir === 3) return;
    const b = p.bob;
    const y = 10 + b;
    const eyes = p.dir === 2 ? [18] : [13, 18];
    for (const ex of eyes) {
      if (v === 0) px(ex, y, 2, 2, C.outline);
      if (v === 1) {
        px(ex - 1, y + 1, 1, 1, C.outline);
        px(ex, y, 2, 1, C.outline);
        px(ex + 2, y + 1, 1, 1, C.outline);
      }
      if (v === 2) {
        px(ex, y - 1, 2, 3, C.outline);
        px(ex, y - 1, 1, 1, C.white);
      }
      if (v === 3) {
        px(ex, y, 2, 2, C.outline);
        px(ex - 1, y - 2, 3, 1, C.outline);
      }
    }
    // 입 · 볼
    const mx = p.dir === 2 ? 19 : 15;
    if (v === 1 || v === 2) px(mx, y + 4, 2, 1, C.outline);
    else if (v === 3) px(mx, y + 4, 2, 1, C.skinShade);
    else px(mx, y + 4, 1, 1, C.outline);
    px(p.dir === 2 ? 20 : 11, y + 2, 2, 1, C.blush);
    if (p.dir !== 2) px(19, y + 2, 2, 1, C.blush);
  };
}

function outfitPaint(v: number): Painter {
  const o = OUTFIT[v];
  return (px, p) => {
    const b = p.bob;
    const side = p.dir === 2;
    // 바지·치마
    if (side) {
      px(13 + p.leg * 2, 24, 3, 3, o.low);
      px(16 - p.leg * 2, 24, 3, 3, o.low);
    } else if (v === 1) px(11, 23, 10, 4, o.low);
    else {
      px(12, 24, 3, 3, o.low);
      px(17, 24, 3, 3, o.low);
    }
    // 웃옷
    const x0 = side ? 12 : 11;
    const w = side ? 8 : 10;
    px(x0, 16 + b, w, 8, o.top);
    px(x0, 22 + b, w, 1, o.trim);
    if (!side && p.dir === 0) px(15, 16 + b, 2, 6, o.trim);
    // 소매
    if (p.arm >= 0) attackArm(px, p, o.top, true);
    else if (side) px(15 + p.leg, 18 + b, 3, 3, o.top);
    else {
      px(x0 - 2, 17 + b, 2, 3, o.top);
      px(x0 + w, 17 + b, 2, 3, o.top);
    }
  };
}

function hairPaint(sex: 'm' | 'f', v: number): Painter {
  const c = (sex === 'm' ? HAIR_M : HAIR_F)[v];
  return (px, p) => {
    const b = p.bob;
    const y = HEAD.y + b;
    const back = p.dir === 3;
    const side = p.dir === 2;
    // 공통: 정수리
    px(HEAD.x, y - 1, HEAD.w, 4, c);
    px(HEAD.x + 1, y - 2, HEAD.w - 2, 1, c);
    if (back) px(HEAD.x, y, HEAD.w, HEAD.h - 1, c);
    if (side) px(HEAD.x, y, 5, 9, c);
    else if (!back) {
      px(HEAD.x, y, 2, 6, c);
      px(HEAD.x + HEAD.w - 2, y, 2, 6, c);
    }
    if (sex === 'm') {
      if (v === 1) for (let i = 0; i < 4; i++) px(HEAD.x + 1 + i * 3, y - 4, 2, 2, c);
      if (v === 2) px(14, y - 5, 4, 3, c);
      if (v === 3 && !back) px(HEAD.x, y + 2, HEAD.w, 3, c);
      if (v === 0 && !back && !side) px(HEAD.x + 2, y + 2, 4, 1, c);
    } else {
      if (v === 0) {
        if (!side) px(HEAD.x - 1, y + 1, 2, 16, c);
        px(HEAD.x + HEAD.w - 1, y + 1, side ? 0 : 2, 16, c);
        if (side || back) px(HEAD.x, y + 2, side ? 5 : HEAD.w, 15, c);
      }
      if (v === 1) {
        px(HEAD.x - 3, y + 3, 3, 8, c);
        if (!side) px(HEAD.x + HEAD.w, y + 3, 3, 8, c);
      }
      if (v === 2) px(13, y - 5, 6, 4, c);
      if (v === 3) {
        px(HEAD.x - 1, y + 1, 2, 10, c);
        px(HEAD.x + HEAD.w - 1, y + 1, 2, 10, c);
        if (side || back) px(HEAD.x, y + 2, side ? 6 : HEAD.w, 9, c);
      }
      if (!back && !side && v !== 0) px(HEAD.x + 2, y + 2, 8, 1, c);
    }
  };
}

/** 레이어 이름 → 플레이스홀더 시트 */
export function placeholderLayer(name: string): HTMLCanvasElement {
  let m: RegExpMatchArray | null;
  if ((m = name.match(/^body_([mf])$/))) return sheet(bodyPaint(m[1] as 'm' | 'f'));
  if ((m = name.match(/^face_(\d)$/))) return sheet(facePaint(Number(m[1])), false);
  if ((m = name.match(/^outfit_(\d)$/))) return sheet(outfitPaint(Number(m[1])), false);
  if ((m = name.match(/^hair_([mf])(\d)$/))) return sheet(hairPaint(m[1] as 'm' | 'f', Number(m[2])));
  throw new Error(`no layer ${name}`);
}

// ---------- 타일 ----------
/** tiles.png 의 칸 순서 (ASSETS.md) */
export const TILE_ORDER = [
  'floor', 'floor2', 'wallTop', 'wallFace', 'doorOpen', 'doorLocked', 'water', 'pillar', 'gate', 'rock', 'switch', 'switchOn',
  'vine', 'stairs', 'chest', 'chestOpen', 'pedestal', 'pedestalEmpty', 'shop', 'fountain', 'rubble', 'fountainDry',
] as const;
export type TileArt = (typeof TILE_ORDER)[number];
export const tileArtIndex = (k: TileArt) => TILE_ORDER.indexOf(k);

const STONE = css(ROULETTE.winter);
const STONE_LINE = css(COLOR.lineSoft);
const WALL = css(COLOR.inkSoft);
const WALL_TOP = css(COLOR.emptyLine);
const WATER = css(COLOR.teamA);
const WATER_LIGHT = css(COLOR.skyMid);

export function placeholderTiles(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = TS * TILE_ORDER.length;
  cv.height = TS;
  const g = cv.getContext('2d')!;
  TILE_ORDER.forEach((k, i) => {
    g.save();
    g.translate(i * TS, 0);
    const px = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, w, h);
    };
    const floor = (alt = false) => {
      px(0, 0, 16, 16, STONE);
      px(0, 0, 16, 1, STONE_LINE);
      px(0, 8, 16, 1, STONE_LINE);
      px(alt ? 4 : 10, 0, 1, 8, STONE_LINE);
      px(alt ? 12 : 3, 8, 1, 8, STONE_LINE);
      if (alt) px(6, 11, 3, 1, C.shoe);
    };
    switch (k) {
      case 'floor': floor(); break;
      case 'floor2': floor(true); break;
      case 'wallTop':
        px(0, 0, 16, 16, WALL_TOP);
        px(0, 15, 16, 1, C.outline);
        px(3, 4, 4, 2, WALL);
        px(10, 10, 3, 2, WALL);
        break;
      case 'wallFace':
        px(0, 0, 16, 16, WALL);
        px(0, 0, 16, 3, WALL_TOP);
        px(0, 3, 16, 1, C.outline);
        px(0, 9, 16, 1, C.outline);
        px(7, 4, 1, 5, C.outline);
        px(3, 10, 1, 6, C.outline);
        px(12, 10, 1, 6, C.outline);
        px(0, 15, 16, 1, C.outline);
        break;
      case 'doorOpen':
        floor();
        break;
      case 'doorLocked':
        px(0, 0, 16, 16, WALL);
        for (let x = 1; x < 16; x += 4) px(x, 1, 2, 14, css(COLOR.outline));
        px(0, 7, 16, 2, css(COLOR.primaryDeep));
        break;
      case 'water':
        px(0, 0, 16, 16, WATER);
        px(2, 4, 5, 1, WATER_LIGHT);
        px(9, 10, 5, 1, WATER_LIGHT);
        break;
      case 'pillar':
        px(0, 0, 16, 16, STONE);
        px(2, 0, 12, 14, WALL);
        px(2, 0, 12, 4, WALL_TOP);
        px(1, 13, 14, 3, C.outline);
        px(2, 0, 1, 14, C.outline);
        px(13, 0, 1, 14, C.outline);
        break;
      case 'gate':
        floor();
        for (let x = 1; x < 16; x += 3) px(x, 0, 2, 16, css(COLOR.outline));
        px(0, 3, 16, 2, css(COLOR.inkSoft));
        px(0, 11, 16, 2, css(COLOR.inkSoft));
        break;
      case 'rock':
        floor();
        px(1, 2, 14, 13, css(COLOR.draw));
        px(1, 14, 14, 2, C.outline);
        px(7, 2, 1, 6, C.outline);
        px(5, 7, 3, 1, C.outline);
        px(4, 8, 1, 4, C.outline);
        break;
      case 'switch':
      case 'switchOn':
        px(0, 0, 16, 16, WATER);
        px(3, 3, 10, 10, WALL);
        px(5, 5, 6, 6, k === 'switch' ? css(COLOR.pink) : css(COLOR.win));
        px(3, 12, 10, 1, C.outline);
        break;
      case 'vine':
        px(0, 0, 16, 16, WATER);
        px(2, 1, 12, 14, css(COLOR.win));
        px(4, 3, 2, 2, css(COLOR.outline));
        px(10, 8, 2, 2, css(COLOR.outline));
        px(6, 11, 2, 2, css(COLOR.outline));
        break;
      case 'stairs':
        px(0, 0, 16, 16, WALL);
        for (let i = 0; i < 4; i++) px(1 + i, 2 + i * 3, 14 - i * 2, 3, i % 2 ? STONE : STONE_LINE);
        px(0, 0, 16, 1, C.outline);
        px(6, 14, 4, 2, css(COLOR.primary));
        break;
      case 'chest':
      case 'chestOpen':
        floor();
        px(2, 5, 12, 10, css(COLOR.primaryDeep));
        px(2, 5, 12, 2, k === 'chest' ? css(COLOR.inkSoft) : css(COLOR.outline));
        px(2, 9, 12, 1, css(COLOR.inkSoft));
        px(7, 8, 2, 3, css(COLOR.primary));
        px(2, 14, 12, 1, C.outline);
        if (k === 'chestOpen') px(3, 3, 10, 2, css(COLOR.inkSoft));
        break;
      case 'pedestal':
      case 'pedestalEmpty':
        floor();
        px(4, 9, 8, 6, WALL_TOP);
        px(3, 14, 10, 1, C.outline);
        if (k === 'pedestal') {
          px(5, 3, 6, 6, css(COLOR.primary));
          px(6, 4, 2, 2, C.white);
        }
        break;
      case 'shop':
        floor();
        px(1, 7, 14, 8, css(COLOR.primaryDeep));
        px(1, 7, 14, 1, C.outline);
        px(4, 1, 8, 6, C.skin);
        px(5, 3, 2, 1, C.outline);
        px(9, 3, 2, 1, C.outline);
        px(3, 0, 10, 2, css(COLOR.teamA));
        break;
      case 'fountain':
      case 'fountainDry':
        floor();
        px(1, 5, 14, 10, WALL_TOP);
        px(3, 7, 10, 6, k === 'fountain' ? WATER_LIGHT : STONE);
        px(1, 14, 14, 1, C.outline);
        break;
      case 'rubble':
        floor();
        px(3, 9, 3, 2, css(COLOR.draw));
        px(9, 5, 2, 2, css(COLOR.draw));
        px(11, 11, 3, 2, css(COLOR.draw));
        break;
    }
    g.restore();
  });
  return cv;
}

// ---------- 적 ----------
export const enemySize = (id: string) => (id === 'golem' ? 32 : id === 'knight' ? 24 : 16);
export function placeholderEnemy(id: string): HTMLCanvasElement {
  const S = enemySize(id);
  const cv = document.createElement('canvas');
  cv.width = S * 4;
  cv.height = S;
  const g = cv.getContext('2d')!;
  const one = document.createElement('canvas');
  one.width = one.height = S;
  const o = one.getContext('2d')!;
  for (let f = 0; f < 4; f++) {
    o.clearRect(0, 0, S, S);
    const px = (x: number, y: number, w: number, h: number, c: string) => {
      o.fillStyle = c;
      o.fillRect(x, y, w, h);
    };
    const bob = f === 1 ? 1 : 0;
    const wind = f === 2;
    const hurt = f === 3;
    const eye = hurt ? C.white : C.outline;
    switch (id) {
      case 'slime':
        px(2, 6 + bob, 12, 8 - bob, '#9a6a3a');
        px(4, 4 + bob, 8, 3, '#9a6a3a');
        px(4, 6 + bob, 3, 2, '#c89a5a');
        px(5, 8 + bob, 2, 2, eye);
        px(9, 8 + bob, 2, 2, eye);
        if (wind) px(2, 12, 12, 2, css(COLOR.pink));
        break;
      case 'bat':
        px(5, 5, 6, 6, css(COLOR.outline));
        px(1, 4 + bob * 2, 4, 4, css(COLOR.inkSoft));
        px(11, 4 + bob * 2, 4, 4, css(COLOR.inkSoft));
        px(6, 7, 1, 1, css(COLOR.pink));
        px(9, 7, 1, 1, css(COLOR.pink));
        break;
      case 'spitter':
        px(6, 9, 4, 6, css(COLOR.panel));
        px(2, 3 - (wind ? 1 : 0), 12, 7, css(COLOR.pink));
        px(4, 4, 2, 2, C.white);
        px(10, 5, 2, 2, C.white);
        px(6, 11, 1, 1, eye);
        px(9, 11, 1, 1, eye);
        break;
      case 'goblin':
        px(4, 4 + bob, 8, 10 - bob, css(COLOR.draw));
        px(5, 1 + bob, 2, 3, css(COLOR.primary));
        px(9, 1 + bob, 2, 3, css(COLOR.primary));
        px(5, 7 + bob, 2, 2, eye);
        px(9, 7 + bob, 2, 2, eye);
        px(wind ? 12 : 11, wind ? 2 : 8, 3, wind ? 8 : 6, css(COLOR.inkSoft));
        break;
      case 'knight':
        px(6, 6 + bob, 12, 15 - bob, css(ROULETTE.winter));
        px(7, 2 + bob, 10, 8, css(COLOR.draw));
        px(9, 0 + bob, 6, 3, css(COLOR.pink));
        px(8, 6 + bob, 8, 2, css(COLOR.outline));
        px(9, 6 + bob, 2, 1, hurt ? C.white : css(COLOR.primary));
        px(13, 6 + bob, 2, 1, hurt ? C.white : css(COLOR.primary));
        px(wind ? 18 : 17, wind ? 1 : 10, 3, wind ? 14 : 11, css(COLOR.lineSoft));
        px(3, 10 + bob, 4, 8, css(COLOR.teamA));
        break;
      case 'golem':
        px(4, 8 + bob, 24, 20 - bob, css(COLOR.draw));
        px(8, 2 + bob, 16, 10, css(ROULETTE.winter));
        px(1, wind ? 4 : 12, 6, 12, css(COLOR.draw));
        px(25, wind ? 4 : 12, 6, 12, css(COLOR.draw));
        px(11, 6 + bob, 3, 3, hurt ? C.white : css(COLOR.primary));
        px(18, 6 + bob, 3, 3, hurt ? C.white : css(COLOR.primary));
        px(9, 16, 14, 2, css(COLOR.inkSoft));
        px(15, 12, 2, 10, css(COLOR.inkSoft));
        px(6, 27, 8, 4, css(COLOR.inkSoft));
        px(18, 27, 8, 4, css(COLOR.inkSoft));
        break;
      default:
        px(3, 3, S - 6, S - 6, css(COLOR.pink));
    }
    addOutline(o, S);
    g.drawImage(one, f * S, 0);
  }
  return cv;
}
