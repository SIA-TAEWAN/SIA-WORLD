/**
 * 그림 목록 (ASSETS.md). 시아돌격대 art.ts 와 같은 방식:
 * 전용 그림을 public/art/<이름>.png 로 넣고 여기 ART_FILES 에 이름을 적으면 판이 그 그림을 쓰고, 없으면 코드 그림(또는 기존 그림)으로 그린다.
 * 파일을 넣지 않은 이름은 적지 않는다 (판마다 404 요청이 나간다).
 */
import { BOSSES } from '../data/bosses';
import { ENEMIES, type EnemyKind } from '../data/enemies';
import type { HeroId } from '../data/heroes';
import { bossIdOf, type MapDef } from '../data/maps';
import { regionOf, type Ground } from '../data/regions';
import { COLOR, MATGO, ROULETTE, TABLE } from '../theme';

export type OptionalArt =
  | `hero-${HeroId}` // 대원 걷기·공격·구르기 시트 (지금은 공용 전신 그림 한 장을 흔든다)
  | `tiles-${number}` // 지형 전용 타일셋 (지금은 지형 바닥 무늬 + 코드 벽)
  | `floor-r${string}` // 지형 바닥 무늬 12종 (시아핑거의 지형 바닥과 같은 그림)
  | 'b-final' // 최종보스 어둑시니
  | 'chest' // 숨은 상자
  | 'exit' // 출구 (봉인 문)
  | 'fx-slash' // 베기 효과
  | 'main' // 메인 화면 그림
  | `story-${1 | 2 | 3 | 4}` // 시작 장면 그림 4장 (지금은 기존 그림을 모아 놓은 장면)
  | `ending-${1 | 2 | 3 | 4}` // 보통 모드 엔딩 그림 4장 (지금은 기존 그림을 모아 놓은 장면)
  | `finale-${1 | 2 | 3 | 4}` // 진짜 엔딩(어려움 최종보스) 그림 4장 (지금은 기존 그림을 모아 놓은 장면)
  | 'cat-scene'; // 고양이(13번째 대원) 등장 장면

/** 지형 바닥 무늬의 이름 (1 → floor-r01) */
export const floorArt = (region: number): OptionalArt => `floor-r${String(region).padStart(2, '0')}`;

export const ART_FILES: readonly OptionalArt[] = ['b-final', ...Array.from({ length: 12 }, (_, i) => floorArt(i + 1))];
export const hasArt = (name: OptionalArt) => ART_FILES.includes(name);

/** 바닥 4종의 색 (DESIGN.md 의 기존 값만 쓴다: 시아서바이벌·시아디펜스와 같은 바닥색) */
export const GROUND: Record<Ground, { tile: string; floor: number; wall: number; wallDark: number; slow: number }> = {
  field: { tile: 'tile-field', floor: TABLE.matgo, wall: MATGO.matDark, wallDark: COLOR.inkSoft, slow: COLOR.skyMid },
  bamboo: { tile: 'tile-bamboo', floor: TABLE.poker, wall: MATGO.matDark, wallDark: COLOR.inkSoft, slow: COLOR.skyMid },
  palace: { tile: 'tile-palace', floor: TABLE.blackjack, wall: COLOR.lineSoft, wallDark: COLOR.inkSoft, slow: ROULETTE.spring },
  underworld: { tile: 'tile-underworld', floor: ROULETTE.winter, wall: COLOR.inkSoft, wallDark: COLOR.outline, slow: COLOR.emptyLine },
};

/** 2지형은 물웅덩이 대신 진흙탕(흙색), 6지형은 독이 낀 늪(잿빛), 12지형은 불바닥(붉은빛)이다 */
export const groundOf = (region: number) => {
  const r = regionOf(region);
  return r.env === 'mud' ? { ...GROUND[r.ground], slow: COLOR.inkSoft } : r.env === 'poison' ? { ...GROUND[r.ground], slow: COLOR.draw } : r.env === 'fire' ? { ...GROUND[r.ground], slow: COLOR.lose } : GROUND[r.ground];
};

/** 기존 그림을 돌려 쓰는 요괴의 색 (전용 그림이 생기면 지운다 — ASSETS.md) */
export const ENEMY_TINT: Partial<Record<EnemyKind, number>> = { mud: COLOR.emptyLine, lynx: COLOR.primaryLight, shade: COLOR.skyDeep, catfish: COLOR.teamA, toad: COLOR.win, bomber: COLOR.lose,
  sleeper: COLOR.pink, acorn: COLOR.primaryDeep, yaksha: COLOR.cardRed, ferryman: COLOR.teamA, firecart: COLOR.lose,
};

/** 어려움 모드의 보스는 같은 그림에 붉은빛을 입힌다 (PRD: 어려움은 색 변형) */
export const HARD_BOSS_TINT = COLOR.pink;

/** 이 지형의 바닥 무늬: 지형 전용 무늬가 있으면 그것(320px 그대로 — 맵 너비 960 에 세 장), 없으면 시아디펜스 바닥 4종(512px 를 256px 로, 바닥색과 절반 섞기) */
export const floorOf = (region: number): { key: string; size: number; alpha: number } =>
  hasArt(floorArt(region)) ? { key: floorArt(region), size: 320, alpha: 1 } : { key: GROUND[regionOf(region).ground].tile, size: 256, alpha: 0.5 };

/** 이 맵에서 받을 기본 그림 이름 (요괴·보스·바닥·효과) */
export function artFor(map: MapDef): string[] {
  const kinds = new Set<EnemyKind>();
  for (const g of map.groups) {
    for (const [k] of g.list) kinds.add(k);
    if (g.elite) kinds.add(g.elite);
  }
  const names = [floorOf(map.region).key, 'fx-pop'];
  if (map.boss) {
    const b = BOSSES[bossIdOf(map)];
    names.push(b.art);
    kinds.add(b.summon.kind);
  }
  // 불러내는 요괴(뱃사공 망령)가 부르는 것의 그림도 받는다
  for (const k of [...kinds]) if (ENEMIES[k].call) kinds.add(ENEMIES[k].call!.kind);
  for (const k of kinds) names.push(ENEMIES[k].art);
  // 같은 그림을 돌려 쓰는 요괴가 있다
  return [...new Set(names)];
}
