import type { StatKey } from './stats';

/**
 * 영구 강화 (PRD 7장). 엽전으로 메인의 [강화]에서 산다. 모든 캐릭터에 공통으로 적용된다.
 * 사고 되돌리는 것은 서버 함수가 한다 (supabase/migrations/038_survival.sql). 아래 표는 그 SQL의 표와 같아야 한다 (tests/sql.test.ts).
 */
export interface UpgradeDef {
  id: string;
  name: string;
  stat: StatKey;
  perLevel: number;
  max: number;
  /** 첫 레벨의 값 (엽전) */
  baseCost: number;
  /** 레벨이 하나 오를 때마다 값이 이 배수로 오른다 */
  growth: number;
  text: string;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'might', name: '공격력', stat: 'might', perLevel: 0.05, max: 10, baseCost: 100, growth: 1.5, text: '+5%' },
  { id: 'hp', name: '최대 체력', stat: 'maxHpFlat', perLevel: 10, max: 10, baseCost: 100, growth: 1.5, text: '+10' },
  { id: 'armor', name: '방어', stat: 'armor', perLevel: 1, max: 5, baseCost: 100, growth: 2.2, text: '받는 피해 -1' },
  { id: 'speed', name: '이동 속도', stat: 'speed', perLevel: 0.03, max: 5, baseCost: 100, growth: 1.5, text: '+3%' },
  { id: 'xp', name: '경험치 획득', stat: 'xp', perLevel: 0.05, max: 5, baseCost: 100, growth: 1.5, text: '+5%' },
  { id: 'pickup', name: '아이템 획득 범위', stat: 'pickup', perLevel: 0.1, max: 5, baseCost: 100, growth: 1.5, text: '+10%' },
  { id: 'coin', name: '엽전 획득', stat: 'coin', perLevel: 0.05, max: 5, baseCost: 100, growth: 1.5, text: '+5%' },
  { id: 'revive', name: '부활', stat: 'revive', perLevel: 1, max: 1, baseCost: 120, growth: 1.5, text: '1회 부활' },
  { id: 'reroll', name: '다시 뽑기', stat: 'reroll', perLevel: 1, max: 3, baseCost: 300, growth: 1.5, text: '레벨업 카드 다시 뽑기 +1' },
];

/** 전체 강화 레벨 수 (49) */
export const UPGRADE_TOTAL = UPGRADES.reduce((n, u) => n + u.max, 0);

/** 강화 상태: 항목 id → 레벨 */
export type UpgradeLevels = Record<string, number>;

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/**
 * 비용: level → level+1 로 올릴 때의 값 = round(첫 값 × 배수^level / 5) × 5. 보통은 레벨마다 1.5배 (100 → 150 → 225 …),
 * 방어는 한 레벨의 효과가 커서 더 가파르게 오른다 (맵을 하나 넘어갈 때마다 한 레벨쯤 살 수 있게).
 * 서버(supabase/migrations/038_survival.sql 의 _survival_upgrade_cost)와 같은 식이다. 8단계에서 판당 엽전 획득량에 맞춰 다듬는다.
 */
export const upgradeCost = (id: string, level: number) => Math.round(((UPGRADE_BY_ID[id]?.baseCost ?? 100) * Math.pow(UPGRADE_BY_ID[id]?.growth ?? 1.5, level)) / 5) * 5;

/** 지금까지 강화에 쓴 엽전 (초기화하면 전액 돌려받는다) */
export function upgradeSpent(levels: UpgradeLevels): number {
  let sum = 0;
  for (const u of UPGRADES) for (let i = 0; i < Math.min(u.max, Math.max(0, Math.floor(levels[u.id] ?? 0))); i++) sum += upgradeCost(u.id, i);
  return sum;
}

/**
 * 강화를 모두 n레벨 찍은 상태 (0~49). '값싼 것부터 고르게' 산다고 본다: 다음 레벨이 가장 싼 항목을 하나씩 (값이 같으면 표의 순서대로).
 * 밸런스 시험(npm run balance)과 개발용 설정(?upg=N)이 쓴다.
 */
export function presetUpgrades(n: number): UpgradeLevels {
  const lv: UpgradeLevels = Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
  let left = Math.max(0, Math.min(UPGRADE_TOTAL, Math.floor(n)));
  while (left > 0) {
    let best: UpgradeDef | null = null;
    for (const u of UPGRADES) {
      if (lv[u.id] >= u.max) continue;
      if (!best || upgradeCost(u.id, lv[u.id]) < upgradeCost(best.id, lv[best.id])) best = u;
    }
    if (!best) break;
    lv[best.id]++;
    left--;
  }
  return lv;
}
