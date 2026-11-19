import { describe, expect, it } from 'vitest';
import { BOARD_H, BOARD_W, BOSS_AT, COLS, ROAD_W, ROWS, SLOT_SIZE, WAVES, WAVE_HP, WAVE_SEC, ZODIAC_IDS } from '../src/data/balance';
import { BOSSES, BOSS_INDEX } from '../src/data/bosses';
import { ROSTER, STARTERS, TOWERS, spentAt } from '../src/data/characters';
import { ENEMIES, ENEMY_INDEX } from '../src/data/enemies';
import { REGIONS } from '../src/data/regions';
import { STAGES, nextStage, stageEnemies, stagesOf } from '../src/data/stages';
import { BOSS_ACTS } from '../src/game/bosses';
import { buildRoute, cellX, cellY, distToRoad } from '../src/game/path';
import { ATTACKS } from '../src/game/towers';

describe('스테이지 데이터', () => {
  it('지역마다 5스테이지이고 5번째에만 그 지역의 보스가 나온다. 공중 요괴가 나오는 스테이지에는 공중 경로가 있다', () => {
    const regions = [...new Set(STAGES.map((s) => s.region))];
    expect(regions).toEqual(regions.map((_, i) => i + 1));
    for (const r of regions) {
      const list = stagesOf(r);
      expect(list.map((s) => s.no), `${r}지역`).toEqual([1, 2, 3, 4, 5]);
      expect(list.map((s) => !!s.boss)).toEqual([false, false, false, false, true]);
      expect(BOSSES[BOSS_INDEX[list[4].boss!.id]].name).toBe(REGIONS[r - 1].boss);
      for (const s of list) {
        const flies = stageEnemies(s).some((id) => ENEMIES[ENEMY_INDEX[id]].air);
        if (flies) expect(s.routes.some((x) => x.air), s.id).toBe(true);
      }
    }
  });

  it('1지역은 5스테이지이고 5번째만 2분에 보스(큰 도깨비)가 나온다', () => {
    const list = stagesOf(1);
    expect(list.map((s) => s.id)).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5']);
    expect(list.map((s) => !!s.boss)).toEqual([false, false, false, false, true]);
    expect(list[4].boss!.id).toBe('bigDokkaebi');
    expect(list[4].boss!.at ?? BOSS_AT).toBe(120);
    // 1지역에 나오는 요괴는 꼬마 도깨비와 도깨비불 2종
    expect([...new Set(list.flatMap(stageEnemies))].sort()).toEqual(['imp', 'wisp']);
  });

  for (const st of STAGES) {
    describe(`${st.id} ${st.name}`, () => {
      const routes = st.routes.map(buildRoute);
      it('id 는 지역-번호이고 겹치지 않는다', () => {
        expect(st.id).toBe(`${st.region}-${st.no}`);
        expect(STAGES.filter((x) => x.id === st.id)).toHaveLength(1);
        expect(REGIONS[st.region - 1]).toBeTruthy();
      });
      it('웨이브는 6개이고, 모든 등장이 그 웨이브의 30초 안에 끝난다 (3분 뒤에는 새 요괴가 없다)', () => {
        expect(st.waves).toHaveLength(WAVES);
        for (const w of st.waves) {
          expect(w.groups.length).toBeGreaterThan(0);
          for (const g of w.groups) {
            expect(ENEMY_INDEX[g.enemy], g.enemy).toBeDefined();
            expect(g.count).toBeGreaterThan(0);
            expect(g.at).toBeGreaterThanOrEqual(0);
            expect(g.at + (g.count - 1) * g.gap).toBeLessThan(WAVE_SEC);
            if (typeof g.route === 'number') expect(routes[g.route]).toBeTruthy();
          // 번갈아 오는 무리(alt)는 땅 위 요괴만
          if (g.route === 'alt') expect(ENEMIES[ENEMY_INDEX[g.enemy]].air).toBeFalsy();
          }
        }
      });
      it('길은 점이 둘 이상이고, 땅 위 길은 가로·세로로만 꺾이며, 입구와 출구는 판 밖에 있다', () => {
        expect(routes.length).toBeGreaterThan(0);
        for (const r of st.routes) {
          expect(r.pts.length).toBeGreaterThanOrEqual(2);
          if (r.air) continue;
          for (let i = 1; i < r.pts.length; i++) expect(r.pts[i][0] === r.pts[i - 1][0] || r.pts[i][1] === r.pts[i - 1][1]).toBe(true);
        }
        for (const r of routes) {
          const out = (x: number, y: number) => x < 0 || x > BOARD_W || y < 0 || y > BOARD_H;
          expect(out(r.xs[0], r.ys[0])).toBe(true);
          expect(out(r.xs[r.xs.length - 1], r.ys[r.ys.length - 1])).toBe(true);
        }
      });
      it('배치 칸은 판 안에 있고, 서로 겹치지 않고, 길을 밟지 않는다', () => {
        expect(st.slots.length).toBeGreaterThanOrEqual(6);
        const seen = new Set<string>();
        for (const [c, r] of st.slots) {
          expect(Number.isInteger(c) && Number.isInteger(r)).toBe(true);
          expect(c >= 0 && c < COLS && r >= 0 && r < ROWS).toBe(true);
          expect(seen.has(`${c},${r}`)).toBe(false);
          seen.add(`${c},${r}`);
          expect(distToRoad(routes, cellX(c), cellY(r)), `칸 [${c}, ${r}]`).toBeGreaterThanOrEqual(ROAD_W / 2 + SLOT_SIZE / 2);
        }
      });
      it('보스·보상 값이 맞다', () => {
        if (st.boss) {
          expect(BOSS_INDEX[st.boss.id]).toBeDefined();
          expect(st.no).toBe(5);
        }
        expect(st.energy).toBeGreaterThan(0);
        expect(st.coins).toBeGreaterThan(0);
        expect(st.firstCoins).toBeGreaterThan(0);
      });
    });
  }

  it('다음 스테이지: 1-1 → 1-2, 마지막 스테이지 뒤는 없다', () => {
    expect(nextStage(STAGES[0])!.id).toBe('1-2');
    expect(nextStage(STAGES[4])?.id ?? '2-1').toBe('2-1');
    expect(nextStage(STAGES[STAGES.length - 1])).toBeUndefined();
  });
});

