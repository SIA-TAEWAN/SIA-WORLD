/**
 * 필드 아이템 (PRD 3장): 경험치 구슬(작음·중간·큼), 엽전, 떡, 복주머니, 부적, 보물상자.
 * 종류 번호는 계산과 그림이 함께 쓴다.
 */
export const ITEM = {
  gemS: 0,
  gemM: 1,
  gemL: 2,
  coin: 3,
  cake: 4,
  pouch: 5,
  talisman: 6,
  chest: 7,
} as const;
export type ItemKind = (typeof ITEM)[keyof typeof ITEM];

export const ITEM_NAMES = ['작은 구슬', '중간 구슬', '큰 구슬', '엽전', '떡', '복주머니', '부적', '보물상자'];

export const ITEMS = {
  /** 경험치가 이 값 이상이면 중간·큰 구슬 */
  gemMidXp: 5,
  gemBigXp: 20,
  /** 떡: 체력 회복량 */
  cakeHeal: 30,
  /** 엽전 한 닢의 값 (맵 엽전 배율·엽전 획득 보너스가 곱해진다) */
  coinValue: 1,
  /** 요괴 한 마리가 떨굴 확률 (0~1). 보스는 보물상자와 엽전을 따로 준다 */
  drop: { coin: 0.064, cake: 0.00225, pouch: 0.0011, talisman: 0.0008 },
  /** 보스가 떨구는 엽전 (닢 수) */
  bossCoins: 16,
  /** 줍는 판정 거리 (내 반지름에 더한다) */
  touch: 10,
};
