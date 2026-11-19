import type { ZodiacId } from './balance';

/** 배경 4종 (PRD 6장): 3지역씩 나눠 쓴다. 넓은 면의 색은 DESIGN.md 의 기존 값 (scenes/art.ts 의 BG) */
export type BgId = 'field' | 'bamboo' | 'palace' | 'underworld';

/**
 * 십이지 12지역 (PRD 6장). 스테이지는 data/stages.ts 에 지역 번호로 묶여 있고,
 * 스테이지 데이터가 아직 없는 지역은 화면에 '준비 중'으로 보인다.
 */
export interface RegionDef {
  no: number;
  zodiac: ZodiacId;
  name: string;
  bg: BgId;
  /** 길 특징 */
  feature: string;
  /** 이 지역을 여는 데 필요한 별 (+ 앞 지역 보스 클리어) */
  stars: number;
  /** 5번째 스테이지의 보스 이름 */
  boss: string;
}

export const REGIONS: RegionDef[] = [
  { no: 1, zodiac: 'rat', name: '쥐의 들판', bg: 'field', feature: '길 하나, 단순한 굽이', stars: 0, boss: '큰 도깨비' },
  { no: 2, zodiac: 'ox', name: '소의 논밭', bg: 'field', feature: '길이 길고 굽이가 많음', stars: 9, boss: '두억시니' },
  { no: 3, zodiac: 'tiger', name: '호랑이 고개', bg: 'field', feature: '길이 짧고 배치 칸이 많음', stars: 18, boss: '불가살' },
  { no: 4, zodiac: 'rabbit', name: '토끼의 달동산', bg: 'bamboo', feature: '길이 둘로 갈라졌다 합쳐짐', stars: 27, boss: '장산범' },
  { no: 5, zodiac: 'dragon', name: '용의 연못', bg: 'bamboo', feature: '연못을 빙 도는 길', stars: 36, boss: '왕지네' },
  { no: 6, zodiac: 'snake', name: '뱀의 늪', bg: 'bamboo', feature: '구불구불한 길, 배치 칸이 띄엄띄엄', stars: 45, boss: '구미호' },
  { no: 7, zodiac: 'horse', name: '말의 성문', bg: 'palace', feature: '입구 2곳', stars: 54, boss: '수문장 대장' },
  { no: 8, zodiac: 'sheep', name: '양의 뜰', bg: 'palace', feature: '입구 2곳, 배치 칸이 적음', stars: 63, boss: '야광귀' },
  { no: 9, zodiac: 'monkey', name: '원숭이의 누각', bg: 'palace', feature: '길이 여러 번 교차', stars: 72, boss: '이무기' },
  { no: 10, zodiac: 'rooster', name: '닭의 새벽길', bg: 'underworld', feature: '입구 3곳', stars: 81, boss: '저승사자' },
  { no: 11, zodiac: 'dog', name: '개의 삼도천', bg: 'underworld', feature: '물길로 나뉜 긴 길', stars: 90, boss: '강철이' },
  { no: 12, zodiac: 'pig', name: '돼지의 염라전', bg: 'underworld', feature: '입구 3곳, 가장 어려움', stars: 99, boss: '염라대왕' },
];

export const regionOf = (no: number): RegionDef | undefined => REGIONS[no - 1];
