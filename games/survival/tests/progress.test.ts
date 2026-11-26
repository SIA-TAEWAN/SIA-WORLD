import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { UPGRADES, presetUpgrades, upgradeCost, upgradeSpent } from '../src/data/upgrades';
import { DEVICE_CODEX } from '../src/data/weapons';
import { readMade, rememberMade } from '../src/net/made';
import { TICKS_PER_SEC } from '../src/data/balance';
import { idlePolicy, normalPolicy, simulate, type Policy } from '../src/game/policy';
import {
  LIMITS, applyRun, betterRecord, buyUpgrade, characterOpen, characterPrice, cleanProfile, codexCount, coinCap, defaultProfile, enoughKills, evolutionHints, killFloor, knownPassives, knownWeapons, rejectReason, resetUpgrades,
  unlockCharacter, upgradeCount, upgradeOffer, validRun, type RunReport, type SurvivalProfile, type SurvivalRecord,
} from '../src/game/progress';
import { createRun, makeInput, step, summarize, type RunSummary } from '../src/game/sim';
import { createLocalApi, createSupabaseApi, ApiError, type RpcClient, type RunLocks } from '../src/net/api';
import { SPEEDS } from '../src/run/run';
import { lobbyCount, lobbyOrder, lobbyPlace, LOBBY_MAX } from '../src/net/capacity';
import { PARTIAL_LIVE_MS, PENDING_MAX, flushPending, keepPending, mayBeLive, readPending, type SendOutcome, type Store } from '../src/net/pending';

