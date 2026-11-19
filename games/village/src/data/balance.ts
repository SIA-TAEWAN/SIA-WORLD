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
} as const;

/** 마을 레벨 n → n+1 에 필요한 경험치 (n = 1 … 29). 레벨이 오르면 경험치는 0부터 다시 센다 */
export const LEVEL_EXP = [
  80, 160, 300, 500, 760, 1000, 1300, 1650, 2050, 2500,
  3050, 4000, 4950, 5930, 7020, 8230, 9560, 11020, 12610, 14340,
  16200, 18220, 20380, 22690, 25170, 27800, 30590, 33560, 36700,
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
