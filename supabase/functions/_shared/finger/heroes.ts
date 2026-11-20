/**
 * 시아핑거 대원 (PRD "캐릭터 12종"). 서버(finger-finish)가 같은 표로 판을 다시 돌리므로 여기에 둔다.
 * 능력치 차이는 10% 안팎으로 작게 둔다.
 */

export const HERO_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;
export type HeroId = (typeof HERO_IDS)[number];

/** 반사형: 요괴에서 튕겨 나온다 · 관통형: 요괴를 뚫고 지나간다 */
export type HeroType = 'reflect' | 'pierce';

/** 우정 콤보 (날아가는 대원이 가만히 있는 이 대원을 스치면 한 번) */
export type ComboKind =
  | 'shuriken' // 표창 4방향 (대각선)
  | 'quake' // 땅 울림: 주변 작은 폭발
  | 'laserH' // 가로 레이저
  | 'heal' // 회복 구슬: 모든 대원 체력 조금
  | 'laserV' // 세로 레이저
  | 'poison' // 독: 주변 요괴가 매 턴 조금씩 피해
  | 'kick' // 가장 가까운 요괴 날려차기
  | 'guard' // 보호막: 모든 대원의 다음 피해 반
  | 'balls' // 튕김 구슬 3개: 가까운 요괴 3마리
  | 'cleanse' // 주변 효과 지우기 + 작은 피해
  | 'fang' // 따라가는 이빨: 가장 가까운 요괴 두 번
  | 'coin'; // 엽전 조금

/** 필살기 (충전 턴이 차면 그 대원 차례에 쓴다) */
export type SpecialKind =
  | 'swift' // 쥐: 이번 발사 속도 2배
  | 'charge' // 소: 크기 2배 관통
  | 'roar' // 호랑이: 모든 요괴 턴 +1
  | 'mooncake' // 토끼: 모든 대원 회복 + 쓰러진 대원 1명 일으키기
  | 'dragonfall' // 용: 화면 전체 피해
  | 'coil' // 뱀: 한 요괴 턴 멈춤
  | 'dash' // 말: 멈춘 뒤 한 번 더 달림
  | 'wool' // 양: 2턴 동안 받는 피해 반
  | 'clone' // 원숭이: 작은 분신 2명이 함께 날아감
  | 'dawn' // 닭: 다른 대원 필살기 충전 +2
  | 'hunt' // 개: 체력 낮은 요괴 3마리 공격
  | 'roll'; // 돼지: 벽에 닿을 때마다 피해 커짐

export interface HeroDef {
  id: HeroId;
  name: string;
  type: HeroType;
  /** 레벨 1 체력 */
  hp: number;
  /** 레벨 1 공격력 (요괴에 한 번 부딪힐 때 피해) */
  atk: number;
  combo: ComboKind;
  comboName: string;
  special: SpecialKind;
  specialName: string;
  /** 필살기 충전 턴 (판 전체 턴 기준: 누가 쏘든 한 턴 끝날 때마다 1씩 찬다) */
  charge: number;
  /** 0 = 처음부터, n = n지역 5번째 스테이지를 깨면 합류 */
  unlockRegion: number;
}

