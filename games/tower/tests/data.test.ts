import { describe, expect, it } from 'vitest';
import { ENEMIES, FLOORS, INNER_H, INNER_W, ITEMS, LAST_READY, ORBS, ROOMS, enemyDef, expNeed, floorRule, priceOf, statsAt, zoneData } from '../src/data';

describe('데이터 (JSON)', () => {
  it('구슬 16개, 쥐·소만 구현, 획득 층은 PRD 대로', () => {
    expect(ORBS).toHaveLength(16);
    expect(ORBS.filter((o) => o.implemented).map((o) => o.id)).toEqual(['rat', 'ox']);
    const floors = Object.fromEntries(ORBS.map((o) => [o.id, o.floor]));
    expect(floors).toMatchObject({ rat: 2, ox: 7, dragon: 12, snake: 17, rabbit: 22, monkey: 27, turtle: 30, rooster: 32, sheep: 37, dog: 42, tiger: 47, phoenix: 50, horse: 52, pig: 57, whiteTiger: 70, blueDragon: 90 });
    expect(ORBS.filter((o) => o.legend).map((o) => o.id).sort()).toEqual(['blueDragon', 'phoenix', 'turtle', 'whiteTiger']);
    for (const o of ORBS) expect(o.basic.name && o.awaken.name && o.limit).toBeTruthy();
  });

  it('구역 10층 구성: 1~4 일반, 5 휴식, 6~8 일반, 9 정예, 10 보스 — 100층까지 되풀이', () => {
    const kinds = Array.from({ length: 10 }, (_, i) => floorRule(i + 1).kind);
    expect(kinds).toEqual(['normal', 'normal', 'normal', 'normal', 'rest', 'normal', 'normal', 'normal', 'elite', 'boss']);
    expect(floorRule(25).kind).toBe('rest');
    expect(floorRule(100).kind).toBe('boss');
    expect(FLOORS.zones).toHaveLength(10);
    expect(zoneData(95)?.zone).toBe(10);
    expect(LAST_READY).toBe(10);
  });

  it('1구역 적·정예·보스가 적 데이터에 있다 (독·둔화를 거는 적도)', () => {
    const z = zoneData(1)!;
    for (const id of [...z.enemies, z.elite, z.boss]) expect(enemyDef(id).id).toBe(id);
    expect(ENEMIES.some((e) => e.status?.kind === 'poison') && ENEMIES.some((e) => e.status?.kind === 'slow')).toBe(true);
    expect(enemyDef('golem').level).toBe(10);
  });

  it('방 템플릿: 15×11, 네 문 앞이 비어 있고 문·시작·계단이 걸어서 이어진다', () => {
    const open = (c: string) => '.,ePESB'.includes(c);
    for (const r of ROOMS.rooms) {
      expect(r.grid).toHaveLength(INNER_H);
      for (const row of r.grid) expect(row).toHaveLength(INNER_W);
      const doors = [
        [6, 0], [7, 0], [8, 0], [6, INNER_H - 1], [7, INNER_H - 1], [8, INNER_H - 1],
        [0, 4], [0, 5], [0, 6], [INNER_W - 1, 4], [INNER_W - 1, 5], [INNER_W - 1, 6],
      ];
      for (const [x, y] of doors) expect(open(r.grid[y][x]), `${r.id} ${x},${y}`).toBe(true);
      const seen = new Set<string>(['7,0']);
      const q = [[7, 0]];
      while (q.length) {
        const [x, y] = q.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= INNER_W || ny >= INNER_H || seen.has(`${nx},${ny}`) || !open(r.grid[ny][nx])) continue;
          seen.add(`${nx},${ny}`);
          q.push([nx, ny]);
        }
      }
      for (const [x, y] of doors) expect(seen.has(`${x},${y}`), `${r.id} 문 ${x},${y}`).toBe(true);
      for (let y = 0; y < INNER_H; y++) for (let x = 0; x < INNER_W; x++) if ('PS'.includes(r.grid[y][x])) expect(seen.has(`${x},${y}`), `${r.id} ${r.grid[y][x]}`).toBe(true);
    }
  });

  it('능력치: 1레벨 100/10/5/50, 레벨당 +25/+3/+2/+2, 최대 99', () => {
    expect(statsAt(1)).toEqual({ hp: 100, atk: 10, def: 5, mp: 50 });
    expect(statsAt(10)).toEqual({ hp: 325, atk: 37, def: 23, mp: 68 });
    expect(statsAt(150)).toEqual(statsAt(99));
    for (let l = 1; l < 99; l++) expect(expNeed(l + 1)).toBeGreaterThan(expNeed(l));
  });

  it('상점 값: PRD 표 그대로, 구역마다 ×1.5', () => {
    expect(Object.fromEntries(ITEMS.map((i) => [i.id, i.price]))).toEqual({ potionS: 20, potionL: 60, mana: 40, cleanse: 30, map: 50, shard: 300, revive: 500 });
    expect(priceOf('potionL', 5)).toBe(60);
    expect(priceOf('potionL', 15)).toBe(90);
    expect(priceOf('shard', 25)).toBe(675);
  });
});
