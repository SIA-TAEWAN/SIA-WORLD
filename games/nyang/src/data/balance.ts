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
  sick_sec: 100800,
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
  pet_love_like: 1000,
  pet_love: 500,
  /** 쓰다듬기로 오르는 친밀도의 하루 상한 (한국 시간 하루) */
  pet_love_day: 6000,
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

  // ---- 놀아 주기 (3단계): 시작(nyang_play_start) → 30초 미니게임 → 끝(nyang_play, 잡은 수) ----
  /** 놀이 시간 (화면) */
  play_sec: 30,
  /** 시작하고 이만큼 지나면 끝을 받지 않는다 ('no play') */
  play_max_sec: 180,
  /** 잡은 수 상한: 한 번에 최대 · 시작부터 이 초마다 하나까지 */
  play_catch_max: 15,
  play_catch_sec: 2,
  /** 잡을 때마다 기분 + (좋아하는 장난감이면 _like) */
  play_mood: 700,
  play_mood_like: 1000,
  /** 잡을 때마다 친밀도 + · 놀아 주기로 오르는 친밀도의 하루 상한 */
  play_love: 1200,
  play_love_like: 1600,
  play_love_day: 24000,

  // ---- 빗질: 고양이마다 하루 한 번 ----
  brush_mood: 3000,
  brush_love: 12000,
  /** 털 뭉치 = fur_min + (0 … fur_span-1) */
  fur_min: 2,
  fur_span: 3,

  // ---- 츄르: 고양이마다 하루 2개까지 ----
  churu_day_max: 2,
  churu_mood: 6000,
  churu_mood_like: 8000,
  churu_love: 2500,
  churu_love_like: 3500,
  /** 첫 고양이를 입양하면 받는 츄르 (그 고양이가 좋아하는 맛) */
  start_churu: 3,

  // ---- 고양이 선물: 들어올 때(entry) 고양이마다 한 번 굴린다 ----
  /** 지난번에 굴린 때부터 이만큼 지나야 다시 굴린다 */
  present_gap_sec: 14400,
  /** 선물을 가져올 확률(%) = present_pct + 친밀도 단계 × present_pct_level */
  present_pct: 20,
  present_pct_level: 6,
  /** 무엇을: 엽전 · 씨앗 · 장난감 (%, 나머지는 가구) */
  present_coin_pct: 55,
  present_seed_pct: 25,
  present_toy_pct: 15,
  /** 엽전 = present_coin_min + 단계 × 2 + (0 … present_coin_span-1) */
  present_coin_min: 5,
  present_coin_span: 11,

  // ---- 4단계: 정원 · 상점 ----
  /** 캣그라스 · 캣닢을 고양이마다 하루 몇 번까지 줄 수 있나 · 캣닢 우다다 시간(초, 화면) */
  treat_day_max: 2,
  nip_sec: 600,
  /** 한 번에 살 수 있는 개수 · 팔 수 있는 개수 */
  buy_max: 99,
  sell_max: 999,
  /** 화분: 처음 칸 수 · 최대 칸 수 (늘리는 값은 POT_PRICES) */
  pot_start: 4,
  pot_max: 12,

  // ---- 5단계: 꾸미기 · 앨범 ----
  /** 방 바닥 격자 (가로 칸 · 세로 칸) · 벽 격자 (가로 칸 · 세로 칸) — 자리는 0 부터 */
  grid_cols: 8,
  grid_rows: 5,
  wall_cols: 8,
  wall_rows: 2,
  /** 앨범에 둘 수 있는 사진 수 (지우면 다시 찍을 수 있다) */
  album_max: 60,
} as const;
export type ConstName = keyof typeof CONST;

/**
 * 친밀도 단계 (1 ~ 10): n 단계에서 n+1 단계로 가는 데 드는 점수 (SQL 의 _nyang_table('love_need')).
 * 좋은 상태(네 상태 모두 절반 이상) 1초 = 1점. 하루 2~3번이면 하루 약 6~9시간이 좋은 상태 → 10단계까지 약 2달 (npm run pace).
 */
