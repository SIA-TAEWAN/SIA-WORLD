import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { UPGRADES, presetUpgrades, upgradeCost, upgradeSpent } from '../src/data/upgrades';
import { normalPolicy, simulate } from '../src/game/policy';
import {
  LIMITS, applyRun, betterRecord, buyUpgrade, characterPrice, cleanProfile, codexCount, coinCap, defaultProfile, evolutionHints, rejectReason, resetUpgrades,
  unlockCharacter, upgradeCount, upgradeOffer, validRun, type RunReport, type SurvivalProfile, type SurvivalRecord,
} from '../src/game/progress';
import type { RunSummary } from '../src/game/sim';
import { createLocalApi, ApiError } from '../src/net/api';
import { lobbyCount, lobbyOrder, lobbyPlace, LOBBY_MAX } from '../src/net/capacity';
import { PENDING_MAX, flushPending, keepPending, readPending, type SendOutcome, type Store } from '../src/net/pending';

const run = (o: Partial<RunSummary> = {}): RunSummary => ({
  map: 'field', character: 'rat', time: 200, kills: 300, level: 10, coins: 40, cleared: false, bossKills: 0, cakes: 1,
  codex: { enemies: ['imp'], bosses: [], weapons: ['shuriken'], passives: [] },
  ...o,
});
const memStore = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe('엽전과 판 결과', () => {
  it('포기·게임 오버여도 주운 엽전은 받는다', () => {
    const out = applyRun(defaultProfile(), {}, run({ coins: 37 }), 1);
    expect(out.profile.coins).toBe(37);
    expect(out.result).toMatchObject({ coins: 37, valid: true, newRecord: true });
    expect(out.profile.totals).toMatchObject({ kills: 300, cakes: 1, bestTime: 200, runs: 1 });
  });

  it('상한을 넘는 판은 비정상: 엽전은 상한까지만, 기록·누적·해금·도감에는 넣지 않는다', () => {
    const cap = coinCap('field', 300);
    expect(cap).toBe(50 + 300 * 3);
    const cheat = run({ time: 300, coins: 999999, kills: 50 });
    expect(validRun(cheat)).toBe(false);
    const out = applyRun(defaultProfile(), {}, cheat, 1);
    expect(out.profile.coins).toBe(cap);
    expect(out.result).toMatchObject({ valid: false, newRecord: false, unlockedCharacters: [] });
    expect(out.records.field).toBeUndefined();
    expect(out.profile.totals.runs).toBe(0);
    expect(out.profile.codex.enemies).toEqual([]);
    for (const bad of [
      run({ kills: 100 + 200 * 30 + 1 }),
      run({ level: 46 }),
      run({ cakes: 26 }),
      run({ bossKills: 4, time: 600 }),
      run({ bossKills: 1, time: 100 }),
      run({ cleared: true, time: 600, bossKills: 0 }),
    ]) expect(validRun(bad)).toBe(false);
    expect(validRun(run({ kills: 100 + 200 * 30, level: 45, cakes: 25 }))).toBe(true);
  });

  it('맵 엽전 배율만큼 상한이 높다', () => {
    expect(coinCap('underworld', 600)).toBe(Math.floor((50 + 1800) * 2.5));
  });

  it('받지 않는 보고: 10분 초과, 서버가 잰 시간보다 긴 생존 시간, 10분을 채우지 않은 클리어, 7일 지난 판', () => {
    expect(rejectReason(run({ time: 601 }), 9999)).toBe('bad time');
    expect(rejectReason(run({ time: 600 }), 120)).toBe('too early');
    expect(rejectReason(run({ time: 600 }), 595)).toBe(null);
    expect(rejectReason(run({ time: 300, cleared: true }), 400)).toBe('bad time');
    expect(rejectReason(run({ time: 100 }), LIMITS.max_age + 1)).toBe('too late');
    expect(rejectReason(run({ kills: -1 }), 400)).toBe('bad result');
    expect(rejectReason(run({ time: 12.5 }), 400)).toBe('bad result');
    // 일시정지로 오래 걸린 판은 괜찮다
    expect(rejectReason(run({ time: 100 }), 5000)).toBe(null);
  });

  it("'보통 실력'으로 돌린 진짜 판은 모두 상한 안이다 (강화 0과 49)", () => {
    for (const upg of [0, 49]) {
      for (let i = 0; i < 3; i++) {
        const r = simulate({ seed: 50 + i, char: 'rat', map: 'field', upgrades: presetUpgrades(upg) }, normalPolicy(i));
        expect(validRun(r)).toBe(true);
        // 상한은 넉넉하다: 실제 값은 상한의 절반도 안 된다
        expect(r.kills).toBeLessThan((LIMITS.kills_base + r.time * LIMITS.kills_per_sec) / 2);
        expect(r.coins).toBeLessThan(coinCap('field', r.time) / 2);
        expect(r.level).toBeLessThan((LIMITS.level_base + r.time * LIMITS.level_per_sec) / 2);
      }
    }
  }, 120000);
});

