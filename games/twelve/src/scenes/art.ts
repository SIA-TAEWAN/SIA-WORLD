/**
 * 그림 목록 (ASSETS.md). 시아돌격대 art.ts 와 같은 방식:
 * 전용 그림을 public/art/<이름>.png 로 넣고 여기 ART_FILES 에 이름을 적으면 판이 그 그림을 쓰고, 없으면 코드 그림(또는 기존 그림)으로 그린다.
 * 파일을 넣지 않은 이름은 적지 않는다 (판마다 404 요청이 나간다).
 */
import { BOSSES } from '../data/bosses';
import { ENEMIES, type EnemyKind } from '../data/enemies';
import { HERO_IDS, type HeroId } from '../data/heroes';
import { bossIdOf, type MapDef } from '../data/maps';
import { regionOf, type Ground } from '../data/regions';
import { COLOR, MATGO, ROULETTE, TABLE } from '../theme';

export type OptionalArt =
  | `hero-${HeroId}` // 대원 시트: 가로 5칸(서기 · 걷기 A · 걷기 B · 공격 · 구르기) × 세로 3줄(앞 · 옆(오른쪽) · 뒤), 칸 HERO_FRAME
  | `e-${string}-elite` // 정예 전용 모습 (없으면 같은 그림을 크게)
  | `b-${string}-atk` // 보스 공격 동작: 가로 2칸 (예고 · 내려치기, 칸 BOSS_ATK_FRAME)
  | `wt-r${string}` // 지형 벽 오토타일셋 (dual-grid 15칸, 4x4 · 칸 TILESET_CELL) — 벽 가장자리가 모서리 · 곡선으로 이어진다
  | `st-${'water' | 'mud' | 'poison' | 'fire'}` // 느린 바닥 오토타일셋 (물 · 진흙 · 독 늪 · 불바닥)
  | `deco-r${string}` // 지형 장식 시트 (4x4 · 칸 DECO_CELL: 앞 8칸 바닥 장식 · 뒤 8칸 큰 장식)
  | `wall-r${string}` // 지형 벽 무늬 (이어 붙는 240px — 오토타일셋을 못 읽을 때의 예비)
  | `slow-${'water' | 'mud' | 'poison' | 'fire'}` // 느린 바닥 무늬 (물 · 진흙 · 독 늪 · 불바닥)
  | 'shop' // 상점 화면 그림
  | 'forge' // 대장간 화면 그림
  | `tiles-${number}` // 지형 전용 타일셋 (지금은 지형 바닥 무늬 + 코드 벽)
  | `floor-r${string}` // 지형 바닥 무늬 12종 (시아핑거의 지형 바닥과 같은 그림)
  | 'b-final' // 최종보스 어둑시니
  | 'chest' // 숨은 상자
  | 'exit' // 출구 (봉인 문) — 가로 2칸 (잠김 · 열림, 칸 EXIT_FRAME)
  | `fx-${'slash' | 'thrust' | 'spin' | 'rain' | 'wind' | 'poison' | 'bolt' | 'pool' | 'flame' | 'gust' | 'arrowfall' | 'claw' | 'shock'}` // 효과 (베기 · 찌르기 · 회전 · 화살 비 · 회오리 · 독안개 · 번개 · 독 웅덩이 · 불길 · 골바람 · 떨어지는 화살 · 할퀸 자국 · 충격 고리)
  | `p-${'arrow' | 'spear' | 'orb' | 'fire' | 'pollen' | 'burr' | 'foxorb'}` // 날아가는 것 (오른쪽을 본다)
  | `ic-${string}` // 장비 · 물약 · 스킬 아이콘 (ui/icons.ts)
  | 'main' // 메인 화면 그림
  | `story-${1 | 2 | 3 | 4}` // 시작 장면 그림 4장 (지금은 기존 그림을 모아 놓은 장면)
  | `ending-${1 | 2 | 3 | 4}` // 보통 모드 엔딩 그림 4장 (지금은 기존 그림을 모아 놓은 장면)
  | `finale-${1 | 2 | 3 | 4}` // 진짜 엔딩(어려움 최종보스) 그림 4장 (지금은 기존 그림을 모아 놓은 장면)
  | 'cat-scene'; // 고양이(13번째 대원) 등장 장면

/** 지형 바닥 무늬의 이름 (1 → floor-r01) */
export const floorArt = (region: number): OptionalArt => `floor-r${String(region).padStart(2, '0')}`;

