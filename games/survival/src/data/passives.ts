import type { StatKey } from './stats';

/** 패시브 12종 (PRD 5장). 무기 12종과 하나씩 짝(세트, data/sets.ts)을 이룬다. 효과는 레벨당 값, 최대 5레벨 */
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
  { id: 'sleeve', name: '넓은 소매', icon: '👘', stat: 'area', perLevel: 0.1, text: '무기 범위 +10%: 장판·폭발·베기·구름 크기와 여의봉 길이 (표창·깃털·강아지는 그대로)' },
  { id: 'fan', name: '부채', icon: '🪭', stat: 'cooldown', perLevel: 0.08, text: '재사용 대기시간 -8%' },
  { id: 'magnet', name: '자석', icon: '🧲', stat: 'pickup', perLevel: 0.5, text: '아이템 획득 범위 +50%' },
  { id: 'ginseng', name: '인삼', icon: '🌿', stat: 'maxHpPct', perLevel: 0.1, text: '최대 체력 +10%' },
  { id: 'knot', name: '복주머니 매듭', icon: '🪢', stat: 'coin', perLevel: 0.1, text: '엽전 +10%' },
  // 세트 짝을 맞추려고 더한 4종 (이미 있는 능력치를 쓴다)
  { id: 'venom', name: '독주머니', icon: '🧪', stat: 'dot', perLevel: 0.1, text: '지속 피해 +10%: 방울·독안개·양털 구름' },
  { id: 'spring', name: '약수', icon: '💧', stat: 'regen', perLevel: 0.15, text: '초당 체력 0.15 회복' },
  { id: 'scroll', name: '경전', icon: '📜', stat: 'xp', perLevel: 0.1, text: '경험치 +10%' },
  { id: 'string', name: '활시위', icon: '🏹', stat: 'projSpeed', perLevel: 0.1, text: '투사체 속도 +10%: 표창·깃털·복돼지 (깃털은 더 멀리)' },
];

export const PASSIVE_INDEX: Record<string, number> = Object.fromEntries(PASSIVES.map((p, i) => [p.id, i]));

/**
 * 서버 도감 목록(_survival_codex_ids, 093)에 들어 있는 패시브. 세트용 4종(독주머니·약수·경전·활시위)은 아직 서버 목록에 없어
 * 서버가 기억하지 않으므로, 도감에서는 처음부터 보여 준다 (progress.ts 의 knownPassives). 서버 목록에 넣으면 여기에 더한다.
 */
export const SERVER_CODEX_PASSIVES: readonly string[] = ['might', 'wind', 'shell', 'sleeve', 'fan', 'magnet', 'ginseng', 'knot'];
