// SIA WORLD 공통 테마 (Phaser용 숫자 색 + 문자열 색). shared/theme.css와 같은 값 — 두 파일을 함께 고칠 것.
// 값은 시아탱크(games/tank/src/style.css)의 실제 값 (DESIGN.md 참고).

/** 숫자 색 (Phaser fillStyle 등) */
export const COLOR = {
  skyTop: 0x4aa8ff,
  skyMid: 0x9fd6ff,
  skyBottom: 0xffe9b8,
  skyDeep: 0x1f6fd1,
  panel: 0xfff8e8,
  panelStrong: 0xfff4c2,
  outline: 0x2a1a10,
  ink: 0x2a1a10,
  inkSoft: 0x8a6a4a,
  lineSoft: 0xe2d3b5,
  emptyLine: 0xc9b48e,
  primary: 0xffd34d,
  primaryLight: 0xffe066,
  primaryDeep: 0xf0a500,
  accent: 0xf0a500,
  pink: 0xff4d6d,
  track: 0xeee2c8,
  white: 0xffffff,
  teamA: 0x3d8bff,
  teamB: 0xff4d6d,
  win: 0x4cb86a,
  lose: 0xe86a5a,
  draw: 0x9a8c7e,
  /** 트럼프 빨간 무늬 (♥◆) */
  cardRed: 0xe8564a,
};

/** 게임별 테이블 색 (넓은 면) */
export const TABLE = {
  matgo: 0x7cc08a,
  poker: 0x6cc6b5,
  holdem: 0x6cc6b5,
  blackjack: 0x7fb8e8,
};

/** 시아맞고 담요: 체크 무늬(밝은 칸) · 바닥 자리·먹은 패 칸(어두운 면). 바탕은 TABLE.matgo */
export const MATGO = { matLight: 0x8fcc9b, matDark: 0x5fa772 };

/** 화투 띠 색 (새 색 없이 위 값을 다시 씀): 홍단=트럼프 빨강, 청단=팀 파랑, 초단=승리 초록, 비띠=설명 글자색 */
export const HWATU = { hong: 0xe8564a, cheong: 0x3d8bff, cho: 0x4cb86a, plain: 0x8a6a4a };

/** 룰렛 계절 4색 */
export const ROULETTE = { spring: 0x9cc7f2, summer: 0xf7c1a8, autumn: 0xa9ddc6, winter: 0xc9d1dd };

/** 칩: 금액 → 바탕색·캐릭터 (DESIGN.md 7장) */
export const CHIPS = [
  { min: 10000, color: 0x3fbf8f, animal: 'dragon' }, // 여의룡 (초록, 시아탱크 여의룡 색)
  { min: 1000, color: 0xff9a2e, animal: 'tiger' }, // 어흥이 (주황, 시아탱크 어흥이 색)
  { min: 500, color: 0xff8fb1, animal: 'rabbit' }, // 깡총이 (분홍, 시아탱크 랜덤 선택 그라데이션)
  { min: 0, color: 0x6fd8ff, animal: 'rat' }, // 찍찍이 (하늘, 시아탱크 랜덤 선택 그라데이션)
];

/** 시아레이스: 트랙(넓은 면) · 트랙 어두운 점·레인 구분 · 잔디 (= 맞고 담요 초록) */
export const RACE = { track: 0xf9a873, trackDark: 0xe08a4f, grass: 0x7cc08a };

/** 숫자 색 → '#rrggbb' */
export const css = (n) => `#${n.toString(16).padStart(6, '0')}`;

export const FONT = "Jua, 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";

/** 글자 크기 */
export const SIZE = { title: 26, logo: 56, panel: 20, button: 18, buttonBig: 22, body: 15, small: 12 };

/** 모양 (px) */
export const SHAPE = {
  radiusPanelBig: 28,
  radiusPanel: 20,
  radiusButton: 16,
  radiusItem: 12,
  radiusKey: 6,
  /** 트럼프 모서리 (카드 가로 90px 기준) */
  radiusCard: 10,
  /** 화투 모서리 (카드 가로 60px 기준) */
  radiusHwatu: 8,
  lineBig: 4,
  line: 3,
  lineThin: 2,
  depthBig: 8,
  depthPanel: 5,
  depthButton: 4,
  press: 3,
};

/** 움직임 (ms) */
export const MOTION = { press: 80, deal: 250, flip: 200, cutin: 1200 };
