import tanksJson from '../data/tanks.json';
import weaponsJson from '../data/weapons.json';
import itemsJson from '../data/items.json';

export type TankId = 'rat' | 'ox' | 'tiger' | 'rabbit' | 'dragon' | 'snake' | 'horse' | 'sheep' | 'monkey' | 'rooster' | 'dog' | 'pig' | 'zodiac';
export type ItemId = 'double' | 'power' | 'repair' | 'teleport';
export type Behavior = 'normal' | 'drill' | 'drop' | 'laser' | 'bounce' | 'build' | 'push' | 'split' | 'roll' | 'homing';

export interface TankDef {
  name: string;
  /** 12지신 글자 (자·축·인…) */
  zodiac: string;
  /** 동물 이름 */
  animal: string;
  role: string;
  color: string;
  accent: string;
  hp: number;
  /** 받는 피해 감소율 (0~1) */
  defense: number;
  /** 이동 게이지 (px) */
  move: number;
  angleMin: number;
  angleMax: number;
  delay: number;
  weapons: [string, string, string];
}

export interface WeaponDef {
  name: string;
  desc: string;
  behavior: Behavior;
  damage: number;
  /** 폭발(피해) 반경 */
  radius: number;
  /** 지형 파괴 반경 (build는 쌓는 반경) */
  crater: number;
  /** 바람 영향 배율 */
  wind: number;
  count: number;
  /** 파워 100일 때 초기 속도 (px/s) */
  speed: number;
  /** 추가 딜레이 */
  delay: number;
  drillDistance?: number;
  drillWidth?: number;
  bounces?: number;
  knockback?: number;
  /** 날아가는 포탄 그림 (치즈·당근·달걀…) */
  look?: string;
  /** 분열탄: 갈라지는 개수와 좌우 퍼짐 속도 */
  split?: number;
  spread?: number;
  /** 굴러가는 탄: 땅에 닿은 뒤 굴러가는 거리 */
  rollDistance?: number;
  /** 유도탄: 꼭대기를 지난 뒤 초당 꺾는 각도 */
  homing?: number;
}

export interface ItemDef {
  name: string;
  desc: string;
  price: number;
  delay: number;
  icon: string;
}

export const TANKS = tanksJson as Record<TankId, TankDef>;
export const WEAPONS = weaponsJson as Record<string, WeaponDef>;
export const ITEMS = itemsJson as Record<ItemId, ItemDef>;
/** 고를 수 있는 12지신 탱크 (십이지신은 랜덤으로만) */
export const TANK_IDS: TankId[] = (Object.keys(TANKS) as TankId[]).filter((t) => t !== 'zodiac');
export const ALL_TANK_IDS = Object.keys(TANKS) as TankId[];
/** 탱크 고르기: 12지신 중 하나 또는 '랜덤'(게임 시작 때 정해짐) */
export type TankChoice = TankId | 'random';
/** 랜덤 선택: 20% 확률로 십이지신, 나머지는 12대 중 하나 */
export function randomTank(rand: () => number = Math.random): TankId {
  return rand() < 0.2 ? 'zodiac' : TANK_IDS[Math.floor(rand() * TANK_IDS.length)];
}
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export const START_POINTS = 1000;
export const ITEM_SLOTS = 3;
export const TURN_SECONDS = 30;