const run = (o: Partial<RunSummary> = {}): RunSummary => ({
  map: 'field', character: 'rat', time: 120, kills: 300, level: 10, coins: 40, cleared: false, bossKills: 0, cakes: 1,
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
    expect(out.profile.totals).toMatchObject({ kills: 300, cakes: 1, bestTime: 120, runs: 1 });
  });

  it('상한을 넘는 판은 비정상: 엽전은 상한까지만, 기록·누적·해금·도감에는 넣지 않는다', () => {
    const cap = coinCap('field', 240);
    expect(cap).toBe(240 * LIMITS.coins_per_sec);
    const cheat = run({ time: 240, coins: 999999, kills: 500 });
    expect(validRun(cheat)).toBe(false);
    const out = applyRun(defaultProfile(), {}, cheat, 1);
    expect(out.profile.coins).toBe(cap);
    expect(out.result).toMatchObject({ valid: false, newRecord: false, unlockedCharacters: [] });
    expect(out.records.field).toBeUndefined();
    expect(out.profile.totals.runs).toBe(0);
    expect(out.profile.codex.enemies).toEqual([]);
    for (const bad of [
      run({ kills: 100 + 120 * LIMITS.kills_per_sec + 1 }),
      run({ level: 5 + 120 * LIMITS.level_per_sec + 1 }),
      run({ cakes: 5 + 120 * LIMITS.cakes_per_sec + 1 }),
      run({ bossKills: 4, time: 240 }),
      run({ bossKills: 1, time: 50 }),
      run({ cleared: true, time: 240, bossKills: 0 }),
    ]) expect(validRun(bad)).toBe(false);
    expect(validRun(run({ kills: 100 + 120 * LIMITS.kills_per_sec, level: 5 + 120 * LIMITS.level_per_sec, cakes: 5 + 120 * LIMITS.cakes_per_sec }))).toBe(true);
  });

  it('맵 엽전 배율만큼 상한이 높다', () => {
    expect(coinCap('underworld', 240)).toBe(Math.floor(240 * LIMITS.coins_per_sec * 2.5));
  });

  it('받지 않는 보고: 4분 초과, 서버가 잰 시간보다 긴 생존 시간, 4분을 채우지 않은 클리어, 7일 지난 판', () => {
    expect(rejectReason(run({ time: 241 }), 9999)).toBe('bad time');
    // 2배속(LIMITS.max_speed)이면 4분 판이 실제 2분(120초)에 끝난다: 그보다 여유 15초 넘게 이르면 받지 않는다
    // (여유 15초: 판 시작 알림이 그만큼 늦게 닿아도 받는다. 045)
    expect(LIMITS.max_speed).toBe(Math.max(...SPEEDS));
    expect(LIMITS.time_slack).toBe(15);
    expect(rejectReason(run({ time: 240 }), 100)).toBe('too early');
    expect(rejectReason(run({ time: 240 }), 104.9)).toBe('too early');
    expect(rejectReason(run({ time: 240 }), 105)).toBe(null);
    expect(rejectReason(run({ time: 240 }), 120)).toBe(null);
    expect(rejectReason(run({ time: 240 }), 235)).toBe(null);
    expect(rejectReason(run({ time: 60 }), 14)).toBe('too early');
    expect(rejectReason(run({ time: 60 }), 15)).toBe(null);
    expect(rejectReason(run({ time: 150, cleared: true }), 400)).toBe('bad time');
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
        // 처치 수 하한도 넉넉하다: 실제 값은 하한의 두 배가 넘는다
        expect(enoughKills(r)).toBe(true);
        expect(r.kills).toBeGreaterThan(killFloor(r.time) * 2);
      }
    }
  }, 120000);

  it('처치 수 하한 (045): 요괴를 너무 적게 잡은 판은 정상 기록이어도 세지 않는다 (엽전 0, 기록·클리어·해금·누적·도감 없음)', () => {
    // 하한 = (생존 시간 − 120) × 1. 처음 2분은 하한이 없다
    expect([LIMITS.kills_min_from, LIMITS.kills_min_per_sec]).toEqual([120, 1]);
    expect([0, 60, 120, 121, 180, 240, 1200].map(killFloor)).toEqual([0, 0, 0, 1, 60, 120, 1080]);
    expect(enoughKills({ time: 100, kills: 0 })).toBe(true);
    expect(enoughKills({ time: 240, kills: 119 })).toBe(false);
    expect(enoughKills({ time: 240, kills: 120 })).toBe(true);
    // 0킬로 4분을 "버티고" 클리어했다는 보고: valid 는 그대로지만 아무것도 받지 못한다
    const idle = run({ time: 240, kills: 0, coins: 1200, cleared: true, bossKills: 1, cakes: 9, codex: { enemies: ['imp', 'wisp'], bosses: [], weapons: [], passives: [] } });
    expect(validRun(idle)).toBe(true);
    const p0 = defaultProfile();
    const out = applyRun(p0, {}, idle, 1);
    expect(out.result).toEqual({ coins: 0, valid: true, lowKills: true, newRecord: false, unlockedCharacters: [], unlockedMaps: [] });
    expect(out.profile).toEqual(p0);
    expect(out.records).toEqual({});
    // 하한에 딱 맞으면 예전처럼 전부 받는다
    const ok = applyRun(p0, {}, { ...idle, kills: 120 }, 1);
    expect(ok.result).toMatchObject({ coins: 1200, valid: true, lowKills: false, newRecord: true, unlockedMaps: ['bamboo'] });
    expect(ok.result.unlockedCharacters).toContain('pig');
    expect(ok.profile.clearedMaps).toEqual(['field']);
    expect(ok.profile.totals).toMatchObject({ kills: 120, cakes: 9, clears: 1, runs: 1 });
    // 2분까지는 못 잡았어도 센다 (초반에 죽은 판)
    const early = applyRun(p0, {}, run({ time: 100, kills: 0, coins: 30 }), 1);
    expect(early.result).toMatchObject({ coins: 30, lowKills: false, newRecord: true });
    // 비정상 판은 그대로 비정상이다 (하한과는 따로)
    expect(applyRun(p0, {}, run({ time: 240, kills: 0, coins: 999999 }), 1).result).toMatchObject({ coins: 0, valid: false, lowKills: true });
  });

  it("처치 수 하한은 진짜 판을 건드리지 않는다: 가만히 서 있거나 한쪽으로만 달려도, 판 도중 어느 때 그만둬도 (황천길 · 강화 0과 49)", () => {
    for (const upg of [0, 49]) {
      for (const [k, policy] of [normalPolicy(7), idlePolicy, ((s, input) => { input.mx = 1; input.my = 0; input.reroll = false; input.pick = s.phase === 'levelup' ? 0 : -1; }) as Policy].entries()) {
        const s = createRun({ seed: 900 + k + upg, char: 'ox', map: 'underworld', upgrades: presetUpgrades(upg), numbers: false });
        const input = makeInput();
        let worst = Infinity;
        while ((s.phase === 'play' || s.phase === 'levelup') && s.tick < 480 * TICKS_PER_SEC) {
          policy(s, input);
          step(s, input);
          // 지금 그만두면 보고될 값
          if (s.tick % TICKS_PER_SEC === 0) worst = Math.min(worst, s.kills - killFloor(Math.min(240, Math.floor(s.time))) * 2);
        }
        expect(enoughKills(summarize(s))).toBe(true);
        // 어느 순간에도 하한의 두 배보다 많이 잡았다
        expect(worst).toBeGreaterThanOrEqual(0);
      }
    }
  }, 120000);
});

describe('최고 기록', () => {
  const old: SurvivalRecord = { time: 100, kills: 500, cleared: false, character: 'rat', at: 1 };
  it('정렬: 생존 시간 → 클리어 → 처치 수, 같으면 먼저 달성한 기록이 남는다', () => {
    expect(betterRecord({ time: 101, kills: 1, cleared: false }, old)).toBe(true);
    expect(betterRecord({ time: 99, kills: 9999, cleared: false }, old)).toBe(false);
    expect(betterRecord({ time: 100, kills: 501, cleared: false }, old)).toBe(true);
    expect(betterRecord({ time: 100, kills: 500, cleared: false }, old)).toBe(false);
    const full: SurvivalRecord = { ...old, time: 240, kills: 3000 };
    expect(betterRecord({ time: 240, kills: 10, cleared: true }, full)).toBe(true);
    expect(betterRecord({ time: 240, kills: 9999, cleared: false }, { ...full, cleared: true })).toBe(false);
  });

  it('맵마다 따로 남는다', () => {
    let s = applyRun({ ...defaultProfile(), unlockedMaps: ['field', 'bamboo'] }, {}, run({ time: 170 }), 10);
    s = applyRun(s.profile, s.records, run({ map: 'bamboo', time: 100 }), 20);
    expect(s.result.newRecord).toBe(true);
    s = applyRun(s.profile, s.records, run({ time: 130 }), 30);
    expect(s.result.newRecord).toBe(false);
    expect(s.records).toMatchObject({ field: { time: 170, at: 10 }, bamboo: { time: 100, at: 20 } });
  });
});

