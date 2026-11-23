import type { ResId } from './balance';

/**
 * 건물 · 장식물 · 길 (PRD 5장). SQL 의 _village_types 와 같아야 한다 (tests/sql.test.ts).
 * 표를 고치면 `npm run sqlrows` 로 SQL 줄을 뽑아 새 마이그레이션에 넣는다.
 *   main    일반 건물 (업그레이드 최대 10레벨)
 *   special 특별 건물 (시아코인으로 사고 하나씩만. 업그레이드는 일반 자원)
 *   deco    장식물 (엽전. 업그레이드 없음, 번영도 점수)
 *   road    길 (엽전. 꾸미기용)
 */
export type BuildingKind = 'main' | 'special' | 'deco' | 'road';

export const BUILDING_IDS = [
  'hall', 'paddy', 'house', 'lumber', 'storage', 'market', 'quarry', 'mill', 'jar',
  'pavilion', 'feast', 'shrine',
  'tree', 'haystack', 'flower', 'scarecrow', 'stonewall', 'bench', 'lantern', 'well', 'jangseung', 'sotdae', 'pond', 'stonetower',
  'road',
  // 주민이 친밀도 선물로 주는 전용 장식물 (지을 수 없다: 보관함으로 들어온다)
  'gift_rat', 'gift_ox', 'gift_tiger', 'gift_rabbit', 'gift_dragon', 'gift_snake', 'gift_horse', 'gift_sheep', 'gift_monkey', 'gift_rooster', 'gift_dog', 'gift_pig', 'gift_cat',
  // 기념물: 다른 게임의 성과로 열린다 (지을 수 없다: 보관함으로 들어온다. 조건은 monuments.ts)
  'mon_tank1', 'mon_tank10', 'mon_volley1', 'mon_volley10', 'mon_race1', 'mon_race2', 
  'mon_surv_field', 'mon_surv_bamboo', 'mon_surv_palace', 'mon_surv_underworld', 'mon_def3', 'mon_def6', 'mon_def9', 'mon_def12', 'mon_matgo', 'mon_casino',
  'mon_charge30', 'mon_charge100', 'mon_charge_road', 'mon_finger30', 'mon_finger100', 'mon_finger_tower',
] as const;
export type BuildingType = (typeof BUILDING_IDS)[number];

export interface BuildingDef {
  id: BuildingType;
  kind: BuildingKind;
  name: string;
  desc: string;
  /** 차지하는 칸 */
  w: number;
  h: number;
  /** 짓는 값 (쌀 · 나무는 업그레이드 값의 기준이기도 하다) */
  rice: number;
  wood: number;
  stone: number;
  coin: number;
  /** 시아코인 (특별 건물) */
  sia: number;
  /** 업그레이드에 드는 돌의 기준 (건물 레벨 stone_from 부터 든다) */
  upStone: number;
  /** 짓는 시간 (초). 0 이면 바로 놓인다 (건설 슬롯을 쓰지 않는다) */
  buildSec: number;
  /** 시간에 따라 만드는 자원과 레벨 1의 시간당 생산량 (아니면 null · 0) */
  product: ResId | null;
  rate: number;
  /** 다 지었을 때의 경험치 */
  buildExp: number;
  /** 0 이면 unlock 의 길이가 최대 개수, 아니면 unlock[0] 레벨부터 이 개수까지 */
  cap: number;
  /** 번영도 점수 (장식물. 계산은 7단계) */
  points: number;
  /** n번째가 열리는 마을 레벨 */
  unlock: number[];
}

