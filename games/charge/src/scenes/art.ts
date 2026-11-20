/**
 * 시아돌격대 전용 그림 목록 (ASSETS.md 2장).
 * SpriteCook 으로 만든 원본을 art/<이름>.png 에 두고 `python art/build.py` 로 public/art/<이름>.png 를 만든 다음
 * 여기 ART_FILES 에 이름을 적으면, 판이 그 그림을 쓰고 없을 때만 코드 그림으로 그린다 (시아디펜스와 같은 방식).
 * 파일을 넣지 않은 이름은 적지 않는다 (판마다 404 요청이 나간다).
 */
export type OptionalArt =
  | 'gate' // 숫자 문 틀 (흰 바탕 · 코드가 파랑/빨강으로 물들이고 늘여 쓴다)
  | 'o-log' // 굴러가는 통나무
  | 'o-blade' // 회전 칼날 (코드가 돌린다)
  | 'o-pit' // 구덩이
  | 'crate' // 상자
  | 'h-water' // 물귀신이 숨은 물웅덩이
  | 'h-bamboo' // 죽순 요괴가 숨은 흙더미
  | 'main' // 메인 화면 그림
  | `road-${GroundName}` // 이어 붙이는 길 바닥 (지역 바닥마다 1장)
  | `d-${GroundName}-${1 | 2}` // 길가 장식 (지역 바닥마다 2종)
  | 'fx-fire'; // 강철이 불길

/** 지역 바닥 이름 (data/growth.ts 의 Ground 와 같다) */
export type GroundName = 'field' | 'bamboo' | 'palace' | 'underworld';

export const ART_FILES: readonly OptionalArt[] = [
  'gate', 'o-log', 'o-blade', 'o-pit', 'crate', 'h-water', 'h-bamboo', 'main',
  'road-field', 'road-bamboo', 'road-palace', 'road-underworld',
  'd-field-1', 'd-field-2', 'd-bamboo-1', 'd-bamboo-2', 'd-palace-1', 'd-palace-2', 'd-underworld-1', 'd-underworld-2',
  'fx-fire',
];

/** 이번 판(지역 바닥)에 받을 그림: 다른 지역의 길·장식과 메인 그림은 받지 않는다 */
export const artFor = (ground: GroundName) =>
  ART_FILES.filter((n) => n !== 'main' && (!(n.startsWith('road-') || n.startsWith('d-')) || n === `road-${ground}` || n.startsWith(`d-${ground}-`)));

export const hasArt = (name: OptionalArt) => ART_FILES.includes(name);

/** 화면에 그리는 크기 (그림 파일은 이 2배). build.py 의 SIZES · TILES 와 같아야 한다 */
export const ART_SIZE: Record<OptionalArt, [number, number]> = {
  'road-field': [256, 256],
  'road-bamboo': [256, 256],
  'road-palace': [256, 256],
  'road-underworld': [256, 256],
  'd-field-1': [80, 80],
  'd-field-2': [80, 80],
  'd-bamboo-1': [80, 80],
  'd-bamboo-2': [80, 80],
  'd-palace-1': [80, 80],
  'd-palace-2': [80, 80],
  'd-underworld-1': [80, 80],
  'd-underworld-2': [80, 80],
  'fx-fire': [64, 76],
  gate: [128, 70],
  'o-log': [140, 52],
  'o-blade': [120, 120],
  'o-pit': [180, 70],
  crate: [92, 74],
  'h-water': [200, 70],
  'h-bamboo': [200, 50],
  main: [540, 300],
};

/** 문 틀 늘이기 여백 (그림 파일 기준 px) */
export const GATE_SLICE = 28;
