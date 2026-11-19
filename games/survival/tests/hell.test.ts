import { describe, expect, it } from 'vitest';
import { HELL, LIMIT, RUN_SEC, TICKS_PER_SEC } from '../src/data/balance';
import { BOSSES, BOSS_INDEX, HELL_PATTERNS } from '../src/data/bosses';
import { ENEMIES, ENEMY_INDEX } from '../src/data/enemies';
import { HELL_MAPS, MAPS, hellBossDmg } from '../src/data/maps';
import { presetUpgrades } from '../src/data/upgrades';
import { PATTERNS, bossPatterns, bossWinding } from '../src/game/bosses';
import { gainCoins, hurtEnemy, spawnBoss, spawnEnemy } from '../src/game/core';
import { normalPolicy, simulate } from '../src/game/policy';
import {
  LIMITS, applyRun, cleanProfile, coinCap, defaultProfile, endlessOpen, hellOpen, isHell, rejectReason, validRun, withRecords,
  type HellRecord, type SurvivalRecord,
} from '../src/game/progress';
import { createRun, makeInput, step, summarize, type RunSummary } from '../src/game/sim';
import { EV, MODE, type State } from '../src/game/state';
import { ApiError, createLocalApi, createSupabaseApi, type RpcClient } from '../src/net/api';
import type { Store } from '../src/net/pending';
import { advance, emptyRun, live } from './helpers';

/**
 * 헬 모드: 기존 맵 4종의 더 강한 판. 배경·요괴·보스는 같고, 요괴가 더 강하고(data/balance.ts 의 HELL × data/maps.ts 의 hell),
 * 보스마다 패턴이 하나 더 있고(data/bosses.ts 의 hell), 엽전을 2배로 준다. 4분 판이고 클리어가 있다.
 * 그 맵을 4분 모드로 클리어해야 그 맵의 헬 모드가 열린다. 기록·랭킹은 4분 모드·무한 모드와 따로다.
 */
const run = (o: Partial<RunSummary> = {}): RunSummary => ({
  map: 'field', character: 'rat', mode: 'hell', time: 200, kills: 2000, level: 30, coins: 200, cleared: false, bossKills: 2, cakes: 2,
  codex: { enemies: ['imp'], bosses: ['bigDokkaebi'], weapons: ['shuriken'], passives: [] },
  ...o,
});
const memStore = (): Store => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const cleared = (map = 'field'): Record<string, SurvivalRecord> => ({ [map]: { time: 240, kills: 3000, cleared: true, character: 'rat', at: 1 } });