export const LOVE_NEED = [30000, 135000, 230000, 310000, 380000, 490000, 620000, 810000, 1135000];
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

/**
 * 사료 (SQL 의 _nyang_foods): 한 번에 채우는 배부름 · 함께 오르는 기분 · 상점에서 한 번 살 때 받는 그릇 수(pack) · 값(엽전, pack 하나).
 * 기본 사료는 공짜 · 무제한이다 — 엽전이 0 이어도 밥은 언제나 줄 수 있다 (PRD 1장: 숙제 · 결핍감 없게). 나머지는 보관함의 'food:<id>' 하나를 쓴다.
 */
export interface Food {
  id: FoodId;
  name: string;
  add: number;
  mood: number;
  pack: number;
  price: number;
  desc: string;
}
export const FOOD_IDS = ['basic', 'tasty', 'premium'] as const;
export type FoodId = (typeof FOOD_IDS)[number];
export const FOODS: Food[] = [
  { id: 'basic', name: '기본 사료', add: 10000, mood: 0, pack: 0, price: 0, desc: '언제나 공짜예요' },
  { id: 'tasty', name: '참치 사료', add: 10000, mood: 1500, pack: 5, price: 10, desc: '먹으면 기분도 조금 올라요' },
  { id: 'premium', name: '고급 사료', add: 10000, mood: 3000, pack: 5, price: 30, desc: '먹으면 기분이 많이 올라요' },
];
export const FOOD: Record<FoodId, Food> = Object.fromEntries(FOODS.map((f) => [f.id, f])) as Record<FoodId, Food>;
export const isFoodId = (v: unknown): v is FoodId => typeof v === 'string' && (FOOD_IDS as readonly string[]).includes(v);

/** 감기를 낫게 하는 것: 담요(네 상태를 모두 채운 뒤) · 약 간식(보관함의 medicine 하나). 츄르는 nyang_churu 가 낫게 한다 */
export const CURE_IDS = ['blanket', 'medicine'] as const;
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

// ---------- 3단계: 장난감 · 츄르 · 선물 · 행동 ----------

/** 장난감 (PRD 4장 4). 낚싯대는 처음부터, 나머지는 보관함(items 의 'toy:<id>')에 있어야 한다 — 상점은 4단계 */
export const TOYS: Record<ToyId, { name: string; icon: string; desc: string; free: boolean }> = {
  rod: { name: '낚싯대', icon: '🎣', desc: '깃털을 흔들다가 멈추면 덮쳐요', free: true },
  laser: { name: '레이저', icon: '🔴', desc: '빨간 점을 끌면 쫓아가 덮쳐요', free: false },
  ball: { name: '공', icon: '🧶', desc: '던지면 우다다 쫓아가요', free: false },
  box: { name: '상자', icon: '📦', desc: '고개를 내밀 때 톡!', free: false },
};
export const isToyId = (v: unknown): v is ToyId => typeof v === 'string' && (TOY_IDS as readonly string[]).includes(v);
export const CHURU: Record<ChuruId, { name: string; color: string }> = {
  tuna: { name: '참치', color: '#FF8FA3' },
  salmon: { name: '연어', color: '#F9A873' },
  chicken: { name: '닭가슴살', color: '#FFE066' },
};
export const isChuruId = (v: unknown): v is ChuruId => typeof v === 'string' && (CHURU_IDS as readonly string[]).includes(v);

/** 보관함 열쇠 (nyang_profiles.items: { 열쇠: 개수 }) */
export const itemKey = {
  toy: (id: string) => `toy:${id}`,
  churu: (id: string) => `churu:${id}`,
  seed: (id: string) => `seed:${id}`,
  /** 수확한 꽃 · 풀 (4단계) */
  plant: (id: string) => `plant:${id}`,
  /** 상점에서 산 사료 (4단계) */
  food: (id: string) => `food:${id}`,
  /** 벽지 · 바닥 · 창문 (5단계) */
  style: (id: string) => `style:${id}`,
  fur: 'fur',
  medicine: 'medicine',
};

