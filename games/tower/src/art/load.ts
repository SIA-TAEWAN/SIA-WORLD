/**
 * 그림 불러오기: public/art/manifest.json 에 적힌 파일은 그 파일, 없거나 못 읽으면 코드로 그린 플레이스홀더 (sheets.ts, 같은 규격).
 * 그림 주소 뒤에는 빌드 판본(?v=)을 붙인다 — 배포 직후 서비스 워커가 같은 주소의 옛 그림(예: 256×128 옛 캐릭터 시트)을 주지 않게.
 */
import { COLS, FRAME_H, FRAME_W, ROWS, SHEET_H, SHEET_W, TS, enemySize, placeholderEnemy, placeholderLayer, placeholderTiles } from './sheets';

const base = () => `${import.meta.env.BASE_URL}art/`;
/** 빌드 판본 (vite.config.ts 의 define: 배포에서는 커밋 해시, 그 밖에는 빌드 시각) */
declare const __TOWER_BUILD__: string | undefined;
const ver = typeof __TOWER_BUILD__ === 'string' && __TOWER_BUILD__ ? __TOWER_BUILD__ : 'dev';
/** 그림 파일 주소 (판본을 붙인다) */
const artUrl = (path: string) => `${base()}${path}?v=${encodeURIComponent(ver)}`;
let manifest: Promise<Set<string>> | null = null;
function files(): Promise<Set<string>> {
  manifest ??= fetch(`${base()}manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { files: [] }))
    .then((j: { files?: unknown }) => new Set(Array.isArray(j.files) ? j.files.map(String) : []))
    .catch(() => new Set<string>());
  return manifest;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

/** 파일 → 정해진 크기의 캔버스. 그림 크기가 기대(w×h)와 다르면 null → 코드 그림 (옛 규격 시트가 캐시에서 온 경우) */
async function fromFile(path: string, w: number, h: number): Promise<HTMLCanvasElement | null> {
  if (!(await files()).has(path)) return null;
  const img = await loadImage(artUrl(path));
  if (!img || img.naturalWidth !== w || img.naturalHeight !== h) return null;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  return cv;
}

const cache = new Map<string, Promise<HTMLCanvasElement>>();
const once = (key: string, make: () => Promise<HTMLCanvasElement>) => {
  let p = cache.get(key);
  if (!p) cache.set(key, (p = make()));
  return p;
};

/** 캐릭터 레이어 시트 파일 (SHEET_W×SHEET_H = 512×320). 없거나 못 읽거나 크기가 다르면 null */
const layerFiles = new Map<string, Promise<HTMLCanvasElement | null>>();
const layerFile = (name: string) => {
  let p = layerFiles.get(name);
  if (!p) layerFiles.set(name, (p = fromFile(`char/${name}.png`, SHEET_W, SHEET_H)));
  return p;
};
/**
 * 한 캐릭터의 레이어 시트들 (몸 · 얼굴 · 옷 · 머리, sheets.ts 의 layerNames 순서).
 * 하나라도 파일을 못 쓰면 모두 코드 그림으로 — 파일 그림과 코드 그림은 모양이 달라 섞으면 어긋난다.
 */
export async function layerSheets(names: string[]): Promise<HTMLCanvasElement[]> {
  const got = await Promise.all(names.map(layerFile));
  const files = got.every((cv): cv is HTMLCanvasElement => !!cv);
  const raw = files ? got : await Promise.all(names.map((name) => once(`char-code/${name}`, async () => placeholderLayer(name))));
  const fi = names.findIndex((n) => n.startsWith('face_'));
  if (fi < 0) return raw;
  // 2등신 결과는 (레이어, 얼굴) 쌍마다 한 번만 만든다 — 결과는 그 레이어와 얼굴의 턱 높이에만 달려 있다.
  // 외형 조합마다 만들면 캐릭터 만들기에서 옵션을 누를 때마다 캔버스가 쌓인다 (아이폰 캔버스 메모리). 쌍은 많아야 18 × 4 = 72장.
  const kind = files ? 'f' : 'c';
  const chins = chinCache.get(`${kind}:${names[fi]}`) ?? chinsOf(raw[fi]);
  chinCache.set(`${kind}:${names[fi]}`, chins);
  return raw.map((cv, i) => {
    const key = `${kind}:${names[i]}|${names[fi]}`;
    let out = chibiCache.get(key);
    if (!out) chibiCache.set(key, (out = chibifyOne(cv, chins)));
    return out;
  });
}
const chibiCache = new Map<string, HTMLCanvasElement>();
const chinCache = new Map<string, number[]>();

/**
 * 2등신으로 보이게: 칸마다 턱(얼굴 레이어의 아래 끝)에서 머리와 몸을 나눠 머리는 키우고 몸은 줄여 다시 붙인다.
 * 모든 레이어가 같은 칸에서 같은 턱 높이로 나뉘어 겹치면 한 사람이 된다. 발은 칸 아래 그대로 (판정 · 그림자 자리는 같다).
 * 위를 보는 줄(3)은 얼굴이 비어 있어 아래를 보는 줄(0)의 같은 칸 턱을 쓴다. 원본 캔버스(여러 모습이 같이 쓴다)는 건드리지 않는다.
 */
export const CHIBI = { headX: 1.22, headY: 1.36, body: 0.72 };
/** 칸마다 턱 높이 (얼굴 레이어의 아래 끝) */
function chinsOf(face: HTMLCanvasElement): number[] {
  const fg = face.getContext('2d', { willReadFrequently: true })!;
  const chinAt = (col: number, row: number) => {
    const d = fg.getImageData(col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H).data;
    for (let y = FRAME_H - 1; y >= 0; y--) for (let x = 0; x < FRAME_W; x++) if (d[(y * FRAME_W + x) * 4 + 3] > 0) return y + 1;
    return 0;
  };
  const chins: number[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) chins.push(chinAt(c, r) || chinAt(c, 0) || Math.round(FRAME_H * 0.42));
  return chins;
}
export function chibify(layers: HTMLCanvasElement[], faceIdx: number): HTMLCanvasElement[] {
  const face = layers[faceIdx];
  if (!face) return layers;
  const chins = chinsOf(face);
  return layers.map((src) => chibifyOne(src, chins));
}
function chibifyOne(src: HTMLCanvasElement, chins: number[]): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const neck = chins[r * COLS + c];
      const x0 = c * FRAME_W;
      const y0 = r * FRAME_H;
      const bodyH = Math.round((FRAME_H - neck) * CHIBI.body);
      const headW = Math.round(FRAME_W * CHIBI.headX);
      const headH = Math.round(neck * CHIBI.headY);
      const by = y0 + FRAME_H - bodyH;
      g.save();
      g.beginPath();
      g.rect(x0, y0, FRAME_W, FRAME_H);
      g.clip();
      // 몸: 칸 너비 그대로, 높이만 줄여 발을 칸 아래에
      g.drawImage(src, x0, y0 + neck, FRAME_W, FRAME_H - neck, x0, by, FRAME_W, bodyH);
      // 머리: 칸 가운데를 축으로 키워 턱이 몸 위에 닿게 (조금 겹쳐 목 틈이 안 보이게)
      g.drawImage(src, x0, y0, FRAME_W, neck, x0 + (FRAME_W - headW) / 2, by - headH + 2, headW, headH);
      g.restore();
    }
  }
  return cv;
}
/** 타일 시트 파일 이름: 1구역(stone)은 tiles.png, 다른 테마는 tiles-<테마>.png (floors.json 의 theme) */
export const tileFile = (theme: string) => (theme === 'stone' ? 'tiles.png' : `tiles-${theme}.png`);
/**
 * 타일 시트 (16 × TILE_ORDER.length). 코드 그림 위에 파일을 덮는다:
 * 파일이 TILE_ORDER 보다 좁으면(새 칸이 붙기 전에 그린 시트) 모자란 칸은 코드 그림 그대로.
 */
export const tileSheet = (theme = 'stone') =>
  once(`tiles:${theme}`, async () => {
    const cv = placeholderTiles(theme);
    const path = tileFile(theme);
    if (!(await files()).has(path)) return cv;
    const img = await loadImage(artUrl(path));
    if (!img) return cv;
    const g = cv.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const w = Math.min(cv.width, Math.floor(img.width / TS) * TS);
    g.clearRect(0, 0, w, TS);
    g.drawImage(img, 0, 0, w, TS, 0, 0, w, TS);
    return cv;
  });
/** 투사체 그림 (파일이 없으면 null → 코드 그림 그대로) */
export const projImage = (name: string, w: number, h: number) => fromFile(`proj/${name}.png`, w, h);
/** 엔딩 배경 주소 (파일이 없으면 null → CSS 별 하늘) */
export async function endingBgUrl(): Promise<string | null> {
  return (await files()).has('ending-bg.png') ? artUrl('ending-bg.png') : null;
}
/** 적 시트 (size × 4칸) */
export const enemySheet = (id: string) => once(`enemy/${id}`, async () => (await fromFile(`enemy/${id}.png`, enemySize(id) * 4, enemySize(id))) ?? placeholderEnemy(id));
/** 구슬 아이콘 (파일이 있으면 그 주소, 없으면 null → 글자 그림) */
export async function orbIconUrl(id: string): Promise<string | null> {
  return (await files()).has(`orb/${id}.png`) ? artUrl(`orb/${id}.png`) : null;
}
/** 메뉴처럼 그림 주소를 바로 써야 하는 곳: 미리 읽어 둔 구슬 아이콘 목록 */
export const orbIcons = new Map<string, string>();
export async function preloadOrbIcons(ids: string[]) {
  for (const id of ids) {
    const u = await orbIconUrl(id);
    if (u) orbIcons.set(id, u);
  }
}
