// 십이지신 목록과 아바타 선택.
// 순서 = 띠 순서 = 화투 달 순서(1월 쥐 … 12월 돼지).

export const ZODIAC = [
  { id: 'rat', name: '쥐', emoji: '🐭', color: '#a9b2c3' },
  { id: 'ox', name: '소', emoji: '🐮', color: '#8a5a3c' },
  { id: 'tiger', name: '호랑이', emoji: '🐯', color: '#ff9a2e' },
  { id: 'rabbit', name: '토끼', emoji: '🐰', color: '#f4f1f6' },
  { id: 'dragon', name: '용', emoji: '🐲', color: '#3fbf8f' },
  { id: 'snake', name: '뱀', emoji: '🐍', color: '#7bc04a' },
  { id: 'horse', name: '말', emoji: '🐴', color: '#b8763e' },
  { id: 'sheep', name: '양', emoji: '🐑', color: '#fff7e6' },
  { id: 'monkey', name: '원숭이', emoji: '🐵', color: '#a8693c' },
  { id: 'rooster', name: '닭', emoji: '🐔', color: '#ffffff' },
  { id: 'dog', name: '개', emoji: '🐶', color: '#e0a85a' },
  { id: 'pig', name: '돼지', emoji: '🐷', color: '#ffb3c7' },
];

export const ZODIAC_IDS = ZODIAC.map((z) => z.id);
const BY_ID = new Map(ZODIAC.map((z, i) => [z.id, { ...z, month: i + 1 }]));

/** id → { id, name, emoji, color, month } (없으면 undefined) */
export const zodiacOf = (id) => BY_ID.get(id);

/** 아바타 그림 주소 (시아탱크의 십이지신 그림) */
export const avatarUrl = (id) => new URL(`images/zodiac/${id}.png`, import.meta.url).href;

/** AI 이름: "AI 호랑이" */
export const aiName = (id) => `AI ${zodiacOf(id)?.name ?? ''}`.trim();

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
