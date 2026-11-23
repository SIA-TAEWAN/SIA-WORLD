import { describe, expect, it } from 'vitest';
import { BAG, DROP, POTION, buyPrice, enhanceCost, regionTier } from '../src/data/economy';
import { GROWTH_TARGETS, addExp } from '../src/data/growth';
import { PAR, parOf } from '../src/data/mapgen';
import { MAPS, mapKillMax, mapsOf } from '../src/data/maps';
import { MAPS_PER_REGION, REGIONS_READY, mapLevel } from '../src/data/regions';
import { mapReward } from '../src/game/progress';

/**
 * 밸런스 표 (npm run pace 로 맞춘 값이 크게 어긋나지 않는지). 전투는 돌리지 않고 맵 보상 표만 본다.
 * 여기서 깨지면 `npm run pace` 를 다시 돌려 경험치 곡선(growth.ts)·드랍(economy.ts)을 맞춘다.
 */
const mapExp = (id: string) => {
  const r = mapReward(MAPS.find((m) => m.id === id)!, 'normal');
  return Object.values(r.kinds).reduce((a, k) => a + k!.max * k!.exp, 0) + r.elites * r.eliteExp + r.bossExp;
};
const mapCoins = (id: string) => {
  const r = mapReward(MAPS.find((m) => m.id === id)!, 'normal');
  return Object.values(r.kinds).reduce((a, k) => a + k!.max * k!.coin, 0) + r.elites * r.eliteCoin + r.bossCoin + r.chestCoin;
};

describe('성장 곡선 (PRD 성장 표: 보통 1~4지형 약 4시간에 Lv25)', () => {
  /** pace 와 같은 가정: 맵마다 한 번, 보스는 열쇠 때문에 두 번쯤, 지형마다 6·7번 맵을 한 번 더 (5지형부터는 두 번 더) */
  const levelAfter = (regions: number) => {
    let lv = { level: 1, exp: 0 };
    for (let r = 1; r <= regions; r++) {
      for (const m of mapsOf(r)) lv = addExp(lv.level, lv.exp, mapExp(m.id) * (m.boss ? 2 : m.no >= 6 ? (r >= 5 ? 3 : 2) : 1));
    }
    return lv.level;
  };

  it('지형을 끝낼 때마다 마지막 맵 권장 레벨보다 1~5 높고, 1~4지형을 끝내면 Lv25 안팎이다 (PRD 표)', () => {
    const t = GROWTH_TARGETS[0];
    expect(t).toMatchObject({ region: 4, hours: 4, level: 25 });
    const got = Array.from({ length: REGIONS_READY }, (_, i) => levelAfter(i + 1));
    expect(got[2]).toBeGreaterThanOrEqual(18);
    expect(got[2]).toBeLessThanOrEqual(21);
    expect(got[3]).toBeGreaterThanOrEqual(t.level - 2);
    expect(got[3]).toBeLessThanOrEqual(t.level + 2);
    // 5~8지형은 9시간에 Lv45 (8지형 마지막 맵 권장 44) — 권장 레벨과의 차이가 줄어든다. 7지형 끝은 Lv40 안팎
    if (REGIONS_READY >= 7) {
      expect(GROWTH_TARGETS[1]).toMatchObject({ region: 8, hours: 9, level: 45 });
      expect(got[6]).toBeGreaterThanOrEqual(38);
      expect(got[6]).toBeLessThanOrEqual(42);
    }
    // 9~12지형 + 최종보스는 15시간에 Lv65 — 12지형 끝은 Lv62~65
    if (REGIONS_READY >= 12) {
      expect(GROWTH_TARGETS[2]).toMatchObject({ region: 12, hours: 15, level: 65 });
      expect(got[11]).toBeGreaterThanOrEqual(62);
      expect(got[11]).toBeLessThanOrEqual(65);
    }
    got.forEach((lv, i) => {
      const rec = mapLevel(i + 1, MAPS_PER_REGION, 'normal');
      // 9지형부터는 권장 레벨에 못 미친 채로 간다 (PRD 표: 12지형 마지막 맵 권장 65, 최종보스까지 잡아야 Lv65)
      expect(lv, `${i + 1}지형`).toBeGreaterThanOrEqual(i < 4 ? rec + 1 : i < 8 ? rec : rec - 3);
      expect(lv, `${i + 1}지형`).toBeLessThanOrEqual(rec + 5);
    });
  });

  it('첫 맵 하나로 레벨이 오른다 (처음부터 막히지 않게)', () => {
    expect(addExp(1, 0, mapExp('1-1')).level).toBeGreaterThanOrEqual(2);
  });
});

describe('맵 크기 · 별 시간', () => {
  it('맵마다 요괴가 60~200마리, 지형 안에서 뒤로 갈수록 대체로 늘어난다 (맵 한 판 5~6분)', () => {
    for (const m of MAPS) {
      const n = mapKillMax(m, 'normal').total;
      expect(n, m.id).toBeGreaterThanOrEqual(m.boss ? 50 : 60);
      expect(n, m.id).toBeLessThanOrEqual(200);
    }
    for (let r = 1; r <= REGIONS_READY; r++) {
      const maps = mapsOf(r);
      expect(mapKillMax(maps[6], 'normal').total).toBeGreaterThan(mapKillMax(maps[1], 'normal').total);
    }
  });

  it('별 시간은 길이와 때려야 하는 횟수로 정한다 (3~14분)', () => {
    for (const m of MAPS) {
      expect(m.par).toBe(parOf(m.region, m.no, m.rows.length, m.groups, !!m.boss));
      expect(m.par, m.id).toBeGreaterThanOrEqual(180);
      expect(m.par, m.id).toBeLessThanOrEqual(840);
    }
    expect(PAR.slack).toBeGreaterThan(1.2);
  });
});

describe('드랍 · 값', () => {
  it('일반 장비는 맵마다 한두 개: 1~3지형을 한 바퀴 돌아도 가방(40칸)이 넘치지 않는다', () => {
    let total = 0;
    for (const m of MAPS.filter((x) => x.region <= 3)) {
      const drops = (mapKillMax(m, 'normal').total * DROP.gear) / 10000;
      expect(drops, m.id).toBeLessThan(2.5);
      total += drops;
    }
    // 처음 장비 5개 + 한 바퀴의 드랍 (정리하지 않아도)
    expect(5 + total).toBeLessThan(BAG.size);
  });

  it('체력 물약(소)은 한 맵에서 버는 엽전의 10% 안팎이거나 그보다 싸다', () => {
    expect(POTION.price[0][0] / mapCoins('1-1')).toBeLessThan(0.15);
    for (const m of MAPS) expect(POTION.price[0][0] / mapCoins(m.id), m.id).toBeLessThan(0.15);
  });

  it('새 등급 장비 한 벌은 그 지형 맵 서너 판, +9 강화는 그보다 비싸다', () => {
    // 3지형(등급 1)의 무기 + 방어구
    const tier = regionTier(3, 'normal');
    expect(tier).toBe(1);
    const set = buyPrice(tier) * 2;
    const income = mapsOf(3).reduce((a, m) => a + mapCoins(m.id), 0) / MAPS_PER_REGION;
    expect(set / income).toBeGreaterThan(1);
    expect(set / income).toBeLessThan(5);
    const plus9 = Array.from({ length: 9 }, (_, i) => enhanceCost(tier, i + 1).coins).reduce((a, b) => a + b, 0);
    expect(plus9).toBeGreaterThan(set);
  });
});