/** 씨앗 (선물로 받을 수 있는 것은 앞의 셋) */
export const SEED_IDS = ['daisy', 'catgrass', 'sunflower', 'catnip', 'rose', 'moonflower'] as const;
export type PlantId = (typeof SEED_IDS)[number];
export const SEED_NAME: Record<PlantId, string> = { daisy: '데이지', catgrass: '캣그라스', sunflower: '해바라기', catnip: '캣닢', rose: '장미', moonflower: '보름달꽃' };
export const isPlantId = (v: unknown): v is PlantId => typeof v === 'string' && (SEED_IDS as readonly string[]).includes(v);
export const PRESENT_SEEDS = ['daisy', 'catgrass', 'sunflower'] as const;
/** 선물로 드물게 오는 가구 (꾸미기는 5단계: nyang_profiles.furniture 에 id 를 더한다) */
export const PRESENT_FURNITURE = ['paw_rug', 'fish_pillow', 'yarn_basket'] as const;

// ---------- 5단계: 꾸미기 (방 배치 · 벽지 · 바닥 · 창문) ----------

/**
 * 방에 놓을 수 있는 가구 (SQL 의 _nyang_furniture). kind: 바닥(floor) · 벽(wall) 격자, w · h: 차지하는 칸.
 * 바닥 격자는 CONST.grid_cols × grid_rows (x 0 = 왼쪽, y 0 = 벽 쪽), 벽 격자는 wall_cols × wall_rows (y 0 = 위).
 * use: 고양이가 가구를 쓰는 방법 (화면 — ui/behavior.ts)
 */
export interface Furniture {
  id: string;
  kind: 'floor' | 'wall';
  w: number;
  h: number;
  use: 'desk' | 'bed' | 'box' | 'vase' | 'scratch' | 'hide' | 'tower' | 'lamp' | 'rug' | 'shelf';
}
export const FURNITURE: Furniture[] = [
  { id: 'desk', kind: 'floor', w: 2, h: 1, use: 'desk' },
  { id: 'cushion', kind: 'floor', w: 2, h: 1, use: 'bed' },
  { id: 'box', kind: 'floor', w: 2, h: 1, use: 'box' },
  { id: 'vase', kind: 'floor', w: 1, h: 1, use: 'vase' },
  { id: 'scratcher', kind: 'floor', w: 1, h: 1, use: 'scratch' },
  { id: 'hideaway', kind: 'floor', w: 2, h: 1, use: 'hide' },
  { id: 'cat_tower', kind: 'floor', w: 2, h: 1, use: 'tower' },
  { id: 'moon_lamp', kind: 'floor', w: 1, h: 1, use: 'lamp' },
  { id: 'paw_rug', kind: 'floor', w: 2, h: 1, use: 'rug' },
  { id: 'fish_pillow', kind: 'floor', w: 1, h: 1, use: 'bed' },
  { id: 'yarn_basket', kind: 'floor', w: 1, h: 1, use: 'bed' },
  { id: 'zodiac_shelf', kind: 'wall', w: 2, h: 1, use: 'shelf' },
];
export const FURNITURE_OF: Record<string, Furniture> = Object.fromEntries(FURNITURE.map((f) => [f.id, f]));
/** 처음부터 가진 가구 (상점에서 팔지 않는다). 상자(box)는 장난감 'toy:box' 가 있으면 놓을 수 있다 */
export const BASE_FURNITURE = ['desk', 'cushion'] as const;
/**
 * 놓을 수 없는 칸: 바닥 'f<x>_<y>' (밥 자리 = 왼쪽 가운데 3 × 2칸 · 화장실 = 가운데 뒤 2칸) · 벽 'w<x>_<y>' (창 · 문)
 * 밥그릇 · 물그릇 · 화장실은 늘 같은 자리에 있다 (고양이가 늘어도 그 안에서 나란히).
 */
