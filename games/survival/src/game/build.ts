import { EVOLUTIONS } from '../data/evolutions';
import { PASSIVES } from '../data/passives';
import { WEAPONS, WEAPON_INDEX } from '../data/weapons';
import type { State } from './state';

/**
 * 판이 끝났을 때의 빌드 요약 (결과 화면용. 서버에는 보내지 않는다).
 * 시뮬레이션이 쌓아 둔 값을 읽기만 한다 — 판의 진행에는 영향이 없다.
 */
export interface BuildWeapon {
  /** data/weapons.ts 의 id (진화했으면 진화 무기의 id) */
  id: string;
  lv: number;
  evolved: boolean;
  /** 이 무기가 준 피해 합 (진화 무기는 진화 전 무기가 준 피해까지) */
  dmg: number;
}
export interface BuildPassive {
  id: string;
  lv: number;
}
export interface RunBuild {
  /** 든 순서 그대로 */
  weapons: BuildWeapon[];
  passives: BuildPassive[];
}

/** 진화 무기 번호 → 진화 전 무기 번호 */
const BASE_OF: Record<number, number> = Object.fromEntries(EVOLUTIONS.map((e) => [WEAPON_INDEX[e.result], WEAPON_INDEX[e.weapon]]));

export function runBuild(s: Pick<State, 'weapons' | 'passives' | 'dmgByWeapon'>): RunBuild {
  const held = new Set(s.weapons.map((w) => w.def));
  const dmg = (def: number) => Math.max(0, Number(s.dmgByWeapon[def]) || 0);
  return {
    weapons: s.weapons.map((w) => {
      const d = WEAPONS[w.def];
      const base = BASE_OF[w.def];
      // 진화 전 무기는 진화하면서 사라졌다: 그 무기가 준 피해는 진화 무기의 것으로 합친다
      const before = base !== undefined && !held.has(base) ? dmg(base) : 0;
      return { id: d.id, lv: w.lv, evolved: d.evolved === true, dmg: Math.round(dmg(w.def) + before) };
    }),
    passives: s.passives.map((p) => ({ id: PASSIVES[p.def].id, lv: p.lv })),
  };
}

export interface DamageShare extends BuildWeapon {
  name: string;
  /** 전체 피해 가운데 비율 (0~100, 반올림) */
  pct: number;
  /** 막대 길이 (가장 많이 준 무기 = 100) */
  bar: number;
}

/** 무기별 피해 비율: 많이 준 순 (같으면 든 순서) */
export function damageShares(b: RunBuild): DamageShare[] {
  const list = b.weapons.filter((w) => WEAPON_INDEX[w.id] !== undefined).map((w) => ({ ...w, dmg: Math.max(0, Number(w.dmg) || 0) }));
  const total = list.reduce((a, w) => a + w.dmg, 0);
  const top = list.reduce((a, w) => Math.max(a, w.dmg), 0);
  return list
    .map((w, i) => ({ w, i }))
    .sort((a, b2) => b2.w.dmg - a.w.dmg || a.i - b2.i)
    .map(({ w }) => ({
      ...w,
      name: WEAPONS[WEAPON_INDEX[w.id]].name,
      pct: total > 0 ? Math.round((w.dmg / total) * 100) : 0,
      bar: top > 0 ? Math.round((w.dmg / top) * 100) : 0,
    }));
}
