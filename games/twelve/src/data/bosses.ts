/**
 * 지형 보스 12종 (시아디펜스 보스 그림). 큰 공격은 모두 땅에 빨간 범위가 먼저 보인다 (PRD '요괴 공격 예고').
 * 능력치는 Lv1 맵 기준 — 맵 배율을 곱한다. 1~7지형 보스는 저마다의 공격 패턴이 있고, 8지형부터는 아직 기본 패턴을 쓴다.
 */
import type { EnemyKind } from './enemies';

export const BOSS_IDS = ['bigDokkaebi', 'dueoksini', 'bulgasal', 'jangsanbeom', 'centipede', 'gumiho', 'guardCaptain', 'yagwanggwi', 'imugi', 'reaper', 'gangcheori', 'yeomra'] as const;
export type BossId = (typeof BOSS_IDS)[number];

/** 보스 공격 한 가지. warn = 예고 시간, mul = 보스 공격력 배율 */
export type BossMove =
  /** 대원이 서 있는 자리를 내려찍는다. count 번 이어서 (gap 초 간격) */
  | { t: 'slam'; r: number; warn: number; mul: number; count?: number; gap?: number }
  /** 대원 쪽으로 직선 돌진 */
  | { t: 'charge'; len: number; w: number; warn: number; mul: number }
  /** 앞쪽 부채꼴 휩쓸기 */
  | { t: 'cone'; r: number; half: number; warn: number; mul: number }
  /** 내 둘레 전체 */
  | { t: 'ring'; r: number; warn: number; mul: number }
  /** 여러 곳에 던지기: 대원 자리에 하나, 그 둘레 spread 안에 나머지 (n 개, gap 초씩 늦게 터진다) */
  | { t: 'barrage'; n: number; r: number; spread: number; warn: number; mul: number; gap?: number; pool?: { dur: number; mul: number } }
  /** 사방으로 뻗는 직선 n 개 (하나는 대원 쪽. turn = 돌려 놓는 각도) */
  | { t: 'cross'; n: number; len: number; w: number; warn: number; mul: number; turn?: number }
  /** 대원이 선 자리로 뛰어든다. count 번 이어서 (gap 초 간격, 그때마다 대원 자리를 다시 본다) */
  | { t: 'leap'; r: number; warn: number; mul: number; count?: number; gap?: number }
  /** 나란한 직선 n 개 (가운데 줄이 대원을 지난다. space = 줄 사이 거리 — 줄 사이에 서면 안 맞는다) */
  | { t: 'rake'; n: number; len: number; w: number; space: number; warn: number; mul: number }
  /** 내 둘레를 친 뒤 구슬 n 개를 사방으로 쏜다 (speed = 구슬 속도, turn = 돌려 놓는 각도) */
  | { t: 'nova'; n: number; r: number; speed: number; warn: number; mul: number; turn?: number }
  /** 대원 쪽으로 줄지어 떨어지는 원 n 개 (step 간격, gap 초씩 늦게 — 옆으로 비키면 안 맞는다) */
  | { t: 'march'; n: number; r: number; step: number; warn: number; mul: number; gap: number };

export interface BossDef {
  id: BossId;
  name: string;
  art: string;
  /** 화면에 그리는 높이 */
  size: number;
  r: number;
  hp: number;
  atk: number;
  speed: number;
  /** 공격 사이 쉬는 시간 */
  gap: number;
  /** 차례로 쓰는 공격 */
  moves: BossMove[];
  /** 어려움 모드에서 더해지는 공격 (PRD: 패턴이 하나씩 더 생긴다) */
  hardMoves: BossMove[];
  /** 체력이 이 비율 아래로 내려갈 때마다 부하를 부른다 */
  summonAt: number[];
  summon: { kind: EnemyKind; n: number };
  exp: number;
  coin: number;
  /** 보스 전 대사 (2~3줄) · 쓰러질 때 한마디 */
  lines: string[];
  last: string;
}

const BASE_MOVES: BossMove[] = [
  { t: 'slam', r: 150, warn: 0.9, mul: 1.2 },
  { t: 'cone', r: 330, half: 0.7, warn: 0.8, mul: 1 },
  { t: 'charge', len: 620, w: 130, warn: 0.85, mul: 1.3 },
  { t: 'ring', r: 250, warn: 1.0, mul: 1.1 },
];
const HARD_MOVES: BossMove[] = [{ t: 'slam', r: 130, warn: 0.75, mul: 1.1, count: 3, gap: 0.45 }];

