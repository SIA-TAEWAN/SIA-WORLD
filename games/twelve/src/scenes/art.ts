/**
 * 그림 목록 (ASSETS.md). 시아돌격대 art.ts 와 같은 방식:
 * 전용 그림을 public/art/<이름>.png 로 넣고 여기 ART_FILES 에 이름을 적으면 판이 그 그림을 쓰고, 없으면 코드 그림(또는 기존 그림)으로 그린다.
 * 파일을 넣지 않은 이름은 적지 않는다 (판마다 404 요청이 나간다).
 */
import { BOSSES } from '../data/bosses';
import { ENEMIES, type EnemyKind } from '../data/enemies';
import type { HeroId } from '../data/heroes';
import type { MapDef } from '../data/maps';
import { regionOf, type Ground } from '../data/regions';
import { COLOR, MATGO, ROULETTE, TABLE } from '../theme';

export type OptionalArt =
  | `hero-${HeroId}` // 대원 걷기·공격·구르기 시트 (지금은 공용 전신 그림 한 장을 흔든다)
  | `tiles-${number}` // 지형 전용 타일셋 (지금은 시아디펜스 바닥 + 코드 벽)
  | 'chest' // 숨은 상자
  | 'exit' // 출구 (봉인 문)
  | 'fx-slash' // 베기 효과
  | 'main'; // 메인 화면 그림

export const ART_FILES: readonly OptionalArt[] = [];
export const hasArt = (name: OptionalArt) => ART_FILES.includes(name);

/** 바닥 4종의 색 (DESIGN.md 의 기존 값만 쓴다: 시아서바이벌·시아디펜스와 같은 바닥색) */
export const GROUND: Record<Ground, { tile: string; floor: number; wall: number; wallDark: number; slow: number }> = {
  field: { tile: 'tile-field', floor: TABLE.matgo, wall: MATGO.matDark, wallDark: COLOR.inkSoft, slow: COLOR.skyMid },
  bamboo: { tile: 'tile-bamboo', floor: TABLE.poker, wall: MATGO.matDark, wallDark: COLOR.inkSoft, slow: COLOR.skyMid },
  palace: { tile: 'tile-palace', floor: TABLE.blackjack, wall: COLOR.lineSoft, wallDark: COLOR.inkSoft, slow: ROULETTE.spring },
  underworld: { tile: 'tile-underworld', floor: ROULETTE.winter, wall: COLOR.inkSoft, wallDark: COLOR.outline, slow: COLOR.emptyLine },
};

/** 이 맵에서 받을 기본 그림 이름 (요괴·보스·바닥·효과) */
export function artFor(map: MapDef): string[] {
  const region = regionOf(map.region);
  const kinds = new Set<EnemyKind>();
  for (const g of map.groups) {
    for (const [k] of g.list) kinds.add(k);
    if (g.elite) kinds.add(g.elite);
  }
  const names = [GROUND[region.ground].tile, 'fx-pop', 'p-arrow'];
  if (map.boss) {
    const b = BOSSES[region.boss];
    names.push(b.art);
    kinds.add(b.summon.kind);
  }
  for (const k of kinds) names.push(ENEMIES[k].art);
  return names;
}