export const BLOCKED: readonly string[] = [
  'f0_2', 'f1_2', 'f2_2', 'f0_3', 'f1_3', 'f2_3', 'f4_0', 'f5_0',
  ...[2, 3, 4, 5, 6, 7].flatMap((x) => [`w${x}_0`, `w${x}_1`]),
];
/** 꾸미기를 한 번도 저장하지 않았을 때의 배치 (가지고 있는 것만 보인다) */
export const DEFAULT_ITEMS: { id: string; x: number; y: number }[] = [
  { id: 'desk', x: 0, y: 0 },
  { id: 'cushion', x: 3, y: 4 },
  { id: 'box', x: 6, y: 3 },
];

/**
 * 벽지 · 바닥 · 창문 (SQL 의 _nyang_styles). 그림을 새로 그리지 않고 코드(CSS 색 · 무늬)로 그린다 (ui/deco.ts).
 * price: 엽전 (0 = 처음부터). 4단계 pace: 정원을 돌리면 한 달 뒤 엽전이 남는다 → 이 값들이 그 엽전을 쓰는 곳 (합 12,500냥 — 하루 2번이면 30일 뒤부터 한 달쯤, 하루 1번이면 넉 달쯤 모아야 다 산다)
 */
export interface RoomStyle {
  id: string;
  kind: 'wall' | 'floor' | 'window';
  name: string;
  price: number;
}
export const STYLES: RoomStyle[] = [
  { id: 'wall_cream', kind: 'wall', name: '크림 줄무늬', price: 0 },
  { id: 'wall_mint', kind: 'wall', name: '민트 줄무늬', price: 600 },
  { id: 'wall_pink', kind: 'wall', name: '분홍 물방울', price: 800 },
  { id: 'wall_sky', kind: 'wall', name: '하늘 체크', price: 1200 },
  { id: 'wall_night', kind: 'wall', name: '별밤', price: 2000 },
  { id: 'floor_wood', kind: 'floor', name: '나무 마루', price: 0 },
  { id: 'floor_maple', kind: 'floor', name: '밝은 마루', price: 600 },
  { id: 'floor_walnut', kind: 'floor', name: '짙은 마루', price: 900 },
  { id: 'floor_mint', kind: 'floor', name: '민트 장판', price: 1200 },
  { id: 'floor_pink', kind: 'floor', name: '분홍 타일', price: 1800 },
  { id: 'window_basic', kind: 'window', name: '커튼 없음', price: 0 },
  { id: 'window_pink', kind: 'window', name: '분홍 커튼', price: 400 },
  { id: 'window_mint', kind: 'window', name: '민트 커튼', price: 600 },
  { id: 'window_lace', kind: 'window', name: '레이스 커튼', price: 900 },
  { id: 'window_star', kind: 'window', name: '별 커튼', price: 1500 },
];
export const STYLE_OF: Record<string, RoomStyle> = Object.fromEntries(STYLES.map((x) => [x.id, x]));
export const BASE_STYLES = STYLES.filter((x) => x.price === 0).map((x) => x.id);
export const BASE_STYLE: Record<RoomStyle['kind'], string> = { wall: 'wall_cream', floor: 'floor_wood', window: 'window_basic' };
/** 꽃병에 꽂을 수 있는 꽃 (보관함의 'plant:<id>' 하나를 쓴다 — 시들지 않는다) */
export const VASE_FLOWERS = ['sunflower', 'rose'] as const;
export const FURNITURE_NAME: Record<string, string> = {
  paw_rug: '발바닥 러그', fish_pillow: '생선 쿠션', yarn_basket: '털실 바구니',
  cat_tower: '캣타워', hideaway: '숨숨집', donut_cushion: '도넛 방석', scratcher: '스크래처', desk: '책상', vase: '꽃병',
  zodiac_shelf: '십이지 인형 선반', moon_lamp: '보름달 등',
};
/** 선물로 오는 장난감 (가지고 있지 않은 것 중에서) */
export const PRESENT_TOYS = ['laser', 'ball', 'box'] as const;

