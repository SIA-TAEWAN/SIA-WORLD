/**
 * 그림 불러오기: public/art/manifest.json 에 적힌 파일은 그 파일, 없거나 못 읽으면 코드로 그린 플레이스홀더 (sheets.ts, 같은 규격).
 */
import { SHEET_H, SHEET_W, TS, enemySize, placeholderEnemy, placeholderLayer, placeholderTiles } from './sheets';

const base = () => `${import.meta.env.BASE_URL}art/`;
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

/** 파일 → 정해진 크기의 캔버스 (크기가 다르면 왼쪽 위에 맞춰 그린다) */
async function fromFile(path: string, w: number, h: number): Promise<HTMLCanvasElement | null> {
  if (!(await files()).has(path)) return null;
  const img = await loadImage(base() + path);
  if (!img) return null;
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

/** 캐릭터 레이어 시트 (256×128) */
export const layerSheet = (name: string) => once(`char/${name}`, async () => (await fromFile(`char/${name}.png`, SHEET_W, SHEET_H)) ?? placeholderLayer(name));
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
    const img = await loadImage(base() + path);
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
  return (await files()).has('ending-bg.png') ? `${base()}ending-bg.png` : null;
}
/** 적 시트 (size × 4칸) */
export const enemySheet = (id: string) => once(`enemy/${id}`, async () => (await fromFile(`enemy/${id}.png`, enemySize(id) * 4, enemySize(id))) ?? placeholderEnemy(id));
/** 구슬 아이콘 (파일이 있으면 그 주소, 없으면 null → 글자 그림) */
export async function orbIconUrl(id: string): Promise<string | null> {
  return (await files()).has(`orb/${id}.png`) ? `${base()}orb/${id}.png` : null;
}
/** 메뉴처럼 그림 주소를 바로 써야 하는 곳: 미리 읽어 둔 구슬 아이콘 목록 */
export const orbIcons = new Map<string, string>();
export async function preloadOrbIcons(ids: string[]) {
  for (const id of ids) {
    const u = await orbIconUrl(id);
    if (u) orbIcons.set(id, u);
  }
}
