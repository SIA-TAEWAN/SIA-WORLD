/**
 * 진화 (PRD 5장): 무기 5레벨 + 짝 패시브를 가진 채로 보스의 보물상자를 열면 진화 무기로 바뀐다.
 * 진화 무기의 수치는 data/weapons.ts 에 있다. 진화 무기는 원래 무기와 같은 동작(kind)이고 수치 한 줄만 다르다.
 * 한 패시브는 한 진화의 짝만 된다 (tests/data.test.ts).
 */
export interface EvolutionDef {
  weapon: string;
  passive: string;
  result: string;
  /**
   * 짝 패시브 카드를 더 자주 내지 않는다 (CARD_WEIGHT.evoPassive 를 주지 않는다. 무기 강화 카드의 evoWeapon 은 그대로).
   * 피해를 올려 주지 않는 패시브(방어·체력·이동·엽전)를 4배로 밀어주면 카드를 아무거나 고르는 판이 눈에 띄게 약해진다
   * (강화 10 · 들판 80판: 소 3:12 → 2:56, 말 2:59 → 2:50, 돼지 3:15 → 3:00. 밀어주지 않으면 3:15 · 3:06 · 3:14 이고 진화도 더 자주 일어난다).
   */
  plainPassive?: boolean;
}

export const EVOLUTIONS: EvolutionDef[] = [
  { weapon: 'shuriken', passive: 'fan', result: 'shurikenEvo' },
  { weapon: 'pearl', passive: 'sleeve', result: 'pearlEvo' },
  { weapon: 'claw', passive: 'might', result: 'clawEvo' },
  // 2차: 짝 패시브가 무기의 성격과 맞는 4종 (방울 = 지키는 장판 + 등껍질, 달떡 = 먹거리 + 인삼, 말발굽 = 달리기 + 바람, 복돼지 = 복 + 매듭)
  { weapon: 'bell', passive: 'shell', result: 'bellEvo', plainPassive: true },
  { weapon: 'mooncake', passive: 'ginseng', result: 'mooncakeEvo', plainPassive: true },
  { weapon: 'hoof', passive: 'wind', result: 'hoofEvo', plainPassive: true },
  { weapon: 'piggy', passive: 'knot', result: 'piggyEvo', plainPassive: true },
];
