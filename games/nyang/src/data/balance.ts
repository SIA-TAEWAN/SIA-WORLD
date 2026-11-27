/**
 * 시아집사의 수치 (PRD 1장: 상태가 줄어드는 속도 · 친밀도 · 값은 모두 데이터 파일로).
 * 서버(supabase/migrations/123_nyang.sql)에 같은 값 · 표가 있고, tests/sql.test.ts 가 두 곳이 같은지 본다.
 * 값을 고치면 `npm run sqlrows` 로 SQL 줄을 뽑아 마이그레이션 쪽도 함께 고친다 (이미 올라간 마이그레이션이면 새 번호로).
 *
 * 단위: 상태 4가지는 0 ~ 10000 (= 0 ~ 100 %), 시간은 초 (서버 시각, 1970 부터의 초), 친밀도는 점수 (좋은 상태 1초 = 1점).
 * 기준: 하루 2~3번 들어오는 사람 (npm run pace).
 */

/** 기준 값 (SQL 의 _nyang_const) */
export const CONST = {
  /** 상태 가득 */
  max: 10000,
  /** 절반: 네 상태가 모두 이 값 이상이면 친밀도가 쌓인다 · 이 값 아래면 '돌봐야 함'(느낌표, 시아코인) */
  half: 5000,
  /** 밥그릇이 이만큼 차 있으면 더 붓지 않는다 ('bowl full') */
  feed_full: 9000,
  /** 물이 이만큼 남아 있으면 갈지 않는다 ('water fresh') */
  water_fresh: 9000,
  /** 화장실에 쌓이는 똥 최대 개수 (4개 = 청결 0) */
  poop_max: 4,
  /** 물을 갈지 않고 이만큼 지나면 물이 상한다 (12시간) */
  spoil_sec: 43200,
  /** 상태 하나가 바닥인 채로 이만큼 지나면 감기 기운 (24시간) */
  sick_sec: 86400,
  /** 담요 · 약 간식 · 츄르를 주면 이만큼 뒤에 낫는다 (2시간) */
  cure_sec: 7200,
  /** 감기를 낫게 하려면 네 상태가 모두 이 값 이상 (청결은 똥 1개까지) */
  cure_need: 7000,
  /** 입양한 날의 기분 */
  start_mood: 8000,
  /** 쓰다듬기: 같은 고양이를 이 간격(초)보다 자주 쓰다듬을 수 없다 */
  pet_gap_sec: 8,
  /** 쓰다듬기 기분 +: 좋아하는 곳 · 보통인 곳 */
  pet_mood_like: 2500,
  pet_mood: 1500,
  /** 쓰다듬기 친밀도 +: 좋아하는 곳 · 보통인 곳 */
  pet_love_like: 300,
  pet_love: 150,
  /** 쓰다듬기로 오르는 친밀도의 하루 상한 (한국 시간 하루) */
  pet_love_day: 1800,
  /** 이 친밀도 단계부터 배를 만져도 냥펀치를 하지 않는다 (배 보여 주기) */
  belly_ok_level: 9,
  /** 이 단계부터 배가 아닌 싫어하는 곳(겁쟁이의 등)은 보통인 곳이 된다 */
  hate_ok_level: 5,
  /** 이 단계부터 싫어하지 않는 곳은 모두 좋아하는 곳 (쓰다듬기를 좋아하는 곳이 늘어남) */
  like_all_level: 6,
  /** 하루 첫 돌보기 보너스 엽전 */
  day_bonus: 20,
  /** 똥을 퍼낼 때 모래 속 선물(엽전)이 나올 확률 (%) · 엽전 = gift_min + (0 … gift_span-1) */
  gift_pct: 20,
  gift_min: 3,
  gift_span: 8,
  /** 시아코인: 필요한 돌보기 한 번에 1개, 하루 최대 */
  sia_day_max: 5,
  /** 이름 길이 (글자) */
  name_max: 8,
} as const;
export type ConstName = keyof typeof CONST;

/**
 * 친밀도 단계 (1 ~ 10): n 단계에서 n+1 단계로 가는 데 드는 점수 (SQL 의 _nyang_table('love_need')).
 * 좋은 상태(네 상태 모두 절반 이상) 1초 = 1점. 하루 2~3번이면 하루 약 6~9시간이 좋은 상태 → 10단계까지 약 2달 (npm run pace).
 */
