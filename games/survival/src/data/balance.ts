/**
 * 공통 상수. 판의 느낌을 바꾸는 숫자는 모두 src/data/ 에 있다 (PRD 1장: 수치는 데이터 파일로).
 * 길이 단위는 기준 화면(가로 720)의 px, 시간은 초.
 */

/** 계산 한 걸음 (고정 1/60초) */
export const TICK = 1 / 60;
export const TICKS_PER_SEC = 60;
/** 한 판 길이: 4분이 되면 최종 보스가 나온다 */
export const RUN_SEC = 240;
/**
 * 판의 모드: normal 4분 모드 (최종 보스를 잡으면 클리어) · endless 무한 모드 (4분 뒤로도 죽을 때까지 계속)
 *   · hell 헬 모드 (4분 판. 같은 맵·요괴·보스가 더 강하고, 보스마다 패턴이 하나 더 있고, 엽전을 2배로 준다)
 */
export type RunMode = 'normal' | 'endless' | 'hell';
export const RUN_MODES: readonly RunMode[] = ['normal', 'endless', 'hell'];

/**
 * 헬 모드: 그 맵을 4분 모드로 클리어하면 열린다. 배경·요괴·보스는 같고 더 강하다 (체감 약 1.5배).
 * 아래 값은 맵의 '요괴 강함'(data/maps.ts 의 power)에 곱한다. 맵마다 더 곱하는 값은 data/maps.ts 의 hell (영구 강화 49레벨 · 보통 실력으로 클리어율 10~25% 가 되게 맞춘 값).
 *   hp 요괴 체력 · dmg 요괴가 주는 피해(닿았을 때·여우불) · count 등장 수 · speed 이동 속도 · boss 보스 체력 · bossDmg 보스가 주는 피해(몸·범위 공격·탄)
 * 보스마다 헬 전용 패턴이 하나씩 더 있다 (data/bosses.ts 의 hell).
 */
export const HELL = {
  hp: 1.25,
  dmg: 1.2,
  count: 1.1,
  speed: 1,
  boss: 1.5,
  bossDmg: 1.2,
  /** 엽전 배율 (서버의 hell_coin_mul 과 같다): 주운 엽전이 2배, 서버의 판당 엽전 상한도 2배 */
  coin: 2,
};

/**
 * 무한 모드: 4분까지는 4분 모드와 완전히 같고, 그 뒤로는 끝없이 버틸 수 없게 요괴가 가파르게 강해진다.
 * 배율은 4분 뒤로 m분이 지났을 때 1 + perMin × m + perMin2 × m² (4분까지의 성장(data/maps.ts 의 growth)에 곱한다).
 *   hp 요괴 체력 · dmg 요괴·보스가 주는 피해 · count 등장 수 · bossHp 다시 나오는 보스의 체력
 * 요괴 수 상한(LIMIT.enemies)과 풀 크기는 그대로다.
 */
export const ENDLESS = {
  /** 이 시간(20분)이 되면 판을 끝낸다 (서버의 endless_max_time 과 같다. 실제로는 한참 전에 죽는다: 가장 긴 판이 10분 30초쯤) */
  maxSec: 1200,
  /** 최종 보스 뒤로 이 간격마다 그 맵의 보스가 번갈아 다시 나온다 (서버의 endless_boss_every 와 같다) */
  bossEvery: 80,
  /** 이 간격마다 그 맵의 떼 이벤트가 번갈아 다시 온다 (첫 번째는 4분 + 간격의 절반) */
  swarmEvery: 40,
  hp: { perMin: 0.25, perMin2: 0.06 },
  dmg: { perMin: 0.15, perMin2: 0.03 },
  count: { perMin: 0.15, perMin2: 0 },
  bossHp: { perMin: 0.4, perMin2: 0.05 },
};

/** 기준 화면 */
export const VIEW_W = 720;
export const VIEW_H = 1280;

/**
 * 고를 수 있는 캐릭터: 십이지 12 + 고양이(cat, "13번째 대원").
 * 서버의 _character_ids()(071) · shared/characters.js 의 ALL_CHARACTER_IDS 와 같은 순서다.
 * 고양이는 판 결과·엽전으로 풀지 않는다 (캐릭터 고르기 화면에서 시아코인으로 연다. 게임마다 따로)
 */
export const CHAR_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig', 'cat'] as const;
export type CharId = (typeof CHAR_IDS)[number];

/** 내 캐릭터 기본값 (캐릭터 13종 모두 같다. PRD 4장) */
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
