// 십이지신 목록과 아바타 선택.
// 순서 = 띠 순서 = 화투 달 순서(1월 쥐 … 12월 돼지).

// nick: 시아탱크 캐릭터 이름 (DESIGN.md 6장) — 화면에는 이 이름을 쓴다 ("AI 어흥이")
export const ZODIAC = [
  { id: 'rat', name: '쥐', nick: '찍찍이', emoji: '🐭' },
  { id: 'ox', name: '소', nick: '우직이', emoji: '🐮' },
  { id: 'tiger', name: '호랑이', nick: '어흥이', emoji: '🐯' },
  { id: 'rabbit', name: '토끼', nick: '깡총이', emoji: '🐰' },
  { id: 'dragon', name: '용', nick: '여의룡', emoji: '🐲' },
  { id: 'snake', name: '뱀', nick: '스르르', emoji: '🐍' },
  { id: 'horse', name: '말', nick: '따각이', emoji: '🐴' },
  { id: 'sheep', name: '양', nick: '몽실이', emoji: '🐑' },
  { id: 'monkey', name: '원숭이', nick: '재롱이', emoji: '🐵' },
  { id: 'rooster', name: '닭', nick: '꼬꼬댁', emoji: '🐔' },
  { id: 'dog', name: '개', nick: '멍뭉이', emoji: '🐶' },
  { id: 'pig', name: '돼지', nick: '꿀꿀이', emoji: '🐷' },
];

export const ZODIAC_IDS = ZODIAC.map((z) => z.id);
const BY_ID = new Map(ZODIAC.map((z, i) => [z.id, { ...z, month: i + 1 }]));

/** id → { id, name, nick, emoji, month } (없으면 undefined) */
export const zodiacOf = (id) => BY_ID.get(id);

/** 원형 아바타용 얼굴 그림 (SpriteCook, 탱크 없는 캐릭터) */
export const avatarUrl = (id) => new URL(`images/zodiac/face/${id}.png`, import.meta.url).href;
/** 전신 그림 (카드·컷인·화면 장식) */
export const fullUrl = (id) => new URL(`images/zodiac/full/${id}.png`, import.meta.url).href;
/** 시아탱크의 탱크에 탄 그림 (시아탱크 화면용) */
export const tankUrl = (id) => new URL(`images/zodiac/${id}.png`, import.meta.url).href;

/** AI 이름: "AI 어흥이" */
export const aiName = (id) => `AI ${zodiacOf(id)?.nick ?? ''}`.trim();

const key = (userId) => `sia-world:avatar:${userId}`;

/** 마지막으로 고른 아바타 (없으면 호랑이) */
export function lastAvatar(userId) {
  try {
    const v = localStorage.getItem(key(userId));
    if (v && BY_ID.has(v)) return v;
  } catch {
    /* 저장소를 못 쓰면 기본값 */
  }
  return 'tiger';
}

export function saveAvatar(userId, id) {
  if (!BY_ID.has(id)) return;
  try {
    localStorage.setItem(key(userId), id);
  } catch {
    /* 무시 */
  }
}

/** 이미 쓰인 동물을 빼고 고른다. 원하는 동물이 쓰였으면 띠 순서로 다음 빈 동물 */
export function pickFree(wanted, taken) {
  const used = new Set(taken);
  if (!used.has(wanted)) return wanted;
  const start = Math.max(0, ZODIAC_IDS.indexOf(wanted));
  for (let i = 1; i <= ZODIAC_IDS.length; i++) {
    const id = ZODIAC_IDS[(start + i) % ZODIAC_IDS.length];
    if (!used.has(id)) return id;
  }
  return null;
}
