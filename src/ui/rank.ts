/**
 * 랭킹: 전체 플레이어 포인트 순위의 비율로 구름 등급을 정한다.
 *   금구름 상위 10% · 은구름 상위 30% · 동구름 상위 60% · 나머지 하얀구름
 * 아직 한 번도 이기지 못해 1,000포인트인 사람은 하얀구름.
 */
import { escapeHtml } from './hud';

export type Tier = 'gold' | 'silver' | 'bronze' | 'white';
export interface RankRow {
  name: string;
  points: number;
  wins: number;
  losses: number;
}

export const TIER_NAME: Record<Tier, string> = { gold: '금구름', silver: '은구름', bronze: '동구름', white: '하얀구름' };
const TIER_COLOR: Record<Tier, [string, string, string]> = {
  // 밝은색, 어두운색, 테두리
  gold: ['#fff3a0', '#f5b81c', '#9a6a00'],
  silver: ['#ffffff', '#b9c4d4', '#5f6b7d'],
  bronze: ['#ffd2a8', '#c97a3a', '#7a4214'],
  white: ['#ffffff', '#e8f1ff', '#8aa2c0'],
};
const CUT: [Tier, number][] = [
  ['gold', 0.1],
  ['silver', 0.3],
  ['bronze', 0.6],
];

let rows: RankRow[] = [];
let tiers = new Map<string, Tier>();
/** 순위 (같은 포인트면 같은 순위) */
let places = new Map<string, number>();

export function setRanking(list: RankRow[]) {
  rows = [...list].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
  tiers = new Map();
  places = new Map();
  const n = rows.length;
  rows.forEach((r, i) => {
    const place = i > 0 && rows[i - 1].points === r.points ? places.get(rows[i - 1].name)! : i + 1;
    places.set(r.name, place);
    let tier: Tier = 'white';
    if (r.points > 1000) for (const [t, cut] of CUT) if ((place - 1) / n < cut) {
      tier = t;
      break;
    }
    tiers.set(r.name, tier);
  });
}

export const tierOf = (name: string): Tier => tiers.get(name) ?? 'white';
export const placeOf = (name: string): number | undefined => places.get(name);
export const ranking = () => rows;

/** 구름 아이콘 SVG */
export function cloudSvg(tier: Tier, size = 18): string {
  const [hi, lo, line] = TIER_COLOR[tier];
  const id = `cg-${tier}`;
  const star = tier === 'gold' ? `<path d="M16 6.2l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" fill="#fff" opacity=".9"/>` : '';
  return `<svg class="cloud-ic" viewBox="0 0 32 22" width="${size}" height="${(size * 22) / 32}" aria-label="${TIER_NAME[tier]}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs><path d="M8 20h17a6 6 0 0 0 .6-12A8 8 0 0 0 10.2 7 6.5 6.5 0 0 0 8 20z" fill="url(#${id})" stroke="${line}" stroke-width="1.8" stroke-linejoin="round"/>${star}</svg>`;
}

/** 닉네임 앞에 구름을 붙인 HTML */
export function rankedName(name: string, size = 16): string {
  return `<span class="rk-name">${cloudSvg(tierOf(name), size)}${escapeHtml(name)}</span>`;
}

/** 랭킹 창 */
export function showRankingModal(me: string) {
  const wrap = document.createElement('div');
  wrap.className = 'rank-modal';
  const list = rows.slice(0, 100);
  const mine = rows.find((r) => r.name === me);
  const total = rows.length;
  const line = (r: RankRow) => {
    const t = tierOf(r.name);
    return `<tr class="${r.name === me ? 'me' : ''} t-${t}"><td class="pl">${placeOf(r.name)}</td><td>${cloudSvg(t, 26)}</td><td class="nm">${escapeHtml(r.name)}</td><td class="pt">${r.points.toLocaleString()}P</td><td class="wl">${r.wins}승 ${r.losses}패</td></tr>`;
  };
  wrap.innerHTML = `<div class="rank-box">
    <div class="rank-head"><h3>☁️ 랭킹 <small>${total}명</small></h3><button class="btn small-btn" data-close>닫기</button></div>
    <div class="rank-legend">${(['gold', 'silver', 'bronze', 'white'] as Tier[])
      .map((t, i) => `<span>${cloudSvg(t, 22)}<b>${TIER_NAME[t]}</b><small>${['상위 10%', '상위 30%', '상위 60%', '나머지'][i]}</small></span>`)
      .join('')}</div>
    ${mine ? `<p class="rank-me">내 순위: <b>${placeOf(me)}위</b> / ${total}명 · ${cloudSvg(tierOf(me), 20)} ${TIER_NAME[tierOf(me)]} · ${mine.points.toLocaleString()}P</p>` : `<p class="rank-me">아직 기록이 없어요. 온라인 대전에서 이기면 순위에 올라가요!</p>`}
    <div class="rank-scroll"><table>${list.length ? list.map(line).join('') : '<tr><td>아직 랭킹이 없어요</td></tr>'}</table></div>
    <p class="rank-note">이기면 +100P, 지면 -100P (최저 1,000P). 1,000P인 사람은 하얀구름이에요.</p>
  </div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || (e.target as HTMLElement).closest('[data-close]')) close();
  });
  document.body.append(wrap);
}

/** 게임 화면(Phaser)용 구름 텍스처 SVG 데이터 URL */
export function cloudDataUrl(tier: Tier): string {
  const svg = cloudSvg(tier, 64).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/ aria-label="[^"]*"/, '');
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
