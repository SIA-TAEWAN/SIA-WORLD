/**
 * 십이지 지도 (돌격대·디펜스와 같은 지역 이름·바닥). 화면에서만 쓰는 값이라 games/finger 에 둔다.
 */

/** 지역 수 */
export const REGIONS = 12;
/** 지역 이름 (십이지 순서) */
export const REGION_NAMES = [
  '쥐의 들판', '소의 논밭', '호랑이 고개', '토끼의 달동산', '용의 연못', '뱀의 늪',
  '말의 성문', '양의 뜰', '원숭이의 누각', '닭의 새벽길', '개의 삼도천', '돼지의 염라전',
];
/** 지역 바닥 (4종을 3지역씩) */
export type Ground = 'field' | 'bamboo' | 'palace' | 'underworld';
export const groundOf = (region: number): Ground => (['field', 'bamboo', 'palace', 'underworld'] as const)[Math.min(3, Math.floor((Math.max(1, region) - 1) / 3))];