describe('해금', () => {
  const after = (p: SurvivalProfile, r: RunSummary) => applyRun(p, {}, r, 1);

  it('처음에는 쥐·소·호랑이와 들판만 열려 있다', () => {
    expect(defaultProfile()).toMatchObject({ coins: 0, unlockedCharacters: ['rat', 'ox', 'tiger'], unlockedMaps: ['field'] });
  });

  it('토끼 2분 · 용 중간 보스 · 말 3분 20초 · 돼지 4분 클리어', () => {
    expect(after(defaultProfile(), run({ time: 119 })).result.unlockedCharacters).toEqual([]);
    expect(after(defaultProfile(), run({ time: 120 })).result.unlockedCharacters).toEqual(['rabbit']);
    expect(after(defaultProfile(), run({ time: 199 })).result.unlockedCharacters).toEqual(['rabbit']);
    expect(after(defaultProfile(), run({ time: 85, bossKills: 1 })).result.unlockedCharacters).toEqual(['dragon']);
    expect(after(defaultProfile(), run({ time: 200 })).result.unlockedCharacters).toEqual(['rabbit', 'horse']);
    const clear = after(defaultProfile(), run({ time: 240, cleared: true, bossKills: 3, kills: 900, level: 30 }));
    expect(clear.result.unlockedCharacters).toEqual(['rabbit', 'dragon', 'horse', 'pig']);
    // 이미 푼 캐릭터는 다시 알리지 않는다
    expect(after(clear.profile, run({ time: 240, cleared: true, bossKills: 3, kills: 10 })).result.unlockedCharacters).toEqual([]);
  });

  it('뱀 누적 처치 1,000 · 양 누적 떡 15개 (여러 판에 걸쳐)', () => {
    let p = defaultProfile();
    for (let i = 0; i < 3; i++) p = after(p, run({ time: 60, kills: 300, cakes: 4 })).profile;
    expect(p.unlockedCharacters).not.toContain('snake');
    const a = after(p, run({ time: 60, kills: 100, cakes: 2 }));
    expect(a.result.unlockedCharacters).toEqual(['snake']);
    expect(a.profile.totals).toMatchObject({ kills: 1000, cakes: 14 });
    expect(after(a.profile, run({ time: 60, kills: 1, cakes: 1 })).result.unlockedCharacters).toEqual(['sheep']);
  });

  it('맵은 앞 맵을 클리어하면 다음 맵이 열린다', () => {
    const win = (map: string) => run({ map, time: 240, cleared: true, bossKills: 3 });
    let s = after(defaultProfile(), win('field'));
    expect(s.result.unlockedMaps).toEqual(['bamboo']);
    s = after(s.profile, win('field'));
    expect(s.result.unlockedMaps).toEqual([]);
    s = after(s.profile, win('bamboo'));
    s = after(s.profile, win('palace'));
    expect(s.profile.unlockedMaps).toEqual(['field', 'bamboo', 'palace', 'underworld']);
    expect(after(s.profile, win('underworld')).result.unlockedMaps).toEqual([]);
    // 4분을 버텼어도 최종 보스를 못 잡으면 열리지 않는다
    expect(after(defaultProfile(), run({ time: 240 })).result.unlockedMaps).toEqual([]);
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
    expect(after(defaultProfile(), run({ time: 240, cleared: true, bossKills: 3 })).profile.unlockedCharacters).not.toContain('monkey');
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
    expect(none.length).toBe(7);
    expect(none.every((h) => !h.weaponKnown && !h.passiveKnown && !h.resultKnown)).toBe(true);
    const some = evolutionHints({ enemies: [], bosses: [], weapons: ['shuriken', 'clawEvo'], passives: ['sleeve'] });
    expect(some.slice(0, 3).map((h) => [h.weapon.id, h.weaponKnown, h.passive.id, h.passiveKnown, h.result.id, h.resultKnown])).toEqual([
      ['shuriken', true, 'fan', false, 'shurikenEvo', false],
      ['pearl', false, 'sleeve', true, 'pearlEvo', false],
      ['claw', false, 'might', false, 'clawEvo', true],
    ]);
    expect(some.slice(3).map((h) => `${h.weapon.id}+${h.passive.id}=${h.result.id}`)).toEqual(['bell+shell=bellEvo', 'mooncake+ginseng=mooncakeEvo', 'hoof+wind=hoofEvo', 'piggy+knot=piggyEvo']);
  });

  it('진화 2차 4종도 서버 도감에 적힌다 (093): 기기에만 남는 무기는 없다', () => {
    expect(DEVICE_CODEX).toEqual([]);
    // 판 결과에 담겨 오면 프로필 도감에 넣는다 (서버와 같은 규칙 · 같은 순서)
    const s = applyRun(defaultProfile(), {}, run({ time: 130, codex: { enemies: [], bosses: [], weapons: ['hoofEvo', 'hoof', 'clawEvo', 'piggyEvo', 'nope'], passives: ['wind'] } }), 1);
    expect(s.profile.codex.weapons).toEqual(['clawEvo', 'hoof', 'hoofEvo', 'piggyEvo']);
    const hint = (id: string) => evolutionHints(s.profile.codex).find((h) => h.result.id === id)!;
    expect([hint('hoofEvo').weaponKnown, hint('hoofEvo').passiveKnown, hint('hoofEvo').resultKnown]).toEqual([true, true, true]);
    // 아직 만들어 보지 않은 진화 무기는 가려져 있다
    expect(hint('bellEvo').resultKnown).toBe(false);
    // 기기 기록(made)을 넘기면 서버 도감에 더해 본다. 이미 있는 것은 두 번 세지 않는다
    expect(knownWeapons(s.profile.codex, ['bellEvo', 'nope'])).toEqual(['clawEvo', 'hoof', 'bellEvo', 'hoofEvo', 'piggyEvo']);
    expect(codexCount(s.profile, [], ['bellEvo']).have).toBe(codexCount(s.profile).have + 1);
    expect(codexCount(s.profile, [], ['clawEvo']).have).toBe(codexCount(s.profile).have);
  });

  it('기기 기록 (net/made.ts): 서버 목록에 없는 무기만 기억한다 — 지금은 그런 무기가 없어 아무것도 적지 않는다', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(readMade(store)).toEqual([]);
    expect(rememberMade('clawEvo', store)).toEqual([]);
    // 서버 도감에 들어간 진화 4종은 기기에 적지 않는다 (예전에 적힌 값이 있어도 읽지 않는다)
    expect(rememberMade('piggyEvo', store)).toEqual([]);
    expect(m.size).toBe(0);
    store.setItem('siasurvival:made', '["bellEvo","piggyEvo"]');
    expect(readMade(store)).toEqual([]);
    store.setItem('siasurvival:made', '{"x":1}');
    expect(readMade(store)).toEqual([]);
    store.setItem('siasurvival:made', 'oops');
    expect(readMade(store)).toEqual([]);
    expect(readMade(null)).toEqual([]);
    expect(rememberMade('hoofEvo', null)).toEqual([]);
  });

  it('모은 수: 처음에는 캐릭터 셋뿐', () => {
    // 캐릭터: 쥐·소·호랑이 (고양이는 이 게임에서 시아코인으로 열었을 때만 센다)
    // 패시브 12종 모두 서버 도감 목록에 있어(110) 판에서 얻어야 채워진다
    expect(codexCount(defaultProfile())).toEqual({ have: 3, all: 9 + 12 + 19 + 12 + 13 });
    expect(knownPassives(defaultProfile().codex)).toEqual([]);
    expect(codexCount(defaultProfile(), ['cat']).have).toBe(4);
    const run2 = applyRun(defaultProfile(), {}, run({ time: 130, codex: { enemies: ['imp', 'wisp'], bosses: ['bigDokkaebi'], weapons: ['shuriken'], passives: [] } }), 1);
    expect(codexCount(run2.profile).have).toBe(3 + 1 + 2 + 1 + 1);
    // 세트용 4종도 얻으면 서버처럼 적힌다
    const run3 = applyRun(defaultProfile(), {}, run({ time: 130, codex: { enemies: [], bosses: [], weapons: [], passives: ['fan', 'venom', 'nope'] } }), 1);
    expect(run3.profile.codex.passives).toEqual(['fan', 'venom']);
    expect(knownPassives(run3.profile.codex)).toEqual(['fan', 'venom']);
  });


  it('고양이 잠금: 이 게임에서 연 목록(owned)으로만 열린다. 시아서바이벌의 해금 목록·엽전으로는 열리지 않는다', () => {
    const p = defaultProfile();
    expect(characterOpen(p, 'cat', [])).toBe(false);
    expect(characterOpen(p, 'cat', ['cat'])).toBe(true);
    // 해금 목록에 cat 이 들어 있어도 (옛 기록·조작) 열린 것으로 보지 않는다
    expect(characterOpen({ ...p, unlockedCharacters: [...p.unlockedCharacters, 'cat'] }, 'cat', [])).toBe(false);
    // 십이지는 owned 와 상관없다
    expect(characterOpen(p, 'tiger', [])).toBe(true);
    expect(characterOpen(p, 'rabbit', ['cat', 'rabbit'])).toBe(false);
    expect(characterPrice('cat')).toBeNull();
    expect(() => unlockCharacter(p, 'cat')).toThrow('bad character');
  });

  it('판에서 만난 요괴·보스, 얻은 무기·패시브·진화가 판 결과에 담긴다', () => {
    const r = simulate({ seed: 8, char: 'tiger', map: 'field', upgrades: presetUpgrades(49), startAt: 55 }, normalPolicy(2), 85);
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
    // 4분을 1분 만에 끝낼 수 없다
    t += 60_000;
    await expect(api.finish({ ...run({ time: 240 }), run: id })).rejects.toThrow('too early');
    t += 200_000;
    const out = (await api.finish({ ...run({ time: 130, coins: 120 }), run: id }))!;
    expect(out.result).toMatchObject({ coins: 120, newRecord: true, unlockedCharacters: ['rabbit'] });
    // 한 판은 한 번만
    await expect(api.finish({ ...run({ time: 130, coins: 120 }), run: id })).rejects.toThrow('already finished');
    await expect(api.finish({ ...run(), run: 'local-999' })).rejects.toThrow('no run');
    const bought = await api.buyUpgrade('might');
    expect(bought).toMatchObject({ coins: 20, upgrades: { might: 1 } });
    await expect(api.buyUpgrade('might')).rejects.toThrow('not enough coins');
    expect((await api.resetUpgrades()).coins).toBe(120);
    // 다시 열어도 그대로 (기기에 저장)
    const again = createLocalApi(st, () => t);
    expect(await again.loadProfile()).toMatchObject({ coins: 120, unlockedCharacters: ['rat', 'ox', 'tiger', 'rabbit'] });
  });

  it('2배속 (서버 042·043 과 같다): 4분 판을 2분에 끝내도 받고, 연달아 두 판도 겹치지 않는다. 동시에 연 판은 하나만', async () => {
    let t = 9_000_000;
    const api = createLocalApi(memStore(), () => t);
    const a = (await api.start('field', 'rat'))!;
    t += 100_000;
    await expect(api.finish({ ...run({ time: 240 }), run: a })).rejects.toThrow('too early');
    t += 20_000;
    expect((await api.finish({ ...run({ time: 240, coins: 10 }), run: a }))!.profile.coins).toBe(10);
    // 끝나자마자 다음 판, 또 2분 만에
    const b = (await api.start('field', 'rat'))!;
    t += 120_000;
    expect((await api.finish({ ...run({ time: 240, coins: 10 }), run: b }))!.profile.coins).toBe(20);
    // 판 둘을 같이 열어 두고 2분 뒤에 한꺼번에 보고하면 두 번째는 거절
    const c = (await api.start('field', 'rat'))!;
    const d = (await api.start('field', 'rat'))!;
    t += 120_000;
    await api.finish({ ...run({ time: 240, coins: 10 }), run: c });
    await expect(api.finish({ ...run({ time: 240, coins: 10 }), run: d })).rejects.toThrow('overlap');
    expect((await api.loadProfile()).coins).toBe(30);
  });

  it('한 번에 한 판 (서버 039·040 과 같다): 새 판을 시작해도 이전 판은 남고, 겹치는 판은 끝낼 때 거절한다', async () => {
    let t = 5_000_000;
    const st = memStore();
    const api = createLocalApi(st, () => t);
    // 통신이 끊겨 끝을 못 보낸 판 a, 그 뒤에 한 판 b: 둘 다 받는다 (플레이 시간이 겹치지 않는다)
    const a = (await api.start('field', 'rat'))!;
    t += 100_000;
    const b = (await api.start('field', 'rat'))!;
    t += 100_000;
    expect((await api.finish({ ...run({ time: 90, coins: 10 }), run: b }))!.profile.coins).toBe(10);
    expect((await api.finish({ ...run({ time: 90, coins: 7 }), run: a }))!.profile.coins).toBe(17);
    // 판 둘을 같이 열어 두고 한꺼번에 보고하면 두 번째는 겹쳐서 거절
    const c = (await api.start('field', 'rat'))!;
    const d = (await api.start('field', 'rat'))!;
    t += 60_000;
    await api.finish({ ...run({ time: 40, coins: 5 }), run: c });
    await expect(api.finish({ ...run({ time: 40, coins: 5 }), run: d })).rejects.toThrow('overlap');
    expect((await api.loadProfile()).coins).toBe(22);
    // 맞닿은 판은 겹친 것으로 보지 않는다: 40초 판 c 는 2배속 기준 [시작, 시작+5초) 를 썼다 (40 / 2 − 여유 15초)
    t -= 60_000 - 5_000;
    const e = (await api.start('field', 'rat'))!;
    t += 40_000;
    expect((await api.finish({ ...run({ time: 30, coins: 1 }), run: e }))!.profile.coins).toBe(23);
    // 끝내지 않은 판은 5개까지만 남는다 (가장 오래된 것부터 버린다)
    const open: string[] = [];
    for (let i = 0; i < 6; i++) {
      t += 1000;
      open.push((await api.start('field', 'rat'))!);
    }
    t += 400_000;
    await expect(api.finish({ ...run({ time: 30 }), run: open[0] })).rejects.toThrow('no run');
    expect((await api.finish({ ...run({ time: 30, coins: 2 }), run: open[1] }))!.result.coins).toBe(2);
    // 7일이 지난 판은 다음 시작 때 치워진다
    t += (LIMITS.max_age + 10) * 1000;
    await api.start('field', 'rat');
    await expect(api.finish({ ...run({ time: 30 }), run: open[2] })).rejects.toThrow('no run');
  });
});