/** 고양이 자세 (화면의 자세 → 그림 표는 ui/catart.ts 의 POSE_IMAGE · 사진은 이 이름으로 저장한다) */
export const POSE_IDS = [
  'sit', 'blink', 'walk1', 'walk2', 'loaf', 'sleep', 'eat', 'drink', 'stretch', 'pounce', 'jump', 'beg', 'knead', 'belly',
  'lick0', 'lick1', 'lick2', 'lick3', 'lick4', 'lick5', 'lick6', 'lick7',
] as const;
export type PoseId = (typeof POSE_IDS)[number];

/**
 * 행동 도감 (PRD 5장 · 7장). 화면에서 처음 본 행동을 서버(nyang_seen)에 남긴다 — 앨범 · 도감 화면은 5단계.
 * level: 이 친밀도 단계부터 하는 행동 (서버도 확인한다)
 */
export interface Behavior {
  id: string;
  name: string;
  level: number;
  /** 도감 그림 자세 (화면만) */
  pose: PoseId;
}
export const BEHAVIORS: Behavior[] = [
  { id: 'loaf', name: '식빵 굽기', level: 1, pose: 'loaf' },
  { id: 'window', name: '창밖 새 구경', level: 1, pose: 'sit' },
  { id: 'zoomies', name: '우다다', level: 1, pose: 'walk2' },
  { id: 'stretch', name: '기지개', level: 1, pose: 'stretch' },
  { id: 'knock', name: '물건 떨어뜨리기', level: 1, pose: 'pounce' },
  { id: 'rub', name: '발치에 몸 비비기', level: 1, pose: 'walk1' },
  { id: 'box', name: '상자에 쏙', level: 1, pose: 'loaf' },
  { id: 'sleep', name: '쿨쿨 낮잠', level: 1, pose: 'sleep' },
  { id: 'eat', name: '냠냠 밥 먹기', level: 1, pose: 'eat' },
  { id: 'greet', name: '문 앞 마중', level: 1, pose: 'beg' },
  { id: 'present', name: '선물 물어 오기', level: 1, pose: 'beg' },
  { id: 'hunt', name: '사냥 놀이', level: 1, pose: 'pounce' },
  { id: 'churu', name: '츄르 날름날름', level: 1, pose: 'lick2' },
  { id: 'brush', name: '빗질 받기', level: 1, pose: 'blink' },
  { id: 'sneeze', name: '에취!', level: 1, pose: 'loaf' },
  { id: 'lap', name: '무릎에 올라오기', level: 3, pose: 'loaf' },
  { id: 'follow', name: '꼬리 세우고 따라다니기', level: 4, pose: 'walk1' },
  { id: 'belly', name: '배 보여 주기', level: 6, pose: 'belly' },
  { id: 'knead', name: '꾹꾹이', level: 8, pose: 'knead' },
  { id: 'together', name: '집사 옆에서 같이 자기', level: 10, pose: 'sleep' },
  // 5단계: 가만히 있을 때 · 가구 쓰기 · 고양이끼리
  { id: 'sit', name: '얌전히 앉아 있기', level: 1, pose: 'sit' },
  { id: 'walk', name: '어슬렁어슬렁', level: 1, pose: 'walk1' },
  { id: 'tower', name: '캣타워 꼭대기', level: 1, pose: 'loaf' },
  { id: 'hide', name: '숨숨집에 쏙', level: 1, pose: 'loaf' },
  { id: 'scratch', name: '발톱 긁기', level: 1, pose: 'stretch' },
  { id: 'groom', name: '서로 그루밍', level: 1, pose: 'lick2' },
  { id: 'cuddle', name: '꼭 붙어 자기', level: 1, pose: 'sleep' },
  { id: 'chase', name: '잡기 놀이', level: 1, pose: 'jump' },
];
export const BEHAVIOR: Record<string, Behavior> = Object.fromEntries(BEHAVIORS.map((b) => [b.id, b]));

