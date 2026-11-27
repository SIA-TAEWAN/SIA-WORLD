import { describe, expect, it } from 'vitest';
import { NO_INPUT, Sim, W, type Input } from '../src/game/sim';
import { ENDLESS_STAGE, RUSH_STAGE, STAGES } from '../src/data/stages';
import { BOSSES, RUSH } from '../src/data/bosses';

const run = (s: Sim, n: number, inp: Input = NO_INPUT) => { for (let i = 0; i < n; i++) s.step(inp); };

describe('M4: 스테이지 7~12 · 최종 보스', () => {
  it('스테이지 12개, 보스 러시는 스테이지 보스 12마리', () => {
    expect(STAGES).toHaveLength(12);
    expect(RUSH).toEqual(STAGES.map(s => s.boss));
  });

  it('요괴왕 모함은 4 페이즈', () => {
    expect(BOSSES.king.phases).toHaveLength(4);
  });

  it('8 바람 고원: 적 탄이 바람에 옆으로 밀린다', () => {
    const s = new Sim({ seed: 1, ship: 'dragon', waves: { ...STAGES[7], waves: [] } });
    s.frame = 60; // 바람이 부는 때
    s.addBullet(W / 2, 100, 0, 1);
    const b = s.eb.find(v => v.alive)!;
    run(s, 30);
    // 옆으로 밀리지만 속도가 쌓이지는 않는다
    expect(Math.abs(b.x - W / 2)).toBeGreaterThan(5);
    expect(b.vx).toBe(0);
  });

  it('10 폐허 성곽: 벽 뒤에 숨은 포대는 맞지 않는다', () => {
    const s = new Sim({ seed: 1, ship: 'dragon', waves: { length: 999, waves: [], loop: true } });
    const e = s.spawnEnemy('ground', 'popup', s.px, -60)!;
    e.y = 500; e.t = 10;
    expect(s.hidden(e)).toBe(true);
    e.t = 120;
    expect(s.hidden(e)).toBe(false);
  });

  it('11 화산: 불기둥 예고 뒤 그 띠에 있으면 맞는다', () => {
    const s = new Sim({ seed: 1, ship: 'dragon', waves: { length: 999, waves: [], loop: true } });
    s.iframes = 0;
    s.addBolt(s.px, 60, true);
    run(s, 100);
    expect(s.lives).toBe(2);
  });
});

describe('M4: 이어하기 · 보스 러시 · 끝없는 모드', () => {
  it('이어하기: 점수 0, 목숨·폭탄 처음처럼, 진행은 그대로', () => {
    const s = new Sim({ seed: 1, ship: 'dragon', waves: STAGES[2], stage: 3, lives: 1 });
    run(s, 600);
    s.score = 123456; s.iframes = 0; s.power = 3;
    s.addBullet(s.px, s.py, 0, 0);
    s.step(NO_INPUT);
    expect(s.state).toBe('over');
    const t = s.stageT;
    s.continueRun();
    expect([s.state, s.score, s.lives, s.power, s.continued]).toEqual(['play', 0, 1, 2, true]);
    run(s, 10);
    expect(s.stageT).toBeGreaterThan(t);
  });

  it('보스 러시: 12마리를 차례로 잡으면 클리어, 사이에 P·B 보급', () => {
    const s = new Sim({ seed: 1, ship: 'dragon', waves: RUSH_STAGE });
    s.iframes = 1e12;
    const names: string[] = [];
    let supplies = 0;
    for (let i = 0; i < 60 * 60 * 20 && s.state === 'play'; i++) {
      s.step(NO_INPUT);
      for (const e of s.events) if (e.t === 'bossIn') names.push(e.name);
      // 보스는 바로 쓰러뜨린다 (흐름만 본다)
      if (s.boss?.state === 'fight') (s as unknown as { hitBoss(d: number): void }).hitBoss(1e9);
      if (!s.boss) supplies = Math.max(supplies, s.items.filter(v => v.alive && v.kind === 'B').length);
    }
    expect(names).toEqual(RUSH.map(id => BOSSES[id].name));
    expect(s.state).toBe('clear');
    expect(supplies).toBeGreaterThan(0);
    expect(s.bossScore).toBe(RUSH.reduce((a, _, i) => a + 50000 * (i + 1), 0));
  });

  it('끝없는 모드: 잡몹이 계속 나오고 점점 빨라지며 5분에 보스', () => {
    const s = new Sim({ seed: 1, ship: 'dragon', waves: ENDLESS_STAGE, lives: 1 });
    s.iframes = 1e12;
    let boss = false;
    for (let i = 0; i < 60 * 60 * 5 + 120; i++) { s.step(NO_INPUT); if (s.events.some(e => e.t === 'bossIn')) boss = true; }
    expect(boss).toBe(true);
    expect(s.endlessMul).toBeGreaterThan(1.4);
    expect(s.kills).toBeGreaterThan(50);
    expect(s.state).toBe('play');
  });
});

describe('검토 반영 (11-27)', () => {
  const EMPTY = { length: 9999, waves: [], loop: true };
  it('맞아서 떨군 P 는 곧바로 다시 줍지 않는다 (파워가 실제로 준다)', () => {
    const s = new Sim({ seed: 1, ship: 'dragon', waves: EMPTY });
    s.power = 3; s.iframes = 0;
    s.addBullet(s.px, s.py, 0, 0);
    run(s, 10);
    expect(s.power).toBe(2);
  });

  it('어려움: 폭탄으로 잡은 적은 되받아치기탄을 쏘지 않는다', () => {
    const s = new Sim({ seed: 1, ship: 'ox', waves: EMPTY, difficulty: 'hard' });
    for (let i = 0; i < 6; i++) s.spawnEnemy('small', 'hover', 100 + i * 90, 200)!;
    run(s, 30);
    s.step({ ...NO_INPUT, bomb: true });
    expect(s.ebCount).toBe(0);
  });

  it('보스 몸통에 부딪히면 맞고, 보스를 잡은 뒤 정산까지는 무적', () => {
    const s = new Sim({ seed: 1, ship: 'dragon', waves: { length: 0, waves: [], boss: 'crab' } });
    for (let i = 0; i < 400 && s.boss?.state !== 'fight'; i++) s.step(NO_INPUT);
    const b = s.boss!;
    s.iframes = 0;
    s.px = b.x + b.def.core.x; s.py = b.y + b.def.core.y;
    s.step(NO_INPUT);
    expect(s.lives).toBe(2);
    (s as unknown as { hitBoss(d: number): void }).hitBoss(1e9);
    run(s, 5);
    expect(s.iframes).toBeGreaterThan(100);
  });
});
