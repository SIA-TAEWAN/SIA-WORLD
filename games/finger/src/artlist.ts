import type { HeroId } from './sim';

/**
 * 시아핑거 전용 그림 자리 (ASSETS.md "전용 그림 자리"). 시아돌격대 `src/scenes/art.ts` 의 ART_FILES 와 같은 방식:
 * SpriteCook 으로 만든 그림을 public/art/<이름>.png 로 넣고 **여기 ART_FILES 에 이름을 적으면** 게임이 그 그림을 쓴다.
 * 적지 않은 이름은 아예 받지 않고(404 요청·콘솔 오류 없음) 지금의 코드 그림·있는 그림으로 그린다.
 * 적었는데 파일을 못 읽었을 때도 같은 대체 그림으로 그린다 (판은 텍스처가 있는지 보고 고른다).
 * `tests/feel.test.ts` 가 여기 적은 이름마다 public/art 에 파일이 있는지 확인한다.
 *
 * 이 파일은 Phaser 를 쓰지 않는다 (테스트와 판 밖 화면에서도 읽는다).
 */

/** 지역 바닥 이름 (data/regions.ts 의 groundOf 와 같다) */
export type GroundName = 'field' | 'bamboo' | 'palace' | 'underworld';

export type OptionalArt =
  | `h-${HeroId}` // 구슬형 대원 12종 (아래 파티 줄. 판 위는 십이지 전신 그림 — 못 읽을 때만 판에도)
  | `cut-${HeroId}` // 필살기 컷인 12종 (판을 열 때 받지 않고 필살기가 가까워지면 그 대원 것만 — GameScene.fetchArt)
  | `floor-r${string}` // 지역 12곳의 방 바닥 (floor-r01 … floor-r12, 이어 붙는 무늬 320px)
  | `${string}-hit` // 요괴·보스 맞을 때 표정 (요괴 그림 이름 + -hit, 예: e-imp-hit · b-yeomra-hit)
  | `wall-${GroundName}` // 방 테두리·벽 (지역 바닥마다 1장, 늘여 씀)
  | 'o-block' // 네모 돌기둥 (늘여 씀)
  | 'o-pillar' // 둥근 돌기둥
  | 'o-thorn' // 가시밭 (늘여 씀)
  | 'o-board' // 빨래판 (늘여 씀)
  | 'o-portal' // 순간이동 구멍 (흰 그림 · 코드가 짝마다 물들이고 돌린다)
  | 'fx-laser' // 레이저 한 토막 (가로 레이저 · 분홍, 늘여 씀)
  | 'fx-laser-v' // 세로 레이저 (fx-laser 를 파랑으로 바꾼 것)
  | 'fx-boom' // 폭발 (땅 울림)
  | 'fx-heal' // 회복
  | 'fx-shield' // 보호막
  | 'fx-poison' // 독 방울
  | 'fx-fang' // 이빨
  | 'fx-ball' // 튕김 구슬
  | 'main' // 메인 화면 그림
  | `bg-${GroundName | 'tower'}` // 판 밖 화면 배경·지역 카드 그림 (지역 바닥 4종 + 끝없는 탑)
  | `ui-${'go' | 'heroes' | 'tower' | 'rank' | 'up'}`; // 메인 메뉴 버튼 아이콘

const HERO_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const satisfies readonly HeroId[];
const GROUNDS = ['field', 'bamboo', 'palace', 'underworld'] as const satisfies readonly GroundName[];
const HIT_FOES = [
  ...['e-imp', 'e-wisp', 'e-club', 'e-water', 'e-fox', 'e-bamboo', 'e-guard', 'e-skeleton', 'e-spirit'],
  // 보스 12종 (지역 순서)
  ...['b-bigDokkaebi', 'b-dueoksini', 'b-bulgasal', 'b-jangsanbeom', 'b-centipede', 'b-gumiho'],
  ...['b-guardCaptain', 'b-yagwanggwi', 'b-imugi', 'b-reaper', 'b-gangcheori', 'b-yeomra'],
] as const;
const REGION_COUNT = 12;

/** 지역의 방 바닥 그림 이름 (1 → floor-r01) */
export const floorOf = (region: number) => `floor-r${String(Math.min(REGION_COUNT, Math.max(1, region))).padStart(2, '0')}` as const;

/** 넣은 그림 이름. 파일을 넣지 않은 이름은 적지 않는다 */
export const ART_FILES: readonly OptionalArt[] = [
  ...HERO_IDS.map((h) => `h-${h}` as const),
  ...HERO_IDS.map((h) => `cut-${h}` as const),
  ...HIT_FOES.map((f) => `${f}-hit` as const),
  ...Array.from({ length: REGION_COUNT }, (_, i) => floorOf(i + 1)),
  ...GROUNDS.map((g) => `wall-${g}` as const),
  'o-block',
  'o-pillar',
  'o-thorn',
  'o-board',
  'o-portal',
  'fx-laser',
  'fx-laser-v',
  'fx-boom',
  'fx-heal',
  'fx-shield',
  'fx-poison',
  'fx-fang',
  'fx-ball',
  'main',
  ...GROUNDS.map((g) => `bg-${g}` as const),
  'bg-tower',
  'ui-go',
  'ui-heroes',
  'ui-tower',
  'ui-rank',
  'ui-up',
];

export const hasArt = (name: OptionalArt) => ART_FILES.includes(name);

/**
 * 9칸으로 이어 붙이는 그림 (art/build.py 의 SLICES 와 같아야 한다): [모서리 b · 변 E] (그림 파일 px).
 * 파일 한 장에 [모서리 b][틈 4][변 E][틈 4][모서리 b] 가로세로로 놓여 있고, 판은 변·가운데를 늘이지 않고 되풀이해 붙인다
 * (`src/scenes/art.ts` 의 tiled9). 그림 파일은 화면의 2배 크기.
 */
export const ART_SLICE: Partial<Record<OptionalArt, readonly [number, number]>> = {
  'wall-field': [88, 128],
  'wall-bamboo': [88, 128],
  'wall-palace': [88, 128],
  'wall-underworld': [88, 128],
  'o-block': [28, 72],
  'o-thorn': [40, 160],
  'o-board': [48, 128],
};
/** 9칸 그림의 칸 사이 틈 (px) */
export const SLICE_GAP = 4;
/** 방 테두리: 벽 안쪽 선이 그림 바깥 가장자리에서 이만큼 (그림 파일 px, 화면에서는 반) */
export const WALL_INSET = 64;

/**
 * 판을 열 때 받을 전용 그림: 데려간 대원의 구슬, 나오는 요괴·보스의 맞는 표정, 쓰는 바닥의 방 테두리, 첫 방의 바닥, 장애물·효과.
 * 필살기 컷인(cut-*)과 끝없는 탑의 다음 지역 바닥은 판이 열린 뒤 쓸 때가 되면 받는다 (GameScene.fetchArt — 아이폰 메모리).
 * 메인 그림·화면 배경(bg-*)·메뉴 아이콘(ui-*)은 판에서 받지 않는다.
 */
export function artFor(heroes: readonly HeroId[], foeArts: readonly string[], grounds: readonly GroundName[], regions: readonly number[] = []): OptionalArt[] {
  const want = new Set<string>();
  for (const id of heroes) want.add(`h-${id}`);
  for (const a of foeArts) want.add(`${a}-hit`);
  for (const g of grounds) want.add(`wall-${g}`);
  for (const r of regions) want.add(floorOf(r));
  return ART_FILES.filter((n) => want.has(n) || n.startsWith('o-') || n.startsWith('fx-'));
}
