/**
 * 세트: 무기 12종과 패시브 12종이 하나씩 짝을 이룬다. 둘을 다 가지면 (레벨과 상관없이) 그 무기에 세트 효과가 붙는다.
 * 진화한 무기(data/evolutions.ts)에도 원래 무기의 세트 효과가 그대로 남는다.
 * 진화 짝이 있는 무기는 세트 짝 = 진화 짝이다 (tests/data.test.ts).
 * 효과는 src/game/weapons.ts 의 weaponLine 이 레벨 줄 수치에 얹는다.
 */
export interface SetBonus {
  /** 한 번에 나가는 수 + */
  count?: number;
  /** 피해 × */
  dmg?: number;
  /** 범위 반지름 × (장판·폭발·충격파) */
  radius?: number;
  /** 닿는 거리 × (여의봉 길이) */
  range?: number;
  /** 투사체·몸 크기 × */
  size?: number;
  /** 유지 시간 + (초) */
  dur?: number;
  /** 뚫는 적 수 + */
  pierce?: number;
}

export interface SetDef {
  weapon: string;
  passive: string;
  /** 카드·도감에 적는 효과 */
  text: string;
  bonus: SetBonus;
}

export const SETS: SetDef[] = [
  { weapon: 'shuriken', passive: 'fan', text: '표창 1개 더', bonus: { count: 1 } },
  { weapon: 'bell', passive: 'shell', text: '방울 장판 범위 +25%', bonus: { radius: 1.25 } },
  { weapon: 'claw', passive: 'might', text: '발톱 피해 +30%', bonus: { dmg: 1.3 } },
  { weapon: 'mooncake', passive: 'ginseng', text: '달떡 1개 더', bonus: { count: 1 } },
  { weapon: 'pearl', passive: 'sleeve', text: '구슬 1개 더', bonus: { count: 1 } },
  { weapon: 'mist', passive: 'venom', text: '독 지대가 1초 더 남는다', bonus: { dur: 1 } },
  { weapon: 'hoof', passive: 'wind', text: '충격파 범위 +25%', bonus: { radius: 1.25 } },
  { weapon: 'wool', passive: 'spring', text: '양털 구름 1개 더', bonus: { count: 1 } },
  { weapon: 'staff', passive: 'scroll', text: '여의봉 길이 +30%', bonus: { range: 1.3 } },
  { weapon: 'feather', passive: 'string', text: '깃털 2개 더, 요괴 1마리를 뚫는다', bonus: { count: 2, pierce: 1 } },
  { weapon: 'puppy', passive: 'magnet', text: '강아지 1마리 더', bonus: { count: 1 } },
  { weapon: 'piggy', passive: 'knot', text: '복돼지 크기 +30%', bonus: { size: 1.3 } },
];

/**
 * 최종 레벨(5레벨)과 진화 무기: 한 단계 더 세진다. 화면에서는 무기 칸이 금색 'MAX' 로 바뀌고 필드의 공격에 금빛이 두른다.
 * 피해만 올린다: 무기마다 똑같은 비율이라 무기끼리의 세기 차이(tests/weaponDps.test.ts 의 ±15%)가 그대로다
 * (크기까지 올리면 장판·폭발 무기만 더 세진다). 진화 무기에도 주는 까닭: 5레벨에서 진화할 때 약해지지 않게.
 */
export const MAX_BONUS = { dmg: 1.25 } as const;
export const MAX_BONUS_TEXT = '최종 레벨! 피해 +25%';
