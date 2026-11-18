/**
 * 능력치 이름. 캐릭터 특성·패시브·영구 강화는 모두 "어느 능력치를 얼마나" 로 적는다.
 * 같은 능력치는 더해서 한 번에 적용한다 (공격력 +10% 두 개 = +20%).
 */
export type StatKey =
  | 'might' // 공격력 (+비율)
  | 'area' // 무기 범위 (+비율)
  | 'cooldown' // 재사용 대기시간 (-비율)
  | 'speed' // 이동 속도 (+비율)
  | 'maxHpPct' // 최대 체력 (+비율)
  | 'maxHpFlat' // 최대 체력 (+값)
  | 'armor' // 받는 피해 (-값)
  | 'taken' // 받는 피해 (-비율)
  | 'pickup' // 아이템 획득 범위 (+비율)
  | 'coin' // 엽전 획득 (+비율)
  | 'xp' // 경험치 획득 (+비율)
  | 'dot' // 지속 피해 (+비율): 장판·독 지대 무기
  | 'projSpeed' // 투사체 속도 (+비율)
  | 'regen' // 체력 자연 회복 (초당 값)
  | 'revive' // 부활 횟수 (+값)
  | 'reroll'; // 레벨업 카드 다시 뽑기 (+값)

export interface Mod {
  stat: StatKey;
  value: number;
}
