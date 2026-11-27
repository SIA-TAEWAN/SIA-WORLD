import { describe, expect, it } from 'vitest';
import { BONUS, CAP, CHARGE_CELL, COIN_STEP, H, HIT_IFRAMES, MAX_POWER, NO_INPUT, SCORE, Sim, START_BOMBS, W, type Input } from '../src/game/sim';
import { BOSS_SCORE_PER_STAGE, PART_SCORE } from '../src/data/bosses';
import STAGE1 from '../src/data/stages/stage1.json';
import { PROTO, type WaveScript } from '../src/data/waves';

const EMPTY: WaveScript = { length: 9999, waves: [], loop: true };
const make = (o: Partial<ConstructorParameters<typeof Sim>[0]> = {}) => new Sim({ seed: 7, ship: 'dragon', waves: EMPTY, ...o });
const run = (s: Sim, n: number, inp: Input = NO_INPUT) => { for (let i = 0; i < n; i++) s.step(inp); };

describe('시아에이스 시뮬레이션', () => {
  it('같은 씨앗·같은 입력이면 같은 결과', () => {
    const a = make({ waves: PROTO }), b = make({ waves: PROTO });
    const inp = { ...NO_INPUT, kx: 1 };
    for (let i = 0; i < 1800; i++) { const k = { ...inp, kx: Math.sin(i / 40) }; a.step(k); b.step(k); }
    expect(a.score).toBe(b.score);
    expect(a.px).toBe(b.px);
    expect(a.ebCount).toBe(b.ebCount);
  });

  it('적 탄은 400발을 넘지 않는다', () => {
    const s = make({ stress: true, lives: 999 });
    for (let i = 0; i < 2000; i++) for (let k = 0; k < 6; k++) s.addBullet(W / 2, 200, Math.cos(i + k) * 0.1, 0.1);
    expect(s.ebCount).toBe(CAP.eb);
    expect(s.eb.filter(b => b.alive).length).toBe(CAP.eb);
    run(s, 10);
    expect(s.eb.filter(b => b.alive).length).toBe(s.ebCount);
  });

  it('드래그는 상대 이동, 화면 밖으로 나가지 않는다', () => {
    const s = make();
    const x0 = s.px;
    s.step({ ...NO_INPUT, dx: 20 });
    expect(s.px).toBe(x0 + 20);
    run(s, 200, { ...NO_INPUT, dx: 30, dy: 30 });
    expect(s.px).toBeLessThanOrEqual(W - 36);
    expect(s.py).toBeLessThanOrEqual(H - 60);
  });

  it('폭탄: 적 탄 전부 제거 + 1.5초 무적, 하나 줄어든다', () => {
    const s = make();
    for (let i = 0; i < 50; i++) s.addBullet(100 + i, 300, 0, 0.5);
    s.step({ ...NO_INPUT, bomb: true });
    expect(s.ebCount).toBe(0);
    expect(s.eb.some(b => b.alive)).toBe(false);
    expect(s.bombs).toBe(START_BOMBS - 1);
    expect(s.iframes).toBeGreaterThanOrEqual(88);
  });

  it('피격: 목숨 -1, 파워 1단계 하락 + P 떨굼 + 2초 무적', () => {
    const s = make();
    s.power = 3; s.iframes = 0;
    s.addBullet(s.px, s.py, 0, 0);
    s.step(NO_INPUT);
    expect(s.lives).toBe(2);
    expect(s.power).toBe(2);
    expect(s.items.filter(i => i.alive && i.kind === 'P').length).toBe(1);
    expect(s.iframes).toBe(HIT_IFRAMES - 1);
  });

  it('목숨이 다 떨어지면 끝', () => {
    const s = make({ lives: 1 });
    s.iframes = 0;
    s.addBullet(s.px, s.py, 0, 0);
    s.step(NO_INPUT);
    expect(s.state).toBe('over');
  });

  it('P 로 4단계까지, 최대에서 먹으면 +1,000점 · B 는 최대 5개', () => {
    const s = make();
    for (let i = 0; i < MAX_POWER + 1; i++) { s.dropItem('P', s.px, s.py, 0); s.step(NO_INPUT); }
    expect(s.power).toBe(MAX_POWER);
    expect(s.score).toBe(SCORE.maxPowerP * 2);
    for (let i = 0; i < 6; i++) { s.dropItem('B', s.px, s.py, 0); s.step(NO_INPUT); }
    expect(s.bombs).toBe(5);
  });

  it('편대를 전멸시키면 P 하나', () => {
    const s = make({ waves: { length: 999, waves: [{ at: 0, kind: 'small', path: 'dive', x: 0.5, count: 3, gap: 4 }] } });
    s.px = W / 2; s.py = H - 100;
    let p = 0;
    for (let i = 0; i < 400 && p === 0; i++) {
      s.step(NO_INPUT);
      p = s.events.filter(e => e.t === 'kill').length ? s.items.filter(it => it.alive && it.kind === 'P').length : p;
    }
    expect(s.kills).toBe(3);
    expect(s.score).toBe(SCORE.small * 3);
    expect(p).toBe(1);
  });

  it('프로토타입 웨이브를 가만히 두면 결국 격추된다 (탄이 실제로 맞는다)', () => {
    const s = make({ waves: PROTO });
    run(s, 60 * 200);
    expect(s.state).toBe('over');
  });
});

