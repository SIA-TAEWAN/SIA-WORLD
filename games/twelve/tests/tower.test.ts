import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_W } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { defaultLoadout } from '../src/data/growth';
import { itemDef } from '../src/data/items';
import { regionOf } from '../src/data/regions';
import { TOWER, TOWER_ROWS, floorCount, floorKind, floorKinds, floorMinTime, isStartFloor, towerCoins, towerFloor, towerLevel, towerRareRate, towerRegion, towerScale, towerStones } from '../src/data/tower';
import { roll } from '../src/game/drops';
import { LIMITS, emptyProfile, type TwelveProfile } from '../src/game/progress';
import { createRun, scaleOf } from '../src/game/sim';
import { TOWER_TAG, applyTowerFloor, beginTower, checkTowerFloor, checkTowerStart, endTower, startFloors, towerRareLists, type TowerRun } from '../src/game/tower';
import { ApiError, createLocalApi, createSupabaseApi, normalize, type RpcClient, type Store } from '../src/net/api';
import { autoplay } from './bot';

const memStore = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const T0 = 1_000_000;
const begin = (p: TwelveProfile, floor = 1, seed = 7): TowerRun => beginTower(p, floor, 'rat', 'run', seed, T0);
/** 층 n 개를 sec 초씩 걸려 깬다 (시각도 그만큼 흐른다) */
function climb(p: TwelveProfile, run: TowerRun, n: number, sec = 20) {
  let now = run.at;
  for (let i = 0; i < n; i++) {
    now += sec * 1000;
    const floor = run.floor + 1;
    expect(checkTowerFloor(run, floor, run.played + sec, undefined, now)).toBeNull();
    applyTowerFloor(p, run, floor, run.played + sec, undefined, now);
  }
  return now;
}

describe('끝없는 탑 — 방', () => {
  it('층의 종류: 10층마다 보스, 5층마다 정예', () => {
    expect([1, 4, 5, 9, 10, 15, 20, 25, 30].map(floorKind)).toEqual(['normal', 'normal', 'elite', 'normal', 'boss', 'elite', 'boss', 'elite', 'boss']);
    expect([1, 10, 11, 20, 21, 120, 121].map(towerRegion)).toEqual([1, 1, 2, 2, 3, 12, 1]);
    expect([1, 11, 21, 101].every(isStartFloor)).toBe(true);
    expect([0, 2, 10, 20, 1.5].some(isStartFloor)).toBe(false);
  });

  it('방은 층 번호만으로 정해지고, 벽 안에 요괴·시작·출구가 없다', () => {
    for (let f = 1; f <= 130; f++) {
      const m = towerFloor(f);
      expect(m.tower).toBe(f);
      expect(m.region).toBe(towerRegion(f));
      expect(m.rows.length).toBe(TOWER_ROWS);
      for (const r of m.rows) expect(r.length).toBe(MAP_W);
      const tile = ([x, y]: readonly [number, number]) => m.rows[y][x];
      expect(tile(m.start)).not.toBe('#');
      expect(tile(m.exit)).not.toBe('#');
      // 상자는 닿을 수 없는 벽 구석
      expect(tile(m.chest)).toBe('#');
      for (const g of m.groups) expect(tile(g.at)).toBe('.');
      const kind = floorKind(f);
      expect(!!m.boss).toBe(kind === 'boss');
      expect(m.groups.filter((g) => g.elite).length).toBe(kind === 'elite' ? 1 : 0);
      if (kind !== 'boss') {
        expect(m.groups.reduce((n, g) => n + g.list.reduce((a, [, c]) => a + c, 0), 0)).toBe(floorCount(f));
        const kinds = floorKinds(f);
        for (const g of m.groups) for (const [k] of g.list) expect(kinds).toContain(k);
        for (const k of kinds) expect(regionOf(m.region).enemies).toContain(k);
      } else {
        expect(tile(m.boss!)).toBe('.');
        expect(m.groups.length).toBe(0);
        expect(BOSSES[regionOf(m.region).boss]).toBeTruthy();
      }
    }
    expect(towerFloor(7)).toBe(towerFloor(7));
  });

  it('층이 오를수록 요괴가 세진다 (요괴 배율은 층으로 정한다)', () => {
    expect(towerLevel(1)).toBe(1);
    expect(scaleOf(towerFloor(1), 'normal')).toEqual(towerScale(1));
    const hp = (f: number) => createRun(towerFloor(f), 'normal', defaultLoadout('ox', 1, 'sword', 0)).enemies[0].maxHp;
    // 1층과 121층은 같은 방 모양(같은 지형)이다
    expect(hp(121)).toBeGreaterThan(hp(1) * 10);
    expect(floorCount(40)).toBeGreaterThan(floorCount(1));
    expect(floorCount(1000)).toBe(16);
  });

  it('숨은 상자가 없고, 앞 층의 체력·마력을 이어 온다', () => {
    const s = createRun(towerFloor(1), 'normal', defaultLoadout('ox', 1, 'sword', 0), { carry: { hp: 10, mp: 3 } });
    expect(s.chest).toBe(true);
    expect(s.p.hp).toBe(10);
    expect(s.p.mp).toBe(3);
    const full = createRun(towerFloor(1), 'normal', defaultLoadout('ox', 1, 'sword', 0), { carry: { hp: 1e9, mp: 1e9 } });
    expect(full.p.hp).toBe(full.stats.hp);
    expect(full.p.mp).toBe(full.stats.mp);
  });

  it('자동 조종: Lv1 로 1층, Lv12 로 10층 보스를 깬다 (층 최소 시간보다 오래 걸린다)', () => {
    const a = createRun(towerFloor(1), 'normal', defaultLoadout('ox', 1, 'sword', 0), { seed: 3, potions: [3, 3] });
    const ra = autoplay(a, 300);
    expect(ra.phase).toBe('clear');
    expect(ra.time).toBeGreaterThan(floorMinTime(1));
    const b = createRun(towerFloor(10), 'normal', defaultLoadout('ox', 12, 'sword', 0), { seed: 3, potions: [5, 3] });
    const rb = autoplay(b, 600);
    expect(rb.phase).toBe('clear');
    expect(b.bossDead).toBe(true);
    expect(rb.time).toBeGreaterThan(floorMinTime(10));
  });
});

