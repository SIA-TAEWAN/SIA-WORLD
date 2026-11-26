/**
 * 갈림길 지도 (PRD [핵심 루프]): 아래에서 위로 12줄, 한 줄 2~4칸, 이어진 칸 중 하나를 골라 오른다. 맨 위는 막 보스.
 * 칸 종류는 막 전체 칸 수에 스펙 비율(전투 45 · 정예 10 · 상점 10 · 쉼터 12 · 보물 8 · 이야기 15)을 곱해 개수를 정하고 섞어 놓는다.
 * 지킬 것(정한 값): 첫 줄은 모두 전투, 정예는 4번째 줄부터. 숨은 4막(어둑시니)은 보스 한 칸뿐.
 */
import { NODE_RATIO, ROWS_PER_ACT, ROW_WIDTH } from './data/acts.ts';
import { ENDLESS_REGIONS, type RunMode } from './data/modes.ts';
import { ACTS, regionDef } from './data.ts';
import { Rng, hashSeed } from './rng.ts';
import type { ActMap, MapNode } from './state.ts';
import type { NodeType } from './types.ts';

/** 정예가 나올 수 있는 첫 줄 (0부터) */
export const ELITE_FROM_ROW = 3;

export function genMap(seed: number, act: number, extraTreasure = 0, mode: RunMode = 'normal'): ActMap {
  const box = { s: hashSeed(seed, 'map', act) };
  const r = new Rng(box, 's');
  // 숨은 막(4막)은 그 번호일 때만, 그 밖에는 보통 막 순서대로.
  // 끝없는 모드: 1~3막은 보통과 같고, 4막부터 대나무숲 → 들판 → 궁궐 → 저승 되풀이 (숨은 막 없음)
  const normal = ACTS.filter((a) => !a.hidden);
  const regions: readonly string[] =
    mode === 'endless' && act > normal.length
      ? [ENDLESS_REGIONS[(act - normal.length - 1) % ENDLESS_REGIONS.length]]
      : (ACTS[act - 1] ?? normal[(act - 1) % normal.length]).regions;
  const ready = regions.filter((id) => regionDef(id).ready);
  const region = r.pick(ready.length ? ready : ['bamboo']);
  const reg = regionDef(region);
  const boss = r.pick(reg.bosses);
  const elites = reg.bosses.filter((b) => b !== boss);
  // 숨은 4막: 지도 없이 보스 한 칸
  if (reg.hidden) return { region, boss, elites, rows: [[{ col: 0, type: 'boss', next: [], x: 0.5 }]] };

  // 줄과 이음
  const rows: MapNode[][] = [];
  for (let y = 0; y < ROWS_PER_ACT; y++) {
    const w = r.int(ROW_WIDTH[0], ROW_WIDTH[1]);
    const row: MapNode[] = [];
    for (let i = 0; i < w; i++) row.push({ col: i, type: 'battle', next: [], x: (i + 0.5) / w });
    rows.push(row);
  }
  rows.push([{ col: 0, type: 'boss', next: [], x: 0.5 }]);
  for (let y = 0; y < ROWS_PER_ACT; y++) link(rows[y], rows[y + 1], r);

  // 칸 종류
  const free: MapNode[] = [];
  for (let y = 1; y < ROWS_PER_ACT; y++) free.push(...rows[y]);
  const total = free.length + rows[0].length;
  const counts = allocate(total, extraTreasure);
  counts.battle = Math.max(0, counts.battle - rows[0].length);
  // 남는/모자라는 칸은 전투로 맞춤
  let sum = 0;
  for (const k of Object.keys(counts) as NodeType[]) sum += counts[k];
  counts.battle += free.length - sum;
  const bag: NodeType[] = [];
  for (const [k] of NODE_RATIO) for (let i = 0; i < counts[k]; i++) bag.push(k);
  r.shuffle(bag);
  free.forEach((n, i) => (n.type = bag[i]));
  // 정예는 앞 줄에 두지 않는다: 앞 줄의 정예를 뒤쪽 전투와 맞바꿈
  const early = free.filter((n) => n.type === 'elite' && rowOf(rows, n) < ELITE_FROM_ROW);
  const late = free.filter((n) => n.type === 'battle' && rowOf(rows, n) >= ELITE_FROM_ROW);
  for (const n of early) {
    const m = late.length ? late.splice(r.int(0, late.length - 1), 1)[0] : null;
    if (!m) break;
    n.type = 'battle';
    m.type = 'elite';
  }
  return { region, boss, elites, rows };
}