describe('최고 기록', () => {
  const old: SurvivalRecord = { time: 300, kills: 500, cleared: false, character: 'rat', at: 1 };
  it('정렬: 생존 시간 → 클리어 → 처치 수, 같으면 먼저 달성한 기록이 남는다', () => {
    expect(betterRecord({ time: 301, kills: 1, cleared: false }, old)).toBe(true);
    expect(betterRecord({ time: 299, kills: 9999, cleared: false }, old)).toBe(false);
    expect(betterRecord({ time: 300, kills: 501, cleared: false }, old)).toBe(true);
    expect(betterRecord({ time: 300, kills: 500, cleared: false }, old)).toBe(false);
    const ten: SurvivalRecord = { ...old, time: 600, kills: 4000 };
    expect(betterRecord({ time: 600, kills: 10, cleared: true }, ten)).toBe(true);
    expect(betterRecord({ time: 600, kills: 9999, cleared: false }, { ...ten, cleared: true })).toBe(false);
  });

  it('맵마다 따로 남는다', () => {
    let s = applyRun({ ...defaultProfile(), unlockedMaps: ['field', 'bamboo'] }, {}, run({ time: 250 }), 10);
    s = applyRun(s.profile, s.records, run({ map: 'bamboo', time: 100 }), 20);
    expect(s.result.newRecord).toBe(true);
    s = applyRun(s.profile, s.records, run({ time: 200 }), 30);
    expect(s.result.newRecord).toBe(false);
    expect(s.records).toMatchObject({ field: { time: 250, at: 10 }, bamboo: { time: 100, at: 20 } });
  });
});

