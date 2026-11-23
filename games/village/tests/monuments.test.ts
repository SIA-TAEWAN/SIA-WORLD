import { describe, expect, it } from 'vitest';
import { BUILDING } from '../src/data/buildings';
import { GAMES, MONUMENTS, visibleMonuments } from '../src/data/monuments';

describe('기념물 화면: 닫힌 게임의 기념물 감추기', () => {
  const open = { tank: true, volleyball: true, race: true, survival: true, defense: true, matgo: true, casino: true, charge: false, finger: false };
  it('닫힌 게임(돌격대 · 핑거)의 기념물은 빠지고, 합계도 줄어든다', () => {
    const list = visibleMonuments(open, false, []);
    expect(list.some((m) => m.game === 'charge' || m.game === 'finger')).toBe(false);
    expect(list).toHaveLength(MONUMENTS.length - 6);
    expect(list.map((m) => m.id)).toContain('mon_tank1');
  });
  it('관리자는 모두 본다', () => {
    expect(visibleMonuments(open, true, [])).toEqual(MONUMENTS);
  });
  it('오픈 여부를 못 불러왔으면 모두 보인다', () => {
    expect(visibleMonuments(null, false, [])).toEqual(MONUMENTS);
  });
  it('값이 없는 게임은 열린 것으로 본다 (닫혔다고 확인된 것만 감춘다)', () => {
    expect(visibleMonuments({}, false, [])).toEqual(MONUMENTS);
  });
  it('이미 받은 기념물은 게임이 닫혀 있어도 보인다', () => {
    const list = visibleMonuments(open, false, ['mon_charge30']);
    expect(list.filter((m) => m.game === 'charge').map((m) => m.id)).toEqual(['mon_charge30']);
  });
  it('배구처럼 이름이 다른 게임도 SIA WORLD 게임 id 로 본다', () => {
    const list = visibleMonuments({ ...open, volleyball: false }, false, []);
    expect(list.some((m) => m.game === 'volley')).toBe(false);
    expect(GAMES.find((g) => g.id === 'volley')?.world).toBe('volleyball');
  });
  it('설명에 게임 이름이 들어 있다 (끝없는 길 · 끝없는 탑)', () => {
    expect(BUILDING.mon_charge_road.desc).toBe('시아돌격대 끝없는 길 1,000m 기념');
    expect(BUILDING.mon_finger_tower.desc).toBe('시아핑거 끝없는 탑 20층 기념');
  });
});
