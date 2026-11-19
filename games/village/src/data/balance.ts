/**
 * 시아마을의 수치 (PRD 1장: 수치는 모두 데이터 파일로).
 * 서버(supabase/migrations/047_village.sql)에 같은 표가 있고, tests/sql.test.ts 가 두 곳이 같은지 본다.
 * 표를 고치면 새 마이그레이션으로 SQL 쪽도 함께 고친다.
 */

/** 기준 화면 (세로 9:16) */
export const VIEW_W = 720;
export const VIEW_H = 1280;

/** 땅: 좌표는 가장 큰 땅(20×20) 기준이고, 지금 단계의 땅은 그 한가운데 정사각형이다 (확장해도 건물 좌표가 바뀌지 않는다) */
export const GRID_MAX = 20;
/** 확장 단계별 한 변의 칸 수 (0단계 = 처음) */
export const LAND_SIZES = [8, 10, 12, 14, 16, 18, 20];

export const RES_IDS = ['rice', 'wood', 'stone', 'cake', 'coin', 'special'] as const;
export type ResId = (typeof RES_IDS)[number];
export type Resources = Record<ResId, number>;
/** 창고 용량 제한을 받는 자원 (엽전 · 특산품은 제한 없음) */
export const CAPPED: readonly ResId[] = ['rice', 'wood', 'stone', 'cake'];
export const RES_NAME: Record<ResId, string> = { rice: '쌀', wood: '나무', stone: '돌', cake: '떡', coin: '엽전', special: '특산품' };

/** 새 마을이 가지고 시작하는 자원 */
export const START_RES: Resources = { rice: 50, wood: 50, stone: 0, cake: 0, coin: 0, special: 0 };
/** 새 마을의 마을 회관 자리 (땅 한가운데 2×2) */
export const HALL_AT = { x: 9, y: 9 };

/** 판마다 쓰는 기준 값 (SQL 의 _village_const) */
export const CONST = {
  /** 마을 레벨 상한 */
  max_level: 30,
  /** 건물 레벨 상한 */
  building_max_level: 10,
  /** 생산 건물이 쌓아 두는 최대 시간 (초): 12시간 */
  prod_cap_sec: 43200,
  /** 동시에 짓는(업그레이드 포함) 수 */
  base_slots: 2,
  /** 마을 회관이 이 레벨이 되면 동시에 3개 */
  slots3_hall: 5,
  /** 수확 경험치 = 건물에 쌓여 있던 양 ÷ 이 값 (버림) */
  harvest_exp_div: 20,
  /** 한 번에 수확을 요청할 수 있는 건물 수 */
  harvest_max: 64,
  /** 마을 회관의 업그레이드 시간·경험치 배수 */
  hall_sec_mul: 2,
  hall_exp_mul: 3,
  /** 건물 레벨이 이 값 이상이면 업그레이드에 돌이 든다 */
  stone_from: 4,
  /** 장터 시세: 기준 값의 price_min_pct % 부터 price_span 가지 (80 ~ 130 %) */
  price_min_pct: 80,
  price_span: 51,
  /** 정자: 둘레 pavilion_range 칸 안의 생산 건물이 pavilion_pct % 더 만든다 (정자 레벨마다 + pavilion_pct_per) */
  pavilion_pct: 10,
  pavilion_pct_per: 2,
  pavilion_range: 1,
  /** 잔치: 떡 feast_cake 개로 feast_sec 초(하루) 동안 마을 전체 생산 + feast_pct % (잔치 마당 레벨마다 + feast_pct_per). 열면 경험치 feast_exp */
  feast_cake: 60,
  feast_sec: 86400,
  feast_pct: 20,
  feast_pct_per: 2,
  feast_exp: 30,
  /** 보너스(잔치 등)로 더 쌓일 수 있는 여유: 건물에 쌓이는 양의 상한 = 12시간 분량 × (100 + bonus_room_pct) % */
  bonus_room_pct: 40,
  /** 주민 부탁의 경험치 = 부탁한 것의 값어치(엽전) × req_exp_pct % + 5 + 마을 레벨 × 2 */
  req_exp_pct: 30,
  /** 오늘의 할 일 하나의 경험치 = 그 레벨에 필요한 경험치 × daily_exp_pct % + 10 (다 끝낸 추가 보상은 두 배 + 20) */
  daily_exp_pct: 1,
  /** 번영도 = 건물 레벨 합 + 놓인 것의 번영도 점수 + 주민 친밀도 단계 × aff_points + 받은 칭찬 × praise_points */
  aff_points: 3,
  praise_points: 2,
  /** 칭찬: 하루에 줄 수 있는 횟수 · 줄 때마다 받는 엽전 */
  praise_per_day: 5,
  praise_coin: 10,
  /** 마을 이름의 최대 글자 수 */
  name_max: 12,
} as const;

