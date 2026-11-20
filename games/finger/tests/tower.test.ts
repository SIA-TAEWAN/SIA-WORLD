import { describe, expect, it } from 'vitest';
import { towerParty } from '../src/data/balance';
import { choose } from '../src/game/autopilot';
import { towerCoins, totalCoins } from '../src/data/growth';
import { applyResult, checkStart, emptyProfile, snapshotOf, towerOpen, type FingerProfile } from '../src/game/progress';
import { createLocalApi, type Store } from '../src/net/api';
import {
  MAX_TOWER_INPUTS,
  TOWER_FLOORS,
  TOWER_TURNS,
  VerifyError,
  buildConfig,
  checkInputs,
  createRun,
  endTurn,
  playShot,
  replayRun,
  resultOf,
  stageOf,
  towerFloor,
  verifyRun,
  type RunConfig,
  type RunResult,
  type RunSnapshot,
  type ShotInput,
} from '../src/sim';
import { box, cfgOf, foe, hero, playLikeBrowser } from './helpers';

/** 끝없는 탑 (PRD "끝없는 탑"): 층 구성 · 이어지는 체력 · 끝 · 서버 다시 돌리기 · 입력 상한 · 엽전 */

const tower = (party = towerParty(5), lv = 5) =>
  buildConfig({ stage: 'tower', mode: 'tower', party, levels: Object.fromEntries(party.map((id) => [id, lv])) });

describe('층 구성', () => {
  it('층 번호만으로 정해진다 (같은 층 = 같은 값, 설정도 매번 같다)', () => {
    for (const n of [1, 7, 33, 120]) expect(towerFloor(n)).toEqual(towerFloor(n));
    expect(JSON.stringify(tower())).toBe(JSON.stringify(tower()));
  });
  it('5층마다 보스, 4층째는 작은 대장, 묶음마다 지역이 돌아간다', () => {
    for (let n = 1; n <= TOWER_FLOORS; n++) {
      const f = towerFloor(n);
      expect(f.boss).toBe(n % 5 === 0);
      expect(f.chief).toBe(n % 5 === 4);
      expect(f.region).toBe((Math.floor((n - 1) / 5) % 12) + 1);
      expect(stageOf(f.stage), f.stage).toBeTruthy();
    }
    expect(towerFloor(61).region).toBe(1);
    const cfg = tower();
    expect(cfg.mode).toBe('tower');
    expect(cfg.waves.length).toBe(TOWER_FLOORS);
    expect(cfg.maxTurns).toBe(TOWER_TURNS);
    cfg.waves.forEach((w, i) => {
      const ranks = w.map((f) => f.rank);
      expect(ranks.includes(2), `${i + 1}층 보스`).toBe((i + 1) % 5 === 0);
      expect(ranks.includes(1), `${i + 1}층 대장`).toBe((i + 1) % 5 === 4);
    });
    // 방(장애물)은 가져온 스테이지의 것 · 층마다 방 번호가 있다
    expect(cfg.waveRoom!.length).toBe(TOWER_FLOORS);
    expect(cfg.rooms![cfg.waveRoom![5]].region).toBe(2);
    expect(cfg.rooms!.length).toBe(60);
  });
  it('위로 갈수록 세진다 (같은 요괴가 다시 나오면 체력·공격이 더 크다)', () => {
    for (let n = 2; n <= TOWER_FLOORS; n++) {
      expect(towerFloor(n).hpMul).toBeGreaterThan(towerFloor(n - 1).hpMul);
      expect(towerFloor(n).atkMul).toBeGreaterThan(towerFloor(n - 1).atkMul);
    }
    const cfg = tower();
    const a = cfg.waves[0][0];
    const b = cfg.waves[60][0]; // 61층 = 1층과 같은 자리 · 같은 요괴
    expect(b.kind).toBe(a.kind);
    expect(b.hp).toBeGreaterThan(a.hp * 2);
    expect(b.atk).toBeGreaterThan(a.atk * 2);
  });
});

/** 층 두 개짜리 작은 탑: 1층 요괴는 한 대에 쓰러지고 2층은 단단하다 */
function miniTower(): RunConfig {
  const room2 = { walls: box(), pillars: [[320, 500, 40]] as [number, number, number][], region: 2 };
  return cfgOf(
    [hero('ox', { atk: 999 }), hero('rat'), hero('tiger')],
    [[foe(160, 600, { hp: 10, cd: 9 })], [foe(320, 200, { hp: 99999, cd: 9 })]],
    { mode: 'tower', maxTurns: TOWER_TURNS, par: 0, rooms: [{ walls: box() }, room2], waveRoom: [0, 1] },
  );
}

