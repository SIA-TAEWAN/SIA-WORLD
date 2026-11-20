import { canSpecial, cloneRun, playShot, threats, type RunState, type ShotInput, type SimEvent } from '../sim';

/**
 * 자동 플레이어 (개발용 ?auto=1 · 테스트 · 5단계 밸런스 보정):
 * 각도 36개 × 힘 3개를 미리 끝까지(요괴 차례까지) 돌려 보고 가장 좋은 한 수를 고른 다음, 그 둘레를 조금 더 촘촘히 본다.
 * 판 안에 무작위가 없으므로 미리 돌린 결과가 실제 결과와 똑같다.
 */

export interface PilotOptions {
  /** 거친 탐색 각도 간격 (0.1° 단위) */
  coarse?: number;
  powers?: number[];
}

/** 한 수의 점수: 준 피해 · 쓰러뜨림 · 웨이브 넘김 · 클리어는 +, 잃은 체력 · 쓰러짐 · 다음 공격 범위 안에 선 대원은 − */
export function scoreShot(before: RunState, after: RunState, ev: SimEvent[]): number {
  if (after.phase === 'clear') return 1e6 - after.turn;
  if (after.phase === 'fail') return -1e6;
  let sc = 0;
  for (const e of ev) {
    if (e.t === 'hit') sc += e.dmg;
    else if (e.t === 'kill') sc += 60;
    else if (e.t === 'wave') sc += 500;
    else if (e.t === 'pick') sc += e.kind === 'heal' ? e.v * 1.5 : 10;
  }
  before.heroes.forEach((h, i) => {
    const a = after.heroes[i];
    sc -= (h.hp - a.hp) * 1.5;
    if (a.fallen && !h.fallen) sc -= 400;
  });
  // 다음 요괴 차례에 맞을 대원 (area 원 안)
  for (const t of threats(after)) {
    if (t.kind !== 'area') continue;
    after.heroes.forEach((h) => {
      if (h.fallen) return;
      const rr = t.r + h.r;
      if ((h.x - t.x) * (h.x - t.x) + (h.y - t.y) * (h.y - t.y) < rr * rr) sc -= 40;
    });
  }
  // 남은 요괴 체력이 적을수록 좋다
  for (const f of after.foes) if (f.alive) sc -= f.hp * 0.05;
  return sc;
}

function tryShot(s: RunState, inp: ShotInput): number {
  const c = cloneRun(s);
  const ev = playShot(c, inp);
  return scoreShot(s, c, ev);
}

/** 이번 차례에 쏠 조작 하나 */
export function choose(s: RunState, opts: PilotOptions = {}): ShotInput {
  const coarse = opts.coarse ?? 100;
  const powers = opts.powers ?? [40, 70, 100];
  const sp: 0 | 1 = canSpecial(s) ? 1 : 0;
  let best: ShotInput = { a: 2700, p: 70, s: sp };
  let bestSc = -Infinity;
  const consider = (a: number, p: number) => {
    const inp: ShotInput = { a: ((a % 3600) + 3600) % 3600, p: Math.max(1, Math.min(100, p)), s: sp };
    const sc = tryShot(s, inp);
    if (sc > bestSc) {
      bestSc = sc;
      best = inp;
    }
  };
  for (let a = 0; a < 3600; a += coarse) for (const p of powers) consider(a + 50, p);
  // 고른 수 둘레를 촘촘히
  const a0 = best.a;
  const p0 = best.p;
  for (let da = -40; da <= 40; da += 10) for (const dp of [-15, 0, 15]) if (da || dp) consider(a0 + da, p0 + dp);
  return best;
}
