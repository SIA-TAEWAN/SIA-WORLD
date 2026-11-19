import { ROAD_W, crowdRadius } from '../data/balance';
import { applyOp, xLimit, type RunState } from './sim';

/**
 * 자동 조종 (테스트의 "생각하는 플레이어", 개발용 ?local=1&auto=1): 앞에 있는 문 줄에서 지났을 때 대원이 가장 많아지는 문을 고르고,
 * 요괴 무리는 이길 수 없으면 피하고, 보스 공격 예고가 뜨면 비켜 선다.
 */
export function autopilot(s: RunState): number {
  const half = ROAD_W / 2;
  if (s.phase === 'boss') {
    const b = s.boss.band;
    if (!b) return s.x;
    const r = crowdRadius(s.troops);
    const left = b[0] - r - 4;
    const right = b[1] + r + 4;
    const lim = xLimit(s.troops);
    const options = [left, right].filter((x) => x >= -lim && x <= lim);
    if (!options.length) return Math.abs(left) < Math.abs(right) ? -lim : lim;
    return options.reduce((a, c) => (Math.abs(c - s.x) < Math.abs(a - s.x) ? c : a));
  }
  const nextRow = s.gates.filter((g) => !g.used && g.z > s.z).sort((a, b) => a.z - b.z)[0];
  const nextHorde = s.hordes.filter((h) => h.count > 0 && h.z > s.z).sort((a, b) => a.z - b.z)[0];
  if (nextHorde && (!nextRow || nextHorde.z < nextRow.z) && nextHorde.z - s.z < 600) {
    // 이길 수 없는 무리는 피한다 (길을 다 막은 무리는 못 피한다)
    const avoid = nextHorde.count * 2 > s.troops;
    if (avoid && nextHorde.x1 - nextHorde.x0 < ROAD_W - 1) {
      return nextHorde.x0 > -half + 1 ? -half : half;
    }
  }
  if (!nextRow) return 0;
  const row = s.gates.filter((g) => g.row === nextRow.row);
  const best = row.reduce((a, g) => (applyOp(s.troops, g.op, g.v) > applyOp(s.troops, a.op, a.v) ? g : a));
  // 길게 이어진 + 줄은 타는 게 이득 (지나치는 문 하나하나가 더해진다)
  if (row.length === 1) return applyOp(s.troops, best.op, best.v) >= s.troops ? (best.x0 + best.x1) / 2 : -(best.x0 + best.x1) / 2;
  return (best.x0 + best.x1) / 2;
}
