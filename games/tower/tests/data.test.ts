import { describe, expect, it } from 'vitest';
import { ENEMIES, FLOORS, INNER_H, INNER_W, ITEMS, LAST_READY, ORBS, ROOMS, enemyDef, expNeed, fitGrid, floorRule, orbAtFloor, orbDef, priceOf, statsAt, zoneData } from '../src/data';
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
    expect(LAST_READY).toBe(100);
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
    // 3~5구역: 일반 4 · 정예 1 · 보스 1 (보스 기준 레벨 30·40·50), 테마는 구역마다 다르다
    const themes = new Set<string>();
    for (const [zone, theme] of [[3, 'frost'], [4, 'cloud'], [5, 'ember'], [6, 'thunder'], [7, 'galaxy'], [8, 'flower'], [9, 'storm'], [10, 'wish']] as const) {
      const z = zoneData(zone * 10)!;
      expect(z.ready).toBe(true);
      expect(z.theme).toBe(theme);
      themes.add(z.theme);
      expect(z.enemies).toHaveLength(4);
      for (const id of z.enemies) {
        expect(enemyDef(id).minFloor, id).toBeGreaterThanOrEqual(zone * 10 - 9);
        expect(enemyDef(id).weight, id).toBeGreaterThan(0);
      }
      expect(enemyDef(z.elite)).toMatchObject({ elite: true, minFloor: zone * 10 - 1 });
      // 마지막 보스(어둑시니)만 48 — 시트 규격은 같다 (size × 4칸)
      expect(enemyDef(z.boss)).toMatchObject({ boss: true, level: zone * 10, size: zone === 10 ? 48 : 32, minFloor: zone * 10 });
      // 보스가 부르는 것(얼음 수정 · 쇠붙이)도 데이터에 있다
      const sum = enemyDef(z.boss).summon;
      if (sum) expect(enemyDef(sum.id).weight).toBe(0);
    }
    expect(themes.size).toBe(8);
    // 1~10구역 적 이름은 겹치지 않는다
    expect(new Set(ENEMIES.map((e) => e.id)).size).toBe(ENEMIES.length);
    expect(ENEMIES.some((e) => e.status?.kind === 'burn')).toBe(true);
    // 그림 규격: 일반 16 · 정예 24 · 보스 32 (마지막 보스 48, 까마귀 그림자는 대왕 그림을 빌린다)
    for (const e of ENEMIES) expect(e.size, e.id).toBe(e.id === 'eodugsini' ? 48 : e.art ? enemyDef(e.art).size : e.boss ? 32 : e.elite ? 24 : 16);
    // 6구역부터: 경험치 배수(레벨이 층을 너무 앞서지 않게) · 엽전 배수 · 전투방 최대 3 (한 층 3분 안쪽)
    for (let zone = 6; zone <= 10; zone++) {
      const z = zoneData(zone * 10)!;
      expect(z.expMul).toBeGreaterThan(0.5);
      expect(z.expMul).toBeLessThan(1);
      expect(z.coinMul).toBeGreaterThan(0.5);
      expect(floorRule(zone * 10 - 6).combat[1]).toBe(3);
      expect(floorRule(zone * 10 - 2).combat[1]).toBe(3);
    }
    expect(floorRule(44).combat[1]).toBe(4);
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
    // 구슬이 필요한 퍼즐은 그 구슬을 받은 뒤 층에만 (진행이 구슬 때문에 막히지 않게 — 곁방 보물 길)
    for (const r of p) if (r.needs) expect(r.minFloor, r.id).toBeGreaterThan(orbDef(r.needs)!.floor);
    // 3~5구역 새 퍼즐: 찬물(토끼) · 풍경(닭) · 징(개) · 둥근 바위(호랑이)
    const needs = (id: string, ch: string) => p.some((r) => r.needs === id && r.grid.join('').includes(ch));
    expect(needs('rabbit', 'i') && needs('rooster', 'b') && needs('dog', 'j') && needs('tiger', 'u') && needs('tiger', 'x')).toBe(true);
    // 6~10구역 새 퍼즐: 뇌석(말) · 구름 덩이(돼지) · 쇠창살(백호) · 거울(쥐 참격) · 짙은 구름(청룡)
    expect(needs('horse', 'l') && needs('pig', 'o') && needs('pig', 'x') && needs('whiteTiger', 'z') && needs('rat', '/') && needs('blueDragon', 'm')).toBe(true);
    // 구역마다 그 구역에서 처음 나오는 퍼즐이 있다
    for (const [zone, kinds] of [[6, ['-rod']], [7, ['-gust']], [8, ['-bars']], [9, ['-mirror']], [10, ['-fog']]] as const) {
      for (const k of kinds) expect(p.some((r) => r.id.includes(k) && Math.ceil(r.minFloor / 10) === zone), `${zone}구역 ${k}`).toBe(true);
    }
  });

  it('보스방: 구역마다 하나 (그 보스 층에만), 전설 구슬 층(30·50)의 보스방에는 받침대', () => {
    const boss = ROOMS.rooms.filter((r) => r.kind === 'boss');
    for (let f = 10; f <= 100; f += 10) {
      const list = boss.filter((r) => r.minFloor <= f && (r.maxFloor ?? 999) >= f);
      expect(list, `${f}층`).toHaveLength(1);
      expect(list[0].grid.join('').includes('O'), `${f}층`).toBe(!!orbAtFloor(f)?.legend);
      // 100층 보스방에만 소원 구슬
      expect(list[0].grid.join('').includes('W'), `${f}층`).toBe(f === 100);
    }
    expect(orbAtFloor(30)?.id).toBe('turtle');
    expect(orbAtFloor(50)?.id).toBe('phoenix');
    expect(orbAtFloor(70)?.id).toBe('whiteTiger');
    expect(orbAtFloor(90)?.id).toBe('blueDragon');
    expect(orbAtFloor(100)).toBeUndefined();
  });

  it('타일 순서: 처음 22칸은 1구역 시트 그대로, 새 칸은 뒤에만', () => {
    expect(TILE_ORDER.slice(0, 22)).toEqual(['floor', 'floor2', 'wallTop', 'wallFace', 'doorOpen', 'doorLocked', 'water', 'pillar', 'gate', 'rock', 'switch', 'switchOn', 'vine', 'stairs', 'chest', 'chestOpen', 'pedestal', 'pedestalEmpty', 'shop', 'fountain', 'rubble', 'fountainDry']);
    expect(TILE_ORDER.slice(22, 27)).toEqual(['plate', 'plateOn', 'brazier', 'brazierLit', 'post']);
    expect(TILE_ORDER.slice(27, 35)).toEqual(['coldWater', 'ice', 'bell', 'bellOn', 'gong', 'gongOn', 'boulder', 'pit']);
    expect(TILE_ORDER.slice(35)).toEqual(['rod', 'rodOn', 'puff', 'bars', 'mirrorA', 'mirrorB', 'fog', 'wish']);
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
    expect([25, 35, 45].map((f) => priceOf('potionL', f))).toEqual([135, 203, 304]);
    expect([55, 65, 75, 85, 95].map((f) => priceOf('potionL', f))).toEqual([456, 683, 1025, 1538, 2307]);
  });
});
