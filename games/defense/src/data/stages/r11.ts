import type { StageDef } from '../stages';

/**
 * 11지역: 개의 삼도천 (물길로 나뉜 긴 길 · 보스 강철이).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 11레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_11: StageDef[] = [
  {
    id: '11-1', region: 11, no: 1, name: '삼도천 나루', energy: 320, hp: 2.93,
    routes: [
      { id: 'main', pts: [[-1, 10], [7, 10], [7, 8], [1, 8], [1, 6], [7, 6], [7, 4], [1, 4], [1, 2], [9, 2]] },
    ],
    slots: [[6, 1], [2, 3], [3, 3], [6, 3], [8, 4], [2, 5], [6, 5], [3, 7], [6, 7], [0, 8], [2, 9], [5, 9], [6, 9]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 16, at: 2, gap: 1.5 }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 2, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 3, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'spirit', count: 5, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 3, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 5, at: 12, gap: 2.4 }] },
      { hp: 1.45, groups: [{ enemy: 'spirit', count: 6, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 3, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 7, at: 17, gap: 1.5 }] },
      { hp: 1.62, groups: [{ enemy: 'spirit', count: 6, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 3, at: 7, gap: 2.4 }, { enemy: 'guard', count: 2, at: 17, gap: 2.4 }] },
    ],
    coins: 140, firstCoins: 160,
  },
  {
    id: '11-2', region: 11, no: 2, name: '징검다리', energy: 320, hp: 2.85,
    routes: [
      { id: 'main', pts: [[0, 11], [0, 1], [2, 1], [2, 9], [4, 9], [4, 1], [6, 1], [6, 9], [8, 9], [8, -1]] },
      { id: 'air', air: true, pts: [[-1, 11], [8, -1]] },
    ],
    slots: [[6, 0], [3, 2], [7, 2], [1, 3], [5, 3], [3, 4], [7, 4], [1, 6], [3, 7], [5, 7], [7, 7], [1, 8], [5, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 17, at: 2, gap: 1.5 }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 2, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 3, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'spirit', count: 6, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 3, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'spirit', count: 7, at: 0, gap: 2.4 }, { enemy: 'fox', count: 7, at: 12, gap: 2.2 }] },
      { hp: 1.45, groups: [{ enemy: 'skeleton', count: 4, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 4, at: 7, gap: 2.4 }, { enemy: 'guard', count: 2, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'spirit', count: 7, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 4, at: 7, gap: 2.4 }, { enemy: 'guard', count: 2, at: 17, gap: 2.4 }] },
    ],
    coins: 145, firstCoins: 165,
  },
  {
    id: '11-3', region: 11, no: 3, name: '물안개 강둑', energy: 320, hp: 3.4,
    routes: [
      { id: 'main', pts: [[9, 9], [1, 9], [1, 7], [7, 7], [7, 5], [1, 5], [1, 3], [7, 3], [7, 1], [-1, 1]] },
      { id: 'air', air: true, pts: [[9, 11], [-1, 1]] },
    ],
    slots: [[2, 0], [2, 2], [5, 2], [0, 3], [2, 4], [5, 4], [8, 4], [2, 6], [5, 6], [8, 7], [2, 8], [3, 8], [6, 8]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 17, at: 2, gap: 1.5 }] },
      { hp: 1.1, groups: [{ enemy: 'spirit', count: 5, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 11, at: 12, gap: 1.4 }] },
      { hp: 1.32, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4 }, { enemy: 'fox', count: 8, at: 12, gap: 1.9 }] },
      { hp: 1.45, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 3, at: 7, gap: 2.4 }, { enemy: 'spirit', count: 3, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'spirit', count: 7, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 7, gap: 2.4 }, { enemy: 'skeleton', count: 3, at: 17, gap: 2.4 }] },
    ],
    coins: 150, firstCoins: 170,
  },
  {
    id: '11-4', region: 11, no: 4, name: '망각의 여울', energy: 320, hp: 3.09,
    routes: [
      { id: 'main', pts: [[8, 11], [8, 1], [6, 1], [6, 9], [4, 9], [4, 1], [2, 1], [2, 9], [0, 9], [0, -1]] },
    ],
    slots: [[2, 0], [1, 2], [5, 2], [3, 3], [7, 3], [1, 4], [5, 4], [7, 6], [1, 7], [3, 7], [5, 7], [7, 8], [3, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 18, at: 2, gap: 1.4 }] },
      { hp: 1.1, groups: [{ enemy: 'wisp', count: 13, at: 0, gap: 2.1 }, { enemy: 'skeleton', count: 3, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 3, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 5, at: 12, gap: 2.4 }] },
      { hp: 1.45, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 5, at: 7, gap: 2.4 }, { enemy: 'guard', count: 2, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'guard', count: 4, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 4, at: 7, gap: 2.4 }, { enemy: 'spirit', count: 4, at: 17, gap: 2.4 }] },
    ],
    coins: 155, firstCoins: 175,
  },
  {
    id: '11-5', region: 11, no: 5, name: '강철이 강', energy: 330, hp: 2.15,
    routes: [
      { id: 'main', pts: [[4, 11], [4, 9], [1, 9], [1, 7], [7, 7], [7, 5], [1, 5], [1, 3], [7, 3], [7, 1], [4, 1], [4, -1]] },
      { id: 'air', air: true, pts: [[9, 11], [4, -1]] },
    ],
    slots: [[6, 0], [3, 1], [5, 2], [2, 4], [5, 4], [8, 4], [2, 6], [5, 6], [8, 6], [2, 8], [3, 8], [5, 8], [2, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 19, at: 2, gap: 1.3 }] },
      { hp: 1.1, groups: [{ enemy: 'skeleton', count: 4, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 4, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'skeleton', count: 5, at: 0, gap: 2.4 }, { enemy: 'spirit', count: 5, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'spirit', count: 8, at: 0, gap: 2.4 }, { enemy: 'guard', count: 3, at: 12, gap: 2.4 }] },
      { hp: 1.45, groups: [{ enemy: 'spirit', count: 5, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 3, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 6, at: 17, gap: 1.7 }] },
      { hp: 1.62, groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'skeleton', count: 4, at: 7, gap: 2.4 }, { enemy: 'spirit', count: 4, at: 17, gap: 2.4 }] },
    ],
    boss: { id: 'gangcheori', hp: 0.94 },
    coins: 175, firstCoins: 225,
  },
];
