import type { BuildingType } from './buildings';

/**
 * 기념물 (PRD 9장): 다른 게임에서 성과를 내면 열리는 특별 장식물. 열리면 보관함으로 들어온다.
 * 조건은 서버가 각 게임의 기록 표를 읽어서 판정한다 (SQL 의 _village_game_stats · _village_monument_defs 와 같아야 한다 — tests/sql.test.ts).
 * 그림 · 이름 · 번영도 점수는 buildings.ts 의 mon_* 줄.
 */

/** 서버가 읽어 주는 게임 기록의 이름 */
export const STAT_IDS = [
  'tank_wins', 'volley_wins', 'race_plays', 'surv_field', 'surv_bamboo', 'surv_palace', 'surv_underworld',
  'def_3', 'def_6', 'def_9', 'def_12', 'matgo_wins', 'casino_wins',
  // 081: 시아돌격대(모은 별 · 끝없는 길 최고 거리 m) · 시아핑거(모은 별 · 끝없는 탑 최고 층)
  'charge_stars', 'charge_meters', 'finger_stars', 'finger_floor',
] as const;
export type StatId = (typeof STAT_IDS)[number];
export type GameStats = Record<StatId, number>;
export const noStats = (): GameStats => Object.fromEntries(STAT_IDS.map((k) => [k, 0])) as GameStats;

export interface MonumentDef {
  id: BuildingType;
  /** 어느 게임 (화면에서 묶어 보여 준다) */
  game: string;
  /** 조건 (화면 글) */
  cond: string;
  stat: StatId;
  need: number;
}

export const GAMES: { id: string; name: string; icon: string }[] = [
  { id: 'tank', name: '시아탱크', icon: '💣' },
  { id: 'volley', name: '시아배구', icon: '🏐' },
  { id: 'race', name: '시아레이스', icon: '🏁' },
  { id: 'survival', name: '시아서바이벌', icon: '⚔️' },
  { id: 'defense', name: '시아디펜스', icon: '🏯' },
  { id: 'matgo', name: '시아맞고', icon: '🎴' },
  { id: 'casino', name: '시아카지노', icon: '🎰' },
  { id: 'charge', name: '시아돌격대', icon: '🚩' },
  { id: 'finger', name: '시아핑거', icon: '👆' },
];

export const MONUMENTS: MonumentDef[] = [
  { id: 'mon_tank1', game: 'tank', cond: '첫 승리', stat: 'tank_wins', need: 1 },
  { id: 'mon_tank10', game: 'tank', cond: '10승', stat: 'tank_wins', need: 10 },
  { id: 'mon_volley1', game: 'volley', cond: '첫 승리', stat: 'volley_wins', need: 1 },
  { id: 'mon_volley10', game: 'volley', cond: '10승', stat: 'volley_wins', need: 10 },
  { id: 'mon_race1', game: 'race', cond: '완주하기', stat: 'race_plays', need: 1 },
  { id: 'mon_race2', game: 'race', cond: '다시 달려 기록에 도전하기 (완주 2번)', stat: 'race_plays', need: 2 },
  { id: 'mon_surv_field', game: 'survival', cond: '들판 클리어', stat: 'surv_field', need: 1 },
  { id: 'mon_surv_bamboo', game: 'survival', cond: '대나무 숲 클리어', stat: 'surv_bamboo', need: 1 },
  { id: 'mon_surv_palace', game: 'survival', cond: '달빛 궁궐 클리어', stat: 'surv_palace', need: 1 },
  { id: 'mon_surv_underworld', game: 'survival', cond: '황천길 클리어', stat: 'surv_underworld', need: 1 },
  { id: 'mon_def3', game: 'defense', cond: '3지역 클리어', stat: 'def_3', need: 1 },
  { id: 'mon_def6', game: 'defense', cond: '6지역 클리어', stat: 'def_6', need: 1 },
  { id: 'mon_def9', game: 'defense', cond: '9지역 클리어', stat: 'def_9', need: 1 },
  { id: 'mon_def12', game: 'defense', cond: '12지역 클리어', stat: 'def_12', need: 1 },
  { id: 'mon_matgo', game: 'matgo', cond: '첫 승리 (한 판 따기)', stat: 'matgo_wins', need: 1 },
  { id: 'mon_casino', game: 'casino', cond: '첫 승리 (한 판 따기)', stat: 'casino_wins', need: 1 },
  { id: 'mon_charge30', game: 'charge', cond: '별 30개 모으기', stat: 'charge_stars', need: 30 },
  { id: 'mon_charge100', game: 'charge', cond: '별 100개 모으기', stat: 'charge_stars', need: 100 },
  { id: 'mon_charge_road', game: 'charge', cond: '끝없는 길 1,000m 달리기', stat: 'charge_meters', need: 1000 },
  { id: 'mon_finger30', game: 'finger', cond: '별 30개 모으기', stat: 'finger_stars', need: 30 },
  { id: 'mon_finger100', game: 'finger', cond: '별 100개 모으기', stat: 'finger_stars', need: 100 },
  { id: 'mon_finger_tower', game: 'finger', cond: '끝없는 탑 20층 오르기', stat: 'finger_floor', need: 20 },
];
export const MONUMENT = Object.fromEntries(MONUMENTS.map((m) => [m.id, m])) as Partial<Record<BuildingType, MonumentDef>>;
