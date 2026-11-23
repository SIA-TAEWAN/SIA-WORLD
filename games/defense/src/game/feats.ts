import type { CharId } from '../data/balance';
import { TOWERS } from '../data/characters';
import type { State } from './state';

/**
 * 활약상 (결과 화면): 판이 끝났을 때 캐릭터별 집계(state.stats)를 화면에 쓰기 좋게 정리한다.
 * 집계는 core.ts 의 hurt · burn · fall · stunEnemy 와 sim.ts 가 적는다. 판의 진행은 이 값을 읽지 않는다.
 */

export interface FeatRow {
  char: CharId;
  /** 준 피해 (실제로 깎은 체력, 반올림) · 처치 수 */
  dmg: number;
  kills: number;
  /** 지원: 요괴를 멈춘 시간 · 느리게 한 시간 (초, 요괴마다 더한 값) · 올려 준 피해 · 벌어 준 기운 */
  stun: number;
  slow: number;
  boost: number;
  energy: number;
}

export interface Feats {
  /** 이 판에 한 번이라도 놓았거나 한 일이 있는 캐릭터 (출전 순서) */
  rows: FeatRow[];
  /** 오늘의 일꾼: 준 피해 + 올려 준 피해가 가장 큰 캐릭터 (아무도 피해를 주지 못했으면 null) */
  mvp: CharId | null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** 오늘의 일꾼을 가리는 점수: 준 피해 + 올려 준 피해 */
export const featScore = (r: FeatRow) => r.dmg + r.boost;

export function featsOf(s: State): Feats {
  const st = s.stats;
  const placed = new Set<number>();
  for (const c of s.log) if (c.op === 'place') placed.add(c.char);
  const rows: FeatRow[] = [];
  for (const i of s.squad) {
    const row: FeatRow = {
      char: TOWERS[i].id,
      dmg: Math.round(st.dmg[i]),
      kills: st.kills[i],
      stun: round1(st.stun[i]),
      slow: round1(st.slow[i]),
      boost: Math.round(st.boost[i]),
      energy: Math.round(st.energy[i]),
    };
    if (placed.has(i) || row.dmg > 0 || row.kills > 0) rows.push(row);
  }
  return { rows, mvp: pickMvp(rows) };
}

/** 점수가 가장 큰 캐릭터. 같으면 처치가 많은 쪽, 그래도 같으면 앞선 순서 */
export function pickMvp(rows: readonly FeatRow[]): CharId | null {
  let best: FeatRow | null = null;
  for (const r of rows) {
    if (featScore(r) <= 0) continue;
    if (!best || featScore(r) > featScore(best) || (featScore(r) === featScore(best) && r.kills > best.kills)) best = r;
  }
  return best ? best.char : null;
}

/** 지원 기여 한 줄 (없으면 빈 글). 예: "요괴를 멈춘 시간 42초 · 올려 준 피해 1,234" */
export function supportLine(r: FeatRow): string {
  const parts: string[] = [];
  if (r.stun >= 0.5) parts.push(`멈춘 시간 ${Math.round(r.stun).toLocaleString()}초`);
  if (r.slow >= 0.5) parts.push(`느리게 한 시간 ${Math.round(r.slow).toLocaleString()}초`);
  if (r.boost > 0) parts.push(`올려 준 피해 ${r.boost.toLocaleString()}`);
  if (r.energy > 0) parts.push(`벌어 준 기운 ${r.energy.toLocaleString()}`);
  return parts.join(' · ');
}
