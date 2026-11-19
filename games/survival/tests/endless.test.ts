import { describe, expect, it } from 'vitest';
import { BOSS_WARN_SEC, ENDLESS, LIMIT, RUN_SEC, TICKS_PER_SEC } from '../src/data/balance';
import { BOSSES, BOSS_INDEX } from '../src/data/bosses';
import { ENEMY_INDEX } from '../src/data/enemies';
import { MAPS } from '../src/data/maps';
import { presetUpgrades } from '../src/data/upgrades';
import { dmgGrowth, endlessMul, gainCoins, hpGrowth, killEnemy, spawnBoss, spawnEnemy } from '../src/game/core';
import { normalPolicy, simulate } from '../src/game/policy';
import {
  LIMITS, applyRun, bossCap, cleanProfile, coinCap, defaultProfile, endlessCoinCap, endlessOpen, rejectReason, validRun, withRecords,
  type EndlessRecord, type SurvivalRecord,
} from '../src/game/progress';
import { createRun, makeInput, step, summarize, type RunSummary } from '../src/game/sim';
import { EV, type State } from '../src/game/state';
import { ApiError, createLocalApi, createSupabaseApi, type RpcClient } from '../src/net/api';
import { Run } from '../src/run/run';
import type { Store } from '../src/net/pending';
import { advance } from './helpers';

/**
 * 무한 모드: 4분까지는 4분 모드와 완전히 같고, 최종 보스를 잡아도(4분이 지나도) 끝나지 않고 죽을 때까지 이어진다.
 * 4분 뒤로는 요괴가 계속 강해지고, 80초마다 그 맵의 보스가 번갈아 다시 나온다. 기록·랭킹은 4분 모드와 따로다.
 */
const FIELD = MAPS[0];
const run = (o: Partial<RunSummary> = {}): RunSummary => ({
  map: 'field', character: 'rat', mode: 'endless', time: 400, kills: 3000, level: 40, coins: 200, cleared: false, bossKills: 3, cakes: 2,
  codex: { enemies: ['imp'], bosses: [], weapons: ['shuriken'], passives: [] },
  ...o,
});
const memStore = (): Store => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const fingerprint = (s: State) =>
  JSON.stringify({ sum: { ...summarize(s), mode: '' }, tick: s.tick, rng: s.rng, x: s.player.x, y: s.player.y, hp: s.player.hp, xp: s.xp, n: s.enemies.n, phase: s.phase });

describe('무한 모드: 4분까지는 4분 모드와 같다', () => {
  it('같은 시드·같은 조작이면 4분 직전까지 두 모드의 판이 똑같다', () => {
    const play = (mode: 'normal' | 'endless') => {
      const s = createRun({ seed: 77, char: 'tiger', map: 'field', mode, upgrades: presetUpgrades(34), numbers: false });
      const policy = normalPolicy(5);
      const input = makeInput();
      const marks: string[] = [];
      while ((s.phase === 'play' || s.phase === 'levelup') && s.tick < (RUN_SEC - 1) * TICKS_PER_SEC) {
        policy(s, input);
        step(s, input);
        if (s.tick % (30 * TICKS_PER_SEC) === 0 && s.phase === 'play') marks.push(fingerprint(s));
      }
      marks.push(fingerprint(s));
      return marks;
    };
    const a = play('normal');
    expect(a.length).toBeGreaterThan(3);
    expect(play('endless')).toEqual(a);
  }, 60_000);

  it('4분까지는 추가 배율이 1이고, 4분 모드는 언제나 1이다', () => {
    const e = createRun({ seed: 1, char: 'rat', map: 'field', mode: 'endless' });
    const n = createRun({ seed: 1, char: 'rat', map: 'field' });
    expect(e.endless).toBe(true);
    expect(n.endless).toBe(false);
    for (const t of [0, 100, RUN_SEC]) {
      e.time = n.time = t;
      expect(endlessMul(e, ENDLESS.hp)).toBe(1);
      expect(hpGrowth(e)).toBe(hpGrowth(n));
      expect(dmgGrowth(e)).toBe(dmgGrowth(n));
    }
    e.time = n.time = RUN_SEC + 300;
    expect(endlessMul(n, ENDLESS.hp)).toBe(1);
    expect(endlessMul(e, ENDLESS.hp)).toBeGreaterThan(1);
  });
});

