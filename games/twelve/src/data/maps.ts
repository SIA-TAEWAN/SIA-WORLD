/**
 * 맵 데이터 (PRD '저장과 서버, 기술 구조': 맵 배치는 타일 데이터).
 * 96맵(12지형 × 8맵)을 담는 표이고, 지형 파일(maps/rNN.ts)은 `npm run gen` (scripts/gen-maps.ts) 이 만든 뒤 손으로 다듬는다.
 * 보통·어려움 모드가 같은 맵을 쓴다 — 모드에 따라 달라지는 것(권장 레벨·요괴 수)은 regions.ts 의 mapScale 이 정한다.
 */
import { FINAL_BOSS, type BossId } from './bosses';
import type { EnemyKind } from './enemies';
import { FINAL } from './maps/final';
import { R01 } from './maps/r01';
import { R02 } from './maps/r02';
import { R03 } from './maps/r03';
import { R04 } from './maps/r04';
import { R05 } from './maps/r05';
import { R06 } from './maps/r06';
import { R07 } from './maps/r07';
import { R08 } from './maps/r08';
import { R09 } from './maps/r09';
import { R10 } from './maps/r10';
import { R11 } from './maps/r11';
import { R12 } from './maps/r12';
import { HARD, MAPS_PER_REGION, REGIONS, mapScale, parseMapId, regionOf, type EnvId, type MapId, type Mode } from './regions';

/** 타일 글자 */
export const T_WALL = '#';
export const T_FLOOR = '.';
/** 느려지는 땅 (물웅덩이. 2지형에서는 진흙탕) */
export const T_SLOW = '~';

/** 칸 좌표 [가로, 세로]. 세로 0 이 맨 위(출구 쪽)이고, 대원은 아래에서 위로 올라간다 */
export type Cell = [number, number];

export interface GroupDef {
  /** 무리 가운데 칸 */
  at: Cell;
  /** [요괴, 마리 수] */
  list: [EnemyKind, number][];
  /** 이 무리에 섞인 정예 */
  elite?: EnemyKind;
}

export interface MapDef {
  id: MapId;
  region: number;
  no: number;
  name: string;
  /** 타일 줄 (모든 줄의 길이는 MAP_W) */
  rows: string[];
  start: Cell;
  exit: Cell;
  /** 숨은 상자 (맵마다 1개, 길에서 조금 벗어난 곳) */
  chest: Cell;
  groups: GroupDef[];
  /** 지형 보스가 서 있는 칸 (8번째 맵) */
  boss?: Cell;
  /** 별 기준 시간 (초) */
  par: number;
  /** 최종보스맵 (region 12 · no 9 로 적혀 있다: 드랍·확정 보정은 12지형 것. 지형 환경 효과·고향 보너스는 없고 보스는 어둑시니) */
  final?: boolean;
  /** 끝없는 탑의 층 (data/tower.ts 가 만든 방. 요괴 배율은 층으로 정하고, 숨은 상자가 없다) */
  tower?: number;
}

/** 준비된 맵 (없는 지형은 지도에 '준비 중') */
const LIST: MapDef[] = [...R01, ...R02, ...R03, ...R04, ...R05, ...R06, ...R07, ...R08, ...R09, ...R10, ...R11, ...R12];
/** 지형 맵 96개 (최종보스맵은 FINAL 로 따로 — 지형 화면·맵 생성·별 24개에 들어가지 않는다) */
export const MAPS: readonly MapDef[] = LIST;
export { FINAL };
/** 시작할 수 있는 맵 전부 (서버 맵 표 _twelve_maps 의 줄) */
export const ALL_MAPS: readonly MapDef[] = [...LIST, FINAL];
const BY_ID = new Map<string, MapDef>(ALL_MAPS.map((m) => [m.id, m]));
export const mapOf = (id: string): MapDef | null => BY_ID.get(id) ?? null;
export const mapsOf = (region: number): MapDef[] => LIST.filter((m) => m.region === region);
/** 다음 맵 (지형의 마지막이면 다음 지형 1번, 12지형의 마지막이면 최종보스맵. 준비되지 않았으면 null) */
export function nextMap(id: string): MapDef | null {
  const p = parseMapId(id);
  if (!p || p.no > MAPS_PER_REGION) return null;
  if (p.no < MAPS_PER_REGION) return mapOf(`${p.region}-${p.no + 1}`);
  return p.region === REGIONS ? FINAL : mapOf(`${p.region + 1}-1`);
}
/** 이 맵의 보스 (보스가 없는 맵에도 그 지형 보스 id 를 준다 — map.boss 로 먼저 볼 것) */
export const bossIdOf = (map: MapDef): BossId => (map.final ? FINAL_BOSS : regionOf(map.region).boss);
/** 이 맵에 걸리는 지형 환경 효과 (최종보스맵은 없다) */
export const envOf = (map: MapDef): EnvId => (map.final ? 'none' : regionOf(map.region).env);
/** 고향 보너스를 따지는 지형 (최종보스맵은 0 = 누구의 고향도 아니다) */
export const homeRegionOf = (map: MapDef): number => (map.final ? 0 : map.region);

/** 별 '시간 안에'의 기준 시간 (초). 어려움은 요괴가 더 세고 많은 만큼 넉넉하다 (서버 맵 표의 par) */
export const mapPar = (map: MapDef, mode: Mode): number => (mode === 'hard' ? Math.round(map.par * HARD.par) : map.par);

/** 그 모드에서 무리의 [요괴, 마리 수] (어려움은 수가 늘어난다) */
export function groupList(g: GroupDef, countMul: number): [EnemyKind, number][] {
  return g.list.map(([k, n]) => [k, Math.max(1, Math.round(n * countMul))]);
}

/** 맵에서 잡을 수 있는 요괴 수 (종류별 · 정예 · 보스). 서버가 받는 처치 수의 최대치와 같다 (5단계 SQL 표가 이 값을 쓴다) */
export function mapKillMax(map: MapDef, mode: Mode): { kinds: Partial<Record<EnemyKind, number>>; elites: number; boss: number; total: number } {
  const { count } = mapScale(map.region, map.no, mode);
  const kinds: Partial<Record<EnemyKind, number>> = {};
  let elites = 0;
  let total = 0;
  for (const g of map.groups) {
    for (const [k, n] of groupList(g, count)) {
      kinds[k] = (kinds[k] ?? 0) + n;
      total += n;
    }
    if (g.elite) {
      elites++;
      total++;
    }
  }
  return { kinds, elites, boss: map.boss ? 1 : 0, total };
}
