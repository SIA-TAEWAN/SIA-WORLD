import { beginShot, cloneRun, stepShot, type RunState, type ShotInput } from '../sim';
import { chooseSteps } from './autopilot';

/**
 * 힌트 한 수: 막힐 때 버튼을 누르면 자동 조종(autopilot.ts)이 고른 조준선을 한 번 보여 준다.
 *
 * - 서버와 무관하다. 보여 주기만 하고 쏘지는 않는다 — 쏘는 것은 늘 손가락이고, 서버로 가는 것은 그 조작 값({a, p, s})뿐이다.
 *   힌트가 고르는 값도 손으로 낼 수 있는 범위(a 0~3599 · p 1~100) 안이라 서버의 다시 돌리기(verify.ts)는 달라지지 않는다.
 * - 판 안에 무작위가 없으므로 미리 돌려 본 결과가 실제 결과와 같다.
 * - 계산은 후보 한 수씩 나눠서, 화면 한 장에 HINT_SLICE_MS 만큼만 돈다 (화면이 멈추지 않게).
 */

export type HintMode = 'normal' | 'tower' | 'daily';

/**
 * 한 판에 쓸 수 있는 횟수.
 * - 스테이지: 2회.
 * - 끝없는 탑: 1회 — 한 판이 길고(최대 200턴) 층 기록이 랭킹에 남으므로 위기 한 번만.
 * - 오늘의 도전: 끔 — 모두 같은 판 · 같은 파티로 턴 수를 겨루는 자리라 자동 조종이 대신 풀어 주지 않는다.
 */
export const HINT_USES: Record<HintMode, number> = { normal: 2, tower: 1, daily: 0 };

export const hintMode = (tower: boolean, daily: boolean): HintMode => (daily ? 'daily' : tower ? 'tower' : 'normal');

/** 화면 한 장에 계산에 쓰는 시간 (ms). 60fps 한 장은 16.7ms */
export const HINT_SLICE_MS = 6;

export interface HintSearch {
  /** budgetMs 만큼(적어도 후보 한 수) 계산한다. 끝났으면 고른 조작, 아직이면 null. 끝난 뒤에는 같은 조작을 계속 돌려준다 */
  step(budgetMs?: number, now?: () => number): ShotInput | null;
  /** 지금까지 돌려 본 후보 수 */
  readonly tried: number;
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 지금 차례의 힌트 계산을 시작한다. special: 필살기를 켠 채로(1) · 끈 채로(0) 고른다 (화면의 필살기 버튼 상태) */
export function hintSearch(s: RunState, special: 0 | 1): HintSearch {
  // 계산하는 동안 판 상태가 바뀌어도 흔들리지 않게 시작할 때의 판을 따로 둔다
  const it = chooseSteps(cloneRun(s), { special });
  let found: ShotInput | null = null;
  let tried = 0;
  return {
    step(budgetMs = HINT_SLICE_MS, now = clock) {
      if (found) return found;
      const t0 = now();
      do {
        const r = it.next();
        if (r.done) {
          found = r.value;
          return found;
        }
        tried++;
      } while (now() - t0 < budgetMs);
      return null;
    },
    get tried() {
      return tried;
    },
  };
}

/** 힌트 길을 보여 주는 길이: 이 스텝(1/60초)까지, 또는 벽에 이만큼 튕길 때까지 */
export const HINT_PATH_STEPS = 50;
export const HINT_PATH_BOUNCES = 2;

/**
 * 힌트로 보여 줄 길: 그 조작으로 쏘면 대원이 지나가는 자리 (방 좌표, 스텝마다 한 점 · 첫 점은 지금 자리).
 * 보통 조준선은 첫 벽까지만 보여 주지만, 힌트는 벽에 두 번 튕길 때까지(길어야 HINT_PATH_STEPS) 보여 준다. 판 상태는 건드리지 않는다.
 */
export function hintPath(s: RunState, inp: ShotInput): [number, number][] {
  const c = cloneRun(s);
  const h = c.heroes[c.cur];
  const pts: [number, number][] = [[h.x, h.y]];
  beginShot(c, inp);
  for (let i = 0; i < HINT_PATH_STEPS && c.phase === 'shot'; i++) {
    stepShot(c);
    const m = c.movers[0];
    if (!m) {
      // 멈췄다: 멈춘 자리가 마지막 점
      pts.push([c.heroes[s.cur].x, c.heroes[s.cur].y]);
      break;
    }
    pts.push([m.x, m.y]);
    if (m.bounces >= HINT_PATH_BOUNCES) break;
  }
  return pts;
}