describe('층을 올라가도 이어진다', () => {
  it('대원 체력 · 쓰러짐 · 필살기는 그대로, 자리는 시작 줄로, 방이 바뀐다', () => {
    const s = createRun(miniTower());
    s.heroes[1].hp = 7;
    s.heroes[2].hp = 0;
    s.heroes[2].fallen = true;
    s.pickups.push({ id: 999, kind: 'heal', x: 100, y: 100 });
    const ev = playShot(s, { a: 2700, p: 30, s: 0 }); // 위로 쏴 1층 요괴를 친다
    expect(ev.some((e) => e.t === 'wave')).toBe(true);
    expect(s.wave).toBe(1);
    expect(s.heroes[1].hp).toBe(7);
    expect(s.heroes[2].fallen).toBe(true);
    expect(s.room.pillars).toEqual([[320, 500, 40]]);
    expect(s.pickups).toEqual([]);
    s.heroes.forEach((h, i) => {
      expect(h.x).toBe((640 * (i + 1)) / 4);
      expect(h.y).toBe(880);
    });
    // 쓰러진 대원은 차례도 건너뛴다
    expect(s.cur).not.toBe(2);
    expect(resultOf(s).floors).toBe(1);
  });
  it('스테이지(normal)는 웨이브가 바뀌어도 자리를 그대로 둔다 (5단계와 같음)', () => {
    const cfg = { ...miniTower(), mode: 'normal' as const, rooms: undefined, waveRoom: undefined };
    const s = createRun(cfg);
    const before = s.heroes.map((h) => [h.x, h.y]);
    playShot(s, { a: 2700, p: 30, s: 0 });
    expect(s.wave).toBe(1);
    expect(s.heroes.slice(1).map((h) => [h.x, h.y])).toEqual(before.slice(1));
    expect(resultOf(s).floors).toBe(0);
  });
  it('모두 쓰러지면 끝: 올라간 층 = 다 깬 층 수', () => {
    const cfg = miniTower();
    cfg.party = [hero('ox', { atk: 999, hp: 30 })];
    cfg.waves[0] = [foe(320, 600, { hp: 10, cd: 9 })];
    cfg.waves[1] = [foe(320, 200, { hp: 99999, cd: 1, atk: 50 })];
    const s = createRun(cfg);
    playShot(s, { a: 2700, p: 30, s: 0 });
    expect(s.wave).toBe(1);
    playShot(s, { a: 0, p: 1, s: 0 });
    expect(s.phase).toBe('fail');
    const r = resultOf(s);
    expect(r).toMatchObject({ ended: true, cleared: false, floors: 1, turns: 2 });
  });
  it('최대 턴(120)을 다 쓰면 끝', () => {
    const cfg = miniTower();
    cfg.waves[0] = [foe(320, 200, { hp: 99999, cd: 99, atk: 0 })];
    const s = createRun(cfg);
    while (s.phase === 'aim') playShot(s, { a: 0, p: 1, s: 0 });
    expect(s.turn).toBe(TOWER_TURNS);
    expect(resultOf(s)).toMatchObject({ ended: true, floors: 0, turns: TOWER_TURNS });
    void endTurn;
  });
});

describe('서버 다시 돌리기 (끝없는 탑)', () => {
  const party = towerParty(5);
  const p: FingerProfile = { ...emptyProfile(), levels: Object.fromEntries(party.map((id) => [id, 5])), stages: { '1-5': 2 } };
  const snap = JSON.parse(JSON.stringify(snapshotOf(p, 'whatever', party, 'tower'))) as RunSnapshot;

  it('스냅숏은 stage = tower · mode = tower', () => expect(snap).toMatchObject({ stage: 'tower', mode: 'tower' }));

  it('브라우저처럼 한 스텝씩(2배속 섞음) 둔 판 = verifyRun 결과 (층 · 턴 · 엽전 · 스텝까지)', () => {
    const s = createRun(buildConfig({ stage: 'tower', mode: 'tower', party, levels: p.levels, upgrades: p.upgrades }));
    playLikeBrowser(s, { pilot: { coarse: 150, powers: [50, 100] }, fast: (t) => t % 3 === 0, maxTurns: 45 });
    expect(s.turn).toBeGreaterThan(40); // 스테이지 상한(40)보다 길게
    expect(s.wave).toBeGreaterThan(3);
    const inputs = JSON.parse(JSON.stringify(s.log)) as ShotInput[];
    const server = verifyRun(snap, inputs);
    expect(server).toEqual(resultOf(s));
    expect(server.floors).toBe(s.wave);
    expect(server.ended).toBe(s.phase !== 'aim');
  });

  it('조작 상한: 탑은 120개까지, 121개는 too many turns (스테이지는 40)', () => {
    const many = (n: number) => Array.from({ length: n }, () => ({ a: 0, p: 1, s: 0 as const }));
    expect(MAX_TOWER_INPUTS).toBe(120);
    expect(checkInputs(many(120), MAX_TOWER_INPUTS).length).toBe(120);
    const err = (f: () => unknown) => {
      try {
        f();
        return 'ok';
      } catch (e) {
        return e instanceof VerifyError ? e.message : 'other';
      }
    };
    expect(err(() => verifyRun(snap, many(121)))).toBe('too many turns');
    expect(err(() => checkInputs(many(41)))).toBe('too many turns');
    // 41개가 탑에서는 상한에 걸리지 않는다 (판이 먼저 끝나면 extra inputs 가 될 수는 있다)
    expect(err(() => verifyRun(snap, many(41)))).not.toBe('too many turns');
    const r = replayRun(buildConfig({ stage: 'tower', mode: 'tower', party, levels: p.levels }), many(41));
    expect(r.turns + r.extra).toBe(41);
  });
});

