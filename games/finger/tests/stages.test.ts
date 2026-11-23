import { describe, expect, it } from 'vitest';
import { choose } from '../src/game/autopilot';
import {
  BOSSES,
  ConfigError,
  beginShot,
  buildConfig,
  createRun,
  endTurn,
  playShot,
  replayRun,
  resultOf,
  stagesOf,
  starsOf,
  stepShot,
  threats,
  type ShotInput,
} from '../src/sim';
import { cfgOf, foe, hero } from './helpers';

describe('스테이지 데이터 (1지역)', () => {
  const r1 = stagesOf(1);
  it('5스테이지 · 웨이브 3개 · 1~4번째 마지막 웨이브에 작은 대장 · 5번째는 지역 보스', () => {
    expect(r1.map((s) => s.id)).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5']);
    for (const st of r1) {
      expect(st.waves.length).toBe(3);
      const last = st.waves[2].map((f) => f.k);
      if (st.no < 5) expect(last).toContain('chief');
      else expect(last).toContain('boss');
      // 요괴는 방 안에, 돌기둥과 겹치지 않게
      for (const w of st.waves)
        for (const f of w) {
          expect(f.x).toBeGreaterThan(60);
          expect(f.x).toBeLessThan(580);
          expect(f.y).toBeGreaterThan(60);
          expect(f.y).toBeLessThan(700);
        }
    }
  });

  it('1-5 보스는 큰 도깨비 · 약점(등 뒤) · 큰 공격 범위가 있다', () => {
    const cfg = buildConfig({ stage: '1-5', party: ['rat'] });
    const boss = cfg.waves[2].find((f) => f.rank === 2)!;
    expect(boss.kind).toBe('bigDokkaebi');
    expect(boss.weak).toBe(2700);
    expect(boss.pattern).toContain('area');
    expect(boss.hp).toBe(BOSSES.bigDokkaebi.hp);
  });

  it('buildConfig 는 잘못된 파티 · 스테이지를 거절한다', () => {
    expect(() => buildConfig({ stage: '1-1', party: [] })).toThrow(ConfigError);
    expect(() => buildConfig({ stage: '1-1', party: ['rat', 'rat'] })).toThrow(ConfigError);
    expect(() => buildConfig({ stage: '1-1', party: ['rat', 'ox', 'tiger', 'rabbit', 'dog'] })).toThrow(ConfigError);
    expect(() => buildConfig({ stage: '1-1', party: ['wolf'] })).toThrow(ConfigError);
    expect(() => buildConfig({ stage: '9-9', party: ['rat'] })).toThrow(ConfigError);
  });

  it('같은 입력이면 같은 설정 (직렬화 가능)', () => {
    const a = buildConfig({ stage: '1-3', party: ['tiger', 'rat'], levels: { rat: 5 }, upgrades: { hp: 2 } });
    const b = buildConfig({ stage: '1-3', party: ['tiger', 'rat'], levels: { rat: 5 }, upgrades: { hp: 2 } });
    expect(JSON.parse(JSON.stringify(a))).toEqual(b);
    expect(a.walls.length).toBe(4 + 8); // 테두리 + 돌기둥 2개
  });
});

