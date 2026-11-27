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
  fur: 'fur',
  medicine: 'medicine',
};

/** 씨앗 (정원은 4단계. 선물로 받을 수 있는 것은 앞의 셋) */
export const SEED_IDS = ['daisy', 'catgrass', 'sunflower', 'catnip', 'rose', 'moonflower'] as const;
export const SEED_NAME: Record<(typeof SEED_IDS)[number], string> = { daisy: '데이지', catgrass: '캣그라스', sunflower: '해바라기', catnip: '캣닢', rose: '장미', moonflower: '보름달꽃' };
export const PRESENT_SEEDS = ['daisy', 'catgrass', 'sunflower'] as const;
/** 선물로 드물게 오는 가구 (꾸미기는 5단계: nyang_profiles.furniture 에 id 를 더한다) */
export const PRESENT_FURNITURE = ['paw_rug', 'fish_pillow', 'yarn_basket'] as const;
export const FURNITURE_NAME: Record<string, string> = { paw_rug: '발바닥 러그', fish_pillow: '생선 쿠션', yarn_basket: '털실 바구니' };
/** 선물로 오는 장난감 (가지고 있지 않은 것 중에서) */
export const PRESENT_TOYS = ['laser', 'ball', 'box'] as const;

/**
 * 행동 도감 (PRD 5장 · 7장). 화면에서 처음 본 행동을 서버(nyang_seen)에 남긴다 — 앨범 · 도감 화면은 5단계.
 * level: 이 친밀도 단계부터 하는 행동 (서버도 확인한다)
 */
export interface Behavior {
  id: string;
  name: string;
  level: number;
}
export const BEHAVIORS: Behavior[] = [
  { id: 'loaf', name: '식빵 굽기', level: 1 },
  { id: 'window', name: '창밖 새 구경', level: 1 },
  { id: 'zoomies', name: '우다다', level: 1 },
  { id: 'stretch', name: '기지개', level: 1 },
  { id: 'knock', name: '물건 떨어뜨리기', level: 1 },
  { id: 'rub', name: '발치에 몸 비비기', level: 1 },
  { id: 'box', name: '상자에 쏙', level: 1 },
  { id: 'sleep', name: '쿨쿨 낮잠', level: 1 },
  { id: 'eat', name: '냠냠 밥 먹기', level: 1 },
  { id: 'greet', name: '문 앞 마중', level: 1 },
  { id: 'present', name: '선물 물어 오기', level: 1 },
  { id: 'hunt', name: '사냥 놀이', level: 1 },
  { id: 'churu', name: '츄르 날름날름', level: 1 },
  { id: 'brush', name: '빗질 받기', level: 1 },
  { id: 'sneeze', name: '에취!', level: 1 },
  { id: 'lap', name: '무릎에 올라오기', level: 3 },
  { id: 'follow', name: '꼬리 세우고 따라다니기', level: 4 },
  { id: 'belly', name: '배 보여 주기', level: 6 },
  { id: 'knead', name: '꾹꾹이', level: 8 },
  { id: 'together', name: '집사 옆에서 같이 자기', level: 10 },
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
};