/** 대원 시트 · 출구 시트의 한 칸 크기 (art/build.py 의 HERO · CELL 과 같다) */
export const HERO_FRAME = 192;
export const EXIT_FRAME = 180;
/** 대원 시트: 줄 = 앞(아래로 걷는다) · 옆(오른쪽) · 뒤(위로 걷는다), 칸 = 서기 · 걷기 A · 걷기 B · 공격 · 구르기. 칸 번호 = 줄 × HERO_COLS + 칸 */
export const HERO_COLS = 5;
export const HERO_ROWS = { front: 0, side: 1, back: 2 } as const;
export const HERO_FRAMES = { stand: 0, walkA: 1, walkB: 2, attack: 3, roll: 4 } as const;
/** 구르기 칸에서 공의 가운데 높이 (art/build.py 의 ROLL_CY ÷ HERO) — 이 점을 축으로 돌린다 */
export const HERO_ROLL_ORIGIN = 130 / 192;
/** 보스 공격 동작 시트의 한 칸 (art/build.py 의 BOSS_ATK) · 칸 = 예고 · 내려치기 */
export const BOSS_ATK_FRAME = 448;

/** 정예 전용 그림이 있는 요괴 (맵에서 정예로 나오는 아홉 종) */
const ELITE_KINDS: readonly EnemyKind[] = ['club', 'fox', 'water', 'bamboo', 'lynx', 'spirit', 'wisp', 'guard', 'skeleton'];
/** 정예의 그림 이름 (없으면 null — 보통 그림을 크게 쓴다) */
export const eliteArt = (kind: EnemyKind): string | null => (hasArt(`e-${kind}-elite`) ? `e-${kind}-elite` : null);
/** 보스 공격 동작 시트의 이름 (없으면 null) */
export const bossAtkArt = (art: string): string | null => (hasArt(`${art}-atk` as OptionalArt) ? `${art}-atk` : null);
/** 오토타일셋 · 장식 시트의 한 칸 (art/build.py 의 TS_CELL · DECO_CELL) */
export const TILESET_CELL = 120;
export const DECO_CELL = 128;
/**
 * dual-grid 15칸 타일셋: 그리는 타일은 칸 네 개가 만나는 꼭짓점에 놓이고, 둘레 네 칸이 찼는지로 칸을 고른다.
 * 비트 = 왼쪽 위 1 · 오른쪽 위 2 · 왼쪽 아래 4 · 오른쪽 아래 8 → 4x4 시트의 칸 번호 (SpriteCook 의 배치. 0 = 그리지 않음)
 */
export const DUAL_FRAME: readonly number[] = [-1, 15, 8, 9, 0, 11, 14, 7, 13, 4, 1, 10, 3, 2, 5, 6];
/** 바닥 장식으로 쓰지 않는 칸 (주울 것처럼 보이는 것: 10지형의 엽전) */
export const DECO_SKIP: Readonly<Record<number, readonly number[]>> = { 10: [6] };
const pad2 = (region: number) => String(region).padStart(2, '0');
/** 지형 벽 오토타일셋 · 느린 바닥 오토타일셋 · 장식 시트의 이름 (없으면 null) */
export const wallTiles = (region: number): string | null => (hasArt(`wt-r${pad2(region)}`) ? `wt-r${pad2(region)}` : null);
export const slowTiles = (region: number): string | null => {
  const env = regionOf(region).env;
  const n: OptionalArt = env === 'mud' ? 'st-mud' : env === 'poison' ? 'st-poison' : env === 'fire' ? 'st-fire' : 'st-water';
  return hasArt(n) ? n : null;
};
export const decoArt = (region: number): string | null => (hasArt(`deco-r${pad2(region)}`) ? `deco-r${pad2(region)}` : null);

/** 지형 벽 무늬 · 느린 바닥 무늬 (오토타일셋이 없을 때의 예비. 없으면 null — 바닥색과 코드 그림) */
export const wallArt = (region: number): string | null => {
  const n: OptionalArt = `wall-r${String(region).padStart(2, '0')}`;
  return hasArt(n) ? n : null;
};
export const slowArt = (region: number): string | null => {
  const env = regionOf(region).env;
  const n: OptionalArt = env === 'mud' ? 'slow-mud' : env === 'poison' ? 'slow-poison' : env === 'fire' ? 'slow-fire' : 'slow-water';
  return hasArt(n) ? n : null;
};