/** SQL 의 _nyang_ids 에 들어가는 목록 (tests/sql.test.ts 가 맞춰 본다) */
export const SQL_IDS: Record<string, readonly string[]> = {
  colors: COLOR_IDS,
  spots: SPOTS,
  toys: TOY_IDS,
  free_toys: TOY_IDS.filter((t) => TOYS[t].free),
  churus: CHURU_IDS,
  present_seeds: PRESENT_SEEDS,
  present_toys: PRESENT_TOYS,
  present_furniture: PRESENT_FURNITURE,
  poses: POSE_IDS,
  base_furniture: BASE_FURNITURE,
  base_styles: BASE_STYLES,
  blocked: BLOCKED,
  vase_flowers: VASE_FLOWERS,
};

// ---------- 4단계: 베란다 정원 · 상점 ----------

/**
 * 식물 6종 (PRD 6장 표, SQL 의 _nyang_plants).
 *   grow_sec  : 다 자라는 데 드는 '물이 있는 동안'의 시간 (물이 마르면 성장이 멈추기만 하고 시들지 않는다)
 *   water_sec : 물 한 번에 자라는 시간 (물을 주면 이 시간 동안만 자란다)
 *   level     : 씨앗을 살 수 있는 친밀도 단계 (내 고양이 중 가장 높은 단계)
 *   seed      : 씨앗 한 개 값 (엽전) · sell : 수확한 것 하나를 팔 때 (0 = 팔지 않음 — 보름달꽃은 특별 가구와 바꾼다)
 */
export interface Plant {
  id: PlantId;
  grow_sec: number;
  water_sec: number;
  level: number;
  seed: number;
  sell: number;
  use: string;
}
export const PLANTS: Plant[] = [
  { id: 'daisy', grow_sec: 3600, water_sec: 3600, level: 1, seed: 4, sell: 8, use: '팔면 엽전' },
  { id: 'catgrass', grow_sec: 7200, water_sec: 7200, level: 1, seed: 5, sell: 7, use: '고양이에게 주면 기분이 크게 올라요' },
  { id: 'sunflower', grow_sec: 14400, water_sec: 7200, level: 2, seed: 10, sell: 24, use: '팔기 · 꽃병 장식(꾸미기)' },
  { id: 'catnip', grow_sec: 21600, water_sec: 10800, level: 3, seed: 15, sell: 32, use: '고양이에게 주면 10분 동안 신나서 우다다' },
  { id: 'rose', grow_sec: 28800, water_sec: 14400, level: 5, seed: 25, sell: 50, use: '비싸게 팔기 · 꽃병 장식(꾸미기)' },
  { id: 'moonflower', grow_sec: 43200, water_sec: 21600, level: 7, seed: 50, sell: 0, use: '3송이를 모으면 보름달 등과 바꿔요' },
];
export const PLANT: Record<PlantId, Plant> = Object.fromEntries(PLANTS.map((p) => [p.id, p])) as Record<PlantId, Plant>;

/** 화분: 처음 칸 수 · 최대 · 늘릴 때의 값 (5번째 칸 = POT_PRICES[0]) */
export const POT_START = CONST.pot_start;
export const POT_MAX = CONST.pot_max;
export const POT_PRICES = [100, 150, 220, 300, 400, 500, 650, 800];

