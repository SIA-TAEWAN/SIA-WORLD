/**
 * 시아돌격대 기본 수치 (PRD.md). 단위: 거리 = 기준 화면 px(720×1280 기준), 시간 = 초.
 * 시뮬레이션(src/game/sim.ts)과 화면(src/scenes/GameScene.ts)이 모두 이 값을 쓴다.
 */

export const ZODIAC_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;
export type ZodiacId = (typeof ZODIAC_IDS)[number];
/** 대장으로 고를 수 있는 캐릭터: 십이지 12 + 고양이 (shared/characters.js 의 ALL_CHARACTER_IDS 와 같다) */
export type LeaderId = ZodiacId | 'cat';

/** 길 폭 (가운데가 x=0, 왼쪽 끝 -ROAD_W/2) */
export const ROAD_W = 560;
/** 앞으로 달리는 속도 */
export const RUN_SPEED = 300;
/** 좌우로 움직이는 최대 속도 */
export const MOVE_SPEED = 1100;
/** 대원 수 상한 */
export const MAX_TROOPS = 9999;
/** 화면에 실제로 그리는 대원 수 상한 (나머지는 숫자로만 보인다) */
export const DRAW_MAX = 300;
/** 사거리: 무리 앞쪽에서 이만큼 앞에 있는 것까지 쏜다 */
export const RANGE = 720;
/** 문에 이만큼 피해를 주면 숫자가 1 오른다 */
export const GATE_STEP_DMG = 45;
/** 총으로 올릴 수 있는 문 숫자 상한 */
export const GATE_CAP = 99;
/** 요괴 무리와 부딪히는 거리 (무리 앞쪽 기준) */
export const CLASH_DIST = 34;
/** 보스 앞 이 거리에서 멈춰 서서 싸운다 */
export const BOSS_STOP = 420;
/** 요괴 무리가 이 거리 안에 들어오면 움직이기 시작한다 */
export const HORDE_WAKE = 950;
/** 끝없는 모드: 화면에 보이는 거리(m) = z ÷ 이 값 */
export const METER = 50;

/** 대원 수 → 초당 화력. 대원이 많을수록 세지만 그대로 비례하지는 않는다 (× 문으로 수천 명이 돼도 판이 망가지지 않게) */
export function firePower(n: number): number {
  return n <= 0 ? 0 : 10 * Math.pow(n, 0.7);
}

/** 대원 수 → 무리 반지름 (좌우 폭의 절반). 무리가 클수록 넓게 퍼진다 */
export function crowdRadius(n: number): number {
  return n <= 0 ? 0 : Math.min(ROAD_W / 2 - 10, 12 + 5.5 * Math.sqrt(n));
}

export const ENEMY_IDS = ['imp', 'wisp', 'club', 'water', 'fox', 'bamboo', 'guard', 'skeleton', 'spirit'] as const;
export type EnemyKind = (typeof ENEMY_IDS)[number];

export interface EnemyDef {
  name: string;
  /** 도감 설명 */
  desc: string;
  /** 한 마리 체력 */
  hp: number;
  /** 부딪힐 때 한 마리가 없애는 대원 수 */
  strength: number;
  /** 다가오는 속도 */
  speed: number;
  /** 그림 이름 (public/art/<이름>.png) */
  art: string;
  /** 화면 높이 */
  size: number;
  /** 이 거리 안에 들어오기 전에는 숨어 있어서 맞힐 수 없다 (0 = 처음부터 보인다) */
  hidden?: number;
  /** 멀리서 쏜다: 사거리 안에 있으면 초마다 (마리 수 × rate) 명을 없앤다 */
  ranged?: { reach: number; rate: number };
  /** 방패: 정면(무리 가운데가 이 거리 안)에서 쏘면 피해가 shieldMul 배 */
  shield?: { reach: number; mul: number };
  /** 다 쓰러뜨리면 처음 수의 이 비율만큼 한 번 되살아난다 */
  revive?: number;
  /** 다가오는 동안 앞에 있는 좋은 문의 숫자를 초마다 1 낮춘다 */
  drain?: boolean;
}

