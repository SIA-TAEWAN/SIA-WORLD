import type { SimEvent } from './types';

/**
 * 판 끝 상장. 판 동안 발사 결과(SimEvent)를 탱크별로 모아 두었다가 결과 화면에서 칭호를 고른다.
 * 모든 기기가 같은 시뮬레이션을 돌리므로 따로 주고받지 않는다 (다시 맞출 때만 판 상태에 실려 간다).
 * 시뮬레이션 결과(물리·피해)에는 영향을 주지 않는다 — 읽기만 한다.
 */
export interface AwardStats {
  /** 준 피해 (결과 표의 '가한 피해'와 같게: 적에게 준 포탄 피해 + 내 차례에 들어간 지속 피해) */
  damage: number[];
  /** 적 탱크 직격 횟수 */
  directs: number[];
  /** 내 포탄으로 적을 맵 밖으로 떨어뜨린 횟수 */
  fallKills: number[];
  /** 내 포탄에 내가 입은 피해 + 스스로 떨어져 잃은 체력 */
  selfDamage: number[];
  /** 가장 멀리서 맞힌 직격(백발백중은 과녁)의 거리(px) */
  longest: number[];
}

/** 발사 직전의 탱크 상태 (거리·낙사 판정용) */
export interface TankBefore {
  idx: number;
  team: number;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

const KEYS = ['damage', 'directs', 'fallKills', 'selfDamage', 'longest'] as const;

export function newAwardStats(n: number): AwardStats {
  const zeros = () => Array.from({ length: n }, () => 0);
  return { damage: zeros(), directs: zeros(), fallKills: zeros(), selfDamage: zeros(), longest: zeros() };
}

export function cloneAwardStats(s: AwardStats): AwardStats {
  return { damage: [...s.damage], directs: [...s.directs], fallKills: [...s.fallKills], selfDamage: [...s.selfDamage], longest: [...s.longest] };
}

/** 다른 기기에서 받은 값 확인 (예전 판본이 보낸 판 상태에는 없다 → null) */
export function parseAwardStats(v: unknown, n: number): AwardStats | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out = newAwardStats(n);
  for (const k of KEYS) {
    const a = o[k];
    if (!Array.isArray(a) || a.length !== n || !a.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) return null;
    out[k] = [...(a as number[])];
  }
  return out;
}

/** 한 번의 발사 결과를 더한다. before = 발사 직전 상태, events = Match.fire 가 돌려준 사건 (시간 순) */
export function recordShot(stats: AwardStats, shooter: number, before: readonly TankBefore[], events: readonly SimEvent[]): void {
  const me = before[shooter];
  if (!me) return;
  /** 사건을 따라가며 계산한 남은 체력: 체력이 남았는데 죽었으면 맵 밖으로 떨어진 것 */
  const hp = before.map((b) => b.hp);
  const far = (x: number, y: number) => {
    const d = Math.hypot(x - me.x, y - me.y);
    if (d > stats.longest[shooter]) stats.longest[shooter] = d;
  };
  for (const e of events) {
    switch (e.type) {
      case 'damage': {
        const o = before[e.target];
        if (!o) break;
        hp[e.target] -= e.amount;
        if (e.target === shooter) stats.selfDamage[shooter] += e.amount;
        else if (o.team !== me.team) {
          stats.damage[shooter] += e.amount;
          if (e.direct) {
            stats.directs[shooter]++;
            far(o.x, o.y);
          }
        }
        break;
      }
      case 'dot':
        if (!before[e.target]) break;
        hp[e.target] -= e.amount;
        stats.damage[shooter] += e.amount;
        break;
      case 'heal':
        if (before[e.target]) hp[e.target] += e.amount;
        break;
      case 'target':
        far(e.x, e.y);
        break;
      case 'death': {
        const o = before[e.target];
        if (!o || hp[e.target] <= 0) break;
        if (e.target === shooter) stats.selfDamage[shooter] += hp[e.target];
        else if (o.team !== me.team) stats.fallKills[shooter]++;
        hp[e.target] = 0;
        break;
      }
    }
  }
}

/** 이동하다 스스로 맵 밖으로 떨어졌다 (잃은 체력만큼 자폭으로 센다) */
export function recordSelfFall(stats: AwardStats, idx: number, hpLost: number): void {
  if (idx in stats.selfDamage && hpLost > 0) stats.selfDamage[idx] += hpLost;
}

export type AwardId = 'damage' | 'direct' | 'fall' | 'self' | 'long';

export interface Award {
  id: AwardId;
  icon: string;
  title: string;
  /** 받는 탱크 번호 (같은 기록이면 함께) */
  holders: number[];
  /** 기록 한 줄 (예: '직격 3번') */
  text: string;
}

/** 거리(px) → 화면에 보일 숫자 */
export const awardMeters = (px: number) => Math.round(px / 10);

const DEFS: { id: AwardId; icon: string; title: string; key: keyof AwardStats; text: (v: number) => string }[] = [
  { id: 'damage', icon: '💥', title: '최다 피해', key: 'damage', text: (v) => `피해 ${Math.round(v).toLocaleString()}` },
  { id: 'direct', icon: '🎯', title: '직격왕', key: 'directs', text: (v) => `직격 ${v}번` },
  { id: 'fall', icon: '🕳️', title: '낙사 유발', key: 'fallKills', text: (v) => `${v}번 떨어뜨림` },
  { id: 'self', icon: '🧨', title: '자폭왕', key: 'selfDamage', text: (v) => `스스로 ${Math.round(v).toLocaleString()} 피해` },
  { id: 'long', icon: '🔭', title: '최장거리 명중', key: 'longest', text: (v) => `${awardMeters(v)}m` },
];

/** 칭호 고르기: 기록이 가장 높은 탱크(같으면 함께). 해당자가 없는 칭호는 뺀다 */
export function pickAwards(stats: AwardStats): Award[] {
  const out: Award[] = [];
  for (const d of DEFS) {
    // 거리는 화면에 보이는 단위로 견준다 (소수점 차이로 갈리지 않게)
    const vals = stats[d.key].map((v) => (d.key === 'longest' ? awardMeters(v) : v));
    const best = Math.max(0, ...vals);
    if (best <= 0) continue;
    const holders = vals.flatMap((v, i) => (v === best ? [i] : []));
    out.push({ id: d.id, icon: d.icon, title: d.title, holders, text: d.text(d.key === 'longest' ? best * 10 : best) });
  }
  return out;
}
