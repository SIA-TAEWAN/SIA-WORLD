/**
 * SIA WORLD 공통 모듈(shared/*.js) 연결 (시아서바이벌 games/survival/src/net/world.ts 와 같은 방식).
 * 공통 모듈은 빌드에 넣지 않고 실행 중에 ../../shared/ 에서 불러온다.
 * 그래야 로비와 시아디펜스가 같은 Supabase 클라이언트·로그인 세션을 쓴다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface WorldUser {
  userId: string;
  loginId: string;
  nickname: string;
  /** 관리자 계정 (profiles.is_admin) */
  isAdmin?: boolean;
}

interface AuthModule {
  requireLogin(): Promise<WorldUser>;
  getCurrentUser(): Promise<WorldUser | null>;
  onSignedOut(cb: () => void): () => void;
  loginUrl(redirect?: string): string;
}

/** SIA WORLD 최상위 (games/defense/ 에서 두 단계 위) */
const root = () => new URL('../../', document.baseURI);

/** SIA WORLD 로비 주소 */
export const worldHome = () => new URL('index.html', root()).href;

let authMod: Promise<AuthModule> | null = null;

export function loadAuth(): Promise<AuthModule> {
  authMod ??= import(/* @vite-ignore */ new URL('shared/auth.js', root()).href) as Promise<AuthModule>;
  authMod.catch(() => (authMod = null));
  return authMod;
}

let supaMod: Promise<{ supabase: SupabaseClient }> | null = null;
/** SIA WORLD 공용 Supabase 클라이언트 (shared/supabase.js) */
export async function worldSupabase(): Promise<SupabaseClient> {
  supaMod ??= import(/* @vite-ignore */ new URL('shared/supabase.js', root()).href) as Promise<{ supabase: SupabaseClient }>;
  supaMod.catch(() => (supaMod = null));
  return (await supaMod).supabase;
}

interface RankingDialogModule {
  openRanking(opts: { meId?: string | null; first?: string }): () => void;
}
let rankMod: Promise<RankingDialogModule> | null = null;
/** SIA WORLD 로비와 같은 랭킹 창 (shared/ranking-dialog.js) 을 시아디펜스 탭으로 연다. 못 불러오면 false */
export async function openWorldRanking(meId: string): Promise<boolean> {
  try {
    rankMod ??= import(/* @vite-ignore */ new URL('shared/ranking-dialog.js', root()).href) as Promise<RankingDialogModule>;
    (await rankMod).openRanking({ meId, first: 'defense' });
    return true;
  } catch {
    rankMod = null;
    return false;
  }
}

/** 그날 순위 (shared/daily.js loadDailyRanking · 082 daily_ranking) */
export interface DailyRanking {
  day: string;
  today: string;
  top: { place: number; nickname: string; score: number; detail: unknown; me: boolean }[];
  mine: { place: number; score: number; detail: unknown; plays: number } | null;
  total: number;
}
export interface DailyModule {
  dailyToday(): Promise<string>;
  dailySeed(game: string, day: string, salt?: string): number;
  loadDailyRanking(game: string, day?: string | null): Promise<DailyRanking | null>;
}
let dailyMod: Promise<DailyModule> | null = null;
/** 오늘의 도전 공용 모듈 (shared/daily.js). 못 받으면 null (화면은 조용히 숨기거나 기기 계산으로 대신한다) */
export async function loadDaily(): Promise<DailyModule | null> {
  try {
    dailyMod ??= import(/* @vite-ignore */ new URL('shared/daily.js', root()).href) as Promise<DailyModule>;
    return await dailyMod;
  } catch {
    dailyMod = null;
    return null;
  }
}

export interface SoundModule {
  play(name: string, opts?: { delay?: number; volume?: number; rate?: number }): void;
  isMuted(): boolean;
  setMuted(m: boolean): void;
  onMuteChange(cb: (m: boolean) => void): () => void;
  /** 배경음 켜기/끄기 (효과음과 따로) */
  isBgmOn(): boolean;
  setBgmOn(on: boolean): void;
  onBgmChange(cb: (on: boolean) => void): () => void;
  /** shared/sounds/<이름>.ogg|.mp3 가 있으면 그 주소 */
  bgmFileUrl(name: string): Promise<string | null>;
}
let soundMod: Promise<SoundModule> | null = null;
/** SIA WORLD 공용 효과음 (shared/sound.js) */
export function loadSound(): Promise<SoundModule> {
  soundMod ??= import(/* @vite-ignore */ new URL('shared/sound.js', root()).href) as Promise<SoundModule>;
  soundMod.catch(() => (soundMod = null));
  return soundMod;
}

/** 추가 캐릭터(고양이)를 여는 게임 id (071 의 _character_games · shared/games.js). 게임마다 따로 연다 */
export const GAME_ID = 'defense';

export interface BuyResult {
  ok: boolean;
  reason?: 'owned' | 'coin' | 'condition' | 'login' | 'error';
  siaCoins?: number;
  price?: number;
  have?: number;
  need?: number;
}
interface CharactersModule {
  loadOwnedCharacters(game: string, force?: boolean): Promise<string[] | null>;
  buyCharacter(game: string, id: string): Promise<BuyResult>;
  buyMessage(r: BuyResult, id?: string): string;
  loadCharacterProgress(game: string): Promise<{ have: number; need: number; owned: string[] } | null>;
}
let charMod: Promise<CharactersModule> | null = null;
const characters = () => {
  charMod ??= import(/* @vite-ignore */ new URL('shared/characters.js', root()).href) as Promise<CharactersModule>;
  charMod.catch(() => (charMod = null));
  return charMod;
};
/**
 * 시아디펜스에서 시아코인으로 연 추가 캐릭터 id (shared/characters.js).
 * 서버를 못 읽으면 null ([] = 연 것 없음과 구분. null 이면 가진 목록을 그대로 둔다. 서버도 판 시작 때 다시 본다)
 */
export async function loadOwnedCharacters(force = false): Promise<string[] | null> {
  try {
    const list = await (await characters()).loadOwnedCharacters(GAME_ID, force);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}
/** 고양이 구매 조건 진행 (071 character_progress('defense')) → { have, need, owned } · 못 읽으면 null */
export async function loadCharacterProgress(): Promise<{ have: number; need: number; owned: string[] } | null> {
  try {
    const mod = await characters();
    return (await mod.loadCharacterProgress(GAME_ID)) ?? null;
  } catch {
    return null;
  }
}
/** 시아디펜스에서 캐릭터 열기 → 결과와 화면에 띄울 한 줄 */
export async function buyCharacter(id: string): Promise<{ r: BuyResult; msg: string }> {
  try {
    const mod = await characters();
    const r = await mod.buyCharacter(GAME_ID, id);
    return { r, msg: mod.buyMessage(r, id) };
  } catch {
    return { r: { ok: false, reason: 'error' }, msg: '열지 못했어요. 잠시 후 다시 시도해 주세요' };
  }
}
