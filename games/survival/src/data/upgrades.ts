import type { StatKey } from './stats';

/**
 * 영구 강화 (PRD 7장). 엽전으로 사는 화면과 저장은 4단계에서 만든다.
 * 지금은 계산(시뮬레이션)과 개발용 테스트 설정(?upg=10)이 이 표를 쓴다.
 */
export interface UpgradeDef {
  id: string;
  name: string;
  stat: StatKey;
  perLevel: number;
  max: number;
  text: string;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'might', name: '공격력', stat: 'might', perLevel: 0.05, max: 10, text: '+5%' },
  { id: 'hp', name: '최대 체력', stat: 'maxHpFlat', perLevel: 10, max: 10, text: '+10' },
  { id: 'armor', name: '방어', stat: 'armor', perLevel: 1, max: 5, text: '받는 피해 -1' },
  { id: 'speed', name: '이동 속도', stat: 'speed', perLevel: 0.03, max: 5, text: '+3%' },
  { id: 'xp', name: '경험치 획득', stat: 'xp', perLevel: 0.05, max: 5, text: '+5%' },
  { id: 'pickup', name: '아이템 획득 범위', stat: 'pickup', perLevel: 0.1, max: 5, text: '+10%' },
  { id: 'coin', name: '엽전 획득', stat: 'coin', perLevel: 0.05, max: 5, text: '+5%' },
  { id: 'revive', name: '부활', stat: 'revive', perLevel: 1, max: 1, text: '1회 부활' },
  { id: 'reroll', name: '다시 뽑기', stat: 'reroll', perLevel: 1, max: 3, text: '레벨업 카드 다시 뽑기 +1' },
];

/** 전체 강화 레벨 수 (49) */
export const UPGRADE_TOTAL = UPGRADES.reduce((n, u) => n + u.max, 0);

/** 강화 상태: 항목 id → 레벨 */
export type UpgradeLevels = Record<string, number>;

/** 비용: 레벨마다 1.5배 (100 → 150 → 225 …). 4단계에서 판당 엽전 획득량에 맞춰 다듬는다 */
export const upgradeCost = (level: number) => Math.round((100 * Math.pow(1.5, level)) / 5) * 5;

/** '보통 사람이 사는 순서': 이 순서를 되풀이하며 한 레벨씩 산다 (밸런스 시험·?upg=N 용) */
const PRESET_ORDER = ['might', 'hp', 'armor', 'might', 'hp', 'speed', 'xp', 'might', 'hp', 'pickup', 'coin', 'reroll', 'revive'];

/** 강화를 모두 n레벨 찍은 상태 (0~49) */
export function presetUpgrades(n: number): UpgradeLevels {
  const lv: UpgradeLevels = Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
  let left = Math.max(0, Math.min(UPGRADE_TOTAL, Math.floor(n)));
  while (left > 0) {
    for (const id of PRESET_ORDER) {
      if (left <= 0) break;
      const def = UPGRADES.find((u) => u.id === id)!;
      if (lv[id] >= def.max) continue;
      lv[id]++;
      left--;
    }
  }
  return lv;
}
