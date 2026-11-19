import type { StatKey } from './stats';

/** 패시브 8종 (PRD 5장). 효과는 레벨당 값, 최대 5레벨 */
export interface PassiveDef {
  id: string;
  name: string;
  icon: string;
  stat: StatKey;
  /** 레벨당 */
  perLevel: number;
  /** 카드에 적는 설명 */
  text: string;
}

export const PASSIVES: PassiveDef[] = [
  { id: 'might', name: '힘의 부적', icon: '💪', stat: 'might', perLevel: 0.1, text: '공격력 +10%' },
  { id: 'wind', name: '바람의 신', icon: '🍃', stat: 'speed', perLevel: 0.08, text: '이동 속도 +8%' },
  { id: 'shell', name: '거북 등껍질', icon: '🐢', stat: 'armor', perLevel: 1, text: '받는 피해 -1' },
  { id: 'sleeve', name: '넓은 소매', icon: '👘', stat: 'area', perLevel: 0.1, text: '무기 범위 +10%' },
  { id: 'fan', name: '부채', icon: '🪭', stat: 'cooldown', perLevel: 0.08, text: '재사용 대기시간 -8%' },
  { id: 'magnet', name: '자석', icon: '🧲', stat: 'pickup', perLevel: 0.5, text: '아이템 획득 범위 +50%' },
  { id: 'ginseng', name: '인삼', icon: '🌿', stat: 'maxHpPct', perLevel: 0.1, text: '최대 체력 +10%' },
  { id: 'knot', name: '복주머니 매듭', icon: '🪢', stat: 'coin', perLevel: 0.1, text: '엽전 +10%' },
];

export const PASSIVE_INDEX: Record<string, number> = Object.fromEntries(PASSIVES.map((p, i) => [p.id, i]));
