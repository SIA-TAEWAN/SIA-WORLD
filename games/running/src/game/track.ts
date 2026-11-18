import {
  BANANA_LEN, BAR_LEN, BOOST_LEN, HURDLE_LEN, LOG_LEN, MIN_GAP, MUD_LONG_LEN, MUD_SHORT_LEN, OBSTACLE_COUNTS, SAFE_END, SAFE_START, TRACK_LEN,
} from './constants';
import { makeRng, shuffle } from './rng';

export type ObstacleKind = 'mudShort' | 'mudLong' | 'hurdle' | 'banana' | 'log' | 'boost' | 'bar';

export interface Obstacle {
  /** 놓인 순서 (0부터) */
  id: number;
  kind: ObstacleKind;
  /** 시작 위치 (m). 통나무는 구르기 전 자리 */
  x: number;
  len: number;
}

export const OBSTACLE_LEN: Record<ObstacleKind, number> = {
  mudShort: MUD_SHORT_LEN,
  mudLong: MUD_LONG_LEN,
  hurdle: HURDLE_LEN,
  banana: BANANA_LEN,
  log: LOG_LEN,
  boost: BOOST_LEN,
  bar: BAR_LEN,
};

/** 순서 규칙: 부스트 발판은 허들 바로 뒤에 놓지 않는다 */
function orderOk(kinds: ObstacleKind[]): boolean {
  for (let i = 1; i < kinds.length; i++) if (kinds[i] === 'boost' && kinds[i - 1] === 'hurdle') return false;
  return true;
}

/**
 * 시드로 방해물을 놓는다 (4개 레인이 같은 배치를 쓴다).
 * 1) 종류 순서를 섞고(규칙에 맞을 때까지) 2) 최소 간격으로 나란히 놓은 뒤 3) 남는 길이를 무작위로 나눠 벌린다.
 */
export function makeTrack(seed: number): Obstacle[] {
  const rng = makeRng(seed);
  const pool: ObstacleKind[] = [];
  for (const [kind, n] of Object.entries(OBSTACLE_COUNTS) as [ObstacleKind, number][]) for (let i = 0; i < n; i++) pool.push(kind);
  let kinds = shuffle(pool, rng);
  for (let tries = 0; !orderOk(kinds) && tries < 200; tries++) kinds = shuffle(pool, rng);
  if (!orderOk(kinds)) {
    // 거의 일어나지 않지만, 끝내 못 맞추면 부스트를 맨 앞으로 옮긴다
    kinds = [...kinds.filter((k) => k === 'boost'), ...kinds.filter((k) => k !== 'boost')];
  }

  const from = SAFE_START;
  const to = TRACK_LEN - SAFE_END;
  const used = kinds.reduce((s, k) => s + OBSTACLE_LEN[k], 0) + MIN_GAP * (kinds.length - 1);
  const slack = Math.max(0, to - from - used);
  // 남는 길이를 앞·사이·뒤 (개수 + 1)곳에 나눈다
  const w = Array.from({ length: kinds.length + 1 }, () => 0.2 + rng());
  const sum = w.reduce((a, b) => a + b, 0);
  const out: Obstacle[] = [];
  let cursor = from + (slack * w[0]) / sum;
  kinds.forEach((kind, i) => {
    const len = OBSTACLE_LEN[kind];
    out.push({ id: i, kind, x: Math.round(cursor * 100) / 100, len });
    cursor += len + MIN_GAP + (slack * w[i + 1]) / sum;
  });
  return out;
}

/** 배치 규칙 확인 (테스트·점검용). 문제가 있으면 설명을 돌려준다 */
export function trackProblems(obs: Obstacle[]): string[] {
  const bad: string[] = [];
  const count: Record<string, number> = {};
  obs.forEach((o, i) => {
    count[o.kind] = (count[o.kind] ?? 0) + 1;
    if (o.x < SAFE_START - 1e-6) bad.push(`${o.kind}#${i}: 출발 ${SAFE_START}m 안`);
    if (o.x + o.len > TRACK_LEN - SAFE_END + 1e-6) bad.push(`${o.kind}#${i}: 도착 전 ${SAFE_END}m 안`);
    const prev = obs[i - 1];
    if (prev) {
      if (o.x - (prev.x + prev.len) < MIN_GAP - 0.011) bad.push(`${o.kind}#${i}: 앞 방해물과 ${MIN_GAP}m보다 가까움`);
      if (o.kind === 'boost' && prev.kind === 'hurdle') bad.push(`boost#${i}: 허들 바로 뒤`);
    }
  });
  for (const [k, n] of Object.entries(OBSTACLE_COUNTS)) if (count[k] !== n) bad.push(`${k} 개수 ${count[k] ?? 0} (기준 ${n})`);
  return bad;
}
