import tanksJson from '../data/tanks.json';
import weaponsJson from '../data/weapons.json';
import itemsJson from '../data/items.json';

export type TankId = 'rat' | 'ox' | 'tiger' | 'rabbit' | 'dragon' | 'snake' | 'horse' | 'sheep' | 'monkey' | 'rooster' | 'dog' | 'pig' | 'cat' | 'zodiac';
export type ItemId = 'double' | 'power' | 'repair' | 'teleport';
export type Behavior = 'normal' | 'drill' | 'drop' | 'laser' | 'bounce' | 'build' | 'push' | 'split' | 'roll' | 'homing' | 'skip' | 'meteor' | 'firework';

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
  /** 물수제비탄: 땅에서 더 튀어 오르며 터지는 횟수 (구덩이는 점점 작아진다) */
  hops?: number;
  /** 튈 때마다 피해·구덩이 배율 (없으면 구덩이만 점점 작게) */
  hopScale?: number[];
  /** 터진 자리에 남는 장판 (불·독안개) */
  zone?: 'fire' | 'poison' | 'cloud';
  /** 맞은 탱크를 중독시킨다 */
  poison?: boolean;
  /** 폭발 연출 (할퀴기 등) */
  fx?: 'claw';
  /** 레이저를 맞은 자리 주변에 여러 번 (열두빛) */
  lasers?: number;
  /** 장판 반지름 (기본 18 = 탱크 크기) */
  zoneR?: number;
  /** 장판이 위로 닿는 높이 (기본 = 반지름) */
  zoneH?: number;
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
/** 십이지 밖의 추가 캐릭터 (shared/characters.js 의 EXTRA_IDS 와 같게). 계정마다 열어야 쓰는 캐릭터라 랜덤·AI 는 고르지 않는다 */
export const EXTRA_TANK_IDS: readonly TankId[] = ['cat'];
/** 고를 수 있는 탱크: 12지신 + 추가 캐릭터 (십이지신은 랜덤으로만) */
export const TANK_IDS: TankId[] = (Object.keys(TANKS) as TankId[]).filter((t) => t !== 'zodiac');
/** 랜덤·AI 가 고르는 12지신 탱크 (추가 캐릭터 제외. 온라인에서 시드로 모든 기기가 같은 결과를 내야 하므로 순서를 바꾸지 않는다) */
export const RANDOM_TANK_IDS: TankId[] = TANK_IDS.filter((t) => !EXTRA_TANK_IDS.includes(t));
export const ALL_TANK_IDS = Object.keys(TANKS) as TankId[];
/**
 * 모르는 탱크 id(더 새 판본의 기기가 고른 새 캐릭터 등)는 어흥이(tiger)로 그리고 계산한다.
 * 새 캐릭터는 기존 탱크의 능력치를 그대로 쓰므로(고양이 = 어흥이) 결과도 같다. 방·게임 화면에서 남의 탱크를 읽는 곳에 쓴다.
 */
export const tankOr = (id: string): TankId => (Object.prototype.hasOwnProperty.call(TANKS, id) ? (id as TankId) : 'tiger');
/** 탱크 고르기: 고를 수 있는 탱크 중 하나 또는 '랜덤'(게임 시작 때 정해짐) */
export type TankChoice = TankId | 'random';
/** 랜덤 선택: 20% 확률로 십이지신, 나머지는 12지신 12대 중 하나 (alwaysZodiac: 관리자는 언제나 열두빛) */
export function randomTank(rand: () => number = Math.random, alwaysZodiac = false): TankId {
  if (alwaysZodiac) return 'zodiac';
  return rand() < 0.2 ? 'zodiac' : RANDOM_TANK_IDS[Math.floor(rand() * RANDOM_TANK_IDS.length)];
}
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export const START_POINTS = 1000;
export const ITEM_SLOTS = 3;
export const TURN_SECONDS = 30;
