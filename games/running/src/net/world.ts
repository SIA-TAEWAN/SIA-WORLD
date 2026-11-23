/**
 * SIA WORLD 공통 모듈(shared/*.js) 연결.
 * 공통 모듈은 빌드에 넣지 않고 실행 중에 ../../shared/ 에서 불러온다.
 * 그래야 로비와 시아레이스가 같은 Supabase 클라이언트·로그인 세션을 쓴다.
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

/** SIA WORLD 최상위 (games/running/ 에서 두 단계 위) */
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
  openRanking(opts: { meId?: string | null; first?: 'tank' | 'target' | 'casino' | 'matgo' | 'race' }): () => void;
}
let rankMod: Promise<RankingDialogModule> | null = null;

/** SIA WORLD 로비와 같은 랭킹 창 (shared/ranking-dialog.js). 못 불러오면 false */
export async function openWorldRanking(meId: string, first: 'tank' | 'target' | 'race' = 'race'): Promise<boolean> {
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

interface RankIconModule {
  tierSvg(tier: string, size?: number): string;
  TIER_NAME: Record<string, string>;
}
let rankIconMod: Promise<RankIconModule> | null = null;
/** 등급 아이콘(해·달·별·구름) — shared/rank.js */
export function loadRankIcons(): Promise<RankIconModule> {
  rankIconMod ??= import(/* @vite-ignore */ new URL('shared/rank.js', root()).href) as Promise<RankIconModule>;
  rankIconMod.catch(() => (rankIconMod = null));
  return rankIconMod;
}

interface CharactersModule {
  loadOwnedCharacters(force?: boolean): Promise<string[]>;
}
let charMod: Promise<CharactersModule> | null = null;

/** 내가 시아코인으로 연 추가 캐릭터 id (shared/characters.js). 못 불러오거나 로그인 전이면 [] (잠긴 것으로 본다) */
export async function loadOwnedCharacters(force = false): Promise<string[]> {
  try {
    charMod ??= import(/* @vite-ignore */ new URL('shared/characters.js', root()).href) as Promise<CharactersModule>;
    const list = await (await charMod).loadOwnedCharacters(force);
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    charMod = null;
    return [];
  }
}
