// 랭킹 등급(해·달·별·구름) — 시아탱크(games/tank/src/ui/rank.ts)와 같은 기준.
//   해 상위 10% · 달 상위 30% · 별 상위 60% · 그 외 구름. 기준 금액 이하인 사람은 구름.

export const TIER_NAME = { gold: '해', silver: '달', bronze: '별', white: '구름' };
const TIER_COLOR = {
  gold: ['#fff3a0', '#f5b81c', '#9a6a00'],
  silver: ['#ffffff', '#b9c4d4', '#5f6b7d'],
  bronze: ['#ffd2a8', '#c97a3a', '#7a4214'],
  white: ['#ffffff', '#e8f1ff', '#8aa2c0'],
};
const CUT = [
  ['gold', 0.1],
  ['silver', 0.3],
  ['bronze', 0.6],
];

/**
 * rows: [{ key, amount }] (금액 높은 순으로 정렬해서 넘긴다)
 * base: 이 금액 이하면 구름
 * → [{ ...row, place, tier }]  (같은 금액이면 같은 순위)
 */
export function withTiers(rows, base = 0) {
  const n = rows.length;
  let prev = null;
  return rows.map((r, i) => {
    const place = prev && prev.amount === r.amount ? prev.place : i + 1;
    let tier = 'white';
    if (r.amount > base) for (const [t, cut] of CUT) if ((place - 1) / n < cut) {
      tier = t;
      break;
    }
    prev = { ...r, place, tier };
    return prev;
  });
}

/**
 * 순위(place)와 전체 인원(total)으로 등급을 정한다 (withTiers 와 같은 기준: 해 10% · 달 30% · 별 60% · 그 외 구름).
 * ranked 가 false 면 구름 (예: 아직 1승도 없는 사람).
 */
export function tierOfPlace(place, total, ranked = true) {
  if (!ranked || !(total > 0)) return 'white';
  for (const [t, cut] of CUT) if ((place - 1) / total < cut) return t;
  return 'white';
}

/** 등급 아이콘 SVG 문자열 */
export function tierSvg(tier, size = 18) {
  const [hi, lo, line] = TIER_COLOR[tier] ?? TIER_COLOR.white;
  const id = `tg-${tier}`;
  const grad = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>`;
  const paint = `fill="url(#${id})" stroke="${line}" stroke-width="1.8" stroke-linejoin="round"`;
  let shape;
  if (tier === 'gold') {
    const rays = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return `<line x1="${16 + Math.cos(a) * 7.5}" y1="${11 + Math.sin(a) * 7.5}" x2="${16 + Math.cos(a) * 10.5}" y2="${11 + Math.sin(a) * 10.5}" stroke="${line}" stroke-width="2" stroke-linecap="round"/>`;
    }).join('');
    shape = `${rays}<circle cx="16" cy="11" r="6" ${paint}/>`;
  } else if (tier === 'silver') {
    shape = `<path d="M19.5 2.2A9 9 0 1 0 22.8 17.6 7.2 7.2 0 1 1 19.5 2.2z" ${paint}/>`;
  } else if (tier === 'bronze') {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? 4.4 : 10;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      return `${(16 + Math.cos(a) * r).toFixed(1)},${(11.8 + Math.sin(a) * r).toFixed(1)}`;
    }).join(' ');
    shape = `<polygon points="${pts}" ${paint}/>`;
  } else {
    shape = `<path d="M8 20h17a6 6 0 0 0 .6-12A8 8 0 0 0 10.2 7 6.5 6.5 0 0 0 8 20z" ${paint}/>`;
  }
  return `<svg viewBox="0 0 32 22" width="${size}" height="${(size * 22) / 32}" aria-label="${TIER_NAME[tier]}" style="vertical-align:middle">${grad}${shape}</svg>`;
}
