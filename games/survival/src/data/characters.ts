import type { CharId } from './balance';
import type { Mod } from './stats';

/** 고양이 특성 '몸놀림'의 간격 (초): 이만큼마다 맞는 피해 한 번을 통째로 피한다 (밸런스: npm run balance -- <판 수> chars) */
export const DODGE_SEC = 18;

/**
 * 시아코인으로 여는 캐릭터의 값. 게임마다 따로 연다 (이 게임의 캐릭터 고르기 화면, owned_characters 의 game = 'survival').
 * 071 의 _character_price · shared/characters.js 의 CHARACTER_PRICE 와 같아야 한다 (tests/sql.test.ts 가 대조)
 */
export const CHARACTER_PRICE: Record<string, number> = { cat: 100 };
/**
 * 고양이를 살 수 있는 진행 조건: 맵 몇 개를 4분 모드로 클리어했나 (서버 073 의 _cat_progress_survival 의 need 와 같다, tests/sql.test.ts 가 대조).
 * 클리어 판정은 프로필의 clearedMaps 와 같다 (클리어 기록이 있거나 다음 맵이 열려 있다)
 */
export const SURVIVAL_CAT_MAPS = 2;
/** 조건을 아직 못 넘었을 때의 안내 (have: 지금 클리어한 맵 수, 모르면 null) */
export const catConditionText = (have: number | null) =>
  `맵 ${SURVIVAL_CAT_MAPS}개를 클리어하면 열 수 있어요${have === null ? '' : ` · 지금 ${have}개`}`;
/** 잠긴 캐릭터의 버튼 글 (shared/characters.js 의 unlockLabel 과 같은 글) */
export const unlockLabel = (id: string) => `시아코인 ${CHARACTER_PRICE[id] ?? ''}개로 열기`;

/**
 * 캐릭터 13종 (PRD 4장: 십이지 12 + 고양이). 기본 체력·이동 속도는 모두 같고(data/balance.ts 의 PLAYER),
 * 시작 무기와 10% 안팎의 고유 특성만 다르다.
 * 고양이는 시작 무기가 호랑이와 같은 발톱이고, 특성은 다른 캐릭터에 없는 '몸놀림'(일정 간격마다 피해 한 번을 피한다, stats.ts 의 dodge)이다.
 */
export interface CharacterDef {
  id: CharId;
  /** 띠 이름 */
  name: string;
  /** 캐릭터 이름 (DESIGN.md 6장) */
  nick: string;
  /** 시작 무기 (data/weapons.ts) */
  weapon: string;
  trait: Mod & { text: string };
  /** 해금 조건. sia: 판 결과·엽전으로는 풀지 않고 캐릭터 고르기 화면에서 시아코인으로 연다 (게임마다 따로. value = 값, 071 의 _check_character) */
  unlock: { kind: 'base' | 'time' | 'boss' | 'kills' | 'cakes' | 'coins' | 'clear' | 'sia'; value?: number; text: string };
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'rat', name: '쥐', nick: '찍찍이', weapon: 'shuriken', trait: { stat: 'xp', value: 0.1, text: '경험치 +10%' }, unlock: { kind: 'base', text: '처음부터' } },
  { id: 'ox', name: '소', nick: '우직이', weapon: 'bell', trait: { stat: 'maxHpPct', value: 0.1, text: '최대 체력 +10%' }, unlock: { kind: 'base', text: '처음부터' } },
  { id: 'tiger', name: '호랑이', nick: '어흥이', weapon: 'claw', trait: { stat: 'might', value: 0.08, text: '공격력 +8%' }, unlock: { kind: 'base', text: '처음부터' } },
  { id: 'rabbit', name: '토끼', nick: '깡총이', weapon: 'mooncake', trait: { stat: 'speed', value: 0.08, text: '이동 속도 +8%' }, unlock: { kind: 'time', value: 120, text: '2분 버티기' } },
  { id: 'dragon', name: '용', nick: '여의룡', weapon: 'pearl', trait: { stat: 'area', value: 0.1, text: '무기 범위 +10%' }, unlock: { kind: 'boss', value: 1, text: '중간 보스 물리치기' } },
  { id: 'snake', name: '뱀', nick: '스르르', weapon: 'mist', trait: { stat: 'dot', value: 0.1, text: '지속 피해 +10%' }, unlock: { kind: 'kills', value: 1000, text: '요괴 1,000마리 물리치기' } },
  { id: 'horse', name: '말', nick: '따각이', weapon: 'hoof', trait: { stat: 'taken', value: 0.05, text: '받는 피해 -5%' }, unlock: { kind: 'time', value: 200, text: '3분 20초 버티기' } },
  { id: 'sheep', name: '양', nick: '몽실이', weapon: 'wool', trait: { stat: 'regen', value: 0.25, text: '체력이 조금씩 회복' }, unlock: { kind: 'cakes', value: 15, text: '떡 15개 먹기' } },
  { id: 'monkey', name: '원숭이', nick: '재롱이', weapon: 'staff', trait: { stat: 'cooldown', value: 0.08, text: '재사용 대기시간 -8%' }, unlock: { kind: 'coins', value: 500, text: '엽전 500닢' } },
  { id: 'rooster', name: '닭', nick: '꼬꼬댁', weapon: 'feather', trait: { stat: 'projSpeed', value: 0.1, text: '투사체 속도 +10%' }, unlock: { kind: 'coins', value: 1000, text: '엽전 1,000닢' } },
  { id: 'dog', name: '개', nick: '멍뭉이', weapon: 'puppy', trait: { stat: 'pickup', value: 0.2, text: '아이템 획득 범위 +20%' }, unlock: { kind: 'coins', value: 1500, text: '엽전 1,500닢' } },
  { id: 'pig', name: '돼지', nick: '꿀꿀이', weapon: 'piggy', trait: { stat: 'coin', value: 0.1, text: '엽전 획득 +10%' }, unlock: { kind: 'clear', text: '4분 모드에서 최종 보스 물리치기' } },
  { id: 'cat', name: '고양이', nick: '야옹이', weapon: 'claw', trait: { stat: 'dodge', value: DODGE_SEC, text: `${DODGE_SEC}초마다 한 번 공격을 사뿐히 피함` }, unlock: { kind: 'sia', value: CHARACTER_PRICE.cat, text: unlockLabel('cat') } },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c])) as Record<CharId, CharacterDef>;
