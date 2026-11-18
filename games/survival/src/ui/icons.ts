/**
 * 무기·패시브·강화 아이콘. 코드로 그린 SVG (DESIGN.md: 굵은 갈색 외곽선 + 밝은 단색, 색은 shared/theme.css 의 변수).
 * 정식 그림을 만들면 public/art/icon-<종류>-<id>.png 로 넣고 ICON_FILES 에 이름을 적는다. 그러면 그 그림을 먼저 쓴다.
 *   종류: w 무기 · p 패시브 · u 강화   (예: 'icon-w-shuriken', 'icon-p-fan', 'icon-u-might')
 * (파일이 없는 이름을 적어 두면 화면마다 404 요청이 나가므로, 파일을 넣은 것만 적는다)
 */
export const ICON_FILES: readonly string[] = [];

const O = 'stroke="var(--outline)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
const C = { y: 'var(--primary)', yd: 'var(--primary-deep)', yl: 'var(--primary-light)', p: 'var(--pink)', b: 'var(--team-a)', bd: 'var(--sky-deep)', bl: 'var(--sky-mid)', g: 'var(--win)', r: 'var(--lose)', w: 'var(--white)', br: 'var(--ink-soft)', tan: 'var(--empty-line)', cream: 'var(--panel)', gray: 'var(--draw)', k: 'var(--outline)', skin: 'var(--sky-bottom)' };

/** 별 모양 꼭짓점 */
function star(cx: number, cy: number, n: number, r0: number, r1: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r1 : r0;
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}
const slashes = (fill: string) =>
  [12, 22, 32].map((x) => `<path d="M${x} 8 q10 14 4 32 q-10 -12 -4 -32z" fill="${fill}" ${O}/>`).join('');
const cloud = (fill: string) => `<path d="M12 34 a8 8 0 0 1 2 -15 a10 10 0 0 1 19 -2 a8 8 0 0 1 3 17z" fill="${fill}" ${O}/>`;
const magnet = `<path d="M10 10 h10 v16 a4 4 0 0 0 8 0 v-16 h10 v16 a14 14 0 0 1 -28 0z" fill="${C.r}" ${O}/><path d="M10 10 h10 v7 h-10z M28 10 h10 v7 h-10z" fill="${C.w}" ${O}/>`;
const coin = `<circle cx="24" cy="24" r="16" fill="${C.y}" ${O}/><rect x="18" y="18" width="12" height="12" fill="${C.yd}" ${O}/>`;

