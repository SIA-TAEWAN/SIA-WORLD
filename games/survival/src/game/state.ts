/**
 * 판의 상태. 화면(Phaser·DOM)과 무관한 순수 자료이고, step(state, input) 이 한 걸음씩 바꾼다.
 * 적·투사체·지대·아이템·이펙트·피해 숫자는 모두 풀(Pool)에 미리 만들어 두고 다시 쓴다 (판 도중에 객체를 새로 만들지 않는다).
 */
import type { RunMode, ZodiacId } from '../data/balance';
import type { CharacterDef } from '../data/characters';
import type { MapDef } from '../data/maps';
import type { UpgradeLevels } from '../data/upgrades';
import type { Grid } from './grid';

/** 풀: items[0..n) 이 살아 있는 것. 죽은 것은 걸음 끝에 뒤의 것과 자리를 바꿔 빼낸다 */
export interface Pool<T> {
  items: T[];
  n: number;
}

export interface Enemy {
  /** 판 안에서 겹치지 않는 번호 (관통 투사체가 같은 적을 두 번 때리지 않게) */
  uid: number;
  /** data/enemies.ts 의 번호 (보스는 -1) */
  kind: number;
  /** data/bosses.ts 의 번호 (일반 요괴는 -1) */
  boss: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  r: number;
  speed: number;
  dmg: number;
  xp: number;
  /** 맞았을 때 하얗게 번쩍이는 남은 걸음 수 */
  flash: number;
  /** 나타난 뒤 흐른 시간 (초) */
  t: number;
  dead: boolean;
  /** 쏘기까지 남은 시간 (원거리 요괴) */
  cd: number;
  /** 보스: 지금 패턴 번호, 패턴 안에서 흐른 시간, 패턴 안의 단계, 겨눈 방향 */
  pat: number;
  patT: number;
  sub: number;
  ax: number;
  ay: number;
  /** 느려진 남은 걸음 수 (양털 구름) */
  slow: number;
  /** 숨어 있다: 보이지 않고 맞지 않고 닿아도 피해가 없다 (땅속의 죽순 요괴, 쓰러진 해골 병사, 숨은 장산범) */
  hidden: boolean;
  /** 받는 피해 배율 (방패를 든 동안 1보다 작다) */
  guard: number;
  /** 분신·부하의 모습: 이 번호의 보스 그림을 작게 그린다 (아니면 -1) */
  look: number;
  /** 장애물에 막혔을 때 돌아가는 쪽 (-1·1, 막히지 않았으면 0) 과 그 쪽을 유지하는 남은 걸음 */
  side: number;
  sideT: number;
  /** 무기 칸(0~7)마다 마지막으로 맞은 걸음 (장판·구슬이 같은 적을 너무 자주 때리지 않게) */
  hitAt: Int32Array;
}

/** 투사체 움직임 종류 */
export const MODE = { line: 0, lob: 1, orbit: 2, enemy: 3, minion: 4 } as const;
/** 투사체 그림 종류 */
export const PROJ = { shuriken: 0, cake: 1, pearl: 2, foxfire: 3, shurikenEvo: 4, pearlEvo: 5, feather: 6, pig: 7, puppy: 8, orb: 9 } as const;

export interface Projectile {
  kind: number;
  mode: number;
  /** 무기 칸 (0~5), 적의 것은 7 */
  slot: number;
  /** data/weapons.ts 의 번호 (피해 집계용, 적의 것은 -1) */
  weapon: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  life: number;
  pierce: number;
  /** 포물선: 출발·도착 자리, 진행(0~1), 걸리는 시간, 터지는 반지름 / 구슬: 각도·거리·도는 빠르기 */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  a: number;
  b: number;
  c: number;
  /** 같은 적을 다시 때리기까지 (걸음 수, 구슬) */
  every: number;
  /** 이미 맞힌 적 번호 (직선 투사체: 같은 적을 한 번만 때린다. 칸 수 = 적 풀 크기) */
  hit: Int32Array;
  hitN: number;
  dead: boolean;
}

/** 지대 그림 종류 */
export const ZONE = { mist: 0, warn: 1, poison: 2, fire: 3, water: 4, cloud: 5, hoof: 6 } as const;
/** 보스 패턴 데이터의 zone 이름 → 번호 */
export const ZONE_OF: Record<string, number> = { warn: ZONE.warn, poison: ZONE.poison, fire: ZONE.fire, water: ZONE.water };

