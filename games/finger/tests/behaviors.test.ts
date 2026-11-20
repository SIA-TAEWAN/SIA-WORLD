import { describe, expect, it } from 'vitest';
import {
  BOARD_MUL,
  BOSSES,
  BOSS_IDS,
  DEBUFF,
  ENEMIES,
  PORTAL_R,
  THORN_DMG,
  aimPreview,
  beginShot,
  buildConfig,
  chiefDef,
  createRun,
  endTurn,
  playShot,
  speedOf,
  stepShot,
  threats,
  type RunConfig,
  type RunState,
  type ShotInput,
  type SimEvent,
} from '../src/sim';
import { cfgOf, foe, hero } from './helpers';

/** 쏘고 멈출 때까지 (요괴 차례 전) */
function fly(s: RunState, inp: ShotInput): SimEvent[] {
  const ev = beginShot(s, inp);
  while (s.phase === 'shot') ev.push(...stepShot(s));
  return ev;
}
const hits = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { t: 'hit' }> => e.t === 'hit');
/** 아무것도 안 맞는 헛발 (왼쪽 벽 쪽으로 약하게) */
const idle: ShotInput = { a: 1800, p: 1, s: 0 };

describe('요괴 행동', () => {
  it('방패(수문장): 앞(아래)에서 맞으면 피해 × 0.3, 뒤에서는 그대로', () => {
    const mk = () => createRun(cfgOf([hero('ox')], [[foe(320, 400, { hp: 9999, traits: ENEMIES.guard.traits })]]));
    const front = mk();
    front.heroes[0].x = 320;
    front.heroes[0].y = 800;
    const hf = hits(fly(front, { a: 2700, p: 20, s: 0 }))[0];
    const back = mk();
    back.heroes[0].x = 320;
    back.heroes[0].y = 150;
    const hb = hits(fly(back, { a: 900, p: 20, s: 0 }))[0];
    expect(hf.shield).toBe(true);
    expect(hb.shield).toBeUndefined();
    expect(hf.dmg).toBe(Math.round(33 * 0.3));
    expect(hb.dmg).toBe(33);
  });

  it('부활(해골): 쓰러지면 웨이브가 끝나지 않고 다음 요괴 차례에 절반 체력으로 한 번 되살아난다', () => {
    const s = createRun(cfgOf([hero('ox', { atk: 999 })], [[foe(320, 400, { hp: 100, traits: { revive: 0.5 } })], [foe(320, 200)]]));
    s.heroes[0].x = 320;
    const ev = fly(s, { a: 2700, p: 20, s: 0 });
    expect(ev.some((e) => e.t === 'down')).toBe(true);
    expect(ev.some((e) => e.t === 'kill')).toBe(false);
    const ev2 = endTurn(s);
    expect(ev2.some((e) => e.t === 'wave')).toBe(false);
    expect(ev2.some((e) => e.t === 'rise')).toBe(true);
    const f = s.foes[0];
    expect(f.alive).toBe(true);
    expect(f.hp).toBe(50);
    // 두 번째는 정말 쓰러진다 → 다음 웨이브
    s.heroes[0].x = 320;
    s.heroes[0].y = 800;
    const ev3 = playShot(s, { a: 2700, p: 20, s: 0 });
    expect(ev3.some((e) => e.t === 'kill')).toBe(true);
    expect(ev3.some((e) => e.t === 'wave')).toBe(true);
    expect(s.kills).toBe(1);
  });

  it('숨기(물귀신): 요괴 차례마다 숨었다 나왔다, 숨은 턴엔 박치기도 콤보도 안 맞는다', () => {
    const s = createRun(cfgOf([hero('ox'), hero('tiger')], [[foe(320, 400, { hp: 9999, cd: 9, traits: { hide: 1 } })]]));
    expect(s.foes[0].hidden).toBe(false);
    playShot(s, idle);
    expect(s.foes[0].hidden).toBe(true);
    s.heroes[1].x = 320;
    s.heroes[1].y = 800;
    const ev = fly(s, { a: 2700, p: 30, s: 0 });
    expect(hits(ev)).toEqual([]);
    endTurn(s);
    expect(s.foes[0].hidden).toBe(false);
    s.heroes[0].x = 320;
    s.heroes[0].y = 800;
    expect(hits(fly(s, { a: 2700, p: 30, s: 0 })).length).toBeGreaterThan(0);
  });

  it('분열(죽순): 쓰러지면 작은 요괴 둘 (체력 35%, 날아가던 대원은 바로 맞히지 않는다)', () => {
    const s = createRun(cfgOf([hero('ox', { atk: 200 })], [[foe(320, 400, { hp: 150, traits: ENEMIES.bamboo.traits })]]));
    s.heroes[0].x = 320;
    beginShot(s, { a: 2700, p: 10, s: 0 });
    let ev: SimEvent[] = [];
    while (s.phase === 'shot' && !ev.some((e) => e.t === 'spawn')) ev = stepShot(s);
    const sp = ev.find((e) => e.t === 'spawn');
    expect(sp?.t === 'spawn' && sp.kids.length).toBe(2);
    const kids = s.foes.filter((f) => f.alive);
    expect(kids.length).toBe(2);
    for (const k of kids) {
      expect(k.hp).toBe(Math.round(150 * 0.35));
      expect(k.r).toBeLessThan(34);
      expect(k.traits).toBeUndefined();
    }
    // 갈라진 그 자리에서는 바로 맞지 않는다 (닿아 있던 것으로 친다)
    expect(hits(ev).length).toBe(1);
  });

  it('아군 회복(원혼): heal 차례에 다른 요괴 체력을 최대 체력의 15% 채운다', () => {
    const s = createRun(cfgOf([hero('rat')], [[foe(200, 300, { cd: 1, pattern: ['heal'], traits: { heal: 0.15 } }), foe(440, 300, { hp: 200, cd: 9 })]]));
    s.foes[1].hp = 100;
    const ev = playShot(s, idle);
    const h = ev.find((e) => e.t === 'foeHeal');
    expect(h?.t === 'foeHeal' && h.heals).toEqual([{ id: s.foes[1].id, v: 30 }]);
    expect(s.foes[1].hp).toBe(130);
    expect(ev.some((e) => e.t === 'attack')).toBe(false);
  });

  it('나쁜 효과: 독은 요괴 차례마다 깎이고, 느려짐·약해짐은 다음 발사에 쓰이고 사라진다', () => {
    const s = createRun(cfgOf([hero('rat'), hero('ox')], [[foe(320, 200, { hp: 9999, cd: 1, atk: 20, traits: { inflict: 'poison' } })]]));
    playShot(s, idle);
    const t = s.heroes.findIndex((h) => h.poisonTurns > 0);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(s.heroes[t].poison).toBe(Math.round(20 * DEBUFF.poisonMul));
    const hp0 = s.heroes[t].hp;
    s.foes[0].traits = undefined;
    s.foes[0].left = 99;
    const ev = playShot(s, idle);
    expect(ev.find((e) => e.t === 'tick')).toEqual({ t: 'tick', hero: t, dmg: 6, kind: 'poison' });
    expect(s.heroes[t].hp).toBe(hp0 - 6);

    const s2 = createRun(cfgOf([hero('ox')], [[foe(320, 100, { hp: 9999, cd: 99 })]]));
    s2.heroes[0].slow = 1;
    s2.heroes[0].weak = 1;
    s2.heroes[0].x = 320;
    beginShot(s2, { a: 2700, p: 50, s: 0 });
    expect(-s2.movers[0].vy).toBeCloseTo(speedOf(50) * DEBUFF.slowMul, 6);
    expect(s2.movers[0].atk).toBeCloseTo(33 * DEBUFF.weakMul, 6);
    expect(s2.heroes[0].slow).toBe(0);
    expect(s2.heroes[0].weak).toBe(0);
  });

  it('얼음(야광귀): 맞은 대원은 다음 자기 차례를 한 번 쉰다', () => {
    const s = createRun(cfgOf([hero('rat'), hero('ox'), hero('tiger')], [[foe(320, 200, { hp: 9999, cd: 99 })]]));
    s.heroes[1].frozen = 1;
    const ev = playShot(s, idle);
    expect(ev).toContainEqual({ t: 'skip', hero: 1 });
    expect(s.cur).toBe(2);
    expect(s.heroes[1].frozen).toBe(0);
  });

  it('닭 콤보 "주변 효과 지우기": 범위 안 대원의 독·느려짐·약해짐·얼음과 불길을 지운다', () => {
    const s = createRun(cfgOf([hero('rat'), hero('rooster')], [[foe(320, 100, { hp: 9999, cd: 99 })]]));
    s.heroes[1].x = 330;
    s.heroes[1].y = 650;
    s.heroes[1].poison = 5;
    s.heroes[1].poisonTurns = 3;
    s.heroes[1].slow = 1;
    s.heroes[1].weak = 1;
    s.heroes[1].frozen = 1;
    s.fires.push({ x: 330, y: 700, r: 100, dmg: 10, turns: 2 }, { x: 100, y: 100, r: 50, dmg: 10, turns: 2 });
    s.heroes[0].x = 330;
    s.heroes[0].y = 900;
    const ev = fly(s, { a: 2700, p: 40, s: 0 });
    const c = ev.find((e) => e.t === 'cleanse');
    expect(c?.t === 'cleanse' && c.heroes).toContain(1);
    const h = s.heroes[1];
    expect([h.poisonTurns, h.slow, h.weak, h.frozen]).toEqual([0, 0, 0, 0]);
    expect(s.fires.length).toBe(1);
  });
});

