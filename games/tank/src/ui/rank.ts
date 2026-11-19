/**
 * 랭킹: 전체 플레이어 순위의 비율로 등급을 정한다.
 *   금(해) 상위 10% · 은(달) 상위 30% · 동(별) 상위 60% · 그 외 구름
 * 대전 랭킹은 승패 순 (승수 → 승률 → 패가 적은 순). 아직 한 번도 이기지 못한 사람은 구름.
 */
import { escapeHtml } from './hud';
import type { RankEntry, TargetEntry } from '../net/backend';

export type Tier = 'gold' | 'silver' | 'bronze' | 'white';
export interface RankRow {
  /** 사람마다 다른 값 (가입자는 user_id, 예전 기록은 'legacy:ID') */
  key: string;
  /** 화면에 보일 이름 */
  name: string;
  points: number;
  wins: number;
  losses: number;
}

export const TIER_NAME: Record<Tier, string> = { gold: '해', silver: '달', bronze: '별', white: '구름' };
/** 랭킹 창에 쓰는 이름 */
export const TIER_LABEL: Record<Tier, string> = { gold: '금 (해)', silver: '은 (달)', bronze: '동 (별)', white: '구름' };
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

/** points: 대전 랭킹 (승패 순), target: 백발백중 최고 점수 랭킹 (따로 운영) */
export type Board = 'points' | 'target';
interface BoardData {
  rows: RankRow[];
  /** key → 등급 */
  tiers: Map<string, Tier>;
  /** key → 순위 (같은 점수면 같은 순위) */
  places: Map<string, number>;
  /** 이름 → key (이름만 아는 곳(게임 화면)용. 가입자를 예전 기록보다 우선) */
  byName: Map<string, string>;
}
const empty = (): BoardData => ({ rows: [], tiers: new Map(), places: new Map(), byName: new Map() });
const boards: Record<Board, BoardData> = { points: empty(), target: empty() };
/** key 또는 이름 → key */
const resolve = (b: BoardData, x: string) => (b.tiers.has(x) ? x : (b.byName.get(x) ?? x));

/** 승률 (0~1). 한 판도 안 했으면 0 */
const rate = (r: RankRow) => (r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0);

/** score: 줄 세우는 값 (높을수록 위, 같으면 같은 순위). base 이하는 구름 */
function build(board: Board, list: RankRow[], base: number, score: (r: RankRow) => number = (r) => r.points) {
  const rows = [...list].sort((a, b) => score(b) - score(a) || a.losses - b.losses || a.name.localeCompare(b.name));
  const tiers = new Map<string, Tier>();
  const places = new Map<string, number>();
  const byName = new Map<string, string>();
  const n = rows.length;
  rows.forEach((r, i) => {
    const place = i > 0 && score(rows[i - 1]) === score(r) ? places.get(rows[i - 1].key)! : i + 1;
    places.set(r.key, place);
    if (!byName.has(r.name) || !r.key.startsWith('legacy:')) byName.set(r.name, r.key);
    let tier: Tier = 'white';
    if (score(r) > base) for (const [t, cut] of CUT) if ((place - 1) / n < cut) {
      tier = t;
      break;
    }
    tiers.set(r.key, tier);
  });
  boards[board] = { rows, tiers, places, byName };
}

/** 대전 랭킹: 승수 → 승률 (승수 + 승률의 절반으로 줄 세운다), 0승은 구름 */
export function setRanking(list: RankEntry[]) {
  build('points', list, 0, (r) => r.wins + rate(r) / 2);
}

/** 백발백중 랭킹: 최고 점수 기준, 0점은 구름 */
export function setTargetRanking(list: TargetEntry[]) {
  build('target', list.map((r) => ({ key: r.key, name: r.name, points: r.best, wins: 0, losses: 0 })), 0);
}

/** who: 사용자 key(user_id) 또는 이름 */
export const tierOf = (who: string, board: Board = 'points'): Tier => boards[board].tiers.get(resolve(boards[board], who)) ?? 'white';
export const placeOf = (who: string, board: Board = 'points'): number | undefined => boards[board].places.get(resolve(boards[board], who));
export const ranking = (board: Board = 'points') => boards[board].rows;