export interface Zone {
  kind: number;
  /** 0: 내 것 (적이 피해), 1: 적의 것 (내가 피해) */
  owner: number;
  slot: number;
  weapon: number;
  x: number;
  y: number;
  r: number;
  /** 적의 것: 터지기까지 남은 시간 (미리 보여 주는 동안), 처음 값 */
  delay: number;
  windup: number;
  life: number;
  maxLife: number;
  /** 피해 간격 (걸음 수)과 다음 피해까지 남은 걸음 */
  every: number;
  next: number;
  dmg: number;
  /** 적의 것: 터진 뒤 바닥에 남아 있는 동안 간격마다 주는 피해 (0이면 없음) */
  tick: number;
  /** 맞은 쪽이 느려지는 시간 (걸음 수. 적의 것은 나를, 내 것은 요괴를 느리게 한다) */
  slow: number;
  dead: boolean;
}

export interface Pickup {
  /** data/items.ts 의 ITEM */
  kind: number;
  x: number;
  y: number;
  /** 구슬: 경험치, 엽전: 닢 수 */
  value: number;
  /** 빨려오는 중인가 */
  magnet: boolean;
  dead: boolean;
}

/** 이펙트 그림 종류 (보여 주기만 한다) */
export const FX = { slash: 0, burst: 1, pulse: 2, puff: 3, shock: 4, beam: 5 } as const;

export interface Fx {
  kind: number;
  x: number;
  y: number;
  r: number;
  /** 방향(라디안) 또는 부채꼴 각도 */
  a: number;
  b: number;
  life: number;
  maxLife: number;
  dead: boolean;
}

export interface Num {
  x: number;
  y: number;
  v: number;
  /** 0: 적이 받은 피해, 1: 내가 받은 피해, 2: 회복 */
  kind: number;
  life: number;
  dead: boolean;
}

export interface WeaponInst {
  /** data/weapons.ts 의 번호 */
  def: number;
  lv: number;
  /** 다음 발동까지 남은 시간 */
  cd: number;
  /** 동작이 쓰는 값 (구슬 시작 각도 등) */
  a: number;
  /** 화면에 그릴 범위 (장판 반지름). 0이면 그리지 않는다 */
  view: number;
}

export interface PassiveInst {
  def: number;
  lv: number;
}

/** 레벨업 카드 종류 */
export const CARD = { weapon: 0, passive: 1, heal: 2, coins: 3 } as const;

export interface Card {
  type: number;
  /** 무기·패시브 번호 */
  def: number;
  /** 고르면 되는 레벨 */
  lv: number;
  isNew: boolean;
}

/** 걸음마다 생긴 일 (소리·화면 연출용). a·b 는 종류마다 뜻이 다르다 */
export const EV = {
  /** 내가 맞음 (a: 피해) */
  hurt: 1,
  /** 무기 발동 (a: 무기 번호) */
  fire: 2,
  /** 아이템을 주움 (a: 아이템 종류) */
  pick: 3,
  /** 레벨업 (a: 새 레벨) */
  levelup: 4,
  /** 카드를 고름 (a: 카드 종류, b: 번호) */
  chosen: 5,
  /** 보스 경고 (a: 보스 번호) */
  bossWarn: 6,
  /** 보스 등장 (a: 보스 번호) */
  bossSpawn: 7,
  /** 보스 처치 (a: 보스 번호) */
  bossDown: 8,
  /** 진화 (a: 새 무기 번호) */
  evolve: 9,
  /** 보물상자에서 강화를 얻음 (a: 카드 종류, b: 번호) */
  chestGain: 10,
  /** 떼로 몰려옴 (a: 요괴 번호) */
  swarm: 11,
  /** 부활 */
  revive: 12,
  /** 게임 오버 */
  over: 13,
  /** 클리어 */
  clear: 14,
  /** 보스의 큰 공격이 터짐 */
  boom: 15,
  /** 요괴 처치 (a: 요괴 번호). 한 걸음에 하나만 알린다 */
  kill: 16,
} as const;

export interface Ev {
  t: number;
  a: number;
  b: number;
}

/** 지금 능력치 (기본값 + 캐릭터 특성 + 패시브 + 영구 강화) */
export interface Stats {
  might: number;
  area: number;
  /** 재사용 대기시간 배율 (작을수록 빠름) */
  cooldown: number;
  /** 이동 속도 (px/초) */
  speed: number;
  maxHp: number;
  armor: number;
  /** 받는 피해 배율 */
  taken: number;
  /** 아이템 획득 거리 (px) */
  pickup: number;
  coin: number;
  xp: number;
  dot: number;
  projSpeed: number;
  regen: number;
}

