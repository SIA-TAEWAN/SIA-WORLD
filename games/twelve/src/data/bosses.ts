/**
 * 지형 보스 12종 (시아디펜스 보스 그림). 큰 공격은 모두 땅에 빨간 범위가 먼저 보인다 (PRD '요괴 공격 예고').
 * 능력치는 Lv1 맵 기준 — 맵 배율을 곱한다. 보스마다 그 보스만의 공격이 하나씩 있다.
 */
import type { EnemyKind } from './enemies';

export const BOSS_IDS = ['bigDokkaebi', 'dueoksini', 'bulgasal', 'jangsanbeom', 'centipede', 'gumiho', 'guardCaptain', 'yagwanggwi', 'imugi', 'reaper', 'gangcheori', 'yeomra'] as const;
/** 최종보스 (최종보스맵 'final' — 지형 보스 목록 BOSS_IDS 에는 넣지 않는다) */
export const FINAL_BOSS = 'eoduksini';
export type BossId = (typeof BOSS_IDS)[number] | typeof FINAL_BOSS;

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
  | { t: 'march'; n: number; r: number; step: number; warn: number; mul: number; gap: number }
  /** 내 둘레를 친 뒤 구슬을 돌려 가며 쏜다: n 번, gap 초마다 turn 만큼 돌면서 arms 갈래씩 */
  | { t: 'spiral'; n: number; arms: number; r: number; speed: number; warn: number; mul: number; gap: number; turn: number }
  /** 물결: 대원 쪽으로 가로지르는 줄 n 개가 step 간격으로, gap 초씩 늦게 (줄 사이에 서거나 굴러서 넘는다) */
  | { t: 'wave'; n: number; len: number; w: number; step: number; warn: number; mul: number; gap: number }
  /** 돌려 베기: 둘레를 n 조각으로 나눠 대원 쪽부터 gap 초씩 늦게 벤다 (dir = 도는 쪽) */
  | { t: 'sweep'; n: number; r: number; warn: number; mul: number; gap: number; dir?: 1 | -1 }
  /** 불숨: 대원 쪽으로 직선 n 줄기(spread 만큼 벌려서), 지나간 자리에 불길이 남는다 */
  | { t: 'scorch'; len: number; w: number; warn: number; mul: number; n?: number; spread?: number; pool: { dur: number; mul: number } }
  /** 에워싸기: 대원 둘레(거리 d)에 원 n 개, gap 초 뒤 가운데 */
  | { t: 'cage'; n: number; r: number; d: number; warn: number; mul: number; gap: number }
  /** 열두 시 (최종보스): 둘레로 뻗는 직선 n 개가 대원 쪽부터 gap 초씩 늦게 차례로 친다 (dir = 도는 쪽 — 도는 쪽을 따라 돌거나 굴러서 넘는다) */
  | { t: 'clock'; n: number; len: number; w: number; warn: number; mul: number; gap: number; dir?: 1 | -1 }
  /** 무너지는 봉인 (최종보스): 대원 둘레 바둑판(span 칸씩, 칸 간격 cell)의 한 색 칸이 먼저, gap 초 뒤 나머지 칸이 터진다 (안 터지는 칸에 섰다가 옮겨 선다) */
  | { t: 'checker'; span: number; cell: number; r: number; warn: number; mul: number; gap: number };

