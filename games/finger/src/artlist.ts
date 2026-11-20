import type { HeroId } from './sim';

/**
 * 시아핑거 전용 그림 자리 (ASSETS.md "전용 그림 자리"). 시아돌격대 `src/scenes/art.ts` 의 ART_FILES 와 같은 방식:
 * SpriteCook 으로 만든 그림을 public/art/<이름>.png 로 넣고 **여기 ART_FILES 에 이름을 적으면** 게임이 그 그림을 쓴다.
 * 적지 않은 이름은 아예 받지 않고(404 요청·콘솔 오류 없음) 지금의 코드 그림·있는 그림으로 그린다.
 * 적었는데 파일을 못 읽었을 때도 같은 대체 그림으로 그린다 (판은 텍스처가 있는지 보고 고른다).
 * `tests/art.test.ts` 가 여기 적은 이름마다 public/art 에 파일이 있는지 확인한다.
 *
 * 이 파일은 Phaser 를 쓰지 않는다 (테스트와 판 밖 화면에서도 읽는다).
 */

/** 지역 바닥 이름 (data/regions.ts 의 groundOf 와 같다) */
export type GroundName = 'field' | 'bamboo' | 'palace' | 'underworld';

export type OptionalArt =
  | `h-${HeroId}` // 구슬형 대원 12종 (아래 파티 줄. 판 위는 십이지 전신 그림 — 못 읽을 때만 판에도)
  | `cut-${HeroId}` // 필살기 컷인 12종
  | `${string}-hit` // 요괴·보스 맞을 때 표정 (요괴 그림 이름 + -hit, 예: e-imp-hit · b-yeomra-hit)
  | `wall-${GroundName}` // 방 테두리·벽 (지역 바닥마다 1장, 늘여 씀)
  | 'o-block' // 네모 돌기둥 (늘여 씀)
  | 'o-pillar' // 둥근 돌기둥
  | 'o-thorn' // 가시밭 (늘여 씀)
  | 'o-board' // 빨래판 (늘여 씀)
  | 'o-portal' // 순간이동 구멍 (흰 그림 · 코드가 짝마다 물들이고 돌린다)
  | 'fx-laser' // 레이저 한 토막 (가로, 늘여 씀)
  | 'fx-boom' // 폭발 (땅 울림)
  | 'fx-heal' // 회복
  | 'fx-shield' // 보호막
  | 'fx-poison' // 독 방울
  | 'fx-fang' // 이빨
  | 'fx-ball' // 튕김 구슬
  | 'main'; // 메인 화면 그림

/** 넣은 그림 이름. 파일을 넣지 않은 이름은 적지 않는다 */
export const ART_FILES: readonly OptionalArt[] = [];

export const hasArt = (name: OptionalArt) => ART_FILES.includes(name);

/** 늘여 쓰는 그림의 가장자리 여백 (그림 파일 기준 px) */
export const ART_SLICE: Partial<Record<OptionalArt, number>> = {
  'wall-field': 64,
  'wall-bamboo': 64,
  'wall-palace': 64,
  'wall-underworld': 64,
  'o-block': 28,
  'o-thorn': 24,
  'o-board': 24,
};

/**
 * 이번 판에 받을 전용 그림: 데려간 대원의 구슬·컷인, 나오는 요괴의 맞는 표정, 쓰는 바닥의 방 테두리, 장애물·효과.
 * 메인 그림은 판에서 받지 않는다.
 */
export function artFor(heroes: readonly HeroId[], foeArts: readonly string[], grounds: readonly GroundName[]): OptionalArt[] {
  const want = new Set<string>();
  for (const id of heroes) want.add(`h-${id}`).add(`cut-${id}`);
  for (const a of foeArts) want.add(`${a}-hit`);
  for (const g of grounds) want.add(`wall-${g}`);
  return ART_FILES.filter((n) => n !== 'main' && (want.has(n) || n.startsWith('o-') || n.startsWith('fx-')));
}
