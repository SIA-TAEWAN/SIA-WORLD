/**
 * 끝없는 탑 (PRD '전체 구조 — 끝없는 탑' · '랭킹과 시아코인').
 * 층마다 짧은 전투 방 하나, 10층마다 보스. 층이 오를수록 요괴가 세지고 엽전·강화석·레어가 늘어난다.
 * 방은 층 번호만으로 정해진다 (무작위 없음). 10층씩 십이지 지형을 차례로 돈다 (1~10층 쥐의 들판 → … → 111~120층 돼지의 염라전 → 다시 처음).
 * 보상 숫자는 서버(078_twelve.sql 의 _twelve_const · twelve_tower_floor)와 같아야 한다 — `npm run sqlgen` 이 기준 값을 옮기고,
 * 규칙은 src/game/tower.ts 와 SQL 에 한 벌씩 있다 (scripts/pg-check.mjs 가 맞춰 본다).
 */
import { MAP_W } from './balance';
import type { EnemyKind } from './enemies';
import type { GroupDef, MapDef } from './maps';
import { REGIONS, levelScale, regionOf, type MapId, type Scale } from './regions';

export const TOWER = {
  /** 보스 층 · 체크포인트 간격 (10층마다 보스, 그 다음 층에서 다시 시작할 수 있다. 시아코인도 이 간격으로 1개) */
  cp: 10,
  /** 정예가 나오는 층 간격 (보스 층은 빼고) */
  eliteEvery: 5,
  /** 한 층을 이보다 빨리 올라간 기록은 받지 않는다 (초). 빠른 대원은 방을 4초 안에 가로지르므로 넉넉히 낮게 잡는다.
   * 화면은 보내는 시간을 이 값 이상으로 올려 보낸다 (ui/app.ts 의 floorCleared) */
  minTime: 2,
  bossMinTime: 4,
  /** 엽전 = (base + step × 층) × (정예 층 elite · 보스 층 boss) */
  coin: { base: 20, step: 6, elite: 2, boss: 5 },
  /**
   * 강화석: 보통 층은 rate(1/10000) 확률로 1개, 정예 층 elite + 층÷eliteStep, 보스 층 boss + 층÷bossStep (max 까지)
   */
  stone: { rate: 1000, elite: 1, eliteStep: 50, boss: 2, bossStep: 10, max: 12 },
  /** 일반 장비: 보통 층에서 gear(1/10000) 확률. 장신구: 정예 층 · 보스 층 */
  gear: 400,
  acc: { elite: 1500, boss: 4000 },
  /** 레어 (1/10000): 정예 층 elite + eliteStep × 층 (eliteMax 까지), 보스 층 boss + bossStep × 층 (bossMax 까지) */
  rare: { elite: 100, eliteStep: 2, eliteMax: 500, boss: 800, bossStep: 10, bossMax: 3000 },
  /** 층을 올라갈 때 체력·마력이 이만큼 찬다 (최대치의 비율). 보스 층을 넘으면 가득 */
  heal: 0.1,
} as const;

export type FloorKind = 'normal' | 'elite' | 'boss';
export const floorKind = (floor: number): FloorKind => (floor % TOWER.cp === 0 ? 'boss' : floor % TOWER.eliteEvery === 0 ? 'elite' : 'normal');
/** 그 층의 지형 (그림 · 요괴 · 보스 · 환경 효과 · 고향 보너스) */
export const towerRegion = (floor: number) => (Math.floor((Math.max(1, floor) - 1) / TOWER.cp) % REGIONS) + 1;
/** 층의 요괴 레벨: 1층 = Lv1 맵, 한 층에 1씩 (끝이 없다) */
export const towerLevel = (floor: number) => Math.max(1, Math.floor(floor));
export const towerScale = (floor: number): Scale => levelScale(towerLevel(floor), 1);
export const floorMinTime = (floor: number) => (floorKind(floor) === 'boss' ? TOWER.bossMinTime : TOWER.minTime);
/** 그 층에서 시작할 수 있는지의 모양: 1층이거나 보스 층 바로 다음 (11 · 21 · …) */
export const isStartFloor = (floor: number) => Number.isInteger(floor) && floor >= 1 && (floor - 1) % TOWER.cp === 0;