describe('캐릭터·요괴·보스 데이터', () => {
  it('십이지 12종 명단: 처음 4종(쥐·소·호랑이·토끼)은 바로 쓰고, 나머지는 1~8지역 클리어로 하나씩 열린다', () => {
    expect(ROSTER.map((r) => r.id)).toEqual([...ZODIAC_IDS]);
    expect(STARTERS).toEqual(['rat', 'ox', 'tiger', 'rabbit']);
    expect(ROSTER.slice(4).map((r) => r.unlockRegion)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // 계산까지 만들어진 캐릭터는 띠 순서대로 (처음 4종이 맨 앞)
    expect(TOWERS.map((t) => t.id)).toEqual(ROSTER.slice(0, TOWERS.length).map((r) => r.id));
    expect(TOWERS.length).toBeGreaterThanOrEqual(10);
  });
  it('캐릭터는 강화 3단계이고 단계가 오를수록 피해·사거리가 줄지 않고 공격 간격이 늘지 않는다', () => {
    for (const t of TOWERS) {
      expect(t.levels).toHaveLength(3);
      expect(ATTACKS[t.kind]).toBeTypeOf('function');
      for (let i = 1; i < 3; i++) {
        const a = t.levels[i - 1];
        const b = t.levels[i];
        expect(b.dmg * (b.count ?? 1)).toBeGreaterThanOrEqual(a.dmg * (a.count ?? 1));
        expect(b.range).toBeGreaterThanOrEqual(a.range);
        expect(b.every).toBeLessThanOrEqual(a.every);
        // 돕는 값도 줄지 않는다
        expect(b.slow ?? 1).toBeLessThanOrEqual(a.slow ?? 1);
        expect(b.haste ?? 0).toBeGreaterThanOrEqual(a.haste ?? 0);
        expect(b.income ?? 0).toBeGreaterThanOrEqual(a.income ?? 0);
        expect(b.poison ?? 0).toBeGreaterThanOrEqual(a.poison ?? 0);
      }
      expect(spentAt(t, 3)).toBe(t.cost + t.up[0] + t.up[1]);
    }
  });
  it('3단계 특수 효과: 쥐 표창 2개 · 소 멈춤 시간 증가 · 호랑이 범위 베기 · 토끼 폭발 범위 증가', () => {
    const [rat, ox, tiger, rabbit, dragon, snake, horse, sheep, monkey, rooster] = TOWERS;
    // 용 광선 지속 피해 · 뱀 독이 번짐 · 말 보스 추가 피해 · 양 감속 중 받는 피해 증가 · 원숭이 은신 감지 · 닭 지원 범위 증가
    expect([dragon.levels[1].burn, dragon.levels[2].burn! > 0]).toEqual([undefined, true]);
    expect([snake.levels[1].splash, snake.levels[2].splash! > 0]).toEqual([undefined, true]);
    expect([horse.levels[1].bossMul, horse.levels[2].bossMul! > 1]).toEqual([undefined, true]);
    expect([sheep.levels[1].vuln, sheep.levels[2].vuln! > 0]).toEqual([undefined, true]);
    expect([monkey.levels[1].detect, monkey.levels[2].detect]).toEqual([undefined, true]);
    expect(rooster.levels[2].range).toBeGreaterThan(rooster.levels[1].range * 1.2);
    expect(monkey.target).toBe('air');
    expect(horse.levels[0].range).toBeGreaterThan(300);
    expect(rat.levels[2].count).toBe(2);
    expect(ox.levels[2].stun!).toBeGreaterThan(ox.levels[1].stun! * 1.3);
    expect(tiger.levels[1].splash).toBeUndefined();
    expect(tiger.levels[2].splash!).toBeGreaterThan(0);
    expect(rabbit.levels[2].splash!).toBeGreaterThan(rabbit.levels[1].splash! * 1.3);
  });
  it('보스는 등록된 특수 행동을 쓰고 생명을 5 깎는다', () => {
    for (const b of BOSSES) {
      expect(BOSS_ACTS[b.act], b.act).toBeTypeOf('function');
      expect(b.leak).toBe(5);
    }
    expect(ENEMIES.every((e) => e.hp > 0 && e.speed > 0 && e.bounty > 0)).toBe(true);
    expect(WAVE_HP).toHaveLength(WAVES);
  });
  it('12지역: 필요 별은 9개씩 늘고 배경 4종을 3지역씩 쓴다', () => {
    expect(REGIONS.map((r) => r.stars)).toEqual([0, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99]);
    expect(REGIONS.map((r) => r.bg)).toEqual([...Array(3).fill('field'), ...Array(3).fill('bamboo'), ...Array(3).fill('palace'), ...Array(3).fill('underworld')]);
  });
});
