import { describe, expect, it } from 'vitest';
import { ELITE_FROM_ROW, NODE_RATIO, allocate, apply, choices, genMap, newRun, removePrice, replay, restHeal, type RunState } from '../src/game/rules';
import { playRun, runInput } from './bot';

/** 보스 전까지 battle 이 아닌 칸을 찾아 들어간다 (없으면 null) */
function walkTo(run: RunState, type: string): boolean {
  for (let guard = 0; guard < 400; guard++) {
    if (run.phase === 'map') {
      const next = run.map.rows[run.row + 1];
      if (!next) return false;
      const col = choices(run).find((c) => next[c].type === type);
      if (col !== undefined) {
        apply(run, { t: 'go', col });
        return true;
      }
    }
    if (run.phase === 'dead' || run.phase === 'won') return false;
    apply(run, runInput(run));
  }
  return false;
}

describe('지도', () => {
  it('12줄 + 보스, 한 줄 2~4칸, 모든 칸이 이어져 있다', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const m = genMap(seed, 1);
      expect(m.rows).toHaveLength(13);
      expect(m.rows[12]).toHaveLength(1);
      expect(m.rows[12][0].type).toBe('boss');
      for (let y = 0; y < 12; y++) {
        const row = m.rows[y];
        expect(row.length).toBeGreaterThanOrEqual(2);
        expect(row.length).toBeLessThanOrEqual(4);
        for (const n of row) expect(n.next.length).toBeGreaterThan(0);
        // 위 줄의 모든 칸은 들어오는 길이 있다
        const into = new Set(row.flatMap((n) => n.next));
        expect(into.size).toBe(m.rows[y + 1].length);
        // 길이 엇갈리지 않는다
        const edges = row.flatMap((n) => n.next.map((j) => [n.col, j]));
        for (const [a, b] of edges) for (const [c, d] of edges) expect((a - c) * (b - d)).toBeGreaterThanOrEqual(0);
      }
      expect(m.rows[0].every((n) => n.type === 'battle')).toBe(true);
      for (let y = 0; y < ELITE_FROM_ROW; y++) expect(m.rows[y].some((n) => n.type === 'elite')).toBe(false);
      expect(m.region).toBe('bamboo');
      expect(m.elites).toHaveLength(2);
      expect(m.elites).not.toContain(m.boss);
    }
  });

  it('칸 비율이 스펙대로 (전투 45 · 정예 10 · 상점 10 · 쉼터 12 · 보물 8 · 이야기 15)', () => {
    const a = allocate(100);
    for (const [k, pct] of NODE_RATIO) expect(a[k]).toBe(pct);
    const sum: Record<string, number> = {};
    let total = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const row of genMap(seed, 1).rows.slice(0, 12))
        for (const n of row) {
          sum[n.type] = (sum[n.type] ?? 0) + 1;
          total++;
        }
    }
    for (const [k, pct] of NODE_RATIO) expect(Math.abs((sum[k] / total) * 100 - pct)).toBeLessThan(2);
  });

  it('같은 씨앗 = 같은 지도, 보물 지도는 보물 칸 +2', () => {
    expect(JSON.stringify(genMap(5, 1))).toBe(JSON.stringify(genMap(5, 1)));
    const count = (m: ReturnType<typeof genMap>) => m.rows.flat().filter((n) => n.type === 'treasure').length;
    expect(count(genMap(5, 1, 2)) - count(genMap(5, 1))).toBe(2);
  });

  it('이어지지 않은 칸으로는 못 간다', () => {
    const run = newRun({ seed: 3, hero: 'tiger' });
    expect(apply(run, { t: 'go', col: 9 }).ok).toBe(false);
    expect(apply(run, { t: 'go', col: 0 }).ok).toBe(true);
    expect(run.phase).toBe('battle');
    expect(run.log).toHaveLength(1);
  });
});

