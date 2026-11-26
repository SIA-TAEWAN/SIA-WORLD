/** 막 1~3 + 숨은 4막, 이야기 사건 12개의 막 조건, 엔딩 (PRD [핵심 루프]·[이야기 사건 12개]·[요괴·보스]) */
import { describe, expect, it } from 'vitest';
import { EVENTS, apply, choices, enemyDef, genMap, newRun, replay, type RunState } from '../src/game/rules';
import { playRun, runInput } from './bot';

/** 이 막의 처음으로 (지도·막 시작 위치만 바꾼다 — 기록 재실행용이 아님) */
function atAct(run: RunState, act: number) {
  run.act = act;
  run.map = genMap(run.seed, act);
  run.row = -1;
  run.col = 0;
  run.path = [];
  run.phase = 'map';
  run.hp = run.maxHp = 999;
}
/** 그 종류 칸이 다음 줄에 나올 때까지 봇으로 가다가 들어간다 */
function walkTo(run: RunState, type: string): boolean {
  for (let guard = 0; guard < 600; guard++) {
    if (run.phase === 'map') {
      const next = run.map.rows[run.row + 1];
      if (!next) return false;
      const col = choices(run).find((c) => next[c].type === type);
      if (col !== undefined) return apply(run, { t: 'go', col }).ok;
    }
    if (run.phase === 'dead' || run.phase === 'won') return false;
    run.hp = run.maxHp;
    apply(run, runInput(run));
  }
  return false;
}
/** 지금 전투를 바로 이긴다 (주인 요괴 체력 1 → 베기) */
function winBattle(run: RunState) {
  const b = run.battle!;
  for (let k = 0; k < 60 && !b.over; k++) {
    const f = b.foes.find((x) => !x.dead && !x.minion)!;
    f.hp = 1;
    f.block = 0;
    f.dodge = 0;
    f.st = {};
    b.pending = null;
    b.hand = [{ uid: 900 + k, id: 'slash' }];
    b.energy = 3;
    apply(run, { t: 'play', uid: 900 + k, target: f.uid });
  }
  expect(b.over).toBe('win');
}
/** 막 보스 칸으로 가서 이기고 보상을 받고 떠난다 */
function beatActBoss(run: RunState) {
  run.row = run.map.rows.length - 2;
  run.col = 0;
  run.phase = 'map';
  expect(apply(run, { t: 'go', col: 0 }).ok).toBe(true);
  expect(run.battle!.kind).toBe('boss');
  winBattle(run);
  if ((run.phase as string) === 'reward') expect(apply(run, { t: 'leave' }).ok).toBe(true);
}

describe('막과 지역', () => {
  it('1막 대나무숲·들판 무작위, 2막 궁궐, 3막 저승 — 막 보스는 그 지역 3마리 중 하나, 나머지 둘이 정예', () => {
    const regions = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      regions.add(genMap(seed, 1).region);
      const m2 = genMap(seed, 2);
      const m3 = genMap(seed, 3);
      expect(m2.region).toBe('palace');
      expect(m3.region).toBe('underworld');
      for (const m of [m2, m3]) {
        expect(m.rows).toHaveLength(13);
        expect(m.elites).toHaveLength(2);
        expect(m.elites).not.toContain(m.boss);
      }
    }
    expect([...regions].sort()).toEqual(['bamboo', 'field']);
  });

  it('2·3막 일반 전투는 그 지역 요괴, 정예는 그 지역 다른 보스(체력 60%)', () => {
    for (const act of [2, 3]) {
      let found = 0;
      for (let seed = 1; seed < 40 && found < 2; seed++) {
        const run = newRun({ seed, hero: 'pig' });
        atAct(run, act);
        if (!walkTo(run, 'elite')) continue;
        found++;
        const f = run.battle!.foes[0];
        expect(run.map.elites).toContain(f.id);
        expect(f.maxHp).toBe(Math.round(enemyDef(f.id).hp[0] * 0.6));
      }
      expect(found).toBeGreaterThan(0);
      const run = newRun({ seed: 3, hero: 'pig' });
      atAct(run, act);
      walkTo(run, 'battle');
      const pool = act === 2 ? ['guard', 'spirit', 'water', 'catfish'] : ['skeleton', 'ferryman', 'spirit3', 'bomber'];
      for (const f of run.battle!.foes) expect(pool).toContain(f.id);
    }
  });

  it('3막 클리어 = 일반 엔딩 (정예 3마리 미만)', () => {
    const run = newRun({ seed: 5, hero: 'pig' });
    atAct(run, 3);
    run.stats.elites = 2;
    beatActBoss(run);
    expect(run.phase).toBe('won');
    expect(run.ending).toBe('normal');
  });

  it('정예 3마리 이상 + 3막 클리어 → 숨은 4막 어둑시니 (보스만 한 번), 이기면 진짜 엔딩', () => {
    const run = newRun({ seed: 5, hero: 'pig' });
    atAct(run, 3);
    run.stats.elites = 3;
    beatActBoss(run);
    expect(run.phase).toBe('map');
    expect(run.act).toBe(4);
    expect(run.map.region).toBe('abyss');
    expect(run.map.rows).toHaveLength(1);
    expect(choices(run)).toEqual([0]);
    expect(apply(run, { t: 'go', col: 0 }).ok).toBe(true);
    const f = run.battle!.foes[0];
    expect(f.id).toBe('final');
    expect(f.boss).toBe(true);
    expect(f.maxHp).toBe(450);
    winBattle(run);
    expect(run.phase).toBe('won');
    expect(run.ending).toBe('true');
    expect(run.reward).toBeNull();
  });

  it('막 단위 기록 재실행: log.slice(0, actStart[n]) 은 n+1막 시작', () => {
    for (let s = 0; s < 40; s++) {
      const run = newRun({ seed: 700 + s, hero: 'dog' });
      playRun(run);
      if (run.actStart.length < 2) continue;
      const { run: r2, bad } = replay(run.seed, 'dog', run.log.slice(0, run.actStart[1]));
      expect(bad).toBe(-1);
      expect(r2.act).toBe(2);
      expect(r2.phase).toBe('map');
      expect(r2.row).toBe(-1);
      return;
    }
    throw new Error('2막에 간 판이 없음');
  });
});

