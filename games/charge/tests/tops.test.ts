import { describe, expect, it } from 'vitest';
import { normalizeTops } from '../src/net/api';

/** 스테이지별 친구 기록 (079 charge_stage_tops) 답 읽기 */
describe('normalizeTops', () => {
  it('빈 값·객체가 아닌 값은 빈 기록', () => {
    for (const v of [null, undefined, '', 0, 7, 'x', true, {}, []]) expect(normalizeTops(v)).toEqual({});
  });

  it('1~3위를 순서대로, 내 기록과 사람 수를 함께', () => {
    const r = normalizeTops({
      '1-1': {
        total: 9,
        top: [
          { place: 2, nickname: '을', troops: 80, me: true },
          { place: 1, nickname: '갑', troops: 120, me: false },
          { place: 3, nickname: '병', troops: 40 },
        ],
        mine: { place: 2, troops: 80 },
      },
    });
    expect(r['1-1'].top).toEqual([
      { place: 1, nickname: '갑', troops: 120, me: false },
      { place: 2, nickname: '을', troops: 80, me: true },
      { place: 3, nickname: '병', troops: 40, me: false },
    ]);
    expect(r['1-1'].total).toBe(9);
    expect(r['1-1'].mine).toEqual({ place: 2, troops: 80 });
  });

  it('내가 3위 밖이면 top 에는 없고 mine 에 그 순위가 남는다', () => {
    const r = normalizeTops({
      '2-3': {
        total: 12,
        top: [
          { place: 1, nickname: '갑', troops: 300, me: false },
          { place: 2, nickname: '을', troops: 200, me: false },
          { place: 3, nickname: '병', troops: 100, me: false },
          { place: 4, nickname: '정', troops: 90, me: true },
        ],
        mine: { place: 7, troops: 77 },
      },
    })['2-3'];
    expect(r.top.map((t) => t.place)).toEqual([1, 2, 3]);
    expect(r.top.some((t) => t.me)).toBe(false);
    expect(r.mine).toEqual({ place: 7, troops: 77 });
  });

  it('기록이 없는 스테이지는 빠진다', () => {
    const r = normalizeTops({
      '1-1': { top: [], total: 0, mine: null },
      '1-2': { total: 3 },
      '1-3': null,
      '1-4': 'x',
      '1-5': { top: 'x', mine: { place: 1, troops: 5 } },
    });
    expect(r).toEqual({});
  });

  it('잘못된 입력은 걸러 내거나 0 으로', () => {
    const r = normalizeTops({
      '3-1': {
        total: 'many',
        top: [
          null,
          'x',
          { place: 0, nickname: '영', troops: 5 },
          { place: 4, nickname: '사', troops: 5 },
          { place: 'a', nickname: '글', troops: 5 },
          { place: 1, troops: -30, me: 'yes' },
          { place: '2', nickname: 42, troops: '15' },
        ],
        mine: { place: 0, troops: 9 },
      },
      '3-2': { top: [{ place: 1, nickname: '갑', troops: 10, me: true }], mine: { place: 1, troops: 'x' } },
    });
    // 순위가 1~3 이 아닌 줄은 버리고, 닉네임은 글자로, 대원 수는 0 이상의 숫자로, me 는 true 일 때만
    expect(r['3-1'].top).toEqual([
      { place: 1, nickname: '', troops: 0, me: false },
      { place: 2, nickname: '42', troops: 15, me: false },
    ]);
    // 사람 수가 이상하면 보이는 줄 수로, 내 순위가 1 미만이면 없음
    expect(r['3-1'].total).toBe(2);
    expect(r['3-1'].mine).toBeNull();
    expect(r['3-2'].mine).toEqual({ place: 1, troops: 0 });
  });
});
