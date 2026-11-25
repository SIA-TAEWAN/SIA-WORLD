/**
 * 임시 도트 그림 (코드로 그린 플레이스홀더). 같은 이름의 PNG 가 public/art/ 에 있고 manifest.json 에 적혀 있으면 그 파일을 쓴다 (ASSETS.md).
 *
 * 캐릭터 레이어 시트: 한 칸 32×32, 가로 8칸 × 세로 4줄 = 256×128.
 *   가로: 0 대기 · 1~4 걷기 · 5~7 공격 /  세로: 0 아래 · 1 왼쪽 · 2 오른쪽 · 3 위.
 *   모든 레이어(몸·얼굴·옷·머리)가 같은 칸에 같은 자세로 그려져 겹치면 한 사람이 된다. 그리는 순서 몸 → 얼굴 → 옷 → 머리.
 * 타일 시트: 16×16 칸을 가로 한 줄로 (TILE_ORDER 순서).
 * 적 시트: 한 칸 size×size, 가로 4칸 (0·1 걷기, 2 공격 준비, 3 맞음).
 */
import { COLOR, MATGO, RACE, ROULETTE, TABLE, css } from '../theme';
import type { Look } from '../game/progress';
import { ENEMIES } from '../data';

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
/**
 * tiles.png · tiles-<테마>.png 의 칸 순서 (ASSETS.md). 처음 22칸은 1구역 그대로, 새 칸은 뒤에만 붙인다
 * (시트가 이보다 좁으면 모자란 칸은 코드 그림 — art/load.ts).
 */
export const TILE_ORDER = [
  'floor', 'floor2', 'wallTop', 'wallFace', 'doorOpen', 'doorLocked', 'water', 'pillar', 'gate', 'rock', 'switch', 'switchOn',
  'vine', 'stairs', 'chest', 'chestOpen', 'pedestal', 'pedestalEmpty', 'shop', 'fountain', 'rubble', 'fountainDry',
  'plate', 'plateOn', 'brazier', 'brazierLit', 'post',
  // 3~5구역 (뒤에만 붙인다): 찬물 · 얼음 · 풍경 · 울리는 풍경 · 징 · 울리는 징 · 둥근 바위 · 구덩이
  'coldWater', 'ice', 'bell', 'bellOn', 'gong', 'gongOn', 'boulder', 'pit',
  // 6~10구역 (뒤에만 붙인다): 뇌석 · 빛나는 뇌석 · 구름 덩이 · 쇠창살 · 거울 / · 거울 \ · 짙은 구름 · 소원 구슬
  'rod', 'rodOn', 'puff', 'bars', 'mirrorA', 'mirrorB', 'fog', 'wish',
] as const;
export type TileArt = (typeof TILE_ORDER)[number];
export const tileArtIndex = (k: TileArt) => TILE_ORDER.indexOf(k);

/**
 * 테마마다 코드 그림 색 (DESIGN.md 의 기존 색만). stone = 1~10층 돌 복도, moss = 11~20층 이끼 낀 회랑,
 * frost = 21~30층 서리 누각, cloud = 31~40층 새벽 구름 뜰(물 = 구름 바다), ember = 41~50층 잿불 성채(물 = 용암),
 * thunder = 51~60층 천둥 마루(물 = 먹구름), galaxy = 61~70층 은하 나루(물 = 은하수), flower = 71~80층 서천 꽃밭(물 = 연못),
 * storm = 81~90층 칠성 폭풍단(물 = 폭풍 구름), wish = 91~100층 소원의 정상(물 = 금빛 구름).
 * moss = 금 간 바닥·벽에 얹는 무늬 색 (이끼 · 눈 · 금빛 · 재)
 */
interface Palette {
  floor: string;
  line: string;
  wall: string;
  wallTop: string;
  water: string;
  waterLight: string;
  moss?: string;
}
const PALETTES: Record<string, Palette> = {
  stone: { floor: css(ROULETTE.winter), line: css(COLOR.lineSoft), wall: css(COLOR.inkSoft), wallTop: css(COLOR.emptyLine), water: css(COLOR.teamA), waterLight: css(COLOR.skyMid) },
  moss: { floor: css(ROULETTE.autumn), line: css(MATGO.matLight), wall: css(COLOR.inkSoft), wallTop: css(TABLE.matgo), water: css(COLOR.teamA), waterLight: css(ROULETTE.autumn), moss: css(MATGO.matDark) },
  frost: { floor: css(ROULETTE.spring), line: css(COLOR.skyMid), wall: css(COLOR.skyDeep), wallTop: css(TABLE.blackjack), water: css(COLOR.teamA), waterLight: css(COLOR.skyMid), moss: css(COLOR.white) },
  cloud: { floor: css(COLOR.skyBottom), line: css(ROULETTE.summer), wall: css(COLOR.lose), wallTop: css(COLOR.panel), water: css(COLOR.skyMid), waterLight: css(COLOR.white), moss: css(COLOR.primary) },
  ember: { floor: css(ROULETTE.summer), line: css(RACE.trackDark), wall: css(COLOR.inkSoft), wallTop: css(RACE.track), water: css(COLOR.pink), waterLight: css(COLOR.primary), moss: css(COLOR.draw) },
  thunder: { floor: css(COLOR.draw), line: css(COLOR.inkSoft), wall: css(COLOR.skyDeep), wallTop: css(COLOR.teamA), water: css(COLOR.inkSoft), waterLight: css(COLOR.primaryLight), moss: css(COLOR.primary) },
  galaxy: { floor: css(COLOR.emptyLine), line: css(COLOR.inkSoft), wall: css(COLOR.skyDeep), wallTop: css(COLOR.skyTop), water: css(COLOR.outline), waterLight: css(COLOR.white), moss: css(COLOR.primaryLight) },
  flower: { floor: css(MATGO.matLight), line: css(MATGO.matDark), wall: css(COLOR.inkSoft), wallTop: css(COLOR.pink), water: css(COLOR.skyMid), waterLight: css(COLOR.white), moss: css(COLOR.pink) },
  storm: { floor: css(COLOR.lineSoft), line: css(COLOR.draw), wall: css(COLOR.outline), wallTop: css(COLOR.skyDeep), water: css(COLOR.draw), waterLight: css(COLOR.white), moss: css(COLOR.primaryLight) },
  wish: { floor: css(COLOR.panelStrong), line: css(COLOR.primary), wall: css(TABLE.poker), wallTop: css(COLOR.panel), water: css(COLOR.primaryLight), waterLight: css(COLOR.white), moss: css(COLOR.pink) },
};
export const tileThemes = Object.keys(PALETTES);

