import type { StageDef } from '../stages';

/**
 * 8지역: 양의 뜰 (입구 2곳, 배치 칸이 적음 · 보스 야광귀).
 * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 8레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.
 */
export const REGION_08: StageDef[] = [
  {
    id: '8-1', region: 8, no: 1, name: '앞뜰', energy: 296, hp: 2.64,
    routes: [
      { id: 'a', pts: [[9, 1], [4, 1], [4, 6], [1, 6], [1, 11]] },
      { id: 'b', pts: [[9, 8], [6, 8], [6, 6], [4, 6], [1, 6], [1, 11]] },
      { id: 'air', air: true, pts: [[9, -1], [1, 11]] },
    ],
    slots: [[5, 2], [2, 5], [5, 5], [2, 7], [5, 7], [8, 7], [0, 8], [2, 8], [0, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 16, at: 2, gap: 1.5, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 2, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 5, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'fox', count: 8, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 10, at: 12, gap: 1.5, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 7, at: 12, gap: 2.2 }] },
      { hp: 1.45, groups: [{ enemy: 'fox', count: 8, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 4, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 5, at: 17, gap: 2.1 }] },
    ],
    coins: 110, firstCoins: 130,
  },
  {
    id: '8-2', region: 8, no: 2, name: '돌담 사이', energy: 296, hp: 2.4,
    routes: [
      { id: 'a', pts: [[6, -1], [6, 4], [2, 4], [2, 8], [-1, 8]] },
      { id: 'b', pts: [[-1, 1], [2, 1], [2, 4], [2, 8], [-1, 8]] },
      { id: 'air', air: true, pts: [[9, -1], [-1, 8]] },
    ],
    slots: [[1, 0], [7, 2], [1, 3], [4, 3], [3, 5], [1, 6], [0, 7], [3, 7], [1, 9]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 17, at: 2, gap: 1.5, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 7, at: 12, gap: 2.2 }] },
      { hp: 1.45, groups: [{ enemy: 'bamboo', count: 6, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 4, at: 17, gap: 2.4 }] },
      { hp: 1.62, groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 3, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 115, firstCoins: 135,
  },
  {
    id: '8-3', region: 8, no: 3, name: '연못 뜰', energy: 296, hp: 2.41,
    routes: [
      { id: 'a', pts: [[9, 2], [5, 2], [5, 6], [2, 6], [2, 11]] },
      { id: 'b', pts: [[-1, 3], [2, 3], [2, 6], [2, 11]] },
      { id: 'air', air: true, pts: [[9, -1], [2, 11]] },
    ],
    slots: [[6, 1], [3, 3], [6, 3], [1, 5], [3, 5], [4, 7], [1, 8], [3, 8], [1, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 17, at: 2, gap: 1.5, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'bamboo', count: 5, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 5, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'guard', count: 3, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 3, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'club', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 7, at: 7, gap: 2.4 }, { enemy: 'bamboo', count: 4, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    coins: 120, firstCoins: 140,
  },
  {
    id: '8-4', region: 8, no: 4, name: '뒤뜰 샛길', energy: 296, hp: 2.11,
    routes: [
      { id: 'a', pts: [[7, -1], [7, 5], [4, 5], [4, 9], [-1, 9]] },
      { id: 'b', pts: [[1, -1], [1, 5], [4, 5], [4, 9], [-1, 9]] },
      { id: 'air', air: true, pts: [[9, -1], [-1, 9]] },
    ],
    slots: [[6, 3], [3, 4], [5, 6], [2, 7], [3, 7], [5, 8], [0, 10], [2, 10], [4, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 18, at: 2, gap: 1.4, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 4, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.2, groups: [{ enemy: 'fox', count: 9, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'guard', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 8, at: 12, gap: 1.9 }] },
      { hp: 1.45, groups: [{ enemy: 'fox', count: 10, at: 0, gap: 2.4 }, { enemy: 'guard', count: 2, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 3, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'bamboo', count: 7, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'guard', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 6, at: 17, gap: 1.7 }] },
    ],
    coins: 125, firstCoins: 145,
  },
  {
    id: '8-5', region: 8, no: 5, name: '야광귀의 뜰', energy: 316, hp: 2.3,
    routes: [
      { id: 'a', pts: [[9, 1], [5, 1], [5, 5], [3, 5], [3, 9], [-1, 9]] },
      { id: 'b', pts: [[-1, 1], [1, 1], [1, 5], [3, 5], [3, 9], [-1, 9]] },
      { id: 'air', air: true, pts: [[9, -1], [-1, 9]] },
    ],
    slots: [[6, 2], [0, 3], [3, 4], [4, 6], [1, 7], [2, 7], [4, 7], [0, 10], [2, 10]],
    waves: [
      { hp: 1, groups: [{ enemy: 'wisp', count: 19, at: 2, gap: 1.3, route: 'alt' }] },
      { hp: 1.1, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'fox', count: 6, at: 12, gap: 2.4 }] },
      { hp: 1.2, groups: [{ enemy: 'guard', count: 3, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'bamboo', count: 5, at: 12, gap: 2.4, route: 'alt' }] },
      { hp: 1.32, groups: [{ enemy: 'fox', count: 11, at: 0, gap: 2.4 }, { enemy: 'wisp', count: 14, at: 12, gap: 1.1, route: 'alt' }] },
      { hp: 1.45, groups: [{ enemy: 'fox', count: 7, at: 0, gap: 2.4 }, { enemy: 'bamboo', count: 3, at: 7, gap: 2.4, route: 'alt' }, { enemy: 'club', count: 2, at: 17, gap: 2.4, route: 'alt' }] },
      { hp: 1.62, groups: [{ enemy: 'guard', count: 4, at: 0, gap: 2.4, route: 'alt' }, { enemy: 'wisp', count: 13, at: 7, gap: 1.5, route: 'alt' }, { enemy: 'bamboo', count: 4, at: 17, gap: 2.4, route: 'alt' }] },
    ],
    boss: { id: 'yagwanggwi', hp: 1.28 },
    coins: 145, firstCoins: 195,
  },
];
