import type { ZodiacId } from './balance';
import type { Mod } from './stats';

/**
 * 캐릭터 12종 (PRD 4장). 기본 체력·이동 속도는 모두 같고(data/balance.ts 의 PLAYER),
 * 시작 무기와 10% 안팎의 고유 특성만 다르다.
 */
export interface CharacterDef {
  id: ZodiacId;
  /** 띠 이름 */
  name: string;
  /** 캐릭터 이름 (DESIGN.md 6장) */
  nick: string;
  /** 시작 무기 (data/weapons.ts) */
  weapon: string;
  trait: Mod & { text: string };
  /** 해금 조건 (저장·해금은 4단계. 지금은 표시 자리만) */
  unlock: { kind: 'base' | 'time' | 'boss' | 'kills' | 'cakes' | 'coins' | 'clear'; value?: number; text: string };
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'rat', name: '쥐', nick: '찍찍이', weapon: 'shuriken', trait: { stat: 'xp', value: 0.1, text: '경험치 +10%' }, unlock: { kind: 'base', text: '처음부터' } },
  { id: 'ox', name: '소', nick: '우직이', weapon: 'bell', trait: { stat: 'maxHpPct', value: 0.1, text: '최대 체력 +10%' }, unlock: { kind: 'base', text: '처음부터' } },
  { id: 'tiger', name: '호랑이', nick: '어흥이', weapon: 'claw', trait: { stat: 'might', value: 0.08, text: '공격력 +8%' }, unlock: { kind: 'base', text: '처음부터' } },
  { id: 'rabbit', name: '토끼', nick: '깡총이', weapon: 'mooncake', trait: { stat: 'speed', value: 0.08, text: '이동 속도 +8%' }, unlock: { kind: 'time', value: 300, text: '5분 버티기' } },
  { id: 'dragon', name: '용', nick: '여의룡', weapon: 'pearl', trait: { stat: 'area', value: 0.1, text: '무기 범위 +10%' }, unlock: { kind: 'boss', value: 1, text: '중간 보스 물리치기' } },
  { id: 'snake', name: '뱀', nick: '스르르', weapon: 'mist', trait: { stat: 'dot', value: 0.1, text: '지속 피해 +10%' }, unlock: { kind: 'kills', value: 1000, text: '요괴 1,000마리 물리치기' } },
  { id: 'horse', name: '말', nick: '따각이', weapon: 'hoof', trait: { stat: 'taken', value: 0.05, text: '받는 피해 -5%' }, unlock: { kind: 'time', value: 480, text: '8분 버티기' } },
  { id: 'sheep', name: '양', nick: '몽실이', weapon: 'wool', trait: { stat: 'regen', value: 0.25, text: '체력이 조금씩 회복' }, unlock: { kind: 'cakes', value: 50, text: '떡 50개 먹기' } },
  { id: 'monkey', name: '원숭이', nick: '재롱이', weapon: 'staff', trait: { stat: 'cooldown', value: 0.08, text: '재사용 대기시간 -8%' }, unlock: { kind: 'coins', value: 500, text: '엽전 500닢' } },
  { id: 'rooster', name: '닭', nick: '꼬꼬댁', weapon: 'feather', trait: { stat: 'projSpeed', value: 0.1, text: '투사체 속도 +10%' }, unlock: { kind: 'coins', value: 1000, text: '엽전 1,000닢' } },
  { id: 'dog', name: '개', nick: '멍뭉이', weapon: 'puppy', trait: { stat: 'pickup', value: 0.2, text: '아이템 획득 범위 +20%' }, unlock: { kind: 'coins', value: 1500, text: '엽전 1,500닢' } },
  { id: 'pig', name: '돼지', nick: '꿀꿀이', weapon: 'piggy', trait: { stat: 'coin', value: 0.1, text: '엽전 획득 +10%' }, unlock: { kind: 'clear', text: '10분 버텨 내기' } },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c])) as Record<ZodiacId, CharacterDef>;