describe('헬 모드의 수치 (data)', () => {
  it('헬 맵은 같은 맵에 요괴 강함만 곱한 것이다: 지형·등장 표·보스는 같고, 엽전 배율은 2배', () => {
    expect(HELL.coin).toBe(2);
    expect(HELL_MAPS.map((m) => m.id)).toEqual(MAPS.map((m) => m.id));
    MAPS.forEach((m, i) => {
      const h = HELL_MAPS[i];
      expect(h.spawns).toBe(m.spawns);
      expect(h.swarms).toBe(m.swarms);
      expect(h.bosses).toBe(m.bosses);
      expect(h.terrain).toBe(m.terrain);
      expect(h.growth).toBe(m.growth);
      expect(h.coinMul).toBe(m.coinMul * 2);
      expect(h.power.hp).toBeCloseTo(m.power.hp * HELL.hp * (m.hell.hp ?? 1), 9);
      expect(h.power.dmg).toBeCloseTo(m.power.dmg * HELL.dmg * (m.hell.dmg ?? 1), 9);
      expect(h.power.count).toBeCloseTo(m.power.count * HELL.count * (m.hell.count ?? 1), 9);
      expect(h.power.boss).toBeCloseTo(m.power.boss * HELL.boss * (m.hell.boss ?? 1), 9);
      expect(h.power.speed).toBeCloseTo(m.power.speed * HELL.speed, 9);
      expect(hellBossDmg(m.id)).toBeCloseTo(HELL.bossDmg * (m.hell.bossDmg ?? 1), 9);
      // 모든 맵에서 일반보다 강하다 (체력·피해·수·보스 어느 것도 약해지지 않는다)
      for (const k of ['hp', 'dmg', 'count', 'boss', 'speed'] as const) expect(h.power[k], `${m.id} ${k}`).toBeGreaterThanOrEqual(m.power[k]);
      expect(hellBossDmg(m.id)).toBeGreaterThan(1);
      // 체감 약 1.5배: 요괴 체력 × 피해 × 수를 합친 세기가 일반의 1.4배 이상 (맵마다 강화 49 기준으로 맞춘 값이라 쉬운 맵일수록 더 곱한다)
      const felt = (h.power.hp / m.power.hp) * (h.power.dmg / m.power.dmg) * (h.power.count / m.power.count);
      expect(felt, m.id).toBeGreaterThan(1.4);
    });
    // 일반 맵의 값은 그대로다 (헬 배율이 섞이지 않는다)
    expect(MAPS.map((m) => [m.id, m.coinMul, m.power.hp])).toEqual([['field', 1, 1], ['bamboo', 1.5, 1.3], ['palace', 2, 1.6], ['underworld', 2.5, 2]]);
  });

  it('보스 12종 모두 헬 전용 패턴이 하나씩 있다: 등록된 동작이고, 미리 보여 준 뒤 터지고, 이름이 있다', () => {
    expect(BOSSES).toHaveLength(12);
    BOSSES.forEach((b, i) => {
      expect(PATTERNS[b.hell.kind], `${b.id} ${b.hell.kind}`).toBeTypeOf('function');
      expect(b.hell.windup ?? 0, b.id).toBeGreaterThanOrEqual(0.75);
      expect((b.hell.name ?? '').length, b.id).toBeGreaterThan(1);
      // 일반 패턴 목록에는 없고, 헬 목록은 첫 패턴 바로 뒤에 하나 끼워 넣은 것
      expect(b.patterns).not.toContain(b.hell);
      expect(HELL_PATTERNS[i]).toHaveLength(b.patterns.length + 1);
      expect(HELL_PATTERNS[i][0]).toBe(b.patterns[0]);
      expect(HELL_PATTERNS[i][1]).toBe(b.hell);
      expect(HELL_PATTERNS[i].slice(2)).toEqual(b.patterns.slice(1));
      // 기존 패턴과 다른 종류다 (같은 보스가 이미 쓰는 동작을 수치만 바꿔 되풀이하지 않는다)
      expect(b.patterns.map((p) => p.kind)).not.toContain(b.hell.kind);
    });
    // 헬 전용 동작 7가지를 고루 쓴다
    expect([...new Set(BOSSES.map((b) => b.hell.kind))].sort()).toEqual(['aimed', 'cage', 'cross', 'fan', 'quake', 'rain', 'spiral']);
  });
});

