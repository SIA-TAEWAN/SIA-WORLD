import type { StageDef } from '../stages';

/**
 * 4지역: 토끼의 달동산 (길이 둘로 갈라졌다 합쳐짐 · 보스 장산범).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 4레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_04: StageDef[] = [
  {
    id: '4-1', region: 4, no: 1, name: '달맞이 갈림길', energy: 264, hp: 1.35,
    routes: [
      { id: 'a', pts: [[4, -1], [4, 2], [1, 2], [1, 7], [4, 7], [4, 11]] },
      { id: 'b', pts: [[4, -1], [4, 2], [7, 2], [7, 7], [4, 7], [4, 11]] },
      { id: 'air', air: true, pts: [[9, -1], [4, 11]] },
    ],
    slots: [[3, 0], [3, 1], [6, 1], [0, 3], [3, 3], [6, 4], [0, 6], [3, 6], [6, 6], [3, 8], [5, 8], [6, 8], [3, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 5, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 16, at: 0, gap: 1.7, route: 'alt' }, { enemy: 'fox', count: 7, at: 12, gap: 2.2 }] },
      { groups: [{ enemy: 'wisp', count: 14, at: 0, gap: 1.9, route: 'alt' }, { enemy: 'fox', count: 6, at: 7, gap: 2.4 }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 11, at: 7, gap: 1.8, route: 'alt' }, { enemy: 'water', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 70, firstCoins: 90,
  },
  {
    id: '4-2', region: 4, no: 2, name: '계수나무 길', energy: 264, hp: 1.02,
    routes: [
      { id: 'a', pts: [[-1, 5], [2, 5], [2, 2], [6, 2], [6, 5], [9, 5]] },
      { id: 'b', pts: [[-1, 5], [2, 5], [2, 8], [6, 8], [6, 5], [9, 5]] },
      { id: 'air', air: true, pts: [[-1, 11], [9, 5]] },
    ],
    slots: [[4, 1], [1, 3], [4, 3], [7, 3], [1, 4], [7, 4], [4, 5], [1, 6], [7, 6], [1, 7], [4, 7], [7, 7], [4, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 5, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 12, at: 12, gap: 1.2, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'wisp', count: 7, at: 17, gap: 1.5, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 12, at: 7, gap: 1.7, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 75, firstCoins: 95,
  },
  {
    id: '4-3', region: 4, no: 3, name: '방아 언덕', energy: 264, hp: 1.16,
    routes: [
      { id: 'a', pts: [[4, -1], [4, 1], [1, 1], [1, 5], [4, 5], [4, 8], [7, 8], [7, 11]] },
      { id: 'b', pts: [[4, -1], [4, 1], [7, 1], [7, 5], [4, 5], [4, 8], [7, 8], [7, 11]] },
      { id: 'air', air: true, pts: [[-1, -1], [7, 11]] },
    ],
    slots: [[2, 0], [6, 0], [3, 2], [0, 3], [6, 3], [3, 4], [3, 6], [6, 6], [3, 7], [6, 7], [5, 9], [6, 9], [8, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'imp', count: 6, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 8, at: 12, gap: 1.9 }] },
      { groups: [{ enemy: 'imp', count: 9, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 7, at: 7, gap: 2.4 }, { enemy: 'water', count: 3, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 80, firstCoins: 100,
  },
  {
    id: '4-4', region: 4, no: 4, name: '달그림자 숲', energy: 264, hp: 1.39,
    routes: [
      { id: 'a', pts: [[-1, 1], [2, 1], [2, 4], [6, 4], [6, 9], [9, 9]] },
      { id: 'b', pts: [[-1, 1], [2, 1], [2, 9], [6, 9], [9, 9]] },
      { id: 'air', air: true, pts: [[-1, -1], [9, 9]] },
    ],
    slots: [[1, 0], [1, 2], [3, 2], [1, 3], [4, 3], [1, 5], [4, 5], [7, 7], [1, 8], [4, 8], [7, 8], [5, 10], [7, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3, route: 'alt' }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 16, at: 0, gap: 1.7, route: 'alt' }, { enemy: 'water', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 8, at: 12, gap: 1.9 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 7, at: 7, gap: 2.4 }, { enemy: 'imp', count: 5, at: 17, gap: 2.1, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 85, firstCoins: 105,
  },
  {
    id: '4-5', region: 4, no: 5, name: '장산범 동산', energy: 284, hp: 1.37,
    routes: [
      { id: 'a', pts: [[4, -1], [4, 2], [1, 2], [1, 6], [4, 6], [4, 9], [9, 9]] },
      { id: 'b', pts: [[4, -1], [4, 2], [7, 2], [7, 6], [4, 6], [4, 9], [9, 9]] },
      { id: 'air', air: true, pts: [[-1, -1], [9, 9]] },
    ],
    slots: [[2, 1], [3, 1], [5, 1], [6, 1], [2, 4], [6, 4], [3, 5], [3, 7], [6, 7], [3, 8], [6, 8], [5, 10], [7, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 8, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'water', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'imp', count: 11, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 8, at: 12, gap: 1.9 }] },
      { groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'imp', count: 8, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    boss: { id: 'jangsanbeom', hp: 0.55 },
    coins: 105, firstCoins: 155,
  },
];