describe('끝없는 탑 — 보상 숫자', () => {
  it('엽전 · 강화석 · 레어 확률이 층에 따라 는다', () => {
    expect(towerCoins(1)).toBe(26);
    expect(towerCoins(5)).toBe(100);
    expect(towerCoins(10)).toBe(400);
    for (let f = 1; f < 200; f++) expect(towerCoins(f + TOWER.cp)).toBeGreaterThan(towerCoins(f));
    expect([1, 5, 10, 55, 100, 5000].map(towerStones)).toEqual([0, 1, 3, 2, 12, 12]);
    expect([1, 5, 10, 100, 500].map(towerRareRate)).toEqual([0, 110, 900, 1800, 3000]);
    expect(towerRareRate(995)).toBe(TOWER.rare.eliteMax);
  });
});

describe('끝없는 탑 — 기록 규칙', () => {
  it('처음부터 누구나 들어가고, 들어가면 0층 기록이 생긴다', () => {
    const p = emptyProfile();
    expect(p.tower).toBeNull();
    expect(checkTowerStart(p, 1, 'rat')).toBeNull();
    expect(checkTowerStart(p, 2, 'rat')).toBe('bad floor');
    expect(checkTowerStart(p, 11, 'rat')).toBe('floor locked');
    expect(checkTowerStart(p, 1, 'rabbit')).toBe('hero locked');
    expect(checkTowerStart(p, 1, 'cat')).toBe('hero locked');
    expect(checkTowerStart(p, 1, 'lion')).toBe('bad hero');
    const run = begin(p);
    expect(p.tower).toEqual({ floor: 0, time: 0, level: 1, hero: 'rat', at: new Date(T0).toISOString(), cps: {} });
    expect(run).toMatchObject({ floor: 0, base: 0, played: 0, done: false });
    expect(startFloors(p)).toEqual([1]);
  });

  it('층을 깨면 그 자리에서 엽전을 받고 최고 기록이 오른다', () => {
    const p = emptyProfile();
    const run = begin(p);
    const r = applyTowerFloor(p, run, 1, 20, undefined, T0 + 20_000);
    expect(r).toMatchObject({ floor: 1, coins: towerCoins(1), time: 20, best: true, siaCoin: false });
    expect(p.coins).toBe(towerCoins(1));
    expect(p.exp).toBe(0);
    expect(p.tower).toMatchObject({ floor: 1, time: 20, level: 1, hero: 'rat' });
    expect(run).toMatchObject({ floor: 1, played: 20, at: T0 + 20_000 });
  });

  it('검사: 층 순서 · 층 최소 시간 · 서버가 잰 시간 · 물약 모양', () => {
    const p = emptyProfile();
    const run = begin(p);
    const at = T0 + 60_000;
    expect(checkTowerFloor(run, 2, 20, undefined, at)).toBe('bad floor');
    expect(checkTowerFloor(run, 1, 20.5, undefined, at)).toBe('bad time');
    expect(checkTowerFloor(run, 1, TOWER.minTime - 1, undefined, at)).toBe('too early');
    expect(checkTowerFloor(run, 1, TOWER.minTime, undefined, at)).toBeNull();
    // 보고한 시간보다 서버가 잰 시간이 짧다
    expect(checkTowerFloor(run, 1, 30, undefined, T0 + 20_000)).toBe('too early');
    expect(checkTowerFloor(run, 1, 30, undefined, T0 + (30 - LIMITS.timeSlack) * 1000)).toBeNull();
    expect(checkTowerFloor(run, 1, 30, undefined, T0 + (LIMITS.maxAge + 1) * 1000)).toBe('too late');
    expect(checkTowerFloor(run, 1, LIMITS.maxTime + 1, undefined, T0 + 5_000_000)).toBe('bad time');
    expect(checkTowerFloor(run, 1, 20, [[1, 0], [0, 0, 0]], at)).toBe('bad potions');
    // 보스 층은 최소 시간이 길다
    climb(p, run, 9);
    expect(checkTowerFloor(run, 10, run.played + TOWER.bossMinTime - 1, undefined, run.at + 60_000)).toBe('too early');
    expect(checkTowerFloor(run, 10, run.played + TOWER.bossMinTime, undefined, run.at + 60_000)).toBeNull();
    run.done = true;
    expect(checkTowerFloor(run, 10, run.played + 20, undefined, run.at + 60_000)).toBe('already finished');
  });

  it('보스 층을 깨면 체크포인트가 생기고, 그 위에서 시작하면 그 시간이 더해진다', () => {
    const p = emptyProfile();
    const run = begin(p);
    climb(p, run, 10, 20);
    expect(p.tower).toMatchObject({ floor: 10, time: 200, cps: { '10': 200 } });
    expect(startFloors(p)).toEqual([1, 11]);
    expect(checkTowerStart(p, 11, 'rat')).toBeNull();
    expect(checkTowerStart(p, 21, 'rat')).toBe('floor locked');
    const next = begin(p, 11);
    expect(next).toMatchObject({ floor: 10, base: 200, played: 0 });
    const r = applyTowerFloor(p, next, 11, 15, undefined, T0 + 15_000);
    expect(r).toMatchObject({ floor: 11, time: 215, best: true });
    expect(p.tower).toMatchObject({ floor: 11, time: 215 });
    // 더 느리게 다시 10층: 기록·체크포인트는 그대로. 더 빠르면 체크포인트만 줄어든다 (최고 층은 11층)
    const slow = begin(p);
    climb(p, slow, 10, 30);
    expect(p.tower).toMatchObject({ floor: 11, time: 215, cps: { '10': 200 } });
    const fast = begin(p);
    climb(p, fast, 10, 10);
    expect(p.tower).toMatchObject({ floor: 11, time: 215, cps: { '10': 100 } });
  });

  it('같은 층을 더 빨리 깨면 시간만 줄어든다', () => {
    const p = emptyProfile();
    climb(p, begin(p), 3, 30);
    expect(p.tower).toMatchObject({ floor: 3, time: 90 });
    climb(p, begin(p), 3, 10);
    expect(p.tower).toMatchObject({ floor: 3, time: 30 });
    climb(p, begin(p), 2, 5);
    expect(p.tower).toMatchObject({ floor: 3, time: 30 });
  });

  it('보상은 판 씨앗과 층으로 정해진다: 장비 등급은 연 지형까지, 레어는 연 지형의 것', () => {
    const p = emptyProfile();
    expect(towerRareLists(p)).toEqual([['r-n1-1', 'r-n1-2', 'r-n1-3']]);
    let gear = 0;
    let rare = 0;
    let acc = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const q = emptyProfile();
      q.bag = 80;
      const run = begin(q, 1, seed * 7919);
      let stones = 0;
      let coins = 0;
      for (let f = 1; f <= 30; f++) {
        const before = q.items.length;
        const r = applyTowerFloor(q, run, f, f * 20, undefined, T0 + f * 20_000);
        const kind = floorKind(f);
        coins += r.coins;
        stones += r.stones;
        expect(r.coins).toBe(towerCoins(f));
        expect(r.stones).toBe(towerStones(f) + (kind === 'normal' && roll(run.seed, TOWER_TAG.stone, f) % 10000 < TOWER.stone.rate ? 1 : 0));
        expect(q.items.length - before).toBe(r.items.length);
        for (const it of r.items) {
          const d = itemDef(it.base)!;
          expect(d.tier).toBe(0);
          if (d.rare) {
            rare++;
            expect(d.id.startsWith('r-n1-')).toBe(true);
            expect(q.codex).toContain(d.id);
            expect(kind).not.toBe('normal');
          } else if (d.slot === 'acc') {
            acc++;
            expect(kind).not.toBe('normal');
          } else {
            gear++;
            expect(kind).toBe('normal');
          }
        }
      }
      expect(q.coins).toBe(coins);
      expect(q.stones).toBe(stones);
      expect(q.exp).toBe(0);
      expect(q.level).toBe(1);
    }
    expect(gear).toBeGreaterThan(10);
    expect(acc).toBeGreaterThan(20);
    expect(rare).toBeGreaterThan(5);
  });

  it('지형을 더 열면 장비 등급이 오르고 그 지형의 레어도 나온다', () => {
    const p = emptyProfile();
    p.maps.normal['1-8'] = { stars: 0, clears: 1, best: 100 };
    p.maps.normal['2-8'] = { stars: 0, clears: 1, best: 100 };
    expect(towerRareLists(p).map((l) => l[0])).toEqual(['r-n1-1', 'r-n2-1', 'r-n3-1']);
    p.bag = 80;
    const bases = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const run = begin(p, 1, seed * 104729);
      for (let f = 1; f <= 20; f++) for (const it of applyTowerFloor(p, run, f, f * 20, undefined, T0).items) bases.add(it.base);
      p.items = p.items.slice(0, 5);
    }
    const list = [...bases].map((b) => itemDef(b)!);
    // 3지형을 열었다 = 등급 1 (무쇠)
    for (const d of list.filter((d) => !d.rare)) expect(d.tier).toBe(1);
    expect(new Set(list.filter((d) => d.rare).map((d) => d.id.split('-')[1])).size).toBeGreaterThan(1);
  });

  it('엽전 획득 장신구는 판을 시작할 때의 것을 쓴다', () => {
    const p = emptyProfile();
    p.items.push({ id: '9', base: 'c-coin-0', plus: 0, lock: false, box: false });
    p.eq.acc = '9';
    const run = begin(p);
    expect(run.coinPct).toBe(5);
    p.eq.acc = null;
    expect(applyTowerFloor(p, run, 1, 20, undefined, T0).coins).toBe(Math.floor((towerCoins(1) * 105) / 100));
  });

  it('쓴 물약은 층마다 빠지고, 끝낼 때 마지막 층의 것도 빠진다', () => {
    const p = emptyProfile();
    const run = begin(p);
    applyTowerFloor(p, run, 1, 20, [[2, 0, 0], [1, 0, 0]], T0);
    expect(p.potions).toEqual([[3, 0, 0], [2, 0, 0]]);
    expect(endTower(p, run, [[9, 0, 0]])).toBe('bad potions');
    expect(endTower(p, run, [[9, 0, 0], [0, 0, 0]])).toBeNull();
    expect(p.potions).toEqual([[0, 0, 0], [2, 0, 0]]);
    expect(run.done).toBe(true);
    expect(endTower(p, run, undefined)).toBe('already finished');
  });
});

