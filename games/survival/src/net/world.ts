/**
 * SIA WORLD 공통 모듈(shared/*.js) 연결.
 * 공통 모듈은 빌드에 넣지 않고 실행 중에 ../../shared/ 에서 불러온다.
 * 그래야 로비와 시아서바이벌가 같은 Supabase 클라이언트·로그인 세션을 쓴다.
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

/** SIA WORLD 최상위 (games/survival/ 에서 두 단계 위) */
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

/** getSurvivalRanking 이 주는 랭킹 한 줄 */
export interface WorldSurvivalRow {
  key: string;
  nickname: string;
  time: number;
  kills: number;
  cleared: boolean;
  place: number;
}
interface RankingDialogModule {
  openRanking(opts: { meId?: string | null; first?: 'tank' | 'target' | 'casino' | 'matgo' | 'race' | 'volley' | 'survival' }): () => void;
  getSurvivalRanking(mapId: string, meId?: string | null, mode?: string): Promise<{ rows: WorldSurvivalRow[]; mine: WorldSurvivalRow | null; total: number }>;
}
let rankMod: Promise<RankingDialogModule> | null = null;
/** 못 불러왔으면 비워서 다음에 다시 불러온다 */
function loadRanking(): Promise<RankingDialogModule> {
  rankMod ??= import(/* @vite-ignore */ new URL('shared/ranking-dialog.js', root()).href) as Promise<RankingDialogModule>;
  rankMod.catch(() => (rankMod = null));
  return rankMod;
}

/** SIA WORLD 로비와 같은 랭킹 창 (shared/ranking-dialog.js). 못 불러오면 false */
export async function openWorldRanking(meId: string, first: 'tank' | 'target' | 'race' | 'volley' | 'survival' = 'survival'): Promise<boolean> {
  try {
    (await loadRanking()).openRanking({ meId, first });
    return true;
  } catch {
    return false;
  }
}

/** 맵·모드별 생존 시간 랭킹 (상위 100명 + 내 줄). 못 불러오면 null */
export async function worldSurvivalRanking(mapId: string, meId: string, mode = 'normal'): Promise<{ rows: WorldSurvivalRow[]; mine: WorldSurvivalRow | null } | null> {
  try {
    return await (await loadRanking()).getSurvivalRanking(mapId, meId, mode);
  } catch {
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
  /** ⚙️ 소리 설정 창 (🎵 배경음 · 🔊 효과음 따로, 시아레이스와 같은 모양). onClose: 닫을 때 */
  openSoundSettings(onClose?: () => void): HTMLElement;
  onBgmChange(cb: (on: boolean) => void): () => void;
  /** 배경음 파일 틀기: shared/audio/bgm/<게임>/<장면>.mp3 (scene: main · boss · win · lose) */
  playBgm(game: string, scene?: string): void;
  stopBgm(): void;
}
let soundMod: Promise<SoundModule> | null = null;
/** SIA WORLD 공용 효과음 (shared/sound.js) */
export function loadSound(): Promise<SoundModule> {
  soundMod ??= import(/* @vite-ignore */ new URL('shared/sound.js', root()).href) as Promise<SoundModule>;
  soundMod.catch(() => (soundMod = null));
  return soundMod;
}

/** 오늘의 도전 공통 모듈 (shared/daily.js) */
export interface DailyModule {
  /** 서버 기준 오늘. 5초 안에 못 받거나 실패하면 null */
  dailyTodayStrict(): Promise<string | null>;
  /** 서버 기준 오늘. 실패하면 기기 시계 (기록이 서버로 가는 판에는 쓰지 않는다) */
  dailyToday(): Promise<string>;
  dailySeed(game: string, day: string, salt?: string): number;
  loadDailyRanking(game: string, day?: string | null): Promise<unknown>;
}
let dailyMod: Promise<DailyModule> | null = null;
export function loadDaily(): Promise<DailyModule> {
  dailyMod ??= import(/* @vite-ignore */ new URL('shared/daily.js', root()).href) as Promise<DailyModule>;
  dailyMod.catch(() => (dailyMod = null));
  return dailyMod;
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