describe('웨이브 · 별', () => {
  it('웨이브 요괴를 다 쓰러뜨리면 다음 웨이브 (요괴 차례 없이), 마지막이면 클리어', () => {
    const s = createRun(cfgOf([hero('ox', { atk: 999 })], [[foe(320, 400, { cd: 1, atk: 50 })], [foe(320, 200, { hp: 9999 })]]));
    s.heroes[0].x = 320;
    const ev = playShot(s, { a: 2700, p: 30, s: 0 });
    expect(ev.some((e) => e.t === 'wave' && e.n === 1)).toBe(true);
    expect(ev.some((e) => e.t === 'attack')).toBe(false);
    expect(s.wave).toBe(1);
    expect(s.foes[0].hp).toBe(9999);
    s.foes[0].hp = 1;
    s.heroes[0].x = 320;
    s.heroes[0].y = 800;
    const ev2 = playShot(s, { a: 2700, p: 40, s: 0 });
    expect(ev2.some((e) => e.t === 'clear')).toBe(true);
    expect(s.phase).toBe('clear');
  });

  it('별 3개: 클리어 · 정해진 턴 안 · 아무도 안 쓰러짐', () => {
    const s = createRun(cfgOf([hero('ox', { atk: 999 })], [[foe(320, 400)]], { par: 1 }));
    s.heroes[0].x = 320;
    playShot(s, { a: 2700, p: 30, s: 0 });
    expect(starsOf(s)).toEqual([true, true, true]);
    expect(resultOf(s).stars).toBe(3);
    s.turn = 2;
    expect(starsOf(s)).toEqual([true, false, true]);
    s.everFell = true;
    expect(resultOf(s).stars).toBe(1);
    s.phase = 'fail';
    expect(resultOf(s).stars).toBe(0);
  });

  it('보스 약점(등 뒤)을 맞히면 피해 3배', () => {
    const mk = () => createRun(cfgOf([hero('ox')], [[foe(320, 400, { hp: 99999, r: 90, weak: 2700 })]]));
    const back = mk();
    back.heroes[0].x = 320;
    back.heroes[0].y = 150; // 보스 위(등 뒤)에서 아래로
    const front = mk();
    front.heroes[0].x = 320;
    const hitOf = (s: ReturnType<typeof mk>, a: number) => {
      const ev = beginShot(s, { a, p: 20, s: 0 });
      while (s.phase === 'shot') ev.push(...stepShot(s));
      return ev.find((e) => e.t === 'hit');
    };
    const hb = hitOf(back, 900);
    const hf = hitOf(front, 2700);
    expect(hb?.t === 'hit' && hb.weak).toBe(true);
    expect(hf?.t === 'hit' && hf.weak).toBe(false);
    expect(hb?.t === 'hit' && hf?.t === 'hit' && hb.dmg).toBe(hf?.t === 'hit' ? hf.dmg * 3 : -1);
  });

  it('큰 공격 전 턴에 범위가 미리 보이고, 그 자리에 떨어진다', () => {
    const s = createRun(cfgOf([hero('rat'), hero('ox')], [[foe(320, 200, { hp: 99999, cd: 2, atk: 30, pattern: ['area'], area: 120 })]]));
    expect(threats(s)).toEqual([]);
    playShot(s, { a: 900, p: 1, s: 0 });
    const t = threats(s);
    expect(t.length).toBe(1);
    expect(t[0].kind).toBe('area');
    const [x, y] = [t[0].x, t[0].y];
    // 소가 범위 밖으로 피한다
    beginShot(s, { a: 2700, p: 100, s: 0 });
    while (s.phase === 'shot') stepShot(s);
    const ev = endTurn(s);
    const att = ev.find((e) => e.t === 'attack');
    expect(att?.t === 'attack' && [att.x, att.y]).toEqual([x, y]);
  });
});

describe('자동 플레이어', () => {
  /** 자동 플레이로 한 판 (조작 목록과 결과) */
  function auto(stage: string, party: string[]) {
    const s = createRun(buildConfig({ stage, party }));
    const inputs: ShotInput[] = [];
    while (s.phase === 'aim') {
      const inp = choose(s);
      inputs.push(inp);
      playShot(s, inp);
    }
    return { s, inputs };
  }

  it.each(stagesOf(1).map((s) => s.id))('%s 를 레벨 1 처음 3종(쥐·소·호랑이)으로 깬다 · 서버식 다시 돌리기와 같다', (id) => {
    const { s, inputs } = auto(id, ['rat', 'ox', 'tiger']);
    const r = resultOf(s);
    expect(r.cleared).toBe(true);
    expect(r.turns).toBeLessThanOrEqual(s.cfg.par);
    expect(replayRun(buildConfig({ stage: id, party: ['rat', 'ox', 'tiger'] }), inputs)).toEqual(r);
    expect(s.log).toEqual(inputs);
  });

  it('한 수를 고르는 데 오래 걸리지 않는다', () => {
    const s = createRun(buildConfig({ stage: '1-5', party: ['rat', 'ox', 'tiger'] }));
    const t0 = performance.now();
    choose(s);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
