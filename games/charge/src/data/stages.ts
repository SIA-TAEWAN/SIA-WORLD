import type { BossKind, EnemyKind } from './balance';

/**
 * 스테이지 데이터 (PRD.md 8장). 스테이지 하나 = 길 위에 늘어놓은 물건 목록 + 끝의 보스.
 * z 는 출발점에서 앞으로 간 거리(px). 달리는 속도가 초당 300이라 z 3000 ≈ 10초.
 * 스테이지 60개를 이 형식의 데이터만으로 늘릴 수 있게, 게임 코드는 이 파일의 모양만 안다.
 */

export type Op = '+' | '-' | 'x' | '/';

/** 문 하나: 연산과 숫자. + 와 - 는 총을 맞히면 숫자가 오른다 (- 는 0을 지나 + 가 된다) */
export interface GateSpec {
  op: Op;
  v: number;
}

/** 요괴 무리가 차지하는 폭 */
export type Span = 'full' | 'left' | 'right' | 'center';

export type Item =
  /** 문 한 줄 (2~3개가 길을 나눠 차지한다. 그중 하나만 통과한다) */
  | { t: 'gates'; z: number; gates: GateSpec[] }
  /** 길 한쪽에 길게 이어진 작은 문 줄 (그쪽으로 달리면 지날 때마다 계속 더해진다) */
  | { t: 'rail'; z0: number; z1: number; side: 'left' | 'right'; gap: number; gate: GateSpec }
  /** 요괴 무리 */
  | { t: 'horde'; z: number; kind: EnemyKind; count: number; span: Span };

export interface BossSpec {
  kind: BossKind;
  hp: number;
  /** 공격 간격(초) */
  every: number;
  /** 공격 예고 시간(초): 이만큼 전에 떨어질 자리가 빨갛게 보인다 */
  warn: number;
  /** 공격 폭 */
  width: number;
  /** 공격 자리에 있던 대원 중 잃는 비율 */
  frac: number;
}

export interface StageDef {
  id: string;
  region: number;
  name: string;
  startTroops: number;
  items: Item[];
  /** 보스가 서 있는 거리 (이 앞 BOSS_STOP 에서 멈춰 싸운다) */
  bossZ: number;
  boss: BossSpec;
  /** 별 2개·3개 기준: 보스를 쓰러뜨릴 때 남은 대원 수 */
  stars: [number, number];
}

const chief = (hp: number): BossSpec => ({ kind: 'chief', hp, every: 3.2, warn: 1.2, width: 220, frac: 0.4 });

