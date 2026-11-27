import { describe, expect, it } from 'vitest';
import { DIFFICULTY, NO_INPUT, Sim, type Input } from '../src/game/sim';
import { SHIPS, SHIP_ORDER } from '../src/data/ships';
import { check, generate, THEMES } from '../scripts/stages';
import type { StageDef, WaveScript } from '../src/data/waves';
import S1 from '../src/data/stages/stage1.json';
import S2 from '../src/data/stages/stage2.json';
import S3 from '../src/data/stages/stage3.json';
import S4 from '../src/data/stages/stage4.json';
import S5 from '../src/data/stages/stage5.json';
import S6 from '../src/data/stages/stage6.json';

const STAGES = [S1, S2, S3, S4, S5, S6] as unknown as StageDef[];
const EMPTY: WaveScript = { length: 9999, waves: [], loop: true };
const run = (s: Sim, n: number, inp: Input = NO_INPUT) => { for (let i = 0; i < n; i++) s.step(inp); };

describe('M3: 기체 13종', () => {
  it('13종 모두 4단계 기본샷이 있고 해금 조건이 지시서대로', () => {
    expect(SHIP_ORDER).toHaveLength(13);
    for (const id of SHIP_ORDER) expect(SHIPS[id].fire).toHaveLength(4);
    expect(SHIP_ORDER.filter(id => SHIPS[id].unlock === 0)).toEqual(['rat', 'ox', 'dragon']);
    expect(SHIPS.tiger.unlock).toBe(1);
    expect(SHIPS.pig.unlock).toBe(9);
    expect(SHIPS.cat.unlock).toBe('buy');
  });

  for (const id of SHIP_ORDER) {
    it(`${SHIPS[id].name}: 기본샷 · 3칸 차지샷 · 폭탄으로 중형기를 잡는다`, () => {
      const s = new Sim({ seed: 3, ship: id, waves: EMPTY });
      s.power = 4; s.iframes = 1e9;
      const e = s.spawnEnemy('medium', 'hover', s.px, 500)!;
      run(s, 12);
      run(s, 120, { ...NO_INPUT, charge: true });
      run(s, 1);
      expect(s.events.some(v => v.t === 'charge') || s.act.t > 0).toBe(true);
      run(s, 200);
      expect(e.alive).toBe(false);
      const e2 = s.spawnEnemy('small', 'hover', 200, 400)!;
      run(s, 40);
      s.step({ ...NO_INPUT, bomb: true });
      run(s, 60);
      expect(e2.alive).toBe(false);
      expect(s.ebCount).toBeLessThanOrEqual(400);
    });
  }

  it('황소호 실드는 피격 1회를 막는다', () => {
    const s = new Sim({ seed: 1, ship: 'ox', waves: EMPTY });
    s.iframes = 0;
    s.addBullet(s.px, s.py, 0, 0);
    s.step(NO_INPUT);
    expect(s.lives).toBe(3);
    expect(s.shieldUp).toBe(false);
  });

  it('고양이 폭탄은 2초 동안 적을 멈춘다', () => {
    const s = new Sim({ seed: 1, ship: 'cat', waves: EMPTY });
    const e = s.spawnEnemy('medium', 'dive', 100, 100)!;
    e.hp = 9999;
    s.step({ ...NO_INPUT, bomb: true });
    const y = e.y;
    run(s, 60);
    expect(e.y).toBe(y);
  });
});

describe('M3: 난이도', () => {
  it('쉬움 = 탄 속도 70% · 목숨 5, 어려움 = 되받아치기탄', () => {
    const easy = new Sim({ seed: 1, ship: 'dragon', waves: EMPTY, difficulty: 'easy' });
    expect(easy.lives).toBe(5);
    expect(easy.speedMul).toBeCloseTo(DIFFICULTY.easy.bulletSpeed);
    const hard = new Sim({ seed: 1, ship: 'dragon', waves: EMPTY, difficulty: 'hard' });
    const e = hard.spawnEnemy('small', 'hover', hard.px, 300)!;
    e.hp = 0.1;
    run(hard, 40);
    expect(e.alive).toBe(false);
    expect(hard.ebCount).toBeGreaterThan(0);
  });

  it('아케이드: 다음 스테이지로 점수·목숨·폭탄·파워를 이어 간다', () => {
    const a = new Sim({ seed: 1, ship: 'dragon', waves: EMPTY });
    a.power = 3; a.bombs = 4;
    const b = new Sim({ seed: 2, ship: 'dragon', waves: EMPTY, carry: { ...a.carry(), score: 12345, lives: 2 } });
    expect([b.score, b.lives, b.bombs, b.power]).toEqual([12345, 2, 4, 3]);
  });
});

describe('M3: 스테이지 1~6', () => {
  it('스테이지 JSON 검사 통과 (패턴·보스 이름, 시간, 위치)', () => {
    for (const st of STAGES) expect(check(st), `stage${st.id}`).toEqual([]);
  });

  it('생성기는 같은 씨앗이면 같은 등장표 (JSON 파일과 같다)', () => {
    for (const th of THEMES) expect(generate(th)).toEqual(STAGES[th.id - 1]);
  });

  for (const st of STAGES) {
    it(`${st.id}. ${st.name}: 중간 보스 → 보스 → 클리어, 2.5~4분`, () => {
      const s = new Sim({ seed: 9, ship: 'dragon', waves: st, stage: st.id });
      s.iframes = 1e12; s.power = 4;
      const seen: string[] = [];
      for (let i = 0; i < 60 * 400 && s.state === 'play'; i++) {
        s.step({ ...NO_INPUT, kx: Math.sin(i / 50) });
        for (const e of s.events) if (e.t === 'bossIn' || e.t === 'clear') seen.push(e.t === 'bossIn' ? (e.mid ? 'mid' : 'boss') : 'clear');
      }
      expect(seen).toEqual(['mid', 'boss', 'clear']);
      expect(s.frame / 60).toBeGreaterThan(140);
      expect(s.frame / 60).toBeLessThan(280);
    });
  }
});

import { emptyProgress, recordClear, shipOpen, MODES } from '../src/game/progress';
describe('M3: 해금', () => {
  it('처음엔 쥐·소·용, 스테이지를 처음 깰 때마다 하나씩, 고양이는 구매', () => {
    const p = emptyProgress();
    expect(SHIP_ORDER.filter(id => shipOpen(p, id))).toEqual(['rat', 'ox', 'dragon']);
    expect(recordClear(p, 1)).toBe('tiger');
    expect(recordClear(p, 1)).toBe(null);
    expect(recordClear(p, 2)).toBe('rabbit');
    expect(shipOpen(p, 'rabbit')).toBe(true);
    expect(shipOpen(p, 'cat')).toBe(false);
    expect(MODES.practice(p)).toBe(true);
    expect(MODES.endless(p)).toBe(false);
  });
});
