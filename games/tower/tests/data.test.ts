import { describe, expect, it } from 'vitest';
import { ENEMIES, FLOORS, INNER_H, INNER_W, ITEMS, LAST_READY, ORBS, ROOMS, enemyDef, expNeed, fitGrid, floorRule, orbAtFloor, priceOf, statsAt, zoneData } from '../src/data';
import { TILE_ORDER } from '../src/art/sheets';

describe('데이터 (JSON)', () => {
  it('구슬 16개 모두 구현, 획득 층은 PRD 대로, 스킬 값(혼력·재사용)이 있다', () => {
    expect(ORBS).toHaveLength(16);
    expect(ORBS.every((o) => o.implemented)).toBe(true);
    const floors = Object.fromEntries(ORBS.map((o) => [o.id, o.floor]));
    expect(floors).toMatchObject({ rat: 2, ox: 7, dragon: 12, snake: 17, rabbit: 22, monkey: 27, turtle: 30, rooster: 32, sheep: 37, dog: 42, tiger: 47, phoenix: 50, horse: 52, pig: 57, whiteTiger: 70, blueDragon: 90 });
    expect(ORBS.filter((o) => o.legend).map((o) => o.id).sort()).toEqual(['blueDragon', 'phoenix', 'turtle', 'whiteTiger']);
    for (const o of ORBS) {
      expect(o.basic.name && o.awaken.name && o.limit).toBeTruthy();
      expect(o.basic.mp).toBeGreaterThan(0);
      expect(o.awaken.cd).toBeGreaterThan(o.basic.cd);
    }
    expect(orbAtFloor(12)?.id).toBe('dragon');
    expect(orbAtFloor(17)?.id).toBe('snake');
  });

  it('구역 10층 구성: 1~4 일반, 5 휴식, 6~8 일반, 9 정예, 10 보스 — 100층까지 되풀이', () => {
    const kinds = Array.from({ length: 10 }, (_, i) => floorRule(i + 1).kind);
    expect(kinds).toEqual(['normal', 'normal', 'normal', 'normal', 'rest', 'normal', 'normal', 'normal', 'elite', 'boss']);
    expect(floorRule(25).kind).toBe('rest');
    expect(floorRule(100).kind).toBe('boss');
    expect(FLOORS.zones).toHaveLength(10);
    expect(zoneData(95)?.zone).toBe(10);
    expect(LAST_READY).toBe(20);
    for (const r of FLOORS.pattern) if (r.kind === 'normal' || r.kind === 'elite') expect(r.combat[0] * r.waves[0]).toBeGreaterThanOrEqual(6);
  });

  it('1·2구역 적·정예·보스가 적 데이터에 있다 (2구역 일반 4 · 정예 1 · 보스 1, 기준 레벨 11~20)', () => {
    for (const zone of [1, 2]) {
      const z = zoneData(zone * 10)!;
      expect(z.ready).toBe(true);
      expect(z.enemies).toHaveLength(4);
      for (const id of [...z.enemies, z.elite, z.boss]) expect(enemyDef(id).id).toBe(id);
    }
    const z2 = zoneData(15)!;
    expect(z2.theme).toBe('moss');
    for (const id of z2.enemies) expect(enemyDef(id).minFloor).toBeGreaterThanOrEqual(11);
    expect(enemyDef(z2.elite).elite).toBe(true);
    expect(enemyDef(z2.boss)).toMatchObject({ boss: true, level: 20, size: 32 });
    expect(ENEMIES.some((e) => e.status?.kind === 'poison') && ENEMIES.some((e) => e.status?.kind === 'slow')).toBe(true);
    expect(enemyDef('golem').level).toBe(10);
    // 그림 규격: 일반 16 · 정예 24 · 보스 32
    for (const e of ENEMIES) expect(e.size).toBe(e.boss ? 32 : e.elite ? 24 : 16);
  });

  it('방 템플릿: 19×13 (예전 15×11 은 가운데에 채운다), 네 문 앞이 비어 있고 문·시작·계단이 걸어서 이어진다', () => {
    const open = (c: string) => '.,ePESBq'.includes(c);
    const mx = Math.floor(INNER_W / 2);
    const my = Math.floor(INNER_H / 2);
    for (const r of ROOMS.rooms) {
      expect(r.grid).toHaveLength(INNER_H);
      for (const row of r.grid) expect(row).toHaveLength(INNER_W);
      const doors = [-1, 0, 1].flatMap((d) => [[mx + d, 0], [mx + d, INNER_H - 1], [0, my + d], [INNER_W - 1, my + d]]);
      for (const [x, y] of doors) expect(open(r.grid[y][x]), `${r.id} ${x},${y}`).toBe(true);
      const seen = new Set<string>([`${mx},0`]);
      const q = [[mx, 0]];
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
      for (let y = 0; y < INNER_H; y++) for (let x = 0; x < INNER_W; x++) if ('PSq'.includes(r.grid[y][x])) expect(seen.has(`${x},${y}`), `${r.id} ${r.grid[y][x]}`).toBe(true);
    }
    // 채우기: 가운데에 놓고, 기둥으로 채우면 문 앞 가운데만 틔운다
    const g = fitGrid(['...', '.C.', '...'], '#');
    expect(g[my].slice(mx - 1, mx + 2)).toBe('.C.');
    expect(g[0][0]).toBe('#');
    expect(g[0][mx]).toBe('.');
  });

  it('퍼즐방: 2구역은 용(화로)·뱀(말뚝) 퍼즐, 어느 층이든 발판 퍼즐', () => {
    const p = ROOMS.rooms.filter((r) => r.kind === 'puzzle');
    expect(p.some((r) => r.needs === 'dragon' && r.grid.join('').includes('h'))).toBe(true);
    expect(p.some((r) => r.needs === 'snake' && r.grid.join('').includes('p'))).toBe(true);
    expect(p.some((r) => !r.needs && r.minFloor === 1 && r.grid.join('').includes('q'))).toBe(true);
    // 화로·말뚝 퍼즐은 그 구슬을 받은 뒤 층에만
    for (const r of p) if (r.needs === 'dragon') expect(r.minFloor).toBeGreaterThan(12);
    for (const r of p) if (r.needs === 'snake') expect(r.minFloor).toBeGreaterThan(17);
  });

  it('타일 순서: 처음 22칸은 1구역 시트 그대로, 새 칸은 뒤에만', () => {
    expect(TILE_ORDER.slice(0, 22)).toEqual(['floor', 'floor2', 'wallTop', 'wallFace', 'doorOpen', 'doorLocked', 'water', 'pillar', 'gate', 'rock', 'switch', 'switchOn', 'vine', 'stairs', 'chest', 'chestOpen', 'pedestal', 'pedestalEmpty', 'shop', 'fountain', 'rubble', 'fountainDry']);
    expect(TILE_ORDER.slice(22)).toEqual(['plate', 'plateOn', 'brazier', 'brazierLit', 'post']);
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
    expect(priceOf('shard', 15)).toBe(450);
    expect(priceOf('shard', 25)).toBe(675);
  });
});