describe('무한 모드: 4분 뒤', () => {
  it('최종 보스를 잡아도 끝나지 않고 판이 이어진다. 시계는 4분을 넘겨 계속 올라간다', () => {
    const s = createRun({ seed: 3, char: 'ox', map: 'field', mode: 'endless', numbers: false, startAt: RUN_SEC - 2 });
    s.weapons.length = 0;
    const seen: number[] = [];
    advance(s, 4, { immortal: true, each: (st) => { for (let i = 0; i < st.evN; i++) seen.push(st.events[i].t); } });
    expect(s.finalUid).toBeGreaterThan(0);
    const final = s.enemies.items.slice(0, s.enemies.n).find((e) => e.uid === s.finalUid)!;
    expect(BOSSES[final.boss].id).toBe(FIELD.bosses[2].id);
    const kills = s.kills;
    killEnemy(s, final, true);
    expect(s.phase).toBe('play');
    expect(s.bossKills).toBe(1);
    expect(s.kills).toBe(kills + 1);
    // 보물상자는 4분 모드와 같이 떨어진다
    advance(s, 20, { immortal: true, each: (st) => { for (let i = 0; i < st.evN; i++) seen.push(st.events[i].t); } });
    expect(s.phase).toBe('play');
    expect(seen).not.toContain(EV.clear);
    expect(s.time).toBeGreaterThan(RUN_SEC + 20);
    const sum = summarize(s);
    expect(sum.mode).toBe('endless');
    expect(sum.cleared).toBe(false);
    expect(sum.time).toBe(Math.floor(s.time));
    expect(sum.time).toBeGreaterThan(RUN_SEC);
  }, 60_000);

  it('4분 모드는 예전 그대로: 최종 보스를 잡으면 클리어, 생존 시간은 4분에서 멈춘다', () => {
    const s = createRun({ seed: 3, char: 'ox', map: 'field', numbers: false, startAt: RUN_SEC - 2 });
    s.weapons.length = 0;
    advance(s, 8, { immortal: true });
    expect(summarize(s).time).toBe(RUN_SEC);
    expect(summarize(s).mode).toBe('normal');
    killEnemy(s, s.enemies.items.slice(0, s.enemies.n).find((e) => e.uid === s.finalUid)!, true);
    expect(s.phase).toBe('clear');
    expect(summarize(s).cleared).toBe(true);
  });

  it('요괴 체력·피해·수가 시간이 갈수록 가파르게 는다 (같은 시각의 4분 모드 식보다 크고, 뒤로 갈수록 더 빨리)', () => {
    const s = createRun({ seed: 1, char: 'rat', map: 'field', mode: 'endless' });
    const at = (t: number) => {
      s.time = t;
      return { hp: endlessMul(s, ENDLESS.hp), dmg: endlessMul(s, ENDLESS.dmg), count: endlessMul(s, ENDLESS.count), boss: endlessMul(s, ENDLESS.bossHp) };
    };
    const m5 = at(300);
    const m8 = at(480);
    const m11 = at(660);
    for (const k of ['hp', 'dmg', 'count', 'boss'] as const) {
      expect(m5[k], k).toBeGreaterThan(1);
      expect(m8[k], k).toBeGreaterThan(m5[k]);
      expect(m11[k], k).toBeGreaterThan(m8[k]);
    }
    // 체력·피해는 점점 더 빨리 는다 (2차항)
    expect(m11.hp - m8.hp).toBeGreaterThan(m8.hp - m5.hp);
    expect(m11.dmg - m8.dmg).toBeGreaterThan(m8.dmg - m5.dmg);
    // 실제로 나오는 요괴에 곱해진다
    s.time = 600;
    const e = spawnEnemy(s, ENEMY_INDEX.imp, 500, 0)!;
    const n = createRun({ seed: 1, char: 'rat', map: 'field' });
    n.time = 600;
    const e0 = spawnEnemy(n, ENEMY_INDEX.imp, 500, 0)!;
    expect(e.maxHp / e0.maxHp).toBeCloseTo(at(600).hp, 6);
    expect(e.dmg / e0.dmg).toBeCloseTo(at(600).dmg, 6);
  });

  it('최종 보스 뒤로 80초마다 그 맵의 보스가 번갈아 다시 나온다 (3초 전 경고, 체력 배율이 점점 커진다)', () => {
    const s = createRun({ seed: 9, char: 'ox', map: 'field', mode: 'endless', numbers: false, startAt: RUN_SEC + 5 });
    s.weapons.length = 0;
    const spawned: { boss: string; at: number; hp: number }[] = [];
    const warned: number[] = [];
    advance(s, 4 * ENDLESS.bossEvery, {
      immortal: true,
      each: (st) => {
        for (let i = 0; i < st.evN; i++) {
          const ev = st.events[i];
          if (ev.t === EV.bossWarn) warned.push(st.time);
          if (ev.t === EV.bossSpawn) {
            const e = st.enemies.items.slice(0, st.enemies.n).filter((x) => x.boss === ev.a).sort((a, b) => b.uid - a.uid)[0];
            spawned.push({ boss: BOSSES[ev.a].id, at: st.time, hp: e.maxHp });
            // 잡지 않으면 쌓인다: 다음 보스를 보려고 치운다
            killEnemy(st, e, false);
          }
        }
        // 요괴가 상한까지 쌓이지 않게 가끔 치운다
        if (st.normals > 150) for (let i = 0; i < st.enemies.n; i++) if (st.enemies.items[i].boss < 0) killEnemy(st, st.enemies.items[i], false);
      },
    });
    expect(spawned.map((b) => b.boss)).toEqual([FIELD.bosses[0].id, FIELD.bosses[1].id, FIELD.bosses[2].id, FIELD.bosses[0].id]);
    spawned.forEach((b, i) => expect(b.at).toBeCloseTo(RUN_SEC + (i + 1) * ENDLESS.bossEvery, 1));
    warned.forEach((t, i) => expect(t).toBeCloseTo(RUN_SEC + (i + 1) * ENDLESS.bossEvery - BOSS_WARN_SEC, 1));
    expect(LIMITS.endless_boss_every).toBe(ENDLESS.bossEvery);
    // 같은 보스가 다시 나올 때마다 체력이 많다 (4분 전의 그 보스보다도)
    const base = BOSSES[BOSS_INDEX[FIELD.bosses[0].id]].hp * FIELD.power.boss;
    expect(spawned[0].hp).toBeGreaterThan(base * 1.3);
    expect(spawned[3].hp).toBeGreaterThan(spawned[0].hp * 1.5);
    // 다시 나온 보스는 최종 보스가 아니다: 잡아도 끝나지 않고 보물상자를 준다
    s.time += 0;
    const again = spawnBoss(s, BOSS_INDEX[FIELD.bosses[2].id], 300, 0)!;
    killEnemy(s, again, true);
    expect(s.phase).toBe('play');
  }, 60_000);

  it('떼 이벤트도 40초마다 번갈아 다시 온다', () => {
    const s = createRun({ seed: 9, char: 'ox', map: 'field', mode: 'endless', numbers: false, startAt: RUN_SEC + 1 });
    s.weapons.length = 0;
    const swarms: number[] = [];
    advance(s, 3 * ENDLESS.swarmEvery, {
      immortal: true,
      each: (st) => {
        for (let i = 0; i < st.evN; i++) if (st.events[i].t === EV.swarm) swarms.push(st.time);
        if (st.normals > 100) for (let i = 0; i < st.enemies.n; i++) if (st.enemies.items[i].boss < 0) killEnemy(st, st.enemies.items[i], false);
      },
    });
    expect(swarms.length).toBe(3);
    swarms.forEach((t, i) => expect(t).toBeCloseTo(RUN_SEC + (i + 0.5) * ENDLESS.swarmEvery, 1));
  }, 60_000);

  it('요괴 수 상한(300)과 풀 크기(340)는 그대로 지킨다 (잡지 않고 10분까지 버텨도)', () => {
    const s = createRun({ seed: 5, char: 'ox', map: 'underworld', mode: 'endless', numbers: false, startAt: 400 });
    s.weapons.length = 0;
    let maxNormals = 0;
    let maxAll = 0;
    advance(s, 200, {
      immortal: true,
      each: (st) => {
        maxNormals = Math.max(maxNormals, st.normals);
        maxAll = Math.max(maxAll, st.enemies.n);
      },
    });
    expect(maxNormals).toBeGreaterThan(250);
    // 떼·소환은 상한을 조금 넘겨도 풀 크기는 넘지 못한다
    expect(maxAll).toBeLessThanOrEqual(LIMIT.enemyPool);
    expect(s.enemies.items.length).toBe(LIMIT.enemyPool);
    expect(s.phase).toBe('play');
  }, 60_000);

  it('엽전은 맵별 상한에서 멈춘다 (4분 모드에는 상한이 없다)', () => {
    const e = createRun({ seed: 1, char: 'rat', map: 'field', mode: 'endless' });
    expect(e.coinCap).toBe(FIELD.endlessCoins);
    gainCoins(e, 300);
    expect(e.coins).toBe(300);
    gainCoins(e, 300);
    expect(e.coins).toBe(FIELD.endlessCoins);
    expect(summarize(e).coins).toBe(FIELD.endlessCoins);
    const n = createRun({ seed: 1, char: 'rat', map: 'field' });
    gainCoins(n, 5000);
    expect(n.coins).toBe(5000);
  });

  it('부활은 그대로 한 번 동작하고, 시간 상한(20분)에 닿으면 판이 끝난다', () => {
    const s = createRun({ seed: 2, char: 'ox', map: 'field', mode: 'endless', numbers: false, upgrades: { revive: 1 }, startAt: 300 });
    expect(s.player.revives).toBe(1);
    s.player.hp = 0;
    step(s, makeInput());
    expect(s.phase).toBe('play');
    expect(s.player.revives).toBe(0);
    s.player.hp = 0;
    s.player.inv = 0;
    step(s, makeInput());
    expect(s.phase).toBe('over');
    // 시간 상한: 부활이 남아 있어도 끝난다
    const t = createRun({ seed: 2, char: 'ox', map: 'field', mode: 'endless', numbers: false, upgrades: { revive: 1 } });
    t.map = { ...t.map, spawns: [], swarms: [], bosses: [] };
    t.tick = ENDLESS.maxSec * TICKS_PER_SEC - 2;
    advance(t, 1, { immortal: true });
    expect(t.phase).toBe('over');
    expect(summarize(t).time).toBe(ENDLESS.maxSec);
    expect(LIMITS.endless_max_time).toBe(ENDLESS.maxSec);
    expect(ENDLESS.maxSec).toBe(1200);
  });

  it('2배속은 무한 모드에서도 같은 판을 절반의 실제 시간에 돌린다', () => {
    const drive = (speed: 1 | 2) => {
      const r = new Run({ seed: 99, char: 'tiger', map: 'field', mode: 'endless', startAt: RUN_SEC + 10, numbers: false });
      r.speed = speed;
      let now = 1000;
      r.update(now);
      const until = r.state.tick + 20 * TICKS_PER_SEC;
      r.state.player.hp = r.state.stats.maxHp = 1e9;
      while (r.state.tick < until && !r.over) {
        if (r.state.phase === 'levelup') r.pick(0);
        if (until - r.state.tick < 16) r.speed = 1;
        now += until - r.state.tick < 16 ? (1000 / 60) * 0.7 : 1000 / 60;
        r.update(now);
      }
      return { fp: fingerprint(r.state), real: (now - 1000) / 1000, time: r.state.time };
    };
    const a = drive(1);
    const b = drive(2);
    expect(a.time).toBeGreaterThan(RUN_SEC + 29);
    expect(b.fp).toBe(a.fp);
    expect(b.real).toBeLessThan(a.real * 0.62);
  }, 60_000);

  it("'보통 실력'으로 돌린 무한 모드 판은 끝없이 버티지 못하고, 서버 상한 안이다 (강화 49, 들판)", () => {
    for (let i = 0; i < 2; i++) {
      const r = simulate({ seed: 1 + i * 7919, char: 'tiger', map: 'field', mode: 'endless', upgrades: presetUpgrades(49) }, normalPolicy(31 + i), ENDLESS.maxSec + 60);
      expect(r.state.phase).toBe('over');
      expect(r.time).toBeGreaterThan(RUN_SEC);
      expect(r.time).toBeLessThan(13 * 60);
      expect(r.cleared).toBe(false);
      expect(r.coins).toBeLessThanOrEqual(FIELD.endlessCoins);
      expect(validRun(r)).toBe(true);
      expect(rejectReason(r, r.time)).toBe(null);
    }
  }, 120_000);
});

