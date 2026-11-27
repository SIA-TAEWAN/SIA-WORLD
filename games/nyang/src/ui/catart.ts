/**
 * 고양이 그림: 자세 → 그림 표 하나로 고른다. 그림은 흰 고양이 하나(art/spritecook/poses → art/build.py → public/art/cat)이고,
 * 털 색은 처음 불러올 때 canvas 로 털 픽셀만 바꿔(game/recolor.ts) 색 × 자세별로 캐시한다.
 * 무늬(줄무늬 등)는 나중에 patternLayer 에서 털 색 위에 겹쳐 그린다 (지금은 아무것도 하지 않는다).
 */
import { COLOR, type ColorId, type PoseId } from '../data/balance';
import { POSE_ART } from '../data/poses.gen';
import { recolorFur } from '../game/recolor';

export type ArtName = keyof typeof POSE_ART;

/** 게임 속 자세 → 그림 (그림을 새로 받으면 이 표만 고친다) */
export const POSE_IMAGE = {
  sit: 'sit',
  blink: 'sit-blink',
  walk1: 'walk-1',
  walk2: 'walk-2',
  loaf: 'loaf',
  sleep: 'sleep',
  eat: 'eat',
  drink: 'eat',
  stretch: 'stretch',
  pounce: 'pounce',
  jump: 'jump',
  beg: 'beg',
  knead: 'knead',
  belly: 'belly',
  // 츄르 핥기 8칸 (SpriteCook 애니메이션): 0 · 4 입 다묾, 1 · 3 · 5 · 7 벌림, 2 · 6 혀
  lick0: 'lick-0',
  lick1: 'lick-1',
  lick2: 'lick-2',
  lick3: 'lick-3',
  lick4: 'lick-4',
  lick5: 'lick-5',
  lick6: 'lick-6',
  lick7: 'lick-7',
} as const satisfies Record<PoseId, ArtName>;
export const LICK_POSES = ['lick0', 'lick1', 'lick2', 'lick3', 'lick4', 'lick5', 'lick6', 'lick7'] as const;
export type Pose = keyof typeof POSE_IMAGE;

/** 그림 주소 (배포는 상대 경로라 문서 주소 기준으로 만든다) */
export const artUrl = (rel: string) => new URL(rel, document.baseURI).href;

const cache = new Map<string, Promise<string>>();
/**
 * 그림 해상도 배율 (5단계 성능): 방에서는 고양이를 원본(약 400px)의 30% 안팎으로 그린다. 원본 그대로면 고양이 4마리가
 * 매 장면 큰 그림을 줄여 그리느라 느린 기기에서 버벅여서, 화면 크기 × 기기 픽셀 배율 × 1.2 만큼만 만든 그림을 쓴다 (1 = 원본).
 */
let artScale = 1;
export function setArtScale(k: number) {
  const old = artScale;
  artScale = Math.max(0.2, Math.min(1, Math.ceil(k * 10) / 10));
  if (old === artScale || old >= 1) return;
  // 옛 배율로 만든 그림은 버린다 (화면에 남은 그림이 새 그림으로 바뀔 때까지 조금 기다렸다가 objectURL 을 놓아준다)
  for (const [key, p] of [...cache]) {
    if (!key.endsWith(`:${old}`)) continue;
    cache.delete(key);
    setTimeout(() => void p.then((u) => u.startsWith('blob:') && URL.revokeObjectURL(u), () => undefined), 5000);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => ok(im);
    im.onerror = () => bad(new Error(`art ${src}`));
    im.src = src;
  });
}

/** 무늬 층 자리 (나중 단계: 털 색을 바꾼 뒤 그 위에 줄무늬 등을 그린다). 지금은 그리지 않는다 */
function patternLayer(_ctx: CanvasRenderingContext2D, _pattern: string | null, _art: ArtName): void {
  void _ctx;
  void _pattern;
  void _art;
}

/** 털 색을 입힌 그림의 주소 (같은 색 · 자세는 한 번만 만든다). 흰색에 무늬가 없으면 원본 그대로 */
export function catArt(color: ColorId, art: ArtName, pattern: string | null = null, scale = 1): Promise<string> {
  const k = Math.min(1, scale);
  const key = `${color}:${pattern ?? ''}:${art}:${k}`;
  let p = cache.get(key);
  if (p) return p;
  const src = artUrl(`art/cat/${art}.png`);
  p = (async () => {
    if (color === 'white' && !pattern && k >= 1) return src;
    const im = await loadImage(src);
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth;
    cv.height = im.naturalHeight;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return src;
    ctx.drawImage(im, 0, 0);
    if (color !== 'white' || pattern) {
      try {
        const data = ctx.getImageData(0, 0, cv.width, cv.height);
        recolorFur(data.data, cv.width, cv.height, (COLOR[color] ?? COLOR.white).rgb);
        ctx.putImageData(data, 0, 0);
        patternLayer(ctx, pattern, art);
      } catch {
        return src;
      }
    }
    if (k < 1) {
      // 털 색을 바꾼 뒤에 줄인다 (경계 판정은 원본 크기에서)
      const sm = document.createElement('canvas');
      sm.width = Math.max(1, Math.round(cv.width * k));
      sm.height = Math.max(1, Math.round(cv.height * k));
      const c2 = sm.getContext('2d');
      if (c2) {
        c2.imageSmoothingQuality = 'high';
        c2.drawImage(cv, 0, 0, sm.width, sm.height);
        const blob = await new Promise<Blob | null>((r) => sm.toBlob(r, 'image/png'));
        return blob ? URL.createObjectURL(blob) : sm.toDataURL('image/png');
      }
    }
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
    return blob ? URL.createObjectURL(blob) : cv.toDataURL('image/png');
  })();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  return p;
}

/** 한 색의 모든 자세를 미리 만들어 둔다 (자세를 바꿀 때 깜빡이지 않게) */
export async function preloadColor(color: ColorId, pattern: string | null = null, scale = 1): Promise<void> {
  await Promise.all((Object.keys(POSE_ART) as ArtName[]).map((a) => catArt(color, a, pattern, scale).catch(() => '')));
}
/** 방에서 쓰는 배율 (setArtScale) */
export const roomArtScale = () => artScale;
