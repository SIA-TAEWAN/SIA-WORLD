import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSON_TABLES, jsonText } from '../src/data/tables';
import { CARDS, ENEMIES, EVENTS, HEROES, RELICS, REGIONS, cardDef, enemyDef, hasCard, moveDef } from '../src/game/rules';

describe('데이터', () => {
  it('src/data/*.json 이 규칙 코드 데이터와 같다 (npm run json)', () => {
    for (const [name, v] of Object.entries(JSON_TABLES)) {
      const file = new URL(`../src/data/${name}`, import.meta.url);
      expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), name).toBe(jsonText(v));
    }
  });

  it('id 가 겹치지 않는다', () => {
    for (const list of [CARDS, ENEMIES, HEROES, RELICS, EVENTS, REGIONS] as { id: string }[][]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('카드 86장 = 기본 2 · 일반 28 · 고급 20 · 전설 10 · 영웅 전용 26 (+ 내림카드 2)', () => {
    const count = (r: string) => CARDS.filter((c) => c.rarity === r).length;
    expect([count('basic'), count('common'), count('uncommon'), count('legend'), count('hero') + count('hero2')]).toEqual([2, 28, 20, 10, 26]);
    expect(CARDS.filter((c) => c.rarity !== 'curse')).toHaveLength(86);
    expect(count('curse')).toBe(2);
  });

  it('고를 수 있는 영웅의 카드는 다 있다, 체력은 스펙 값 (6단계 밸런스로 바꾼 값 — PROGRESS.md 스펙에서 바꾼 값)', () => {
    const hp = Object.fromEntries(HEROES.map((h) => [h.id, h.hp]));
    expect(hp).toEqual({ rat: 68, ox: 80, tiger: 80, rabbit: 74, dragon: 75, snake: 72, horse: 62, sheep: 64, monkey: 70, rooster: 70, dog: 62, pig: 90, cat: 70 });
    for (const h of HEROES.filter((x) => x.ready)) for (const c of h.cards) expect(hasCard(c), c).toBe(true);
  });

  it('요괴 행동·순서가 서로 맞는다', () => {
    for (const e of ENEMIES) {
      for (const ph of [e.phase1, e.phase2]) {
        if (!ph) continue;
        const ids = ph.ai.type === 'cycle' ? ph.ai.order : ph.ai.weights.map(([id]) => id);
        for (const id of ids) expect(ph.moves.some((m) => m.id === id), `${e.id}.${id}`).toBe(true);
        for (const m of ph.moves) for (const o of m.ops) if (o.op === 'summon') enemyDef(o.id);
      }
    }
    expect(moveDef(enemyDef('gumiho'), 1, 'claw').ops[0]).toEqual({ op: 'dmg', n: 9 });
  });

  it('지역의 요괴·조합이 다 있다 (열린 지역)', () => {
    for (const r of REGIONS.filter((x) => x.ready)) {
      for (const id of [...r.enemies, ...r.bosses, ...r.easy.flat(), ...r.normal.flat()]) enemyDef(id);
    }
  });

  it('카드 강화는 기력-1 이거나 수치 상승', () => {
    for (const c of CARDS) {
      if (!c.up) continue;
      if (c.up.cost !== undefined) expect(c.up.cost).toBe(c.cost - 1);
      else expect(JSON.stringify(c.up.ops)).not.toBe(JSON.stringify(c.ops));
      cardDef(c.id);
    }
  });
});
