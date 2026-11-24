/**
 * 사이드 팟 계산과 팟 나누기 (세븐포커 · 텍사스 홀덤 공용). 순수 TypeScript.
 *
 * 올인한 사람들의 누적 기여액(total)을 단계로 나눠 팟을 만든다. 다이(폴드)한 사람의 돈은 팟에 남지만 받을 자격은 없다.
 * 마지막 팟은 올인하지 않은 생존자들이 대상(아무도 못 받으면 바로 앞 팟에 합친다). 대상이 같은 이웃 팟은 합친다.
 * opts.refund: 판이 끝날 때만. 가장 많이 낸 사람 혼자 낸 몫(둘째로 많이 낸 사람의 total 위 — 아무도 못 받은 베팅)은
 * 따로 `refund: true` 팟으로 가른다(합치지 않는다). 금액 합계·받는 사람은 그대로라 정산은 같다.
 */
export interface PotPlayer {
  seat: number;
  /** 이번 판에 낸 돈 전부 */
  total: number;
  folded: boolean;
  allIn: boolean;
}

export interface Pot {
  amount: number;
  /** 받을 자격이 있는 자리 (자리 번호 순) */
  eligible: number[];
  /** 한 사람만 낸 돈을 그대로 돌려주는 팟 (겨뤄서 딴 돈이 아니다) */
  refund?: boolean;
}

/** players: 이번 판 참가자 (제외된 사람은 빼고 넘긴다) */
export function computeSidePots(players: PotPlayer[], opts: { refund?: boolean } = {}): Pot[] {
  const ps = players;
  const alive = ps.filter((p) => !p.folded);
  const levels = [...new Set(alive.filter((p) => p.allIn).map((p) => p.total))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const L of levels) {
    const amount = ps.reduce((a, p) => a + Math.min(p.total, L) - Math.min(p.total, prev), 0);
    const eligible = alive.filter((p) => p.total >= L).map((p) => p.seat);
    if (amount > 0) pots.push({ amount, eligible });
    prev = L;
  }
  const rest = ps.reduce((a, p) => a + Math.max(0, p.total - prev), 0);
  if (rest > 0) {
    const elig = alive.filter((p) => !p.allIn && p.total > prev).map((p) => p.seat);
    if (elig.length > 0) pots.push({ amount: rest, eligible: elig });
    else if (pots.length > 0) pots[pots.length - 1].amount += rest;
    else pots.push({ amount: rest, eligible: alive.map((p) => p.seat) });
  }
  const merged: Pot[] = [];
  for (const p of pots) {
    const last = merged[merged.length - 1];
    if (last && last.eligible.join(',') === p.eligible.join(',')) last.amount += p.amount;
    else merged.push({ amount: p.amount, eligible: p.eligible.slice() });
  }
  if (opts.refund && ps.length >= 2) {
    const byTotal = ps.slice().sort((a, b) => b.total - a.total);
    const top = byTotal[0];
    const excess = top.total - byTotal[1].total;
    const last = merged[merged.length - 1];
    // 맨 위 몫은 언제나 마지막 팟에 들어 있고, 그 팟의 대상은 가장 많이 낸 사람 혼자다
    if (excess > 0 && !top.folded && last && last.eligible.length === 1 && last.eligible[0] === top.seat && last.amount >= excess) {
      last.amount -= excess;
      if (last.amount === 0) merged.pop();
      merged.push({ amount: excess, eligible: [top.seat], refund: true });
    }
  }
  return merged;
}

/**
 * 팟을 승자들에게 똑같이 나눈다. 나누어떨어지지 않는 나머지 칩은 order(먼저 받을 순서) 앞쪽 승자부터 1씩.
 * → { 자리: 받은 금액 }
 */
export function splitPot(amount: number, winners: number[], order: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  if (!winners.length) return out;
  const share = Math.floor(amount / winners.length);
  let left = amount - share * winners.length;
  for (const w of winners) out[w] = share;
  const ranked = [...winners].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  for (const w of ranked) {
    if (left <= 0) break;
    out[w] += 1;
    left -= 1;
  }
  return out;
}