/** 등급 아이콘 SVG: 금=해, 은=달, 동=별, 그 외=구름 */
export function cloudSvg(tier: Tier, size = 18): string {
  const [hi, lo, line] = TIER_COLOR[tier];
  const id = `cg-${tier}`;
  const grad = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>`;
  const paint = `fill="url(#${id})" stroke="${line}" stroke-width="1.8" stroke-linejoin="round"`;
  let shape: string;
  if (tier === 'gold') {
    // 해: 동그라미 + 햇살
    const rays = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return `<line x1="${16 + Math.cos(a) * 7.5}" y1="${11 + Math.sin(a) * 7.5}" x2="${16 + Math.cos(a) * 10.5}" y2="${11 + Math.sin(a) * 10.5}" stroke="${line}" stroke-width="2" stroke-linecap="round"/>`;
    }).join('');
    shape = `${rays}<circle cx="16" cy="11" r="6" ${paint}/>`;
  } else if (tier === 'silver') {
    // 달: 초승달
    shape = `<path d="M19.5 2.2A9 9 0 1 0 22.8 17.6 7.2 7.2 0 1 1 19.5 2.2z" ${paint}/>`;
  } else if (tier === 'bronze') {
    // 별
    const pts = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? 4.4 : 10;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      return `${(16 + Math.cos(a) * r).toFixed(1)},${(11.8 + Math.sin(a) * r).toFixed(1)}`;
    }).join(' ');
    shape = `<polygon points="${pts}" ${paint}/>`;
  } else {
    shape = `<path d="M8 20h17a6 6 0 0 0 .6-12A8 8 0 0 0 10.2 7 6.5 6.5 0 0 0 8 20z" ${paint}/>`;
  }
  return `<svg class="cloud-ic" viewBox="0 0 32 22" width="${size}" height="${(size * 22) / 32}" aria-label="${TIER_NAME[tier]}">${grad}${shape}</svg>`;
}

/** 닉네임 앞에 등급 아이콘(해·달·별·구름)을 붙인 HTML (key: 사용자 ID, 알면 넘긴다) */
export function rankedName(name: string, size = 16, key?: string): string {
  return `<span class="rk-name">${cloudSvg(tierOf(key ?? name), size)}${escapeHtml(name)}</span>`;
}

/** 랭킹 창 (me: 내 사용자 ID) */
export function showRankingModal(me: string, board: Board = 'points') {
  const wrap = document.createElement('div');
  wrap.className = 'rank-modal';
  const tg = board === 'target';
  const rows = boards[board].rows;
  const list = rows.slice(0, 100);
  const mine = rows.find((r) => r.key === me);
  const total = rows.length;
  const line = (r: RankRow) => {
    const t = tierOf(r.key, board);
    return `<tr class="${r.key === me ? 'me' : ''} t-${t}"><td class="pl">${placeOf(r.key, board)}</td><td>${cloudSvg(t, 26)}</td><td class="nm">${escapeHtml(r.name)}</td><td class="pt">${tg ? `${r.points.toLocaleString()}점` : `${r.wins}승 ${r.losses}패`}</td><td class="wl">${tg ? '최고 점수' : `승률 ${Math.round(rate(r) * 100)}%`}</td></tr>`;
  };
  wrap.innerHTML = `<div class="rank-box">
    <div class="rank-head"><h3>🏆 랭킹 <small>${total}명</small></h3><button class="btn small-btn" data-close>닫기</button></div>
    <div class="seg rank-tabs"><button data-b="points" class="${tg ? '' : 'sel'}">대전 랭킹</button><button data-b="target" class="${tg ? 'sel' : ''}">🎯 백발백중</button></div>
    <div class="rank-legend">${(['gold', 'silver', 'bronze', 'white'] as Tier[])
      .map((t, i) => `<span>${cloudSvg(t, 22)}<b>${TIER_LABEL[t]}</b><small>${['상위 10%', '상위 30%', '상위 60%', '나머지'][i]}</small></span>`)
      .join('')}</div>
    ${mine ? `<p class="rank-me">내 순위: <b>${placeOf(me, board)}위</b> / ${total}명 · ${cloudSvg(tierOf(me, board), 20)} ${TIER_LABEL[tierOf(me, board)]} · ${tg ? `${mine.points.toLocaleString()}점` : `${mine.wins}승 ${mine.losses}패`}</p>` : `<p class="rank-me">${tg ? '아직 기록이 없어요. 백발백중을 해 보세요!' : '아직 기록이 없어요. 대전에서 이기면 순위에 올라가요!'}</p>`}
    <div class="rank-scroll"><table>${list.length ? list.map(line).join('') : '<tr><td>아직 랭킹이 없어요</td></tr>'}</table></div>
    <p class="rank-note">${tg ? '백발백중 최고 점수로 순위를 매겨요. 0점인 사람은 구름이에요.' : '승수가 많은 순, 같으면 승률이 높은 순이에요. 1승도 없는 사람은 구름이에요.'}</p>
  </div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-b]');
    if (tab) {
      close();
      showRankingModal(me, tab.dataset.b as Board);
      return;
    }
    if (e.target === wrap || (e.target as HTMLElement).closest('[data-close]')) close();
  });
  document.body.append(wrap);
}

/** 게임 화면(Phaser)용 구름 텍스처 SVG 데이터 URL */
export function cloudDataUrl(tier: Tier): string {
  const svg = cloudSvg(tier, 64).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/ aria-label="[^"]*"/, '');
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
