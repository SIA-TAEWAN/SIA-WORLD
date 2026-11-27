/**
 * 방 안 물건 그림 (임시 — 코드로 그린 SVG. 디자인 단계(6단계)에서 SpriteCook 그림으로 바꾼다).
 * DESIGN.md: 굵은 갈색 외곽선 + 밝은 단색. 색은 shared/theme.css 의 값만 쓴다.
 */
const O = 'var(--outline)';

/** 밥그릇: level 0 ~ 1 (사료 양) */
export function foodBowl(level: number): string {
  const n = level <= 0 ? 0 : level < 0.34 ? 1 : level < 0.67 ? 2 : 3;
  const mound = ['', 'M30 30 Q50 22 70 30 Z', 'M24 30 Q50 12 76 30 Z', 'M20 30 Q50 2 80 30 Z'][n];
  const dots = n
    ? [...Array(4 + n * 4)].map((_, i) => `<circle cx="${28 + ((i * 37) % 46)}" cy="${30 - ((i * 13) % (n * 7 + 2))}" r="3.2" fill="var(--nyang-floor-dark)" stroke="${O}" stroke-width="1.2"/>`).join('')
    : '';
  return `<svg viewBox="0 0 100 58" aria-hidden="true">
    <ellipse cx="50" cy="52" rx="44" ry="6" fill="rgba(42,26,16,.18)"/>
    ${n ? `<path d="${mound}" fill="var(--accent)" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>${dots}` : ''}
    <path d="M8 28 H92 L82 52 H18 Z" fill="var(--pink)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M18 36 H82" stroke="var(--white)" stroke-width="4" stroke-linecap="round" opacity=".7"/>
    <ellipse cx="50" cy="28" rx="42" ry="7" fill="${n ? 'none' : 'var(--panel)'}" stroke="${O}" stroke-width="4"/>
  </svg>`;
}

/** 물그릇: level 0 ~ 1, spoiled = 상한 물 (초록빛 + 파리) */
export function waterBowl(level: number, spoiled: boolean): string {
  const w = Math.max(0, Math.min(1, level));
  const water = spoiled ? '#A8C77A' : 'var(--nyang-water)';
  return `<svg viewBox="0 0 100 58" aria-hidden="true">
    <ellipse cx="50" cy="52" rx="44" ry="6" fill="rgba(42,26,16,.18)"/>
    <path d="M8 28 H92 L82 52 H18 Z" fill="var(--sky-deep)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M18 36 H82" stroke="var(--white)" stroke-width="4" stroke-linecap="round" opacity=".6"/>
    <ellipse cx="50" cy="28" rx="42" ry="7" fill="var(--panel)" stroke="${O}" stroke-width="4"/>
    ${w > 0.02 || spoiled ? `<ellipse cx="50" cy="29" rx="${10 + 30 * Math.max(w, spoiled ? 0.3 : 0)}" ry="${2 + 4 * Math.max(w, spoiled ? 0.3 : 0)}" fill="${water}"/>` : ''}
    ${w > 0.5 && !spoiled ? '<path d="M34 27 q6 -3 12 0" stroke="var(--white)" stroke-width="2.5" fill="none" stroke-linecap="round"/>' : ''}
  </svg>`;
}

/** 화장실 (모래 상자): 똥 개수만큼 덩어리가 보인다 */
export function litterBox(poops: number): string {
  const spots = [[34, 20], [58, 16], [46, 26], [70, 24]];
  const lumps = spots
    .slice(0, poops)
    .map(([x, y]) => `<g transform="translate(${x} ${y})"><ellipse rx="7" ry="4.5" fill="#8A5A34" stroke="${O}" stroke-width="2"/><ellipse cx="-1" cy="-3" rx="4.5" ry="3" fill="#9E6B40" stroke="${O}" stroke-width="2"/></g>`)
    .join('');
  return `<svg viewBox="0 0 100 52" aria-hidden="true">
    <ellipse cx="50" cy="47" rx="48" ry="5" fill="rgba(42,26,16,.18)"/>
    <path d="M6 14 H94 L88 46 H12 Z" fill="var(--team-a)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M10 14 Q50 4 90 14 Z" fill="var(--nyang-sand)" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
    ${lumps}
    <path d="M14 26 H86" stroke="var(--white)" stroke-width="4" stroke-linecap="round" opacity=".55"/>
  </svg>`;
}