describe('판 도중 중간 결과 (숨을 때 보관)', () => {
  const report = (id: string, time = 120): RunReport => ({ ...run(), run: id, time });

  it('다른 탭이 남긴 젊은 중간 결과만 살아 있다고 본다. 잠금을 알 수 있으면 잠금만 본다', () => {
    const e = { ...report('r'), partial: true as const, tab: 'A', at: 1000 };
    expect(mayBeLive(e, 'B', 1000 + PARTIAL_LIVE_MS - 1, null)).toBe(true);
    expect(mayBeLive(e, 'B', 1000 + PARTIAL_LIVE_MS, null)).toBe(false);
    expect(mayBeLive(e, 'A', 1000, null)).toBe(false); // 자기 탭 (새로고침 뒤)
    expect(mayBeLive(report('r'), 'B', 1000, null)).toBe(false); // 끝 결과
    expect(mayBeLive(e, 'B', 1000, new Set())).toBe(false); // 잠금이 풀렸다: 그 탭은 닫혔거나 판이 끝났다
    expect(mayBeLive(report('r'), 'B', 1000, new Set(['r']))).toBe(true);
  });

  it('중간 결과는 못 올린 끝 결과를 밀어내지 않는다 (자리가 없으면 가장 최근 중간 결과 하나만 따로)', () => {
    const st = memStore();
    for (let i = 0; i < PENDING_MAX; i++) keepPending(st, 'u1', report(`f${i}`));
    keepPending(st, 'u1', report('p1', 30), { tab: 'A', at: 1 });
    keepPending(st, 'u1', report('p1', 40), { tab: 'A', at: 2 }); // 같은 판: 덮어쓴다
    expect(readPending(st, 'u1').map((r) => r.run)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'p1']);
    keepPending(st, 'u1', report('p2', 30), { tab: 'B', at: 3 });
    expect(readPending(st, 'u1').map((r) => r.run)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'p2']);
    // 자리가 남으면 중간 결과도 여럿 둔다
    const t = memStore();
    keepPending(t, 'u1', report('f0'));
    for (const id of ['p1', 'p2', 'p3']) keepPending(t, 'u1', report(id), { tab: 'A', at: 1 });
    expect(readPending(t, 'u1').map((r) => r.run)).toEqual(['f0', 'p1', 'p2', 'p3']);
    // 끝 결과가 중간 결과를 덮어쓰면 표시가 사라진다
    keepPending(t, 'u1', report('p1', 240));
    const p1 = readPending(t, 'u1').find((r) => r.run === 'p1')!;
    expect([p1.partial, p1.tab, p1.at, p1.time]).toEqual([undefined, undefined, undefined, 240]);
  });

  it('보내는 사이에 다른 탭이 끝 결과로 덮어쓰면 그것을 지우지 않는다. 보내기 직전에 다시 읽는다', async () => {
    const st = memStore();
    keepPending(st, 'u1', report('a', 30), { tab: 'A', at: 1 });
    keepPending(st, 'u1', report('b', 30), { tab: 'A', at: 1 });
    const sentTimes: number[] = [];
    await flushPending(st, 'u1', async (r) => {
      sentTimes.push(r.time);
      if (r.run === 'a') {
        keepPending(st, 'u1', report('a', 240)); // 다른 탭이 a 를 끝냈다
        keepPending(st, 'u1', report('b', 200)); // b 도 (아직 보내기 전)
      }
      return 'ok';
    });
    expect(sentTimes).toEqual([30, 200]);
    expect(readPending(st, 'u1').map((r) => [r.run, r.time])).toEqual([['a', 240]]);
  });
});