/** 대원 12종 (PRD 표). 충전 턴·세기는 초안 — 5단계 밸런스에서 조정 */
export const HEROES: Record<HeroId, HeroDef> = {
  rat: { id: 'rat', name: '쥐', type: 'reflect', hp: 100, atk: 30, combo: 'shuriken', comboName: '표창 4방향', special: 'swift', specialName: '다음 발사 속도 2배', charge: 4, unlockRegion: 0 },
  ox: { id: 'ox', name: '소', type: 'pierce', hp: 115, atk: 33, combo: 'quake', comboName: '땅 울림', special: 'charge', specialName: '돌진: 크기 2배 관통', charge: 6, unlockRegion: 0 },
  tiger: { id: 'tiger', name: '호랑이', type: 'reflect', hp: 105, atk: 32, combo: 'laserH', comboName: '가로 레이저', special: 'roar', specialName: '포효: 모든 요괴 턴 +1', charge: 8, unlockRegion: 0 },
  rabbit: { id: 'rabbit', name: '토끼', type: 'reflect', hp: 100, atk: 29, combo: 'heal', comboName: '회복 구슬', special: 'mooncake', specialName: '달떡: 모두 회복 + 1명 일으키기', charge: 7, unlockRegion: 1 },
  dragon: { id: 'dragon', name: '용', type: 'pierce', hp: 105, atk: 33, combo: 'laserV', comboName: '세로 레이저', special: 'dragonfall', specialName: '용살: 화면 전체 피해', charge: 10, unlockRegion: 2 },
  snake: { id: 'snake', name: '뱀', type: 'reflect', hp: 100, atk: 30, combo: 'poison', comboName: '독', special: 'coil', specialName: '똬리: 한 요괴 턴 멈춤', charge: 6, unlockRegion: 3 },
  horse: { id: 'horse', name: '말', type: 'pierce', hp: 105, atk: 32, combo: 'kick', comboName: '날려차기', special: 'dash', specialName: '질주: 한 번 더 달림', charge: 6, unlockRegion: 4 },
  sheep: { id: 'sheep', name: '양', type: 'reflect', hp: 110, atk: 28, combo: 'guard', comboName: '보호막', special: 'wool', specialName: '양털 장막: 2턴 피해 반', charge: 7, unlockRegion: 5 },
  monkey: { id: 'monkey', name: '원숭이', type: 'reflect', hp: 100, atk: 30, combo: 'balls', comboName: '튕김 구슬 3개', special: 'clone', specialName: '분신: 작은 대원 2명', charge: 8, unlockRegion: 6 },
  rooster: { id: 'rooster', name: '닭', type: 'pierce', hp: 100, atk: 31, combo: 'cleanse', comboName: '주변 효과 지우기', special: 'dawn', specialName: '새벽 울음: 모든 필살기 +2', charge: 9, unlockRegion: 7 },
  dog: { id: 'dog', name: '개', type: 'reflect', hp: 105, atk: 31, combo: 'fang', comboName: '따라가는 이빨', special: 'hunt', specialName: '쫓기: 약한 요괴 3마리', charge: 7, unlockRegion: 8 },
  pig: { id: 'pig', name: '돼지', type: 'pierce', hp: 115, atk: 30, combo: 'coin', comboName: '엽전 조금', special: 'roll', specialName: '굴러가기: 벽마다 피해 커짐', charge: 8, unlockRegion: 9 },
};

export const isHeroId = (id: unknown): id is HeroId => typeof id === 'string' && (HERO_IDS as readonly string[]).includes(id);

/** 대원 레벨 상한 (PRD "성장·재화") */
export const MAX_LEVEL = 30;

/** 공통 강화 4종 (PRD). 값은 단계 수 — 가격표는 games/finger/src/data (4단계) */
export type UpgradeKey = 'hp' | 'charge' | 'heal' | 'coin';
export type Upgrades = Partial<Record<UpgradeKey, number>>;
/** 강화 단계 상한 */
export const UPGRADE_MAX: Record<UpgradeKey, number> = { hp: 20, charge: 5, heal: 10, coin: 5 };

const upLv = (up: Upgrades, k: UpgradeKey) => Math.max(0, Math.min(UPGRADE_MAX[k], Math.floor(up[k] ?? 0)));
const clampLevel = (lv: number | undefined) => Math.max(1, Math.min(MAX_LEVEL, Math.floor(lv ?? 1)));

/** 판에 들어가는 대원 능력치 (레벨·강화 반영). 서버도 DB 에 남은 레벨·강화로 같은 값을 만든다 */
export interface HeroStats {
  hp: number;
  atk: number;
  /** 우정 콤보 단계 1~4 (레벨 10·20·30 에 한 단계씩) */
  comboTier: number;
  /** 필살기 처음 충전 (강화 '필살기 충전 속도' 한 단계 = 1턴 먼저) */
  charge0: number;
  /** 회복량 배율 (강화 '회복량' 한 단계 +10%) */
  healMul: number;
}

/**
 * 레벨 → 능력치: 레벨당 체력·공격력 +4% (레벨 1 기준, 내림).
 * 강화 '시작 체력' 한 단계 +3%.
 */
export function heroStats(id: HeroId, level?: number, up: Upgrades = {}): HeroStats {
  const d = HEROES[id];
  const lv = clampLevel(level);
  const grow = 1 + 0.04 * (lv - 1);
  return {
    hp: Math.floor(d.hp * grow * (1 + 0.03 * upLv(up, 'hp'))),
    atk: Math.floor(d.atk * grow),
    comboTier: 1 + Math.floor(lv / 10),
    charge0: Math.min(d.charge, upLv(up, 'charge')),
    healMul: 1 + 0.1 * upLv(up, 'heal'),
  };
}