describe('헬 모드의 판', () => {
  it('일반·무한 모드는 그대로다: 헬 표시가 없고 보스 피해 배율은 1, 맵도 일반 맵 그대로', () => {
    for (const mode of [undefined, 'normal', 'endless'] as const) {
      const s = createRun({ seed: 1, char: 'rat', map: 'palace', mode });
      expect(s.hell).toBe(false);
      expect(s.bossDmg).toBe(1);
      expect(s.map).toBe(MAPS[2]);
    }
    const h = createRun({ seed: 1, char: 'rat', map: 'palace', mode: 'hell' });
    expect(h.hell).toBe(true);
    expect(h.endless).toBe(false);
    expect(h.coinCap).toBe(Infinity);
    expect(h.map).toBe(HELL_MAPS[2]);
    expect(h.bossDmg).toBe(hellBossDmg('palace'));
    expect(summarize(h).mode).toBe('hell');
    expect(summarize(createRun({ seed: 1, char: 'rat', map: 'palace' })).mode).toBe('normal');
  });

  it('요괴·보스가 일반보다 강하다: 체력·피해·보스 체력·보스 피해가 헬 배율만큼', () => {
    for (const m of MAPS) {
      const n = emptyRun({ map: m.id });
      const h = emptyRun({ map: m.id, mode: 'hell' });
      const kind = ENEMY_INDEX[m.spawns[0].enemy];
      const en = spawnEnemy(n, kind, 500, 0)!;
      const eh = spawnEnemy(h, kind, 500, 0)!;
      expect(eh.maxHp / en.maxHp).toBeCloseTo(HELL.hp * (m.hell.hp ?? 1), 6);
      expect(eh.dmg / en.dmg).toBeCloseTo(HELL.dmg * (m.hell.dmg ?? 1), 6);
      expect(eh.xp).toBe(en.xp);
      const boss = BOSS_INDEX[m.bosses[2].id];
      const bn = spawnBoss(n, boss, 0, -600)!;
      const bh = spawnBoss(h, boss, 0, -600)!;
      expect(bh.maxHp / bn.maxHp).toBeCloseTo(HELL.boss * (m.hell.boss ?? 1), 6);
      expect(bh.dmg / bn.dmg).toBeCloseTo(hellBossDmg(m.id), 6);
      expect(bn.dmg).toBe(BOSSES[boss].dmg);
    }
  });

  it('요괴가 더 많이 나온다 (같은 시드·같은 시간, 잡지 않고 버틸 때)', () => {
    const count = (mode: 'normal' | 'hell') => {
      const s = createRun({ seed: 9, char: 'ox', map: 'field', mode, numbers: false });
      s.weapons.length = 0;
      let seen = 0;
      advance(s, 30, { immortal: true, each: (st) => (seen = Math.max(seen, st.nextUid)) });
      return seen;
    };
    const n = count('normal');
    const h = count('hell');
    expect(h / n).toBeGreaterThan(1.1);
    expect(h / n).toBeLessThan(1.5);
  });

  it('엽전은 2배로 줍는다 (주운 값이 2배. 무한 모드 같은 고정 상한은 없다)', () => {
    const n = emptyRun({ map: 'bamboo' });
    const h = emptyRun({ map: 'bamboo', mode: 'hell' });
    gainCoins(n, 10);
    gainCoins(h, 10);
    expect(h.coins).toBeCloseTo(n.coins * 2, 9);
    gainCoins(h, 100000);
    expect(h.coins).toBeGreaterThan(100000);
  });

  it('4분 판이다: 최종 보스를 잡으면 클리어하고 끝난다 (무한 모드처럼 이어지지 않는다)', () => {
    const s = createRun({ seed: 3, char: 'ox', map: 'field', mode: 'hell', numbers: false, startAt: RUN_SEC - 2 });
    s.weapons.length = 0;
    advance(s, 4, { immortal: true });
    expect(s.finalUid).toBeGreaterThan(0);
    const boss = live(s.enemies).find((e) => e.uid === s.finalUid)!;
    expect(boss.boss).toBe(BOSS_INDEX.bulgasal);
    hurtEnemy(s, boss, 1e9, -1);
    expect(s.phase).toBe('clear');
    const sum = summarize(s);
    expect(sum).toMatchObject({ mode: 'hell', cleared: true, time: RUN_SEC });
    expect(validRun(sum)).toBe(true);
    expect(rejectReason(sum, 200)).toBeNull();
  });

  it('같은 시드·같은 조작이면 헬 판도 언제나 같은 결과다', () => {
    const play = () => {
      const r = simulate({ seed: 4242, char: 'tiger', map: 'bamboo', mode: 'hell', upgrades: presetUpgrades(34) }, normalPolicy(7), 100);
      return JSON.stringify({ ...r, state: undefined, rng: r.state.rng, x: r.state.player.x, hp: r.state.player.hp });
    };
    expect(play()).toBe(play());
  }, 60_000);
});