describe('판 밖 규칙 (progress · 테스트 모드)', () => {
  const res = (o: Partial<RunResult>): RunResult => ({
    cleared: false, ended: true, stars: 0, starFlags: [false, false, false], turns: 60, wave: 20, waves: 120, kills: 40, coins: 12, fallen: 4, extra: 0, steps: 6000, floors: 20, ...o,
  });
  it('1-5 를 깨야 열린다', () => {
    const p = emptyProfile();
    expect(towerOpen(p)).toBe(false);
    expect(checkStart(p, 'tower', ['rat'], 'tower')).toBe('tower locked');
    p.stages['1-5'] = 1;
    expect(checkStart(p, 'tower', ['rat'], 'tower')).toBeNull();
    expect(checkStart(p, 'tower', ['dragon'], 'tower')).toBe('hero locked');
  });
  it('엽전 = 층마다 10 + 보스 층마다 20 (+ 주운 엽전, 엽전 강화) · 기록은 높은 층 / 같은 층이면 적은 턴', () => {
    expect([towerCoins(0), towerCoins(4), towerCoins(5), towerCoins(23)]).toEqual([0, 40, 70, 230 + 80]);
    const p: FingerProfile = { ...emptyProfile(), stages: { '1-5': 2 } };
    let f = applyResult(p, 'tower', res({ floors: 20, turns: 60 }), {});
    expect(f).toMatchObject({ coins: 200 + 80 + 12, best: true, floors: 20, stars: 0 });
    expect(p.tower).toEqual({ floor: 20, turns: 60 });
    f = applyResult(p, 'tower', res({ floors: 20, turns: 70 }), {});
    expect(f.best).toBe(false);
    f = applyResult(p, 'tower', res({ floors: 20, turns: 50 }), {});
    expect(f.best).toBe(true);
    f = applyResult(p, 'tower', res({ floors: 3, turns: 9, coins: 0 }), { coin: 5 });
    expect(f).toMatchObject({ best: false, coins: totalCoins(30, 0, { coin: 5 }) });
    expect(p.tower).toEqual({ floor: 20, turns: 50 });
    expect(p.stages).toEqual({ '1-5': 2 });
  });
  it('테스트 모드 api 로 탑 한 판 (시작 → 조작 → 다시 돌린 결과 저장)', async () => {
    const mem = new Map<string, string>();
    const store: Store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
    store.setItem('siafinger:profile:local', JSON.stringify({ coins: 0, stages: { '1-5': 1 } }));
    const api = createLocalApi(store);
    const party = towerParty(1);
    const run = await api.start('tower', party, 'tower');
    const s = createRun(buildConfig({ stage: 'tower', mode: 'tower', party }));
    playLikeBrowser(s, { pilot: { coarse: 200, powers: [60, 100] }, maxTurns: 12 });
    const out = await api.finish({ run, stage: 'tower', inputs: s.log });
    expect(out!.replay!.floors).toBe(s.wave);
    expect(out!.result.floors).toBe(s.wave);
    expect(out!.profile.tower?.floor ?? 0).toBe(s.wave);
  });
});

describe('난이도 (자동 플레이어, npm run tower 와 같은 방식)', () => {
  const climb = (lv: number) => {
    const s = createRun(tower(towerParty(lv), lv));
    while (s.phase === 'aim') playShot(s, choose(s));
    return resultOf(s);
  };
  it('레벨 3 은 십여 층 이상, 레벨 30 은 서른 층 넘게 · 레벨이 높을수록 높이', () => {
    const lo = climb(3);
    const hi = climb(30);
    expect(lo.floors).toBeGreaterThanOrEqual(10);
    expect(hi.floors).toBeGreaterThanOrEqual(30);
    expect(hi.floors).toBeGreaterThan(lo.floors);
    expect(hi.ended && lo.ended).toBe(true);
  }, 60_000);
});