describe('해금', () => {
  const after = (p: SurvivalProfile, r: RunSummary) => applyRun(p, {}, r, 1);

  it('처음에는 쥐·소·호랑이와 들판만 열려 있다', () => {
    expect(defaultProfile()).toMatchObject({ coins: 0, unlockedCharacters: ['rat', 'ox', 'tiger'], unlockedMaps: ['field'] });
  });

  it('토끼 5분 · 용 중간 보스 · 말 8분 · 돼지 10분 클리어', () => {
    expect(after(defaultProfile(), run({ time: 299 })).result.unlockedCharacters).toEqual([]);
    expect(after(defaultProfile(), run({ time: 300 })).result.unlockedCharacters).toEqual(['rabbit']);
    expect(after(defaultProfile(), run({ time: 200, bossKills: 1 })).result.unlockedCharacters).toEqual(['dragon']);
    expect(after(defaultProfile(), run({ time: 480 })).result.unlockedCharacters).toEqual(['rabbit', 'horse']);
    const clear = after(defaultProfile(), run({ time: 600, cleared: true, bossKills: 3, kills: 900, level: 30 }));
    expect(clear.result.unlockedCharacters).toEqual(['rabbit', 'dragon', 'horse', 'pig']);
    // 이미 푼 캐릭터는 다시 알리지 않는다
    expect(after(clear.profile, run({ time: 600, cleared: true, bossKills: 3, kills: 10 })).result.unlockedCharacters).toEqual([]);
  });

  it('뱀 누적 처치 1,000 · 양 누적 떡 50개 (여러 판에 걸쳐)', () => {
    let p = defaultProfile();
    for (let i = 0; i < 3; i++) p = after(p, run({ kills: 300, cakes: 12 })).profile;
    expect(p.unlockedCharacters).not.toContain('snake');
    const a = after(p, run({ kills: 100, cakes: 13 }));
    expect(a.result.unlockedCharacters).toEqual(['snake']);
    expect(a.profile.totals).toMatchObject({ kills: 1000, cakes: 49 });
    expect(after(a.profile, run({ kills: 1, cakes: 1 })).result.unlockedCharacters).toEqual(['sheep']);
  });

  it('맵은 앞 맵을 클리어하면 다음 맵이 열린다', () => {
    const win = (map: string) => run({ map, time: 600, cleared: true, bossKills: 3 });
    let s = after(defaultProfile(), win('field'));
    expect(s.result.unlockedMaps).toEqual(['bamboo']);
    s = after(s.profile, win('field'));
    expect(s.result.unlockedMaps).toEqual([]);
    s = after(s.profile, win('bamboo'));
    s = after(s.profile, win('palace'));
    expect(s.profile.unlockedMaps).toEqual(['field', 'bamboo', 'palace', 'underworld']);
    expect(after(s.profile, win('underworld')).result.unlockedMaps).toEqual([]);
    // 10분을 버텼어도 최종 보스를 못 잡으면 열리지 않는다
    expect(after(defaultProfile(), run({ time: 600 })).result.unlockedMaps).toEqual([]);
  });

  it('원숭이·닭·개는 엽전으로 푼다', () => {
    expect(CHARACTERS.filter((c) => characterPrice(c.id) !== null).map((c) => [c.id, characterPrice(c.id)])).toEqual([['monkey', 500], ['rooster', 1000], ['dog', 1500]]);
    const p = { ...defaultProfile(), coins: 600 };
    const q = unlockCharacter(p, 'monkey');
    expect(q.coins).toBe(100);
    expect(q.unlockedCharacters).toContain('monkey');
    expect(() => unlockCharacter(q, 'monkey')).toThrow('already unlocked');
    expect(() => unlockCharacter(q, 'rooster')).toThrow('not enough coins');
    expect(() => unlockCharacter(p, 'rabbit')).toThrow('bad character');
    // 조건으로는 풀리지 않는다
    expect(after(defaultProfile(), run({ time: 600, cleared: true, bossKills: 3 })).profile.unlockedCharacters).not.toContain('monkey');
  });

  it('도감: 만난 것이 쌓이고, 모르는 id는 버린다', () => {
    let s = after(defaultProfile(), run({ codex: { enemies: ['wisp', 'imp', 'hacker'], bosses: ['bigDokkaebi'], weapons: ['shuriken'], passives: ['fan'] } }));
    s = after(s.profile, run({ codex: { enemies: ['club'], bosses: [], weapons: ['bell'], passives: [] } }));
    expect(s.profile.codex).toEqual({ enemies: ['imp', 'wisp', 'club'], bosses: ['bigDokkaebi'], weapons: ['shuriken', 'bell'], passives: ['fan'] });
  });
});

describe('도감', () => {
  it('진화 조합 힌트는 아는 재료만 보인다', () => {
    const none = evolutionHints(defaultProfile().codex);
    expect(none.length).toBe(3);
    expect(none.every((h) => !h.weaponKnown && !h.passiveKnown && !h.resultKnown)).toBe(true);
    const some = evolutionHints({ enemies: [], bosses: [], weapons: ['shuriken', 'clawEvo'], passives: ['sleeve'] });
    expect(some.map((h) => [h.weapon.id, h.weaponKnown, h.passive.id, h.passiveKnown, h.result.id, h.resultKnown])).toEqual([
      ['shuriken', true, 'fan', false, 'shurikenEvo', false],
      ['pearl', false, 'sleeve', true, 'pearlEvo', false],
      ['claw', false, 'might', false, 'clawEvo', true],
    ]);
  });

  it('모은 수: 처음에는 캐릭터 셋뿐', () => {
    expect(codexCount(defaultProfile())).toEqual({ have: 3, all: 9 + 12 + 15 + 8 + 12 });
    const run2 = applyRun(defaultProfile(), {}, run({ time: 300, codex: { enemies: ['imp', 'wisp'], bosses: ['bigDokkaebi'], weapons: ['shuriken'], passives: [] } }), 1);
    expect(codexCount(run2.profile).have).toBe(3 + 1 + 2 + 1 + 1);
  });

  it('판에서 만난 요괴·보스, 얻은 무기·패시브·진화가 판 결과에 담긴다', () => {
    const r = simulate({ seed: 8, char: 'tiger', map: 'field', upgrades: presetUpgrades(49), startAt: 170 }, normalPolicy(2), 200);
    expect(r.codex.enemies).toContain('imp');
    expect(r.codex.bosses).toEqual(['bigDokkaebi']);
    expect(r.codex.weapons).toContain('claw');
    expect(r.codex.passives.length).toBeGreaterThan(0);
  }, 60000);
});

