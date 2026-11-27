/**
 * 고양이 그림: 자세 → 그림 표 하나로 고른다. 그림은 흰 고양이 하나(art/spritecook/poses → art/build.py → public/art/cat)이고,
 * 털 색은 처음 불러올 때 canvas 로 털 픽셀만 바꿔(game/recolor.ts) 색 × 자세별로 캐시한다.
 * 무늬(줄무늬 등)는 나중에 patternLayer 에서 털 색 위에 겹쳐 그린다 (지금은 아무것도 하지 않는다).
 */
import { COLOR, type ColorId } from '../data/balance';
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
} as const satisfies Record<string, ArtName>;
export type Pose = keyof typeof POSE_IMAGE;

/** 그림 주소 (배포는 상대 경로라 문서 주소 기준으로 만든다) */
export const artUrl = (rel: string) => new URL(rel, document.baseURI).href;

const cache = new Map<string, Promise<string>>();

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
export function catArt(color: ColorId, art: ArtName, pattern: string | null = null): Promise<string> {
  const key = `${color}:${pattern ?? ''}:${art}`;
  let p = cache.get(key);
  if (p) return p;
  const src = artUrl(`art/cat/${art}.png`);
  p = (async () => {
    if (color === 'white' && !pattern) return src;
    const im = await loadImage(src);
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth;
    cv.height = im.naturalHeight;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return src;
    ctx.drawImage(im, 0, 0);
    try {
      const data = ctx.getImageData(0, 0, cv.width, cv.height);
      recolorFur(data.data, cv.width, cv.height, (COLOR[color] ?? COLOR.white).rgb);
      ctx.putImageData(data, 0, 0);
      patternLayer(ctx, pattern, art);
    } catch {
      return src;
    }
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
    return blob ? URL.createObjectURL(blob) : cv.toDataURL('image/png');
  })();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  return p;
}

/** 한 색의 모든 자세를 미리 만들어 둔다 (자세를 바꿀 때 깜빡이지 않게) */
export async function preloadColor(color: ColorId, pattern: string | null = null): Promise<void> {
  await Promise.all((Object.keys(POSE_ART) as ArtName[]).map((a) => catArt(color, a, pattern).catch(() => '')));
}