/** 보스의 다음 단계 (최종보스): 체력이 at 아래로 내려가면 공격 목록이 바뀐다 */
export interface BossPhase {
  at: number;
  moves: BossMove[];
  gap: number;
  speed: number;
  /** 화면에 그리는 높이 (어둑시니는 단계마다 커진다) */
  size: number;
  /** 단계가 바뀔 때 화면에 뜨는 글 */
  say: string;
}

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
  /** 다음 단계들 (최종보스만. 없으면 moves 를 끝까지 쓴다) */
  phases?: BossPhase[];
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
  // 8지형: 도깨비불을 소용돌이처럼 돌려 쏜다 — 불 사이로 돌아 들어간다
  yagwanggwi: B('yagwanggwi', '야광귀', 185, 'sleeper', ['신발을 두고 가거라.', '체 구멍을 세다 날이 샌 게 아직도 분하구나.', '졸리지? 자고 가렴. 영영.'], {
    last: '벌써… 날이 밝았느냐…',
    hp: 3700, atk: 18, speed: 110, gap: 1.4, exp: 200, coin: 100,
    moves: [
      { t: 'spiral', n: 14, arms: 2, r: 140, speed: 270, warn: 0.9, mul: 1.0, gap: 0.13, turn: 0.42 },
      { t: 'leap', r: 130, warn: 0.8, mul: 1.2, count: 2, gap: 0.55 },
      { t: 'cone', r: 340, half: 0.85, warn: 0.85, mul: 1.1 },
      { t: 'spiral', n: 18, arms: 2, r: 140, speed: 270, warn: 0.9, mul: 1.0, gap: 0.11, turn: -0.38 },
      { t: 'barrage', n: 5, r: 100, spread: 270, warn: 1.0, mul: 1.1, gap: 0.14 },
      { t: 'ring', r: 260, warn: 1.0, mul: 1.2 },
    ],
    hardMoves: [{ t: 'spiral', n: 16, arms: 3, r: 150, speed: 300, warn: 0.85, mul: 1.0, gap: 0.12, turn: 0.33 }],
  }),
  // 9지형: 물결이 줄지어 밀려온다 — 줄 사이에 서거나 굴러서 넘는다
  imugi: B('imugi', '이무기', 205, 'guard', ['여의주만 있으면 용이 될 텐데.', '천 년을 기다렸다. 너희 열쇠가 내 여의주다.', '물결에 쓸려 가거라!'], {
    last: '하늘이… 저리 가까웠는데…',
    hp: 3900, atk: 19, speed: 80, gap: 1.6, exp: 200, coin: 100,
    moves: [
      { t: 'wave', n: 5, len: 840, w: 84, step: 170, warn: 1.0, mul: 1.2, gap: 0.24 },
      { t: 'charge', len: 700, w: 140, warn: 0.9, mul: 1.4 },
      { t: 'rake', n: 4, len: 620, w: 78, space: 185, warn: 0.9, mul: 1.2 },
      { t: 'wave', n: 6, len: 840, w: 84, step: 155, warn: 0.9, mul: 1.2, gap: 0.2 },
      { t: 'slam', r: 150, warn: 0.9, mul: 1.2, count: 2, gap: 0.6 },
      { t: 'ring', r: 270, warn: 1.1, mul: 1.2 },
    ],
    hardMoves: [{ t: 'wave', n: 8, len: 840, w: 90, step: 150, warn: 0.9, mul: 1.2, gap: 0.15 }],
  }),
  // 10지형: 낫을 돌려 둘레를 차례로 벤다 — 도는 쪽을 따라 돌거나 굴러서 지난다
  reaper: B('reaper', '저승사자', 190, 'skeleton', ['명부에 네 이름이 있구나.', '새벽닭이 울기 전에 데려가야겠다.', '낫 그림자를 피할 수 있겠느냐?'], {
    last: '명부를… 다시 봐야겠구나…',
    hp: 4000, atk: 19, speed: 115, gap: 1.3, exp: 200, coin: 100,
    moves: [
      { t: 'sweep', n: 4, r: 300, warn: 0.9, mul: 1.2, gap: 0.34 },
      { t: 'leap', r: 130, warn: 0.8, mul: 1.2, count: 2, gap: 0.5 },
      { t: 'cross', n: 4, len: 540, w: 86, warn: 0.85, mul: 1.2 },
      { t: 'sweep', n: 6, r: 320, warn: 0.85, mul: 1.2, gap: 0.26, dir: -1 },
      { t: 'charge', len: 660, w: 120, warn: 0.75, mul: 1.3 },
      { t: 'slam', r: 135, warn: 0.8, mul: 1.1, count: 3, gap: 0.45 },
    ],
    hardMoves: [{ t: 'sweep', n: 8, r: 340, warn: 0.85, mul: 1.2, gap: 0.2 }],
  }),
  // 11지형: 불숨을 뿜어 지나간 자리를 태운다 — 불길이 꺼질 때까지 그 자리를 못 쓴다
  gangcheori: B('gangcheori', '강철이', 200, 'skeleton', ['내가 지나간 자리엔 풀도 안 난다.', '강물도 내 불 앞에서는 끓는다.', '재가 되어 삼도천에 뿌려지거라!'], {
    last: '비가… 오는구나…',
    hp: 4300, atk: 20, speed: 90, gap: 1.5, exp: 200, coin: 100,
    moves: [
      { t: 'scorch', len: 640, w: 120, warn: 0.9, mul: 1.2, pool: { dur: 4, mul: 0.4 } },
      { t: 'barrage', n: 5, r: 95, spread: 280, warn: 1.0, mul: 1.0, gap: 0.15 },
      { t: 'charge', len: 680, w: 140, warn: 0.9, mul: 1.4 },
      { t: 'scorch', len: 600, w: 96, warn: 1.0, mul: 1.2, n: 3, spread: 0.55, pool: { dur: 4, mul: 0.4 } },
      { t: 'cone', r: 340, half: 0.9, warn: 0.85, mul: 1.2 },
      { t: 'ring', r: 270, warn: 1.0, mul: 1.2 },
    ],
    hardMoves: [{ t: 'scorch', len: 620, w: 86, warn: 0.95, mul: 1.2, n: 5, spread: 0.5, pool: { dur: 5, mul: 0.4 } }],
  }),
  // 12지형: 대원을 에워싸고 가운데를 친다 — 앞 보스들의 공격도 섞어 쓴다
  yeomra: B('yeomra', '염라대왕', 215, 'skeleton', ['열두 길의 끝에 온 것을 환영한다.', '업경에 네 지난 길이 다 비치는구나.', '판결을 내리겠다!'], {
    last: '열쇠를… 가져가거라. 허나 봉인은 아직…',
    hp: 4800, atk: 21, speed: 85, gap: 1.4, exp: 200, coin: 100,
    moves: [
      { t: 'cage', n: 8, r: 85, d: 215, warn: 1.0, mul: 1.2, gap: 0.55 },
      { t: 'cross', n: 6, len: 560, w: 80, warn: 0.9, mul: 1.2 },
      { t: 'scorch', len: 620, w: 100, warn: 1.0, mul: 1.2, n: 3, spread: 0.6, pool: { dur: 3.5, mul: 0.4 } },
      { t: 'cage', n: 10, r: 80, d: 235, warn: 0.95, mul: 1.2, gap: 0.5 },
      { t: 'sweep', n: 4, r: 310, warn: 0.9, mul: 1.2, gap: 0.32 },
      { t: 'slam', r: 140, warn: 0.8, mul: 1.2, count: 3, gap: 0.5 },
      { t: 'nova', n: 12, r: 160, speed: 300, warn: 0.9, mul: 1.1 },
    ],
    hardMoves: [{ t: 'wave', n: 6, len: 840, w: 84, step: 160, warn: 0.9, mul: 1.2, gap: 0.2 }],
  }),
  // 최종보스: 열두 길의 봉인 뒤에 갇혀 있던 어둠. 세 단계 — 앞 지형 보스들의 공격을 네 지형씩 섞어 쓰고, 그 사이에 저만의 공격(열두 시 · 무너지는 봉인)을 넣는다.
  // 볼수록 커진다 (단계마다 몸이 커지고 빨라진다). 예고는 모두 0.75초 이상
  eoduksini: B(FINAL_BOSS, '어둑시니', 230, 'spirit', ['열두 열쇠를 다 모아 왔구나. 고맙다.', '그 열쇠가 나를 가둔 문도 여는 줄은 몰랐겠지.', '볼수록 커지는 어둠을 본 적이 있느냐?'], {
    last: '나는… 그림자일 뿐이다. 봉인 아래에는 아직…',
    // 전용 그림 (ASSETS.md): 볼수록 커지는 어둠 덩어리. 단계마다 같은 그림을 키운다
    art: 'b-final',
    r: 68, hp: 9000, atk: 22, speed: 90, gap: 1.4, exp: 800, coin: 500,
    summonAt: [0.85, 0.5, 0.2], summon: { kind: 'spirit', n: 4 },
    // 1단계: 1~5지형 보스의 공격 + 열두 시
    moves: [
      { t: 'clock', n: 12, len: 600, w: 70, warn: 1.0, mul: 1.2, gap: 0.14 },
      { t: 'barrage', n: 6, r: 100, spread: 290, warn: 1.0, mul: 1.1, gap: 0.13 },
      { t: 'cross', n: 6, len: 560, w: 84, warn: 0.9, mul: 1.2 },
      { t: 'leap', r: 130, warn: 0.8, mul: 1.2, count: 3, gap: 0.55 },
      { t: 'rake', n: 5, len: 640, w: 78, space: 185, warn: 0.95, mul: 1.2 },
      { t: 'cone', r: 350, half: 0.85, warn: 0.85, mul: 1.1 },
    ],
    phases: [
      // 2단계: 6~9지형 보스의 공격 + 열두 시(거꾸로)
      {
        at: 0.66, gap: 1.3, speed: 100, size: 262, say: '어둑시니가 더 커졌어요!',
        moves: [
          { t: 'nova', n: 14, r: 160, speed: 310, warn: 0.9, mul: 1.1 },
          { t: 'march', n: 8, r: 96, step: 112, warn: 0.9, mul: 1.2, gap: 0.13 },
          { t: 'clock', n: 12, len: 620, w: 72, warn: 0.95, mul: 1.2, gap: 0.12, dir: -1 },
          { t: 'spiral', n: 16, arms: 2, r: 150, speed: 280, warn: 0.9, mul: 1.0, gap: 0.12, turn: 0.4 },
          { t: 'wave', n: 6, len: 840, w: 84, step: 160, warn: 0.95, mul: 1.2, gap: 0.2 },
          { t: 'slam', r: 140, warn: 0.8, mul: 1.2, count: 3, gap: 0.5 },
        ],
      },
      // 3단계: 10~12지형 보스의 공격 + 무너지는 봉인 + 열두 시(촘촘하게)
      {
        at: 0.33, gap: 1.15, speed: 110, size: 296, say: '봉인이 무너져요! 어둑시니가 날뛰어요!',
        moves: [
          { t: 'checker', span: 2, cell: 170, r: 84, warn: 1.1, mul: 1.3, gap: 0.9 },
          { t: 'sweep', n: 6, r: 330, warn: 0.9, mul: 1.2, gap: 0.26 },
          { t: 'scorch', len: 640, w: 100, warn: 1.0, mul: 1.2, n: 3, spread: 0.6, pool: { dur: 3.5, mul: 0.4 } },
          { t: 'cage', n: 10, r: 80, d: 235, warn: 0.95, mul: 1.2, gap: 0.5 },
          { t: 'clock', n: 16, len: 640, w: 64, warn: 0.9, mul: 1.2, gap: 0.09 },
          { t: 'checker', span: 2, cell: 170, r: 84, warn: 1.0, mul: 1.3, gap: 0.8 },
          { t: 'nova', n: 16, r: 160, speed: 330, warn: 0.9, mul: 1.1, turn: 0.2 },
        ],
      },
    ],
    hardMoves: [{ t: 'checker', span: 3, cell: 160, r: 82, warn: 1.0, mul: 1.3, gap: 0.75 }],
  }),
};
