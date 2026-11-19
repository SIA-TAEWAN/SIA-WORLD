import { REGIONS, type BgId } from './regions';

/**
 * 스테이지 데이터 (PRD 1·3·6장). 스테이지 하나 = 이 파일의 객체 하나이고, 코드를 고치지 않고 여기에 추가만 하면 된다.
 *
 * ── 좌표 ──
 * 판은 가로 9칸 × 세로 11칸 (한 칸 80px). 좌표는 [열, 행] 칸 번호이고 칸의 가운데를 가리킨다 (왼쪽 위 칸이 [0, 0]).
 * 판 밖 좌표도 쓸 수 있다: 입구는 [-1, 1] 처럼 판 밖에서 걸어 들어오고, 출구는 [9, 9] 처럼 판 밖으로 나간다. 소수도 된다.
 *
 * ── 길 (routes) ──
 * 길 하나 = 입구에서 출구까지 꺾이는 점들의 목록. 요괴는 자기 길을 처음부터 끝까지 따라간다.
 *   · 입구 여러 곳: 시작점이 다른 길을 여러 개 적는다
 *   · 갈림·합류: 같은 점들을 함께 지나다가 다른 점으로 갈라지는 길을 여러 개 적는다 (겹치는 구간은 한 번만 그려진다)
 *   · 공중 직선 경로: air: true (길을 그리지 않고, 요괴가 배치 칸 위를 가로질러 난다)
 *
 * ── 웨이브 (waves) ──
 * 30초짜리 6개. 웨이브마다 무리(groups)를 적는다: 어느 요괴가(enemy) 몇 마리(count), 웨이브 시작 몇 초 뒤부터(at), 몇 초 간격으로(gap),
 * 어느 길로(route: routes 의 번호, 없으면 0. 'alt' 는 땅 위 길들을 한 마리씩 번갈아).
 * 모든 등장은 그 웨이브의 30초 안에 끝나야 한다 (tests/data.test.ts 가 확인한다) — 3분 뒤에는 새 요괴가 나오지 않는다.
 */
export type Cell = [number, number];

export interface RouteDef {
  id: string;
  pts: Cell[];
  /** 공중 경로 */
  air?: boolean;
}

export interface GroupDef {
  enemy: string;
  count: number;
  at: number;
  gap: number;
  route?: number | 'alt';
}

export interface WaveDef {
  groups: GroupDef[];
  /** 이 웨이브의 요괴 체력 배율 (없으면 data/balance.ts 의 WAVE_HP) */
  hp?: number;
}

export interface StageDef {
  /** '지역-번호' (예: '1-3') */
  id: string;
  region: number;
  no: number;
  name: string;
  routes: RouteDef[];
  /** 배치 칸 */
  slots: Cell[];
  /** 시작 기운 */
  energy: number;
  /** 시작 생명 (없으면 20) */
  lives?: number;
  /** 요괴 체력 배율 */
  hp: number;
  waves: WaveDef[];
  /** 보스 스테이지: 2분(at 초)에 route 길로 보스가 나온다 */
  boss?: { id: string; at?: number; route?: number; hp?: number };
  /** 클리어 보상 엽전 · 첫 클리어 보상 엽전 */
  coins: number;
  firstCoins: number;
}

// ───────────────────────── 1지역: 쥐의 들판 (길 하나, 단순한 굽이 · 꼬마 도깨비, 도깨비불) ─────────────────────────

