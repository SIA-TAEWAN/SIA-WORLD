import type { StageDef } from '../stages';

/**
 * 2지역: 소의 논밭 (길이 길고 굽이가 많음 · 보스 두억시니).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 2레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_02: StageDef[] = [
  {
    id: '2-1', region: 2, no: 1, name: '논두렁길', energy: 248, hp: 1.62,
    routes: [
      { id: 'main', pts: [[-1, 0], [7, 0], [7, 2], [1, 2], [1, 4], [7, 4], [7, 6], [1, 6], [1, 8], [9, 8]] },
    ],
    slots: [[2, 1], [5, 1], [8, 1], [0, 2], [2, 3], [5, 3], [8, 3], [2, 5], [5, 5], [8, 6], [2, 7], [3, 7], [6, 7]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 11, at: 0, gap: 2.4 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'imp', count: 8, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 10, at: 12, gap: 1.5 }] },
      { groups: [{ enemy: 'wisp', count: 16, at: 0, gap: 1.7 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 13, at: 12, gap: 1.1 }] },
      { groups: [{ enemy: 'imp', count: 12, at: 0, gap: 2.2 }, { enemy: 'wisp', count: 15, at: 12, gap: 1 }] },
    ],
    coins: 50, firstCoins: 70,
  },
  {
    id: '2-2', region: 2, no: 2, name: '물꼬 굽이', energy: 248, hp: 1.84,
    routes: [
      { id: 'main', pts: [[0, -1], [0, 9], [2, 9], [2, 1], [4, 1], [4, 9], [6, 9], [6, 1], [8, 1], [8, 11]] },
    ],
    slots: [[2, 0], [1, 2], [5, 2], [3, 3], [7, 3], [1, 4], [5, 4], [7, 6], [1, 7], [3, 7], [5, 7], [7, 8], [3, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 12, at: 0, gap: 2.2 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 14, at: 0, gap: 1.9 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 17, at: 0, gap: 1.6 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 19, at: 0, gap: 1.4 }, { enemy: 'imp', count: 8, at: 12, gap: 1.9 }] },
      { groups: [{ enemy: 'wisp', count: 21, at: 0, gap: 1.3 }, { enemy: 'club', count: 3, at: 12, gap: 2.4 }] },
    ],
    coins: 55, firstCoins: 75,
  },
  {
    id: '2-3', region: 2, no: 3, name: '모내기 들', energy: 248, hp: 1.89,
    routes: [
      { id: 'main', pts: [[9, 1], [1, 1], [1, 3], [7, 3], [7, 5], [1, 5], [1, 7], [7, 7], [7, 9], [-1, 9]] },
    ],
    slots: [[6, 0], [2, 2], [3, 2], [6, 2], [8, 3], [2, 4], [6, 4], [3, 6], [6, 6], [0, 7], [2, 8], [5, 8], [6, 8]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 9, at: 12, gap: 1.7 }] },
      { groups: [{ enemy: 'wisp', count: 15, at: 0, gap: 1.8 }, { enemy: 'imp', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 13, at: 12, gap: 1.1 }] },
      { groups: [{ enemy: 'wisp', count: 20, at: 0, gap: 1.3 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 4, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 16, at: 12, gap: 0.9 }] },
    ],
    coins: 60, firstCoins: 80,
  },
  {
    id: '2-4', region: 2, no: 4, name: '허수아비 길', energy: 248, hp: 1.79,
    routes: [
      { id: 'main', pts: [[8, -1], [8, 9], [6, 9], [6, 1], [4, 1], [4, 9], [2, 9], [2, 1], [0, 1], [0, 11]] },
    ],
    slots: [[6, 0], [3, 2], [7, 2], [1, 3], [5, 3], [3, 4], [7, 4], [1, 6], [3, 7], [5, 7], [7, 7], [1, 8], [5, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3 }] },
      { groups: [{ enemy: 'club', count: 2, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 9, at: 12, gap: 1.7 }] },
      { groups: [{ enemy: 'wisp', count: 16, at: 0, gap: 1.7 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'wisp', count: 18, at: 0, gap: 1.5 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'imp', count: 9, at: 12, gap: 1.7 }] },
      { groups: [{ enemy: 'wisp', count: 23, at: 0, gap: 1.1 }, { enemy: 'club', count: 3, at: 12, gap: 2.4 }] },
    ],
    coins: 65, firstCoins: 85,
  },
  {
    id: '2-5', region: 2, no: 5, name: '두억시니 논', energy: 268, hp: 1.46,
    routes: [
      { id: 'main', pts: [[4, -1], [4, 1], [1, 1], [1, 3], [7, 3], [7, 5], [1, 5], [1, 7], [7, 7], [7, 9], [4, 9], [4, 11]] },
    ],
    slots: [[2, 0], [3, 2], [5, 2], [0, 4], [2, 4], [6, 4], [3, 6], [6, 6], [0, 7], [3, 8], [5, 8], [6, 8], [6, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3 }] },
      { groups: [{ enemy: 'wisp', count: 14, at: 0, gap: 1.9 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 12, at: 12, gap: 1.2 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 14, at: 12, gap: 1.1 }] },
      { groups: [{ enemy: 'wisp', count: 15, at: 0, gap: 1.8 }, { enemy: 'club', count: 2, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 4, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 18, at: 12, gap: 0.8 }] },
    ],
    boss: { id: 'dueoksini', hp: 1.04 },
    coins: 85, firstCoins: 135,
  },
];
