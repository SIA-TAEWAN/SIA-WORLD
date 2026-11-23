import { RUN_SEC, type CharId } from '../data/balance';
import { CHARACTERS } from '../data/characters';
import { MAPS, MAP_INDEX } from '../data/maps';

/**
 * 오늘의 도전 (공통 틀: supabase/migrations/082_daily.sql · shared/daily.js, 서버 기록: 084_survival_daily.sql).
 * 하루(한국 시간) 동안 모두 같은 맵·캐릭터·시드·강화 단계로 4분 판을 하고, 그날 기록만 따로 순위를 매긴다.
 * 조건은 날짜 문자열('YYYY-MM-DD')에서만 나온다: 같은 날이면 어느 기기에서나 같다. 이 파일은 화면·서버 없이 계산만 한다.
 */

/** 082 의 _daily_games · shared/daily.js 의 DAILY_GAMES 에 있는 이 게임의 이름 */
export const DAILY_GAME = 'survival';

/** 고를 수 있는 캐릭터: 처음부터 열려 있는 캐릭터만 (잠긴 캐릭터·고양이는 뺀다 → 누구나 할 수 있다) */
export const DAILY_CHARS: readonly CharId[] = CHARACTERS.filter((c) => c.unlock.kind === 'base').map((c) => c.id);

/** 고를 수 있는 맵: 모든 맵 (오늘의 도전은 맵 잠금을 보지 않는다, 084 의 survival_start) */
export const DAILY_MAPS: readonly string[] = MAPS.filter((m) => m.ready).map((m) => m.id);

/**
 * 맵별 강화 단계 (0~49, data/upgrades.ts 의 presetUpgrades). 내 강화 대신 모두 이 단계로 맞춘다 (같은 조건).
 * 값은 그 맵을 '클리어할 수 있는 강화 수준' (PRD 7장의 밸런스 목표)
 */
export const DAILY_UPGRADES: Record<string, number> = { field: 10, bamboo: 22, palace: 34, underworld: 44 };

export interface DailyChallenge {
  /** 한국 날짜 'YYYY-MM-DD' */
  day: string;
  map: string;
  char: CharId;
  /** 판의 시드 (RunConfig.seed): 요괴 등장·레벨업 카드가 모두에게 같다 */
  seed: number;
  /** 강화 단계 (presetUpgrades 에 넘긴다) */
  upg: number;
}

/** 32비트 시드 (FNV-1a). shared/daily.js 의 dailySeed 와 같은 식이어야 한다 (tests/daily.test.ts 가 대조) */
export function dailySeed(game: string, day: string, salt = ''): number {
  const s = `${game}:${day}:${salt}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 날짜 문자열인가 */
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 기기 시계로 만든 한국 날짜 (서버에 물을 수 없을 때만: 테스트 모드) */
export const localDay = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 그날의 조건. seedOf: shared/daily.js 의 dailySeed (못 불러왔으면 위의 같은 식) */
export function dailyChallenge(day: string, seedOf: (game: string, day: string, salt?: string) => number = dailySeed): DailyChallenge {
  const map = DAILY_MAPS[(seedOf(DAILY_GAME, day, 'map') >>> 0) % DAILY_MAPS.length];
  const char = DAILY_CHARS[(seedOf(DAILY_GAME, day, 'char') >>> 0) % DAILY_CHARS.length];
  return { day, map, char, seed: seedOf(DAILY_GAME, day, 'seed') >>> 0, upg: DAILY_UPGRADES[map] ?? 0 };
}

/** 점수 자리: 생존 초 × TIME_UNIT + 클리어 CLEAR_BONUS + 처치 수 (처치 수 상한 12,100 < CLEAR_BONUS < TIME_UNIT) */
export const DAILY_TIME_UNIT = 100000;
export const DAILY_CLEAR_BONUS = 50000;

/**
 * 점수 (클수록 좋다). 084 의 survival_finish 가 같은 식으로 넣는다.
 * 오래 버틴 쪽이 위, 4분을 채웠으면 최종 보스를 잡은(클리어) 쪽이 위, 그다음은 처치 수
 */
export const dailyScore = (r: { time: number; kills: number; cleared: boolean }) =>
  Math.min(RUN_SEC, Math.max(0, Math.floor(r.time))) * DAILY_TIME_UNIT + (r.cleared ? DAILY_CLEAR_BONUS : 0) + Math.max(0, Math.floor(r.kills));

/** 순위 한 줄 (daily_ranking 의 top 한 칸에서 쓰는 것만) */
export interface DailyRow {
  place: number;
  nickname: string;
  time: number;
  kills: number;
  cleared: boolean;
  me: boolean;
}
export interface DailyRanking {
  day: string;
  /** 서버의 오늘 (day 와 다르면 지난 날의 순위다. 옛 답에 없으면 day 와 같게 둔다) */
  today: string;
  top: DailyRow[];
  /** 내 기록 (아직 없으면 null) */
  mine: { place: number; time: number; kills: number; cleared: boolean; plays: number } | null;
  total: number;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/** 서버가 준 순위를 믿을 수 있는 모양으로 (모양이 다르면 null → 화면은 조용히 숨긴다) */
export function cleanDailyRanking(raw: unknown): DailyRanking | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as { day?: unknown; today?: unknown; top?: unknown; mine?: unknown; total?: unknown };
  if (!isDay(d.day) || !Array.isArray(d.top)) return null;
  const detail = (x: unknown) => {
    const o = (x && typeof x === 'object' ? x : {}) as { time?: unknown; kills?: unknown; cleared?: unknown };
    return { time: Math.min(RUN_SEC, num(o.time)), kills: num(o.kills), cleared: o.cleared === true };
  };
  const top: DailyRow[] = [];
  for (const r of d.top as { place?: unknown; nickname?: unknown; detail?: unknown; me?: unknown }[]) {
    if (!r || typeof r !== 'object' || num(r.place) < 1) continue;
    top.push({ place: num(r.place), nickname: String(r.nickname ?? ''), ...detail(r.detail), me: r.me === true });
  }
  const m = d.mine as { place?: unknown; detail?: unknown; plays?: unknown } | null | undefined;
  const mine = m && typeof m === 'object' && num(m.place) >= 1 ? { place: num(m.place), ...detail(m.detail), plays: num(m.plays) } : null;
  return { day: d.day, today: isDay(d.today) ? d.today : d.day, top, mine, total: Math.max(num(d.total), top.length) };
}

/** 화면에 적는 날짜: '11월 23일' */
export const dayText = (day: string) => (isDay(day) ? `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일` : '');

/**
 * 결과 화면의 순위 한 줄 앞머리: 기록된 날이 서버의 오늘이면 '오늘', 아니면 그 날짜 ('11월 22일').
 * (자정을 넘겨 끝낸 판·나중에 다시 올라간 판은 시작한 날의 순위에 들어간다)
 */
export const dailyWhen = (day: string, today: string) => (day === today ? '오늘' : dayText(day) || '그날');

/** 맵 이름 (조건 설명용) */
export const dailyMapName = (c: DailyChallenge) => MAPS[MAP_INDEX[c.map] ?? 0].name;