describe('이야기 사건 12개', () => {
  it('12개, 막 조건이 스펙대로', () => {
    expect(EVENTS).toHaveLength(12);
    const acts = Object.fromEntries(EVENTS.map((e) => [e.id, e.acts]));
    expect(acts).toEqual({
      jangseung: [], ssireum: [1], jumak: [], well: [], painter: [], seonang: [], ginseng: [1],
      gut: [2, 3], foxFork: [1, 2], smith: [2, 3], monk: [], gatekeeper: [3],
    });
  });

  it('그 막에 나올 수 있는 사건만, 한 판에 같은 사건은 한 번 — 다 봤으면 보물 칸', () => {
    for (const act of [1, 2, 3]) {
      const ok = EVENTS.filter((e) => !e.acts.length || e.acts.includes(act)).map((e) => e.id);
      for (let seed = 1; seed < 30; seed++) {
        const run = newRun({ seed, hero: 'pig' });
        atAct(run, act);
        // 하나만 남기고 이미 본 것으로
        const left = ok[seed % ok.length];
        run.seenEvents = EVENTS.map((e) => e.id).filter((id) => id !== left);
        if (!walkTo(run, 'event')) continue;
        expect(run.event!.id).toBe(left);
        break;
      }
    }
    for (let seed = 1; seed < 30; seed++) {
      const run = newRun({ seed, hero: 'pig' });
      run.seenEvents = EVENTS.map((e) => e.id);
      if (!walkTo(run, 'event')) continue;
      expect(run.phase).toBe('treasure');
      return;
    }
  });

  it('갈림길의 여우: 정예 천년 여우(정예 그림 e-fox-elite)와 싸우고 보상 2배 — 1막 foxElite · 2막 foxElite2', () => {
    for (const act of [1, 2]) {
      const run = newRun({ seed: 2, hero: 'pig' });
      atAct(run, act);
      run.seenEvents = EVENTS.map((e) => e.id).filter((id) => id !== 'foxFork');
      expect(walkTo(run, 'event')).toBe(true);
      expect(run.event!.id).toBe('foxFork');
      expect(apply(run, { t: 'choose', i: 0 }).ok).toBe(true);
      expect(run.phase).toBe('battle');
      const f = run.battle!.foes[0];
      expect(f.id).toBe(act === 1 ? 'foxElite' : 'foxElite2');
      expect(enemyDef(f.id).art).toBe('e-fox-elite');
      expect(f.elite).toBe(true);
      expect(run.battle!.kind).toBe('elite');
      const elites = run.stats.elites;
      winBattle(run);
      expect(run.stats.elites).toBe(elites + 1);
      const items = run.reward!.items;
      expect(items.filter((x) => x.k === 'card')).toHaveLength(2);
      expect(items.filter((x) => x.k === 'relic')).toHaveLength(2);
      const gold = items.find((x) => x.k === 'gold') as { n: number };
      expect(gold.n % 2).toBe(0);
      expect(gold.n).toBeGreaterThanOrEqual(50);
    }
  });

  it('무당의 굿 · 대장간 노인 · 저승 문지기 (2~3막 사건)', () => {
    const run = newRun({ seed: 4, hero: 'pig' });
    atAct(run, 3);
    run.gold = 200;
    run.seenEvents = EVENTS.map((e) => e.id).filter((id) => id !== 'gatekeeper');
    expect(walkTo(run, 'event')).toBe(true);
    expect(run.event!.id).toBe('gatekeeper');
    const max = run.maxHp;
    const deck = run.deck.length;
    apply(run, { t: 'choose', i: 0 });
    expect(run.maxHp).toBe(max - Math.floor(max * 0.15));
    expect(run.deck.length).toBe(deck + 1);
    expect(run.event!.gotCard).toBeTruthy();
  });
});
