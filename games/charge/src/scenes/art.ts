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
  | 'main'; // 메인 화면 그림

export const ART_FILES: readonly OptionalArt[] = ['gate', 'o-log', 'o-blade', 'o-pit', 'crate', 'h-water', 'h-bamboo', 'main'];

export const hasArt = (name: OptionalArt) => ART_FILES.includes(name);

/** 화면에 그리는 크기 (그림 파일은 이 2배). build.py 의 SIZES 와 같아야 한다 */
export const ART_SIZE: Record<OptionalArt, [number, number]> = {
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
