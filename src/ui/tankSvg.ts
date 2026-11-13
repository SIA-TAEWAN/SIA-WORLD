import { TANKS, type TankId } from '../game/data';

/**
 * 12지신 탱크 그림 (오른쪽을 보는 모습).
 * 좌표계: 무한궤도 바닥 y=38, 머리(돔) 중심 (24,20), 눈 (27,19)·(32,19).
 * 메뉴 화면과 게임 안 텍스처가 같은 그림을 쓴다.
 */

const O = '#3a2a1e';

interface Look {
  /** 몸 뒤쪽 장식 (귀·뿔·꼬리) */
  back?: string;
  /** 머리 위에 덮는 얼굴색 */
  face?: string;
  /** 얼굴 앞 장식 (코·주둥이·수염) */
  front?: string;
  /** 몸통 장식 */
  plate?: string;
  domeR?: number;
}

const s = (w = 2) => `stroke="${O}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

function look(id: TankId): Look {
  const d = TANKS[id];
  const c = d.color;
  const a = d.accent;
  switch (id) {
    case 'rat':
      return {
        back: `<path d="M9 30 C1 30 1 21 7 20" fill="none" stroke="${a}" stroke-width="2.2" stroke-linecap="round"/>
          <circle cx="17.5" cy="11.5" r="5.5" fill="${c}" ${s()}/><circle cx="17.5" cy="11.5" r="3" fill="${a}"/>
          <circle cx="26.5" cy="9.5" r="5.2" fill="${c}" ${s()}/><circle cx="26.5" cy="9.5" r="2.8" fill="${a}"/>`,
        front: `<ellipse cx="35" cy="23.5" rx="3.2" ry="2.4" fill="${c}" ${s(1.5)}/><circle cx="37.6" cy="22.8" r="1.5" fill="${a}" ${s(0.8)}/>
          <path d="M35 24.5 L41.5 23 M35 25 L41.5 26.5" stroke="${O}" stroke-width="0.8"/>`,
      };
    case 'ox':
      return {
        back: `<path d="M17 14 Q9 12 10 4 Q13 10 19.5 11 Z" fill="${a}" ${s(1.6)}/><path d="M29 11.5 Q35 8 36 1.5 Q39 9 31 15 Z" fill="${a}" ${s(1.6)}/>
          <ellipse cx="15" cy="17" rx="3.4" ry="2.2" fill="${c}" ${s(1.5)}/>`,
        face: `<ellipse cx="19.5" cy="15" rx="3.2" ry="2.2" fill="#fff" fill-opacity=".55"/>`,
        front: `<ellipse cx="33.5" cy="24.2" rx="4.2" ry="3" fill="#f2c9a6" ${s(1.5)}/><circle cx="32.3" cy="24" r=".8" fill="${O}"/><circle cx="35" cy="24" r=".8" fill="${O}"/>
          <circle cx="33.7" cy="27.3" r="1.7" fill="none" stroke="#ffd23a" stroke-width="1.1"/>`,
      };
    case 'tiger':
      return {
        back: `<circle cx="17" cy="12.5" r="3.6" fill="${c}" ${s(1.6)}/><circle cx="17" cy="12.5" r="1.6" fill="${a}"/>
          <circle cx="27.5" cy="11.2" r="3.6" fill="${c}" ${s(1.6)}/><circle cx="27.5" cy="11.2" r="1.6" fill="${a}"/>`,
        face: `<path d="M23.5 11.2 L23.8 15 M19 13 L20.8 16 M15.6 18 L18.6 19 M28.6 12.6 L27.6 15.3" stroke="${a}" stroke-width="1.7" stroke-linecap="round"/>`,
        front: `<ellipse cx="33" cy="23.4" rx="3.6" ry="2.6" fill="#fff" ${s(1.2)}/><path d="M34.2 21.6 L36.4 21.6 L35.3 23 Z" fill="#ff7a9a"/>`,
        plate: `<path d="M14 21.5 L15.5 26 M19.5 21.5 L21 25 M30 21.5 L31.5 26" stroke="${a}" stroke-width="1.8" stroke-linecap="round"/>`,
      };
    case 'rabbit':
      return {
        back: `<path d="M10 27 m-3.5 0 a3.5 3.5 0 1 0 7 0 a3.5 3.5 0 1 0 -7 0" fill="#fff" ${s(1.5)}/>
          <g transform="rotate(-12 19 9)"><ellipse cx="19" cy="4" rx="3" ry="8.5" fill="${c}" ${s(1.6)}/><ellipse cx="19" cy="4.5" rx="1.3" ry="6" fill="${a}"/></g>
          <g transform="rotate(14 27 9)"><ellipse cx="27" cy="3.5" rx="3" ry="8.5" fill="${c}" ${s(1.6)}/><ellipse cx="27" cy="4" rx="1.3" ry="6" fill="${a}"/></g>`,
        front: `<circle cx="34.6" cy="22" r="1.4" fill="${a}"/><rect x="32.6" y="24.2" width="2.6" height="2.6" rx=".6" fill="#fff" ${s(0.8)}/>`,
      };
    case 'dragon':
      return {
        back: `<path d="M16.5 11.5 L10.5 8.5 L14.5 15.5 Z M15 18 L8.5 17.5 L14.5 22 Z" fill="${a}" ${s(1.4)}/>
          <path d="M21 12 L19 3.5 M19.6 6.5 L16 4.5 M27.5 11.5 L29.5 3 M29 6 L32.5 4.5" stroke="${a}" stroke-width="2.2" stroke-linecap="round"/>`,
        face: `<path d="M18 22 q2 -2 4 0 M17 17.5 q2 -2 4 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>`,
        front: `<ellipse cx="34" cy="23.6" rx="3.8" ry="2.7" fill="${c}" ${s(1.4)}/><circle cx="36.2" cy="22.8" r=".8" fill="${O}"/>
          <path d="M35.5 25 Q41 24 43 29 M34 22 Q39 18 42 19" fill="none" stroke="${a}" stroke-width="1.2" stroke-linecap="round"/>`,
      };
    case 'snake':
      return {
        back: `<path d="M10 31 Q1 29 4.5 22.5 Q8 18 12 22" fill="none" stroke="${O}" stroke-width="5.5" stroke-linecap="round"/>
          <path d="M10 31 Q1 29 4.5 22.5 Q8 18 12 22" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>`,
        face: `<path d="M20 12.5 l2 -2 l2 2 l-2 2 Z M16.5 17 l2 -2 l2 2 l-2 2 Z M27 12 l1.6 -1.6 l1.6 1.6 l-1.6 1.6 Z" fill="${a}"/>`,
        front: `<path d="M34 24 L39 25 M39 25 L41.2 23.4 M39 25 L41.2 26.6" stroke="#ff3b5c" stroke-width="1.2" stroke-linecap="round" fill="none"/>`,
        plate: `<path d="M13 23 l2.5 -2 l2.5 2 l-2.5 2 Z M21 23 l2.5 -2 l2.5 2 l-2.5 2 Z M29 23 l2.5 -2 l2.5 2 l-2.5 2 Z" fill="${a}" fill-opacity=".8"/>`,
      };
    case 'horse':
      return {
        back: `<path d="M24.5 12 L27 4.5 L29.5 12.5 Z" fill="${c}" ${s(1.5)}/>
          <path d="M16 23 Q12 12 22 8.5 Q20.5 12.5 24.5 10.5 Q22.5 14 27.5 12.5 Q19.5 16 18.5 24 Z" fill="${a}" ${s(1.3)}/>`,
        front: `<ellipse cx="34.2" cy="24" rx="3.8" ry="3" fill="#e8c39a" ${s(1.4)}/><circle cx="35.6" cy="23.6" r=".8" fill="${O}"/>`,
      };
    case 'sheep':
      return {
        back: [
          [15.5, 14], [18.5, 9.5], [24, 8.2], [29.5, 9.8], [14.5, 20], [32.5, 14],
        ].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.2" fill="#fff" ${s(1.4)}/>`).join(''),
        face: `<ellipse cx="29.5" cy="21" rx="6.2" ry="5.6" fill="#ecd3b3" ${s(1.2)}/>
          <circle cx="18" cy="19.5" r="3.6" fill="${a}" ${s(1.4)}/><path d="M18 19.5 m-1.6 0 a1.6 1.6 0 1 1 1.6 1.6" fill="none" stroke="${O}" stroke-width=".9"/>`,
        front: `<path d="M30 24.8 q1.5 1.2 3 0" fill="none" stroke="${O}" stroke-width="1"/>`,
        domeR: 9.5,
      };
    case 'monkey':
      return {
        back: `<path d="M9 30 Q2 27 5 20.5 Q8 16.5 11 20.5" fill="none" stroke="${O}" stroke-width="4.4" stroke-linecap="round"/>
          <path d="M9 30 Q2 27 5 20.5 Q8 16.5 11 20.5" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>
          <circle cx="14.6" cy="18.5" r="3.8" fill="${c}" ${s(1.5)}/><circle cx="14.6" cy="18.5" r="2" fill="#f6d1a8"/>`,
        face: `<ellipse cx="29.6" cy="21" rx="6.2" ry="5.8" fill="#f6d1a8" ${s(1.2)}/>`,
        front: `<path d="M29.5 25 q2 1.5 4 0" fill="none" stroke="${O}" stroke-width="1"/><path d="M22 10 Q24 7 26 10" fill="none" stroke="${c}" stroke-width="2"/>`,
      };
    case 'rooster':
      return {
        back: `<path d="M12.5 27 Q3 19 8.5 11 Q10 18 14.5 22 Z" fill="#ffb02e" ${s(1.4)}/><path d="M13 26 Q6 22 7 15 Q10 20 15 22 Z" fill="${a}" ${s(1.2)}/>
          <path d="M19 12.5 Q18.5 6 21.8 8.8 Q22.5 3.6 25.8 7.6 Q28 4.5 29 11.5 Z" fill="${a}" ${s(1.5)}/>`,
        front: `<path d="M34 19.8 L39.5 22 L34 24.2 Z" fill="#ffb02e" ${s(1.3)}/><ellipse cx="34.3" cy="26" rx="1.4" ry="2" fill="${a}" ${s(0.8)}/>`,
      };
    case 'dog':
      return {
        front: `<g transform="rotate(18 18 17)"><ellipse cx="18" cy="19" rx="3.6" ry="6.2" fill="${a}" ${s(1.5)}/></g>
          <ellipse cx="35.4" cy="22.2" rx="2.1" ry="1.7" fill="${O}"/><path d="M32.5 25 q1 2.6 2.4 0" fill="#ff7a9a" ${s(0.8)}/>`,
        face: `<ellipse cx="31.5" cy="19" rx="3.4" ry="3.6" fill="${a}" fill-opacity=".35"/>`,
      };
    case 'zodiac': {
      // 십이지신: 금빛 몸, 왕관, 열두 띠 색 구슬
      const cols = ['#a9b2c3', '#8a5a3c', '#ff9a2e', '#f4f1f6', '#3fbf8f', '#7bc04a', '#b8763e', '#fff7e6', '#a8693c', '#ff3b3b', '#e0a85a', '#ffb3c7'];
      return {
        back: `<path d="M15 12 L17 3 L20.5 9 L24 1.5 L27.5 9 L31 3 L33 12 Z" fill="#ffd23a" ${s(1.5)}/>
          <circle cx="17" cy="3" r="1.4" fill="${a}"/><circle cx="24" cy="1.5" r="1.6" fill="#6fd8ff"/><circle cx="31" cy="3" r="1.4" fill="${a}"/>
          <path d="M9 27 Q2 22 6 15 Q8 21 12 23" fill="#ff8fb1" ${s(1.2)}/><path d="M39 27 Q46 22 42 15 Q40 21 36 23" fill="#6fd8ff" ${s(1.2)}/>`,
        plate: cols.map((col, i) => `<circle cx="${11.5 + i * 2.27}" cy="27.6" r="1.05" fill="${col}" stroke="${O}" stroke-width=".35"/>`).join(''),
        front: `<path d="M33.5 23.6 q1.6 1.3 3.2 0" fill="none" stroke="${O}" stroke-width="1"/>`,
        domeR: 9.6,
      };
    }
    case 'pig':
      return {
        back: `<path d="M17 14 L14.5 6.5 L21.5 11 Z M25.5 11 L28 4 L30.5 11.5 Z" fill="${c}" ${s(1.5)}/>
          <path d="M9 27 q-4 -1 -2 -4 q2 -2 3 1" fill="none" stroke="${a}" stroke-width="1.6" stroke-linecap="round"/>`,
        front: `<ellipse cx="34.2" cy="22.8" rx="3.3" ry="2.7" fill="#ff8fab" ${s(1.4)}/><circle cx="33.2" cy="22.8" r=".8" fill="${a}"/><circle cx="35.3" cy="22.8" r=".8" fill="${a}"/>`,
        domeR: 9.6,
      };
  }
}