/** 요괴 9종 (PRD 7장: 시아서바이벌·시아디펜스와 같은 요괴, 이 게임에 맞는 행동만 정한다) */
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  imp: { name: '꼬마 도깨비', desc: '기본 무리. 약하고 많다', hp: 10, strength: 1, speed: 45, art: 'e-imp', size: 42 },
  wisp: { name: '도깨비불', desc: '빠르게 달려와 부딪힌다', hp: 6, strength: 1, speed: 150, art: 'e-wisp', size: 38 },
  club: { name: '방망이 도깨비', desc: '단단하다. 한 마리가 대원 셋을 없앤다', hp: 45, strength: 3, speed: 22, art: 'e-club', size: 58 },
  water: { name: '물귀신', desc: '물웅덩이에 숨어 있다가 가까이 가면 튀어나온다', hp: 14, strength: 1, speed: 70, art: 'e-water', size: 44, hidden: 520 },
  fox: { name: '여우불', desc: '멀리서 불을 쏜다. 먼저 쓰러뜨리자', hp: 12, strength: 1, speed: 15, art: 'e-fox', size: 42, ranged: { reach: 650, rate: 0.12 } },
  bamboo: { name: '죽순 요괴', desc: '땅속에 있다가 바로 앞에서 솟아난다', hp: 18, strength: 2, speed: 0, art: 'e-bamboo', size: 46, hidden: 330 },
  guard: { name: '수문장 요괴', desc: '방패로 정면 사격을 막는다. 옆에서 쏘자', hp: 30, strength: 2, speed: 30, art: 'e-guard', size: 54, shield: { reach: 70, mul: 0.3 } },
  skeleton: { name: '해골 병사', desc: '쓰러져도 한 번 되살아난다', hp: 16, strength: 1, speed: 40, art: 'e-skeleton', size: 46, revive: 0.5 },
  spirit: { name: '원혼', desc: '다가오는 동안 앞의 좋은 문 숫자를 낮춘다', hp: 12, strength: 1, speed: 55, art: 'e-spirit', size: 44, drain: true },
};

export const BOSS_IDS = ['bigDokkaebi', 'dueoksini', 'bulgasal', 'jangsanbeom', 'centipede', 'gumiho', 'guardCaptain', 'yagwanggwi', 'imugi', 'reaper', 'gangcheori', 'yeomra'] as const;
export type BossId = (typeof BOSS_IDS)[number];
/** chief = 1~4번째 스테이지 끝의 작은 대장 요괴 (지역마다 그림이 다르다) */
export type BossKind = BossId | 'chief';

export interface BossArt {
  name: string;
  art: string;
  /** 화면에 그릴 높이 */
  size: number;
}

export const BOSS_ART: Record<BossId, BossArt> = {
  bigDokkaebi: { name: '큰 도깨비', art: 'b-bigDokkaebi', size: 250 },
  dueoksini: { name: '두억시니', art: 'b-dueoksini', size: 250 },
  bulgasal: { name: '불가살', art: 'b-bulgasal', size: 260 },
  jangsanbeom: { name: '장산범', art: 'b-jangsanbeom', size: 250 },
  centipede: { name: '왕지네', art: 'b-centipede', size: 260 },
  gumiho: { name: '구미호', art: 'b-gumiho', size: 260 },
  guardCaptain: { name: '수문장 대장', art: 'b-guardCaptain', size: 260 },
  yagwanggwi: { name: '야광귀', art: 'b-yagwanggwi', size: 240 },
  imugi: { name: '이무기', art: 'b-imugi', size: 270 },
  reaper: { name: '저승사자', art: 'b-reaper', size: 250 },
  gangcheori: { name: '강철이', art: 'b-gangcheori', size: 260 },
  yeomra: { name: '염라대왕', art: 'b-yeomra', size: 280 },
};

