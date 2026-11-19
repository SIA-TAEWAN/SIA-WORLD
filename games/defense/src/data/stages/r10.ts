import type { StageDef } from '../stages';

/**
 * 10지역: 닭의 새벽길 (입구 3곳 · 보스 저승사자).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 10레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_10: StageDef[] = [
  {
    id: '10-1', region: 10, no: 1, name: '새벽 갈래길', energy: 312, hp: 2.44,
    routes: [
      { id: 'a', pts: [[1, -1], [1, 5], [4, 5], [4, 11]] },
      { id: 'b', pts: [[7, -1], [7, 5], [4, 5], [4, 11]] },
      { id: 'c', pts: [[4, -1], [4, 5], [4, 11]] },
    ],
    slots: [[2, 1], [5, 1], [8, 2], [6, 3], [0, 4], [3, 4], [5, 4], [3, 6], [5, 6], [6, 6], [3, 7], [3, 9], [5, 9], [3, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'skeleton', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 130, firstCoins: 150,
  },
  {
    id: '10-2', region: 10, no: 2, name: '안개 삼거리', energy: 312, hp: 2.07,
    routes: [
      { id: 'a', pts: [[-1, 1], [5, 1], [5, 6], [9, 6]] },
      { id: 'b', pts: [[-1, 6], [5, 6], [9, 6]] },
      { id: 'c', pts: [[2, 11], [2, 9], [5, 9], [5, 6], [9, 6]] },
    ],
    slots: [[2, 0], [3, 2], [6, 2], [1, 5], [4, 5], [6, 5], [7, 5], [8, 5], [4, 7], [6, 7], [7, 7], [1, 8], [4, 8], [4, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 2, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'imp', count: 6, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'imp', count: 7, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 135, firstCoins: 155,
  },
  {
    id: '10-3', region: 10, no: 3, name: '첫닭 고개', energy: 312, hp: 2.21,
    routes: [
      { id: 'a', pts: [[-1, 2], [3, 2], [3, 7], [6, 7], [6, 11]] },
      { id: 'b', pts: [[9, 2], [6, 2], [6, 7], [6, 11]] },
      { id: 'c', pts: [[-1, 9], [3, 9], [3, 7], [6, 7], [6, 11]] },
    ],
    slots: [[1, 1], [1, 3], [4, 3], [7, 3], [4, 6], [5, 6], [7, 6], [2, 7], [2, 8], [5, 8], [7, 8], [5, 9], [7, 9], [2, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'skeleton', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 140, firstCoins: 160,
  },
  {
    id: '10-4', region: 10, no: 4, name: '여명 나루', energy: 312, hp: 2,
    routes: [
      { id: 'a', pts: [[9, 1], [3, 1], [3, 6], [-1, 6]] },
      { id: 'b', pts: [[9, 6], [3, 6], [-1, 6]] },
      { id: 'c', pts: [[6, 11], [6, 9], [3, 9], [3, 6], [-1, 6]] },
    ],
    slots: [[4, 0], [7, 0], [4, 2], [7, 2], [1, 5], [2, 5], [4, 5], [7, 5], [1, 7], [2, 7], [4, 7], [4, 8], [7, 8], [4, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'imp', count: 7, at: 12, gap: 2.2, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'guard', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'imp', count: 5, at: 17, gap: 2.1, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 4, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 145, firstCoins: 165,
  },
  {
    id: '10-5', region: 10, no: 5, name: '저승사자 길목', energy: 330, hp: 2,
    routes: [
      { id: 'a', pts: [[0, -1], [0, 4], [4, 4], [4, 8], [9, 8]] },
      { id: 'b', pts: [[4, -1], [4, 4], [4, 8], [9, 8]] },
      { id: 'c', pts: [[8, -1], [8, 4], [4, 4], [4, 8], [9, 8]] },
    ],
    slots: [[1, 2], [3, 3], [5, 3], [6, 3], [2, 5], [3, 5], [5, 6], [6, 6], [3, 7], [8, 7], [4, 9], [5, 9], [7, 9], [8, 9]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'skeleton', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'water', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'skeleton', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'skeleton', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 4, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    boss: { id: 'reaper', hp: 0.94 },
    coins: 165, firstCoins: 215,
  },
];