export function placeholderTiles(theme = 'stone'): HTMLCanvasElement {
  const P = PALETTES[theme] ?? PALETTES.stone;
  const STONE = P.floor;
  const STONE_LINE = P.line;
  const WALL = P.wall;
  const WALL_TOP = P.wallTop;
  const WATER = P.water;
  const WATER_LIGHT = P.waterLight;
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
      if (alt && P.moss) {
        px(2, 2, 3, 2, P.moss);
        px(11, 12, 2, 2, P.moss);
      }
    };
    switch (k) {
      case 'floor': floor(); break;
      case 'floor2': floor(true); break;
      case 'wallTop':
        px(0, 0, 16, 16, WALL_TOP);
        px(0, 15, 16, 1, C.outline);
        px(3, 4, 4, 2, P.moss ?? WALL);
        px(10, 10, 3, 2, P.moss ?? WALL);
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
        if (P.moss) {
          // 벽을 타고 내려온 이끼
          px(1, 3, 3, 4, P.moss);
          px(11, 3, 2, 7, P.moss);
        }
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
      case 'plate':
      case 'plateOn':
        // 발판: 눌리면 낮아지고 노랗게 빛난다
        floor();
        px(2, 3, 12, 11, C.outline);
        px(3, 4, 10, 9, k === 'plate' ? WALL_TOP : css(COLOR.primary));
        if (k === 'plate') px(3, 11, 10, 2, WALL);
        else px(5, 6, 6, 5, css(COLOR.primaryLight));
        break;
      case 'brazier':
      case 'brazierLit':
        // 화로: 돌 그릇 + 불꽃 (꺼지면 재)
        floor();
        px(3, 8, 10, 7, WALL);
        px(2, 7, 12, 2, WALL_TOP);
        px(2, 14, 12, 1, C.outline);
        if (k === 'brazierLit') {
          px(5, 1, 6, 7, css(COLOR.pink));
          px(6, 3, 4, 5, css(COLOR.primaryDeep));
          px(7, 4, 2, 3, css(COLOR.primary));
        } else px(5, 6, 6, 1, css(COLOR.draw));
        break;
      case 'post':
        // 말뚝: 물가에 박힌 나무 기둥 + 감을 고리
        floor();
        px(5, 1, 6, 14, css(COLOR.primaryDeep));
        px(5, 1, 6, 2, css(COLOR.primary));
        px(4, 6, 8, 2, C.outline);
        px(5, 14, 6, 1, C.outline);
        break;
      case 'coldWater':
        // 찬물: 옅은 물빛 + 살얼음 금 (얼릴 수 있는 물 — 보통 물보다 밝다)
        px(0, 0, 16, 16, css(COLOR.skyMid));
        px(1, 3, 6, 1, C.white);
        px(9, 7, 6, 1, C.white);
        px(3, 12, 5, 1, C.white);
        px(6, 3, 1, 4, css(COLOR.teamA));
        px(11, 8, 1, 4, css(COLOR.teamA));
        break;
      case 'ice':
        // 얼음: 하얀 얼음판 + 빗금 (걸을 수 있다)
        px(0, 0, 16, 16, C.white);
        px(0, 0, 16, 1, css(COLOR.skyMid));
        px(2, 9, 5, 1, css(COLOR.skyMid));
        px(8, 4, 6, 1, css(COLOR.skyMid));
        px(10, 12, 4, 1, css(COLOR.skyMid));
        break;
      case 'bell':
      case 'bellOn':
        // 풍경: 나무 걸이 + 매달린 종 (울리면 노랗게 빛나고 흔들린다)
        floor();
        px(2, 1, 12, 2, css(COLOR.inkSoft));
        px(7, 3, 2, 2, C.outline);
        px(k === 'bell' ? 4 : 5, 5, 8, 7, k === 'bell' ? css(COLOR.primaryDeep) : css(COLOR.primary));
        px(k === 'bell' ? 4 : 5, 11, 8, 1, C.outline);
        px(7, 12, 2, 2, C.outline);
        if (k === 'bellOn') {
          px(1, 6, 2, 1, C.white);
          px(13, 6, 2, 1, C.white);
          px(1, 9, 2, 1, C.white);
          px(13, 9, 2, 1, C.white);
        }
        break;
      case 'gong':
      case 'gongOn':
        // 징: 나무 틀에 걸린 둥근 놋쇠판 (울리면 둘레에 물결)
        floor();
        px(1, 2, 2, 13, css(COLOR.inkSoft));
        px(13, 2, 2, 13, css(COLOR.inkSoft));
        px(1, 2, 14, 2, css(COLOR.inkSoft));
        px(4, 5, 8, 8, C.outline);
        px(5, 6, 6, 6, k === 'gong' ? css(COLOR.primaryDeep) : css(COLOR.primaryLight));
        px(7, 8, 2, 2, k === 'gong' ? css(COLOR.primary) : C.white);
        if (k === 'gongOn') {
          px(3, 4, 1, 10, css(COLOR.primary));
          px(12, 4, 1, 10, css(COLOR.primary));
        }
        break;
      case 'boulder':
        // 둥근 바위: 동그란 큰 돌 (금 간 바위와 달리 둥글고 줄무늬 — 밀어 굴린다)
        floor();
        px(3, 2, 10, 12, css(COLOR.draw));
        px(2, 4, 12, 8, css(COLOR.draw));
        px(4, 3, 4, 2, css(COLOR.lineSoft));
        px(3, 8, 10, 1, css(COLOR.inkSoft));
        px(2, 13, 12, 2, C.outline);
        break;
      case 'pit':
        // 구덩이: 어두운 구멍 (못 걷고, 둥근 바위로 메운다)
        floor();
        px(1, 2, 14, 13, C.outline);
        px(2, 2, 12, 2, css(COLOR.inkSoft));
        break;
      case 'rod':
      case 'rodOn':
        // 뇌석: 바닥에 박힌 길쭉한 돌기둥 + 꼭대기 쇠 갓 (빛나면 노란 번개가 감긴다)
        floor();
        px(5, 3, 6, 11, css(COLOR.draw));
        px(4, 1, 8, 3, css(COLOR.inkSoft));
        px(7, 0, 2, 2, css(COLOR.lineSoft));
        px(4, 13, 8, 2, C.outline);
        if (k === 'rodOn') {
          px(3, 5, 10, 1, css(COLOR.primaryLight));
          px(6, 7, 1, 4, css(COLOR.primary));
          px(9, 6, 1, 4, css(COLOR.primary));
          px(2, 0, 2, 2, C.white);
          px(12, 2, 2, 2, C.white);
        }
        break;
      case 'puff':
        // 구름 덩이: 둥실 뜬 흰 구름 뭉치 (그림자가 바닥에)
        floor();
        px(2, 13, 12, 2, css(COLOR.inkSoft));
        px(2, 5, 12, 7, C.white);
        px(4, 3, 5, 3, C.white);
        px(8, 2, 5, 4, C.white);
        px(3, 10, 10, 2, css(COLOR.skyMid));
        break;
      case 'bars':
        // 쇠창살: 굵은 쇠막대 + 가로 띠 (백호가 자른다)
        floor();
        for (let x = 1; x < 16; x += 4) px(x, 0, 2, 16, css(COLOR.draw));
        for (let x = 1; x < 16; x += 4) px(x, 0, 1, 16, css(COLOR.lineSoft));
        px(0, 4, 16, 2, css(COLOR.inkSoft));
        px(0, 11, 16, 2, css(COLOR.inkSoft));
        break;
      case 'mirrorA':
      case 'mirrorB':
        // 하늘 거울: 나무 틀에 비스듬한 거울판 (/ 또는 \)
        floor();
        px(1, 14, 14, 2, css(COLOR.inkSoft));
        for (let i = 0; i < 12; i++) {
          const x = k === 'mirrorA' ? 13 - i : 2 + i;
          px(x - 1, 1 + i, 3, 2, css(COLOR.skyMid));
          px(x, 1 + i, 1, 1, C.white);
        }
        break;
      case 'fog':
        // 짙은 구름: 바닥을 덮은 회색 구름 덩어리 (걷을 수 있다)
        px(0, 0, 16, 16, css(COLOR.draw));
        px(1, 2, 7, 4, css(COLOR.lineSoft));
        px(8, 7, 7, 4, css(COLOR.lineSoft));
        px(2, 11, 6, 3, css(COLOR.lineSoft));
        px(3, 3, 3, 1, C.white);
        break;
      case 'wish':
        // 소원 구슬: 받침 위에 빛나는 큰 구슬 (100층)
        floor();
        px(4, 11, 8, 4, WALL_TOP);
        px(3, 14, 10, 1, C.outline);
        px(4, 2, 8, 9, css(COLOR.primaryLight));
        px(3, 4, 10, 5, css(COLOR.primaryLight));
        px(5, 3, 3, 3, C.white);
        px(9, 8, 2, 2, css(COLOR.pink));
        break;
    }
    g.restore();
  });
  return cv;
}