export const LOVE_NEED = [12000, 50000, 85000, 115000, 140000, 180000, 230000, 300000, 420000];
/** 두 번째 · 세 번째 · 네 번째 고양이를 입양할 수 있는 첫 고양이의 친밀도 단계 (SQL 의 _nyang_table('cat_need')) */
export const CAT_NEED = [4, 7, 10];
export const MAX_CATS = CAT_NEED.length + 1;

/** 친밀도 점수 → 단계 (1 ~ 10) · 그 단계에서 모은 점수 · 다음 단계까지 필요한 점수 (10단계면 0) */
export function loveLevel(love: number): { level: number; have: number; need: number } {
  let rest = Math.max(0, love);
  for (let i = 0; i < LOVE_NEED.length; i++) {
    if (rest < LOVE_NEED[i]) return { level: i + 1, have: rest, need: LOVE_NEED[i] };
    rest -= LOVE_NEED[i];
  }
  return { level: LOVE_NEED.length + 1, have: 0, need: 0 };
}
/** 그 단계가 시작되는 점수 (개발 설정 &love=7 에 쓴다) */
export const loveAt = (level: number) => LOVE_NEED.slice(0, Math.max(0, Math.min(LOVE_NEED.length, level - 1))).reduce((a, b) => a + b, 0);

/** 쓰다듬는 곳 */
export const SPOTS = ['head', 'chin', 'back', 'belly'] as const;
export type Spot = (typeof SPOTS)[number];
export const SPOT_NAME: Record<Spot, string> = { head: '머리', chin: '턱', back: '등', belly: '배' };

/**
 * 성격 5종 (SQL 의 _nyang_personalities): 상태가 낮아지는 시간과 좋아하는 것.
 *   full_sec  : 꽉 찬 밥을 다 먹는 시간 (배부름 100 → 0)
 *   water_sec : 물그릇이 비는 시간 (목마름 100 → 0)
 *   poop_sec  : 똥이 하나 생기는 간격
 *   mood_sec  : 기분 100 → 0
 *   likes / dislikes : 쓰다듬기 좋아하는 곳 · 싫어하는 곳 (싫어하는 곳을 오래 만지면 냥펀치)
 *   toy / churu : 좋아하는 장난감 · 츄르 맛 (3단계에서 쓴다)
 */
export interface Personality {
  id: PersonalityId;
  name: string;
  desc: string;
  full_sec: number;
  water_sec: number;
  poop_sec: number;
  mood_sec: number;
  likes: Spot[];
  dislikes: Spot[];
  toy: ToyId;
  churu: ChuruId;
}
export const PERSONALITY_IDS = ['playful', 'calm', 'glutton', 'timid', 'lazy'] as const;
export type PersonalityId = (typeof PERSONALITY_IDS)[number];
export const TOY_IDS = ['rod', 'laser', 'ball', 'box'] as const;
export type ToyId = (typeof TOY_IDS)[number];
export const CHURU_IDS = ['tuna', 'salmon', 'chicken'] as const;
export type ChuruId = (typeof CHURU_IDS)[number];

export const PERSONALITIES: Personality[] = [
  { id: 'playful', name: '장난꾸러기', desc: '놀아 달라고 조르고 금방 심심해해요', full_sec: 28800, water_sec: 21600, poop_sec: 18000, mood_sec: 36000, likes: ['head', 'back'], dislikes: ['belly'], toy: 'laser', churu: 'tuna' },
  { id: 'calm', name: '얌전이', desc: '느긋하고 기분이 오래가요', full_sec: 30600, water_sec: 23400, poop_sec: 19800, mood_sec: 50400, likes: ['chin', 'back'], dislikes: ['belly'], toy: 'rod', churu: 'chicken' },
  { id: 'glutton', name: '먹보', desc: '밥을 빨리 먹고 똥도 자주 싸요', full_sec: 23400, water_sec: 21600, poop_sec: 14400, mood_sec: 43200, likes: ['chin', 'head'], dislikes: ['belly'], toy: 'ball', churu: 'salmon' },
  { id: 'timid', name: '겁쟁이', desc: '머리만 만져 주세요. 상자를 좋아해요', full_sec: 28800, water_sec: 21600, poop_sec: 18000, mood_sec: 39600, likes: ['head'], dislikes: ['belly', 'back'], toy: 'box', churu: 'chicken' },
  { id: 'lazy', name: '게으름뱅이', desc: '하루 종일 뒹굴어요. 배가 천천히 고파요', full_sec: 34200, water_sec: 25200, poop_sec: 21600, mood_sec: 46800, likes: ['back', 'chin'], dislikes: ['belly'], toy: 'rod', churu: 'tuna' },
];
export const PERSONALITY: Record<PersonalityId, Personality> = Object.fromEntries(PERSONALITIES.map((p) => [p.id, p])) as Record<PersonalityId, Personality>;
export const isPersonalityId = (v: unknown): v is PersonalityId => typeof v === 'string' && (PERSONALITY_IDS as readonly string[]).includes(v);