describe('서버에 끝 저장: 먼저 보관하고 보낸다', () => {
  const report = (id: string): RunReport => ({ ...run(), run: id });
  const okAnswer = (coins = 40) => ({ data: { profile: { ...defaultProfile(), coins }, result: { coins, valid: true, newRecord: false, unlockedCharacters: [], unlockedMaps: [] } }, error: null });
  type Answer = { data: unknown; error: { code?: string; message?: string } | null };
  /** 가짜 서버: 함수 이름별로 답을 정한다 (답이 없으면 끝내 대답하지 않는다) */
  function fake(answer: (fn: string, args: Record<string, unknown> | undefined, nth: number) => Answer | Promise<Answer> | null) {
    const calls: { fn: string; run?: unknown }[] = [];
    let aborted = 0;
    const sb: RpcClient = {
      rpc(fn, args) {
        calls.push({ fn, run: args?.p_run });
        const a = answer(fn, args, calls.filter((c) => c.fn === fn).length);
        const p: Promise<Answer> = a === null ? new Promise(() => {}) : Promise.resolve(a);
        return Object.assign(p, {
          abortSignal(sig: AbortSignal) {
            sig.addEventListener('abort', () => aborted++);
            return p;
          },
        });
      },
    };
    return { sb, calls, aborted: () => aborted };
  }

  it('보내는 동안 이미 보관돼 있고, 서버가 받으면 지운다', async () => {
    const st = memStore();
    let keptWhileSending: string[] = [];
    const f = fake(() => {
      keptWhileSending = readPending(st, 'u1').map((r) => r.run);
      return okAnswer(55);
    });
    const api = createSupabaseApi(f.sb, 'u1', st, 200);
    const out = await api.finish(report('a'));
    expect(keptWhileSending).toEqual(['a']);
    expect(out?.profile.coins).toBe(55);
    expect(readPending(st, 'u1')).toEqual([]);
  });

  it('서버가 거절하면(P0001) 지우고 알린다. 다만 too early 와 그 밖의 오류는 남겨 둔다', async () => {
    const st = memStore();
    const errs: Record<string, Answer> = {
      a: { data: null, error: { code: 'P0001', message: 'overlap' } },
      b: { data: null, error: { code: 'P0001', message: 'too early' } },
      c: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } },
    };
    const f = fake((_fn, args) => errs[String(args?.p_run)]);
    const api = createSupabaseApi(f.sb, 'u1', st, 200);
    await expect(api.finish(report('a'))).rejects.toBeInstanceOf(ApiError);
    expect(readPending(st, 'u1')).toEqual([]);
    expect(await api.finish(report('b'))).toBeNull();
    expect(await api.finish(report('c'))).toBeNull();
    expect(readPending(st, 'u1').map((r) => r.run)).toEqual(['b', 'c']);
  });

  it('시간 제한 안에 답이 없으면 요청을 끊고 실패로 본다 (결과는 보관돼 있다)', async () => {
    const st = memStore();
    const f = fake(() => null);
    const api = createSupabaseApi(f.sb, 'u1', st, 40);
    const t0 = Date.now();
    expect(await api.finish(report('a'))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(f.aborted()).toBe(1);
    expect(readPending(st, 'u1').map((r) => r.run)).toEqual(['a']);
    // 판 시작도 같다: 한 번 더 해 보고, 그래도 답이 없으면 null (그 판은 기록되지 않는다)
    expect(await api.start('field', 'rat')).toBeNull();
    expect(f.calls.filter((c) => c.fn === 'survival_start').length).toBe(2);
  });

  it('판 시작: 첫 시도가 통신 실패면 한 번 더 해 본다. 서버가 거절한 것은 다시 하지 않는다', async () => {
    const f = fake((fn, _a, nth) => (fn === 'survival_start' && nth === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { data: 'run-2', error: null }));
    expect(await createSupabaseApi(f.sb, 'u1', memStore(), 200).start('field', 'rat')).toBe('run-2');
    const g = fake(() => ({ data: null, error: { code: 'P0001', message: 'map locked' } }));
    await expect(createSupabaseApi(g.sb, 'u1', memStore(), 200).start('bamboo', 'rat')).rejects.toThrow('map locked');
    expect(g.calls.length).toBe(1);
  });

  it('저장에 성공하면 보류해 둔 다른 판도 바로 올리고, 새 프로필을 알린다. 보내는 중인 판은 다시 보내기에서 건너뛴다', async () => {
    const st = memStore();
    keepPending(st, 'u1', report('old'));
    let release: (a: Answer) => void = () => {};
    const f = fake((_fn, args) => (args?.p_run === 'now' ? new Promise<Answer>((r) => (release = r)) : okAnswer(99)));
    const api = createSupabaseApi(f.sb, 'u1', st, 500);
    const seen: number[] = [];
    api.onProfile = (p) => seen.push(p.coins);
    const done = api.finish(report('now'));
    // 'now' 를 보내는 동안의 다시 보내기: 'old' 만 보낸다
    expect(await api.resend()).toBe(1);
    expect(f.calls.map((c) => c.run)).toEqual(['now', 'old']);
    expect(seen).toEqual([99]);
    expect(readPending(st, 'u1').map((r) => r.run)).toEqual(['now']);
    // 판 도중 보관(stash)은 보내는 중인 판을 덮어쓰지 않는다
    api.stash({ ...report('now'), time: 1 });
    expect(readPending(st, 'u1')[0].time).toBe(120);
    keepPending(st, 'u1', report('old2'));
    release(okAnswer(120));
    expect((await done)?.profile.coins).toBe(120);
    // 성공 직후 기다리지 않고 보류분(old2)을 올린다
    await api.resend();
    expect(f.calls.map((c) => c.run)).toEqual(['now', 'old', 'old2']);
    expect(readPending(st, 'u1')).toEqual([]);
    expect(seen).toEqual([99, 99]);
  });

  it('판 도중에 창이 닫히면 그때까지의 결과를 보관하고, 다음 접속 때 올라간다. 판이 이어져 끝나면 끝 결과가 덮어쓴다', async () => {
    const st = memStore();
    const f = fake(() => okAnswer(12));
    const api = createSupabaseApi(f.sb, 'u1', st, 200);
    api.stash({ ...report('r1'), time: 45, coins: 12 });
    expect(f.calls.length).toBe(0);
    expect(readPending(st, 'u1').map((r) => [r.run, r.time])).toEqual([['r1', 45]]);
    // 다음 접속 (새로 만든 연결)
    const next = createSupabaseApi(f.sb, 'u1', st, 200);
    expect(await next.resend()).toBe(1);
    expect(readPending(st, 'u1')).toEqual([]);
    // 닫히지 않고 이어진 판: 끝 결과가 중간 결과를 덮어쓴다
    api.stash({ ...report('r2'), time: 45 });
    const g = fake(() => null);
    const slow = createSupabaseApi(g.sb, 'u1', st, 30);
    expect(await slow.finish({ ...report('r2'), time: 240 })).toBeNull();
    expect(readPending(st, 'u1').map((r) => [r.run, r.time])).toEqual([['r2', 240]]);
  });

  it('두 탭 (잠금 없음): 다른 탭이 숨으며 남긴 젊은 중간 결과는 올리지 않고, 그 탭이 끝내면 끝 결과가 올라간다', async () => {
    const st = memStore();
    let t = 1_000_000;
    const now = () => t;
    const f = fake(() => okAnswer(7));
    const tab1 = createSupabaseApi(f.sb, 'u1', st, 200, { tab: 'T1', locks: null, now });
    const tab2 = createSupabaseApi(f.sb, 'u1', st, 200, { tab: 'T2', locks: null, now });
    tab1.stash({ ...report('B'), time: 45 });
    const kept = readPending(st, 'u1')[0];
    expect([kept.partial, kept.tab, kept.at]).toEqual([true, 'T1', t]);
    // 탭 2 를 열거나 판을 시작: B 는 탭 1 에서 아직 이어지고 있을 수 있다
    expect(await tab2.resend()).toBe(0);
    expect(f.calls.length).toBe(0);
    // 탭 1 이 B 를 끝낸다 → 끝 결과가 올라간다
    t += 60_000;
    expect((await tab1.finish({ ...report('B'), time: 240 }))?.profile.coins).toBe(7);
    expect(f.calls.map((c) => c.run)).toEqual(['B']);
    expect(readPending(st, 'u1')).toEqual([]);
    // 탭 1 이 숨은 채로 닫혔다: 30분이 지나면 다른 탭이 중간 결과를 올린다
    tab1.stash({ ...report('C'), time: 50 });
    t += PARTIAL_LIVE_MS - 1;
    expect(await tab2.resend()).toBe(0);
    t += 1;
    expect(await tab2.resend()).toBe(1);
    expect(readPending(st, 'u1')).toEqual([]);
  });

  it('두 탭 (잠금 있음): 판 잠금이 잡혀 있으면 건너뛰고, 풀리면(탭이 닫힘) 젊어도 올린다. 자기 탭의 판도 건너뛴다', async () => {
    const held = new Set<string>();
    const locks: RunLocks = {
      async request(name, cb) {
        held.add(name);
        try {
          await cb();
        } finally {
          held.delete(name);
        }
      },
      async query() {
        return { held: [...held].map((name) => ({ name })) };
      },
    };
    const st = memStore();
    const f = fake(() => okAnswer(3));
    const tab1 = createSupabaseApi(f.sb, 'u1', st, 200, { tab: 'T1', locks });
    const tab2 = createSupabaseApi(f.sb, 'u1', st, 200, { tab: 'T2', locks });
    const unhold = tab1.hold('B');
    await Promise.resolve();
    expect(held.has('siasurv-run:B')).toBe(true);
    tab1.stash({ ...report('B'), time: 45 });
    expect(await tab2.resend()).toBe(0);
    expect(await tab1.resend()).toBe(0); // 이 탭에서 하고 있는 판
    unhold();
    unhold(); // 여러 번 불러도 된다
    await new Promise((r) => setTimeout(r, 0));
    expect(held.size).toBe(0);
    expect(await tab2.resend()).toBe(1);
    expect(f.calls.map((c) => c.run)).toEqual(['B']);
    // 잠금을 받기 전에 풀어도 잠긴 채로 남지 않는다
    const early = tab1.hold('C');
    early();
    await new Promise((r) => setTimeout(r, 0));
    expect(held.size).toBe(0);
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