/** 마을 레벨 n → n+1 에 필요한 경험치 (n = 1 … 29). 레벨이 오르면 경험치는 0부터 다시 센다 */
export const LEVEL_EXP = [
  80, 160, 300, 500, 900, 1400, 2000, 2700, 3600, 4800,
  6400, 9000, 12000, 15500, 19000, 22600, 26300, 30000, 33800, 38000,
  43000, 48000, 53000, 58500, 64000, 69500, 75000, 81000, 87000,
];

/** 업그레이드 값: 건물 레벨 n → n+1 (n = 1 … 9) */
/** 비용 = 짓는 값 × 배수 ÷ 10 */
export const COST_MUL = [20, 40, 70, 110, 170, 250, 360, 500, 700];
/** 걸리는 시간 (초). 마을 회관은 hall_sec_mul 배 */
export const UPGRADE_SEC = [30, 120, 600, 1800, 3600, 7200, 14400, 21600, 28800];
/** 끝났을 때의 경험치. 마을 회관은 hall_exp_mul 배 */
export const UPGRADE_EXP = [20, 40, 80, 140, 220, 320, 450, 600, 800];

/** 건물 레벨별 값 (레벨 1 … 10) */
/** 생산량 = 기본 생산량 × 배수 ÷ 10 */
export const RATE_MUL = [10, 13, 16, 20, 24, 29, 34, 40, 47, 55];
/** 마을 회관이 주는 창고 용량 */
export const HALL_CAP = [300, 450, 650, 900, 1200, 1600, 2100, 2700, 3400, 4200];
/** 창고 하나가 더해 주는 용량 */
export const STORAGE_CAP = [150, 250, 400, 600, 850, 1150, 1500, 1900, 2400, 3000];

/** 마을 회관을 레벨 n+1 로 올리는 데 필요한 마을 레벨 (n = 1 … 9) */
export const HALL_NEED = [2, 4, 6, 9, 12, 15, 19, 23, 27];

/** 건물 모습 3단계: 레벨 1~3 / 4~7 / 8~10 */
export const lookOf = (level: number): 1 | 2 | 3 => (level >= 8 ? 3 : level >= 4 ? 2 : 1);

/** 장터의 하루 판매 한도 (엽전, 장터 레벨 1 … 10) */
export const MARKET_LIMIT = [300, 450, 650, 900, 1200, 1600, 2100, 2700, 3400, 4200];

/** 장터에서 파는 자원: 100개의 기준 값(엽전)과 시세를 가르는 번호. SQL 의 _village_prices */
export const PRICES: { res: ResId; base: number; idx: number }[] = [
  { res: 'rice', base: 40, idx: 1 },
  { res: 'wood', base: 50, idx: 2 },
  { res: 'stone', base: 90, idx: 3 },
  { res: 'cake', base: 300, idx: 4 },
  { res: 'special', base: 4000, idx: 5 },
];

/** 서버 날짜: 한국 시간 2026-01-01 부터 센 날 수 (하루 한 번 바뀌는 것들의 기준) */
export const kstDay = (ms: number) => Math.floor((ms + 9 * 3600_000) / 86400_000) - 20454;
/** 그날의 시세 (%) */
export const pricePct = (day: number, idx: number) => CONST.price_min_pct + ((((day * 7919 + idx * 104729 + 12345) % CONST.price_span) + CONST.price_span) % CONST.price_span);

/** 땅 확장 (PRD 6장): n단계로 넓히는 값(시아코인)과 필요한 마을 레벨 (n = 1 … 6) */
export const LAND_PRICE = [10, 20, 30, 50, 70, 100];
export const LAND_NEED = [3, 6, 9, 13, 17, 22];

/** 마을 이름에 쓸 수 있는 글자: 한글 · 영문 · 숫자 · 띄어쓰기 (앞뒤 띄어쓰기 · 연속 띄어쓰기 없음). SQL 의 village_rename 과 같은 식 */
export const NAME_RE = /^[가-힣a-zA-Z0-9]+( [가-힣a-zA-Z0-9]+)*$/;
