import type { StageDef } from '../stages';

/**
 * 12지역: 돼지의 염라전 (입구 3곳, 가장 어려움 · 보스 염라대왕).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 12레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_12: StageDef[] = [
  {
    id: '12-1', region: 12, no: 1, name: '염라전 앞뜰', energy: 328, hp: 2.22,
    routes: [
      { id: 'a', pts: [[1, 11], [1, 5], [4, 5], [4, -1]] },
      { id: 'b', pts: [[7, 11], [7, 5], [4, 5], [4, -1]] },
      { id: 'c', pts: [[4, 11], [4, 5], [4, -1]] },
      { id: 'air', air: true, pts: [[9, 11], [4, -1]] },
    ],
    slots: [[3, 0], [3, 1], [5, 1], [3, 3], [5, 3], [3, 4], [6, 4], [0, 6], [3, 6], [5, 6], [5, 7], [8, 7], [2, 9], [5, 9]],
    waves: [
      { hp: 1, groups: [{ enemy: 'club', count: 3, at: 2, gap: 2.4, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'skeleton', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 5, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'spirit', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'spirit', count: 3, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 150, firstCoins: 170,
  },
  {
    id: '12-2', region: 12, no: 2, name: '업경대 길', energy: 328, hp: 1.92,
    routes: [
      { id: 'a', pts: [[-1, 9], [5, 9], [5, 4], [9, 4]] },
      { id: 'b', pts: [[-1, 4], [5, 4], [9, 4]] },
      { id: 'c', pts: [[2, -1], [2, 1], [5, 1], [5, 4], [9, 4]] },
      { id: 'air', air: true, pts: [[-1, 11], [9, 4]] },
    ],
    slots: [[4, 0], [1, 2], [4, 2], [4, 3], [6, 3], [7, 3], [8, 3], [1, 5], [4, 5], [6, 5], [7, 5], [3, 8], [6, 8], [2, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'club', count: 3, at: 2, gap: 2.4, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'spirit', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'skeleton', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'spirit', count: 7, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'skeleton', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'spirit', count: 4, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 4, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'spirit', count: 7, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 4, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 155, firstCoins: 175,
  },
  {
    id: '12-3', region: 12, no: 3, name: '세 갈래 저승문', energy: 328, hp: 2.11,
    routes: [
      { id: 'a', pts: [[-1, 8], [3, 8], [3, 3], [6, 3], [6, -1]] },
      { id: 'b', pts: [[9, 8], [6, 8], [6, 3], [6, -1]] },
      { id: 'c', pts: [[-1, 1], [3, 1], [3, 3], [6, 3], [6, -1]] },
      { id: 'air', air: true, pts: [[-1, 11], [6, -1]] },
    ],
    slots: [[2, 0], [5, 1], [7, 1], [2, 2], [5, 2], [7, 2], [2, 3], [4, 4], [5, 4], [7, 4], [1, 7], [4, 7], [7, 7], [1, 9]],
    waves: [
      { hp: 1, groups: [{ enemy: 'club', count: 3, at: 2, gap: 2.4, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 8, at: 12, gap: 1.9 }] },
      { hp: 1.45, groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 4, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'spirit', count: 5, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 160, firstCoins: 180,
  },
  {
    id: '12-4', region: 12, no: 4, name: '심판의 뜰', energy: 328, hp: 1.86,
    routes: [
      { id: 'a', pts: [[9, 9], [3, 9], [3, 4], [-1, 4]] },
      { id: 'b', pts: [[9, 4], [3, 4], [-1, 4]] },
      { id: 'c', pts: [[6, -1], [6, 1], [3, 1], [3, 4], [-1, 4]] },
      { id: 'air', air: true, pts: [[9, 11], [-1, 4]] },
    ],
    slots: [[4, 0], [4, 2], [7, 2], [1, 3], [2, 3], [4, 3], [1, 5], [2, 5], [4, 5], [7, 5], [2, 8], [4, 8], [7, 8], [7, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'club', count: 3, at: 2, gap: 2.4, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'bamboo', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'spirit', count: 5, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'spirit', count: 7, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'spirit', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 5, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 5, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 6, at: 17, gap: 1.7 }] },
    ],
    coins: 165, firstCoins: 185,
  },
  {
    id: '12-5', region: 12, no: 5, name: '염라대왕전', energy: 330, hp: 1.59,
    routes: [
      { id: 'a', pts: [[0, 11], [0, 6], [4, 6], [4, 2], [9, 2]] },
      { id: 'b', pts: [[4, 11], [4, 6], [4, 2], [9, 2]] },
      { id: 'c', pts: [[8, 11], [8, 6], [4, 6], [4, 2], [9, 2]] },
      { id: 'air', air: true, pts: [[-1, 11], [9, 2]] },
    ],
    slots: [[5, 1], [7, 1], [8, 1], [3, 2], [8, 3], [3, 4], [5, 4], [6, 4], [3, 5], [1, 7], [3, 7], [5, 7], [7, 7], [2, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'club', count: 3, at: 2, gap: 2.4, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'bamboo', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'spirit', count: 7, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 5, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'skeleton', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'skeleton', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'spirit', count: 5, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    boss: { id: 'yeomra', hp: 0.38 },
    coins: 185, firstCoins: 235,
  },
];