type Row = [BuildingType, BuildingKind, string, string, number, number, number, number, number, number, number, number, number, ResId | null, number, number, number, number, number[]];
//  id, kind, 이름, 설명, w, h, 쌀, 나무, 돌, 엽전, 시아코인, 업그레이드 돌, 짓는 시간, 생산 자원, 시간당, 경험치, 개수, 번영도, 해금
const ROWS: Row[] = [
  ['hall', 'main', '마을 회관', '마을의 중심. 레벨을 올리면 다른 건물의 최대 레벨과 창고 용량이 늘어요', 2, 2, 40, 40, 0, 0, 0, 30, 0, null, 0, 0, 0, 0, [1]],
  ['paddy', 'main', '논', '쌀을 만들어요', 1, 1, 5, 10, 0, 0, 0, 5, 10, 'rice', 60, 10, 0, 0, [1, 1, 3, 5, 7, 10, 13, 17]],
  ['house', 'main', '주민 집', '주민 한 명이 살 집. 지으면 십이지가 이사 와요', 1, 1, 10, 20, 0, 0, 0, 5, 30, null, 0, 15, 0, 0, [1, 2, 3, 5, 7, 9, 11, 13, 15, 18, 21, 24]],
  ['lumber', 'main', '벌목장', '나무를 만들어요', 1, 1, 30, 10, 0, 0, 0, 5, 20, 'wood', 40, 12, 0, 0, [2, 2, 4, 6, 8, 11, 14, 18]],
  ['storage', 'main', '창고', '쌀·나무·돌·떡을 더 많이 보관해요', 1, 1, 30, 40, 0, 0, 0, 10, 60, null, 0, 20, 0, 0, [2, 4, 7, 10, 14, 18]],
  ['market', 'main', '장터', '자원을 엽전으로 팔아요. 시세는 날마다 바뀌어요', 1, 1, 60, 60, 0, 0, 0, 10, 120, null, 0, 30, 0, 0, [3]],
  ['quarry', 'main', '채석장', '돌을 만들어요', 1, 1, 50, 50, 0, 0, 0, 5, 60, 'stone', 30, 25, 0, 0, [4, 4, 6, 9, 12, 16, 20]],
  ['mill', 'main', '방앗간', '쌀을 찧어 떡을 만들어요', 1, 1, 40, 80, 20, 0, 0, 10, 180, null, 0, 40, 0, 0, [5, 8, 12, 16]],
  ['jar', 'main', '장독대', '떡과 쌀을 오래 묵혀 비싼 특산품을 만들어요', 1, 1, 0, 100, 60, 50, 0, 15, 300, null, 0, 60, 0, 0, [8, 12, 17]],
  ['pavilion', 'special', '정자', '둘레의 생산 건물이 더 많이 만들어요', 2, 2, 100, 100, 0, 0, 20, 20, 600, null, 0, 150, 0, 20, [6]],
  ['feast', 'special', '잔치 마당', '떡을 모아 잔치를 열면 하루 동안 마을 전체의 생산이 늘어요', 2, 2, 150, 150, 50, 0, 40, 20, 1800, null, 0, 300, 0, 40, [10]],
  ['shrine', 'special', '십이지 사당', '마을의 상징. 주민 친밀도가 더 빨리 오르고 번영도가 크게 올라요', 2, 2, 200, 200, 100, 0, 60, 30, 3600, null, 0, 600, 0, 80, [14]],
  ['tree', 'deco', '나무', '마을에 그늘을 드리워요', 1, 1, 0, 0, 0, 20, 0, 0, 0, null, 0, 2, 12, 1, [1]],
  ['haystack', 'deco', '볏가리', '가을걷이의 흔적', 1, 1, 0, 0, 0, 50, 0, 0, 0, null, 0, 4, 6, 2, [2]],
  ['flower', 'deco', '꽃밭', '알록달록한 꽃밭', 1, 1, 0, 0, 0, 30, 0, 0, 0, null, 0, 2, 12, 1, [2]],
  ['scarecrow', 'deco', '허수아비', '논을 지키는 허수아비', 1, 1, 0, 0, 0, 60, 0, 0, 0, null, 0, 4, 4, 2, [3]],
  ['stonewall', 'deco', '돌담', '낮게 쌓은 돌담', 1, 1, 0, 0, 0, 40, 0, 0, 0, null, 0, 4, 16, 2, [3]],
  ['bench', 'deco', '평상', '둘러앉아 쉬는 평상', 1, 1, 0, 0, 0, 300, 0, 0, 0, null, 0, 8, 4, 4, [4]],
  ['lantern', 'deco', '등불', '밤이면 마을을 밝혀요', 1, 1, 0, 0, 0, 150, 0, 0, 0, null, 0, 6, 8, 3, [5]],
  ['well', 'deco', '우물', '맑은 물이 솟는 우물', 1, 1, 0, 0, 0, 1000, 0, 0, 0, null, 0, 12, 2, 8, [6]],
  ['jangseung', 'deco', '장승', '마을 어귀를 지키는 장승', 1, 1, 0, 0, 0, 600, 0, 0, 0, null, 0, 10, 4, 6, [7]],
  ['sotdae', 'deco', '솟대', '풍년을 비는 솟대', 1, 1, 0, 0, 0, 2000, 0, 0, 0, null, 0, 12, 4, 10, [8]],
  ['pond', 'deco', '연못', '연꽃이 핀 작은 연못', 1, 1, 0, 0, 0, 4000, 0, 0, 0, null, 0, 16, 2, 13, [9]],
  ['stonetower', 'deco', '돌탑', '소원을 담아 쌓은 돌탑', 1, 1, 0, 0, 0, 8000, 0, 0, 0, null, 0, 20, 2, 18, [12]],
  ['road', 'road', '길', '건물 사이를 잇는 길', 1, 1, 0, 0, 0, 5, 0, 0, 0, null, 0, 0, 80, 0, [1]],
  ['gift_rat', 'deco', '찍찍이의 쌀독', '찍찍이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_ox', 'deco', '우직이의 쟁기', '우직이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_tiger', 'deco', '어흥이의 바위', '어흥이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_rabbit', 'deco', '깡총이의 절구', '깡총이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_dragon', 'deco', '여의룡의 여의주', '여의룡이 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_snake', 'deco', '스르르의 약초밭', '스르르가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_horse', 'deco', '따각이의 수레', '따각이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_sheep', 'deco', '몽실이의 솜사탕 나무', '몽실이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_monkey', 'deco', '재롱이의 그네', '재롱이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_rooster', 'deco', '꼬꼬댁의 횃대', '꼬꼬댁이 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_dog', 'deco', '멍뭉이의 집', '멍뭉이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_pig', 'deco', '꿀꿀이의 복주머니', '꿀꿀이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['gift_cat', 'deco', '야옹이의 금관 방석', '야옹이가 준 선물', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 12, [99]],
  ['mon_tank1', 'deco', '낡은 대포', '시아탱크 첫 승리 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 20, [99]],
  ['mon_tank10', 'deco', '황금 대포', '시아탱크 10승 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 40, [99]],
  ['mon_volley1', 'deco', '배구 네트', '시아배구 첫 승리 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 20, [99]],
  ['mon_volley10', 'deco', '우승 깃발', '시아배구 10승 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 40, [99]],
  ['mon_race1', 'deco', '출발선 깃발', '시아레이스 완주 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 20, [99]],
  ['mon_race2', 'deco', '결승선 아치', '시아레이스 기록 도전 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 30, [99]],
  ['mon_surv_field', 'deco', '도깨비 석상', '들판을 지켜 낸 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 25, [99]],
  ['mon_surv_bamboo', 'deco', '구미호 석상', '대나무 숲을 지켜 낸 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 30, [99]],
  ['mon_surv_palace', 'deco', '이무기 석상', '달빛 궁궐을 지켜 낸 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 40, [99]],
  ['mon_surv_underworld', 'deco', '염라 석상', '황천길을 지켜 낸 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 50, [99]],
  ['mon_def3', 'deco', '망루', '시아디펜스 3지역 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 25, [99]],
  ['mon_def6', 'deco', '성문', '시아디펜스 6지역 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 35, [99]],
  ['mon_def9', 'deco', '누각', '시아디펜스 9지역 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 45, [99]],
  ['mon_def12', 'deco', '십이지 탑', '시아디펜스 12지역 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 60, [99]],
  ['mon_matgo', 'deco', '화투 평상', '시아맞고 첫 승리 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 20, [99]],
  ['mon_casino', 'deco', '행운의 분수', '시아카지노 첫 승리 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 20, [99]],
  ['mon_charge30', 'deco', '돌격 북', '시아돌격대 별 30개 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 25, [99]],
  ['mon_charge100', 'deco', '황금 돌격 깃발', '시아돌격대 별 100개 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 45, [99]],
  ['mon_charge_road', 'deco', '끝없는 길 이정표', '끝없는 길 1,000m 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 35, [99]],
  ['mon_finger30', 'deco', '튕김 구슬', '시아핑거 별 30개 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 25, [99]],
  ['mon_finger100', 'deco', '황금 구슬', '시아핑거 별 100개 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 45, [99]],
  ['mon_finger_tower', 'deco', '요괴 탑', '끝없는 탑 20층 기념', 1, 1, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 1, 35, [99]],
];

export const BUILDINGS: BuildingDef[] = ROWS.map(([id, kind, name, desc, w, h, rice, wood, stone, coin, sia, upStone, buildSec, product, rate, buildExp, cap, points, unlock]) => ({
  id, kind, name, desc, w, h, rice, wood, stone, coin, sia, upStone, buildSec, product, rate, buildExp, cap, points, unlock,
}));

export const BUILDING: Record<BuildingType, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b])) as Record<BuildingType, BuildingDef>;
export const isBuildingType = (t: unknown): t is BuildingType => typeof t === 'string' && Object.prototype.hasOwnProperty.call(BUILDING, t);
/** 업그레이드할 수 있는 건물인가 (장식물 · 길은 아니다) */
export const upgradable = (t: BuildingType) => BUILDING[t].kind === 'main' || BUILDING[t].kind === 'special';
/** 선물 장식물인가 (지을 수 없다) */
export const isGift = (t: BuildingType) => t.startsWith('gift_');
export const isMonument = (t: BuildingType) => t.startsWith('mon_');
/** 지을 수 없고 받아서만 생기는 것 (주민 선물 · 기념물) */
export const isReward = (t: BuildingType) => isGift(t) || isMonument(t);

/** 가공: 재료를 넣고 기다리면 물건이 나온다 (방앗간 · 장독대). SQL 의 _village_recipes */
export interface Recipe {
  type: BuildingType;
  /** 하나를 만드는 재료 */
  in1: ResId;
  n1: number;
  in2: ResId | '';
  n2: number;
  out: ResId;
  /** 하나를 만드는 시간 (초, 레벨 1). 레벨이 오르면 생산 배수만큼 빨라진다 */
  sec: number;
  /** 하나를 거둘 때의 경험치 */
  exp: number;
  /** 한 번에 넣을 수 있는 개수 = base + per × (레벨 − 1) */
  base: number;
  per: number;
}
export const RECIPES: Recipe[] = [
  { type: 'mill', in1: 'rice', n1: 3, in2: '', n2: 0, out: 'cake', sec: 120, exp: 1, base: 10, per: 10 },
  { type: 'jar', in1: 'cake', n1: 3, in2: 'rice', n2: 10, out: 'special', sec: 3600, exp: 15, base: 2, per: 1 },
];
export const recipeOf = (t: BuildingType) => RECIPES.find((r) => r.type === t) ?? null;