/** 1지역: 쥐의 들판 (PRD 8장). 1~4번째는 작은 대장 요괴, 5번째는 지역 보스 */
export const STAGES: StageDef[] = [
  {
    id: '1-1',
    region: 1,
    name: '첫 돌격',
    startTroops: 5,
    items: [
      { t: 'gates', z: 900, gates: [{ op: '+', v: 5 }, { op: 'x', v: 2 }] },
      { t: 'horde', z: 2600, kind: 'imp', count: 12, span: 'full' },
      { t: 'gates', z: 4000, gates: [{ op: '-', v: 4 }, { op: '+', v: 10 }] },
      { t: 'rail', z0: 5200, z1: 7600, side: 'left', gap: 300, gate: { op: '+', v: 1 } },
      { t: 'gates', z: 8400, gates: [{ op: 'x', v: 2 }, { op: '+', v: 15 }] },
      { t: 'horde', z: 10200, kind: 'imp', count: 30, span: 'full' },
      { t: 'gates', z: 11800, gates: [{ op: '+', v: 20 }, { op: '-', v: 10 }] },
      { t: 'horde', z: 13400, kind: 'imp', count: 25, span: 'left' },
    ],
    bossZ: 15600,
    boss: chief(1500),
    stars: [55, 115],
  },
  {
    id: '1-2',
    region: 1,
    name: '갈림길',
    startTroops: 5,
    items: [
      { t: 'gates', z: 900, gates: [{ op: 'x', v: 3 }, { op: '+', v: 6 }] },
      { t: 'gates', z: 2300, gates: [{ op: '-', v: 6 }, { op: 'x', v: 2 }] },
      { t: 'horde', z: 3800, kind: 'imp', count: 20, span: 'full' },
      { t: 'rail', z0: 5000, z1: 7400, side: 'right', gap: 300, gate: { op: '+', v: 2 } },
      { t: 'horde', z: 8400, kind: 'wisp', count: 18, span: 'full' },
      { t: 'gates', z: 9800, gates: [{ op: '/', v: 2 }, { op: '+', v: 25 }, { op: 'x', v: 2 }] },
      { t: 'horde', z: 11600, kind: 'imp', count: 45, span: 'full' },
      { t: 'gates', z: 13200, gates: [{ op: '+', v: 30 }, { op: '-', v: 15 }] },
    ],
    bossZ: 15600,
    boss: chief(2400),
    stars: [85, 170],
  },
  {
    id: '1-3',
    region: 1,
    name: '방망이 소리',
    startTroops: 6,
    items: [
      { t: 'gates', z: 900, gates: [{ op: '+', v: 8 }, { op: 'x', v: 2 }] },
      { t: 'horde', z: 2400, kind: 'club', count: 4, span: 'full' },
      { t: 'gates', z: 3800, gates: [{ op: 'x', v: 2 }, { op: '-', v: 5 }, { op: '+', v: 12 }] },
      { t: 'horde', z: 5400, kind: 'imp', count: 30, span: 'right' },
      { t: 'rail', z0: 6200, z1: 8600, side: 'left', gap: 300, gate: { op: '+', v: 2 } },
      { t: 'horde', z: 9600, kind: 'club', count: 8, span: 'full' },
      { t: 'gates', z: 11000, gates: [{ op: '/', v: 2 }, { op: 'x', v: 3 }] },
      { t: 'horde', z: 12800, kind: 'imp', count: 60, span: 'full' },
    ],
    bossZ: 15600,
    boss: chief(3600),
    stars: [85, 170],
  },
  {
    id: '1-4',
    region: 1,
    name: '도깨비불 떼',
    startTroops: 6,
    items: [
      { t: 'gates', z: 900, gates: [{ op: 'x', v: 2 }, { op: '+', v: 7 }] },
      { t: 'horde', z: 2300, kind: 'wisp', count: 20, span: 'full' },
      { t: 'gates', z: 3700, gates: [{ op: '-', v: 8 }, { op: '+', v: 15 }] },
      { t: 'rail', z0: 4600, z1: 7000, side: 'right', gap: 300, gate: { op: '+', v: 3 } },
      { t: 'horde', z: 7800, kind: 'wisp', count: 40, span: 'full' },
      { t: 'gates', z: 9200, gates: [{ op: 'x', v: 2 }, { op: '/', v: 3 }, { op: '+', v: 30 }] },
      { t: 'horde', z: 10800, kind: 'club', count: 10, span: 'center' },
      { t: 'horde', z: 12200, kind: 'imp', count: 80, span: 'full' },
      { t: 'gates', z: 13600, gates: [{ op: '+', v: 40 }, { op: 'x', v: 2 }] },
    ],
    bossZ: 15800,
    boss: chief(5000),
    stars: [115, 230],
  },
  {
    id: '1-5',
    region: 1,
    name: '큰 도깨비',
    startTroops: 8,
    items: [
      { t: 'gates', z: 900, gates: [{ op: 'x', v: 2 }, { op: '+', v: 10 }] },
      { t: 'horde', z: 2300, kind: 'imp', count: 25, span: 'full' },
      { t: 'gates', z: 3700, gates: [{ op: '+', v: 20 }, { op: '-', v: 10 }, { op: 'x', v: 2 }] },
      { t: 'rail', z0: 4600, z1: 7000, side: 'left', gap: 300, gate: { op: '+', v: 3 } },
      { t: 'horde', z: 7800, kind: 'club', count: 10, span: 'full' },
      { t: 'gates', z: 9200, gates: [{ op: 'x', v: 3 }, { op: '/', v: 2 }] },
      { t: 'horde', z: 10800, kind: 'wisp', count: 60, span: 'full' },
      { t: 'gates', z: 12200, gates: [{ op: '-', v: 20 }, { op: '+', v: 50 }] },
      { t: 'horde', z: 13600, kind: 'imp', count: 120, span: 'full' },
    ],
    bossZ: 16400,
    boss: { kind: 'bigDokkaebi', hp: 9000, every: 2.8, warn: 1.1, width: 240, frac: 0.45 },
    stars: [125, 250],
  },
];

export const stageOf = (id: string): StageDef | undefined => STAGES.find((s) => s.id === id);
export const stagesOf = (region: number): StageDef[] => STAGES.filter((s) => s.region === region);
/** 다음 스테이지 (없으면 null) */
export function nextStage(id: string): StageDef | null {
  const i = STAGES.findIndex((s) => s.id === id);
  return i >= 0 && i + 1 < STAGES.length ? STAGES[i + 1] : null;
}