describe('헬 전용 보스 패턴', () => {
  /** 빈 맵에 그 보스만 놓고 sec 초 진행하며 본 것을 모은다 */
  const watch = (bossId: string, mode: 'normal' | 'hell', sec = 9) => {
    const map = BOSSES[BOSS_INDEX[bossId]].map;
    const s = emptyRun({ map, mode, seed: 11, numbers: false });
    s.weapons.length = 0;
    const e = spawnBoss(s, BOSS_INDEX[bossId], 0, -260)!;
    const seen = { hell: 0, zonesAtHell: 0, minDelay: Infinity, shots: 0, maxZones: 0, kinds: new Set<string>(), dmgTaken: 0 };
    let inHell = false;
    advance(s, sec, {
      immortal: true,
      each: (st) => {
        for (let i = 0; i < st.evN; i++) if (st.events[i].t === EV.hellPattern) seen.hell++;
        const list = bossPatterns(st, e);
        const p = list[e.pat % list.length];
        seen.kinds.add(p.kind);
        const now = mode === 'hell' && p === BOSSES[e.boss].hell;
        if (now) {
          // 헬 패턴이 놓은 예고 지대와 탄
          const zones = live(st.zones).filter((z) => z.owner === 1);
          seen.zonesAtHell = Math.max(seen.zonesAtHell, zones.length);
          if (!inHell) for (const z of zones) if (z.delay > 0) seen.minDelay = Math.min(seen.minDelay, z.windup);
          seen.shots = Math.max(seen.shots, live(st.projectiles).filter((q) => q.mode === MODE.enemy).length);
        }
        inHell = now;
        seen.maxZones = Math.max(seen.maxZones, st.zones.n);
      },
    });
    return { s, e, seen };
  };

  it('헬 모드의 보스 12종은 모두 등장한 뒤 곧 헬 패턴을 쓴다: 예고 지대(0.75초 이상 미리 보인다)나 탄이 나온다', () => {
    for (const b of BOSSES) {
      const { seen } = watch(b.id, 'hell');
      expect(seen.hell, b.id).toBeGreaterThanOrEqual(1);
      expect(seen.kinds.has(b.hell.kind), b.id).toBe(true);
      if (b.hell.kind === 'spiral' || b.hell.kind === 'aimed') {
        expect(seen.shots, b.id).toBeGreaterThanOrEqual(3);
      } else {
        expect(seen.zonesAtHell, b.id).toBeGreaterThanOrEqual(3);
        expect(seen.minDelay, b.id).toBeGreaterThanOrEqual(0.75);
      }
      // 지대 풀을 넘치게 쓰지 않는다
      expect(seen.maxZones, b.id).toBeLessThan(LIMIT.zones);
    }
  }, 60_000);

  it('일반 모드의 보스는 헬 패턴을 쓰지 않는다 (알림도 없다)', () => {
    for (const b of BOSSES) {
      const { seen, s, e } = watch(b.id, 'normal', 12);
      expect(seen.hell, b.id).toBe(0);
      expect(seen.kinds.has(b.hell.kind), b.id).toBe(false);
      expect(bossPatterns(s, e)).toBe(b.patterns);
    }
  }, 60_000);

  it('헬 패턴은 피할 수 있다: 가만히 서 있으면 맞지만, 예고를 보고 벗어나면 맞지 않는다', () => {
    // 연쇄 충격파(큰 도깨비): 보스 둘레가 세 번 터진다. 멀리 있으면 맞지 않는다
    const far = emptyRun({ map: 'field', mode: 'hell', numbers: false });
    far.weapons.length = 0;
    const b = spawnBoss(far, BOSS_INDEX.bigDokkaebi, 0, -900)!;
    b.speed = 0;
    b.pat = 1; // 헬 패턴부터
    let hits = 0;
    advance(far, 4, { each: (st) => { for (let i = 0; i < st.evN; i++) if (st.events[i].t === EV.hurt) hits++; } });
    expect(hits).toBe(0);
    // 바로 옆에 서 있으면 맞는다 (몸에 닿는 피해와 구분하려고 보스 몸 피해는 0으로)
    const near = emptyRun({ map: 'field', mode: 'hell', numbers: false });
    near.weapons.length = 0;
    const b2 = spawnBoss(near, BOSS_INDEX.bigDokkaebi, 0, -150)!;
    b2.speed = 0;
    b2.dmg = 0;
    b2.pat = 1;
    hits = 0;
    advance(near, 4, { each: (st) => { for (let i = 0; i < st.evN; i++) if (st.events[i].t === EV.hurt) hits++; } });
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it('가두기(불 고리): 고리에 틈이 있고, 가운데 폭발과 고리 사이에 설 자리가 있다', () => {
    const s = emptyRun({ map: 'field', mode: 'hell', numbers: false });
    s.weapons.length = 0;
    const b = spawnBoss(s, BOSS_INDEX.bulgasal, 0, -700)!;
    b.speed = 0;
    b.pat = 1;
    step(s, makeInput());
    const zones = live(s.zones).filter((z) => z.owner === 1);
    const p = BOSSES[BOSS_INDEX.bulgasal].hell;
    const ring = zones.filter((z) => Math.hypot(z.x - s.player.x, z.y - s.player.y) > 100);
    const center = zones.filter((z) => Math.hypot(z.x - s.player.x, z.y - s.player.y) < 1);
    expect(center).toHaveLength(1);
    expect(ring).toHaveLength((p.count ?? 0) - (p.gaps ?? 0));
    // 가운데 폭발은 고리보다 늦게, 고리 안쪽 가장자리보다 작게
    expect(center[0].windup).toBeGreaterThan(ring[0].windup);
    expect(center[0].r + 16 * 2).toBeLessThan((p.spread ?? 0) - (p.r ?? 0));
    // 틈: 고리의 이웃한 지대 사이가 가장 넓은 곳은 내 캐릭터가 지나갈 만큼 벌어져 있다
    const angles = ring.map((z) => Math.atan2(z.y - s.player.y, z.x - s.player.x)).sort((a, b2) => a - b2);
    const gaps = angles.map((a, i) => (i === 0 ? a + Math.PI * 2 - angles[angles.length - 1] : a - angles[i - 1]));
    const widest = Math.max(...gaps) * (p.spread ?? 0) - 2 * (p.r ?? 0);
    expect(widest).toBeGreaterThan(16 * 2 + 40);
  });

  it('힘을 모으는 떨림(bossWinding)은 헬 패턴에서도 보인다', () => {
    const s = emptyRun({ map: 'field', mode: 'hell', numbers: false });
    const b = spawnBoss(s, BOSS_INDEX.bigDokkaebi, 0, -500)!;
    b.pat = 1;
    b.patT = 0.2;
    expect(bossWinding(s, b)).toBe(true);
    b.patT = 3;
    expect(bossWinding(s, b)).toBe(false);
    // 일반 모드의 같은 번호는 돌진이다
    const n = emptyRun({ map: 'field', numbers: false });
    const bn = spawnBoss(n, BOSS_INDEX.bigDokkaebi, 0, -500)!;
    bn.pat = 1;
    expect(bossPatterns(n, bn)[1].kind).toBe('charge');
  });
});

describe('헬 모드의 규칙 (서버 055 와 같다)', () => {
  it('잠금: 그 맵을 4분 모드로 클리어해야 그 맵의 헬이 열린다 (무한 모드와 같은 조건)', () => {
    const p0 = defaultProfile();
    expect(hellOpen(p0, 'field')).toBe(false);
    const p1 = withRecords({ ...p0, unlockedMaps: ['field', 'bamboo'] }, cleared('field'), {});
    expect(hellOpen(p1, 'field')).toBe(true);
    expect(hellOpen(p1, 'bamboo')).toBe(false);
    for (const m of MAPS) expect(hellOpen(p1, m.id)).toBe(endlessOpen(p1, m.id));
    // 헬 기록의 클리어는 잠금 해제에 쓰이지 않는다
    const hellOnly: Record<string, HellRecord> = { bamboo: { time: 240, kills: 9, cleared: true, character: 'rat', at: 1 } };
    const p2 = withRecords({ ...p0, unlockedMaps: ['field', 'bamboo'] }, cleared('field'), {}, hellOnly);
    expect(p2.clearedMaps).toEqual(['field']);
    expect(p2.hellBest).toEqual({ bamboo: { time: 240, kills: 9, cleared: true } });
  });

  it('엽전 상한은 4분 모드의 2배, 그 밖의 검증(시간·클리어·보스·처치·레벨·떡)은 4분 모드와 같다', () => {
    expect(LIMITS.hell_coin_mul).toBe(2);
    for (const m of MAPS) expect(coinCap(m.id, 240, 'hell')).toBe(coinCap(m.id, 240) * 2);
    expect(validRun(run({ time: 100, coins: 1000 }))).toBe(true);
    expect(validRun(run({ time: 100, coins: 1001 }))).toBe(false);
    expect(validRun(run({ mode: 'normal', time: 100, coins: 501 }))).toBe(false);
    expect(validRun(run({ time: 240, bossKills: 4 }))).toBe(false);
    expect(validRun(run({ time: 240, cleared: true, bossKills: 0 }))).toBe(false);
    expect(rejectReason(run({ time: 241 }), 500)).toBe('bad time');
    expect(rejectReason(run({ time: 239, cleared: true }), 500)).toBe('bad time');
    expect(rejectReason(run({ time: 240, cleared: true, bossKills: 3 }), 500)).toBeNull();
    // 2배속 경계: 240초 판은 실제 105초(240 / 2 − 15) 뒤부터
    expect(rejectReason(run({ time: 240 }), 104)).toBe('too early');
    expect(rejectReason(run({ time: 240 }), 105)).toBeNull();
  });

  it('기록은 따로: 헬 판은 4분·무한 기록을 건드리지 않고, 4분·무한 판은 헬 기록을 건드리지 않는다', () => {
    const p0 = withRecords({ ...defaultProfile(), unlockedMaps: ['field', 'bamboo'] }, cleared(), {});
    const a = applyRun(p0, cleared(), run({ time: 200, kills: 2000 }), 10, {}, {});
    expect(a.result).toMatchObject({ valid: true, newRecord: true, coins: 200 });
    expect(a.hell.field).toEqual({ time: 200, kills: 2000, cleared: false, character: 'rat', at: 10 });
    expect(a.records).toEqual(cleared());
    expect(a.endless).toEqual({});
    expect(a.profile.hellBest).toEqual({ field: { time: 200, kills: 2000, cleared: false } });
    expect(a.profile.endlessBest).toEqual({});
    // 4분 판·무한 판은 헬 기록을 그대로 둔다
    const b = applyRun(a.profile, a.records, run({ mode: 'normal', time: 150, kills: 900, coins: 100 }), 20, a.endless, a.hell);
    expect(b.hell).toEqual(a.hell);
    const c = applyRun(b.profile, b.records, run({ mode: 'endless', time: 500, kills: 5000, bossKills: 6, coins: 300 }), 30, b.endless, b.hell);
    expect(c.hell).toEqual(a.hell);
    expect(c.endless.field.time).toBe(500);
    expect(c.profile.hellBest.field.time).toBe(200);
  });

  it('순위: 생존 시간 → 클리어 → 처치 수, 같으면 먼저 달성한 기록이 남는다', () => {
    const p0 = withRecords(defaultProfile(), cleared(), {});
    let st = applyRun(p0, cleared(), run({ time: 240, kills: 3000, bossKills: 2 }), 1, {}, {});
    const next = (o: Partial<RunSummary>, at: number) => (st = applyRun(st.profile, st.records, run(o), at, st.endless, st.hell));
    expect(next({ time: 239, kills: 9000 }, 2).result.newRecord).toBe(false);
    expect(next({ time: 240, kills: 200, bossKills: 3, cleared: true }, 3).result.newRecord).toBe(true);
    expect(next({ time: 240, kills: 9000, bossKills: 2 }, 4).result.newRecord).toBe(false);
    expect(next({ time: 240, kills: 200, bossKills: 3, cleared: true }, 5).result.newRecord).toBe(false);
    expect(next({ time: 240, kills: 201, bossKills: 3, cleared: true }, 6).result.newRecord).toBe(true);
    expect(st.hell.field).toMatchObject({ time: 240, kills: 201, cleared: true, at: 6 });
  });

  it('헬 클리어는 해금에 쓰이지 않는다: 다음 맵 · 돼지 · 토끼·말. 누적 조건(용·뱀·양)과 누적 값·도감은 반영한다', () => {
    const p0 = withRecords(defaultProfile(), cleared(), {});
    const out = applyRun(p0, cleared(), run({ time: 240, kills: 1500, bossKills: 3, cleared: true, cakes: 15 }), 10, {}, {});
    expect(out.result.valid).toBe(true);
    expect(out.result.unlockedMaps).toEqual([]);
    expect(out.profile.unlockedMaps).toEqual(['field']);
    expect(out.result.unlockedCharacters.sort()).toEqual(['dragon', 'sheep', 'snake']);
    expect(out.profile.totals).toMatchObject({ kills: 1500, cakes: 15, bossKills: 3, clears: 1, runs: 1, bestTime: 0 });
    expect(out.profile.codex.bosses).toEqual(['bigDokkaebi']);
    // 같은 결과를 4분 모드로 내면 풀린다
    const n = applyRun(p0, {}, run({ mode: 'normal', time: 240, kills: 1500, bossKills: 3, cleared: true }), 10);
    expect(n.result.unlockedMaps).toEqual(['bamboo']);
    expect(n.result.unlockedCharacters).toEqual(expect.arrayContaining(['rabbit', 'horse', 'pig']));
    expect(n.profile.totals.bestTime).toBe(240);
  });

  it('처치 수 하한·너무 짧은 판은 헬에서도 세지 않는다 (엽전 0, 기록 없음)', () => {
    const p0 = withRecords(defaultProfile(), cleared(), {});
    const low = applyRun(p0, cleared(), run({ time: 240, kills: 119, coins: 500 }), 1, {}, {});
    expect(low.result).toMatchObject({ valid: true, lowKills: true, coins: 0, newRecord: false });
    expect(low.hell).toEqual({});
    const short = applyRun(p0, cleared(), run({ time: 19, kills: 50, coins: 9, bossKills: 0 }), 1, {}, {});
    expect(short.result.coins).toBe(0);
    expect(short.hell).toEqual({});
  });

  it('프로필 정리: hellBest 가 없는 옛 답은 빈 값, 이상한 값은 버린다', () => {
    expect(cleanProfile({ coins: 5 }).hellBest).toEqual({});
    expect(cleanProfile({ hellBest: { field: { time: 240, kills: 7, cleared: true }, nowhere: { time: 1, kills: 1 }, bamboo: null, palace: { time: 'x', kills: -3 } } }).hellBest).toEqual({
      field: { time: 240, kills: 7, cleared: true },
      palace: { time: 0, kills: 0, cleared: false },
    });
    expect(isHell({ mode: 'hell' })).toBe(true);
    expect(isHell({})).toBe(false);
    expect(isHell({ mode: 'endless' })).toBe(false);
  });
});

describe('헬 모드: 테스트 모드의 기기 저장과 서버 호출', () => {
  it('클리어 전에는 시작을 거절하고, 클리어한 뒤에는 그 맵만 시작·종료가 되고 기록이 따로 남는다', async () => {
    let now = 1_000_000;
    const api = createLocalApi(memStore(), () => now);
    await expect(api.start('field', 'rat', 0, 'hell')).rejects.toThrow('hell locked');
    // 4분 모드로 들판 클리어 → 대나무 숲이 열린다
    let id = (await api.start('field', 'rat'))!;
    now += 250_000;
    const first = await api.finish({ ...run({ mode: 'normal', time: 240, kills: 3000, bossKills: 3, cleared: true, coins: 100 }), run: id });
    expect(first!.profile.clearedMaps).toEqual(['field']);
    expect(first!.profile.unlockedMaps).toEqual(['field', 'bamboo']);
    // 대나무 숲은 열렸지만 클리어하지 않았으므로 헬은 잠겨 있다
    await expect(api.start('bamboo', 'rat', 0, 'hell')).rejects.toThrow('hell locked');
    await expect(api.start('palace', 'rat', 0, 'hell')).rejects.toThrow('map locked');
    // 들판 헬: 엽전 2배 상한 (240초 × 5 × 1 × 2 = 2400)
    id = (await api.start('field', 'rat', 0, 'hell'))!;
    now += 250_000;
    // 보고에 적힌 모드는 믿지 않는다: 헬로 시작한 판은 헬 판이다
    const out = await api.finish({ ...run({ mode: 'normal', time: 240, kills: 2500, bossKills: 3, cleared: true, coins: 2400 }), run: id });
    expect(out!.result).toMatchObject({ valid: true, newRecord: true, coins: 2400, unlockedMaps: [] });
    expect(out!.profile.hellBest).toEqual({ field: { time: 240, kills: 2500, cleared: true } });
    expect(out!.profile.coins).toBe(2500);
    expect(out!.profile.unlockedMaps).toEqual(['field', 'bamboo']);
    expect(out!.profile.clearedMaps).toEqual(['field']);
    // 다시 읽어도 남아 있다
    const again = await api.loadProfile();
    expect(again.hellBest.field).toEqual({ time: 240, kills: 2500, cleared: true });
    // 4분 모드로 시작한 판에 헬의 엽전(상한의 2배)을 보내면 비정상: 상한까지만 받는다
    id = (await api.start('field', 'rat'))!;
    now += 250_000;
    const cheat = await api.finish({ ...run({ mode: 'hell', time: 240, kills: 2500, bossKills: 3, coins: 2400 }), run: id });
    expect(cheat!.result).toMatchObject({ valid: false, coins: 1200 });
    // 헬 판에 240초를 넘는 결과는 거절한다
    id = (await api.start('field', 'rat', 0, 'hell'))!;
    now += 700_000;
    await expect(api.finish({ ...run({ time: 300 }), run: id })).rejects.toBeInstanceOf(ApiError);
  });

  it('옛 저장(헬 칸이 없다)도 그대로 읽는다', async () => {
    const store = memStore();
    store.setItem('siasurvival:local', JSON.stringify({ profile: { ...defaultProfile(), unlockedMaps: ['field', 'bamboo'] }, records: {}, endless: {}, runs: {}, endlessRuns: {}, done: {}, seq: 3 }));
    const api = createLocalApi(store, () => 1_000_000);
    const p = await api.loadProfile();
    expect(p.hellBest).toEqual({});
    expect(p.clearedMaps).toEqual(['field']);
    expect(await api.start('field', 'rat', 0, 'hell')).toBeTruthy();
  });

  it('서버 호출: 헬 모드는 p_mode 에 hell 을 붙인다 (4분 모드는 예전과 같은 두 인자)', async () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const sb: RpcClient = {
      rpc: (fn, args) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: '11111111-1111-1111-1111-111111111111', error: null });
      },
    };
    const api = createSupabaseApi(sb, 'u1', memStore());
    await api.start('field', 'rat');
    await api.start('field', 'rat', 0, 'hell');
    await api.start('field', 'rat', 0, 'endless');
    expect(calls.map((c) => c.args)).toEqual([
      { p_map: 'field', p_character: 'rat' },
      { p_map: 'field', p_character: 'rat', p_mode: 'hell' },
      { p_map: 'field', p_character: 'rat', p_mode: 'endless' },
    ]);
    const locked: RpcClient = { rpc: () => Promise.resolve({ data: null, error: { code: 'P0001', message: 'hell locked' } }) };
    await expect(createSupabaseApi(locked, 'u1', memStore()).start('field', 'rat', 0, 'hell')).rejects.toThrow('hell locked');
  });
});

