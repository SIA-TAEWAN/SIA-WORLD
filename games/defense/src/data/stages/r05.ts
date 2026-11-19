import type { StageDef } from '../stages';

/**
 * 5지역: 용의 연못 (연못을 빙 도는 길 · 보스 왕지네).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 5레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_05: StageDef[] = [
  {
    id: '5-1', region: 5, no: 1, name: '연못 둘레길', energy: 272, hp: 1.6,
    routes: [
      { id: 'main', pts: [[-1, 1], [7, 1], [7, 9], [1, 9], [1, 3], [-1, 3]] },
      { id: 'air', air: true, pts: [[9, 11], [-1, 3]] },
    ],
    slots: [[2, 0], [5, 0], [1, 2], [5, 2], [8, 2], [2, 4], [8, 4], [0, 5], [2, 7], [6, 7], [8, 7], [2, 10], [5, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 5, at: 0, gap: 2.4 }, { enemy: 'water', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 5, at: 0, gap: 2.4 }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 5, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 7, gap: 2.4 }, { enemy: 'fox', count: 4, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4 }, { enemy: 'fox', count: 7, at: 7, gap: 2.4 }, { enemy: 'water', count: 2, at: 17, gap: 2.4 }] },
    ],
    coins: 80, firstCoins: 100,
  },
  {
    id: '5-2', region: 5, no: 2, name: '연잎 다리', energy: 272, hp: 1.54,
    routes: [
      { id: 'main', pts: [[9, 1], [1, 1], [1, 9], [7, 9], [7, 3], [9, 3]] },
      { id: 'air', air: true, pts: [[-1, 11], [9, 3]] },
    ],
    slots: [[2, 0], [5, 0], [2, 2], [5, 2], [7, 2], [0, 3], [8, 5], [0, 6], [2, 7], [6, 7], [8, 8], [2, 10], [5, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 3, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 4, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 12, at: 12, gap: 1.2 }] },
      { groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 10, at: 7, gap: 2 }, { enemy: 'fox', count: 4, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'water', count: 4, at: 7, gap: 2.4 }, { enemy: 'bamboo', count: 3, at: 17, gap: 2.4 }] },
    ],
    coins: 85, firstCoins: 105,
  },
  {
    id: '5-3', region: 5, no: 3, name: '물안개 둑', energy: 272, hp: 1.42,
    routes: [
      { id: 'main', pts: [[1, -1], [1, 9], [7, 9], [7, 1], [3, 1], [3, -1]] },
      { id: 'air', air: true, pts: [[9, 11], [3, -1]] },
    ],
    slots: [[5, 0], [2, 1], [5, 2], [8, 2], [0, 4], [2, 4], [8, 4], [0, 7], [2, 7], [6, 7], [8, 7], [2, 10], [5, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 4, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4 }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 5, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'imp', count: 9, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 4, at: 7, gap: 2.4 }, { enemy: 'fox', count: 5, at: 17, gap: 2.1 }] },
      { groups: [{ enemy: 'bamboo', count: 7, at: 0, gap: 2.4 }, { enemy: 'imp', count: 7, at: 7, gap: 2.4 }, { enemy: 'fox', count: 5, at: 17, gap: 2.1 }] },
    ],
    coins: 90, firstCoins: 110,
  },
  {
    id: '5-4', region: 5, no: 4, name: '용오름 못', energy: 272, hp: 1.54,
    routes: [
      { id: 'main', pts: [[7, 11], [7, 1], [1, 1], [1, 9], [5, 9], [5, 11]] },
      { id: 'air', air: true, pts: [[-1, -1], [5, 11]] },
    ],
    slots: [[2, 0], [5, 0], [2, 2], [5, 2], [8, 2], [0, 3], [6, 5], [8, 5], [0, 6], [2, 7], [8, 8], [6, 9], [3, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3 }] },
      { groups: [{ enemy: 'bamboo', count: 5, at: 0, gap: 2.4 }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'imp', count: 7, at: 12, gap: 2.2 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 5, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 16, at: 0, gap: 1.7 }, { enemy: 'water', count: 3, at: 7, gap: 2.4 }, { enemy: 'fox', count: 5, at: 17, gap: 2.1 }] },
      { groups: [{ enemy: 'bamboo', count: 7, at: 0, gap: 2.4 }, { enemy: 'water', count: 4, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 9, at: 17, gap: 1.1 }] },
    ],
    coins: 95, firstCoins: 115,
  },
  {
    id: '5-5', region: 5, no: 5, name: '왕지네 연못', energy: 292, hp: 1.59,
    routes: [
      { id: 'main', pts: [[-1, 1], [7, 1], [7, 9], [1, 9], [1, 5], [-1, 5]] },
      { id: 'air', air: true, pts: [[9, 11], [-1, 5]] },
    ],
    slots: [[2, 0], [5, 0], [2, 2], [5, 2], [8, 2], [8, 4], [0, 7], [2, 7], [6, 7], [8, 7], [5, 8], [2, 10], [5, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3 }] },
      { groups: [{ enemy: 'wisp', count: 14, at: 0, gap: 1.9 }, { enemy: 'bamboo', count: 4, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 12, at: 12, gap: 1.2 }] },
      { groups: [{ enemy: 'bamboo', count: 8, at: 0, gap: 2.4 }, { enemy: 'fox', count: 8, at: 12, gap: 1.9 }] },
      { groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 3, at: 7, gap: 2.4 }, { enemy: 'water', count: 2, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 5, at: 7, gap: 2.4 }, { enemy: 'water', count: 3, at: 17, gap: 2.4 }] },
    ],
    boss: { id: 'centipede', hp: 0.89 },
    coins: 115, firstCoins: 165,
  },
];
