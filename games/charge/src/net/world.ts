/**
 * SIA WORLD 공통 모듈(shared/*.js) 연결 (시아서바이벌 games/survival/src/net/world.ts 와 같은 방식).
 * 공통 모듈은 빌드에 넣지 않고 실행 중에 ../../shared/ 에서 불러온다.
 * 그래야 로비와 시아돌격대가 같은 Supabase 클라이언트·로그인 세션을 쓴다.
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

/** SIA WORLD 최상위 (games/charge/ 에서 두 단계 위) */
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

/** 고양이 같은 추가 캐릭터는 게임마다 따로 연다: 이 게임의 id (shared/games.js) */
const GAME_ID = 'charge';
export interface BuyResult {
  ok: boolean;
  reason?: string;
  siaCoins?: number;
  price?: number;
}
interface CharactersModule {
  loadOwnedCharacters(game: string, force?: boolean): Promise<string[] | null>;
  buyCharacter(game: string, id: string): Promise<BuyResult>;
  buyMessage(r: BuyResult, id?: string): string;
}
let charMod: Promise<CharactersModule> | null = null;
function characters(): Promise<CharactersModule> {
  charMod ??= import(/* @vite-ignore */ new URL('shared/characters.js', root()).href) as Promise<CharactersModule>;
  charMod.catch(() => (charMod = null));
  return charMod;
}
/** 이 게임에서 시아코인으로 연 추가 캐릭터 (shared/characters.js). 못 읽으면 null ([] = 연 것 없음과 구분) */
export async function loadOwnedCharacters(force = false): Promise<string[] | null> {
  try {
    return await (await characters()).loadOwnedCharacters(GAME_ID, force);
  } catch {
    return null;
  }
}
/** 이 게임에서 캐릭터 열기 → 결과와 화면에 띄울 한 줄 */
export async function buyCharacter(id: string): Promise<{ r: BuyResult; text: string }> {
  try {
    const m = await characters();
    const r = await m.buyCharacter(GAME_ID, id);
    return { r, text: m.buyMessage(r, id) };
  } catch {
    return { r: { ok: false, reason: 'error' }, text: '열지 못했어요. 잠시 후 다시 시도해 주세요' };
  }
}

interface RankingDialogModule {
  openRanking(opts: { meId?: string | null; first?: string }): () => void;
}
let rankMod: Promise<RankingDialogModule> | null = null;
/** SIA WORLD 로비와 같은 랭킹 창 (shared/ranking-dialog.js) 을 시아돌격대 탭으로 연다. 못 불러오면 false */
export async function openWorldRanking(meId: string): Promise<boolean> {
  try {
    rankMod ??= import(/* @vite-ignore */ new URL('shared/ranking-dialog.js', root()).href) as Promise<RankingDialogModule>;
    (await rankMod).openRanking({ meId, first: 'charge' });
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

export interface PresenceHandle {
  full: boolean;
  leave(): Promise<void>;
}
interface PresenceModule {
  enterGame(topic: string, user: WorldUser): Promise<PresenceHandle>;
  GAME_MAX: number;
}
/** SIA WORLD 접속 인원 채널에 들어간다 (shared/presence.js: 로비에 인원이 보이고, 정원 30명을 넘으면 full). 못 하면 null */
export async function enterLobby(user: WorldUser): Promise<PresenceHandle | null> {
  try {
    const m = (await import(/* @vite-ignore */ new URL('shared/presence.js', root()).href)) as PresenceModule;
    return await m.enterGame('charge-lobby', user);
  } catch {
    return null;
  }
}
