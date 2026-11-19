import type { StageDef } from '../stages';

/**
 * 7지역: 말의 성문 (입구 2곳 · 보스 수문장 대장).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 7레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_07: StageDef[] = [
  {
    id: '7-1', region: 7, no: 1, name: '성문 밖', energy: 288, hp: 1.43,
    routes: [
      { id: 'a', pts: [[-1, 1], [4, 1], [4, 6], [7, 6], [7, 11]] },
      { id: 'b', pts: [[-1, 8], [2, 8], [2, 6], [4, 6], [7, 6], [7, 11]] },
      { id: 'air', air: true, pts: [[-1, -1], [7, 11]] },
    ],
    slots: [[2, 0], [2, 2], [5, 2], [3, 5], [5, 5], [6, 5], [0, 7], [3, 7], [5, 7], [8, 7], [6, 8], [8, 9], [6, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 4, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 100, firstCoins: 120,
  },
  {
    id: '7-2', region: 7, no: 2, name: '해자 다리', energy: 288, hp: 1.48,
    routes: [
      { id: 'a', pts: [[2, -1], [2, 4], [6, 4], [6, 8], [9, 8]] },
      { id: 'b', pts: [[9, 1], [6, 1], [6, 4], [6, 8], [9, 8]] },
      { id: 'air', air: true, pts: [[-1, -1], [9, 8]] },
    ],
    slots: [[7, 0], [1, 2], [4, 2], [4, 3], [7, 3], [7, 4], [4, 5], [5, 5], [7, 6], [5, 7], [8, 7], [5, 9], [7, 9]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'water', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 4, at: 17, gap: 2.4 }] },
      { groups: [{ enemy: 'imp', count: 10, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 105, firstCoins: 125,
  },
  {
    id: '7-3', region: 7, no: 3, name: '망루 아래', energy: 288, hp: 1.27,
    routes: [
      { id: 'a', pts: [[-1, 2], [3, 2], [3, 6], [6, 6], [6, 11]] },
      { id: 'b', pts: [[9, 3], [6, 3], [6, 6], [6, 11]] },
      { id: 'air', air: true, pts: [[-1, -1], [6, 11]] },
    ],
    slots: [[7, 2], [1, 3], [2, 3], [4, 3], [5, 5], [7, 5], [2, 6], [4, 7], [7, 7], [5, 8], [7, 8], [5, 10], [7, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 10, at: 2, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 8, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'guard', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'water', count: 4, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 110, firstCoins: 130,
  },
  {
    id: '7-4', region: 7, no: 4, name: '쌍문 거리', energy: 288, hp: 1.79,
    routes: [
      { id: 'a', pts: [[1, -1], [1, 5], [4, 5], [4, 9], [9, 9]] },
      { id: 'b', pts: [[7, -1], [7, 5], [4, 5], [4, 9], [9, 9]] },
      { id: 'air', air: true, pts: [[-1, -1], [9, 9]] },
    ],
    slots: [[6, 1], [0, 2], [0, 4], [3, 4], [6, 4], [8, 4], [3, 6], [5, 7], [6, 7], [3, 8], [8, 8], [5, 10], [7, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3, route: 'alt' }] },
      { groups: [{ enemy: 'imp', count: 8, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'imp', count: 7, at: 12, gap: 2.2, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 5, at: 17, gap: 2.1 }] },
      { groups: [{ enemy: 'guard', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 8, at: 7, gap: 2.4 }, { enemy: 'water', count: 3, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 115, firstCoins: 135,
  },
  {
    id: '7-5', region: 7, no: 5, name: '수문장 대장의 문', energy: 308, hp: 1.43,
    routes: [
      { id: 'a', pts: [[-1, 1], [3, 1], [3, 5], [5, 5], [5, 9], [9, 9]] },
      { id: 'b', pts: [[9, 1], [7, 1], [7, 5], [5, 5], [5, 9], [9, 9]] },
      { id: 'air', air: true, pts: [[-1, -1], [9, 9]] },
    ],
    slots: [[2, 0], [2, 2], [2, 3], [5, 3], [8, 3], [5, 4], [4, 6], [4, 7], [6, 7], [7, 7], [4, 9], [6, 10], [8, 10]],
    waves: [
      { groups: [{ enemy: 'imp', count: 11, at: 2, gap: 2.3, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'water', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'guard', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'water', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { groups: [{ enemy: 'guard', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 8, at: 7, gap: 2.4 }, { enemy: 'imp', count: 6, at: 17, gap: 1.7, route: 'alt' }] },
    ],
    boss: { id: 'guardCaptain', hp: 1.24 },
    coins: 135, firstCoins: 185,
  },
];