/** 지역 보스 도감 설명 (버릇은 data/stages.ts 의 BOSS_TRAITS 와 같은 내용이어야 한다) */
export const BOSS_DESC: Record<BossId, string> = {
  bigDokkaebi: '큰 방망이를 넓게 내리친다. 한 번 맞으면 많이 잃는다',
  dueoksini: '싸우는 중에 꼬마 도깨비 무리를 불러낸다',
  bulgasal: '싸움이 길어질수록 단단해진다. 빨리 쓰러뜨리자',
  jangsanbeom: '예고가 짧고 공격이 잦다. 눈을 떼지 말자',
  centipede: '긴 몸으로 길의 절반 넘게 휩쓴다. 끝까지 비켜 서자',
  gumiho: '한 번에 두 군데를 친다. 빈 곳을 찾자',
  guardCaptain: '방패로 정면 사격을 막고 수문장 요괴를 부른다. 가운데를 비켜 쏘자',
  yagwanggwi: '맞으면 잠깐 얼어붙어 쏘지 못한다',
  imugi: '넓은 공격을 두 군데에 한꺼번에 떨어뜨린다',
  reaper: '예고가 짧은 공격을 두 군데에 내리친다',
  gangcheori: '친 자리에 불길이 남아 대원을 태운다',
  yeomra: '두 군데를 치고 해골 병사를 불러낸다',
};

/** 작은 대장 요괴: 그 지역 요괴 하나를 크게 */
export function chiefArt(region: number): BossArt {
  const k: EnemyKind = region <= 3 ? 'club' : region <= 6 ? 'water' : region <= 9 ? 'guard' : 'skeleton';
  return { name: `${ENEMIES[k].name} 대장`, art: ENEMIES[k].art, size: 170 };
}

export const bossArt = (kind: BossKind, region: number): BossArt => (kind === 'chief' ? chiefArt(region) : BOSS_ART[kind]);

export type ObstacleKind = 'log' | 'blade' | 'pit';

export const OBSTACLES: Record<ObstacleKind, { name: string; half: number; harm: number }> = {
  /** 길을 가로질러 굴러다니는 통나무 */
  log: { name: '통나무', half: 70, harm: 0.5 },
  /** 제자리에서 도는 칼날 */
  blade: { name: '회전 칼날', half: 60, harm: 0.6 },
  /** 길에 파인 구덩이 */
  pit: { name: '구덩이', half: 90, harm: 0.4 },
};

export type CrateReward = { kind: 'troops'; v: number } | { kind: 'coins'; v: number } | { kind: 'power'; sec: number };
/** 상자 체력 */
export const CRATE_HP = 220;
/** 화력 강화 상자: 이 배율로 */
export const POWER_MUL = 2;

export interface LeaderDef {
  id: LeaderId;
  name: string;
  trait: string;
  /** 처음 열려 있는 대장인가 (아니면 unlockRegion 지역을 클리어하면 열린다) */
  starter: boolean;
  /** 이 지역 5번째 스테이지를 클리어하면 열린다. -1 = 지역으로 열리지 않는 추가 캐릭터 (고양이: 대장 고르기 화면에서 시아코인으로 연다, 게임마다 따로) */
  unlockRegion: number;
  /** 십이지 밖의 추가 캐릭터 (진행으로 열리지 않는다, progress.ts 의 extraOpen) */
  extra?: boolean;
  /** 시작 대원 배율 */
  startMul: number;
  /** 요괴·보스·장애물에 잃는 대원 배율 */
  lossMul: number;
  /** 요괴 무리와 부딪힐 때만 잃는 대원 배율 */
  clashMul: number;
  /** 보스에게 주는 피해 배율 */
  bossMul: number;
  /** 좌우 이동 속도 배율 */
  moveMul: number;
  /** 문에 주는 피해 배율 (숫자가 오르는 속도) */
  gateMul: number;
  /** 요괴 무리에게 주는 피해 배율 */
  hordeMul: number;
  /** 사거리 배율 */
  rangeMul: number;
  /** 상자 보상 배율 */
  crateMul: number;
  /** × 문 결과 배율 */
  timesMul: number;
  /** 보스 공격 예고를 이만큼 더 일찍 */
  warnAdd: number;
  /** 보스에게 잃는 대원 배율 */
  bossLossMul: number;
  /** 엽전 배율 (서버도 같은 값으로 계산한다) */
  coinMul: number;
  /** 대원이 모두 쓰러졌을 때 다시 일어나는 횟수 (고양이 "아홉 목숨") */
  lives: number;
  /** 다시 일어날 때 대원 = max(livesMin, 이번 판 최대 대원 × livesFrac) */
  livesFrac: number;
  livesMin: number;
}