describe('M2: 차지샷 · 금화 · 보스 · 정산', () => {
  it('누르고 있으면 게이지가 차고, 1칸 이상에서 떼면 레이저 (1칸 미만은 아무 일 없음)', () => {
    const s = make();
    run(s, 20, { ...NO_INPUT, charge: true });
    s.step(NO_INPUT);
    expect(s.laser.t).toBe(0);
    run(s, CHARGE_CELL * 2 + 1, { ...NO_INPUT, charge: true });
    expect(s.chargeCells).toBe(2);
    s.step(NO_INPUT);
    expect(s.laser.cells).toBe(2);
    expect(s.events.some(e => e.t === 'charge')).toBe(true);
    // 레이저는 위쪽 적을 관통해 녹인다
    const e = s.spawnEnemy('medium', 'hover', s.px, 300)!;
    run(s, 40);
    expect(e.alive).toBe(false);
  });

  it('금화 연속 100 → 200 → … 최대 2,000, 놓치면 처음부터', () => {
    const s = make();
    for (let i = 0; i < 22; i++) { s.dropItem('C', s.px, s.py, 0); s.step(NO_INPUT); }
    expect(s.coinChain).toBe(22);
    // 100+200+…+2000 (20개) + 2000 × 2
    expect(s.score).toBe((100 + 2000) * 20 / 2 + 4000);
    s.dropItem('C', 50, H - 10, 3);
    s.px = W - 50;
    run(s, 40);
    expect(s.coinChain).toBe(0);
    expect(s.nextCoin).toBe(COIN_STEP);
  });

  it('보스: 부위 파괴 점수, 페이즈 전환 때 탄 제거, 격파 점수 = 50,000 × 스테이지', () => {
    const s = make({ stage: 1, waves: { length: 0, waves: [], boss: 'crab' } });
    s.lives = 99;
    for (let i = 0; i < 400 && s.boss?.state !== 'fight'; i++) s.step(NO_INPUT);
    const b = s.boss!;
    expect(b.state).toBe('fight');
    // 부위 하나 부수기
    const p = b.parts[2];
    (s as unknown as { hitPart(p: unknown, d: number): void }).hitPart(p, 999);
    expect(p.alive).toBe(false);
    expect(s.partScore).toBe(PART_SCORE);
    // 페이즈 전환
    s.addBullet(100, 100, 0, 0);
    (s as unknown as { hitBoss(d: number): void }).hitBoss(b.maxHp * 0.4);
    expect(b.phase).toBe(1);
    expect(s.ebCount).toBe(0);
    (s as unknown as { hitBoss(d: number): void }).hitBoss(b.maxHp);
    expect(s.bossScore).toBe(BOSS_SCORE_PER_STAGE);
    run(s, 400);
    expect(s.state).toBe('clear');
    expect(s.tally!.bossScore).toBe(BOSS_SCORE_PER_STAGE);
    expect(s.tally!.bombBonus).toBe(s.bombs * BONUS.bomb);
    expect(s.tally!.noMiss).toBe(true);
    expect(s.tally!.noMissBonus).toBe(BONUS.noMiss);
  });

  it('보스 제한 시간이 지나면 도망가고, 클리어는 되지만 격파 점수는 없다', () => {
    const s = make({ waves: { length: 0, waves: [], boss: 'crab' } });
    s.iframes = 1e9;
    // 구석에 붙어 있어 보스를 못 맞힌다
    run(s, 60 * 100 + 400, { ...NO_INPUT, kx: -1 });
    expect(s.state).toBe('clear');
    expect(s.bossScore).toBe(0);
  });

  it('스테이지 1 은 중간 보스 → 보스 → 클리어 순서 (무적으로 끝까지)', () => {
    const s = make({ waves: STAGE1 as WaveScript });
    s.iframes = 1e12;
    const seen: string[] = [];
    for (let i = 0; i < 60 * 400 && s.state === 'play'; i++) {
      s.step(NO_INPUT);
      for (const e of s.events) if (e.t === 'bossIn' || e.t === 'clear') seen.push(e.t === 'bossIn' ? (e.mid ? 'mid' : 'boss') : 'clear');
    }
    expect(seen).toEqual(['mid', 'boss', 'clear']);
  });
});