/** 사료 봉투 (끌어서 기울인다) */
export const foodBag = `<svg viewBox="0 0 64 80" aria-hidden="true">
  <path d="M10 14 L54 14 L58 74 Q32 80 6 74 Z" fill="var(--primary)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M10 14 L16 4 H48 L54 14" fill="var(--primary-deep)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="32" cy="44" r="13" fill="var(--white)" stroke="${O}" stroke-width="3"/>
  <path d="M24 42 l3 -7 3 5 M40 42 l-3 -7 -3 5" fill="var(--pink)" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="28" cy="45" r="1.8" fill="${O}"/><circle cx="36" cy="45" r="1.8" fill="${O}"/>
  <path d="M30 49 q2 2 4 0" stroke="${O}" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`;

/** 물 주전자 (물그릇을 누르면 잠깐 나타나 붓는다) */
export const waterJug = `<svg viewBox="0 0 70 60" aria-hidden="true">
  <path d="M12 16 H48 L52 54 H8 Z" fill="var(--white)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M14 30 H46 L49 52 H11 Z" fill="var(--nyang-water)"/>
  <path d="M48 22 L66 12" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M48 22 L66 12" stroke="var(--white)" stroke-width="3" stroke-linecap="round"/>
  <path d="M12 22 Q0 30 10 44" stroke="${O}" stroke-width="4" fill="none" stroke-linecap="round"/>
</svg>`;

/** 모래 삽 */
export const scoop = `<svg viewBox="0 0 90 60" aria-hidden="true">
  <path d="M4 8 H44 L40 44 Q24 52 8 44 Z" fill="var(--team-b)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M12 16 V38 M22 16 V40 M32 16 V38" stroke="${O}" stroke-width="2.5" stroke-linecap="round" opacity=".6"/>
  <path d="M44 22 L86 30" stroke="${O}" stroke-width="10" stroke-linecap="round"/><path d="M44 22 L86 30" stroke="var(--team-b)" stroke-width="5" stroke-linecap="round"/>
</svg>`;

/** 쓰레기 봉투 */
export const trashBag = `<svg viewBox="0 0 70 80" aria-hidden="true">
  <path d="M14 22 Q4 70 18 76 H52 Q66 70 56 22 Z" fill="var(--matgo-mat-dark)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M14 22 L24 8 L34 18 L46 6 L56 22" fill="var(--table-matgo)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M22 40 Q35 46 48 40" stroke="var(--white)" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>
</svg>`;

/** 방석 (고양이가 쉬는 곳) */
export const cushion = `<svg viewBox="0 0 120 50" aria-hidden="true">
  <ellipse cx="60" cy="44" rx="56" ry="6" fill="rgba(42,26,16,.15)"/>
  <ellipse cx="60" cy="28" rx="54" ry="18" fill="var(--pink)" stroke="${O}" stroke-width="4"/>
  <ellipse cx="60" cy="24" rx="38" ry="10" fill="#FF8FA3" stroke="${O}" stroke-width="3"/>
</svg>`;

/** 담요 (감기 기운을 낫게 할 때 고양이 위에 덮는다) */
export const blanket = `<svg viewBox="0 0 120 70" aria-hidden="true">
  <path d="M6 30 Q60 0 114 30 L106 64 Q60 54 14 64 Z" fill="var(--sky-mid)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M30 22 L26 60 M60 14 V56 M90 22 L94 60" stroke="var(--white)" stroke-width="4" stroke-linecap="round" opacity=".7"/>
</svg>`;
