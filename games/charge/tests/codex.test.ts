import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSS_IDS, ENEMY_IDS } from '../src/data/balance';
import { NO_MODS } from '../src/data/growth';
import { STAGES, endlessStage, stageOf } from '../src/data/stages';
import { CODEX, CODEX_IDS, codexKey, createCodex, firstStageOf, parseSeen, seenOf, stageFoeIds, stageFoes, type CodexId } from '../src/game/codex';
import { STEP, createRun, setTarget, step, type SimEvent } from '../src/game/sim';
import { greedy } from './policy';

const memStore = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

/** 자동 조종으로 한 판을 돌리며 이벤트로 만난 것을 모은다 */
function play(stageId: string, maxSec = 180) {
  const st = stageId === 'endless' ? endlessStage() : stageOf(stageId)!;
  const s = createRun(st, 'rat', NO_MODS);
  const seen = new Set<CodexId>();
  for (let i = 0; i < maxSec / STEP && s.phase !== 'clear' && s.phase !== 'fail'; i++) {
    setTarget(s, greedy(s));
    step(s);
    for (const e of s.events) {
      const id = seenOf(s, e);
      if (id) seen.add(id);
    }
    s.events.length = 0;
  }
  return { s, seen };
}

describe('도감 목록', () => {
  it('요괴 9종 + 보스 12종, 설명과 그림이 모두 있다', () => {
    expect(CODEX).toHaveLength(ENEMY_IDS.length + BOSS_IDS.length);
    expect(new Set(CODEX_IDS).size).toBe(CODEX.length);
    for (const c of CODEX) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.desc.length).toBeGreaterThan(4);
      expect(existsSync(new URL(`../public/art/${c.art}.png`, import.meta.url)), c.art).toBe(true);
    }
  });

  it('모든 항목이 모험 어딘가에 나온다 (보스는 그 지역 5번째)', () => {
    for (const k of ENEMY_IDS) expect(firstStageOf(`e:${k}`), k).toMatch(/^\d+-\d$/);
    BOSS_IDS.forEach((k, i) => expect(firstStageOf(`b:${k}`)).toBe(`${i + 1}-5`));
    expect(firstStageOf('e:imp')).toBe('1-1');
  });
});

describe('스테이지에 나오는 요괴', () => {
  it('길에 놓인 순서대로 한 번씩, 보스가 불러내는 요괴도 넣는다', () => {
    expect(stageFoes(stageOf('1-1')!)).toEqual({ enemies: ['imp'], boss: null });
    expect(stageFoes(stageOf('1-2')!).enemies).toEqual(['imp', 'wisp']);
    expect(stageFoes(stageOf('1-5')!).boss).toBe('bigDokkaebi');
    // 12-5 염라대왕은 해골 병사를 부른다
    expect(stageFoes(stageOf('12-5')!).enemies).toContain('skeleton');
    expect(stageFoeIds(stageOf('12-5')!).at(-1)).toBe('b:yeomra');
  });

  it('한 줄에 그릴 만큼만 나온다 (요괴 6종 이하)', () => {
    for (const st of STAGES) expect(stageFoes(st).enemies.length, st.id).toBeLessThanOrEqual(6);
  });
});

describe('판 이벤트로 기록', () => {
  it('이벤트 종류별', () => {
    const horde = { kind: 'fox' } as never;
    const chief = { boss: { kind: 'chief' } } as never;
    const big = { boss: { kind: 'gumiho' } } as never;
    for (const type of ['kill', 'emerge', 'revive', 'clash', 'fire', 'summon'] as const) {
      expect(seenOf(chief, { type, horde, n: 1, lost: 0, killed: 0 } as SimEvent)).toBe('e:fox');
    }
    expect(seenOf(big, { type: 'bossWarn', bands: [] })).toBe('b:gumiho');
    expect(seenOf(big, { type: 'bossHit', bands: [], lost: 0 })).toBe('b:gumiho');
    expect(seenOf(chief, { type: 'bossWarn', bands: [] })).toBeNull();
    expect(seenOf(chief, { type: 'bossDown', boss: { kind: 'yeomra' } as never })).toBe('b:yeomra');
    expect(seenOf(big, { type: 'clear' })).toBeNull();
    expect(seenOf(big, { type: 'burn', lost: 1 })).toBeNull();
  });

  it('1-1 을 달리면 꼬마 도깨비만, 1-5 를 달리면 큰 도깨비도 만난다', () => {
    expect([...play('1-1').seen]).toEqual(['e:imp']);
    const r = play('1-5');
    expect(r.seen.has('b:bigDokkaebi')).toBe(true);
    // 만난 것은 그 스테이지의 "나오는 요괴" 안에 있다
    const listed = stageFoeIds(stageOf('1-5')!);
    for (const id of r.seen) expect(listed).toContain(id);
  });
});

describe('기기 저장', () => {
  it('처음 만난 것만 저장하고, 다시 열면 남아 있다', () => {
    const st = memStore();
    const c = createCodex(st, 'u1');
    expect(c.add('e:imp')).toBe(true);
    expect(c.add('e:imp')).toBe(false);
    expect(c.add('b:yeomra')).toBe(true);
    expect(c.count()).toBe(2);
    const again = createCodex(st, 'u1');
    expect(again.has('e:imp') && again.has('b:yeomra')).toBe(true);
    expect(again.has('e:wisp')).toBe(false);
    // 계정마다 따로
    expect(createCodex(st, 'u2').count()).toBe(0);
  });

  it('다른 탭이 그 사이 적은 것을 지우지 않는다', () => {
    const st = memStore();
    const a = createCodex(st, 'u');
    const b = createCodex(st, 'u');
    a.add('e:imp');
    b.add('e:wisp');
    expect(parseSeen(st.m.get(codexKey('u'))!)).toEqual(new Set(['e:imp', 'e:wisp']));
  });

  it('망가진 값·모르는 이름·저장 실패에도 멈추지 않는다', () => {
    expect(parseSeen('{oops').size).toBe(0);
    expect(parseSeen('"x"').size).toBe(0);
    expect([...parseSeen('["e:imp","e:nope",3,"b:chief"]')]).toEqual(['e:imp']);
    const broken = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    const c = createCodex(broken, 'u');
    expect(c.add('e:imp')).toBe(true);
    expect(c.has('e:imp')).toBe(true);
    expect(createCodex(null, 'u').add('e:fox')).toBe(true);
    expect(c.add('e:nope' as CodexId)).toBe(false);
  });
});
