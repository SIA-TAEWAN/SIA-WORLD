import { describe, expect, it } from 'vitest';
import { ARENA, PLAYER, SPAWN, VIEW_H, VIEW_W } from '../src/data/balance';
import { BOSS_INDEX } from '../src/data/bosses';
import { ITEM } from '../src/data/items';
import { MAPS } from '../src/data/maps';
import { dropPickup, edgePoint, insideArena, spawnBoss } from '../src/game/core';
import { normalPolicy, simulate } from '../src/game/policy';
import { createRun } from '../src/game/sim';
import { cellObstacles, CELL_MAX } from '../src/game/terrain';
import { advance, disarm, emptyRun, live, move, put } from './helpers';

/** 맵의 끝: 휴대폰 화면 가로 3장 × 세로 3장 (2160 × 3840) 의 닫힌 땅, 출발 자리가 가운데 */
describe('맵 경계 (ARENA)', () => {
  it('맵은 기준 화면 3 × 3 장 크기이고, 출발 자리가 한가운데다', () => {
    expect([ARENA.halfW * 2, ARENA.halfH * 2]).toEqual([VIEW_W * 3, VIEW_H * 3]);
    const s = createRun({ seed: 1, char: 'rat', map: 'field' });
    expect([s.player.x, s.player.y]).toEqual([0, 0]);
    // 요괴가 나오는 사각형이 맵의 절반보다 작다 (반대쪽 변은 언제나 맵 안)
    expect(SPAWN.halfW * 2).toBeLessThan(ARENA.halfW * 2 - SPAWN.inset * 2);
    expect(SPAWN.halfH * 2).toBeLessThan(ARENA.halfH * 2 - SPAWN.inset * 2);
  });

  it('내 캐릭터는 담 너머로 나가지 못한다 (네 방향 모두, 대각선으로 모서리에 몰려도)', () => {
    for (const [mx, my] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const s = disarm(emptyRun());
      advance(s, 22, { immortal: true, input: move(mx, my) });
      const p = s.player;
      if (mx) expect(Math.abs(p.x)).toBeCloseTo(ARENA.halfW - PLAYER.r, 3);
      if (my) expect(Math.abs(p.y)).toBeCloseTo(ARENA.halfH - PLAYER.r, 3);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(ARENA.halfW - PLAYER.r);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(ARENA.halfH - PLAYER.r);
    }
  });

  it('내가 담에 붙어 있으면 요괴는 담 너머가 아니라 반대쪽·옆에서 나온다', () => {
    const s = disarm(emptyRun());
    const pt = { x: 0, y: 0 };
    for (const [px, py] of [[1064, 0], [-1064, 0], [0, 1904], [0, -1904], [1064, 1904], [-1064, -1904]]) {
      s.player.x = px;
      s.player.y = py;
      for (let i = 0; i < 400; i++) {
        edgePoint(s, pt, i % 5 === 4 ? -1 : i % 4);
        expect(insideArena(pt.x, pt.y, SPAWN.inset - 0.001), `${px},${py} → ${pt.x},${pt.y}`).toBe(true);
        // 여전히 화면 밖
        expect(Math.abs(pt.x - px) >= SPAWN.halfW - 0.001 || Math.abs(pt.y - py) >= SPAWN.halfH - 0.001).toBe(true);
      }
    }
  });

  it('요괴·보스·아이템도 맵 안에 있다 (밀려나도, 담 밖에 놓여도 들여놓는다)', () => {
    const s = disarm(emptyRun());
    s.player.x = ARENA.halfW - 40;
    const e = put(s, 'imp', ARENA.halfW + 300, 0);
    expect(e.x).toBe(ARENA.halfW - e.r);
    const boss = spawnBoss(s, BOSS_INDEX[MAPS[0].bosses[0].id], 0, -ARENA.halfH - 500)!;
    expect(boss.y).toBe(-ARENA.halfH + boss.r);
    const it = dropPickup(s, ITEM.coin, ARENA.halfW + 50, ARENA.halfH + 50, 1)!;
    expect(insideArena(it.x, it.y, 0)).toBe(true);
    // 내 둘레에 몰려 서로 밀어내도 담 밖으로 밀려나지 않는다
    for (let i = 0; i < 40; i++) put(s, 'club', ARENA.halfW - 30, (i - 20) * 6);
    advance(s, 3, { immortal: true });
    for (const q of live(s.enemies)) {
      if (q.dead) continue;
      expect(Math.abs(q.x)).toBeLessThanOrEqual(ARENA.halfW - q.r + 1e-6);
      expect(Math.abs(q.y)).toBeLessThanOrEqual(ARENA.halfH - q.r + 1e-6);
    }
  });

  it('맵 끝의 담에 걸치거나 바짝 붙은 장애물은 없다 (담과 장애물 사이에 끼지 않게)', () => {
    const buf = new Float32Array(CELL_MAX * 3);
    for (const m of MAPS.filter((x) => x.terrain.kind !== 'none')) {
      const C = m.terrain.cell;
      for (let cy = Math.floor(-ARENA.halfH / C) - 2; cy <= ARENA.halfH / C + 2; cy++) {
        for (let cx = Math.floor(-ARENA.halfW / C) - 2; cx <= ARENA.halfW / C + 2; cx++) {
          const n = cellObstacles(m.terrain, 5, cx, cy, buf);
          for (let i = 0; i < n; i++) {
            const ax = Math.abs(buf[i * 3]);
            const ay = Math.abs(buf[i * 3 + 1]);
            const r = buf[i * 3 + 2];
            // 담 안쪽 60 안에 들어오거나 담에 걸치지 않는다 (담 너머에 통째로 있는 것은 바깥 풍경)
            expect(ax + r <= ARENA.halfW - 60 + 0.01 || ax - r >= ARENA.halfW - 0.01).toBe(true);
            expect(ay + r <= ARENA.halfH - 60 + 0.01 || ay - r >= ARENA.halfH - 0.01).toBe(true);
          }
        }
      }
    }
  });

  it("'보통 실력'으로 끝까지 돈 판에서 내 캐릭터·요괴가 맵 밖에 있던 적이 없다 (맵 4종)", () => {
    for (const m of MAPS) {
      let out = 0;
      const policy = normalPolicy(3);
      const r = simulate({ seed: 11, char: 'tiger', map: m.id, upgrades: {} }, (s, input) => {
        policy(s, input);
        if (!insideArena(s.player.x, s.player.y, PLAYER.r - 0.001)) out++;
        for (let i = 0; i < s.enemies.n; i++) {
          const e = s.enemies.items[i];
          if (!e.dead && !insideArena(e.x, e.y, e.r - 0.001)) out++;
        }
      });
      expect(r.time).toBeGreaterThan(30);
      expect(out, m.id).toBe(0);
    }
  }, 60000);
});