describe('끝없는 탑 — 테스트 모드(기기 저장)도 같은 규칙', () => {
  it('시작 → 층 보고 → 끝. 너무 빠른 보고와 끝난 판은 받지 않는다', async () => {
    let now = T0;
    const api = createLocalApi(memStore(), 'k', () => now);
    await expect(api.towerStart(11, 'rat')).rejects.toThrow('floor locked');
    const st = await api.towerStart(1, 'rat');
    expect(st.base).toBe(0);
    expect((await api.loadProfile()).tower).toMatchObject({ floor: 0 });
    // 1층을 못 깨고 끝나도 기록은 남는다
    await expect(api.towerFloor(st.run, 1, 20, [[0, 0, 0], [0, 0, 0]])).rejects.toThrow('too early');
    now += 20_000;
    const a = await api.towerFloor(st.run, 1, 20, [[1, 0, 0], [0, 0, 0]]);
    expect(a!.result).toMatchObject({ floor: 1, coins: towerCoins(1), best: true });
    expect(a!.profile.tower).toMatchObject({ floor: 1, time: 20 });
    expect(a!.profile.potions[0][0]).toBe(4);
    await expect(api.towerFloor(st.run, 1, 40, [[0, 0, 0], [0, 0, 0]])).rejects.toThrow('bad floor');
    const end = await api.towerEnd(st.run, [[1, 0, 0], [0, 0, 0]]);
    expect(end!.potions[0][0]).toBe(3);
    await expect(api.towerFloor(st.run, 2, 40, [[0, 0, 0], [0, 0, 0]])).rejects.toBeInstanceOf(ApiError);
    // 새 판을 시작하면 앞 판은 끝난다
    const b = await api.towerStart(1, 'rat');
    const c = await api.towerStart(1, 'rat');
    now += 30_000;
    await expect(api.towerFloor(b.run, 1, 20, [[0, 0, 0], [0, 0, 0]])).rejects.toThrow('already finished');
    expect((await api.towerFloor(c.run, 1, 20, [[0, 0, 0], [0, 0, 0]]))!.result.best).toBe(false);
  });

  it('저장된 탑 기록을 다시 읽는다 (없으면 null, 깨진 값은 고친다)', () => {
    expect(normalize({}).tower).toBeNull();
    expect(normalize({ tower: { floor: 12, time: 300.7, level: 9, hero: 'ox', at: '2026-11-23T00:00:00.000Z', cps: { '10': 250, x: 1, '20': 'a' } } }).tower).toEqual({
      floor: 12, time: 300, level: 9, hero: 'ox', at: '2026-11-23T00:00:00.000Z', cps: { '10': 250 },
    });
    expect(normalize({ tower: { floor: -3, hero: 'lion' } }).tower).toEqual({ floor: 0, time: 0, level: 1, hero: 'rat', at: '', cps: {} });
  });
});

