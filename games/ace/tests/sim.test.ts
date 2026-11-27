import { describe, expect, it } from 'vitest';
import { CAP, H, HIT_IFRAMES, MAX_POWER, NO_INPUT, SCORE, Sim, START_BOMBS, W, type Input } from '../src/game/sim';
import { PROTO, type WaveScript } from '../src/data/waves';

const EMPTY: WaveScript = { length: 9999, waves: [] };
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