describe('무한 모드의 규칙 (서버 044 · 045 와 같다)', () => {
  const cleared: Record<string, SurvivalRecord> = { field: { time: 240, kills: 3000, cleared: true, character: 'rat', at: 1 } };

  it('잠금: 그 맵을 4분 모드로 클리어한 기록이 있어야 열린다', () => {
    const p = defaultProfile();
    expect(endlessOpen(p, 'field')).toBe(false);
    // 4분을 버텼지만 클리어하지 못한 기록으로는 안 열린다
    const notYet = applyRun(p, {}, run({ mode: 'normal', time: 240, bossKills: 2 }), 1);
    expect(endlessOpen(notYet.profile, 'field')).toBe(false);
    const done = applyRun(p, {}, run({ mode: 'normal', time: 240, cleared: true }), 1);
    expect(done.profile.clearedMaps).toEqual(['field']);
    expect(endlessOpen(done.profile, 'field')).toBe(true);
    expect(endlessOpen(done.profile, 'bamboo')).toBe(false);
    // 서버가 보낸 프로필에서도 읽는다 (모르는 맵·깨진 값은 버린다)
    const c = cleanProfile({ clearedMaps: ['field', 'nowhere', 3], endlessBest: { field: { time: 431.7, kills: 5200 }, nowhere: { time: 1 }, bamboo: 'x' } });
    expect(c.clearedMaps).toEqual(['field']);
    expect(c.endlessBest).toEqual({ field: { time: 431, kills: 5200 } });
    expect(cleanProfile({}).clearedMaps).toEqual([]);
  });

  it('잠금 완화 (045): 클리어 기록이 없어도 그 맵의 다음 맵이 열려 있으면 열린다. 마지막 맵은 클리어 기록만', () => {
    // 4분제로 바꿀 때 기록이 지워진 사람: 맵은 열려 있는데 기록이 없다
    const two = withRecords({ ...defaultProfile(), unlockedMaps: ['field', 'bamboo'] }, {}, {});
    expect(two.clearedMaps).toEqual(['field']);
    expect(endlessOpen(two, 'field')).toBe(true);
    expect(endlessOpen(two, 'bamboo')).toBe(false);
    const all = withRecords({ ...defaultProfile(), unlockedMaps: MAPS.map((m) => m.id) }, {}, {});
    expect(all.clearedMaps).toEqual(['field', 'bamboo', 'palace']);
    expect(endlessOpen(all, 'underworld')).toBe(false);
    // 황천길은 클리어 기록이 있어야 한다 (클리어하지 못한 기록으로는 안 된다)
    const rec = (c: boolean): Record<string, SurvivalRecord> => ({ underworld: { time: 240, kills: 900, cleared: c, character: 'rat', at: 1 } });
    expect(withRecords(all, rec(false), {}).clearedMaps).toEqual(['field', 'bamboo', 'palace']);
    expect(withRecords(all, rec(true), {}).clearedMaps).toEqual(['field', 'bamboo', 'palace', 'underworld']);
    // 아무것도 열지 않은 사람은 그대로 잠겨 있다
    expect(withRecords(defaultProfile(), {}, {}).clearedMaps).toEqual([]);
  });

  it('받지 않는 보고: 클리어, 20분 초과. 240초를 넘는 시간은 받는다. 2배속 경계는 4분 모드와 같은 식', () => {
    expect(rejectReason(run({ time: 241 }), 9999)).toBe(null);
    expect(rejectReason(run({ time: 241, mode: 'normal' }), 9999)).toBe('bad time');
    expect(rejectReason(run({ time: 241, mode: undefined }), 9999)).toBe('bad time');
    expect(rejectReason(run({ time: LIMITS.endless_max_time }), 9999)).toBe(null);
    expect(rejectReason(run({ time: LIMITS.endless_max_time + 1 }), 9999)).toBe('bad time');
    expect(rejectReason(run({ time: 3600 }), 9999)).toBe('bad time');
    expect(rejectReason(run({ time: 300, cleared: true }), 9999)).toBe('bad result');
    expect(rejectReason(run({ time: 240, cleared: true }), 9999)).toBe('bad result');
    // 600초 판은 실제 285초(600 / 2 − 15) 뒤부터
    expect(rejectReason(run({ time: 600 }), 284.9)).toBe('too early');
    expect(rejectReason(run({ time: 600 }), 285)).toBe(null);
  });

  it('엽전 상한: 시간 비례 상한과 맵별 고정 상한 가운데 작은 쪽', () => {
    expect(MAPS.map((m) => endlessCoinCap(m.id))).toEqual([450, 400, 600, 560]);
    expect(coinCap('field', 600, 'endless')).toBe(450);
    expect(coinCap('field', 600)).toBe(600 * LIMITS.coins_per_sec);
    expect(coinCap('field', 50, 'endless')).toBe(50 * LIMITS.coins_per_sec);
    expect(coinCap('underworld', 900, 'endless')).toBe(560);
    expect(validRun(run({ time: 600, coins: 450 }))).toBe(true);
    expect(validRun(run({ time: 600, coins: 451 }))).toBe(false);
    const out = applyRun(defaultProfile(), cleared, run({ time: 600, coins: 9999 }), 5);
    expect(out.result).toMatchObject({ coins: 450, valid: false, newRecord: false });
    expect(out.profile.coins).toBe(450);
    expect(out.endless.field).toBeUndefined();
  });

  it('보스 처치 상한: 4분까지 셋, 그 뒤로 80초마다 하나씩 더. 처치·레벨·떡 상한은 시간 비례 그대로', () => {
    expect(bossCap(600)).toBe(3);
    expect(bossCap(239, 'endless')).toBe(3);
    expect(bossCap(319, 'endless')).toBe(3);
    expect(bossCap(320, 'endless')).toBe(4);
    expect(bossCap(600, 'endless')).toBe(7);
    expect(validRun(run({ time: 600, bossKills: 7 }))).toBe(true);
    expect(validRun(run({ time: 600, bossKills: 8 }))).toBe(false);
    expect(validRun(run({ time: 240, bossKills: 4, mode: 'normal' }))).toBe(false);
    expect(validRun(run({ time: 600, kills: 100 + 600 * LIMITS.kills_per_sec, level: 5 + 600 * LIMITS.level_per_sec, cakes: 5 + 600 * LIMITS.cakes_per_sec }))).toBe(true);
    expect(validRun(run({ time: 600, kills: 100 + 600 * LIMITS.kills_per_sec + 1 }))).toBe(false);
    expect(validRun(run({ time: 600, level: 5 + 600 * LIMITS.level_per_sec + 1 }))).toBe(false);
    expect(validRun(run({ time: 600, cakes: 5 + 600 * LIMITS.cakes_per_sec + 1 }))).toBe(false);
  });

  it('기록은 4분 모드와 따로: 무한 기록이 4분 기록을 건드리지 않고, 4분 판이 무한 기록을 건드리지 않는다', () => {
    const a = applyRun(defaultProfile(), cleared, run({ time: 431, kills: 5200 }), 7);
    expect(a.result).toMatchObject({ valid: true, newRecord: true, coins: 200 });
    expect(a.records).toEqual(cleared);
    expect(a.endless.field).toEqual({ time: 431, kills: 5200, character: 'rat', at: 7 });
    expect(a.profile.endlessBest).toEqual({ field: { time: 431, kills: 5200 } });
    expect(a.profile.clearedMaps).toEqual(['field']);
    // 4분 모드 판 (더 좋은 처치 수): 4분 기록만 바뀐다
    const b = applyRun(a.profile, a.records, run({ mode: 'normal', time: 240, kills: 4000, cleared: true }), 8, a.endless);
    expect(b.result.newRecord).toBe(true);
    expect(b.records.field).toMatchObject({ time: 240, kills: 4000, cleared: true });
    expect(b.endless).toEqual(a.endless);
  });

  it('순위: 생존 시간 → 처치 수, 같으면 먼저 달성한 기록이 남는다', () => {
    let e: Record<string, EndlessRecord> = {};
    let p = withRecords(defaultProfile(), cleared, e);
    const play = (time: number, kills: number, at: number) => {
      const out = applyRun(p, cleared, run({ time, kills }), at, e);
      p = out.profile;
      e = out.endless;
      return out.result.newRecord;
    };
    expect(play(500, 3000, 1)).toBe(true);
    expect(play(499, 9000, 2)).toBe(false);
    expect(play(500, 3000, 3)).toBe(false);
    expect(e.field.at).toBe(1);
    expect(play(500, 3001, 4)).toBe(true);
    // 기다리기만 한 것처럼 꾸민 기록은 오르지 않는다 (처치 수 하한: (700 − 120) × 1 = 580)
    expect(play(700, 10, 5)).toBe(false);
    expect(play(700, 579, 6)).toBe(false);
    expect(e.field).toMatchObject({ time: 500, kills: 3001, at: 4 });
    expect(play(700, 580, 7)).toBe(true);
    expect(e.field).toMatchObject({ time: 700, kills: 580, at: 7 });
    // 가장 긴 판(20분)에 0킬: 엽전도 기록도 없다
    const idle = applyRun(p, cleared, run({ time: 1200, kills: 0, coins: 450 }), 8, e);
    expect(idle.result).toMatchObject({ coins: 0, valid: true, lowKills: true, newRecord: false });
    expect(idle.endless.field).toMatchObject({ time: 700, kills: 580 });
  });

  it('누적 처치·떡·보스·도감은 반영하고, 시간 조건 해금(토끼·말)·클리어 해금(돼지)·다음 맵 해금·최고 생존 시간은 4분 모드에서만', () => {
    const p0 = withRecords(defaultProfile(), cleared, {});
    const out = applyRun(p0, cleared, run({ time: 400, kills: 900, cakes: 14, bossKills: 0, codex: { enemies: ['imp', 'wisp'], bosses: [], weapons: [], passives: [] } }), 1);
    expect(out.result.unlockedCharacters).toEqual([]);
    expect(out.result.unlockedMaps).toEqual([]);
    expect(out.profile.unlockedMaps).toEqual(['field']);
    expect(out.profile.totals).toMatchObject({ kills: 900, cakes: 14, bestTime: 0, clears: 0, runs: 1 });
    expect(out.profile.codex.enemies).toEqual(['imp', 'wisp']);
    // 누적 조건(뱀 처치 1000 · 양 떡 15)과 보스 처치(용)는 무한 모드에서도 풀린다
    const more = applyRun(out.profile, out.records, run({ time: 400, kills: 300, cakes: 1, bossKills: 1 }), 2, out.endless);
    expect(more.result.unlockedCharacters).toEqual(['dragon', 'snake', 'sheep']);
    // 같은 사람이 4분 모드로 2분을 버티면 토끼가 풀린다
    const normal = applyRun(more.profile, more.records, run({ mode: 'normal', time: 120, kills: 100, bossKills: 0 }), 3, more.endless);
    expect(normal.result.unlockedCharacters).toEqual(['rabbit']);
    expect(normal.profile.totals.bestTime).toBe(120);
  });
});

