import { SQUAD_SIZE, ZODIAC_IDS, type ZodiacId } from '../data/balance';
import { STAGES, stageOf } from '../data/stages';
import { applyRun, cleanProfile, defaultProfile, type DefenseProfile, type FinishResult, type RunReport } from '../game/progress';

/**
 * 저장 연결. 시아디펜스는 1인 전용이라 게임 중에는 서버와 통신하지 않는다 (PRD 1장):
 * 메인에 들어올 때 진행 상황을 읽고, 판이 끝날 때 한 번 저장한다.
 *
 * 1~3단계에는 기기 저장(LocalApi)만 있다. 규칙(별·잠금·엽전)은 game/progress.ts 한 곳에 있고,
 * 4단계에서 서버 함수(SQL)를 만들면 같은 DefenseApi 모양의 Supabase 구현을 더한다 (시아서바이벌 net/api.ts 와 같은 구조).
 */

/** 주소 (화면 없이 시험할 때는 없다) */
const loc = typeof location === 'undefined' ? null : location;
const params = new URLSearchParams(loc?.search ?? '');
/** 주소의 ?local=1 이면 로그인 없이 해 보는 테스트 모드. 개발 서버나 내 컴퓨터(localhost)에서만 켜진다 */
export const LOCAL_MODE =
  !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));

export type { DefenseProfile, FinishResult, RunReport } from '../game/progress';

/** 저장이 거절됐을 때의 까닭 */
export class ApiError extends Error {}

export interface DefenseApi {
  kind: 'supabase' | 'local';
  loadProfile(): Promise<DefenseProfile>;
  /** 판 끝: 새 진행 상황과 결과. 받아들일 수 없는 판이면 ApiError */
  finish(report: RunReport): Promise<{ profile: DefenseProfile; result: FinishResult }>;
}

/** 저장소 (localStorage 모양. 시험에서는 가짜를 넣는다) */
export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function browserStore(): Store {
  try {
    localStorage.getItem('siadefense:probe');
    return localStorage;
  } catch {
    // 저장소를 쓸 수 없는 브라우저: 이번 접속 동안만 기억한다
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
}

// ───────────────────────── 기기 저장 ─────────────────────────

/** 테스트 모드(?local=1)의 저장 열쇠. 로그인한 사용자는 계정마다 따로 (`siadefense:save:<사용자 id>`) */
export const LOCAL_KEY = 'siadefense:local';

export function createLocalApi(store: Store, key = LOCAL_KEY): DefenseApi {
  const read = (): DefenseProfile => {
    try {
      const d = JSON.parse(store.getItem(key) ?? 'null') as { profile?: unknown } | null;
      if (d) return cleanProfile(d.profile);
    } catch {
      /* 처음 상태 */
    }
    return defaultProfile();
  };
  const write = (profile: DefenseProfile) => {
    try {
      store.setItem(key, JSON.stringify({ profile }));
    } catch {
      /* 무시 */
    }
  };
  return {
    kind: 'local',
    async loadProfile() {
      return read();
    },
    async finish(report) {
      let out: ReturnType<typeof applyRun>;
      try {
        out = applyRun(read(), report);
      } catch (e) {
        throw new ApiError((e as Error).message);
      }
      write(out.profile);
      return out;
    },
  };
}

let api: DefenseApi | null = null;
export async function getApi(uid: string): Promise<DefenseApi> {
  if (api) return api;
  const store = browserStore();
  if (LOCAL_MODE) {
    seedLocal(store);
    return (api = createLocalApi(store));
  }
  // 1~3단계: 로그인한 사용자도 이 기기에 저장한다 (서버 저장은 4단계)
  return (api = createLocalApi(store, `siadefense:save:${uid}`));
}

/**
 * 테스트 모드의 진행 상황을 주소로 정한다 (헤드리스 확인용):
 *   ?fresh=1 처음 상태로 · ?coins=500 엽전 · ?cleared=1-4 그 스테이지까지 클리어한 것으로 (&stars=3 이면 별 3개씩, 없으면 1개씩)
 */
function seedLocal(store: Store) {
  if (params.get('fresh') === '1') store.removeItem(LOCAL_KEY);
  const coins = params.get('coins');
  const upTo = stageOf(params.get('cleared') ?? '');
  if (coins === null && !upTo) return;
  let d: { profile?: unknown } = {};
  try {
    d = JSON.parse(store.getItem(LOCAL_KEY) ?? '{}') ?? {};
  } catch {
    /* 처음 상태 */
  }
  const p = cleanProfile(d.profile);
  if (coins !== null) p.coins = Math.max(0, Math.floor(Number(coins)) || 0);
  if (upTo) {
    const stars = Math.max(1, Math.min(3, Math.floor(Number(params.get('stars')) || 1)));
    for (const s of STAGES) {
      if (s.region < upTo.region || (s.region === upTo.region && s.no <= upTo.no)) p.stages[s.id] = Math.max(p.stages[s.id] ?? 0, stars);
    }
  }
  store.setItem(LOCAL_KEY, JSON.stringify({ profile: p }));
}

/**
 * 개발용 테스트 설정. 개발 서버·localhost 의 ?local=1 에서만 읽는다.
 *   ?local=1&stage=1-5              → 메뉴를 건너뛰고 그 스테이지의 판으로 바로 간다 (잠금을 보지 않는다)
 *   &squad=rat,tiger  데려갈 캐릭터 · &seed=숫자  같은 판 다시 보기
 * (지역과 캐릭터 레벨을 정하는 설정은 판 밖 성장이 생기는 4단계에서 더한다 — PRD 7장)
 */
export interface DevSetup {
  stage: string | null;
  squad: ZodiacId[] | null;
  seed: number | null;
}

export function devSetup(): DevSetup | null {
  if (!LOCAL_MODE) return null;
  const stage = params.get('stage');
  const squad = (params.get('squad') ?? '').split(',').filter((c): c is ZodiacId => (ZODIAC_IDS as readonly string[]).includes(c)).slice(0, SQUAD_SIZE);
  const seed = params.get('seed');
  return {
    stage: stage !== null && stageOf(stage) ? stage : null,
    squad: squad.length ? squad : null,
    seed: seed !== null && Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : null,
  };
}
