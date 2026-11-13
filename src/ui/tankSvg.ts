import { TANKS, type TankId } from '../game/data';

/** 메뉴 화면용 탱크 그림 (게임 안 텍스처와 같은 디자인) */
export function tankSvg(id: TankId, size = 96, flip = false): string {
  const d = TANKS[id];
  const o = '#3a2a1e';
  const extraBack =
    id === 'sparrow' ? `<path d="M18 18 L4 8 L11 20 Z" fill="${d.accent}" stroke="${o}" stroke-width="2" stroke-linejoin="round"/>` : '';
  const extraFront =
    id === 'driller'
      ? `<path d="M37 22 L48 26 L37 30 Z" fill="#c9ced8" stroke="${o}" stroke-width="2" stroke-linejoin="round"/>`
      : id === 'bolt'
        ? `<path d="M20 21 L16 26 L19 26 L16 30 L23 25 L20 25 L23 21 Z" fill="${d.accent}"/><path d="M22 11 L26 11 L24 5 Z" fill="${d.accent}" stroke="${o}" stroke-width="1.5"/>`
        : id === 'bubble'
          ? `<circle cx="24" cy="19" r="15" fill="${d.accent}" fill-opacity=".25" stroke="${d.accent}" stroke-width="2"/><circle cx="18" cy="12" r="2.5" fill="#fff" fill-opacity=".8"/>`
          : `<path d="M20 12 L25 11 L22 7 Z" fill="${d.accent}"/>`;
  return `<svg class="tank-svg" viewBox="0 -4 50 44" width="${size}" height="${size * 0.88}" style="${flip ? 'transform:scaleX(-1)' : ''}" aria-hidden="true">
    <ellipse cx="24" cy="39" rx="19" ry="2.5" fill="#000" fill-opacity=".18"/>
    <g transform="rotate(-35 24 23)"><rect x="23" y="19.5" width="24" height="7" rx="2.5" fill="${o}"/><rect x="25" y="21" width="20" height="4" rx="2" fill="${d.accent}"/></g>
    ${extraBack}
    <rect x="7" y="29" width="34" height="9" rx="4" fill="#4a4a58" stroke="${o}" stroke-width="2"/>
    ${[0, 1, 2, 3].map((i) => `<circle cx="${13 + i * 7.3}" cy="33.5" r="2.4" fill="#9aa0b0"/>`).join('')}
    <rect x="9" y="21" width="30" height="10" rx="4" fill="${d.color}" stroke="${o}" stroke-width="2"/>
    <rect x="12" y="22" width="18" height="3" rx="1.5" fill="#fff" fill-opacity=".35"/>
    <circle cx="24" cy="20" r="${id === 'bubble' ? 10 : 9}" fill="${d.color}" stroke="${o}" stroke-width="2"/>
    <circle cx="21" cy="16" r="3" fill="#fff" fill-opacity=".4"/>
    <ellipse cx="27" cy="19" rx="2.5" ry="3" fill="#fff"/><ellipse cx="32" cy="19" rx="2.5" ry="3" fill="#fff"/>
    <circle cx="28" cy="19" r="1.6" fill="#1e1e2a"/><circle cx="33" cy="19" r="1.6" fill="#1e1e2a"/>
    <circle cx="25" cy="23.5" r="1.6" fill="#ff7a9a" fill-opacity=".6"/>
    ${extraFront}
  </svg>`;
}