/**
 * 털 색 (2026-11-27 결정: 흰 고양이 그림 한 장의 털 픽셀만 바꾼다 — 무늬 그림은 없다).
 * rgb 는 가장 밝은 털의 목표 색. 음영은 원본의 밝기 비율을 그대로 따른다 (ui/recolor.ts).
 * 줄무늬 같은 무늬(pattern)는 나중에 털 색 위에 겹쳐 그리는 층으로 붙인다 (DB 의 nyang_cats.pattern — 지금은 늘 null).
 */
export interface FurColor {
  id: ColorId;
  name: string;
  rgb: [number, number, number];
}
export const COLOR_IDS = ['white', 'cream', 'cheese', 'gray', 'choco', 'black'] as const;
export type ColorId = (typeof COLOR_IDS)[number];
export const COLORS: FurColor[] = [
  { id: 'white', name: '흰색', rgb: [250, 254, 255] },
  { id: 'cream', name: '크림', rgb: [255, 236, 200] },
  { id: 'cheese', name: '치즈', rgb: [255, 186, 102] },
  { id: 'gray', name: '회색', rgb: [176, 190, 208] },
  { id: 'choco', name: '초코', rgb: [170, 118, 84] },
  { id: 'black', name: '검정', rgb: [92, 90, 104] },
];
export const COLOR: Record<ColorId, FurColor> = Object.fromEntries(COLORS.map((c) => [c.id, c])) as Record<ColorId, FurColor>;
export const isColorId = (v: unknown): v is ColorId => typeof v === 'string' && (COLOR_IDS as readonly string[]).includes(v);

/** 사료 (SQL 의 _nyang_foods): 한 번에 채우는 배부름 · 값(엽전). 지금은 기본 사료만 (상점은 4단계) */
export interface Food {
  id: FoodId;
  name: string;
  add: number;
  price: number;
}
export const FOOD_IDS = ['basic'] as const;
export type FoodId = (typeof FOOD_IDS)[number];
export const FOODS: Food[] = [{ id: 'basic', name: '기본 사료', add: 10000, price: 0 }];
export const FOOD: Record<FoodId, Food> = Object.fromEntries(FOODS.map((f) => [f.id, f])) as Record<FoodId, Food>;
export const isFoodId = (v: unknown): v is FoodId => typeof v === 'string' && (FOOD_IDS as readonly string[]).includes(v);

/** 감기를 낫게 하는 것 (지금은 담요만. 약 간식 · 츄르는 3·4단계) */
export const CURE_IDS = ['blanket'] as const;
export type CureId = (typeof CURE_IDS)[number];

/** 이름: 한글 · 영문 · 숫자, 가운데 띄어쓰기 한 칸 (시아마을과 같은 규칙) */
export const NAME_RE = /^[가-힣a-zA-Z0-9]+( [가-힣a-zA-Z0-9]+)*$/;
/** 입양 화면의 이름 예시 */
export const NAME_IDEAS = ['나비', '모모', '콩이', '보리', '두부', '치치', '호두', '마루', '구름', '뭉치', '라떼', '별이'];

/** 한국 날짜 번호: 2026-01-01 (한국 시간) = 0. t 는 초 */
export const KST_EPOCH = 1767193200;
export const kstDay = (t: number) => Math.floor((t - KST_EPOCH) / 86400);
/** 한국 시간의 시 (0 ~ 23) */
export const kstHour = (t: number) => Math.floor((((t + 9 * 3600) % 86400) + 86400) % 86400 / 3600);

/** 정해진 수 (시아마을 _village_mix 와 같은 식): 선물 · 보호소 고양이 */
export const mix = (seq: number, k: number) => (((seq * 7919 + k * 104729 + 12345) % 1000003) + 1000003) % 1000003;

/** 보호소의 아기 고양이 (그날 정해진 6마리: 털 색마다 한 마리, 성격은 날마다 바뀐다) */
export function shelterKittens(day: number): { color: ColorId; personality: PersonalityId }[] {
  return COLOR_IDS.map((color, i) => ({ color, personality: PERSONALITY_IDS[mix(day * 6 + i, 7) % PERSONALITY_IDS.length] }));
}
