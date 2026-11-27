/**
 * 방 안 물건 그림 (임시 — 코드로 그린 SVG. 디자인 단계(6단계)에서 SpriteCook 그림으로 바꾼다).
 * DESIGN.md: 굵은 갈색 외곽선 + 밝은 단색. 색은 shared/theme.css 의 값만 쓴다.
 */
import { artImg } from './art';

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

// ---------- 3단계: 장난감 · 선물 · 츄르 · 빗 · 탁자 ----------

/** 낚싯대 끝의 깃털 */
export const feather = `<svg viewBox="0 0 40 70" aria-hidden="true">
  <path d="M20 4 Q34 22 26 50 Q20 62 20 68 Q20 62 14 50 Q6 22 20 4 Z" fill="var(--pink)" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M20 10 V66" stroke="${O}" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M20 24 L28 18 M20 34 L29 28 M20 24 L12 18 M20 34 L11 28" stroke="var(--white)" stroke-width="2" stroke-linecap="round" opacity=".8"/>
</svg>`;

/** 털실 공 */
export const yarnBall = `<svg viewBox="0 0 50 50" aria-hidden="true">
  <circle cx="25" cy="25" r="21" fill="var(--team-a)" stroke="${O}" stroke-width="3.5"/>
  <path d="M8 18 Q25 30 42 16 M6 28 Q25 40 44 26 M14 42 Q22 22 36 8" stroke="var(--white)" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".75"/>
</svg>`;

/** 빈 상자 (앞면 — 고양이가 뒤에 들어간다) */
export const boxFront = `<svg viewBox="0 0 120 80" aria-hidden="true">
  <ellipse cx="60" cy="76" rx="58" ry="5" fill="rgba(42,26,16,.18)"/>
  <path d="M4 18 L22 4 H98 L116 18 Z" fill="#C88B4E" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M6 18 H114 L108 74 H12 Z" fill="var(--charge-crate)" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M46 18 V40 H74 V18" fill="none" stroke="#B57A40" stroke-width="5"/>
  <path d="M-4 22 L6 18 L12 30 Z M124 22 L114 18 L108 30 Z" fill="#D9A05B" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
</svg>`;

/** 작은 탁자 + 컵 (고양이가 떨어뜨린다) */
export const sideTable = `<svg viewBox="0 0 80 70" aria-hidden="true">
  <ellipse cx="40" cy="66" rx="34" ry="4" fill="rgba(42,26,16,.18)"/>
  <path d="M16 26 V64 M64 26 V64" stroke="${O}" stroke-width="7" stroke-linecap="round"/>
  <path d="M16 26 V64 M64 26 V64" stroke="#B57A40" stroke-width="3" stroke-linecap="round"/>
  <rect x="4" y="18" width="72" height="12" rx="5" fill="#C88B4E" stroke="${O}" stroke-width="4"/>
</svg>`;
export const cup = `<svg viewBox="0 0 30 30" aria-hidden="true">
  <path d="M5 6 H23 L21 27 H7 Z" fill="var(--white)" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M23 10 Q30 12 22 20" fill="none" stroke="${O}" stroke-width="3"/>
  <path d="M8 12 H20" stroke="var(--pink)" stroke-width="3"/>
</svg>`;

/** 츄르 (맛마다 색) */
export function churuTube(color: string): string {
  return `<svg viewBox="0 0 40 150" aria-hidden="true">
  <path d="M8 6 H32 L30 120 Q20 150 10 120 Z" fill="${color}" stroke="${O}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M8 6 H32" stroke="${O}" stroke-width="8" stroke-linecap="round"/>
  <rect x="11" y="36" width="18" height="44" rx="6" fill="var(--white)" stroke="${O}" stroke-width="2.5"/>
  <path d="M15 52 l3 -6 2 4 2 -4 3 6" fill="none" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="20" cy="64" r="3" fill="var(--pink)"/>
</svg>`;
}

