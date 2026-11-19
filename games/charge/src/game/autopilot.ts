import { OBSTACLES, ROAD_W, RUN_SPEED, crowdRadius } from '../data/balance';
import { CRATE_HALF, applyOp, logX, xLimit, type RunState } from './sim';

/**
 * 자동 조종 (테스트의 "생각하는 플레이어", 개발용 ?local=1&auto=1):
 * 앞에 있는 문 줄에서 지났을 때 대원이 가장 많아지는 문을 고르고, 이길 수 없는 요괴 무리와 장애물은 피하고,
 * 보스 공격 예고가 뜨면 비켜 선다. 사람보다 조금 잘하는 정도.
 */
export function autopilot(s: RunState): number {
  const half = ROAD_W / 2;
  const r = crowdRadius(s.troops);
  const lim = xLimit(s.troops);
  const clamp = (x: number) => Math.max(-lim, Math.min(lim, x));

  /** 막힌 구간들을 피하는 가장 가까운 자리 */
  const dodge = (blocks: [number, number][], prefer: number): number => {
    const free = (x: number) => blocks.every(([a, b]) => x + r < a || x - r > b);
    if (free(clamp(prefer))) return clamp(prefer);
    const cands = [-lim, lim, ...blocks.flatMap(([a, b]) => [a - r - 6, b + r + 6])].map(clamp).filter(free);
    if (!cands.length) {
      // 다 피할 수 없으면 가장 덜 겹치는 쪽
      return [-lim, 0, lim].reduce((best, x) => (cover(blocks, x, r) < cover(blocks, best, r) ? x : best));
    }
    return cands.reduce((a, c) => (Math.abs(c - prefer) < Math.abs(a - prefer) ? c : a));
  };

  if (s.phase === 'boss') {
    const blocks = [...s.boss.bands, ...s.burns.map((b) => b.band)];
    // 방패 보스는 옆에서 쏜다
    const prefer = s.boss.traits?.shield ? (s.x >= 0 ? lim : -lim) : s.x;
    return dodge(blocks, prefer);
  }

  // 바로 앞의 장애물은 피한다 (통나무는 닿을 때의 위치를 미리 계산)
  const obs = s.obstacles.filter((o) => !o.done && o.z > s.z && o.z - s.z < 260);
  if (obs.length) {
    const blocks = obs.map((o): [number, number] => {
      const x = o.kind === 'log' ? logX(s.t + (o.z - s.z) / RUN_SPEED, o.id) : o.x;
      return [x - OBSTACLES[o.kind].half, x + OBSTACLES[o.kind].half];
    });
    return dodge(blocks, s.x);
  }

  const nextRow = s.gates.filter((g) => !g.used && g.z > s.z).sort((a, b) => a.z - b.z)[0];
  const nextHorde = s.hordes.filter((h) => h.count > 0 && h.z > s.z).sort((a, b) => a.z - b.z)[0];
  if (nextHorde && (!nextRow || nextHorde.z < nextRow.z) && nextHorde.z - s.z < 600) {
    // 이길 수 없는 무리는 피한다 (길을 다 막은 무리는 못 피한다)
    const avoid = nextHorde.count * 2 > s.troops;
    if (avoid && nextHorde.x1 - nextHorde.x0 < ROAD_W - 1) return nextHorde.x0 > -half + 1 ? -half : half;
    // 방패 요괴는 옆에서 쏜다
    if (nextHorde.kind === 'guard') return clamp((nextHorde.x0 + nextHorde.x1) / 2 + (s.x >= 0 ? 110 : -110));
  }
  // 앞에 상자가 있고 문이 멀면 상자를 쏘러 간다
  const crate = s.crates.find((c) => !c.broken && c.z > s.z && c.z - s.z < 700);
  if (crate && (!nextRow || nextRow.z - s.z > 500)) return clamp(crate.x + (crate.x > 0 ? -CRATE_HALF / 2 : CRATE_HALF / 2));
  if (!nextRow) return 0;
  const row = s.gates.filter((g) => g.row === nextRow.row);
  const val = (g: (typeof row)[number]) => applyOp(s.troops, g.op, g.v, s.leader.timesMul);
  const best = row.reduce((a, g) => (val(g) > val(a) ? g : a));
  // 길게 이어진 + 줄은 타는 게 이득 (지나치는 문 하나하나가 더해진다)
  if (row.length === 1) return val(best) >= s.troops ? (best.x0 + best.x1) / 2 : -(best.x0 + best.x1) / 2;
  return (best.x0 + best.x1) / 2;
}

function cover(blocks: [number, number][], x: number, r: number) {
  return blocks.reduce((a, [b0, b1]) => a + Math.max(0, Math.min(x + r, b1) - Math.max(x - r, b0)), 0);
}