describe('보스 12종', () => {
  it('보스마다 특성 · 약점 · 미리 보이는 큰 공격(area)이 있다', () => {
    for (const id of BOSS_IDS) {
      const b = BOSSES[id];
      expect(b.trait, id).toBeTruthy();
      expect(b.weak, id).not.toBeUndefined();
      expect(b.pattern, id).toContain('area');
      if (id !== 'bigDokkaebi') expect(b.traits, id).toBeTruthy();
    }
    expect(new Set(BOSS_IDS.map((id) => JSON.stringify([BOSSES[id].pattern, BOSSES[id].traits]))).size).toBe(12);
  });

  it('각 지역 보스 스테이지는 그 지역 보스 (특성이 판 설정에 들어간다)', () => {
    BOSS_IDS.forEach((id, i) => {
      const cfg = buildConfig({ stage: `${i + 1}-5`, party: ['rat'] });
      const boss = cfg.waves[2].find((f) => f.rank === 2)!;
      expect(boss.kind).toBe(id);
      expect(boss.traits).toEqual(BOSSES[id].traits);
      if (BOSSES[id].traits?.summon) expect(boss.summon?.kind).toBe(BOSSES[id].traits!.summon!.kind);
    });
  });

  it('작은 대장은 그 지역 요괴의 행동을 이어받는다', () => {
    expect(chiefDef(5).traits?.hide).toBe(1);
    expect(chiefDef(8).traits?.shield).toBeTruthy();
    expect(chiefDef(11).traits?.revive).toBe(0.5);
  });

  const bossRun = (id: (typeof BOSS_IDS)[number], party = 2): RunState => {
    const cfg = buildConfig({ stage: `${BOSS_IDS.indexOf(id) + 1}-5`, party: ['rat', 'ox', 'tiger', 'rabbit'].slice(0, party) });
    const b = cfg.waves[2].find((f) => f.rank === 2)!;
    return createRun({ ...cfg, waves: [[{ ...b, hp: 99999, x: 320, y: 250 }]] } as RunConfig);
  };

  it('부르기(두억시니): summon 차례에 꼬마 도깨비 둘이 나온다', () => {
    const s = bossRun('dueoksini');
    s.foes[0].pi = 1;
    s.foes[0].left = 1;
    const ev = playShot(s, idle);
    const sp = ev.find((e) => e.t === 'spawn');
    expect(sp?.t === 'spawn' && sp.why).toBe('summon');
    expect(s.foes.filter((f) => f.alive && f.kind === 'imp').length).toBe(2);
  });

  it('단단해짐(불가살): 요괴 차례마다 받는 피해가 줄고, 약점을 맞히면 풀린다', () => {
    const s = bossRun('bulgasal');
    s.foes[0].left = 99;
    playShot(s, idle);
    playShot(s, idle);
    expect(s.foes[0].hard).toBe(2);
    s.heroes[s.cur].x = 320;
    s.heroes[s.cur].y = 700;
    const h = hits(fly(s, { a: 2700, p: 10, s: 0 }))[0];
    expect(h.dmg).toBe(Math.round(s.heroes[s.cur].atk * 0.8));
    // 등 뒤(약점)
    const s2 = bossRun('bulgasal');
    s2.foes[0].hard = 3;
    s2.heroes[0].x = 320;
    s2.heroes[0].y = 100;
    const hw = hits(fly(s2, { a: 900, p: 10, s: 0 }))[0];
    expect(hw.weak).toBe(true);
    expect(hw.dmg).toBe(30 * 3);
    expect(s2.foes[0].hard).toBe(0);
  });

  it('연속 공격(장산범): 가까운 대원 둘을 친다', () => {
    const s = bossRun('jangsanbeom', 3);
    s.foes[0].left = 1;
    expect(threats(s).filter((t) => t.kind === 'double').length).toBe(2);
    const att = playShot(s, idle).find((e) => e.t === 'attack');
    expect(att?.t === 'attack' && att.hits.length).toBe(2);
  });

  it('두 군데 공격(구미호): 큰 공격 전 턴에 원 두 개가 미리 보이고 그 두 자리에 떨어진다', () => {
    const s = bossRun('gumiho', 3);
    s.foes[0].pi = 1;
    s.foes[0].left = 2;
    playShot(s, idle);
    const t = threats(s).filter((x) => x.kind === 'area');
    expect(t.length).toBe(2);
    const att = playShot(s, { a: 2700, p: 1, s: 0 }).find((e) => e.t === 'attack');
    expect(att?.t === 'attack' && [att.x, att.y, att.x2, att.y2]).toEqual([t[0].x, t[0].y, t[1].x, t[1].y]);
  });

  it('불길(강철이): area 자리에 불길이 남아 다음 요괴 차례에 그 안 대원이 탄다', () => {
    const s = bossRun('gangcheori', 1);
    s.foes[0].pi = 1;
    s.foes[0].left = 1;
    playShot(s, { a: 1800, p: 1, s: 0 });
    expect(s.fires.length).toBe(1);
    s.foes[0].left = 99;
    const fx = s.fires[0];
    s.heroes[0].x = fx.x;
    s.heroes[0].y = fx.y;
    const hp0 = s.heroes[0].hp;
    beginShot(s, { a: 900, p: 1, s: 0 });
    while (s.phase === 'shot') stepShot(s);
    s.heroes[0].x = fx.x;
    s.heroes[0].y = fx.y;
    const ev = endTurn(s);
    const tick = ev.find((e) => e.t === 'tick');
    expect(tick?.t === 'tick' && tick.kind).toBe('fire');
    expect(s.heroes[0].hp).toBeLessThan(hp0);
  });

  it('얼리기(야광귀) · 독(왕지네) · 홀림(구미호): 맞은 대원에게 나쁜 효과', () => {
    for (const [id, kind] of [
      ['yagwanggwi', 'freeze'],
      ['centipede', 'poison'],
      ['gumiho', 'weak'],
      ['jangsanbeom', 'slow'],
    ] as const) {
      const s = bossRun(id, 3);
      s.foes[0].pi = 0;
      s.foes[0].left = 1;
      const ev = playShot(s, idle);
      const d = ev.find((e) => e.t === 'debuff');
      expect(d?.t === 'debuff' && d.kind, id).toBe(kind);
    }
    // 얼은 대원(가장 가까운 소)은 자기 차례를 쉰다
    const s = bossRun('yagwanggwi', 3);
    s.foes[0].pi = 0;
    s.foes[0].left = 1;
    const ev = playShot(s, idle);
    expect(ev).toContainEqual({ t: 'skip', hero: 1 });
    expect(s.cur).toBe(2);
  });

  it('숨기(이무기) · 되살아남(저승사자)', () => {
    const s = bossRun('imugi');
    s.foes[0].left = 99;
    playShot(s, idle);
    expect(s.foes[0].hidden).toBe(false);
    playShot(s, idle);
    expect(s.foes[0].hidden).toBe(true);
    const r = bossRun('reaper');
    r.foes[0].hp = 1;
    r.heroes[0].x = 320;
    r.heroes[0].y = 700;
    const ev = playShot(r, { a: 2700, p: 10, s: 0 });
    expect(ev.some((e) => e.t === 'rise')).toBe(true);
    expect(r.foes[0].hp).toBe(Math.round(99999 * 0.4));
  });
});

