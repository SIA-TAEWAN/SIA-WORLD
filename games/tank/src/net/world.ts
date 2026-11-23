/**
 * SIA WORLD 공통 모듈(shared/*.js) 연결.
 * 공통 모듈은 빌드에 넣지 않고 실행 중에 ../../shared/ 에서 불러온다.
 * 그래야 로비와 시아탱크가 같은 Supabase 클라이언트·로그인 세션을 쓴다.
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

interface SupabaseModule {
  supabase: SupabaseClient;
}

/** SIA WORLD 최상위 (games/tank/ 에서 두 단계 위) */
const root = () => new URL('../../', document.baseURI);

/** SIA WORLD 로비 주소 */
export const worldHome = () => new URL('index.html', root()).href;

let authMod: Promise<AuthModule> | null = null;
let supaMod: Promise<SupabaseModule> | null = null;

export function loadAuth(): Promise<AuthModule> {
  authMod ??= import(/* @vite-ignore */ new URL('shared/auth.js', root()).href) as Promise<AuthModule>;
  authMod.catch(() => (authMod = null));
  return authMod;
}

export async function worldSupabase(): Promise<SupabaseClient> {
  supaMod ??= import(/* @vite-ignore */ new URL('shared/supabase.js', root()).href) as Promise<SupabaseModule>;
  supaMod.catch(() => (supaMod = null));
  return (await supaMod).supabase;
}

interface RankingDialogModule {
  openRanking(opts: { meId?: string | null; first?: 'tank' | 'target' | 'casino' | 'matgo' }): () => void;
}
let rankMod: Promise<RankingDialogModule> | null = null;

/** SIA WORLD 로비와 같은 랭킹 창 (shared/ranking-dialog.js). 못 불러오면 false */
export async function openWorldRanking(meId: string, first: 'tank' | 'target' = 'tank'): Promise<boolean> {
  try {
    rankMod ??= import(/* @vite-ignore */ new URL('shared/ranking-dialog.js', root()).href) as Promise<RankingDialogModule>;
    (await rankMod).openRanking({ meId, first });
    return true;
  } catch {
    rankMod = null;
    return false;
  }
}

export interface SoundModule {
  play(name: string, opts?: { delay?: number; volume?: number; rate?: number }): void;
  isMuted(): boolean;
  setMuted(m: boolean): void;
  onMuteChange(cb: (m: boolean) => void): () => void;
}
let soundMod: Promise<SoundModule> | null = null;
/** SIA WORLD 공용 효과음 (shared/sound.js) */
export function loadSound(): Promise<SoundModule> {
  soundMod ??= import(/* @vite-ignore */ new URL('shared/sound.js', root()).href) as Promise<SoundModule>;
  soundMod.catch(() => (soundMod = null));
  return soundMod;
}


interface BuyResult {
  ok: boolean;
  reason?: string;
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
const loadCharMod = () => {
  charMod ??= import(/* @vite-ignore */ new URL('shared/characters.js', root()).href) as Promise<CharactersModule>;
  charMod.catch(() => (charMod = null));
  return charMod;
};

/** 이 게임에서 내가 시아코인으로 연 추가 캐릭터 id (shared/characters.js). 서버를 못 읽으면 null ([] = 연 것 없음) */
export async function loadOwnedCharacters(game: string, force = false): Promise<string[] | null> {
  try {
    const list = await (await loadCharMod()).loadOwnedCharacters(game, force);
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

/** 이 게임의 고양이 구매 조건 진행 {have, need, owned} (shared/characters.js). 못 읽으면 null */
export async function loadCharacterProgress(game: string): Promise<{ have: number; need: number; owned: string[] } | null> {
  try {
    return (await (await loadCharMod()).loadCharacterProgress(game)) ?? null;
  } catch {
    return null;
  }
}

/** 이 게임에서 캐릭터 열기 (shared/characters.js 의 buyCharacter). 예외를 던지지 않는다 */
export async function buyCharacter(game: string, id: string): Promise<BuyResult> {
  try {
    return (await (await loadCharMod()).buyCharacter(game, id)) ?? { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** 구매 결과 → 화면 한 줄 (shared/characters.js 의 buyMessage. 못 불러오면 짧은 기본 글) */
export async function buyMessage(r: BuyResult, id = 'cat'): Promise<string> {
  try {
    return (await loadCharMod()).buyMessage(r, id);
  } catch {
    return r.ok ? '열었어요!' : '열지 못했어요. 잠시 후 다시 시도해 주세요';
  }
}