/** 그림 본문 (48×48 기준) */
const ART: Record<string, string> = {
  // ───── 무기 ─────
  'w-shuriken': `<polygon points="${star(24, 24, 4, 20, 7)}" fill="${C.bl}" ${O}/><circle cx="24" cy="24" r="4" fill="${C.k}"/>`,
  'w-shurikenEvo': `<polygon points="${star(24, 24, 4, 20, 7)}" fill="${C.y}" ${O}/><polygon points="${star(24, 24, 4, 20, 7, -45)}" fill="${C.yl}" ${O} opacity="0.9"/><circle cx="24" cy="24" r="4" fill="${C.k}"/>`,
  'w-bell': `<path d="M24 6 a4 4 0 0 1 4 4 q10 4 10 18 l4 8 h-36 l4 -8 q0 -14 10 -18 a4 4 0 0 1 4 -4z" fill="${C.y}" ${O}/><circle cx="24" cy="40" r="4" fill="${C.yd}" ${O}/>`,
  'w-claw': slashes(C.yl),
  'w-clawEvo': `<circle cx="24" cy="24" r="20" fill="${C.p}" ${O}/>${slashes(C.y)}`,
  'w-mooncake': `<circle cx="24" cy="24" r="17" fill="${C.w}" ${O}/><path d="M30 10 a16 16 0 0 1 0 28 a12 12 0 0 0 0 -28z" fill="${C.yl}"/><circle cx="18" cy="20" r="3" fill="${C.cream}" ${O}/>`,
  'w-pearl': `<circle cx="24" cy="24" r="16" fill="${C.b}" ${O}/><circle cx="18" cy="18" r="5" fill="${C.w}"/>`,
  'w-pearlEvo': `<ellipse cx="24" cy="26" rx="21" ry="8" fill="none" ${O}/><circle cx="24" cy="22" r="14" fill="${C.y}" ${O}/><circle cx="19" cy="17" r="4" fill="${C.w}"/>`,
  'w-mist': `${cloud(C.g)}<circle cx="18" cy="40" r="2.5" fill="${C.g}" ${O}/><circle cx="30" cy="42" r="2" fill="${C.g}" ${O}/>`,
  'w-hoof': `<path d="M10 40 v-16 a14 14 0 0 1 28 0 v16 h-9 v-16 a5 5 0 0 0 -10 0 v16z" fill="${C.gray}" ${O}/><circle cx="14" cy="26" r="1.8" fill="${C.k}"/><circle cx="34" cy="26" r="1.8" fill="${C.k}"/><circle cx="24" cy="14" r="1.8" fill="${C.k}"/>`,
  'w-wool': cloud(C.w),
  'w-staff': `<path d="M8 36 l28 -28 l4 4 l-28 28z" fill="${C.r}" ${O}/><path d="M8 36 l5 -5 l4 4 l-5 5z M31 13 l5 -5 l4 4 l-5 5z" fill="${C.y}" ${O}/>`,
  'w-feather': `<path d="M38 8 q4 16 -12 26 l-10 6 l4 -12 q6 -18 18 -20z" fill="${C.w}" ${O}/><path d="M12 42 l22 -28" fill="none" ${O}/>`,
  'w-puppy': `<ellipse cx="11" cy="20" rx="6" ry="11" fill="${C.br}" ${O}/><ellipse cx="37" cy="20" rx="6" ry="11" fill="${C.br}" ${O}/><circle cx="24" cy="26" r="15" fill="${C.tan}" ${O}/><ellipse cx="24" cy="32" rx="8" ry="6" fill="${C.w}"/><circle cx="18" cy="23" r="2.5" fill="${C.k}"/><circle cx="30" cy="23" r="2.5" fill="${C.k}"/><circle cx="24" cy="29" r="3" fill="${C.k}"/>`,
  'w-piggy': `<path d="M8 12 l10 4 l-8 8z M40 12 l-10 4 l8 8z" fill="${C.p}" ${O}/><circle cx="24" cy="26" r="16" fill="${C.skin}" ${O}/><ellipse cx="24" cy="31" rx="9" ry="7" fill="${C.p}" ${O}/><circle cx="20.5" cy="31" r="2" fill="${C.k}"/><circle cx="27.5" cy="31" r="2" fill="${C.k}"/><circle cx="17" cy="21" r="2.2" fill="${C.k}"/><circle cx="31" cy="21" r="2.2" fill="${C.k}"/>`,
  // ───── 패시브 ─────
  'p-might': `<rect x="12" y="5" width="24" height="38" rx="3" fill="${C.y}" ${O}/><path d="M24 34 v-18 M17 22 l7 -8 l7 8" fill="none" stroke="${C.r}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  'p-wind': `<path d="M6 16 h22 a6 6 0 1 0 -6 -6 M6 26 h30 a6 6 0 1 1 -6 6 M6 36 h14" fill="none" stroke="${C.k}" stroke-width="7" stroke-linecap="round"/><path d="M6 16 h22 a6 6 0 1 0 -6 -6 M6 26 h30 a6 6 0 1 1 -6 6 M6 36 h14" fill="none" stroke="${C.bl}" stroke-width="3" stroke-linecap="round"/>`,
  'p-shell': `<polygon points="24,5 40,14 40,34 24,43 8,34 8,14" fill="${C.g}" ${O}/><polygon points="24,15 32,20 32,29 24,34 16,29 16,20" fill="${C.yl}" ${O}/><path d="M24 5 v10 M40 14 l-8 6 M40 34 l-8 -5 M24 43 v-9 M8 34 l8 -5 M8 14 l8 6" fill="none" ${O}/>`,
  'p-sleeve': `<path d="M6 12 l20 -4 l16 8 l-2 24 h-14 l-2 -14 l-10 8z" fill="${C.b}" ${O}/><path d="M26 8 l-4 18" fill="none" ${O}/><path d="M26 40 h14" fill="none" stroke="${C.w}" stroke-width="3" stroke-linecap="round"/>`,
  'p-fan': `<path d="M24 42 l-19 -22 a25 25 0 0 1 38 0z" fill="${C.p}" ${O}/><path d="M24 42 l-9 -27 M24 42 v-30 M24 42 l9 -27" fill="none" ${O}/><circle cx="24" cy="42" r="3" fill="${C.y}" ${O}/>`,
  'p-magnet': magnet,
  'p-ginseng': `<path d="M24 14 q8 4 6 12 l8 10 l-9 -5 l-2 11 l-3 -10 l-3 10 l-2 -11 l-9 5 l8 -10 q-2 -8 6 -12z" fill="${C.tan}" ${O}/><path d="M24 14 q-10 -2 -10 -9 q9 0 10 9 q1 -9 10 -9 q0 7 -10 9z" fill="${C.g}" ${O}/>`,
  'p-knot': `<path d="M24 22 q-16 -16 -16 -4 q0 10 16 4 q16 -16 16 -4 q0 10 -16 4z" fill="${C.p}" ${O}/><circle cx="24" cy="22" r="5" fill="${C.y}" ${O}/><path d="M21 27 l-5 15 M27 27 l5 15" fill="none" stroke="${C.k}" stroke-width="6" stroke-linecap="round"/><path d="M21 27 l-5 15 M27 27 l5 15" fill="none" stroke="${C.p}" stroke-width="2.5" stroke-linecap="round"/>`,
  // ───── 영구 강화 ─────
  'u-might': `<path d="M34 6 l8 0 l0 8 l-20 20 l-8 -8z" fill="${C.w}" ${O}/><path d="M10 26 l12 12 M8 40 l8 -8" fill="none" stroke="${C.k}" stroke-width="8" stroke-linecap="round"/><path d="M10 26 l12 12 M8 40 l8 -8" fill="none" stroke="${C.yd}" stroke-width="3.5" stroke-linecap="round"/>`,
  'u-hp': `<path d="M24 42 l-16 -16 a9.5 9.5 0 0 1 16 -12 a9.5 9.5 0 0 1 16 12z" fill="${C.p}" ${O}/><circle cx="16" cy="18" r="3" fill="${C.w}"/>`,
  'u-armor': `<path d="M24 5 l16 5 v12 q0 14 -16 21 q-16 -7 -16 -21 v-12z" fill="${C.b}" ${O}/><path d="M24 5 v38" fill="none" ${O}/><path d="M24 9 l12 4 v9 q0 10 -12 16z" fill="${C.bl}"/>`,
  'u-speed': `<path d="M6 30 q0 -10 10 -10 l6 6 l16 4 q6 2 4 10 h-36z" fill="${C.y}" ${O}/><path d="M6 36 h36" fill="none" ${O}/><path d="M4 10 h12 M2 18 h8" fill="none" stroke="${C.k}" stroke-width="3" stroke-linecap="round"/>`,
  'u-xp': `<polygon points="${star(24, 25, 5, 20, 9)}" fill="${C.y}" ${O}/>`,
  'u-pickup': magnet,
  'u-coin': coin,
  'u-revive': `<ellipse cx="24" cy="9" rx="10" ry="4" fill="none" stroke="${C.k}" stroke-width="6"/><ellipse cx="24" cy="9" rx="10" ry="4" fill="none" stroke="${C.y}" stroke-width="2.5"/><path d="M24 20 q-18 -8 -20 8 q6 -2 8 4 q4 -4 12 2 q8 -6 12 -2 q2 -6 8 -4 q-2 -16 -20 -8z" fill="${C.w}" ${O}/><path d="M24 26 v16" fill="none" stroke="${C.k}" stroke-width="3" stroke-linecap="round"/>`,
  'u-reroll': `<rect x="8" y="14" width="22" height="28" rx="4" fill="${C.cream}" ${O} transform="rotate(-10 19 28)"/><rect x="18" y="8" width="22" height="28" rx="4" fill="${C.w}" ${O} transform="rotate(8 29 22)"/><path d="M24 24 a6 6 0 1 1 3 5 M24 24 v-5 M24 24 h5" fill="none" stroke="${C.b}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" transform="rotate(8 29 22)"/>`,
  // 덤 카드
  'x-cake': `<rect x="7" y="13" width="34" height="24" rx="10" fill="${C.w}" ${O}/><circle cx="24" cy="25" r="5" fill="${C.p}" ${O}/>`,
  'x-coin': coin,
  'x-unknown': `<circle cx="24" cy="24" r="17" fill="${C.cream}" ${O}/><path d="M18 19 a6 6 0 1 1 8 6 q-2 1 -2 4" fill="none" ${O}/><circle cx="24" cy="35" r="2" fill="${C.k}"/>`,
};

/**
 * 아이콘 HTML. kind: w 무기 · p 패시브 · u 강화 · x 그 밖(cake · coin · unknown)
 * 글자 크기에 맞춰 1em 정사각형으로 그려진다 (크기는 감싸는 쪽의 font-size 로 정한다).
 */
export function icon(kind: 'w' | 'p' | 'u' | 'x', id: string): string {
  const key = `${kind}-${id}`;
  if (ICON_FILES.includes(`icon-${key}`)) return `<img class="ico" src="${import.meta.env.BASE_URL}art/icon-${key}.png" alt="" />`;
  return `<svg class="ico" viewBox="0 0 48 48" aria-hidden="true">${ART[key] ?? ART['x-unknown']}</svg>`;
}

/** 아이콘이 있는 열쇠 목록 (시험용) */
export const ICON_KEYS = Object.keys(ART);
