/**
 * 시아디펜스 공통 수치 (PRD 1·3장). 캐릭터·요괴·보스·스테이지 수치는 각각의 데이터 파일에 있다.
 */

/** 기준 화면 (세로 9:16) */
export const VIEW_W = 720;
export const VIEW_H = 1280;

/** 계산 한 걸음 (초). 배속은 실제 시간 1초에 걷는 걸음 수만 늘린다 */
export const TICK = 1 / 60;

/** 판(맵)은 칸으로 짠다: 가로 9칸 × 세로 11칸, 한 칸 80px → 720 × 880 */
export const CELL = 80;
export const COLS = 9;
export const ROWS = 11;
export const BOARD_W = COLS * CELL;
export const BOARD_H = ROWS * CELL;
/** 길의 너비 · 배치 칸의 한 변 (px) */
export const ROAD_W = 64;
export const SLOT_SIZE = 68;

/** 한 스테이지: 3분 = 30초짜리 웨이브 6개 (PRD 3장) */
export const WAVE_SEC = 30;
export const WAVES = 6;
export const RUN_SEC = WAVE_SEC * WAVES;
/** 보스 스테이지: 2분에 보스 등장, 그 몇 초 전에 경고 */
export const BOSS_AT = 120;
export const BOSS_WARN_SEC = 3;

/** 시작 생명 · 요괴가 출구에 닿았을 때 줄어드는 생명 (보스는 data/bosses.ts 의 leak) */
export const START_LIVES = 20;
export const ENEMY_LEAK = 1;

/** 판 안 강화 단계 수 · 되팔기 환급 비율 · 한 판에 데려가는 캐릭터 수 */
export const MAX_LV = 3;
export const SELL_RATE = 0.7;
export const SQUAD_SIZE = 5;

/** 별 평가 (PRD 3장): ★ 클리어 · ★★ 생명 이만큼 이상 · ★★★ 생명을 하나도 잃지 않음 */
export const STAR2_LIVES = 10;

/** 웨이브가 뒤로 갈수록 요괴 체력이 오른다 (스테이지 데이터의 wave.hp 가 있으면 그 값) */
export const WAVE_HP = [1, 1.1, 1.2, 1.32, 1.5, 1.9];

/** 멈춤(소의 방울)이 풀린 뒤 이만큼(초)은 다시 멈추지 않는다 (소 여럿으로 요괴를 영영 세워 둘 수 없게) */
export const STUN_GUARD_SEC = 1.3;
/** 보스는 멈춤 시간이 이만큼만 먹힌다 */
export const BOSS_STUN_MUL = 0.4;

/** 한꺼번에 살아 있을 수 있는 수 (미리 만들어 두고 돌려 쓴다) */
export const LIMIT = { enemies: 256, projectiles: 192, fx: 96, events: 96 };

/** 십이지 12종 (지역 12곳의 주인) */
export const ZODIAC_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;
export type ZodiacId = (typeof ZODIAC_IDS)[number];
/** 십이지 밖의 캐릭터 (shared/characters.js 의 EXTRA_IDS): 스테이지로 열리지 않고 로비에서 시아코인으로 연다 */
export const EXTRA_IDS = ['cat'] as const;
/** 출전할 수 있는 모든 캐릭터 = 십이지 12 + 고양이 (071_characters.sql 의 _character_ids 와 같다) */
export const CHAR_IDS = [...ZODIAC_IDS, ...EXTRA_IDS] as const;
export type CharId = (typeof CHAR_IDS)[number];

/** 판 밖 재화(엽전) 규칙 — 서버(048_defense.sql 의 _defense_const)와 같은 값 */
export const COINS = {
  /** 새로 딴 별 하나마다 */
  perStar: 20,
  /** 실패·포기: 클리어 보상 × 끝낸 웨이브 수 ÷ 이 값 (15 = 40% × 끝낸 웨이브 / 6. 서버와 같은 정수 계산) */
  failDiv: 15,
};
