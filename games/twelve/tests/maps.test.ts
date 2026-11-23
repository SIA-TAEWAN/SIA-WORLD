import { describe, expect, it } from 'vitest';
import { MAP_W } from '../src/data/balance';
import { BOSSES, BOSS_IDS } from '../src/data/bosses';
import { ENEMIES, ENEMY_IDS } from '../src/data/enemies';
import { elitesAt, generateRegion, kindsAt, regionFile } from '../src/data/mapgen';
import { MAPS, mapKillMax, mapOf, mapsOf, nextMap, type MapDef } from '../src/data/maps';
import { R01 } from '../src/data/maps/r01';
import { R02 } from '../src/data/maps/r02';
import { R03 } from '../src/data/maps/r03';
import { ALL_MAP_IDS, MAPS_PER_REGION, REGIONS, REGIONS_READY, REGION_TABLE, mapId, mapLevel, mapScale, parseMapId } from '../src/data/regions';
import { readFileSync } from 'node:fs';
import { regionTier } from '../src/data/economy';
import { tierAtk } from '../src/data/weapons';
import { createRun } from '../src/game/sim';
import { lo } from './helpers';
import { autoplay } from './bot';

/** 시작 칸에서 걸어서 닿는 칸 */
function reach(m: MapDef): Set<string> {
  const seen = new Set<string>([m.start.join()]);
  const q = [m.start];
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (ny < 0 || ny >= m.rows.length || nx < 0 || nx >= MAP_W || m.rows[ny][nx] === '#' || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  return seen;
}

describe('지형 표 (12지형 × 8맵, 보통·어려움)', () => {
  it('맵 id 는 지형-맵 모양이고 96개다', () => {
    expect(ALL_MAP_IDS.length).toBe(96);
    expect(ALL_MAP_IDS[0]).toBe('1-1');
    expect(ALL_MAP_IDS[95]).toBe('12-8');
    expect(mapId(3, 7)).toBe('3-7');
    expect(parseMapId('3-7')).toEqual({ region: 3, no: 7 });
    for (const bad of ['0-1', '13-1', '1-9', '1-0', 'a-b', '1-1x', '']) expect(parseMapId(bad), bad).toBeNull();
  });

  it('12지형: 이름·고향 대원·보스가 하나씩, 요괴는 4~6종', () => {
    expect(REGION_TABLE.length).toBe(REGIONS);
    expect(new Set(REGION_TABLE.map((r) => r.home)).size).toBe(12);
    expect(REGION_TABLE.map((r) => r.boss)).toEqual([...BOSS_IDS]);
    for (const r of REGION_TABLE) {
      expect(r.enemies.length).toBeGreaterThanOrEqual(4);
      expect(r.enemies.length).toBeLessThanOrEqual(6);
      expect(new Set(r.enemies).size).toBe(r.enemies.length);
      for (const k of r.enemies) expect(ENEMY_IDS).toContain(k);
      expect(BOSSES[r.boss].hardMoves.length).toBeGreaterThan(0);
    }
  });

  it('권장 레벨: 보통 1 → 65, 어려움 66 → 99, 뒤로 갈수록 오른다', () => {
    expect(mapLevel(1, 1, 'normal')).toBe(1);
    expect(mapLevel(12, 8, 'normal')).toBe(65);
    expect(mapLevel(1, 1, 'hard')).toBe(66);
    expect(mapLevel(12, 8, 'hard')).toBe(99);
    let prev = 0;
    for (const mode of ['normal', 'hard'] as const) {
      for (const id of ALL_MAP_IDS) {
        const { region, no } = parseMapId(id)!;
        const lv = mapLevel(region, no, mode);
        expect(lv).toBeGreaterThanOrEqual(prev);
        prev = lv;
      }
    }
    expect(mapScale(1, 1, 'hard').count).toBeGreaterThan(mapScale(1, 1, 'normal').count);
  });
});

describe('맵 데이터', () => {
  it('준비된 지형마다 맵 8개가 있고, 8번째에 보스가 있다', () => {
    for (let r = 1; r <= REGIONS_READY; r++) {
      const maps = mapsOf(r);
      expect(maps.map((m) => m.id)).toEqual(Array.from({ length: MAPS_PER_REGION }, (_, i) => `${r}-${i + 1}`));
      expect(maps.filter((m) => m.boss).map((m) => m.no)).toEqual([8]);
    }
    expect(mapOf('1-3')!.no).toBe(3);
    expect(REGIONS_READY).toBeGreaterThanOrEqual(4);
    expect(MAPS.length).toBe(REGIONS_READY * MAPS_PER_REGION);
    expect(mapOf(`${REGIONS_READY + 1}-1`)).toBeNull();
    expect(nextMap('1-3')!.id).toBe('1-4');
    expect(nextMap('1-8')!.id).toBe('2-1');
    expect(nextMap('3-8')!.id).toBe('4-1');
    expect(nextMap(`${REGIONS_READY}-8`)).toBeNull(); // 그다음 지형은 준비 중
  });

  it.each(MAPS.map((m) => [m.id, m] as const))('%s: 타일·자리가 올바르고 시작에서 모두 닿는다', (_id, m) => {
    for (const row of m.rows) {
      expect(row.length).toBe(MAP_W);
      expect(row).toMatch(/^[#.~]+$/);
    }
    // 가장자리는 모두 벽
    expect(m.rows[0]).toBe('#'.repeat(MAP_W));
    expect(m.rows[m.rows.length - 1]).toBe('#'.repeat(MAP_W));
    for (const row of m.rows) expect(row[0] + row[MAP_W - 1]).toBe('##');
    const ok = reach(m);
    const spots = [m.start, m.exit, m.chest, ...m.groups.map((g) => g.at), ...(m.boss ? [m.boss] : [])];
    for (const c of spots) expect(ok.has(c.join()), `${c}`).toBe(true);
    // 대원은 아래에서 위로 올라간다
    expect(m.start[1]).toBeGreaterThan(m.exit[1]);
    expect(m.par).toBeGreaterThanOrEqual(120);
  });

  it.each(MAPS.map((m) => [m.id, m] as const))('%s: 그 지형 요괴만 나오고 번호가 오를수록 종류가 는다', (_id, m) => {
    const allowed = kindsAt(m.region, m.no);
    for (const g of m.groups) {
      expect(g.list.length).toBeGreaterThan(0);
      for (const [k, n] of g.list) {
        expect(allowed).toContain(k);
        expect(n).toBeGreaterThan(0);
      }
      if (g.elite) expect(allowed).toContain(g.elite);
    }
    expect(m.groups.filter((g) => g.elite).length).toBe(elitesAt(m.no));
    const max = mapKillMax(m, 'normal');
    expect(max.total).toBe(m.groups.reduce((a, g) => a + g.list.reduce((b, [, n]) => b + n, 0) + (g.elite ? 1 : 0), 0));
    expect(mapKillMax(m, 'hard').total).toBeGreaterThan(max.total);
  });

  it('1지형: 요괴 5종 + 정예 + 보스가 모두 나온다', () => {
    const kinds = new Set(R01.flatMap((m) => m.groups.flatMap((g) => g.list.map(([k]) => k))));
    expect([...kinds].sort()).toEqual([...REGION_TABLE[0].enemies].sort());
    expect(R01.some((m) => m.groups.some((g) => g.elite))).toBe(true);
    for (const k of kinds) expect(ENEMIES[k].hp).toBeGreaterThan(0);
  });

  it('2·3지형: 그 지형의 새 요괴(분열 · 덮치기)와 지형 조각(진흙 논 · 바위 고개)이 나온다', () => {
    for (const [list, r, fresh] of [[R02, 2, 'mud'], [R03, 3, 'lynx']] as const) {
      const kinds = new Set(list.flatMap((m) => m.groups.flatMap((g) => g.list.map(([k]) => k))));
      expect([...kinds].sort()).toEqual([...REGION_TABLE[r - 1].enemies].sort());
      expect(kinds.has(fresh)).toBe(true);
      expect(new Set(list.map((m) => m.name)).size).toBe(8);
    }
    // 1지형에는 새 요괴가 없다
    expect(R01.some((m) => m.groups.some((g) => g.list.some(([k]) => k === 'mud' || k === 'lynx')))).toBe(false);
    expect(ENEMIES.mud.split).toBeDefined();
    expect(ENEMIES.lynx.ai).toBe('leap');
    const mudTiles = (list: MapDef[]) => list.reduce((a, m) => a + m.rows.join('').split('~').length - 1, 0);
    expect(mudTiles(R02)).toBeGreaterThan(mudTiles(R01) * 1.5);
    const wallTiles = (list: MapDef[]) => list.reduce((a, m) => a + m.rows.join('').split('#').length - 1, 0) / list.reduce((a, m) => a + m.rows.length, 0);
    expect(wallTiles(R03)).toBeGreaterThan(wallTiles(R02));
  });

  it('4~7지형: 지형마다 새 행동의 요괴가 2번 맵부터 나오고, 그 지형의 땅(대숲 · 연못 · 늪 · 성벽)이 깔린다', () => {
    const fresh = { 4: ['shade', 'lurk'], 5: ['catfish', 'pull'], 6: ['toad', 'spit'], 7: ['bomber', 'bomb'] } as const;
    const slow = (list: readonly MapDef[]) => list.reduce((a, m) => a + m.rows.join('').split('~').length - 1, 0);
    for (const r of [4, 5, 6, 7] as const) {
      if (r > REGIONS_READY) continue;
      const list = mapsOf(r);
      const [kind, ai] = fresh[r];
      expect(ENEMIES[kind].ai).toBe(ai);
      expect(REGION_TABLE[r - 1].enemies[1]).toBe(kind);
      const has = (m: MapDef) => m.groups.some((g) => g.list.some(([k]) => k === kind));
      expect(has(list[0])).toBe(false);
      for (const m of list.slice(1)) expect(has(m), m.id).toBe(true);
      // 새 요괴는 앞 지형에 나오지 않는다
      expect(MAPS.filter((m) => m.region < r).some(has)).toBe(false);
      const kinds = new Set(list.flatMap((m) => m.groups.flatMap((g) => g.list.map(([k]) => k))));
      expect([...kinds].sort()).toEqual([...REGION_TABLE[r - 1].enemies].sort());
      expect(new Set(list.map((m) => m.name)).size).toBe(8);
      // 한 지형에 같은 그림을 쓰는 요괴가 겹치지 않는다 (색만 바꿔 쓰는 요괴 때문에)
      expect(new Set(REGION_TABLE[r - 1].enemies.map((k) => ENEMIES[k].art)).size).toBe(REGION_TABLE[r - 1].enemies.length);
    }
    // 연못(5) · 늪(6)은 느려지는 땅이 훨씬 많다 (환경 효과가 걸리는 땅)
    if (REGIONS_READY >= 5) expect(slow(mapsOf(5))).toBeGreaterThan(slow(R01) * 2);
    if (REGIONS_READY >= 6) expect(slow(mapsOf(6))).toBeGreaterThan(slow(R01) * 1.5);
  });

  it.each(Array.from({ length: REGIONS_READY }, (_, i) => i + 1))('%i지형 파일은 생성 스크립트(npm run gen) 결과와 같다', (r) => {
    const file = readFileSync(new URL(`../src/data/maps/r${String(r).padStart(2, '0')}.ts`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(file).toBe(regionFile(r, generateRegion(r)));
  });
});

describe('맵 한 판 (자동 조종)', () => {
  it('판을 만들면 무리·정예·보스가 자리에 선다', () => {
    const s = createRun(mapOf('1-8')!, 'normal', lo('ox', 'sword', 6));
    expect(s.boss?.bossDef?.id).toBe('bigDokkaebi');
    expect(s.total).toBe(mapKillMax(s.map, 'normal').total);
    expect(s.enemies.filter((e) => e.elite).length).toBe(1);
    expect(s.enemies.every((e) => !e.awake)).toBe(true);
    const hard = createRun(mapOf('1-8')!, 'hard', lo('ox', 'sword', 70));
    expect(hard.total).toBe(mapKillMax(hard.map, 'hard').total);
    expect(hard.boss!.maxHp).toBeGreaterThan(s.boss!.maxHp * 5);
  });

  it.each(MAPS.map((m) => [m.id, m] as const))('%s: 끝까지 깰 수 있다 (무적 자동 조종, 숨은 상자 포함)', (_id, m) => {
    const s = createRun(m, 'normal', { ...lo('ox', 'sword', mapLevel(m.region, m.no, 'normal')), weaponAtk: tierAtk(regionTier(m.region, 'normal')) }, { seed: 11, god: true });
    const r = autoplay(s, 1500, { chest: true });
    expect(r.phase).toBe('clear');
    expect(s.chest).toBe(true);
    if (m.boss) expect(s.bossDead).toBe(true);
    // 서툰 자동 조종으로도 별 기준 시간의 세 배 안에는 끝난다
    expect(r.time).toBeLessThan(m.par * 3);
  });

  it('1-1 은 Lv1 로 물약만 쓰고도 깬다 (무적 아님)', () => {
    const s = createRun(mapOf('1-1')!, 'normal', lo('rat', 'sword', 1), { seed: 3, potions: [3, 3] });
    expect(autoplay(s, 1200).phase).toBe('clear');
  });
});