describe("헬 모드의 밸런스 ('보통 실력' 정책)", () => {
  it('서버 상한 안이다: 강화 49 로 돌린 헬 판의 처치·레벨·떡·엽전이 검증을 통과한다 (엽전은 헬 상한)', () => {
    for (const m of MAPS) {
      const r = simulate({ seed: 77, char: 'tiger', map: m.id, mode: 'hell', upgrades: presetUpgrades(49) }, normalPolicy(3));
      expect(r.mode, m.id).toBe('hell');
      expect(validRun(r), m.id).toBe(true);
      expect(r.time, m.id).toBeLessThanOrEqual(RUN_SEC);
      expect(r.kills, m.id).toBeGreaterThanOrEqual(Math.max(0, r.time - LIMITS.kills_min_from) * LIMITS.kills_min_per_sec);
      expect(r.state.tick / TICKS_PER_SEC, m.id).toBeGreaterThan(30);
    }
  }, 120_000);

  it('요괴 그림·종류는 일반과 같다: 헬 판에 나오는 요괴는 그 맵의 등장 표에 있는 것뿐이다', () => {
    const s = createRun({ seed: 5, char: 'ox', map: 'underworld', mode: 'hell', numbers: false });
    s.weapons.length = 0;
    advance(s, 60, { immortal: true });
    const allowed = new Set([...MAPS[3].spawns.map((r) => r.enemy), ...MAPS[3].swarms.map((r) => r.enemy)]);
    ENEMIES.forEach((d, i) => {
      if (s.seenEnemy[i]) expect(allowed.has(d.id), d.id).toBe(true);
    });
    expect((s as State).map.id).toBe('underworld');
  });
});
