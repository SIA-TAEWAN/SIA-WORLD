/**
 * 공통 상수. 판의 느낌을 바꾸는 숫자는 모두 src/data/ 에 있다 (PRD 1장: 수치는 데이터 파일로).
 * 길이 단위는 기준 화면(가로 720)의 px, 시간은 초.
 */

/** 계산 한 걸음 (고정 1/60초) */
export const TICK = 1 / 60;
export const TICKS_PER_SEC = 60;
/** 한 판 길이: 4분이 되면 최종 보스가 나온다 */
export const RUN_SEC = 240;
/** 기준 화면 */
export const VIEW_W = 720;
export const VIEW_H = 1280;

export const ZODIAC_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;
export type ZodiacId = (typeof ZODIAC_IDS)[number];

/** 내 캐릭터 기본값 (캐릭터 12종 모두 같다. PRD 4장) */
export const PLAYER = {
  hp: 100,
  /** 이동 속도 (px/초) */
  speed: 190,
  /** 판정 원 반지름 */
  r: 16,
  /** 맞은 뒤 무적 시간 */
  invSec: 0.6,
  /** 아이템이 빨려오기 시작하는 거리 */
  pickupR: 72,
  /** 빨려오는 속도 */
  magnetSpeed: 560,
  /** 부활 직후 무적 시간, 부활할 때 주변 요괴를 밀어내는 폭발 반지름 */
  reviveInvSec: 2.5,
  reviveBlastR: 340,
};

/** 한 번에 화면에 둘 수 있는 수 (오브젝트 풀 크기) */
export const LIMIT = {
  /** 일반 요괴 출현 상한 (이 수를 넘으면 더 나오지 않는다) */
  enemies: 300,
  /** 풀 크기: 보스·소환까지 여유 */
  enemyPool: 340,
  projectiles: 256,
  zones: 64,
  pickups: 400,
  fx: 96,
  nums: 64,
  /** 무기·패시브 최대 개수와 최대 레벨 (PRD 3장) */
  weapons: 6,
  passives: 6,
  level: 5,
};

/** 요괴가 나타나는 자리: 내 캐릭터를 가운데 둔 사각형의 둘레 (세로로 긴 휴대폰 화면 밖) */
export const SPAWN = {
  halfW: 440,
  halfH: 860,
  /** 이보다 멀어진 요괴는 내 근처(위 사각형 둘레)로 다시 놓는다 */
  farW: 780,
  farH: 1260,
};

/** 다음 레벨까지 필요한 경험치 (lv: 지금 레벨) */
export const xpNeed = (lv: number) => Math.round(2 + 1.6 * (lv - 1) + 0.14 * (lv - 1) * (lv - 1));

/** 보스 등장 몇 초 전에 경고를 띄우나 */
export const BOSS_WARN_SEC = 3;

/** 레벨업 카드 수, 고를 것이 없을 때 대신 나오는 카드 */
export const CARD_COUNT = 3;
export const BONUS = { heal: 30, coins: 10 };

/**
 * 카드가 뽑힐 가중치 (나머지 카드는 1). 진화(무기 5레벨 + 짝 패시브)가 카드 운에만 달리지 않게, 키우던 것이 더 자주 나온다.
 *   ownedWeapon: 이미 가진 무기의 강화 카드
 *   evoWeapon: 가진 무기 가운데 진화가 있는 무기(data/evolutions.ts)의 강화 카드 (ownedWeapon 대신 이 값)
 *   evoPassive: 가진 무기의 진화 짝 패시브를 아직 못 얻었을 때 그 패시브 카드
 * 가진 무기 전부를 똑같이 올리면 무기가 6개로 늘수록 서로 묻혀서, 진화할 무기를 한 단계 더 올린다.
 */
export const CARD_WEIGHT = { ownedWeapon: 2, evoWeapon: 3, evoPassive: 4 };

/** 보물상자: 진화할 것이 없을 때 주는 엽전 */
export const CHEST_COINS = 30;

/** 요괴끼리 겹치지 않게 밀어내는 정도 (0~1) */
export const SEPARATION = 0.5;

/** 개발용: 시작 시각을 건너뛸 때(?t=160) 그 시각까지 올랐을 법한 레벨 (초당) */
export const DEV_LEVEL_PER_SEC = 1 / 9;

/** 능력치 하한·상한 */
export const CLAMP = { cooldownMin: 0.4, takenMin: 0.3 };