/** 판 안에서 낱장으로 받는 그림 (대원 · 출구 시트는 GameScene 이 따로 받는다) */
const PLAY_ART: readonly OptionalArt[] = [
  'chest', 'p-arrow', 'p-spear', 'p-orb', 'p-fire', 'p-pollen', 'p-burr', 'p-foxorb',
  'fx-slash', 'fx-thrust', 'fx-spin', 'fx-rain', 'fx-wind', 'fx-poison', 'fx-bolt', 'fx-pool', 'fx-flame', 'fx-gust', 'fx-arrowfall', 'fx-claw', 'fx-shock',
];
/** 땅에 떨어진 것을 그리는 아이콘 (판 안에서도 받는다 — GameScene 의 dropArt) */
export const DROP_ART: readonly OptionalArt[] = (
  ['sword', 'spear', 'bow', 'fan', 'armor', 'acc-mp', 'acc-speed', 'acc-crit', 'acc-potion', 'acc-coin', 'star', 'hp', 'mp', 'stone', 'key'] as const
).map((n): OptionalArt => `ic-${n}`);
const WEAPON_ICONS = ['sword', 'spear', 'bow', 'fan'] as const;
const ICON_ART: readonly OptionalArt[] = [
  ...DROP_ART,
  ...(['coin', 'roll', 'sk-triple', 'sk-dash', 'sk-spin', 'sk-throw', 'sk-rain', 'sk-fork', 'sk-tornado', 'sk-bolt'] as const).map((n): OptionalArt => `ic-${n}`),
  // 고유 스킬 13 · 무기 등급별 4 × 12
  ...HERO_IDS.map((id): OptionalArt => `ic-u-${id}`),
  ...WEAPON_ICONS.flatMap((k) => Array.from({ length: 12 }, (_, t): OptionalArt => `ic-w-${k}-${t}`)),
];
const SCENE_ART: readonly OptionalArt[] = ([1, 2, 3, 4] as const).flatMap((i): OptionalArt[] => [`story-${i}`, `ending-${i}`, `finale-${i}`]);
const TILE_ART: readonly OptionalArt[] = [
  ...Array.from({ length: 12 }, (_, i): OptionalArt => `wall-r${String(i + 1).padStart(2, '0')}`),
  'slow-water', 'slow-mud', 'slow-poison', 'slow-fire',
  ...Array.from({ length: 12 }, (_, i): OptionalArt => `wt-r${String(i + 1).padStart(2, '0')}`),
  'st-water', 'st-mud', 'st-poison', 'st-fire',
  ...Array.from({ length: 12 }, (_, i): OptionalArt => `deco-r${String(i + 1).padStart(2, '0')}`),
];

export const ART_FILES: readonly OptionalArt[] = [
  'b-final',
  ...Array.from({ length: 12 }, (_, i) => floorArt(i + 1)),
  ...HERO_IDS.map((id): OptionalArt => `hero-${id}`),
  'exit',
  ...PLAY_ART,
  ...ICON_ART,
  ...SCENE_ART,
  'cat-scene',
  'main',
  'shop',
  'forge',
  ...TILE_ART,
  ...ELITE_KINDS.map((k): OptionalArt => `e-${k}-elite`),
  ...[...Object.values(BOSSES).map((b) => b.art)].map((a) => `${a}-atk` as OptionalArt),
];
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

/** 기존 그림을 돌려 쓰는 요괴의 색 (전용 그림이 없는 요괴가 생기면 여기에 적는다 — 지금은 스무 종 모두 전용 그림이 있다) */
export const ENEMY_TINT: Partial<Record<EnemyKind, number>> = {};

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
  const names: string[] = [floorOf(map.region).key, 'fx-pop', ...PLAY_ART.filter(hasArt), ...DROP_ART.filter(hasArt)];
  // 벽 · 느린 바닥: 오토타일셋이 있으면 그것만, 없으면 이어 붙는 무늬. 장식 시트는 있으면 받는다
  for (const n of [wallTiles(map.region) ?? wallArt(map.region), slowTiles(map.region) ?? slowArt(map.region), decoArt(map.region)]) if (n) names.push(n);
  // 정예 전용 모습
  for (const g of map.groups) {
    const e = g.elite ? eliteArt(g.elite) : null;
    if (e) names.push(e);
  }
  if (map.boss) {
    const b = BOSSES[bossIdOf(map)];
    names.push(b.art);
    kinds.add(b.summon.kind);
  }
  // 불러내는 요괴(뱃사공 망령)가 부르는 것의 그림도 받는다
  for (const k of [...kinds]) if (ENEMIES[k].call) kinds.add(ENEMIES[k].call!.kind);
  for (const k of kinds) names.push(ENEMIES[k].art);
  return [...new Set(names)];
}
