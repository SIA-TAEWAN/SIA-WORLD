import { describe, expect, it } from 'vitest';
import { ZODIAC_IDS, xpNeed } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { CHARACTERS } from '../src/data/characters';
import { ENEMIES } from '../src/data/enemies';
import { EVOLUTIONS } from '../src/data/evolutions';
import { MAPS } from '../src/data/maps';
import { PASSIVES, PASSIVE_INDEX } from '../src/data/passives';
import { UPGRADES, UPGRADE_TOTAL, presetUpgrades, upgradeCost } from '../src/data/upgrades';
import { WEAPONS, WEAPON_INDEX } from '../src/data/weapons';
import { average, normalPolicy, simulate } from '../src/game/policy';

describe('데이터 표 (PRD 4~7장)', () => {
  it('캐릭터 12종: 시작 무기가 서로 다르고, 처음에는 쥐·소·호랑이만 열려 있다', () => {
    expect(CHARACTERS.map((c) => c.id)).toEqual([...ZODIAC_IDS]);
    expect(new Set(CHARACTERS.map((c) => c.weapon)).size).toBe(12);
    for (const c of CHARACTERS) expect(WEAPON_INDEX[c.weapon]).toBeGreaterThanOrEqual(0);
    expect(CHARACTERS.filter((c) => c.unlock.kind === 'base').map((c) => c.id)).toEqual(['rat', 'ox', 'tiger']);
  });

  it('패시브 8종 · 진화 3종 · 요괴 9종 · 보스 12종 · 맵 4종', () => {
    expect(PASSIVES.length).toBe(8);
    expect(EVOLUTIONS.length).toBe(3);
    for (const e of EVOLUTIONS) {
      expect(WEAPONS[WEAPON_INDEX[e.result]].evolved).toBe(true);
      expect(PASSIVE_INDEX[e.passive]).toBeGreaterThanOrEqual(0);
    }
    expect(ENEMIES.length).toBe(9);
    expect(BOSSES.length).toBe(12);
    expect(MAPS.map((m) => [m.id, m.coinMul, m.power.hp])).toEqual([['field', 1, 1], ['bamboo', 1.5, 1.3], ['palace', 2, 1.6], ['underworld', 2.5, 2]]);
    for (const m of MAPS) {
      expect(m.bosses.map((b) => b.at)).toEqual([180, 420, 600]);
      expect(BOSSES.filter((b) => b.map === m.id).map((b) => b.id)).toEqual(m.bosses.map((b) => b.id));
    }
    // 이번 단계에서 완성한 맵은 들판뿐
    expect(MAPS.filter((m) => m.ready).map((m) => m.id)).toEqual(['field']);
  });

  it('영구 강화: 9항목 49레벨, 비용은 100 → 150 → 225', () => {
    expect(UPGRADES.length).toBe(9);
    expect(UPGRADE_TOTAL).toBe(49);
    expect([0, 1, 2].map(upgradeCost)).toEqual([100, 150, 225]);
    for (const n of [0, 1, 10, 22, 34, 44, 49, 99]) {
      const lv = presetUpgrades(n);
      expect(Object.values(lv).reduce((a, b) => a + b, 0)).toBe(Math.min(49, n));
      for (const u of UPGRADES) expect(lv[u.id]).toBeLessThanOrEqual(u.max);
    }
  });

  it('필요 경험치는 레벨이 오를수록 늘어난다', () => {
    for (let lv = 1; lv < 60; lv++) expect(xpNeed(lv + 1)).toBeGreaterThan(xpNeed(lv));
  });
});

describe('밸런스 시험 틀', () => {
  it("화면 없이 '보통 실력' 정책으로 한 판을 끝까지 돌린다", () => {
    const r = simulate({ seed: 42, char: 'tiger', map: 'field' }, normalPolicy(1));
    expect(['over', 'clear']).toContain(r.state.phase);
    expect(r.time).toBeGreaterThan(30);
    expect(r.time).toBeLessThanOrEqual(600);
    expect(r.kills).toBeGreaterThan(10);
    expect(r.level).toBeGreaterThan(1);
  }, 60000);

  it('강화 0에서는 들판을 끝까지 버티기 어렵고, 강화가 많으면 더 오래 버틴다', () => {
    const base = average({ char: 'tiger', map: 'field' }, 8);
    const strong = average({ char: 'tiger', map: 'field', upgrades: presetUpgrades(34) }, 8);
    expect(base.time).toBeGreaterThan(120);
    expect(base.time).toBeLessThan(480);
    expect(strong.time).toBeGreaterThan(base.time);
    expect(base.clearRate).toBeLessThan(0.5);
  }, 120000);
});
