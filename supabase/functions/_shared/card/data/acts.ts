/**
 * 막·지역 데이터 (games/card/src/data/acts.json 과 같은 내용). 지역 이름·보스·요괴·그림은 PRD 사용자 스펙 그대로.
 * easy/normal 전투 조합은 스펙에 없어 정한 값. 1막은 대나무숲·들판 중 무작위, 2막 궁궐, 3막 저승, 숨은 4막 어둠의 끝(어둑시니).
 */
import type { ActDef, NodeType, RegionDef } from '../types.ts';

export const REGIONS: RegionDef[] = [
  {
    id: 'bamboo', name: '대나무숲', tile: 'tile-bamboo', bg: 'bg-bamboo', ready: true,
    bosses: ['gumiho', 'jangsanbeom', 'centipede'],
    enemies: ['bamboo', 'fox', 'acorn', 'lynx'],
    easy: [['fox'], ['bamboo'], ['acorn', 'acorn']],
    normal: [['lynx'], ['fox', 'acorn'], ['bamboo', 'acorn'], ['acorn', 'acorn', 'acorn'], ['fox', 'fox'], ['bamboo', 'fox'], ['lynx', 'acorn']],
  },
  {
    id: 'field', name: '들판', tile: 'tile-field', bg: 'bg-field', ready: true,
    bosses: ['bigDokkaebi', 'bulgasal', 'gangcheori'],
    enemies: ['club', 'imp', 'wisp', 'firecart'],
    easy: [['imp', 'imp'], ['wisp'], ['club']],
    normal: [['firecart'], ['club', 'imp'], ['wisp', 'wisp'], ['imp', 'imp', 'imp'], ['club', 'wisp'], ['firecart', 'imp'], ['wisp', 'imp']],
  },
  {
    id: 'palace', name: '궁궐', tile: 'tile-palace', bg: 'bg-palace', ready: true,
    bosses: ['guardCaptain', 'dueoksini', 'imugi'],
    enemies: ['guard', 'spirit', 'water', 'catfish'],
    easy: [['spirit'], ['water'], ['guard']],
    normal: [['catfish'], ['guard', 'spirit'], ['water', 'spirit'], ['guard', 'water'], ['spirit', 'spirit'], ['water', 'water'], ['catfish', 'spirit']],
  },
  {
    id: 'underworld', name: '저승', tile: 'tile-underworld', bg: 'bg-underworld', ready: true,
    bosses: ['reaper', 'yagwanggwi', 'yeomra'],
    enemies: ['skeleton', 'ferryman', 'spirit3', 'bomber'],
    easy: [['skeleton'], ['ferryman'], ['spirit3', 'bomber']],
    normal: [['skeleton', 'spirit3'], ['ferryman', 'bomber'], ['skeleton', 'bomber'], ['spirit3', 'spirit3'], ['ferryman', 'spirit3'], ['skeleton', 'skeleton'], ['bomber', 'bomber', 'spirit3']],
  },
  /** 숨은 4막: 지도 없이 어둑시니 한 칸 (그림은 저승 것을 쓴다) */
  { id: 'abyss', name: '어둠의 끝', tile: 'tile-underworld', bg: 'bg-underworld', ready: true, hidden: true, bosses: ['final'], enemies: [], easy: [], normal: [] },
];

export const ACTS: ActDef[] = [
  { act: 1, regions: ['bamboo', 'field'] },
  { act: 2, regions: ['palace'] },
  { act: 3, regions: ['underworld'] },
  /** 숨은 4막: 한 판에서 정예 3마리 이상 + 3막 클리어 → 어둑시니만 한 번 */
  { act: 4, regions: ['abyss'], hidden: true },
];

/** 4막(어둑시니)이 열리는 정예 수 */
export const FINAL_ELITES = 3;
/** 막마다 앞쪽 몇 번의 일반 전투는 쉬운 조합 (1막 3번, 그 뒤 2번) */
export const EASY_BATTLES = [3, 2, 2];

/** 칸 비율 (%) — 스펙: 전투 45 · 정예 10 · 상점 10 · 쉼터 12 · 보물 8 · 이야기 15 */
export const NODE_RATIO: [NodeType, number][] = [
  ['battle', 45],
  ['elite', 10],
  ['shop', 10],
  ['rest', 12],
  ['treasure', 8],
  ['event', 15],
];

/** 막당 줄 수 (보스 칸 제외), 한 줄 칸 수 */
export const ROWS_PER_ACT = 12;
export const ROW_WIDTH: [number, number] = [2, 4];

/** 엽전 보상 (스펙) */
export const GOLD = { battle: [12, 18], elite: [25, 35], boss: [60, 60] } as const;
/** 카드 보상 등급 확률 (스펙: 일반 60 · 고급 33 · 전설 7) */
export const CARD_ODDS: [string, number][] = [
  ['common', 60],
  ['uncommon', 33],
  ['legend', 7],
];
/** 까치 깃털: '고급 이상이 더 자주' — 정한 값 */
export const CARD_ODDS_MAGPIE: [string, number][] = [
  ['common', 45],
  ['uncommon', 43],
  ['legend', 12],
];
/** 상점 가격 (스펙 범위 안에서 등급별로 정함): 카드 50~150 · 부적 150~300 · 카드 없애기 75(+25) */
export const PRICES = {
  card: { common: [50, 70], uncommon: [80, 110], hero2: [80, 110], legend: [130, 150] },
  relic: { common: [150, 200], uncommon: [220, 300] },
  potion: [40, 60],
  remove: 75,
  removeStep: 25,
} as const;
