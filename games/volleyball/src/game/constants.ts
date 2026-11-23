/**
 * 시아배구 규칙 값 (PRD 3·4장). 길이는 px(경기장 좌표), 시간은 틱(1/60초), 속도는 px/틱.
 * 물리 수치는 모두 여기서만 고친다.
 */

/** 계산 한 걸음 (고정 시간 간격: 60분의 1초) */
export const TICK_RATE = 60;
export const STEP_MS = 1000 / TICK_RATE;

// ---------- 화면 (세로 720×1280 기준) ----------
export const SCREEN_W = 720;
export const SCREEN_H = 1280;
/** 위에서부터 점수판 160 / 경기장 840 / 조작 280 */
export const SCORE_H = 160;
export const COURT_W = 720;
export const COURT_H = 840;
export const PAD_H = 280;

// ---------- 경기장 (좌표: 왼쪽 위가 0,0 · 아래로 갈수록 y가 커진다) ----------
/** 벽·천장 두께 */
export const WALL = 16;
/** 공·캐릭터가 움직일 수 있는 안쪽 경계 */
export const LEFT = WALL;
export const RIGHT = COURT_W - WALL;
export const CEIL = WALL;
/** 바닥 높이 (그 아래 64px는 바닥 그림) */
export const FLOOR_Y = 776;

/** 네트: 가운데, 폭 12, 높이 200. 윗부분은 반지름 6짜리 둥근 면 */
export const NET_X = COURT_W / 2;
export const NET_W = 12;
export const NET_H = 200;
export const NET_TOP = FLOOR_Y - NET_H;
export const NET_R = NET_W / 2;
/** 네트 위 둥근 면의 중심 높이 */
export const NET_CAP_Y = NET_TOP + NET_R;

// ---------- 공 ----------
export const BALL_R = 24;
export const BALL_GRAVITY = 0.45;
/** 벽·천장·네트에 맞았을 때 반발 */
export const RESTITUTION = 0.9;
/** 캐릭터에 맞았을 때: 튕김 속도 최소 11 + 캐릭터 속도의 50% */
export const HIT_MIN_SPEED = 11;
export const HIT_CARRY = 0.5;
/** 공 최대 속도 (랠리 가속이 붙으면 최대 30) */
export const BALL_MAX_SPEED = 20;

// ---------- 캐릭터 (모두 같은 능력) ----------
export const PLAYER_R = 36;
export const PLAYER_GRAVITY = 0.8;
export const MOVE_SPEED = 5;
/** 점프 처음 속도 (높이 약 120~130px) */
export const JUMP_SPEED = 14;
/** 땅에 서 있을 때 캐릭터 중심 높이 */
export const GROUND_Y = FLOOR_Y - PLAYER_R;
/** 자리별 움직일 수 있는 범위 (자기 코트 안). 0 = 왼쪽, 1 = 오른쪽 */
export const PLAYER_MIN_X = [LEFT + PLAYER_R, NET_X + NET_W / 2 + PLAYER_R] as const;
export const PLAYER_MAX_X = [NET_X - NET_W / 2 - PLAYER_R, RIGHT - PLAYER_R] as const;
/** 서브 때 서는 자리 (자기 코트 가운데) */
export const START_X = [(PLAYER_MIN_X[0] + PLAYER_MAX_X[0]) / 2, (PLAYER_MIN_X[1] + PLAYER_MAX_X[1]) / 2] as const;

// ---------- 경기 규칙 ----------
/** 3점 선승, 듀스 없음 */
export const WIN_SCORE = 3;
/** 득점 뒤 멈추는 시간: 1.5초 */
export const POINT_PAUSE_TICKS = 90;
/** 서브: 공이 떨어지기 시작하는 높이 (공 중심) */
export const SERVE_Y = 330;
/**
 * 서브 공은 머리 바로 위가 아니라 네트 쪽으로 이만큼 비켜서 떨어진다.
 * (정확히 머리 위면 가만히 서 있는 캐릭터 머리에서 공이 끝없이 똑바로 튄다)
 */
export const SERVE_OFFSET = 12;
/** 랠리 가속: 서브 후 10초마다 +10%, 최대 +50% */
export const RALLY_STAGE_TICKS = 600;
export const RALLY_STAGE_GAIN = 0.1;
export const RALLY_MAX_STAGE = 5;

/** 한 틱을 몇 번으로 나눠 움직일지 (빠른 공이 네트·캐릭터를 뚫고 지나가지 않게) */
export const SUBSTEPS = 4;

/** 경기 시작 전 카운트다운 (초) */
export const COUNTDOWN_SEC = 3;

// ---------- AI (PRD 6장: 보통 난이도 한 가지) ----------
/** 반응 지연 0.15~0.25초 */
export const AI_REACT_MIN = 0.15;
export const AI_REACT_MAX = 0.25;
/** 공이 떨어질 곳 예측 오차 ±20px */
export const AI_ERROR = 20;

/** 십이지 12 (띠 순서). AI 상대·로비 그림·배경 깃발은 이 12개에서만 (추가 캐릭터는 계정마다 열어야 쓴다) */
export const ZODIAC_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;
/** 십이지 밖의 추가 캐릭터 (shared/characters.js 의 EXTRA_IDS 와 같게) */
export const EXTRA_IDS = ['cat'] as const;
/** 고를 수 있는 전체 캐릭터 = 십이지 12 + 추가 캐릭터 (shared/characters.js 의 ALL_CHARACTER_IDS, 서버 _character_ids() 와 같게) */
export const CHAR_IDS = [...ZODIAC_IDS, ...EXTRA_IDS] as const;
/** 캐릭터 id (십이지 + 추가 캐릭터). 능력치는 캐릭터마다 같고 겉모습만 다르다 */
export type ZodiacId = (typeof CHAR_IDS)[number];
export const isCharId = (v: unknown): v is ZodiacId => typeof v === 'string' && (CHAR_IDS as readonly string[]).includes(v);
export const ZODIAC_NICK: Record<ZodiacId, string> = {
  rat: '찍찍이', ox: '우직이', tiger: '어흥이', rabbit: '깡총이', dragon: '여의룡', snake: '스르르',
  horse: '따각이', sheep: '몽실이', monkey: '재롱이', rooster: '꼬꼬댁', dog: '멍뭉이', pig: '꿀꿀이',
  cat: '야옹이',
};