const REGION_1: StageDef[] = [
  {
    id: '1-1', region: 1, no: 1, name: '들판 어귀', energy: 230, hp: 1.1,
    // ㄹ 모양: 왼쪽 위에서 들어와 오른쪽 아래로 나간다
    routes: [{ id: 'main', pts: [[-1, 1], [7, 1], [7, 5], [1, 5], [1, 9], [9, 9]] }],
    slots: [[2, 2], [5, 2], [6, 3], [8, 3], [3, 4], [5, 6], [2, 7], [0, 7], [4, 8], [7, 8]],
    waves: [
      { groups: [{ enemy: 'imp', count: 8, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'imp', count: 11, at: 1, gap: 2 }] },
      { groups: [{ enemy: 'imp', count: 9, at: 0, gap: 1.8 }, { enemy: 'wisp', count: 6, at: 17, gap: 1.4 }] },
      { groups: [{ enemy: 'imp', count: 14, at: 0, gap: 1.5 }, { enemy: 'wisp', count: 6, at: 21, gap: 1.2 }] },
      { groups: [{ enemy: 'wisp', count: 10, at: 0, gap: 1.1 }, { enemy: 'imp', count: 13, at: 11, gap: 1.3 }] },
      { groups: [{ enemy: 'imp', count: 20, at: 0, gap: 1.1 }, { enemy: 'wisp', count: 9, at: 20, gap: 0.9 }] },
    ],
    coins: 40, firstCoins: 60,
  },
  {
    id: '1-2', region: 1, no: 2, name: '갈지자 둑길', energy: 230, hp: 1.22,
    // 위 가운데에서 들어와 갈지자로 내려가 아래로 나간다
    routes: [{ id: 'main', pts: [[4, -1], [4, 2], [1, 2], [1, 6], [7, 6], [7, 9], [3, 9], [3, 11]] }],
    slots: [[5, 1], [2, 1], [2, 3], [0, 4], [2, 5], [4, 5], [5, 7], [8, 7], [6, 8], [4, 8], [2, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 9, at: 2, gap: 2.2 }] },
      { groups: [{ enemy: 'imp', count: 9, at: 0, gap: 1.9 }, { enemy: 'wisp', count: 5, at: 19, gap: 1.6 }] },
      { groups: [{ enemy: 'wisp', count: 8, at: 0, gap: 1.3 }, { enemy: 'imp', count: 10, at: 11, gap: 1.6 }] },
      { groups: [{ enemy: 'imp', count: 16, at: 0, gap: 1.4 }, { enemy: 'wisp', count: 7, at: 22, gap: 1 }] },
      { groups: [{ enemy: 'imp', count: 12, at: 0, gap: 1.2 }, { enemy: 'wisp', count: 12, at: 15, gap: 1 }] },
      { groups: [{ enemy: 'imp', count: 22, at: 0, gap: 1 }, { enemy: 'wisp', count: 10, at: 21, gap: 0.8 }] },
    ],
    coins: 45, firstCoins: 65,
  },
  {
    id: '1-3', region: 1, no: 3, name: '굽잇길', energy: 240, hp: 1.25,
    // 왼쪽에서 들어와 아래로 돌아 다시 위로, 오른쪽 끝에서 길게 내려간다
    routes: [{ id: 'main', pts: [[-1, 2], [2, 2], [2, 8], [5, 8], [5, 2], [8, 2], [8, 11]] }],
    slots: [[1, 4], [3, 3], [4, 5], [3, 7], [1, 7], [6, 3], [7, 5], [6, 7], [4, 1], [7, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2 }] },
      { groups: [{ enemy: 'imp', count: 9, at: 0, gap: 1.8 }, { enemy: 'wisp', count: 6, at: 19, gap: 1.6 }] },
      { groups: [{ enemy: 'imp', count: 14, at: 0, gap: 1.5 }, { enemy: 'wisp', count: 6, at: 22, gap: 1.1 }] },
      { groups: [{ enemy: 'imp', count: 12, at: 0, gap: 1.3 }, { enemy: 'wisp', count: 10, at: 17, gap: 1.1 }] },
      { groups: [{ enemy: 'imp', count: 20, at: 0, gap: 1.1 }, { enemy: 'wisp', count: 8, at: 22, gap: 0.9 }] },
      { groups: [{ enemy: 'imp', count: 18, at: 0, gap: 0.9 }, { enemy: 'wisp', count: 14, at: 17, gap: 0.8 }] },
    ],
    coins: 50, firstCoins: 70,
  },
  {
    id: '1-4', region: 1, no: 4, name: '뱀길 들판', energy: 240, hp: 1.15,
    // 오른쪽 위에서 들어와 세 번 굽이쳐 오른쪽 아래로 나간다 (길이 길다)
    routes: [{ id: 'main', pts: [[9, 1], [1, 1], [1, 4], [7, 4], [7, 7], [1, 7], [1, 10], [9, 10]] }],
    slots: [[3, 2], [6, 2], [0, 2], [2, 3], [5, 3], [8, 5], [6, 5], [4, 6], [2, 6], [0, 8], [2, 8], [5, 9], [7, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2 }] },
      { groups: [{ enemy: 'imp', count: 10, at: 0, gap: 1.6 }, { enemy: 'wisp', count: 8, at: 17, gap: 1.3 }] },
      { groups: [{ enemy: 'wisp', count: 12, at: 0, gap: 1 }, { enemy: 'imp', count: 12, at: 13, gap: 1.3 }] },
      { groups: [{ enemy: 'imp', count: 20, at: 0, gap: 1.1 }, { enemy: 'wisp', count: 8, at: 22, gap: 0.9 }] },
      { groups: [{ enemy: 'wisp', count: 16, at: 0, gap: 0.8 }, { enemy: 'imp', count: 14, at: 14, gap: 1.1 }] },
      { groups: [{ enemy: 'imp', count: 24, at: 0, gap: 0.85 }, { enemy: 'wisp', count: 12, at: 21, gap: 0.7 }] },
    ],
    coins: 55, firstCoins: 75,
  },
  {
    id: '1-5', region: 1, no: 5, name: '큰 도깨비 고개', energy: 260, hp: 1.2,
    // 위에서 들어와 한 바퀴 감아 아래로 나간다. 2분에 큰 도깨비
    routes: [{ id: 'main', pts: [[4, -1], [4, 1], [7, 1], [7, 5], [1, 5], [1, 8], [6, 8], [6, 11]] }],
    slots: [[3, 0], [5, 0], [5, 2], [6, 3], [8, 3], [4, 4], [2, 4], [0, 6], [2, 6], [4, 6], [3, 7], [5, 7], [7, 7], [5, 9], [7, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2 }] },
      { groups: [{ enemy: 'imp', count: 10, at: 0, gap: 1.6 }, { enemy: 'wisp', count: 8, at: 17, gap: 1.3 }] },
      { groups: [{ enemy: 'wisp', count: 10, at: 0, gap: 1.1 }, { enemy: 'imp', count: 13, at: 12, gap: 1.3 }] },
      { groups: [{ enemy: 'imp', count: 20, at: 0, gap: 1.1 }, { enemy: 'wisp', count: 8, at: 22, gap: 0.9 }] },
      // 2분: 보스가 나오는 웨이브. 졸개는 조금 적게
      { groups: [{ enemy: 'imp', count: 12, at: 4, gap: 1.5 }, { enemy: 'wisp', count: 8, at: 20, gap: 1.1 }] },
      { groups: [{ enemy: 'imp', count: 16, at: 0, gap: 1.2 }, { enemy: 'wisp', count: 10, at: 20, gap: 0.9 }] },
    ],
    boss: { id: 'bigDokkaebi' },
    coins: 70, firstCoins: 120,
  },
];

export const STAGES: StageDef[] = [...REGION_1];

export const STAGE_INDEX: Record<string, number> = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
export const stageOf = (id: string): StageDef | undefined => STAGES[STAGE_INDEX[id]];
/** 그 지역의 스테이지들 (번호 순) */
export const stagesOf = (region: number): StageDef[] => STAGES.filter((s) => s.region === region).sort((a, b) => a.no - b.no);
/** 스테이지의 배경 (지역이 정한다) */
export const stageBg = (s: StageDef): BgId => REGIONS[s.region - 1]?.bg ?? 'field';
/** 다음 스테이지 (같은 지역의 다음 번호, 없으면 다음 지역의 첫 스테이지. 데이터가 없으면 undefined) */
export function nextStage(s: StageDef): StageDef | undefined {
  return stageOf(`${s.region}-${s.no + 1}`) ?? stageOf(`${s.region + 1}-1`);
}
/** 이 스테이지에 나오는 요괴 id 목록 (나오는 순서, 겹치지 않게) */
export function stageEnemies(s: StageDef): string[] {
  const out: string[] = [];
  for (const w of s.waves) for (const g of w.groups) if (!out.includes(g.enemy)) out.push(g.enemy);
  return out;
}