describe('영구 강화', () => {
  it('비용은 레벨마다 1.5배 (100 → 150 → 225), 엽전이 모자라면 못 산다', () => {
    let p: SurvivalProfile = { ...defaultProfile(), coins: 480 };
    expect(upgradeOffer(p, 'might')).toMatchObject({ cost: 100, level: 0, ok: true });
    p = buyUpgrade(p, 'might');
    p = buyUpgrade(p, 'might');
    p = buyUpgrade(p, 'might');
    expect(p.coins).toBe(480 - 100 - 150 - 225);
    expect(p.upgrades.might).toBe(3);
    expect(upgradeOffer(p, 'might')).toMatchObject({ cost: 340, ok: false, why: 'not enough coins' });
    expect(() => buyUpgrade(p, 'might')).toThrow('not enough coins');
    expect(() => buyUpgrade(p, 'nope')).toThrow('bad upgrade');
  });

  it('최대 레벨을 넘겨 살 수 없다 (전체 49레벨)', () => {
    let p: SurvivalProfile = { ...defaultProfile(), coins: 1e9 };
    for (const u of UPGRADES) for (let i = 0; i < u.max; i++) p = buyUpgrade(p, u.id);
    expect(upgradeCount(p.upgrades)).toBe(49);
    for (const u of UPGRADES) expect(() => buyUpgrade(p, u.id)).toThrow('max level');
    expect(1e9 - p.coins).toBe(upgradeSpent(p.upgrades));
  });

  it('초기화하면 쓴 엽전을 전액 돌려받는다', () => {
    let p: SurvivalProfile = { ...defaultProfile(), coins: 5000 };
    for (const id of ['might', 'hp', 'armor', 'might', 'revive', 'reroll']) p = buyUpgrade(p, id);
    expect(p.upgrades).toEqual({ might: 2, hp: 1, armor: 1, revive: 1, reroll: 1 });
    expect(p.coins).toBe(5000 - (100 + 150 + 100 + 100 + 120 + 300));
    expect(5000 - p.coins).toBe(upgradeSpent(p.upgrades));
    const r = resetUpgrades(p);
    expect(r.coins).toBe(5000);
    expect(upgradeCount(r.upgrades)).toBe(0);
    // 방어는 레벨마다 2.2배로 오른다 (나머지는 1.5배)
    expect([0, 1, 2, 3, 4].map((lv) => upgradeCost('armor', lv))).toEqual([100, 220, 485, 1065, 2345]);
  });

  it('읽어 온 프로필은 믿을 수 있는 모양으로 고친다', () => {
    const p = cleanProfile({ coins: -5, upgrades: { might: 99, hack: 3 }, unlockedCharacters: ['pig', 'cat'], unlockedMaps: null, codex: { enemies: 'x' } });
    expect(p.coins).toBe(0);
    expect(p.upgrades).toEqual({ might: 10 });
    expect(p.unlockedCharacters).toEqual(['rat', 'ox', 'tiger', 'pig']);
    expect(p.unlockedMaps).toEqual(['field']);
    expect(p.codex.enemies).toEqual([]);
    expect(cleanProfile(null)).toEqual(defaultProfile());
  });
});

describe('임시 보관과 재전송', () => {
  const report = (id: string): RunReport => ({ ...run(), run: id });

  it('못 올린 결과를 보관했다가, 다시 보내 받아들여지면 지운다', async () => {
    const st = memStore();
    keepPending(st, 'u1', report('a'));
    keepPending(st, 'u1', report('b'));
    keepPending(st, 'u1', report('a')); // 같은 판은 한 번만
    expect(readPending(st, 'u1').map((r) => r.run)).toEqual(['b', 'a']);
    expect(readPending(st, 'u2')).toEqual([]);
    const seen: string[] = [];
    const sent = await flushPending(st, 'u1', async (r) => {
      seen.push(r.run);
      return 'ok';
    });
    expect(sent).toBe(2);
    expect(seen).toEqual(['b', 'a']);
    expect(readPending(st, 'u1')).toEqual([]);
    expect(st.data.size).toBe(0);
  });

  it('통신 실패면 남겨 두고, 서버가 거절한 것은 버린다', async () => {
    const st = memStore();
    for (const id of ['a', 'b', 'c']) keepPending(st, 'u1', report(id));
    const answer: Record<string, SendOutcome> = { a: 'failed', b: 'rejected', c: 'ok' };
    expect(await flushPending(st, 'u1', async (r) => answer[r.run])).toBe(1);
    expect(readPending(st, 'u1').map((r) => r.run)).toEqual(['a']);
    // 보내다가 예외가 나도 남는다
    expect(await flushPending(st, 'u1', async () => Promise.reject(new Error('offline')))).toBe(0);
    expect(readPending(st, 'u1').length).toBe(1);
  });

  it('보관은 최근 5판까지, 깨진 값은 무시한다', () => {
    const st = memStore();
    for (let i = 0; i < 8; i++) keepPending(st, 'u1', report(`r${i}`));
    expect(readPending(st, 'u1').map((r) => r.run)).toEqual(['r3', 'r4', 'r5', 'r6', 'r7']);
    expect(PENDING_MAX).toBe(5);
    st.setItem('siasurvival:pending:u1', '{broken');
    expect(readPending(st, 'u1')).toEqual([]);
    st.setItem('siasurvival:pending:u1', JSON.stringify([{ run: 1 }, report('ok')]));
    expect(readPending(st, 'u1').map((r) => r.run)).toEqual(['ok']);
  });
});

