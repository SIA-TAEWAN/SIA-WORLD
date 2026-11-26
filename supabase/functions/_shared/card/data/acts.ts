/**
 * 막·지역 데이터 (games/card/src/data/acts.json 과 같은 내용). 지역 이름·보스·요괴·그림은 PRD 사용자 스펙 그대로.
 * easy/normal 전투 조합은 스펙에 없어 정한 값. ready = 이번 단계에서 들어갈 수 있는 지역 (2단계: 대나무숲).
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
  { id: 'field', name: '들판', tile: 'tile-field', bg: 'bg-field', ready: false, bosses: ['bigDokkaebi', 'bulgasal', 'gangcheori'], enemies: ['club', 'imp', 'wisp', 'firecart'], easy: [], normal: [] },
  { id: 'palace', name: '궁궐', tile: 'tile-palace', bg: 'bg-palace', ready: false, bosses: ['guardCaptain', 'dueoksini', 'imugi'], enemies: ['guard', 'spirit', 'water', 'catfish'], easy: [], normal: [] },
  { id: 'underworld', name: '저승', tile: 'tile-underworld', bg: 'bg-underworld', ready: false, bosses: ['reaper', 'yagwanggwi', 'yeomra'], enemies: ['skeleton', 'ferryman', 'spirit', 'bomber'], easy: [], normal: [] },
];

export const ACTS: ActDef[] = [
  { act: 1, regions: ['bamboo', 'field'] },
  { act: 2, regions: ['palace'] },
  { act: 3, regions: ['underworld'] },
];

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
