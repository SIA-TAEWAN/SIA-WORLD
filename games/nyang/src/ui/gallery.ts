/** 개발용 (?local=1&gallery=1): 털 색 × 자세 그림을 한 화면에 — 털 색 바꾸기 확인 */
import { COLORS } from '../data/balance';
import { POSE_ART } from '../data/poses.gen';
import { catArt, type ArtName } from './catart';

export function showGallery(root: HTMLElement) {
  const arts = Object.keys(POSE_ART) as ArtName[];
  const only = new URLSearchParams(location.search).get('pose');
  const list = only ? arts.filter((a) => a === only) : arts;
  root.innerHTML = `<div class="gallery">${COLORS.map(
    (c) => `<h3>${c.name}</h3><div class="grow">${list.map((a) => `<figure><img data-c="${c.id}" data-a="${a}" alt="${a}"/><figcaption>${a}</figcaption></figure>`).join('')}</div>`,
  ).join('')}</div>`;
  root.querySelectorAll<HTMLImageElement>('img').forEach((im) => {
    void catArt(im.dataset.c as (typeof COLORS)[number]['id'], im.dataset.a as ArtName).then((u) => (im.src = u));
  });
}
