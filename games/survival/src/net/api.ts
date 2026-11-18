import { ZODIAC_IDS, type ZodiacId } from '../data/balance';
import { CHARACTERS } from '../data/characters';
import { MAPS, MAP_INDEX } from '../data/maps';
import { UPGRADE_TOTAL, presetUpgrades, type UpgradeLevels } from '../data/upgrades';
import type { RunSummary } from '../game/sim';

/**
 * 서버 연결. 시아서바이벌은 1인 전용이라 게임 중에는 서버와 통신하지 않는다 (PRD 1장).
 * 판이 끝날 때 한 번 저장하는 것(엽전·영구 강화·해금·기록)은 4·5단계에서 만든다.
 * 그때 쓸 자료의 모양(SurvivalProfile · RunSummary)과 연결 자리(SurvivalApi)를 여기에 잡아 둔다.
 */

const params = new URLSearchParams(location.search);
/** 주소의 ?local=1 이면 로그인 없이 해 보는 테스트 모드. 개발 서버나 내 컴퓨터(localhost)에서만 켜진다 */
export const LOCAL_MODE =
  params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(location.hostname));

/**
 * 판 밖에 저장할 것 (PRD 11장 survival_profiles). 4단계에서 Supabase 에 저장한다.
 * 지금은 기기에도 저장하지 않고, 처음 상태(엽전 0 · 강화 0)로만 돈다.
 */
export interface SurvivalProfile {
  coins: number;
  /** 영구 강화: 항목 id → 레벨 (data/upgrades.ts) */
  upgrades: UpgradeLevels;
  unlockedCharacters: ZodiacId[];
  unlockedMaps: string[];
  /** 도감: 만난 요괴·보스, 얻은 무기·패시브·진화 무기 (id 목록) */
  codex: { enemies: string[]; bosses: string[]; weapons: string[]; passives: string[] };
  /** 해금 조건용 누적 값 */
  totals: { kills: number; cakes: number; bestTime: number; bossKills: number; clears: number };
}

export function defaultProfile(): SurvivalProfile {
  return {
    coins: 0,
    upgrades: presetUpgrades(0),
    unlockedCharacters: CHARACTERS.filter((c) => c.unlock.kind === 'base').map((c) => c.id),
    unlockedMaps: [MAPS[0].id],
    codex: { enemies: [], bosses: [], weapons: [], passives: [] },
    totals: { kills: 0, cakes: 0, bestTime: 0, bossKills: 0, clears: 0 },
  };
}

export interface SurvivalApi {
  kind: 'supabase' | 'local';
  loadProfile(): Promise<SurvivalProfile>;
  /** 판이 끝날 때 한 번 (PRD 11장: survival_runs 한 줄 + 프로필·최고 기록 갱신). 4단계에서 만든다 */
  saveRun(run: RunSummary): Promise<{ ok: boolean; newRecord?: boolean }>;
}

/** 지금은 저장하지 않는 임시 구현 하나뿐이다 (로그인했든 테스트 모드든) */
function createLocalApi(): SurvivalApi {
  return {
    kind: 'local',
    async loadProfile() {
      return defaultProfile();
    },
    async saveRun() {
      return { ok: false };
    },
  };
}

let api: SurvivalApi | null = null;
export async function getApi(_uid: string): Promise<SurvivalApi> {
  return (api ??= createLocalApi());
}

/**
 * 개발용 테스트 설정 (PRD 7장). 개발 서버·localhost 의 ?local=1 에서만 읽는다.
 *   ?local=1&map=field&char=tiger&upg=10&t=420   → 강화 10레벨 상태로 7분 시점부터 바로 시작
 *   seed=숫자: 같은 판 다시 보기
 */
export interface DevSetup {
  map: string | null;
  char: ZodiacId | null;
  /** 강화를 몇 레벨 찍은 상태인가 (0~49) */
  upg: number;
  /** 시작 시각 (초) */
  t: number;
  seed: number | null;
  /** map 과 char 를 모두 적었으면 메뉴를 건너뛰고 바로 판을 시작한다 */
  auto: boolean;
}

export function devSetup(): DevSetup | null {
  if (!LOCAL_MODE) return null;
  const map = params.get('map');
  const char = params.get('char') as ZodiacId | null;
  const okMap = map !== null && MAP_INDEX[map] !== undefined ? map : null;
  const okChar = char !== null && ZODIAC_IDS.includes(char) ? char : null;
  const num = (k: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(params.get(k)) || 0)));
  const seed = params.get('seed');
  return {
    map: okMap,
    char: okChar,
    upg: num('upg', UPGRADE_TOTAL),
    t: num('t', 660),
    seed: seed !== null && Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : null,
    auto: okMap !== null && okChar !== null,
  };
}
