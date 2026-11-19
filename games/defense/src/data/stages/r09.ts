import type { StageDef } from '../stages';

/**
 * 9지역: 원숭이의 누각 (길이 여러 번 교차 · 보스 이무기).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 9레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_09: StageDef[] = [
  {
    id: '9-1', region: 9, no: 1, name: '누각 계단', energy: 304, hp: 3.59,
    routes: [
      { id: 'main', pts: [[-1, 4], [6, 4], [6, 8], [3, 8], [3, 1], [9, 1]] },
      { id: 'air', air: true, pts: [[-1, 11], [9, 1]] },
    ],
    slots: [[4, 0], [7, 0], [4, 2], [6, 2], [1, 3], [2, 3], [4, 3], [7, 5], [2, 6], [4, 6], [5, 6], [7, 7], [4, 9]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { hp: 1.1, groups: [{ enemy: 'wisp', count: 11, at: 0, gap: 2.4 }, { enemy: 'fox', count: 5, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'fox', count: 8, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 11, at: 12, gap: 1.4 }] },
      { hp: 1.45, groups: [{ enemy: 'fox', count: 8, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 10, at: 7, gap: 2 }, { enemy: 'guard', count: 2, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4 }, { enemy: 'fox', count: 7, at: 7, gap: 2.4 }, { enemy: 'imp', count: 5, at: 17, gap: 2.1 }] },
    ],
    coins: 120, firstCoins: 140,
  },
  {
    id: '9-2', region: 9, no: 2, name: '회랑 네거리', energy: 304, hp: 3.43,
    routes: [
      { id: 'main', pts: [[4, -1], [4, 7], [1, 7], [1, 3], [7, 3], [7, 11]] },
      { id: 'air', air: true, pts: [[-1, -1], [7, 11]] },
    ],
    slots: [[5, 1], [2, 2], [3, 2], [5, 2], [0, 4], [5, 4], [8, 4], [2, 5], [3, 5], [5, 5], [6, 7], [8, 7], [2, 8]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { hp: 1.1, groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4 }] },
      { hp: 1.45, groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 10, at: 7, gap: 2 }, { enemy: 'guard', count: 2, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4 }, { enemy: 'fox', count: 7, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 8, at: 17, gap: 1.3 }] },
    ],
    coins: 125, firstCoins: 145,
  },
  {
    id: '9-3', region: 9, no: 3, name: '달빛 난간', energy: 304, hp: 3.09,
    routes: [
      { id: 'main', pts: [[-1, 6], [6, 6], [6, 2], [2, 2], [2, 9], [9, 9]] },
      { id: 'air', air: true, pts: [[-1, -1], [9, 9]] },
    ],
    slots: [[3, 1], [4, 3], [7, 3], [1, 4], [4, 4], [1, 5], [7, 5], [1, 7], [3, 7], [4, 7], [6, 7], [3, 10], [6, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4 }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4 }, { enemy: 'fox', count: 5, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'guard', count: 3, at: 12, gap: 2.4 }] },
      { hp: 1.45, groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 7, gap: 2.4 }, { enemy: 'bamboo', count: 3, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4 }, { enemy: 'fox', count: 7, at: 7, gap: 2.4 }, { enemy: 'bamboo', count: 4, at: 17, gap: 2.4 }] },
    ],
    coins: 130, firstCoins: 150,
  },
  {
    id: '9-4', region: 9, no: 4, name: '겹처마 길', energy: 304, hp: 3.33,
    routes: [
      { id: 'main', pts: [[9, 5], [2, 5], [2, 1], [5, 1], [5, 8], [-1, 8]] },
      { id: 'air', air: true, pts: [[9, -1], [-1, 8]] },
    ],
    slots: [[3, 0], [5, 0], [1, 3], [3, 3], [4, 3], [6, 3], [2, 6], [3, 6], [4, 6], [6, 6], [7, 6], [2, 9], [4, 9]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3 }] },
      { hp: 1.1, groups: [{ enemy: 'fox', count: 8, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4 }, { enemy: 'fox', count: 7, at: 12, gap: 2.2 }] },
      { hp: 1.32, groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 5, at: 12, gap: 2.4 }] },
      { hp: 1.45, groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 11, at: 7, gap: 1.8 }, { enemy: 'guard', count: 2, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'guard', count: 3, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 9, at: 17, gap: 1.1 }] },
    ],
    coins: 135, firstCoins: 155,
  },
  {
    id: '9-5', region: 9, no: 5, name: '이무기 누각', energy: 324, hp: 3.55,
    routes: [
      { id: 'main', pts: [[-1, 3], [6, 3], [6, 7], [3, 7], [3, 1], [8, 1], [8, 11]] },
      { id: 'air', air: true, pts: [[-1, -1], [8, 11]] },
    ],
    slots: [[1, 2], [2, 2], [4, 2], [5, 2], [7, 2], [7, 3], [2, 5], [4, 5], [5, 5], [7, 5], [7, 6], [4, 8], [7, 8]],
    waves: [
      { hp: 1, groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3 }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4 }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4 }] },
      { hp: 1.32, groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 5, at: 12, gap: 2.4 }] },
      { hp: 1.45, groups: [{ enemy: 'wisp', count: 12, at: 0, gap: 2.2 }, { enemy: 'fox', count: 5, at: 7, gap: 2.4 }, { enemy: 'guard', count: 2, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'guard', count: 4, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 5, at: 7, gap: 2.4 }, { enemy: 'wisp', count: 10, at: 17, gap: 1 }] },
    ],
    boss: { id: 'imugi', hp: 1.54 },
    coins: 155, firstCoins: 205,
  },
];