export type Phase = 'play' | 'levelup' | 'over' | 'clear';

export interface RunConfig {
  seed: number;
  char: ZodiacId;
  map: string;
  /** 모드 (없으면 4분 모드) */
  mode?: RunMode;
  /** 영구 강화 (없으면 0) */
  upgrades?: UpgradeLevels;
  /** 피해 숫자를 만들까 (화면 없는 시험에서는 끈다) */
  numbers?: boolean;
  /** 개발용: 이 시각(초)에서 시작. 그때까지 올랐을 법한 레벨을 미리 준다 */
  startAt?: number;
}

/** 조작: 이동 방향(-1~1)과 레벨업 카드 고르기 */
export interface Input {
  mx: number;
  my: number;
  /** 레벨업 중: 고른 카드 (0~2), 아니면 -1 */
  pick: number;
  /** 레벨업 중: 카드 다시 뽑기 */
  reroll: boolean;
}

export interface State {
  cfg: RunConfig;
  /** 무한 모드인가: 최종 보스를 잡아도 끝나지 않고, 4분 뒤로 요괴가 계속 강해진다 (data/balance.ts 의 ENDLESS) */
  endless: boolean;
  /** 무한 모드에서 이 판에 받을 수 있는 엽전의 상한 (4분 모드는 Infinity) */
  coinCap: number;
  map: MapDef;
  char: CharacterDef;
  upgrades: UpgradeLevels;
  /** 난수 상태 (mulberry32) */
  rng: number;
  /** 지형의 시드 (판마다 장애물 자리가 다르다) */
  terrainSeed: number;
  tick: number;
  /** 흐른 시간 (초) */
  time: number;
  phase: Phase;
  player: {
    x: number;
    y: number;
    hp: number;
    /** 마지막으로 움직인 방향 (길이 1) */
    fx: number;
    fy: number;
    /** 남은 무적 걸음 수 */
    inv: number;
    moving: boolean;
    /** 남은 부활 횟수 */
    revives: number;
    /** 느려진 남은 걸음 수 (야광귀에게 맞았을 때) */
    slow: number;
  };
  stats: Stats;
  level: number;
  xp: number;
  xpNext: number;
  kills: number;
  bossKills: number;
  /** 이번 판에서 주운 엽전 (소수까지 더해 두고 보여 줄 때 내린다) */
  coins: number;
  /** 먹은 떡 수 (해금 조건용) */
  cakes: number;
  /** 남은 카드 다시 뽑기 횟수 */
  rerolls: number;
  weapons: WeaponInst[];
  passives: PassiveInst[];
  enemies: Pool<Enemy>;
  projectiles: Pool<Projectile>;
  zones: Pool<Zone>;
  pickups: Pool<Pickup>;
  fx: Pool<Fx>;
  nums: Pool<Num>;
  grid: Grid;
  /** 범위 안의 적을 찾은 결과를 담는 통 */
  hits: Int32Array;
  nextUid: number;
  /** 지금 살아 있는 일반 요괴 수 (보스 제외) */
  normals: number;
  /** 등장 표 줄마다 모아 둔 출현 수 (1이 넘으면 한 마리) */
  spawnAcc: Float64Array;
  /** 등장 표·떼 이벤트·보스 줄마다의 요괴(보스) 번호 (이름을 걸음마다 찾지 않게 미리 바꿔 둔다) */
  spawnKind: Int32Array;
  swarmKind: Int32Array;
  bossKind: Int32Array;
  /** 다음에 올 떼·보스의 차례 (무한 모드는 표의 끝을 지나서도 계속 센다) */
  swarmNext: number;
  bossNext: number;
  bossWarned: boolean;
  /** 최종 보스의 uid (아직 안 나왔으면 -1) */
  finalUid: number;
  cards: Card[];
  cardN: number;
  events: Ev[];
  evN: number;
  /** 이 걸음에 처치 알림을 이미 냈나 */
  killEv: boolean;
  /** 무기별 준 피해 합 (data/weapons.ts 번호) */
  dmgByWeapon: Float64Array;
  /** 받은 피해 합 */
  dmgTaken: number;
  /** 도감용: 이번 판에 만난 요괴·보스, 얻은 무기·패시브 (번호별 0/1) */
  seenEnemy: Uint8Array;
  seenBoss: Uint8Array;
  gotWeapon: Uint8Array;
  gotPassive: Uint8Array;
}