/** 고양이에게 주는 풀 (캣그라스 · 캣닢): 기분 · 친밀도 (하루 횟수 · 캣닢 우다다 시간은 CONST 의 treat_day_max · nip_sec) */
export const TREAT = {
  catgrass: { mood: 5000, love: 1000 },
  catnip: { mood: 8000, love: 2000 },
} as const;
export type TreatId = keyof typeof TREAT;
export const isTreatId = (v: unknown): v is TreatId => v === 'catgrass' || v === 'catnip';

/**
 * 상점 (PRD 7 · 8장, SQL 의 _nyang_shop). id 는 보관함 열쇠 (가구는 'furniture:<id>').
 *   price : 엽전 (하나 살 때) · sia : 시아코인 (하나 살 때) · give : 하나 사면 보관함에 들어가는 개수
 *   once  : 1 이면 하나만 가질 수 있다 (장난감 · 가구) · level : 이 친밀도 단계부터 (씨앗)
 */
export type ShopTab = 'food' | 'snack' | 'churu' | 'seed' | 'toy' | 'furniture' | 'style';
export interface ShopItem {
  id: string;
  tab: ShopTab;
  price: number;
  sia: number;
  give: number;
  once: number;
  level: number;
}
export const SHOP: ShopItem[] = [
  ...FOODS.filter((f) => f.price > 0).map((f): ShopItem => ({ id: `food:${f.id}`, tab: 'food', price: f.price, sia: 0, give: f.pack, once: 0, level: 1 })),
  { id: 'medicine', tab: 'snack', price: 8, sia: 0, give: 1, once: 0, level: 1 },
  ...CHURU_IDS.map((c): ShopItem => ({ id: `churu:${c}`, tab: 'churu', price: 0, sia: 5, give: 1, once: 0, level: 1 })),
  ...PLANTS.map((p): ShopItem => ({ id: `seed:${p.id}`, tab: 'seed', price: p.seed, sia: 0, give: 1, once: 0, level: p.level })),
  { id: 'toy:laser', tab: 'toy', price: 60, sia: 0, give: 1, once: 1, level: 1 },
  { id: 'toy:ball', tab: 'toy', price: 40, sia: 0, give: 1, once: 1, level: 1 },
  { id: 'toy:box', tab: 'toy', price: 30, sia: 0, give: 1, once: 1, level: 1 },
  { id: 'furniture:vase', tab: 'furniture', price: 40, sia: 0, give: 1, once: 1, level: 1 },
  { id: 'furniture:scratcher', tab: 'furniture', price: 150, sia: 0, give: 1, once: 1, level: 1 },
  { id: 'furniture:hideaway', tab: 'furniture', price: 200, sia: 0, give: 1, once: 1, level: 1 },
  { id: 'furniture:cat_tower', tab: 'furniture', price: 400, sia: 0, give: 1, once: 1, level: 1 },
  { id: 'furniture:zodiac_shelf', tab: 'furniture', price: 0, sia: 60, give: 1, once: 1, level: 1 },
  // 5단계: 벽지 · 바닥 · 창문 (보관함 'style:<id>' = 1)
  ...STYLES.filter((x) => x.price > 0).map((x): ShopItem => ({ id: `style:${x.id}`, tab: 'style', price: x.price, sia: 0, give: 1, once: 1, level: 1 })),
];
export const SHOP_ITEM: Record<string, ShopItem> = Object.fromEntries(SHOP.map((i) => [i.id, i]));

/** 팔 수 있는 것 (보관함 열쇠 → 하나에 엽전, SQL 의 _nyang_sell) */
export const SELL: Record<string, number> = {
  ...Object.fromEntries(PLANTS.filter((p) => p.sell > 0).map((p) => [`plant:${p.id}`, p.sell])),
  fur: 2,
};
/** 수확물과 바꾸는 특별 가구 (SQL 의 _nyang_exchanges) */
export const EXCHANGES: { id: string; need: string; n: number }[] = [{ id: 'moon_lamp', need: 'plant:moonflower', n: 3 }];