const B = (id: BossId, name: string, size: number, summon: EnemyKind, lines: string[], over: Partial<BossDef> = {}): BossDef => ({
  id, name, art: `b-${id}`, size, r: 62, hp: 2900, atk: 16, speed: 85, gap: 1.5,
  moves: BASE_MOVES, hardMoves: HARD_MOVES, summonAt: [0.66, 0.33], summon: { kind: summon, n: 3 }, exp: 150, coin: 80, lines, last: '', ...over,
});

export const BOSSES: Record<BossId, BossDef> = {
  // 1지형: 기본기 — 내려찍기·휩쓸기·돌진·둘레
  bigDokkaebi: B('bigDokkaebi', '큰 도깨비', 190, 'imp', ['이 들판은 내 놀이터다!', '봉인이 풀렸으니 실컷 놀아야지.', '방망이 맛 좀 볼 테냐?'], { last: '아이고… 내 방망이…' }),
  // 2지형: 진흙 덩이를 여기저기 던지고, 두 번 이어 찍는다 (느리지만 아프다)
  dueoksini: B('dueoksini', '두억시니', 190, 'mud', ['누가 내 논두렁을 밟느냐.', '진흙에 발이 묶이면 끝이다.', '납작하게 눌러 주마!'], {
    last: '논이… 다 말라 버리겠구나…',
    hp: 3250, atk: 17, speed: 70, gap: 1.7,
    moves: [
      { t: 'barrage', n: 5, r: 105, spread: 260, warn: 1.0, mul: 1.1, gap: 0.14 },
      { t: 'slam', r: 160, warn: 0.9, mul: 1.3, count: 2, gap: 0.6 },
      { t: 'charge', len: 560, w: 150, warn: 0.95, mul: 1.3 },
      { t: 'barrage', n: 7, r: 95, spread: 320, warn: 1.1, mul: 1.1, gap: 0.12 },
      { t: 'ring', r: 270, warn: 1.1, mul: 1.2 },
    ],
    hardMoves: [{ t: 'barrage', n: 9, r: 95, spread: 340, warn: 0.9, mul: 1.1, gap: 0.1 }],
  }),
  // 3지형: 쇠가시를 사방으로 뻗고, 빠르게 연달아 돌진한다
  bulgasal: B('bulgasal', '불가살', 200, 'wisp', ['쇠란 쇠는 다 내 밥이다.', '네 칼도 맛있어 보이는구나.', '죽지 않는 몸을 벨 수 있겠느냐?'], {
    last: '이 몸이… 부서지다니…',
    hp: 3100, atk: 17, speed: 105, gap: 1.3,
    moves: [
      { t: 'cross', n: 4, len: 520, w: 90, warn: 0.9, mul: 1.2 },
      { t: 'charge', len: 640, w: 120, warn: 0.7, mul: 1.3 },
      { t: 'cross', n: 4, len: 520, w: 90, warn: 0.8, mul: 1.2, turn: Math.PI / 4 },
      { t: 'cone', r: 340, half: 0.8, warn: 0.8, mul: 1.1 },
      { t: 'charge', len: 640, w: 120, warn: 0.7, mul: 1.3 },
      { t: 'slam', r: 130, warn: 0.8, mul: 1.1, count: 3, gap: 0.45 },
    ],
    hardMoves: [{ t: 'cross', n: 8, len: 560, w: 70, warn: 0.9, mul: 1.2 }],
  }),
  // 4지형: 빠르다 — 대원 자리로 연달아 뛰어들고, 사이사이 울부짖는다
  jangsanbeom: B('jangsanbeom', '장산범', 190, 'shade', ['이리 와… 이리 와…', '네 동무 목소리 같지 않으냐?', '달그림자 속에서는 내가 안 보일걸.'], {
    last: '달이… 너무 밝구나…',
    hp: 3000, atk: 17, speed: 125, gap: 1.2,
    moves: [
      { t: 'leap', r: 125, warn: 0.8, mul: 1.2, count: 3, gap: 0.55 },
      { t: 'cone', r: 350, half: 0.85, warn: 0.85, mul: 1.1 },
      { t: 'leap', r: 150, warn: 0.75, mul: 1.3 },
      { t: 'charge', len: 660, w: 120, warn: 0.75, mul: 1.3 },
      { t: 'leap', r: 125, warn: 0.8, mul: 1.2, count: 2, gap: 0.5 },
      { t: 'ring', r: 260, warn: 1.0, mul: 1.2 },
    ],
    hardMoves: [{ t: 'leap', r: 115, warn: 0.7, mul: 1.2, count: 5, gap: 0.45 }],
  }),
  // 5지형: 수많은 다리 — 나란한 줄로 훑고(줄 사이에 서면 안 맞는다), 길게 돌진한다
  centipede: B('centipede', '왕지네', 200, 'catfish', ['연못 밑은 내 굴이다.', '다리가 몇 개인지 세어 보겠느냐?', '물살에 떠밀려 내 입으로 오너라.'], {
    last: '내 다리가… 다 꼬였구나…',
    hp: 3400, atk: 18, speed: 80, gap: 1.6,
    moves: [
      { t: 'rake', n: 5, len: 620, w: 78, space: 185, warn: 1.0, mul: 1.2 },
      { t: 'charge', len: 700, w: 140, warn: 0.9, mul: 1.4 },
      { t: 'rake', n: 4, len: 620, w: 78, space: 185, warn: 0.9, mul: 1.2 },
      { t: 'slam', r: 150, warn: 0.9, mul: 1.2, count: 2, gap: 0.6 },
      { t: 'charge', len: 700, w: 140, warn: 0.9, mul: 1.4 },
      { t: 'ring', r: 270, warn: 1.1, mul: 1.2 },
    ],
    hardMoves: [{ t: 'rake', n: 7, len: 660, w: 70, space: 160, warn: 0.9, mul: 1.2 }],
  }),
  // 6지형: 여우구슬을 사방으로 쏘고, 독불을 던져 웅덩이를 남긴다
  gumiho: B('gumiho', '구미호', 200, 'toad', ['간을 내놓고 가렴.', '아흔아홉은 먹었으니 네가 백 번째구나.', '내 구슬을 피할 수 있겠니?'], {
    last: '사람이… 되고 싶었을 뿐인데…',
    hp: 3100, atk: 17, speed: 105, gap: 1.4,
    moves: [
      { t: 'nova', n: 10, r: 150, speed: 300, warn: 0.9, mul: 1.1 },
      { t: 'barrage', n: 4, r: 95, spread: 250, warn: 1.0, mul: 1.0, gap: 0.15, pool: { dur: 4, mul: 0.4 } },
      { t: 'leap', r: 135, warn: 0.8, mul: 1.2, count: 2, gap: 0.55 },
      { t: 'nova', n: 12, r: 150, speed: 300, warn: 0.9, mul: 1.1, turn: 0.26 },
      { t: 'cone', r: 340, half: 0.8, warn: 0.8, mul: 1.1 },
      { t: 'barrage', n: 5, r: 95, spread: 280, warn: 1.0, mul: 1.0, gap: 0.15, pool: { dur: 4, mul: 0.4 } },
    ],
    hardMoves: [{ t: 'nova', n: 16, r: 150, speed: 340, warn: 0.85, mul: 1.1, turn: 0.13 }],
  }),
  // 7지형: 화살 비를 줄지어 떨구고, 방패로 밀고 들어온다 (단단하다)
  guardCaptain: B('guardCaptain', '수문장 대장', 200, 'guard', ['성문은 열리지 않는다!', '궁수들, 시위를 당겨라!', '이 문을 지나려면 나를 넘어야 한다.'], {
    last: '문을… 열어 주마…',
    hp: 3600, atk: 18, speed: 85, gap: 1.5,
    moves: [
      { t: 'march', n: 6, r: 100, step: 125, warn: 0.9, mul: 1.2, gap: 0.16 },
      { t: 'cone', r: 330, half: 1.0, warn: 0.85, mul: 1.2 },
      { t: 'charge', len: 600, w: 150, warn: 0.85, mul: 1.4 },
      { t: 'march', n: 8, r: 95, step: 110, warn: 0.85, mul: 1.2, gap: 0.13 },
      { t: 'slam', r: 140, warn: 0.8, mul: 1.2, count: 3, gap: 0.5 },
      { t: 'ring', r: 260, warn: 1.0, mul: 1.2 },
    ],
    hardMoves: [{ t: 'cross', n: 6, len: 560, w: 80, warn: 0.9, mul: 1.2 }],
  }),
  yagwanggwi: B('yagwanggwi', '야광귀', 185, 'spirit', ['신발을 두고 가거라.']),
  imugi: B('imugi', '이무기', 205, 'guard', ['여의주만 있으면 용이 될 텐데.']),
  reaper: B('reaper', '저승사자', 190, 'skeleton', ['명부에 네 이름이 있구나.']),
  gangcheori: B('gangcheori', '강철이', 200, 'skeleton', ['내가 지나간 자리엔 풀도 안 난다.']),
  yeomra: B('yeomra', '염라대왕', 215, 'skeleton', ['열두 길의 끝에 온 것을 환영한다.']),
};