const base = {
  startMul: 1, lossMul: 1, clashMul: 1, bossMul: 1, moveMul: 1, gateMul: 1, hordeMul: 1, rangeMul: 1, crateMul: 1, timesMul: 1, warnAdd: 0, bossLossMul: 1, coinMul: 1, lives: 0, livesFrac: 0, livesMin: 0,
};

/** 대장 12종 + 고양이 (PRD 6장). 차이는 10% 안팎으로 작게. 해금 지역은 SQL(_charge_regions)과 같다 */
export const LEADERS: LeaderDef[] = [
  { ...base, id: 'rat', name: '쥐', trait: '시작 대원 +10%', starter: true, unlockRegion: 0, startMul: 1.1 },
  { ...base, id: 'ox', name: '소', trait: '요괴·보스·장애물에 잃는 대원 -10%', starter: true, unlockRegion: 0, lossMul: 0.9 },
  { ...base, id: 'tiger', name: '호랑이', trait: '보스에게 주는 피해 +10%', starter: true, unlockRegion: 0, bossMul: 1.1 },
  { ...base, id: 'rabbit', name: '토끼', trait: '좌우 이동 속도 +15%', starter: false, unlockRegion: 1, moveMul: 1.15 },
  { ...base, id: 'dragon', name: '용', trait: '문 숫자 오르는 속도 +10%', starter: false, unlockRegion: 2, gateMul: 1.1 },
  { ...base, id: 'snake', name: '뱀', trait: '요괴 무리에게 주는 피해 +10%', starter: false, unlockRegion: 3, hordeMul: 1.1 },
  { ...base, id: 'horse', name: '말', trait: '사거리 +10%', starter: false, unlockRegion: 4, rangeMul: 1.1 },
  { ...base, id: 'sheep', name: '양', trait: '요괴와 부딪힐 때 잃는 대원 -10%', starter: false, unlockRegion: 5, clashMul: 0.9 },
  { ...base, id: 'monkey', name: '원숭이', trait: '상자 보상 +20%', starter: false, unlockRegion: 6, crateMul: 1.2 },
  { ...base, id: 'rooster', name: '닭', trait: '× 문 결과 +5%', starter: false, unlockRegion: 7, timesMul: 1.05 },
  { ...base, id: 'dog', name: '개', trait: '보스 공격 예고 0.3초 빨리, 보스에게 잃는 대원 -10%', starter: false, unlockRegion: 8, warnAdd: 0.3, bossLossMul: 0.9 },
  { ...base, id: 'pig', name: '돼지', trait: '엽전 획득 +10%', starter: false, unlockRegion: 9, coinMul: 1.1 },
  // 13번째 대원: 수치 대신 한 번 쓰는 특성. 지역으로 열리지 않는다 (대장 고르기 화면에서 시아코인으로 연다, 게임마다 따로)
  { ...base, id: 'cat', name: '고양이', trait: '아홉 목숨: 모두 쓰러져도 한 번, 이번 판 최대 대원의 15%(최소 9명)로 다시 일어나요', starter: false, unlockRegion: -1, extra: true, lives: 1, livesFrac: 0.15, livesMin: 9 },
];

export const leaderOf = (id: string): LeaderDef => LEADERS.find((l) => l.id === id) ?? LEADERS[0];
export const STARTERS: LeaderId[] = LEADERS.filter((l) => l.starter).map((l) => l.id);
