/**
 * 시아블록 수치 (판 크기 · 점수 · 조각 비율). 화면(games/block)과 서버(block-finish)가 같이 쓴다.
 * 같은 시드 + 같은 놓기 기록의 결과가 달라지는 변경이면 BLOCK_RULES 를 올린다 (예전 판 기록은 서버가 거절).
 */
export const BLOCK_RULES = 1;

/** 판 한 변 칸 수 (8×8) */
export const SIZE = 8;
/** 한 번에 나오는 조각 수 */
export const TRAY = 3;

export const SCORE = {
  /** 칸 하나 놓을 때마다 */
  perCell: 1,
  /** 동시에 지운 줄 수 → 점수 (0~4줄). 4줄보다 많으면 lines[4] + (n - 4) × extraLine */
  lines: [0, 100, 300, 600, 1000],
  extraLine: 400,
  /** 콤보 배율: 줄 지우기 점수 × (1 + (콤보 - 1) × comboStep). 첫 지우기가 1콤보(×1), 이어서 지우면 2콤보(×1.5) … */
  comboStep: 0.5,
  /** 줄을 못 지운 놓기가 이만큼 쌓이면 콤보가 끊긴다 */
  comboMiss: 3,
  /** 판 비우기 (지운 뒤 판에 블록이 하나도 없음) */
  perfect: 3000,
} as const;

/** 점수가 0 → rampScore 로 오르는 동안 조각 비율이 시작 비율(w0)에서 나중 비율(w1)로 바뀐다 */
export const RAMP_SCORE = 8000;

/** 정령 9종 (색깔 역할만. 판 칸에는 1~9 로 적는다) */
export const SPIRITS = ['fire', 'water', 'wind', 'bolt', 'leaf', 'earth', 'light', 'dark', 'heart'] as const;
export type Spirit = (typeof SPIRITS)[number];

/** 기록 한 판의 놓기 수 상한 (서버 검증용 — 사람이 하루 종일 해도 넘기 어렵다) */
export const MAX_MOVES = 20000;