describe('끝없는 탑 — 서버 연결', () => {
  /** 서버 흉내: 부른 것을 적어 두고, 정해 둔 답을 준다 (던지면 그 글자의 오류) */
  function fake(answers: Record<string, (args?: Record<string, unknown>) => unknown>) {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const sb: RpcClient = {
      rpc: async (fn, args) => {
        calls.push([fn, args]);
        try {
          return { data: answers[fn]?.(args) ?? null, error: null };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      },
    };
    return { sb, calls };
  }
  const none = [[0, 0, 0], [0, 0, 0]];

  it('시작 · 층 보고 · 끝이 RPC 로 가고, 서버가 준 기록과 결과를 쓴다', async () => {
    const state = { ...emptyProfile(), coins: 26, tower: { floor: 1, time: 20, level: 1, hero: 'rat', at: '2026-11-23T00:00:00Z', cps: {} } };
    const { sb, calls } = fake({
      twelve_tower_start: () => ({ run: 'r1', seed: 5, base: 200 }),
      twelve_tower_floor: () => ({ state, result: { floor: 11, coins: 86, stones: 1, items: [{ id: 9, base: 'a-0', box: true }], siaCoin: true, time: 220, best: true } }),
      twelve_tower_end: () => state,
    });
    const api = createSupabaseApi(sb, 'u', memStore());
    expect(await api.towerStart(11, 'rat')).toEqual({ run: 'r1', seed: 5, base: 200 });
    const r = await api.towerFloor('r1', 11, 20.9, none);
    expect(r!.result).toEqual({ floor: 11, coins: 86, stones: 1, items: [{ id: '9', base: 'a-0', plus: 0, lock: false, box: true }], siaCoin: true, time: 220, best: true });
    expect(r!.profile.tower).toMatchObject({ floor: 1, time: 20 });
    expect((await api.towerEnd('r1', none))!.coins).toBe(26);
    expect(calls).toEqual([
      ['twelve_tower_start', { p_floor: 11, p_hero: 'rat' }],
      ['twelve_tower_floor', { p_run: 'r1', p_floor: 11, p_time: 20, p_potions: none }],
      ['twelve_tower_end', { p_run: 'r1', p_potions: none }],
    ]);
  });

  it('거절은 ApiError, 통신 문제는 한 번 더 보내 보고 null', async () => {
    const no = fake({
      twelve_tower_start: () => {
        throw new Error('floor locked');
      },
      twelve_tower_floor: () => {
        throw new Error('too early');
      },
    });
    const a = createSupabaseApi(no.sb, 'u', memStore());
    await expect(a.towerStart(11, 'rat')).rejects.toBeInstanceOf(ApiError);
    await expect(a.towerFloor('r1', 1, 2, none)).rejects.toThrow('too early');
    expect(no.calls.length).toBe(2);
    const down = fake({
      twelve_tower_start: () => {
        throw new Error('Failed to fetch');
      },
      twelve_tower_floor: () => {
        throw new Error('Failed to fetch');
      },
      twelve_tower_end: () => {
        throw new Error('Failed to fetch');
      },
    });
    const b = createSupabaseApi(down.sb, 'u', memStore());
    // 탑은 기록되지 않는 판으로 시작하지 않는다
    await expect(b.towerStart(1, 'rat')).rejects.not.toBeInstanceOf(ApiError);
    expect(await b.towerFloor('r1', 1, 20, none)).toBeNull();
    expect(down.calls.filter(([fn]) => fn === 'twelve_tower_floor').length).toBe(2);
    expect(await b.towerEnd('r1', none)).toBeNull();
  });
});

describe('끝없는 탑 — SQL (078_twelve.sql)', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/078_twelve.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const fn = (name: string) => {
    const i = sql.indexOf(`function public.${name}(`);
    return i < 0 ? '' : sql.slice(i, sql.indexOf('$$;', i));
  };

  it('판정 종류 번호가 tower.ts 의 TOWER_TAG 와 같다 (순번은 층)', () => {
    const body = fn('twelve_tower_floor');
    expect(TOWER_TAG).toEqual({ stone: 20, gear: 21, gearPick: 22, acc: 23, accPick: 24, rare: 25, rareRegion: 26, rarePick: 27 });
    for (const [tag, what] of [[20, "public._twelve_const('tower_stone_rate')"], [21, "public._twelve_const('tower_gear')"], [23, "public._twelve_const(case when kind = 'boss' then 'tower_acc_boss' else 'tower_acc_elite' end)"], [25, 'rate']] as const) {
      expect(body).toContain(`public._twelve_roll(seed, ${tag}, p_floor) % 10000 < ${what}`);
    }
    for (const tag of [22, 24, 26, 27]) expect(body).toContain(`public._twelve_roll(seed, ${tag}, p_floor) %`);
  });

  it('층 최소 시간 · 서버가 잰 시간 검사 · 엽전 식 · 10층마다 시아코인', () => {
    const body = fn('twelve_tower_floor');
    expect(body).toContain("if p_floor is null or p_floor <> rn.floor + 1 then raise exception 'bad floor'; end if;");
    expect(body).toContain("if ft < public._twelve_const(case when kind = 'boss' then 'tower_boss_min_time' else 'tower_min_time' end) then raise exception 'too early'; end if;");
    expect(body).toContain("if elapsed < ft - public._twelve_const('time_slack') then raise exception 'too early'; end if;");
    expect(body).toContain('n_coins := floor(n_coins * (100 + rn.coin_pct) / 100.0);');
    expect(body).toContain("got_coin := public._grant_sia_coin(me, 'twelve', p_run::text || ':' || p_floor::text);");
    expect(body).toContain('tier := public._twelve_shop_tier(me);');
    expect(fn('_twelve_tower_kind')).toContain("p_floor % public._twelve_const('tower_cp')::int = 0 then 'boss'");
  });

  it('탑 시작은 대원을 검사하고, 체크포인트가 있어야 위에서 시작한다', () => {
    const body = fn('twelve_tower_start');
    expect(body).toContain('perform public._twelve_check_hero(me, p_hero);');
    expect(body).toContain("if p_floor is null or p_floor < 1 or (p_floor - 1) % cp <> 0 then raise exception 'bad floor'; end if;");
    expect(body).toContain("raise exception 'floor locked'");
    expect(body).toContain('insert into public.twelve_tower (user_id, level, hero) values (me, pr.level, p_hero) on conflict (user_id) do nothing;');
  });

  it('랭킹 뷰: 최고 층 → 걸린 시간 → 먼저 달성한 순', () => {
    expect(sql).toContain('(row_number() over (order by r.best_floor desc, r.best_time asc, r.achieved_at asc, r.user_id))::int as place');
    expect(sql).toContain('(row_number() over (order by r.level desc, r.exp desc, r.level_at asc, r.user_id))::int as place');
    expect(sql).toContain('grant select on public.twelve_tower_ranking to anon, authenticated;');
  });
});