/** 빗 */
export const comb = `<svg viewBox="0 0 90 60" aria-hidden="true">
  <rect x="4" y="6" width="56" height="18" rx="8" fill="var(--primary)" stroke="${O}" stroke-width="4"/>
  <path d="M10 24 V46 M18 24 V48 M26 24 V48 M34 24 V48 M42 24 V48 M50 24 V46" stroke="${O}" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M60 14 L86 10" stroke="${O}" stroke-width="10" stroke-linecap="round"/><path d="M60 14 L86 10" stroke="var(--primary-deep)" stroke-width="5" stroke-linecap="round"/>
</svg>`;

/** 선물 그림 (kind) */
export function presentIcon(kind: string): string {
  if (kind === 'coin')
    return `<svg viewBox="0 0 60 50" aria-hidden="true"><ellipse cx="30" cy="46" rx="26" ry="4" fill="rgba(42,26,16,.18)"/>
      <path d="M12 20 Q6 44 30 46 Q54 44 48 20 Z" fill="#C88B4E" stroke="${O}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M14 20 Q30 8 46 20" fill="none" stroke="${O}" stroke-width="3.5"/><path d="M22 14 L30 22 L38 14" fill="none" stroke="var(--pink)" stroke-width="3"/>
      <circle cx="30" cy="33" r="8" fill="var(--primary)" stroke="${O}" stroke-width="3"/><rect x="27.5" y="30.5" width="5" height="5" fill="#C88B4E" stroke="${O}" stroke-width="1.5"/></svg>`;
  if (kind === 'seed')
    return `<svg viewBox="0 0 60 50" aria-hidden="true"><ellipse cx="30" cy="46" rx="22" ry="4" fill="rgba(42,26,16,.18)"/>
      <path d="M14 8 H46 V44 H14 Z" fill="var(--panel)" stroke="${O}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M30 36 V22" stroke="#5FA772" stroke-width="3.5" stroke-linecap="round"/><path d="M30 26 Q22 16 18 24 Q24 28 30 26 Z M30 24 Q38 14 42 22 Q36 26 30 24 Z" fill="#7CC08A" stroke="${O}" stroke-width="2.5"/>
      <path d="M14 14 H46" stroke="var(--pink)" stroke-width="4"/></svg>`;
  if (kind === 'toy')
    return `<svg viewBox="0 0 60 50" aria-hidden="true"><ellipse cx="30" cy="46" rx="20" ry="4" fill="rgba(42,26,16,.18)"/>
      <circle cx="30" cy="26" r="17" fill="var(--team-a)" stroke="${O}" stroke-width="3.5"/>
      <path d="M16 20 Q30 30 44 18 M14 30 Q30 40 46 28" stroke="var(--white)" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".75"/>
      <path d="M44 34 Q54 42 50 48" stroke="${O}" stroke-width="2.5" fill="none"/></svg>`;
  return `<svg viewBox="0 0 60 50" aria-hidden="true"><ellipse cx="30" cy="46" rx="26" ry="4" fill="rgba(42,26,16,.18)"/>
    <rect x="8" y="18" width="44" height="28" rx="4" fill="var(--pink)" stroke="${O}" stroke-width="3.5"/>
    <rect x="5" y="12" width="50" height="10" rx="3" fill="#FF8FA3" stroke="${O}" stroke-width="3.5"/>
    <path d="M30 12 V46" stroke="var(--primary)" stroke-width="6"/><path d="M30 12 Q18 0 14 8 Q20 14 30 12 Q42 0 46 8 Q40 14 30 12" fill="var(--primary)" stroke="${O}" stroke-width="2.5"/></svg>`;
}

/** 장난감 그림 (정보 창 · 상점) — 그림이 없으면 글자 그림 */
export function toyIcon(id: string): string {
  const name = ({ rod: 'objects-rod', laser: 'objects-laser', ball: 'objects-ball', box: 'objects-box' } as const)[id as 'rod'];
  const emoji = ({ rod: '🎣', laser: '🔴', ball: '🧶', box: '📦' } as Record<string, string>)[id] ?? '🎁';
  return name ? artImg(name, emoji, 'art toy-ico') : emoji;
}