function rowOf(rows: MapNode[][], n: MapNode): number {
  return rows.findIndex((row) => row.includes(n));
}

/** 스펙 비율 → 칸 개수 (큰 나머지 순으로 반올림) */
export function allocate(total: number, extraTreasure = 0): Record<NodeType, number> {
  const out = { battle: 0, elite: 0, shop: 0, rest: 0, treasure: 0, event: 0, boss: 0 } as Record<NodeType, number>;
  const rem: [NodeType, number][] = [];
  let used = 0;
  for (const [k, pct] of NODE_RATIO) {
    const exact = (total * pct) / 100;
    out[k] = Math.floor(exact);
    used += out[k];
    rem.push([k, exact - out[k]]);
  }
  rem.sort((a, b) => b[1] - a[1] || NODE_RATIO.findIndex(([k]) => k === a[0]) - NODE_RATIO.findIndex(([k]) => k === b[0]));
  for (let i = 0; used < total; i++, used++) out[rem[i % rem.length][0]]++;
  // 보물 지도: 보물 칸 +2 (전투 칸을 바꿈)
  const t = Math.min(extraTreasure, out.battle);
  out.treasure += t;
  out.battle -= t;
  return out;
}

/**
 * 두 줄 잇기: 각 칸을 가장 가까운 위 칸에, 각 위 칸을 가장 가까운 아래 칸에 잇고(겹치지 않음),
 * 겹치지 않는 범위에서 옆 칸 이음을 몇 개 더한다.
 */
function link(a: MapNode[], b: MapNode[], r: Rng) {
  const edges = new Set<string>();
  const near = (x: number, list: MapNode[]) => {
    let best = 0;
    for (let i = 1; i < list.length; i++) if (Math.abs(list[i].x - x) < Math.abs(list[best].x - x) - 1e-9) best = i;
    return best;
  };
  for (let i = 0; i < a.length; i++) edges.add(`${i},${near(a[i].x, b)}`);
  for (let j = 0; j < b.length; j++) edges.add(`${near(b[j].x, a)},${j}`);
  const crosses = (i: number, j: number) => {
    for (const e of edges) {
      const [p, q] = e.split(',').map(Number);
      if ((p < i && q > j) || (p > i && q < j)) return true;
    }
    return false;
  };
  for (let i = 0; i < a.length; i++) {
    for (const dj of [-1, 1]) {
      const cur = [...edges].filter((e) => e.startsWith(`${i},`)).map((e) => Number(e.split(',')[1]));
      const j = (dj < 0 ? Math.min(...cur) : Math.max(...cur)) + dj;
      if (j < 0 || j >= b.length || edges.has(`${i},${j}`)) continue;
      if (r.chance(0.3) && !crosses(i, j)) edges.add(`${i},${j}`);
    }
  }
  for (const e of edges) {
    const [i, j] = e.split(',').map(Number);
    a[i].next.push(j);
  }
  for (const n of a) n.next.sort((x, y) => x - y);
}

/** 지금 갈 수 있는 칸 (col 목록) */
export function reachable(map: ActMap, row: number, col: number): number[] {
  if (row < 0) return map.rows[0].map((n) => n.col);
  if (row >= map.rows.length - 1) return [];
  return map.rows[row][col].next;
}
