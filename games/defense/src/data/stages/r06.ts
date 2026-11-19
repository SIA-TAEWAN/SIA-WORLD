import type { StageDef } from '../stages';

/**
 * 6지역: 뱀의 늪 (구불구불한 길, 배치 칸이 띄엄띄엄 · 보스 구미호).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 6레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_06: StageDef[] = [
  {
    id: '6-1', region: 6, no: 1, name: '늪 어귀', energy: 280, hp: 2.14,
    routes: [
      { id: 'main', pts: [[-1, 1], [3, 1], [3, 4], [6, 4], [6, 1], [8, 1], [8, 7], [4, 7], [4, 9], [-1, 9]] },
      { id: 'air', air: true, pts: [[9, -1], [-1, 9]] },
    ],
    slots: [[1, 2], [4, 2], [7, 2], [7, 3], [4, 5], [7, 5], [6, 6], [2, 8], [5, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 5, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 8, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4 }, { enemy: 'imp', count: 7, at: 12, gap: 2.2 }] },
      { groups: [{ enemy: 'fox', count: 8, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 7, gap: 2.4 }, { enemy: 'bamboo', count: 3, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 7, gap: 2.4 }, { enemy: 'club', count: 2, at: 17, gap: 2.4 }] },
    ],
    coins: 90, firstCoins: 110,
  },
  {
    id: '6-2', region: 6, no: 2, name: '갈대 미로', energy: 280, hp: 1.96,
    routes: [
      { id: 'main', pts: [[1, -1], [1, 3], [4, 3], [4, 1], [7, 1], [7, 5], [2, 5], [2, 8], [6, 8], [6, 11]] },
      { id: 'air', air: true, pts: [[-1, -1], [6, 11]] },
    ],
    slots: [[5, 0], [2, 2], [5, 3], [6, 3], [2, 4], [4, 6], [6, 6], [1, 7], [4, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 3, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 10, at: 12, gap: 1.5 }] },
      { groups: [{ enemy: 'bamboo', count: 7, at: 0, gap: 2.4 }, { enemy: 'fox', count: 7, at: 12, gap: 2.2 }] },
      { groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 7, gap: 2.4 }, { enemy: 'fox', count: 4, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 16, at: 0, gap: 1.7 }, { enemy: 'bamboo', count: 5, at: 7, gap: 2.4 }, { enemy: 'water', count: 3, at: 17, gap: 2.4 }] },
    ],
    coins: 95, firstCoins: 115,
  },
  {
    id: '6-3', region: 6, no: 3, name: '진흙 굽이', energy: 280, hp: 1.91,
    routes: [
      { id: 'main', pts: [[9, 1], [6, 1], [6, 4], [2, 4], [2, 1], [0, 1], [0, 7], [4, 7], [4, 9], [9, 9]] },
      { id: 'air', air: true, pts: [[-1, -1], [9, 9]] },
    ],
    slots: [[1, 2], [1, 3], [4, 3], [7, 3], [1, 5], [4, 5], [2, 6], [2, 8], [5, 8]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 5, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 4, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'bamboo', count: 7, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 8, at: 17, gap: 1.3 }] },
      { groups: [{ enemy: 'bamboo', count: 7, at: 0, gap: 2.4 }, { enemy: 'fox', count: 7, at: 7, gap: 2.4 }, { enemy: 'water', count: 3, at: 17, gap: 2.4 }] },
    ],
    coins: 100, firstCoins: 120,
  },
  {
    id: '6-4', region: 6, no: 4, name: '안개 늪', energy: 280, hp: 1.65,
    routes: [
      { id: 'main', pts: [[-1, 9], [2, 9], [2, 6], [5, 6], [5, 9], [8, 9], [8, 3], [4, 3], [4, 1], [-1, 1]] },
      { id: 'air', air: true, pts: [[9, 11], [-1, 1]] },
    ],
    slots: [[5, 1], [2, 2], [4, 4], [6, 4], [1, 7], [6, 7], [7, 7], [3, 8], [6, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3 }] },
      { groups: [{ enemy: 'wisp', count: 13, at: 0, gap: 2.1 }, { enemy: 'water', count: 3, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 5, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 7, gap: 2.4 }, { enemy: 'fox', count: 5, at: 17, gap: 2.1 }] },
      { groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 5, at: 7, gap: 2.4 }, { enemy: 'water', count: 3, at: 17, gap: 2.4 }] },
    ],
    coins: 105, firstCoins: 125,
  },
  {
    id: '6-5', region: 6, no: 5, name: '구미호 늪', energy: 300, hp: 1.61,
    routes: [
      { id: 'a', pts: [[1, -1], [1, 4], [4, 4], [4, 8], [1, 8], [1, 11]] },
      { id: 'b', pts: [[7, -1], [7, 4], [4, 4], [4, 8], [7, 8], [7, 11]] },
      { id: 'air', air: true, pts: [[9, -1], [1, 11]] },
    ],
    slots: [[0, 2], [3, 3], [5, 3], [2, 6], [3, 6], [5, 6], [6, 6], [3, 9], [5, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3, route: 'alt' }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'wisp', count: 10, at: 12, gap: 1.5, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'water', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 5, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'wisp', count: 12, at: 0, gap: 2.2, route: 'alt' }, { enemy: 'bamboo', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 4, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'water', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'wisp', count: 13, at: 7, gap: 1.5, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    boss: { id: 'gumiho', hp: 1.11 },
    coins: 125, firstCoins: 175,
  },
];
