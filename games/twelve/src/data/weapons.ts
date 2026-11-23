/**
 * 무기 4종 (PRD '장비'): 기본 공격 + 스킬 2개. 숫자는 초안.
 * 공격력(등급·강화·레어)은 4단계 장비 표가 정하고, 여기는 무기 종류마다의 공격 모양만 정한다.
 */
import type { Act } from './acts';

export const WEAPON_KINDS = ['sword', 'spear', 'bow', 'fan'] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

export interface SkillDef {
  name: string;
  desc: string;
  /** 버튼 그림 글자 */
  icon: string;
  mp: number;
  /** 재사용 대기 (초) */
  cd: number;
  acts: Act[];
  /** 효과음 (shared/sound.js) */
  sound: string;
}

export interface WeaponDef {
  kind: WeaponKind;
  name: string;
  icon: string;
  desc: string;
  /** 기본 공격: 누르고 있으면 cd 마다 이어진다 */
  basic: SkillDef;
  skills: [SkillDef, SkillDef];
  /** 조준 보정 거리 */
  aim: number;
}

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  sword: {
    kind: 'sword', name: '칼', icon: '🗡️', desc: '앞쪽 반원을 빠르게 벤다', aim: 170,
    basic: { name: '베기', desc: '앞쪽 반원 베기', icon: '🗡️', mp: 0, cd: 0.42, sound: 'survSlash', acts: [{ t: 'hit', shape: { k: 'arc', r: 108, half: 1.2 }, mul: 1, kb: 110 }] },
    skills: [
      {
        name: '연속 베기', desc: '빠르게 세 번 벤다', icon: '⚔️', mp: 12, cd: 5, sound: 'survSlash',
        acts: [0, 0.14, 0.28].map((at): Act => ({ t: 'hit', at, shape: { k: 'arc', r: 120, half: 1.3 }, mul: 0.95, kb: 60 })),
      },
      { name: '돌진 베기', desc: '앞으로 돌진하며 벤다', icon: '💨', mp: 16, cd: 7, sound: 'boost', acts: [{ t: 'dash', dist: 300, time: 0.2, w: 80, mul: 2.3, kb: 140 }] },
    ],
  },
  spear: {
    kind: 'spear', name: '창', icon: '🔱', desc: '길고 좁게 찌른다', aim: 220,
    basic: { name: '찌르기', desc: '길고 좁게 찌르기', icon: '🔱', mp: 0, cd: 0.62, sound: 'survSlash', acts: [{ t: 'hit', shape: { k: 'line', len: 185, w: 52 }, mul: 1.4, kb: 130 }] },
    skills: [
      { name: '회전 베기', desc: '주변을 전부 휩쓴다', icon: '🌀', mp: 14, cd: 6, sound: 'survSlash', acts: [{ t: 'hit', shape: { k: 'circle', r: 170 }, mul: 1.9, kb: 180 }] },
      {
        name: '창 던지기', desc: '멀리 뚫고 날아간다', icon: '☄️', mp: 16, cd: 6, sound: 'survShot',
        acts: [{ t: 'shot', n: 1, spread: 0, speed: 900, range: 760, radius: 20, mul: 2.5, pierce: 99, look: 'spear', kb: 80 }],
      },
    ],
  },
  bow: {
    kind: 'bow', name: '활', icon: '🏹', desc: '멀리 한 발씩 쏜다', aim: 560,
    basic: {
      name: '쏘기', desc: '멀리 한 발', icon: '🏹', mp: 0, cd: 0.8, sound: 'survShot',
      acts: [{ t: 'shot', n: 1, spread: 0, speed: 840, range: 660, radius: 11, mul: 1.55, pierce: 0, look: 'arrow', kb: 60 }],
    },
    skills: [
      { name: '화살 비', desc: '요괴가 있는 자리에 화살이 쏟아진다', icon: '🌧️', mp: 18, cd: 8, sound: 'survShot', acts: [{ t: 'zone', look: 'rain', ahead: 300, aim: 540, r: 150, dur: 2.4, tick: 0.4, mul: 0.75 }] },
      {
        name: '세 갈래 화살', desc: '부채꼴로 세 발', icon: '🪶', mp: 10, cd: 4, sound: 'survShot',
        acts: [{ t: 'shot', n: 3, spread: 0.3, speed: 840, range: 600, radius: 11, mul: 1.3, pierce: 1, look: 'arrow', kb: 60 }],
      },
    ],
  },
  fan: {
    kind: 'fan', name: '부채', icon: '🪭', desc: '마법 구슬을 날린다 (마력 조금)', aim: 480,
    basic: {
      name: '구슬', desc: '작은 마법 구슬', icon: '🪭', mp: 1, cd: 0.5, sound: 'survShot',
      acts: [{ t: 'shot', n: 1, spread: 0, speed: 560, range: 520, radius: 15, mul: 1.2, pierce: 0, look: 'orb', kb: 50 }],
    },
    skills: [
      { name: '회오리바람', desc: '요괴를 끌어당기며 벤다', icon: '🌪️', mp: 18, cd: 9, sound: 'boost', acts: [{ t: 'zone', look: 'wind', ahead: 240, aim: 420, r: 175, dur: 3, tick: 0.5, mul: 0.55, pull: 150 }] },
      { name: '번개', desc: '요괴를 따라 번지는 번개', icon: '⚡', mp: 16, cd: 6, sound: 'tankLaser', acts: [{ t: 'chain', range: 480, jumps: 5, jumpRange: 250, mul: 1.7, falloff: 0.85, stun: 0.3 }] },
    ],
  },
};

/** 착용 레벨 12단계 (PRD: 9단위) */
export const TIER_LEVELS = [1, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99] as const;
/** 등급(0~11)별 일반 무기 공격력 (초안 — 4단계 장비 표에서 다시 정한다) */
export const tierAtk = (tier: number) => 8 + 14 * tier + tier * tier;
/** 그 레벨에 낄 수 있는 가장 높은 등급 */
export const tierForLevel = (level: number) => Math.max(0, TIER_LEVELS.filter((l) => l <= level).length - 1);
