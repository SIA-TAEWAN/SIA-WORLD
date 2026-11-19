import type { ResId } from '../data/balance';

/**
 * 자원 아이콘. 코드로 그린 SVG (DESIGN.md: 굵은 갈색 외곽선 + 밝은 단색, 색은 shared/theme.css 의 변수).
 * 정식 그림 목록은 ASSETS.md (9단계에서 교체).
 */
const O = 'stroke="var(--outline)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

const ART: Record<ResId | 'sia' | 'exp' | 'time', string> = {
  rice: `<ellipse cx="15" cy="30" rx="7" ry="11" transform="rotate(-25 15 30)" fill="var(--white)" ${O}/><ellipse cx="33" cy="30" rx="7" ry="11" transform="rotate(25 33 30)" fill="var(--white)" ${O}/><ellipse cx="24" cy="18" rx="7" ry="11" fill="var(--white)" ${O}/>`,
  wood: `<rect x="5" y="14" width="38" height="20" rx="10" fill="var(--ink-soft)" ${O}/><circle cx="34" cy="24" r="7" fill="var(--panel)" ${O}/><circle cx="34" cy="24" r="1.5" fill="var(--outline)"/>`,
  stone: `<path d="M8 36 l4 -18 l12 -8 l14 8 l4 16 l-10 6 h-16z" fill="var(--roulette-winter)" ${O}/><path d="M24 10 l-2 14 l-10 -6 M22 24 l12 6" fill="none" ${O}/>`,
  cake: `<rect x="8" y="12" width="32" height="26" rx="11" fill="var(--white)" ${O}/><circle cx="24" cy="25" r="5" fill="var(--pink)" ${O}/>`,
  coin: `<circle cx="24" cy="24" r="17" fill="var(--primary)" ${O}/><rect x="18" y="18" width="12" height="12" fill="var(--primary-deep)" ${O}/>`,
  sia: `<circle cx="24" cy="24" r="18" fill="var(--team-a)" ${O}/><circle cx="24" cy="24" r="11" fill="var(--sky-mid)" ${O}/><path d="M28 19 q-8 -4 -8 2 q0 3 4 3 q4 0 4 3 q0 6 -8 2" fill="none" ${O}/>`,
  exp: `<polygon points="24,5 29.5,17.5 43,19 33,28 36,41.5 24,34.5 12,41.5 15,28 5,19 18.5,17.5" fill="var(--primary)" ${O}/>`,
  time: `<circle cx="24" cy="24" r="17" fill="var(--white)" ${O}/><path d="M24 13 v11 l8 5" fill="none" ${O}/>`,
};

export type IconId = keyof typeof ART;
export const icon = (id: IconId) => `<svg class="ico" viewBox="0 0 48 48" aria-hidden="true">${ART[id]}</svg>`;