describe('장애물', () => {
  const base = (over: Partial<RunConfig>) => createRun(cfgOf([hero('rat')], [[foe(590, 50, { hp: 9999, cd: 99, r: 20 })]], over));

  it('둥근 돌기둥: 부딪히면 튕기고 조준선이 기둥 앞에서 끝난다', () => {
    const s = base({ pillars: [[320, 400, 40]] });
    s.heroes[0].x = 320;
    s.heroes[0].y = 800;
    const pts = aimPreview(s, 2700);
    expect(pts[1][0]).toBeCloseTo(320, 6);
    expect(pts[1][1]).toBeCloseTo(400 + 40 + 30, 6);
    const ev = fly(s, { a: 2700, p: 60, s: 0 });
    const w = ev.find((e) => e.t === 'wall');
    expect(w?.t === 'wall' && Math.round(w.y)).toBe(440);
    expect(s.heroes[0].y).toBeGreaterThan(470);
  });

  it('네모 돌기둥에서도 조준선이 끝난다', () => {
    const s = createRun(buildConfig({ stage: '1-3', party: ['rat'] }));
    s.heroes[0].x = 150;
    s.heroes[0].y = 800;
    expect(aimPreview(s, 2700)[1][1]).toBeCloseTo(580 + 30, 6);
  });

  it('가시밭: 들어갈 때 체력 조금 (쓰러뜨리지는 않음) · 지나는 동안 더 느려진다', () => {
    const zone = { k: 'thorn' as const, x: 200, y: 300, w: 240, h: 300 };
    const plain = base({});
    const thorn = base({ zones: [zone] });
    for (const s of [plain, thorn]) {
      s.heroes[0].x = 320;
      s.heroes[0].y = 800;
    }
    fly(plain, { a: 2700, p: 1, s: 0 });
    const ev = fly(thorn, { a: 2700, p: 1, s: 0 });
    const t = ev.filter((e) => e.t === 'thorn');
    expect(t.length).toBe(1);
    expect(thorn.heroes[0].hp).toBe(100 - Math.round(100 * THORN_DMG));
    expect(thorn.heroes[0].y).toBeGreaterThan(plain.heroes[0].y + 40);
    const one = base({ zones: [zone] });
    one.heroes[0].hp = 1;
    one.heroes[0].x = 320;
    one.heroes[0].y = 800;
    fly(one, { a: 2700, p: 30, s: 0 });
    expect(one.heroes[0].hp).toBe(1);
    expect(one.heroes[0].fallen).toBe(false);
  });

  it('빨래판: 들어가는 순간 속도가 확 준다 (급제동)', () => {
    const s = base({ zones: [{ k: 'board', x: 200, y: 500, w: 240, h: 60 }] });
    s.heroes[0].x = 320;
    s.heroes[0].y = 800;
    beginShot(s, { a: 2700, p: 100, s: 0 });
    let v = 0;
    let after = 0;
    while (s.phase === 'shot' && !after) {
      const m = s.movers[0];
      const before = -m.vy;
      const ev = stepShot(s);
      if (ev.some((e) => e.t === 'board')) {
        v = before;
        after = -s.movers[0].vy;
      }
    }
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(v * BOARD_MUL * 1.05);
  });

  it('순간이동 구멍: 한쪽에 들어가면 같은 속도로 짝 구멍에서 나오고, 바로 되돌아가지 않는다', () => {
    const s = base({ portals: [[320, 600, 500, 200]] });
    s.heroes[0].x = 320;
    s.heroes[0].y = 800;
    beginShot(s, { a: 2700, p: 40, s: 0 });
    let warp: SimEvent | undefined;
    let vy = 0;
    while (s.phase === 'shot' && !warp) {
      warp = stepShot(s).find((e) => e.t === 'warp');
      if (warp) vy = s.movers[0].vy;
    }
    expect(warp).toEqual({ t: 'warp', x0: 320, y0: 600, x1: 500, y1: 200 });
    const m = s.movers[0];
    expect(m.x).toBeCloseTo(500, 6);
    expect(Math.abs(m.y - 200)).toBeLessThan(PORTAL_R);
    expect(vy).toBeLessThan(0);
    // 나온 구멍 안에 있는 동안은 다시 빨려 들지 않는다
    let again = 0;
    for (let i = 0; i < 4; i++) again += stepShot(s).filter((e) => e.t === 'warp').length;
    expect(again).toBe(0);
    expect(s.movers[0].warp).toBe(1);
  });
});