/** 층 보상 가운데 정해진 것 (엽전 획득 장신구 적용 전) */
export function towerCoins(floor: number): number {
  const k = floorKind(floor);
  return (TOWER.coin.base + TOWER.coin.step * floor) * (k === 'boss' ? TOWER.coin.boss : k === 'elite' ? TOWER.coin.elite : 1);
}
/** 꼭 받는 강화석 (보통 층은 0 — 확률로 1개) */
export function towerStones(floor: number): number {
  const k = floorKind(floor);
  if (k === 'boss') return Math.min(TOWER.stone.max, TOWER.stone.boss + Math.floor(floor / TOWER.stone.bossStep));
  if (k === 'elite') return Math.min(TOWER.stone.max, TOWER.stone.elite + Math.floor(floor / TOWER.stone.eliteStep));
  return 0;
}
/** 레어 확률 (1/10000) */
export function towerRareRate(floor: number): number {
  const k = floorKind(floor);
  if (k === 'boss') return Math.min(TOWER.rare.bossMax, TOWER.rare.boss + TOWER.rare.bossStep * floor);
  if (k === 'elite') return Math.min(TOWER.rare.eliteMax, TOWER.rare.elite + TOWER.rare.eliteStep * floor);
  return 0;
}

// ---------- 방 ----------

/** 방 크기 (칸). 화면 하나에 거의 다 들어온다 */
export const TOWER_ROWS = 22;
const START: [number, number] = [8, 19];
const EXIT: [number, number] = [8, 2];
const BOSS_AT: [number, number] = [8, 8];
/** 기둥(2×2) 놓는 모양 4가지 — 층마다 돌아가며 */
const PILLARS: [number, number][][] = [[], [[3, 12], [11, 12]], [[7, 12]], [[3, 11], [11, 11], [3, 15], [11, 15]]];
/** 무리 자리 (기둥과 겹치지 않는 칸) */
const SPOTS: [number, number][] = [[5, 6], [10, 6], [8, 9]];

/** 층의 요괴 수 (정예·보스 제외) */
export const floorCount = (floor: number) => Math.min(16, 5 + Math.floor(floor / 4));
/** 층에 나오는 요괴 종류: 그 지형 목록의 앞에서부터, 10층 안에서 올라갈수록 늘어난다 */
export function floorKinds(floor: number): EnemyKind[] {
  const list = regionOf(towerRegion(floor)).enemies;
  return list.slice(0, Math.min(list.length, 2 + Math.floor(((floor - 1) % TOWER.cp) / 3)));
}

const cache = new Map<number, MapDef>();
/** 그 층의 방 (맵과 같은 모양이라 전투 시뮬레이션을 그대로 쓴다) */
export function towerFloor(floor: number): MapDef {
  const f = Math.max(1, Math.floor(floor));
  const hit = cache.get(f);
  if (hit) return hit;
  const region = towerRegion(f);
  const kind = floorKind(f);
  const grid: string[][] = Array.from({ length: TOWER_ROWS }, (_, y) => Array.from({ length: MAP_W }, (_, x) => (y === 0 || y === TOWER_ROWS - 1 || x === 0 || x === MAP_W - 1 ? '#' : '.')));
  // 보스 층은 기둥 없이 넓게
  if (kind !== 'boss') for (const [px, py] of PILLARS[f % PILLARS.length]) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) grid[py + dy][px + dx] = '#';
  // 진흙 · 물길 · 독안개 지형의 층에는 진흙탕 · 물 · 늪 (환경 효과가 걸리는 땅)
  if (['mud', 'water', 'poison'].includes(regionOf(region).env)) for (let y = 16; y <= 17; y++) for (let x = 4; x <= 11; x++) grid[y][x] = '~';

  const groups: GroupDef[] = [];
  if (kind !== 'boss') {
    const kinds = floorKinds(f);
    const n = floorCount(f);
    const parts = n >= 9 ? 3 : 2;
    for (let g = 0; g < parts; g++) {
      const size = Math.floor(n / parts) + (g < n % parts ? 1 : 0);
      const count = new Map<EnemyKind, number>();
      for (let i = 0; i < size; i++) {
        const k = kinds[(i + g + f) % kinds.length];
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      groups.push({ at: SPOTS[g], list: [...count.entries()] });
    }
    if (kind === 'elite') groups[0].elite = kinds[f % kinds.length];
  }
  const map: MapDef = {
    id: `0-${f}` as MapId,
    region,
    no: 1,
    name: `끝없는 탑 ${f}층`,
    rows: grid.map((r) => r.join('')),
    start: START,
    exit: EXIT,
    // 상자는 없다 (닿을 수 없는 벽 구석에 둔다)
    chest: [0, 0],
    groups,
    ...(kind === 'boss' ? { boss: BOSS_AT } : {}),
    par: 0,
    tower: f,
  };
  if (cache.size > 64) cache.clear();
  cache.set(f, map);
  return map;
}
