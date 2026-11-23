import { SQUAD_SIZE, type CharId } from '../data/balance';
import { EXTRAS, ROSTER } from '../data/characters';
import { STAGES } from '../data/stages';
import type { GameConfig } from './state';

/**
 * 오늘의 고개 (오늘의 도전 — 공통 틀은 shared/daily.js · supabase/migrations/082_daily.sql, 서버 쪽은 087_defense_daily.sql).
 * 날짜 문자열('YYYY-MM-DD', 한국 시간) 하나에서 스테이지 하나와 조건 하나를 정한다: 같은 날이면 어느 기기에서나 같다.
 * 화면 없이 돌아가는 순수 모듈이다 (tests/daily.test.ts).
 */

export const DAILY_GAME = 'defense';

/**
 * 32비트 시드 (FNV-1a) — shared/daily.js 의 dailySeed 와 같은 계산 (tests/daily.test.ts 가 두 곳을 대조한다).
 * 화면은 공용 모듈을 받았으면 그쪽 함수를 넘기고, 못 받았을 때(테스트 모드 등)만 이것을 쓴다
 */
export function dailySeed(game: string, day: string, salt = ''): number {
  const s = `${game}:${day}:${salt}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export type SeedFn = (game: string, day: string, salt?: string) => number;

/** 기기 시계로 만든 한국 날짜 (서버에 물어보지 못할 때만. shared/daily.js 의 localDailyDay 와 같다) */
export const localDailyDay = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 조건의 종류: 출전 3종 제한 · 요괴 체력 ×1.3 · 캐릭터 하나 금지 · 시작 기운 ×0.7 */
export const DAILY_KINDS = ['squad3', 'tough', 'ban', 'lean'] as const;
export type DailyKind = (typeof DAILY_KINDS)[number];

export const DAILY_SQUAD_MAX = 3;
export const DAILY_HP_MUL = 1.3;
export const DAILY_ENERGY_MUL = 0.7;

export interface DailyChallenge {
  /** 'YYYY-MM-DD' (한국 시간) */
  day: string;
  /** 오늘의 스테이지 id */
  stage: string;
  kind: DailyKind;
  /** 데려갈 수 있는 캐릭터 수 */
  squadMax: number;
  /** 오늘 데려갈 수 없는 캐릭터 (없으면 null) */
  ban: CharId | null;
  /** 요괴 체력 · 시작 기운 배율 (조건이 아니면 1) */
  hpMul: number;
  energyMul: number;
  /** 판의 시드: 모두가 같은 판을 한다 */
  seed: number;
  /** 조건 이름 · 한 줄 설명 */
  title: string;
  desc: string;
}

/** 금지 조건에 걸릴 수 있는 캐릭터: 스테이지로 여는 십이지 12종 (시아코인으로 여는 고양이는 뺀다) */
export const BAN_POOL: CharId[] = ROSTER.filter((r) => !EXTRAS.includes(r.id)).map((r) => r.id);

/**
 * 시드에서 0 ~ n-1 하나. FNV-1a 는 끝 글자만 다른 문자열끼리 아래 비트가 닮아서(조건 종류와 금지 캐릭터가 같이 움직인다),
 * 비트를 한 번 섞은 뒤에 나눈다
 */
export function pickIndex(seed: number, n: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) % n;
}

/** 그날의 스테이지와 조건. day 가 같으면 언제나 같은 답 */
export function dailyChallenge(day: string, seed: SeedFn = dailySeed): DailyChallenge {
  const stage = STAGES[pickIndex(seed(DAILY_GAME, day, 'stage'), STAGES.length)].id;
  const kind = DAILY_KINDS[pickIndex(seed(DAILY_GAME, day, 'rule'), DAILY_KINDS.length)];
  const base = { day, stage, kind, squadMax: SQUAD_SIZE, ban: null as CharId | null, hpMul: 1, energyMul: 1, seed: seed(DAILY_GAME, day, 'run') };
  if (kind === 'squad3') return { ...base, squadMax: DAILY_SQUAD_MAX, title: '소수 정예', desc: `출전 캐릭터를 ${DAILY_SQUAD_MAX}종까지만 데려갈 수 있어요` };
  if (kind === 'tough') return { ...base, hpMul: DAILY_HP_MUL, title: '억센 요괴', desc: `요괴의 체력이 ${DAILY_HP_MUL}배예요` };
  if (kind === 'lean') return { ...base, energyMul: DAILY_ENERGY_MUL, title: '빈 주머니', desc: `시작 기운이 ${Math.round(DAILY_ENERGY_MUL * 100)}%뿐이에요` };
  const ban = BAN_POOL[pickIndex(seed(DAILY_GAME, day, 'ban'), BAN_POOL.length)];
  const nick = ROSTER.find((r) => r.id === ban)?.nick ?? ban;
  return { ...base, ban, title: `${nick} 쉬는 날`, desc: `오늘은 ${nick} 없이 막아야 해요` };
}

/** 오늘의 조건에 맞게 출전 명단을 고친다: 금지 캐릭터를 빼고, 정원까지만 */
export const dailySquad = (ch: DailyChallenge, squad: readonly CharId[]): CharId[] => squad.filter((c) => c !== ch.ban).slice(0, ch.squadMax);

/** 판 설정에 넣을 배율 (조건이 계산을 바꾸지 않으면 undefined: 보통 판과 똑같이 돈다) */
export function dailyMods(ch: DailyChallenge): GameConfig['mods'] {
  if (ch.hpMul === 1 && ch.energyMul === 1) return undefined;
  return { ...(ch.hpMul !== 1 ? { hp: ch.hpMul } : {}), ...(ch.energyMul !== 1 ? { energy: ch.energyMul } : {}) };
}

/** 처치 수는 이 값까지만 점수에 든다 (생명 한 칸 = 1000 을 넘지 않게) */
export const DAILY_KILLS_CAP = 999;
/**
 * 점수 (클수록 좋음. 서버 087 defense_finish 와 같은 식): 클리어 1000000 + 남은 생명 × 1000 + 처치 수(999 까지).
 * 남은 생명은 클리어한 판에서만 센다 (포기한 판이 생명으로 앞서지 않게)
 */
export const dailyScore = (cleared: boolean, lives: number, kills: number): number =>
  (cleared ? 1_000_000 + Math.max(0, lives) * 1000 : 0) + Math.min(DAILY_KILLS_CAP, Math.max(0, kills));

/** 순위표의 한 줄 글: detail = { cleared, lives, kills } (모양이 틀리면 점수만) */
export function dailyDetailText(detail: unknown, score: number): string {
  const d = detail as { cleared?: unknown; lives?: unknown; kills?: unknown } | null;
  if (!d || typeof d !== 'object' || typeof d.kills !== 'number') return `${score.toLocaleString()}점`;
  return d.cleared === true ? `클리어 · ❤️ ${Number(d.lives) || 0} · 💀 ${d.kills}` : `실패 · 💀 ${d.kills}`;
}