/** 얼굴(눈 주변) 색: 눈 깜빡임 눈꺼풀 색으로 쓴다 */
export function faceColor(id: TankId): string {
  if (id === 'sheep') return '#ecd3b3';
  if (id === 'monkey') return '#f6d1a8';
  return TANKS[id].color;
}

/** 색을 밝게(+)/어둡게(-) */
function shade(hex: string, amt: number): string {
  const v = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const r = f((v >> 16) & 255);
  const g = f((v >> 8) & 255);
  const b = f(v & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

let uid = 0;

/** 탱크 몸체 SVG 조각 (포신 제외) */
function bodyParts(id: TankId): string {
  const d = TANKS[id];
  const l = look(id);
  const r = l.domeR ?? 9;
  const k = `${id}${uid++}`;
  const c = d.color;
  return `<defs>
      <radialGradient id="dome${k}" cx="0.36" cy="0.3" r="0.8">
        <stop offset="0" stop-color="${shade(c, 0.45)}"/><stop offset="0.55" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.22)}"/>
      </radialGradient>
      <linearGradient id="plate${k}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${shade(c, 0.3)}"/><stop offset="0.5" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.25)}"/>
      </linearGradient>
      <linearGradient id="track${k}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6a6a7c"/><stop offset="1" stop-color="#2e2e3a"/>
      </linearGradient>
    </defs>
    ${l.back ?? ''}
    <rect x="6.5" y="28.5" width="35" height="10" rx="5" fill="url(#track${k})" ${s()}/>
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<rect x="${9.2 + i * 3.4}" y="29.6" width="1.4" height="1.4" rx=".4" fill="#8a8a9c"/>`).join('')}
    ${[0, 1, 2, 3].map((i) => `<circle cx="${13 + i * 7.3}" cy="33.8" r="2.7" fill="#c3c8d3" stroke="#3a3a48" stroke-width=".9"/><circle cx="${13 + i * 7.3}" cy="33.8" r="1" fill="#6b7080"/>`).join('')}
    <circle cx="9.3" cy="33.6" r="1.6" fill="#8a8fa0" stroke="#3a3a48" stroke-width=".7"/><circle cx="38.7" cy="33.6" r="1.6" fill="#8a8fa0" stroke="#3a3a48" stroke-width=".7"/>
    <rect x="9" y="21" width="30" height="10" rx="4" fill="url(#plate${k})" ${s()}/>
    <path d="M11.5 23.2 Q24 21.6 36.5 23.2" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M10.5 29.4 L37.5 29.4" stroke="${shade(c, -0.4)}" stroke-opacity=".5" stroke-width=".8"/>
    ${[12.5, 35.5].map((x) => `<circle cx="${x}" cy="26.4" r=".9" fill="${shade(c, -0.35)}"/><circle cx="${x - 0.25}" cy="26.1" r=".35" fill="#fff" fill-opacity=".7"/>`).join('')}
    ${l.plate ?? ''}
    <circle cx="24" cy="20" r="${r}" fill="url(#dome${k})" ${s()}/>
    <ellipse cx="20.4" cy="15.2" rx="3.2" ry="2" fill="#fff" fill-opacity=".55" transform="rotate(-30 20.4 15.2)"/>
    <circle cx="18.6" cy="18.2" r=".9" fill="#fff" fill-opacity=".45"/>
    ${l.face ?? ''}
    <ellipse cx="27" cy="19" rx="2.5" ry="3" fill="#fff" stroke="${O}" stroke-width=".5"/><ellipse cx="32" cy="19" rx="2.5" ry="3" fill="#fff" stroke="${O}" stroke-width=".5"/>
    <circle cx="28" cy="19.3" r="1.7" fill="#1e1e2a"/><circle cx="33" cy="19.3" r="1.7" fill="#1e1e2a"/>
    <circle cx="28.6" cy="18.5" r=".65" fill="#fff"/><circle cx="33.6" cy="18.5" r=".65" fill="#fff"/>
    <ellipse cx="25" cy="23.6" rx="1.9" ry="1.2" fill="#ff7a9a" fill-opacity=".55"/>
    ${l.front ?? ''}`;
}

/** 메뉴 화면용 탱크 그림 ('random'은 물음표 탱크) */
export function tankSvg(id: TankId | 'random', size = 96, flip = false): string {
  if (id === 'random')
    return `<svg class="tank-svg" viewBox="0 -8 50 48" width="${size}" height="${size * 0.96}" aria-hidden="true">
      <ellipse cx="24" cy="39" rx="19" ry="2.5" fill="#000" fill-opacity=".18"/>
      <rect x="6.5" y="28.5" width="35" height="10" rx="5" fill="#4a4a58" ${s()}/>
      <rect x="9" y="21" width="30" height="10" rx="4" fill="#cfc6ff" ${s()}/>
      <circle cx="24" cy="18" r="11" fill="url(#rq)" ${s()}/>
      <defs><linearGradient id="rq" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd23a"/><stop offset=".5" stop-color="#ff8fb1"/><stop offset="1" stop-color="#6fd8ff"/></linearGradient></defs>
      <text x="24" y="23.5" text-anchor="middle" font-size="15" font-family="Jua, sans-serif" fill="#fff" stroke="${O}" stroke-width="1.2" paint-order="stroke">?</text>
    </svg>`;
  const d = TANKS[id];
  return `<svg class="tank-svg" viewBox="0 -8 50 48" width="${size}" height="${size * 0.96}" style="${flip ? 'transform:scaleX(-1)' : ''}" aria-hidden="true">
    <ellipse cx="24" cy="39" rx="19" ry="2.5" fill="#000" fill-opacity=".18"/>
    <g transform="rotate(-35 24 23)"><rect x="23" y="19.5" width="24" height="7" rx="2.5" fill="${O}"/><rect x="25" y="21" width="20" height="4" rx="2" fill="${d.accent}"/><rect x="26" y="21.4" width="17" height="1.3" rx=".6" fill="#fff" fill-opacity=".45"/><rect x="42" y="19" width="5.5" height="8" rx="1.6" fill="${O}"/></g>
    ${bodyParts(id)}
  </svg>`;
}

/** 게임 안 텍스처용 SVG (포신 없음). 원점(바닥 가운데)은 (24,38) */
export const TEX_BOX = { x: 0, y: -8, w: 48, h: 48 };
/** 게임 안 텍스처 해상도 배율 (선명하게) */
export const TEX_SCALE = 3;
export function tankTextureSvg(id: TankId): string {
  const b = TEX_BOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${b.w * TEX_SCALE}" height="${b.h * TEX_SCALE}">
    <ellipse cx="24" cy="39" rx="18" ry="2.4" fill="#000" fill-opacity=".18"/>
    ${bodyParts(id)}
  </svg>`;
}