describe('테스트 모드의 기기 저장 프로필 (서버와 같은 규칙)', () => {
  it('시작 → 끝 → 엽전·해금이 저장되고, 강화를 사고 되돌릴 수 있다', async () => {
    let t = 1_000_000;
    const st = memStore();
    const api = createLocalApi(st, () => t);
    expect((await api.loadProfile()).coins).toBe(0);
    await expect(api.start('bamboo', 'rat')).rejects.toThrow('map locked');
    await expect(api.start('field', 'pig')).rejects.toThrow('character locked');
    const id = (await api.start('field', 'rat'))!;
    // 10분을 2분 만에 끝낼 수 없다
    t += 120_000;
    await expect(api.finish({ ...run({ time: 600 }), run: id })).rejects.toBeInstanceOf(ApiError);
    t += 200_000;
    const out = (await api.finish({ ...run({ time: 310, coins: 120 }), run: id }))!;
    expect(out.result).toMatchObject({ coins: 120, newRecord: true, unlockedCharacters: ['rabbit'] });
    // 한 판은 한 번만
    await expect(api.finish({ ...run({ time: 310, coins: 120 }), run: id })).rejects.toThrow('no run');
    const bought = await api.buyUpgrade('might');
    expect(bought).toMatchObject({ coins: 20, upgrades: { might: 1 } });
    await expect(api.buyUpgrade('might')).rejects.toThrow('not enough coins');
    expect((await api.resetUpgrades()).coins).toBe(120);
    // 다시 열어도 그대로 (기기에 저장)
    const again = createLocalApi(st, () => t);
    expect(await again.loadProfile()).toMatchObject({ coins: 120, unlockedCharacters: ['rat', 'ox', 'tiger', 'rabbit'] });
    // 새 판을 시작하면 끝나지 않은 이전 판은 버려진다
    const a = (await again.start('field', 'rabbit'))!;
    const b = (await again.start('field', 'rabbit'))!;
    t += 50_000;
    await expect(again.finish({ ...run({ time: 30 }), run: a })).rejects.toThrow('no run');
    expect((await again.finish({ ...run({ time: 30, coins: 5 }), run: b }))!.profile.coins).toBe(125);
  });
});

describe('접속 인원 (정원 30명)', () => {
  const m = (key: string, seen: unknown) => ({ key, meta: { seen } });
  it('같은 계정은 한 번만 세고, 먼저 온 순서로 줄을 선다', () => {
    const list = [m('b', 200), m('a', 300), m('a', 100), m('c', 200), m('x', 'bad')];
    expect(lobbyOrder(list)).toEqual(['a', 'b', 'c', 'x']);
    expect(lobbyCount(list)).toBe(4);
    expect(lobbyPlace(list, 'c')).toBe(2);
    expect(lobbyPlace(list, 'nobody')).toBe(4);
  });
  it('31번째로 온 사람은 정원 밖이다', () => {
    const list = Array.from({ length: 31 }, (_, i) => m(`u${String(i).padStart(2, '0')}`, 1000 + i));
    expect(lobbyPlace(list, 'u29')).toBeLessThan(LOBBY_MAX);
    expect(lobbyPlace(list, 'u30')).toBeGreaterThanOrEqual(LOBBY_MAX);
  });
});
