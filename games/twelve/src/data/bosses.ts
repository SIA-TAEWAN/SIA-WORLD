/**
 * 지형 보스 12종 (시아디펜스 보스 그림). 큰 공격은 모두 땅에 빨간 범위가 먼저 보인다 (PRD '요괴 공격 예고').
 * 능력치는 Lv1 맵 기준 — 맵 배율을 곱한다. 지금은 1지형 보스만 다듬었고, 나머지는 같은 패턴을 쓴다 (6단계에서 채운다).
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
  | { t: 'ring'; r: number; warn: number; mul: number };

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
  /** 보스 전 대사 */
  lines: string[];
}

const BASE_MOVES: BossMove[] = [
  { t: 'slam', r: 150, warn: 0.9, mul: 1.2 },
  { t: 'cone', r: 330, half: 0.7, warn: 0.8, mul: 1 },
  { t: 'charge', len: 620, w: 130, warn: 0.85, mul: 1.3 },
  { t: 'ring', r: 250, warn: 1.0, mul: 1.1 },
];
const HARD_MOVES: BossMove[] = [{ t: 'slam', r: 130, warn: 0.75, mul: 1.1, count: 3, gap: 0.45 }];

const B = (id: BossId, name: string, size: number, summon: EnemyKind, lines: string[], over: Partial<BossDef> = {}): BossDef => ({
  id, name, art: `b-${id}`, size, r: 62, hp: 2200, atk: 16, speed: 85, gap: 1.5,
  moves: BASE_MOVES, hardMoves: HARD_MOVES, summonAt: [0.66, 0.33], summon: { kind: summon, n: 3 }, exp: 150, coin: 80, lines, ...over,
});

export const BOSSES: Record<BossId, BossDef> = {
  bigDokkaebi: B('bigDokkaebi', '큰 도깨비', 190, 'imp', ['이 들판은 내 놀이터다!', '방망이 맛 좀 볼 테냐?']),
  dueoksini: B('dueoksini', '두억시니', 190, 'club', ['논두렁을 넘보다니.']),
  bulgasal: B('bulgasal', '불가살', 200, 'wisp', ['쇠도 씹어 먹는 몸이다.']),
  jangsanbeom: B('jangsanbeom', '장산범', 190, 'fox', ['이리 와… 이리 와…']),
  centipede: B('centipede', '왕지네', 200, 'water', ['연못 밑은 내 굴이다.']),
  gumiho: B('gumiho', '구미호', 200, 'fox', ['간을 내놓고 가렴.']),
  guardCaptain: B('guardCaptain', '수문장 대장', 200, 'guard', ['성문은 열리지 않는다!']),
  yagwanggwi: B('yagwanggwi', '야광귀', 185, 'spirit', ['신발을 두고 가거라.']),
  imugi: B('imugi', '이무기', 205, 'guard', ['여의주만 있으면 용이 될 텐데.']),
  reaper: B('reaper', '저승사자', 190, 'skeleton', ['명부에 네 이름이 있구나.']),
  gangcheori: B('gangcheori', '강철이', 200, 'skeleton', ['내가 지나간 자리엔 풀도 안 난다.']),
  yeomra: B('yeomra', '염라대왕', 215, 'skeleton', ['열두 길의 끝에 온 것을 환영한다.']),
};