// ---------- 적 ----------
/** 적 시트 한 칸 크기 (enemies.json 의 size: 일반 16 · 정예 24 · 보스 32) */
export const enemySize = (id: string) => ENEMIES.find((e) => e.id === id)?.size ?? 16;
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
      // ---- 2구역 (이끼 낀 회랑) ----
      case 'sprout':
        // 가시 덩굴싹: 땅에 뿌리박은 싹, 입을 벌려 가시를 뱉는다
        px(5, 11, 6, 4, css(COLOR.inkSoft));
        px(3, 4 - (wind ? 1 : 0), 10, 8, css(COLOR.win));
        px(2, 6, 2, 3, css(MATGO.matDark));
        px(12, 6, 2, 3, css(MATGO.matDark));
        px(6, 1 - (wind ? 1 : 0), 4, 3, css(MATGO.matLight));
        px(5, 7, 2, 2, eye);
        px(9, 7, 2, 2, eye);
        if (wind) px(6, 10, 4, 2, css(COLOR.pink));
        break;
      case 'moth':
        // 이끼 나방: 초록 날개, 독 가루
        px(6, 5, 4, 7, css(COLOR.inkSoft));
        px(1, 3 + bob * 2, 5, 6, css(MATGO.matLight));
        px(10, 3 + bob * 2, 5, 6, css(MATGO.matLight));
        px(2, 4 + bob * 2, 2, 2, css(COLOR.pink));
        px(12, 4 + bob * 2, 2, 2, css(COLOR.pink));
        px(6, 6, 1, 1, eye);
        px(9, 6, 1, 1, eye);
        break;
      case 'lizard':
        // 이끼 도마뱀: 낮게 엎드린 몸, 등에 이끼
        px(2, 8 + bob, 11, 5, css(COLOR.win));
        px(10, 6 + bob, 5, 5, css(COLOR.win));
        px(3, 7 + bob, 7, 2, css(MATGO.matDark));
        px(0, 10 + bob, 3, 2, css(COLOR.win));
        px(12, 7 + bob, 2, 2, eye);
        px(3, 13, 2, 2, css(COLOR.inkSoft));
        px(9, 13, 2, 2, css(COLOR.inkSoft));
        if (wind) px(14, 9, 2, 2, css(COLOR.pink));
        break;
      case 'toad':
        // 바위 두꺼비: 등이 바위인 두꺼비 (뛰기 전에 웅크린다)
        px(2, 6 + (wind ? 2 : bob), 12, 8 - (wind ? 2 : bob), css(COLOR.draw));
        px(3, 4 + (wind ? 2 : bob), 4, 3, css(COLOR.draw));
        px(9, 4 + (wind ? 2 : bob), 4, 3, css(COLOR.draw));
        px(4, 5 + (wind ? 2 : bob), 2, 2, eye);
        px(10, 5 + (wind ? 2 : bob), 2, 2, eye);
        px(5, 9 + (wind ? 2 : 0), 6, 2, css(MATGO.matDark));
        px(4, 12, 8, 2, css(COLOR.lineSoft));
        break;
      case 'treant':
        // 고목 수호자: 나무 줄기 몸, 이끼 머리, 뿌리 팔
        px(7, 6 + bob, 10, 16 - bob, css(COLOR.inkSoft));
        px(4, 1 + bob, 16, 8, css(COLOR.win));
        px(6, 0 + bob, 4, 2, css(MATGO.matLight));
        px(14, 0 + bob, 4, 2, css(MATGO.matLight));
        px(9, 9 + bob, 2, 2, hurt ? C.white : css(COLOR.primary));
        px(13, 9 + bob, 2, 2, hurt ? C.white : css(COLOR.primary));
        px(2, wind ? 4 : 11, 5, 9, css(COLOR.inkSoft));
        px(17, wind ? 4 : 11, 5, 9, css(COLOR.inkSoft));
        px(9, 15, 6, 2, css(MATGO.matDark));
        break;
      case 'imugi':
        // 이끼 이무기: 똬리 튼 큰 뱀, 이끼 비늘, 여의주를 바라는 눈
        px(2, 18 + bob, 28, 12 - bob, css(COLOR.win));
        px(6, 14 + bob, 20, 6, css(MATGO.matDark));
        px(16, 4 + bob, 13, 12, css(COLOR.win));
        px(17, 2 + bob, 3, 3, css(MATGO.matLight));
        px(25, 2 + bob, 3, 3, css(MATGO.matLight));
        px(19, 8 + bob, 3, 3, hurt ? C.white : css(COLOR.primary));
        px(25, 8 + bob, 3, 3, hurt ? C.white : css(COLOR.primary));
        px(22, 13 + bob, 7, 2, wind ? css(COLOR.pink) : css(COLOR.outline));
        px(4, 22, 22, 2, css(ROULETTE.autumn));
        px(4, 26, 3, 3, css(MATGO.matDark));
        px(12, 26, 3, 3, css(MATGO.matDark));
        break;
      // ---- 3구역 (서리 누각) ----
      case 'snowimp':
        // 눈 도깨비: 하얀 털뭉치 몸, 파란 뿔 하나, 얼음 방망이 (준비 칸은 방망이를 치켜듦)
        px(3, 5 + bob, 10, 9 - bob, C.white);
        px(7, 1 + bob, 2, 4, css(COLOR.skyDeep));
        px(5, 7 + bob, 2, 2, eye);
        px(9, 7 + bob, 2, 2, eye);
        px(6, 11 + bob, 4, 1, css(COLOR.skyMid));
        px(wind ? 12 : 12, wind ? 1 : 8, 3, wind ? 8 : 6, css(COLOR.skyMid));
        break;
      case 'icebat':
        // 고드름 박쥐: 하늘색 날개, 몸 아래 고드름
        px(5, 4, 6, 6, css(COLOR.skyDeep));
        px(1, 3 + bob * 2, 4, 4, css(COLOR.skyMid));
        px(11, 3 + bob * 2, 4, 4, css(COLOR.skyMid));
        px(6, 10, 1, 3, C.white);
        px(9, 10, 1, 2, C.white);
        px(6, 6, 1, 1, hurt ? C.white : css(COLOR.primaryLight));
        px(9, 6, 1, 1, hurt ? C.white : css(COLOR.primaryLight));
        break;
      case 'frostjar':
        // 서리 항아리: 서리 낀 옹기, 아가리에서 찬 기운 (준비 칸은 기운이 솟음)
        px(4, 6, 8, 9, css(COLOR.inkSoft));
        px(5, 4, 6, 2, css(COLOR.inkSoft));
        px(4, 8, 8, 2, C.white);
        px(6, 10, 1, 1, eye);
        px(9, 10, 1, 1, eye);
        px(6, wind ? 0 : 2, 4, wind ? 4 : 2, css(COLOR.skyMid));
        break;
      case 'wisp':
        // 푸른 도깨비불: 흔들리는 파란 불꽃 (준비 칸은 커지며 하얘진다)
        px(4, 5 - bob, 8, 9, wind ? C.white : css(COLOR.skyTop));
        px(6, 2 - bob, 4, 4, wind ? css(COLOR.skyMid) : css(COLOR.teamA));
        px(5, 9 - bob, 6, 4, css(COLOR.skyMid));
        px(6, 8 - bob, 1, 2, eye);
        px(9, 8 - bob, 1, 2, eye);
        break;
      case 'haetae':
        // 서리 해태: 하얀 갈기 사자 (뿔 하나, 파란 비늘), 준비 칸은 입을 벌려 찬 숨
        px(4, 9 + bob, 16, 11 - bob, css(COLOR.skyMid));
        px(12, 3 + bob, 10, 10, css(COLOR.skyMid));
        px(10, 2 + bob, 6, 12, C.white);
        px(16, 0 + bob, 2, 3, css(COLOR.primary));
        px(17, 6 + bob, 2, 2, hurt ? C.white : css(COLOR.outline));
        px(18, 11 + bob, 4, 2, wind ? css(COLOR.pink) : css(COLOR.outline));
        px(5, 20, 3, 3, css(COLOR.skyDeep));
        px(15, 20, 3, 3, css(COLOR.skyDeep));
        px(1, 10 + bob, 4, 3, C.white);
        break;
      case 'winterGeneral':
        // 동장군: 서리 갑옷 장수, 흰 수염, 얼음 창 (준비 칸은 창을 높이 듦)
        px(8, 12 + bob, 16, 16 - bob, css(COLOR.skyDeep));
        px(10, 3 + bob, 12, 11, css(ROULETTE.spring));
        px(9, 1 + bob, 14, 4, css(COLOR.teamA));
        px(15, -1 + bob, 2, 3, css(COLOR.white));
        px(12, 7 + bob, 2, 2, hurt ? C.white : css(COLOR.outline));
        px(18, 7 + bob, 2, 2, hurt ? C.white : css(COLOR.outline));
        px(11, 10 + bob, 10, 6, C.white);
        px(8, 18, 16, 2, css(COLOR.primary));
        px(wind ? 26 : 25, wind ? 0 : 6, 2, wind ? 30 : 24, css(COLOR.inkSoft));
        px(wind ? 25 : 24, wind ? 0 : 4, 4, 4, css(COLOR.skyMid));
        px(9, 28, 6, 3, css(COLOR.outline));
        px(17, 28, 6, 3, css(COLOR.outline));
        break;
      case 'icecrystal':
        // 얼음 수정: 바닥에서 솟은 뾰족 수정 (맞음 칸은 금이 간다)
        px(6, 2, 4, 12, css(COLOR.skyMid));
        px(3, 6, 3, 8, css(TABLE.blackjack));
        px(10, 5, 3, 9, css(TABLE.blackjack));
        px(7, 3, 1, 8, C.white);
        if (hurt) px(8, 6, 1, 5, css(COLOR.outline));
        px(2, 14, 12, 1, css(COLOR.skyDeep));
        break;
      // ---- 4구역 (새벽 구름 뜰) ----
      case 'ram':
        // 솜털 숫양: 동글동글 흰 털, 말린 뿔 (준비 칸은 머리를 숙여 박치기 자세)
        px(2, 6 + bob, 11, 8 - bob, css(COLOR.panel));
        px(10, wind ? 7 : 4 + bob, 5, 5, css(COLOR.inkSoft));
        px(9, wind ? 6 : 3 + bob, 3, 3, css(COLOR.primaryDeep));
        px(12, (wind ? 9 : 6) + bob, 1, 1, eye);
        px(3, 13, 2, 2, css(COLOR.outline));
        px(9, 13, 2, 2, css(COLOR.outline));
        break;
      case 'kite':
        // 방패연 요괴: 네모난 방패연(가운데 구멍), 꼬리, 큰 눈 (준비 칸은 기울어짐)
        px(3, 2 + bob, 10, 10, css(COLOR.panel));
        px(3, 2 + bob, 10, 2, css(COLOR.teamA));
        px(3, 10 + bob, 10, 2, css(COLOR.lose));
        px(7, 6 + bob, 2, 2, css(COLOR.skyMid));
        px(5, 5 + bob, 1, 1, eye);
        px(10, 5 + bob, 1, 1, eye);
        px(7, 12 + bob, 1, 3, css(COLOR.inkSoft));
        if (wind) px(12, 6, 3, 2, css(COLOR.pink));
        break;
      case 'chick':
        // 솜털 병아리: 노란 동그라미, 주황 부리
        px(4, 5 + bob, 9, 8, css(COLOR.primaryLight));
        px(6, 3 + bob, 5, 3, css(COLOR.primaryLight));
        px(12, 7 + bob, 3, 2, css(COLOR.primaryDeep));
        px(10, 6 + bob, 1, 1, eye);
        px(6, 13, 1, 2, css(COLOR.primaryDeep));
        px(9, 13, 1, 2, css(COLOR.primaryDeep));
        break;
      case 'scarecrow':
        // 허수아비: 밀짚모자, 십자 막대, 누더기 옷 (준비 칸은 팔을 벌려 짚을 날림)
        px(7, 6, 2, 9, css(COLOR.inkSoft));
        px(wind ? 0 : 2, 7, wind ? 16 : 12, 2, css(COLOR.inkSoft));
        px(4, 2, 8, 2, css(COLOR.primary));
        px(5, 0, 6, 2, css(COLOR.primary));
        px(5, 4, 6, 4, css(COLOR.panel));
        px(6, 5, 1, 1, eye);
        px(9, 5, 1, 1, eye);
        px(5, 9, 6, 4, css(COLOR.lose));
        break;
      case 'geumgye':
        // 금계 장수: 금빛 깃 장닭 무사, 붉은 볏, 깃 창 (준비 칸은 날개를 펴고 웅크림)
        px(6, 8 + bob, 12, 12 - bob, css(COLOR.primary));
        px(10, 2 + bob, 8, 8, css(COLOR.primary));
        px(11, 0 + bob, 5, 3, css(COLOR.lose));
        px(18, 5 + bob, 3, 2, css(COLOR.primaryDeep));
        px(15, 4 + bob, 2, 2, hurt ? C.white : css(COLOR.outline));
        px(wind ? 1 : 3, wind ? 6 : 10, 5, 8, css(COLOR.primaryDeep));
        px(3, 14, 4, 6, css(COLOR.lose));
        px(8, 20, 2, 3, css(COLOR.primaryDeep));
        px(14, 20, 2, 3, css(COLOR.primaryDeep));
        break;
      case 'yeongdeung':
        // 영등할미: 구름 위 바람 할머니 — 흰 쪽머리, 푸른 치마가 바람에 날리고 큰 부채 (준비 칸은 부채를 크게 젖힘)
        px(6, 22, 22, 8, C.white);
        px(9, 12 + bob, 14, 12 - bob, css(COLOR.teamA));
        px(11, 3 + bob, 10, 10, C.skin);
        px(10, 1 + bob, 12, 4, C.white);
        px(20, 0 + bob, 4, 3, C.white);
        px(13, 7 + bob, 2, 1, hurt ? C.white : css(COLOR.outline));
        px(18, 7 + bob, 2, 1, hurt ? C.white : css(COLOR.outline));
        px(14, 10 + bob, 4, 1, css(COLOR.pink));
        px(wind ? 22 : 23, wind ? 2 : 12, 8, 8, css(COLOR.primary));
        px(wind ? 22 : 23, wind ? 2 : 12, 8, 2, css(COLOR.lose));
        break;
      // ---- 5구역 (잿불 성채) ----
      case 'bulgae':
        // 불개: 검붉은 개, 꼬리와 갈기가 불꽃 (준비 칸은 낮게 웅크림)
        px(2, 7 + (wind ? 1 : bob), 11, 6, css(COLOR.lose));
        px(10, 4 + (wind ? 2 : bob), 5, 5, css(COLOR.lose));
        px(0, 4 + bob, 3, 4, css(COLOR.primary));
        px(6, 5 + bob, 4, 2, css(COLOR.primary));
        px(13, 6 + (wind ? 2 : bob), 1, 1, eye);
        px(3, 13, 2, 2, css(COLOR.outline));
        px(10, 13, 2, 2, css(COLOR.outline));
        break;
      case 'torchimp':
        // 횃불 도깨비: 붉은 도깨비, 뿔 둘, 손에 횃불 (준비 칸은 횃불을 뒤로 젖혀 던질 자세)
        px(4, 5 + bob, 8, 9 - bob, css(COLOR.lose));
        px(5, 2 + bob, 2, 3, css(COLOR.panel));
        px(9, 2 + bob, 2, 3, css(COLOR.panel));
        px(5, 7 + bob, 2, 2, eye);
        px(9, 7 + bob, 2, 2, eye);
        px(wind ? 0 : 12, wind ? 2 : 6, 2, 6, css(COLOR.inkSoft));
        px(wind ? 0 : 12, wind ? 0 : 3, 3, 3, css(COLOR.primary));
        break;
      case 'wildcat':
        // 얼룩 살쾡이: 주황 바탕 검은 얼룩, 뾰족 귀 (준비 칸은 웅크려 덮칠 자세)
        px(2, 7 + (wind ? 2 : bob), 11, 6 - (wind ? 1 : 0), css(COLOR.primaryDeep));
        px(10, 4 + (wind ? 3 : bob), 5, 5, css(COLOR.primaryDeep));
        px(10, 2 + (wind ? 3 : bob), 2, 2, css(COLOR.primaryDeep));
        px(13, 2 + (wind ? 3 : bob), 2, 2, css(COLOR.primaryDeep));
        px(4, 8 + bob, 2, 2, css(COLOR.outline));
        px(8, 9 + bob, 2, 2, css(COLOR.outline));
        px(13, 6 + (wind ? 3 : bob), 1, 1, eye);
        px(0, 6 + bob, 3, 2, css(COLOR.primaryDeep));
        break;
      case 'sparrow':
        // 불씨 참새: 작은 참새, 날개 끝이 불씨
        px(5, 5, 7, 6, css(COLOR.inkSoft));
        px(1, 4 + bob * 2, 4, 4, css(RACE.track));
        px(12, 4 + bob * 2, 4, 4, css(RACE.track));
        px(1, 4 + bob * 2, 2, 2, css(COLOR.primary));
        px(14, 4 + bob * 2, 2, 2, css(COLOR.primary));
        px(11, 7, 2, 1, css(COLOR.primaryDeep));
        px(9, 6, 1, 1, eye);
        break;
      case 'hwacha':
        // 불화살 화차: 바퀴 달린 나무 수레 + 화살 구멍 판 (준비 칸은 판에 불이 붙음)
        px(2, 6, 20, 10, css(COLOR.inkSoft));
        px(4, 2, 16, 6, css(RACE.trackDark));
        for (let i = 0; i < 4; i++) px(6 + i * 3, 3, 2, 2, wind ? css(COLOR.primary) : css(COLOR.outline));
        px(3, 16 + bob, 6, 6, css(COLOR.outline));
        px(15, 16 + bob, 6, 6, css(COLOR.outline));
        px(5, 18 + bob, 2, 2, css(COLOR.draw));
        px(17, 18 + bob, 2, 2, css(COLOR.draw));
        px(9, 9, 2, 2, hurt ? C.white : css(COLOR.primary));
        px(13, 9, 2, 2, hurt ? C.white : css(COLOR.primary));
        break;
      case 'bulgasari':
        // 불가사리: 쇠를 먹는 곰 같은 괴물 — 코끼리 코, 쇠 비늘, 바늘 털, 눈은 불빛 (준비 칸은 앞발을 들어 올림)
        px(3, 12 + bob, 26, 16 - bob, css(COLOR.draw));
        px(5, 14 + bob, 22, 2, css(COLOR.inkSoft));
        px(5, 20 + bob, 22, 2, css(COLOR.inkSoft));
        px(16, 4 + bob, 13, 12, css(COLOR.draw));
        px(27, 10 + bob, 4, 8, css(COLOR.draw));
        px(19, 7 + bob, 3, 2, hurt ? C.white : css(COLOR.primary));
        px(24, 7 + bob, 3, 2, hurt ? C.white : css(COLOR.primary));
        for (let i = 0; i < 5; i++) px(5 + i * 5, 9 + bob, 2, 4, css(COLOR.lineSoft));
        px(4, wind ? 16 : 26, 6, wind ? 8 : 5, css(COLOR.inkSoft));
        px(20, wind ? 16 : 26, 6, wind ? 8 : 5, css(COLOR.inkSoft));
        break;
      case 'iron':
        // 쇠붙이: 바닥에 떨어진 쇳조각 무더기 (맞음 칸은 튄다)
        px(3, 9, 10, 5, css(COLOR.draw));
        px(5, 6, 3, 4, css(COLOR.lineSoft));
        px(9, 7, 3, 3, css(COLOR.inkSoft));
        px(4, 13, 8, 1, css(COLOR.outline));
        if (hurt) px(6, 3, 4, 2, C.white);
        break;
      // ---- 6구역 (천둥 마루) ----
      case 'drumimp':
        // 북 도깨비: 푸른 도깨비, 배에 작은 북, 북채 (준비 칸은 북채를 치켜듦)
        px(4, 4 + bob, 8, 10 - bob, css(COLOR.teamA));
        px(5, 1 + bob, 2, 3, css(COLOR.primary));
        px(9, 1 + bob, 2, 3, css(COLOR.primary));
        px(5, 6 + bob, 2, 2, eye);
        px(9, 6 + bob, 2, 2, eye);
        px(5, 9 + bob, 6, 4, css(COLOR.lose));
        px(5, 9 + bob, 6, 1, css(COLOR.panel));
        px(wind ? 12 : 12, wind ? 1 : 7, 2, wind ? 7 : 5, css(COLOR.inkSoft));
        break;
      case 'thunderbird':
        // 뇌조: 노란 번개 깃 새 (날개 끝이 번쩍)
        px(5, 5, 6, 6, css(COLOR.primary));
        px(1, 4 + bob * 2, 4, 4, css(COLOR.primaryDeep));
        px(11, 4 + bob * 2, 4, 4, css(COLOR.primaryDeep));
        px(1, 4 + bob * 2, 1, 2, C.white);
        px(14, 4 + bob * 2, 1, 2, C.white);
        px(11, 7, 2, 1, css(COLOR.inkSoft));
        px(9, 6, 1, 1, eye);
        break;
      case 'raincloud':
        // 비구름 요괴: 성난 먹구름, 아래로 빗줄기 (준비 칸은 번쩍)
        px(2, 4 + bob, 12, 6, wind ? css(COLOR.lineSoft) : css(COLOR.draw));
        px(4, 2 + bob, 5, 3, css(COLOR.draw));
        px(8, 3 + bob, 5, 2, css(COLOR.draw));
        px(5, 6 + bob, 2, 1, eye);
        px(9, 6 + bob, 2, 1, eye);
        for (let i = 0; i < 4; i++) px(3 + i * 3, 11 + bob, 1, 3, wind ? css(COLOR.primaryLight) : css(COLOR.skyMid));
        break;
      case 'flagspirit':
        // 번개 깃발: 바닥에 꽂힌 깃대 + 번개 무늬 깃발 (준비 칸은 깃발이 빛남)
        px(4, 2, 1, 13, css(COLOR.inkSoft));
        px(5, 2, 9, 7, wind ? css(COLOR.primaryLight) : css(COLOR.skyDeep));
        px(8, 3, 2, 2, css(COLOR.primary));
        px(9, 5, 2, 2, css(COLOR.primary));
        px(6, 4, 1, 1, eye);
        px(11, 4, 1, 1, eye);
        px(2, 14, 5, 2, css(COLOR.outline));
        break;
      case 'thunderGeneral':
        // 뇌우 장수: 먹구름 투구 장수, 등에 번개 북 고리, 쇠도리깨 (준비 칸은 도리깨를 높이)
        px(6, 8 + bob, 12, 13 - bob, css(COLOR.skyDeep));
        px(7, 2 + bob, 10, 8, css(COLOR.draw));
        px(6, 0 + bob, 12, 3, css(COLOR.inkSoft));
        px(9, 5 + bob, 2, 2, hurt ? C.white : css(COLOR.primary));
        px(13, 5 + bob, 2, 2, hurt ? C.white : css(COLOR.primary));
        px(1, 4 + bob, 4, 4, css(COLOR.lose));
        px(19, 4 + bob, 4, 4, css(COLOR.lose));
        px(wind ? 19 : 18, wind ? 0 : 10, 3, wind ? 10 : 10, css(COLOR.primaryLight));
        px(8, 20, 3, 3, css(COLOR.outline));
        px(13, 20, 3, 3, css(COLOR.outline));
        break;
      case 'noegong':
        // 뇌공: 등에 북 고리를 두른 천둥 신 — 푸른 얼굴, 붉은 수염, 양손 북채 (준비 칸은 두 팔을 번쩍)
        for (let i = 0; i < 6; i++) px(2 + i * 5, 2 + (i % 2) * 2, 4, 4, css(COLOR.lose));
        px(8, 12 + bob, 16, 16 - bob, css(COLOR.skyDeep));
        px(10, 4 + bob, 12, 10, css(COLOR.teamA));
        px(12, 8 + bob, 2, 2, hurt ? C.white : css(COLOR.primaryLight));
        px(18, 8 + bob, 2, 2, hurt ? C.white : css(COLOR.primaryLight));
        px(11, 12 + bob, 10, 4, css(COLOR.lose));
        px(10, 20, 12, 2, css(COLOR.primary));
        px(wind ? 2 : 4, wind ? 2 : 14, 3, 9, css(COLOR.inkSoft));
        px(wind ? 27 : 25, wind ? 2 : 14, 3, 9, css(COLOR.inkSoft));
        px(9, 28, 6, 3, css(COLOR.outline));
        px(17, 28, 6, 3, css(COLOR.outline));
        break;
      case 'drum':
        // 천둥 북: 받침 위 붉은 북 (맞음 칸 = 울림)
        px(2, 3, 12, 9, css(COLOR.lose));
        px(2, 3, 12, 2, css(COLOR.panel));
        px(2, 10, 12, 2, css(COLOR.panel));
        px(7, 6, 2, 2, css(COLOR.primary));
        px(3, 12, 2, 3, css(COLOR.inkSoft));
        px(11, 12, 2, 3, css(COLOR.inkSoft));
        if (hurt) px(0, 0, 16, 2, css(COLOR.primaryLight));
        break;
      // ---- 7구역 (은하 나루) ----
      case 'magpie':
        // 까치: 검은 머리 흰 배, 긴 꼬리
        px(5, 5, 6, 6, css(COLOR.outline));
        px(6, 8, 4, 3, C.white);
        px(1, 4 + bob * 2, 4, 4, css(COLOR.skyDeep));
        px(11, 4 + bob * 2, 4, 4, css(COLOR.skyDeep));
        px(2, 10, 3, 2, css(COLOR.outline));
        px(9, 6, 1, 1, C.white);
        break;
      case 'starslime':
        // 별똥 슬라임: 노란 별빛 젤리, 몸 속에 반짝이 (준비 칸은 부풀어 오름)
        px(2, 6 + bob - (wind ? 1 : 0), 12, 8 - bob + (wind ? 1 : 0), css(COLOR.primaryLight));
        px(5, 4 + bob, 6, 3, css(COLOR.primaryLight));
        px(4, 7 + bob, 2, 2, C.white);
        px(5, 9 + bob, 2, 2, eye);
        px(9, 9 + bob, 2, 2, eye);
        px(10, 6 + bob, 1, 1, C.white);
        break;
      case 'starlet':
        // 별 부스러기: 작은 별 조각
        px(6, 5 + bob, 4, 6, css(COLOR.primaryLight));
        px(4, 7 + bob, 8, 2, css(COLOR.primaryLight));
        px(7, 7 + bob, 1, 1, eye);
        px(9, 7 + bob, 1, 1, eye);
        break;
      case 'weaver':
        // 베틀 거미: 직녀의 베틀에서 내려온 보랏빛 거미 — 다리 여덟, 등에 실 꾸리 (준비 칸은 앞발을 듦)
        px(4, 5, 8, 7, css(COLOR.skyDeep));
        px(6, 3, 4, 3, css(COLOR.skyDeep));
        px(6, 6, 4, 3, css(COLOR.panel));
        for (let i = 0; i < 4; i++) {
          px(1, 5 + i * 2 - (wind && i === 0 ? 2 : 0), 3, 1, css(COLOR.outline));
          px(12, 5 + i * 2 - (wind && i === 0 ? 2 : 0), 3, 1, css(COLOR.outline));
        }
        px(6, 4, 1, 1, css(COLOR.pink));
        px(9, 4, 1, 1, css(COLOR.pink));
        break;
      case 'comet':
        // 혜성 도깨비: 꼬리가 불타는 하늘색 도깨비 (준비 칸은 웅크려 돌진 자세)
        px(0, 7 + bob, 5, 3, css(COLOR.primaryDeep));
        px(1, 6 + bob, 3, 1, css(COLOR.primary));
        px(5, 4 + (wind ? 2 : bob), 8, 9 - (wind ? 1 : 0), css(COLOR.skyTop));
        px(7, 1 + (wind ? 2 : bob), 2, 3, css(COLOR.panel));
        px(7, 6 + (wind ? 2 : bob), 2, 2, eye);
        px(10, 6 + (wind ? 2 : bob), 2, 2, eye);
        break;
      case 'crowKnight':
        // 까마귀 무사: 검은 깃 갑옷, 부리 투구, 깃털 창 (준비 칸은 날개를 펼침)
        px(6, 8 + bob, 12, 12 - bob, css(COLOR.outline));
        px(9, 2 + bob, 8, 8, css(COLOR.inkSoft));
        px(16, 5 + bob, 5, 2, css(COLOR.primary));
        px(13, 4 + bob, 2, 2, hurt ? C.white : css(COLOR.pink));
        px(wind ? 0 : 2, wind ? 5 : 9, 5, wind ? 10 : 8, css(COLOR.skyDeep));
        px(wind ? 19 : 18, wind ? 5 : 9, 5, wind ? 10 : 8, css(COLOR.skyDeep));
        px(9, 20, 2, 3, css(COLOR.primaryDeep));
        px(14, 20, 2, 3, css(COLOR.primaryDeep));
        break;
      case 'crowKing':
        // 까마귀 대왕: 세 발 달린 큰 검은 까마귀(삼족오), 금관, 별빛 날개 끝 (준비 칸은 날개를 활짝)
        px(9, 10 + bob, 14, 14 - bob, css(COLOR.outline));
        px(12, 3 + bob, 10, 9, css(COLOR.outline));
        px(21, 7 + bob, 6, 3, css(COLOR.primaryDeep));
        px(12, 1 + bob, 8, 3, css(COLOR.primary));
        px(17, 6 + bob, 2, 2, hurt ? C.white : css(COLOR.pink));
        px(wind ? 0 : 2, wind ? 4 : 10, 8, wind ? 14 : 12, css(COLOR.skyDeep));
        px(wind ? 24 : 22, wind ? 4 : 10, 8, wind ? 14 : 12, css(COLOR.skyDeep));
        px(wind ? 0 : 2, wind ? 4 : 10, 2, 2, css(COLOR.primaryLight));
        px(wind ? 30 : 28, wind ? 4 : 10, 2, 2, css(COLOR.primaryLight));
        for (let i = 0; i < 3; i++) px(11 + i * 4, 24, 2, 6, css(COLOR.primaryDeep));
        break;
      // ---- 8구역 (서천 꽃밭) ----
      case 'thornhand':
        // 가시 넝쿨손: 땅에서 솟은 넝쿨이 손 모양, 가시 (준비 칸은 손가락을 벌림)
        px(6, 8, 4, 7, css(MATGO.matDark));
        px(3, 3 - (wind ? 1 : 0), 10, 6, css(COLOR.win));
        for (let i = 0; i < 4; i++) px(3 + i * 3, wind ? 0 : 1, 2, 3, css(COLOR.win));
        px(5, 5, 2, 2, eye);
        px(9, 5, 2, 2, eye);
        px(2, 8, 2, 1, css(COLOR.pink));
        px(12, 9, 2, 1, css(COLOR.pink));
        break;
      case 'butterfly':
        // 꽃나비: 분홍·노랑 큰 날개 (날갯짓)
        px(7, 4, 2, 9, css(COLOR.outline));
        px(1, 2 + bob, 6, 6, css(COLOR.pink));
        px(9, 2 + bob, 6, 6, css(COLOR.pink));
        px(2, 8 - bob, 5, 4, css(COLOR.primaryLight));
        px(9, 8 - bob, 5, 4, css(COLOR.primaryLight));
        px(3, 4 + bob, 2, 2, C.white);
        px(11, 4 + bob, 2, 2, C.white);
        break;
      case 'beetle':
        // 풍뎅이 무사: 초록빛 등딱지, 뿔 (준비 칸은 웅크림)
        px(2, 6 + (wind ? 2 : bob), 12, 8 - (wind ? 2 : bob), css(TABLE.poker));
        px(7, 6 + (wind ? 2 : bob), 2, 8, css(COLOR.outline));
        px(11, 2 + (wind ? 2 : bob), 3, 5, css(COLOR.inkSoft));
        px(12, 4 + (wind ? 2 : bob), 1, 1, eye);
        px(3, 13, 2, 2, css(COLOR.outline));
        px(11, 13, 2, 2, css(COLOR.outline));
        break;
      case 'fairy':
        // 꽃 요정: 꽃잎 치마의 작은 요정, 투명 날개, 머리에 꽃 (준비 칸은 팔을 벌려 꽃잎)
        px(6, 3 + bob, 4, 4, C.skin);
        px(5, 1 + bob, 6, 2, css(COLOR.pink));
        px(5, 7 + bob, 6, 5, css(COLOR.pink));
        px(1, 4 + bob, 4, 5, css(COLOR.skyMid));
        px(11, 4 + bob, 4, 5, css(COLOR.skyMid));
        px(7, 5 + bob, 1, 1, eye);
        px(9, 5 + bob, 1, 1, eye);
        if (wind) px(0, 10, 16, 1, css(COLOR.primaryLight));
        break;
      case 'peacock':
        // 금공작: 금빛 몸, 눈 무늬 꼬리를 부채처럼 (준비 칸은 꼬리를 활짝)
        px(1, wind ? 0 : 4, 22, wind ? 14 : 10, css(TABLE.poker));
        for (let i = 0; i < 5; i++) px(2 + i * 4, wind ? 3 : 6, 2, 2, css(COLOR.primary));
        px(9, 10 + bob, 7, 10 - bob, css(COLOR.primary));
        px(13, 4 + bob, 4, 8, css(COLOR.primary));
        px(15, 2 + bob, 2, 2, css(COLOR.teamA));
        px(15, 6 + bob, 1, 1, hurt ? C.white : css(COLOR.outline));
        px(17, 7 + bob, 2, 1, css(COLOR.primaryDeep));
        px(10, 20, 2, 3, css(COLOR.primaryDeep));
        px(14, 20, 2, 3, css(COLOR.primaryDeep));
        break;
      case 'ggotgamgwan':
        // 꽃감관: 서천꽃밭을 지키는 관리 — 꽃 갓, 녹색 도포, 꽃가지 지팡이 (준비 칸은 지팡이를 휘두름)
        px(7, 1 + bob, 18, 3, css(COLOR.outline));
        px(10, 0 + bob, 12, 2, css(COLOR.outline));
        px(12, -1 + bob, 3, 3, css(COLOR.pink));
        px(18, -1 + bob, 3, 3, css(COLOR.primaryLight));
        px(11, 4 + bob, 10, 9, C.skin);
        px(13, 8 + bob, 2, 1, hurt ? C.white : css(COLOR.outline));
        px(18, 8 + bob, 2, 1, hurt ? C.white : css(COLOR.outline));
        px(8, 13 + bob, 16, 15 - bob, css(COLOR.win));
        px(8, 19, 16, 2, css(COLOR.pink));
        px(wind ? 24 : 25, wind ? 0 : 8, 2, wind ? 22 : 22, css(COLOR.inkSoft));
        px(wind ? 22 : 24, wind ? 0 : 6, 5, 4, css(COLOR.pink));
        px(10, 28, 5, 3, css(COLOR.outline));
        px(17, 28, 5, 3, css(COLOR.outline));
        break;
      // ---- 9구역 (칠성 폭풍단) ----
      case 'stormimp':
        // 바람 도깨비: 회색 도깨비, 등에 바람 자루 (준비 칸은 자루를 열어젖힘)
        px(4, 5 + bob, 8, 9 - bob, css(COLOR.draw));
        px(5, 2 + bob, 2, 3, css(COLOR.skyMid));
        px(9, 2 + bob, 2, 3, css(COLOR.skyMid));
        px(5, 7 + bob, 2, 2, eye);
        px(9, 7 + bob, 2, 2, eye);
        px(wind ? 11 : 0, 6 + bob, 4, 5, css(COLOR.panel));
        if (wind) px(14, 5, 2, 7, C.white);
        break;
      case 'hailjar':
        // 우박 항아리: 금 간 검은 독, 아가리에서 우박 (준비 칸은 우박이 튀어나옴)
        px(4, 6, 8, 9, css(COLOR.outline));
        px(5, 4, 6, 2, css(COLOR.outline));
        px(5, 9, 6, 1, css(COLOR.skyMid));
        px(6, 11, 1, 1, C.white);
        px(9, 11, 1, 1, C.white);
        px(5, wind ? 0 : 2, 2, 2, C.white);
        px(9, wind ? 1 : 3, 2, 2, C.white);
        break;
      case 'starshard':
        // 별조각: 칠성에서 떨어진 노란 별 (준비 칸은 하얗게 커짐)
        px(6, 2 - bob, 4, 12, wind ? C.white : css(COLOR.primaryLight));
        px(2, 6 - bob, 12, 4, wind ? C.white : css(COLOR.primaryLight));
        px(4, 4 - bob, 8, 8, css(COLOR.primary));
        px(6, 7 - bob, 1, 2, eye);
        px(9, 7 - bob, 1, 2, eye);
        break;
      case 'hawk':
        // 폭풍 매: 잿빛 매, 날카로운 노란 부리
        px(5, 5 + bob, 7, 6, css(COLOR.draw));
        px(1, 3 + bob, 5, 5, css(COLOR.inkSoft));
        px(11, 3 + bob, 5, 5, css(COLOR.inkSoft));
        px(12, 7 + bob, 3, 2, css(COLOR.primary));
        px(10, 6 + bob, 1, 1, eye);
        if (wind) px(13, 6, 3, 2, css(COLOR.pink));
        break;
      case 'jangseung':
        // 천하대장군 장승: 나무 기둥 몸, 부릅뜬 눈, 붉은 볼, 검은 관 (준비 칸은 몸을 기울임)
        px(6, 3, 12, 20, css(COLOR.primaryDeep));
        px(6, 0, 12, 4, css(COLOR.outline));
        px(8, 6, 3, 3, C.white);
        px(13, 6, 3, 3, C.white);
        px(9, 7, 1, 1, hurt ? css(COLOR.pink) : css(COLOR.outline));
        px(14, 7, 1, 1, hurt ? css(COLOR.pink) : css(COLOR.outline));
        px(7, 10, 3, 2, css(COLOR.lose));
        px(14, 10, 3, 2, css(COLOR.lose));
        px(9, 13, 6, 2, wind ? css(COLOR.pink) : css(COLOR.outline));
        px(7, 16, 10, 1, css(COLOR.outline));
        px(7, 19, 10, 1, css(COLOR.outline));
        break;
      case 'heukryong':
        // 흑룡: 검은 비늘 용, 금빛 뿔·수염, 번개 눈 (준비 칸은 입을 크게 벌림)
        px(2, 16 + bob, 26, 10 - bob, css(COLOR.outline));
        px(6, 12 + bob, 18, 6, css(COLOR.skyDeep));
        px(17, 3 + bob, 13, 12, css(COLOR.outline));
        px(18, 1 + bob, 2, 4, css(COLOR.primary));
        px(26, 1 + bob, 2, 4, css(COLOR.primary));
        px(21, 6 + bob, 3, 2, hurt ? C.white : css(COLOR.primaryLight));
        px(26, 6 + bob, 3, 2, hurt ? C.white : css(COLOR.primaryLight));
        px(22, 11 + bob, 8, wind ? 4 : 2, wind ? css(COLOR.primaryLight) : css(COLOR.lose));
        px(16, 13 + bob, 2, 6, css(COLOR.primary));
        px(4, 26, 4, 4, css(COLOR.outline));
        px(18, 26, 4, 4, css(COLOR.outline));
        for (let i = 0; i < 5; i++) px(4 + i * 5, 17 + bob, 2, 2, css(COLOR.skyTop));
        break;
      // ---- 10구역 (소원의 정상) ----
      case 'skysoldier':
        // 하늘 병사: 흰 갑옷, 붉은 술 투구, 창 (준비 칸은 창을 겨눔)
        px(4, 6 + bob, 8, 8 - bob, C.white);
        px(5, 2 + bob, 6, 5, css(COLOR.panel));
        px(7, 0 + bob, 2, 2, css(COLOR.lose));
        px(6, 4 + bob, 1, 1, eye);
        px(9, 4 + bob, 1, 1, eye);
        px(5, 10 + bob, 6, 1, css(COLOR.primary));
        px(wind ? 10 : 12, wind ? 6 : 1, wind ? 6 : 1, wind ? 1 : 13, css(COLOR.inkSoft));
        break;
      case 'crane':
        // 흰 학: 흰 몸, 검은 날개 끝, 붉은 정수리
        px(5, 6 + bob, 6, 5, C.white);
        px(1, 4 + bob, 5, 4, C.white);
        px(10, 4 + bob, 5, 4, C.white);
        px(1, 4 + bob, 2, 2, css(COLOR.outline));
        px(13, 4 + bob, 2, 2, css(COLOR.outline));
        px(10, 2 + bob, 3, 3, C.white);
        px(11, 1 + bob, 2, 1, css(COLOR.lose));
        px(13, 3 + bob, 3, 1, css(COLOR.primaryDeep));
        px(11, 3 + bob, 1, 1, eye);
        break;
      case 'lantern':
        // 소원 등롱: 떠 있는 붉은 등, 소원 쪽지 (준비 칸은 등이 하얗게 빛남)
        px(7, 0, 2, 2, css(COLOR.inkSoft));
        px(3, 2, 10, 10, wind ? css(COLOR.primaryLight) : css(COLOR.lose));
        px(3, 2, 10, 1, css(COLOR.primaryDeep));
        px(3, 11, 10, 1, css(COLOR.primaryDeep));
        px(6, 6, 1, 1, eye);
        px(9, 6, 1, 1, eye);
        px(7, 12, 2, 3, css(COLOR.panel));
        break;
      case 'jadelion':
        // 옥 사자: 옥빛 해치 같은 사자, 곱슬 갈기 (준비 칸은 웅크림)
        px(2, 6 + (wind ? 2 : bob), 12, 8 - (wind ? 2 : bob), css(TABLE.poker));
        px(9, 2 + (wind ? 2 : bob), 6, 6, css(COLOR.win));
        px(12, 4 + (wind ? 2 : bob), 1, 1, eye);
        px(13, 6 + (wind ? 2 : bob), 2, 1, css(COLOR.pink));
        px(3, 13, 2, 2, css(COLOR.outline));
        px(10, 13, 2, 2, css(COLOR.outline));
        break;
      case 'skygeneral':
        // 천상 장군: 금빛 갑옷, 흰 깃 투구, 번개 칼 (준비 칸은 칼을 치켜듦)
        px(6, 8 + bob, 12, 13 - bob, css(COLOR.primary));
        px(8, 2 + bob, 8, 8, C.skin);
        px(7, 0 + bob, 10, 3, C.white);
        px(10, 5 + bob, 1, 1, hurt ? C.white : css(COLOR.outline));
        px(14, 5 + bob, 1, 1, hurt ? C.white : css(COLOR.outline));
        px(6, 13, 12, 2, css(COLOR.lose));
        px(wind ? 18 : 19, wind ? 0 : 8, 2, wind ? 12 : 12, css(COLOR.skyMid));
        px(8, 20, 3, 3, css(COLOR.outline));
        px(13, 20, 3, 3, css(COLOR.outline));
        break;
      case 'eodugsini':
        // 어둑시니: 올려다볼수록 커지는 그림자 요괴 — 먹빛 몸이 아래로 퍼지고, 하얀 눈 셋, 소원 구슬을 탐하는 손 (준비 칸은 손을 뻗음)
        px(6, 10 + bob, 36, 34 - bob, css(COLOR.outline));
        px(10, 4 + bob, 28, 12, css(COLOR.outline));
        px(2, 30, 44, 14, css(COLOR.inkSoft));
        px(0, 40, 48, 6, css(COLOR.outline));
        px(15, 10 + bob, 4, 3, hurt ? css(COLOR.pink) : C.white);
        px(29, 10 + bob, 4, 3, hurt ? css(COLOR.pink) : C.white);
        px(22, 6 + bob, 4, 3, hurt ? css(COLOR.pink) : css(COLOR.primaryLight));
        px(17, 20 + bob, 14, 3, css(COLOR.lose));
        px(wind ? 0 : 2, wind ? 12 : 22, 6, 12, css(COLOR.outline));
        px(wind ? 42 : 40, wind ? 12 : 22, 6, 12, css(COLOR.outline));
        px(wind ? 0 : 2, wind ? 10 : 20, 3, 3, css(COLOR.inkSoft));
        px(wind ? 45 : 43, wind ? 10 : 20, 3, 3, css(COLOR.inkSoft));
        break;
      case 'wishlight':
        // 소원 등불: 받침 위 연꽃 등 (맞음 칸 = 환하게 켜짐)
        px(3, 9, 10, 4, css(COLOR.pink));
        px(5, 7, 6, 3, css(COLOR.pink));
        px(6, hurt ? 1 : 3, 4, hurt ? 6 : 4, hurt ? C.white : css(COLOR.primaryLight));
        px(4, 13, 8, 2, css(COLOR.inkSoft));
        break;
      default:
        px(3, 3, S - 6, S - 6, css(COLOR.pink));
    }
    addOutline(o, S);
    g.drawImage(one, f * S, 0);
  }
  return cv;
}