describe('무한 모드: 테스트 모드의 기기 저장과 서버 호출', () => {
  it('잠금 완화 (045): 다음 맵이 열려 있으면 클리어 기록 없이도 무한 모드를 시작할 수 있다', async () => {
    const store = memStore();
    store.setItem('siasurvival:local', JSON.stringify({ profile: { ...defaultProfile(), unlockedMaps: ['field', 'bamboo'] } }));
    const api = createLocalApi(store, () => 1_000_000);
    expect((await api.loadProfile()).clearedMaps).toEqual(['field']);
    expect(await api.start('field', 'rat', 0, 'endless')).toBeTruthy();
    await expect(api.start('bamboo', 'rat', 0, 'endless')).rejects.toThrow('endless locked');
  });

  it('클리어 전에는 시작을 거절하고, 클리어한 뒤에는 시작·종료가 되고 기록이 따로 남는다', async () => {
    let now = 1_000_000;
    const api = createLocalApi(memStore(), () => now);
    await expect(api.start('field', 'rat', 0, 'endless')).rejects.toThrow('endless locked');
    // 4분 모드로 클리어
    let id = (await api.start('field', 'rat'))!;
    now += 250_000;
    const first = await api.finish({ ...run({ mode: 'normal', time: 240, cleared: true, coins: 100 }), run: id });
    expect(first!.profile.clearedMaps).toEqual(['field']);
    // 무한 모드: 431초 판
    id = (await api.start('field', 'rat', 0, 'endless'))!;
    now += 440_000;
    const out = await api.finish({ ...run({ time: 431, kills: 5200, coins: 300 }), run: id });
    expect(out!.result).toMatchObject({ valid: true, newRecord: true, coins: 300 });
    expect(out!.profile.endlessBest).toEqual({ field: { time: 431, kills: 5200 } });
    expect(out!.profile.coins).toBe(400);
    // 다시 읽어도 남아 있다
    const again = await api.loadProfile();
    expect(again.clearedMaps).toEqual(['field']);
    expect(again.endlessBest.field.time).toBe(431);
    // 요괴를 너무 적게 잡은 판은 기록에 오르지 않는다 (무한 모드 601초에 100킬)
    id = (await api.start('field', 'rat', 0, 'endless'))!;
    now += 700_000;
    const low = await api.finish({ ...run({ time: 601, kills: 100, coins: 300 }), run: id });
    expect(low!.result).toMatchObject({ valid: true, lowKills: true, newRecord: false, coins: 0 });
    expect(low!.profile.endlessBest.field.time).toBe(431);
    expect(low!.profile.coins).toBe(400);
    // 4분 모드로 시작한 판에 240초 넘는 결과를 보내면 거절한다 (모드는 시작할 때 정해진다)
    id = (await api.start('field', 'rat'))!;
    now += 700_000;
    await expect(api.finish({ ...run({ time: 431 }), run: id })).rejects.toBeInstanceOf(ApiError);
    // 무한 모드 판에 클리어를 보내면 거절한다
    id = (await api.start('field', 'rat', 0, 'endless'))!;
    now += 700_000;
    await expect(api.finish({ ...run({ time: 300, cleared: true }), run: id })).rejects.toThrow('bad result');
  });

  it('서버 호출: 4분 모드는 예전과 같은 두 인자로, 무한 모드만 p_mode 를 붙인다', async () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const sb: RpcClient = {
      rpc: (fn, args) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: '11111111-1111-1111-1111-111111111111', error: null });
      },
    };
    const api = createSupabaseApi(sb, 'u1', memStore());
    await api.start('field', 'rat');
    await api.start('field', 'rat', 0, 'normal');
    await api.start('field', 'rat', 0, 'endless');
    expect(calls.map((c) => c.args)).toEqual([
      { p_map: 'field', p_character: 'rat' },
      { p_map: 'field', p_character: 'rat' },
      { p_map: 'field', p_character: 'rat', p_mode: 'endless' },
    ]);
    // 잠긴 무한 모드는 서버가 거절한다 (다시 시도하지 않는다)
    const locked: RpcClient = { rpc: () => Promise.resolve({ data: null, error: { code: 'P0001', message: 'endless locked' } }) };
    await expect(createSupabaseApi(locked, 'u1', memStore()).start('field', 'rat', 0, 'endless')).rejects.toThrow('endless locked');
  });
});
