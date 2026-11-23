// 십이지 밖의 추가 캐릭터 (지금은 고양이 하나).
// 카드 게임(맞고·카지노)은 12띠 = 화투 12달이라 shared/zodiac.js 의 ZODIAC(12) 만 쓴다. 여기 캐릭터는 그 밖의 게임에서만 쓴다.
// 그림은 십이지와 같은 자리: images/zodiac/face/<id>.png · images/zodiac/full/<id>.png

/**
 * 고양이: 십이지 경주에 늦어서 빠진 "13번째 대원" (늦잠 자다 금관을 비뚤게 쓰고 달려온 귀족 고양이).
 * 시아코인으로 계정마다 한 번 열면 모든 게임에서 쓴다 (071_characters.sql).
 */
export const CAT = {
  id: 'cat',
  name: '고양이',
  nick: '야옹이',
  emoji: '🐱',
  intro: '십이지 경주 날 늦잠을 자서 빠진 13번째 대원. 금관을 비뚤게 쓰고 뒤늦게 달려왔어요.',
};

/** 추가 캐릭터 목록 */
export const EXTRA_CHARACTERS = [CAT];
export const EXTRA_IDS = EXTRA_CHARACTERS.map((c) => c.id);

/** 십이지 12 + 추가 캐릭터 id (카드 게임 밖에서 고를 수 있는 전체) */
export const ALL_CHARACTER_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig', ...EXTRA_IDS];

export const isCharacterId = (id) => ALL_CHARACTER_IDS.includes(id);

/** 원형 아바타용 얼굴 그림 */
export const faceUrl = (id) => new URL(`images/zodiac/face/${isCharacterId(id) ? id : 'tiger'}.png`, import.meta.url).href;
/** 전신 그림 */
export const fullUrl = (id) => new URL(`images/zodiac/full/${isCharacterId(id) ? id : 'tiger'}.png`, import.meta.url).href;