describe('칸', () => {
  it('전투 승리 → 엽전 + 카드 3장 중 1장(건너뛰기 가능)', () => {
    const run = newRun({ seed: 11, hero: 'tiger' });
    apply(run, { t: 'go', col: 0 });
    while (run.phase === 'battle') apply(run, runInput(run));
    expect(run.phase).toBe('reward');
    const gold = run.reward!.items.find((x) => x.k === 'gold')!;
    expect(gold.k === 'gold' && gold.n >= 12 && gold.n <= 18).toBe(true);
    const card = run.reward!.items.find((x) => x.k === 'card')!;
    expect(card.k === 'card' && card.options.length).toBe(3);
    const deck = run.deck.length;
    expect(apply(run, { t: 'leave' }).ok).toBe(true); // 건너뛰기
    expect(run.deck.length).toBe(deck);
    expect(run.phase).toBe('map');
  });

  it('쉼터: 체력 30% 회복 또는 카드 1장 강화 (둘 중 하나)', () => {
    let tried = 0;
    for (let seed = 1; seed < 40 && tried < 3; seed++) {
      const run = newRun({ seed, hero: 'tiger' });
      if (!walkTo(run, 'rest')) continue;
      tried++;
      run.hp = 20;
      expect(restHeal(run)).toBe(Math.floor(run.maxHp * 0.3));
      const up = run.deck.find((c) => !c.up)!;
      expect(apply(run, { t: 'upgrade', uids: [up.uid] }).ok).toBe(true);
      expect(up.up).toBe(true);
      expect(apply(run, { t: 'heal' }).ok).toBe(false);
      expect(apply(run, { t: 'leave' }).ok).toBe(true);
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('상점: 사고 · 카드 없애기 75(+25) · 엽전이 모자라면 못 삼', () => {
    let tried = 0;
    for (let seed = 1; seed < 60 && tried < 3; seed++) {
      const run = newRun({ seed, hero: 'tiger' });
      if (!walkTo(run, 'shop')) continue;
      tried++;
      const s = run.shop!;
      expect(s.cards.length).toBe(5);
      expect(s.cards.some((c) => c.id === 'tigerMajesty')).toBe(false); // 2번째 전용카드는 보상에서만
      for (const c of s.cards) expect(c.price).toBeGreaterThanOrEqual(50);
      for (const c of s.cards) expect(c.price).toBeLessThanOrEqual(150);
      for (const r of s.relics) expect(r.price).toBeGreaterThanOrEqual(150);
      run.gold = 1000;
      expect(removePrice(run)).toBe(75);
      const n = run.deck.length;
      expect(apply(run, { t: 'remove', uid: run.deck[0].uid }).ok).toBe(true);
      expect(run.deck.length).toBe(n - 1);
      expect(run.gold).toBe(925);
      expect(removePrice(run)).toBe(100);
      expect(apply(run, { t: 'remove', uid: run.deck[0].uid }).ok).toBe(false); // 한 번만
      expect(apply(run, { t: 'buy', kind: 'card', i: 0 }).ok).toBe(true);
      expect(apply(run, { t: 'buy', kind: 'card', i: 0 }).ok).toBe(false); // 팔림
      run.gold = 0;
      expect(apply(run, { t: 'buy', kind: 'card', i: 1 }).ok).toBe(false);
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('덱은 5장 아래로 없앨 수 없다', () => {
    for (let seed = 1; seed < 60; seed++) {
      const run = newRun({ seed, hero: 'tiger' });
      if (!walkTo(run, 'shop')) continue;
      run.deck = run.deck.slice(0, 5);
      run.gold = 999;
      expect(apply(run, { t: 'remove', uid: run.deck[0].uid }).ok).toBe(false);
      return;
    }
  });

  it('보물: 부적 1개', () => {
    for (let seed = 1; seed < 60; seed++) {
      const run = newRun({ seed, hero: 'tiger' });
      if (!walkTo(run, 'treasure')) continue;
      const n = run.relics.length;
      expect(apply(run, { t: 'open' }).ok).toBe(true);
      expect(run.relics.length).toBe(n + 1);
      expect(apply(run, { t: 'open' }).ok).toBe(false);
      return;
    }
    throw new Error('보물 칸을 못 찾음');
  });

  it('이야기: 선택 → (카드 고르기) → 떠나기, 한 판에 같은 사건 한 번', () => {
    for (let seed = 1; seed < 60; seed++) {
      const run = newRun({ seed, hero: 'tiger' });
      run.gold = 200;
      if (!walkTo(run, 'event')) continue;
      expect(run.event!.chosen).toBe(-1);
      expect(apply(run, { t: 'leave' }).ok).toBe(false);
      const id = run.event!.id;
      while (run.phase === 'event') expect(apply(run, runInput(run)).ok).toBe(true);
      expect(run.seenEvents).toContain(id);
      return;
    }
  });

  it('정예 승리 → 부적, 체력 60% 보스', () => {
    for (let seed = 1; seed < 80; seed++) {
      const run = newRun({ seed, hero: 'tiger' });
      if (!walkTo(run, 'elite')) continue;
      const f = run.battle!.foes[0];
      expect(f.elite).toBe(true);
      expect(run.map.elites).toContain(f.id);
      run.hp = 999;
      run.maxHp = 999;
      while (run.phase === 'battle') apply(run, runInput(run));
      if (!run.reward) throw new Error(run.phase + ' ' + run.hp + ' ' + JSON.stringify(run.battle?.over));
      expect(run.reward!.items.some((x) => x.k === 'relic')).toBe(true);
      return;
    }
  });
});

describe('한 판 (1막)', () => {
  it('봇이 1막을 끝까지 간다 — 막 보스 승리면 체력 회복·전설 카드·보스 부적 3개 중 1개', () => {
    let wins = 0;
    let bossRewards = 0;
    const N = 60;
    for (let s = 0; s < N; s++) {
      const run = newRun({ seed: 9000 + s, hero: 'tiger' });
      let sawBoss = false;
      for (let n = 0; n < 20000 && run.phase !== 'dead' && run.phase !== 'won'; n++) {
        if (run.phase === 'reward' && run.reward!.boss && !sawBoss) {
          sawBoss = true;
          bossRewards++;
          const card = run.reward!.items.find((x) => x.k === 'card')!;
          expect(card.k === 'card' && card.options.every((c) => ['diamond', 'haetae'].includes(c.id))).toBe(true);
          const br = run.reward!.items.find((x) => x.k === 'bossRelic')!;
          expect(br.k === 'bossRelic' && br.options.length).toBe(3);
        }
        expect(apply(run, runInput(run)).ok).toBe(true);
      }
      if (run.phase === 'won') wins++;
      expect(['dead', 'won']).toContain(run.phase);
    }
    console.log(`봇 어흥이 1막 클리어 ${wins}/${N}`);
    expect(bossRewards).toBe(wins);
    expect(wins).toBeGreaterThan(0);
  });

  it('씨앗 + 입력 기록으로 다시 돌리면 같은 판 (서버 검증)', () => {
    for (const seed of [1, 77, 4242]) {
      const a = newRun({ seed, hero: 'tiger' });
      playRun(a);
      const { run: b, bad } = replay(seed, 'tiger', a.log);
      expect(bad).toBe(-1);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('칸에 들어갈 때 저장(JSON)한 판을 불러와 같은 입력을 넣으면 같은 결과 — 전투 중 종료는 그 전투 처음부터', () => {
    const a = newRun({ seed: 31, hero: 'tiger' });
    // 두 번째 칸 진입 직후를 저장
    let saved: string | null = null;
    let goes = 0;
    while (a.phase !== 'dead' && a.phase !== 'won') {
      const i = runInput(a);
      apply(a, i);
      if (i.t === 'go' && ++goes === 2) saved = JSON.stringify(a);
    }
    const b: RunState = JSON.parse(saved!);
    const rest = a.log.slice(b.log.length);
    for (const i of rest) expect(apply(b, i).ok).toBe(true);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
