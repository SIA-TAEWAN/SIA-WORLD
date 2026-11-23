import type { Mode } from '../data/regions';
import { applyReport, checkReport, checkStart, emptyProfile, setLoadout, type FinishResult, type RunReport, type TwelveProfile } from '../game/progress';
import { isHero } from '../data/heroes';
import { WEAPON_KINDS, type WeaponKind } from '../data/weapons';
import { LOCAL_MODE } from './local';

/**
 * 기록 저장 (PRD '저장과 서버'): 맵을 시작할 때 start, 끝날 때 finish 로 한 번에.
 * - 테스트 모드(?local=1): 같은 규칙(src/game/progress.ts)으로 이 기기에만 저장한다 (createLocalApi).
 * - 서버: 5단계에서 createSupabaseApi(078_twelve.sql 의 RPC)를 만들어 getApi 의 분기 자리에 넣는다.
 *   그때까지는 로그인해도 기기 저장을 쓴다 (게임은 로비에서 닫혀 있다).
 */

export class ApiError extends Error {}

export interface TwelveApi {
  loadProfile(): Promise<TwelveProfile>;
  /** 판 시작 → 판 번호 (거절이면 ApiError, 통신 실패면 '' = 기록되지 않는 판) */
  start(map: string, mode: Mode, hero: string, weapon: string): Promise<string>;
  /** 판 결과 → 새 프로필과 결과 (통신 실패면 null) */
  finish(report: RunReport): Promise<{ profile: TwelveProfile; result: FinishResult } | null>;
  /** 대원·무기 바꾸기 */
  setLoadout(hero: string, weapon: string): Promise<TwelveProfile>;
}

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();
const memStore: Store = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v), removeItem: (k) => void memory.delete(k) };
export const safeStore = (): Store => {
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    return localStorage;
  } catch {
    return memStore;
  }
};

const recs = (v: unknown): TwelveProfile['maps']['normal'] => {
  const out: TwelveProfile['maps']['normal'] = {};
  if (typeof v !== 'object' || !v) return out;
  for (const [id, r] of Object.entries(v as Record<string, Partial<TwelveProfile['maps']['normal'][string]>>)) {
    if (!r || !(Number(r.clears) > 0)) continue;
    out[id] = { stars: Number(r.stars) & 7, clears: Math.floor(Number(r.clears)), best: Math.max(0, Number(r.best) || 0) };
  }
  return out;
};

/** 저장된 값(기기·서버)을 프로필 모양으로 */
export function normalize(v: unknown): TwelveProfile {
  const o = (v ?? {}) as Partial<TwelveProfile>;
  const e = emptyProfile();
  return {
    level: Math.max(1, Math.min(99, Math.floor(Number(o.level) || 1))),
    exp: Math.max(0, Math.floor(Number(o.exp) || 0)),
    coins: Math.max(0, Math.floor(Number(o.coins) || 0)),
    mode: o.mode === 'hard' ? 'hard' : 'normal',
    hero: typeof o.hero === 'string' && isHero(o.hero) ? o.hero : e.hero,
    weapon: (WEAPON_KINDS as readonly string[]).includes(o.weapon as string) ? (o.weapon as WeaponKind) : e.weapon,
    maps: { normal: recs(o.maps?.normal), hard: recs(o.maps?.hard) },
  };
}

export function createLocalApi(store: Store, key = 'sia-twelve-local-v1'): TwelveApi {
  const load = () => {
    try {
      return normalize(JSON.parse(store.getItem(key) ?? 'null'));
    } catch {
      return emptyProfile();
    }
  };
  const save = (p: TwelveProfile) => store.setItem(key, JSON.stringify(p));
  let n = 0;
  return {
    async loadProfile() {
      return load();
    },
    async start(map, mode, hero, weapon) {
      const why = checkStart(load(), map, mode, hero, weapon);
      if (why) throw new ApiError(why);
      return `local-${Date.now()}-${n++}`;
    },
    async finish(report) {
      const why = checkReport(report);
      if (why) throw new ApiError(why);
      const p = load();
      const result = applyReport(p, report);
      save(p);
      return { profile: p, result };
    },
    async setLoadout(hero, weapon) {
      const p = load();
      const why = setLoadout(p, hero, weapon);
      if (why) throw new ApiError(why);
      save(p);
      return p;
    },
  };
}

/** uid = 로그인한 사람 (테스트 모드는 'local') */
export async function getApi(uid: string): Promise<TwelveApi> {
  if (LOCAL_MODE) return createLocalApi(safeStore());
  // 서버 분기 자리 (5단계): return createSupabaseApi(await worldSupabase(), uid, safeStore());
  return createLocalApi(safeStore(), `sia-twelve-device-v1:${uid}`);
}
