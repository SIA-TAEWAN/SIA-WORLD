/**
 * 진화 (PRD 5장): 무기 5레벨 + 짝 패시브를 가진 채로 보스의 보물상자를 열면 진화 무기로 바뀐다.
 * 진화 무기의 수치는 data/weapons.ts 에 있다.
 */
export interface EvolutionDef {
  weapon: string;
  passive: string;
  result: string;
}

export const EVOLUTIONS: EvolutionDef[] = [
  { weapon: 'shuriken', passive: 'fan', result: 'shurikenEvo' },
  { weapon: 'pearl', passive: 'sleeve', result: 'pearlEvo' },
  { weapon: 'claw', passive: 'might', result: 'clawEvo' },
];
