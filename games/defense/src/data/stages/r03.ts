import type { StageDef } from '../stages';

/**
 * 3지역: 호랑이 고개 (길이 짧고 배치 칸이 많음 · 보스 불가살).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 3레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_03: StageDef[] = [
  {
    id: '3-1', region: 3, no: 1, name: '고갯마루', energy: 256, hp: 1.33,
    routes: [
      { id: 'main', pts: [[-1, 3], [4, 3], [4, 7], [9, 7]] },
    ],
    slots: [[0, 2], [2, 2], [4, 2], [5, 2], [0, 4], [2, 4], [5, 4], [3, 5], [5, 5], [6, 6], [8, 6], [3, 7], [3, 8], [5, 8], [7, 8], [8, 8]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4 }, { enemy: 'water', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4 }, { enemy: 'imp', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 14, at: 0, gap: 1.9 }, { enemy: 'club', count: 2, at: 7, gap: 2.4 }, { enemy: 'water', count: 2, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 16, at: 0, gap: 1.7 }, { enemy: 'imp', count: 7, at: 7, gap: 2.4 }, { enemy: 'water', count: 2, at: 17, gap: 2.4 }] },
    ],
    coins: 60, firstCoins: 80,
  },
  {
    id: '3-2', region: 3, no: 2, name: '바위 틈', energy: 256, hp: 1.51,
    routes: [
      { id: 'main', pts: [[4, -1], [4, 4], [7, 4], [7, 11]] },
    ],
    slots: [[3, 0], [5, 0], [3, 2], [5, 2], [6, 2], [8, 3], [3, 4], [5, 5], [6, 5], [8, 5], [8, 6], [6, 7], [6, 8], [8, 8], [6, 10], [8, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 9, at: 12, gap: 1.7 }] },
      { groups: [{ enemy: 'wisp', count: 14, at: 0, gap: 1.9 }, { enemy: 'imp', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 7, at: 17, gap: 1.5 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 8, at: 17, gap: 1.3 }] },
    ],
    coins: 65, firstCoins: 85,
  },
  {
    id: '3-3', region: 3, no: 3, name: '솔밭 지름길', energy: 256, hp: 1.19,
    routes: [
      { id: 'main', pts: [[-1, 8], [3, 8], [3, 3], [9, 3]] },
    ],
    slots: [[4, 2], [5, 2], [7, 2], [8, 2], [2, 3], [2, 4], [4, 4], [5, 4], [7, 4], [1, 6], [4, 6], [1, 7], [2, 7], [4, 7], [1, 9], [3, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 13, at: 12, gap: 1.1 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 8, at: 17, gap: 1.3 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'imp', count: 7, at: 7, gap: 2.4 }, { enemy: 'club', count: 2, at: 17, gap: 2.4 }] },
    ],
    coins: 70, firstCoins: 90,
  },
  {
    id: '3-4', region: 3, no: 4, name: '호랑이 굴 앞', energy: 256, hp: 1.22,
    routes: [
      { id: 'main', pts: [[2, -1], [2, 5], [6, 5], [6, 11]] },
    ],
    slots: [[1, 0], [3, 0], [3, 1], [1, 2], [3, 3], [1, 4], [4, 4], [6, 4], [2, 6], [4, 6], [5, 6], [7, 6], [7, 7], [5, 9], [7, 9], [5, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3 }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 11, at: 12, gap: 1.4 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 13, at: 12, gap: 1.1 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 11, at: 7, gap: 1.8 }, { enemy: 'water', count: 2, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'water', count: 4, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 9, at: 17, gap: 1.1 }] },
    ],
    coins: 75, firstCoins: 95,
  },
  {
    id: '3-5', region: 3, no: 5, name: '불가살 고개', energy: 276, hp: 1.32,
    routes: [
      { id: 'main', pts: [[-1, 2], [5, 2], [5, 8], [9, 8]] },
    ],
    slots: [[0, 1], [2, 1], [4, 1], [6, 1], [1, 3], [3, 3], [4, 3], [6, 3], [6, 4], [4, 6], [6, 6], [7, 6], [7, 7], [4, 8], [6, 9], [8, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3 }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 12, at: 12, gap: 1.2 }] },
      { groups: [{ enemy: 'imp', count: 11, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'imp', count: 7, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 6, at: 17, gap: 1.7 }] },
      { groups: [{ enemy: 'water', count: 6, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 10, at: 17, gap: 1 }] },
    ],
    boss: { id: 'bulgasal', hp: 1.28 },
    coins: 95, firstCoins: 145,
  },
];
