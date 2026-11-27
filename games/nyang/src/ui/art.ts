/**
 * 방 · 베란다 · 물건 그림 (SpriteCook → art/build.py → public/art/world/<이름>.webp).
 * 그림을 못 불러오면 코드로 그린 SVG(props.ts)로 바꾼다 — 그래서 그림마다 대신 쓸 SVG 를 함께 넘긴다.
 * 주소는 문서 주소 기준의 전체 주소로 만든다 (배포는 base './' 라 CSS 변수에 상대 url 을 넣으면 404 — CLAUDE.md).
 */
import { WORLD_ART, type WorldArt } from '../data/world.gen';
import { artUrl } from './catart';

export const worldUrl = (name: WorldArt) => artUrl(`art/world/${name}.webp`);
/** 그림 세로/가로 */
export const ratioOf = (name: WorldArt) => WORLD_ART[name][1] / WORLD_ART[name][0];

const fallbacks = new Map<string, string>();
let seq = 0;
let bound = false;

/** <img> (실패하면 fallback HTML 로 바뀐다) */
export function artImg(name: WorldArt, fallback: string, cls = 'art'): string {
  if (!bound) {
    bound = true;
    document.addEventListener(
      'error',
      (e) => {
        const im = e.target as HTMLElement | null;
        if (!(im instanceof HTMLImageElement) || !im.dataset.fb) return;
        const fb = fallbacks.get(im.dataset.fb);
        if (fb != null) im.outerHTML = fb;
      },
      true,
    );
  }
  const id = String(++seq);
  fallbacks.set(id, fallback);
  // 오래 쓰지 않을 대체 글이 쌓이지 않게 (화면은 몇 백 개면 충분하다)
  if (fallbacks.size > 600) fallbacks.delete(fallbacks.keys().next().value!);
  return `<img class="${cls}" src="${worldUrl(name)}" data-fb="${id}" alt="" draggable="false">`;
}

/** 배경 그림 층: 못 불러오면 투명이라 아래의 코드 배경이 보인다 */
export function bgLayer(el: HTMLElement, name: WorldArt) {
  el.style.backgroundImage = `url("${worldUrl(name)}")`;
}

/** 그림 미리 받기 (베란다 · 상점을 처음 열 때 깜빡이지 않게) */
export function preloadWorld(names: WorldArt[]) {
  for (const n of names) {
    const im = new Image();
    im.src = worldUrl(n);
  }
}
