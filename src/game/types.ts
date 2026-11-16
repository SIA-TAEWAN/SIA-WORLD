import type { ItemId, TankDef, TankId } from './data';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Team = 0 | 1;

export interface PlayerSetup {
  /** 온라인 플레이어 고유 ID */
  id?: string;
  name: string;
  tank: TankId;
  team: Team;
  /** AI 난이도. null이면 사람이 조종 */
  ai: Difficulty | null;
  items: ItemId[];
}

export interface TankState {
  idx: number;
  name: string;
  tankId: TankId;
  def: TankDef;
  team: Team;
  /** 발 밑 중앙 좌표 (y = 밟고 있는 땅 픽셀의 행) */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: 1 | -1;
  angle: number;
  delay: number;
  /** 필살기 게이지 0~100 */
  ult: number;
  alive: boolean;
  items: (ItemId | null)[];
  damageDealt: number;
  ai: Difficulty | null;
  lastPower: number;
  /** 중독이 남은 턴 수 (꼬꼬댁 깃털탄) */
  poison?: number;
}

/** 한 턴의 입력. 온라인에서는 이것만 주고받는다. */
export interface TurnInput {
  angle: number;
  facing: 1 | -1;
  /** 0~100 */
  power: number;
  /** 0=1번, 1=2번, 2=필살기 */
  weapon: 0 | 1 | 2;
  /** 사용할 아이템 칸 번호 (없으면 null) */
  itemSlot: number | null;
}

export type SimEvent =
  | { f: number; type: 'explode'; x: number; y: number; radius: number; crater: number; big: boolean; fx?: 'claw'; zone?: Zone }
  | { f: number; type: 'build'; x: number; y: number; r: number }
  | { f: number; type: 'carveLine'; x1: number; y1: number; x2: number; y2: number; r: number }
  | { f: number; type: 'laser'; x1: number; y1: number; x2: number; y2: number; r: number }
  | { f: number; type: 'damage'; target: number; amount: number; direct: boolean }
  | { f: number; type: 'heal'; target: number; amount: number }
  | { f: number; type: 'move'; target: number; x: number; y: number; kind: 'knock' | 'fall' | 'teleport' }
  | { f: number; type: 'death'; target: number }
  /** 중독됨 (녹색) */
  | { f: number; type: 'poisoned'; target: number }
  /** 불·독 지속 피해 (체력 1은 남긴다) */
  | { f: number; type: 'dot'; target: number; amount: number; kind: 'fire' | 'poison'; last: boolean; /** 끝난 뒤에도 중독이 남아 있다 */ stay?: boolean };

/** 세로로 긴 특수 벽 (천장부터 바닥까지). 천장 위로 넘어가면 효과 없음 */
export type WallKind = 'amp' | 'whirl' | 'double' | 'triple';
export interface Wall {
  kind: WallKind;
  x: number;
  /** 벽 아래끝 (그 자리 땅 높이) */
  bottom: number;
  /** 이 턴 번호가 되면 사라진다 (생긴 뒤 3턴) */
  until: number;
}

/** 땅에 남은 장판 (불·독안개) */
export interface Zone {
  id: number;
  kind: 'fire' | 'poison';
  x: number;
  y: number;
  r: number;
  /** 만든 탱크 (그 탱크의 다음 차례에 사라진다) */
  owner: number;
  /** 이 턴 번호가 되면 사라진다 (없으면 만든 탱크의 다음 차례에) */
  until?: number;
  /** 위로 닿는 높이 (없으면 r) */
  h?: number;
}

export interface ShellTrack {
  id: number;
  spawn: number;
  /** [x0,y0,x1,y1,...] 프레임마다 위치 */
  path: number[];
  behavior: string;
  /** 포탄 그림 */
  look?: string;
  /** 필살기는 크게 */
  big?: boolean;
}

export interface ShotResult {
  frames: number;
  shells: ShellTrack[];
  events: SimEvent[];
  firstImpact: { x: number; y: number } | null;
}
