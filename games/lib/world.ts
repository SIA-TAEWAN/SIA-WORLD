/**
 * SIA WORLD 공통 모듈(shared/*.js) 연결. 빌드에 넣지 않고 실행 중에 불러온다
 * → 로비·시아탱크와 같은 Supabase 클라이언트와 로그인 세션을 쓴다.
 */

export interface WorldUser {
  userId: string;
  loginId: string;
  nickname: string;
  isAdmin?: boolean;
}

export type GameId = 'matgo' | 'poker' | 'blackjack' | 'holdem' | 'roulette';
export type Currency = 'chips' | 'nyang';

export interface SeatRow {
  seat_no: number;
  user_id: string | null;
  nickname: string;
  avatar: string;
  ready: boolean;
  left_game: boolean;
  pending_user_id: string | null;
  pending_nickname?: string | null;
  pending_avatar?: string | null;
}

export interface RoomRow {
  id: string;
  game: GameId;
  name: string;
  has_password: boolean;
  base_unit: number;
  host_id: string | null;
  status: 'waiting' | 'playing';
  round_no: number;
  created_at: string;
  seats?: SeatRow[];
}

export interface StateRow {
  round_no: number;
  public_state: Record<string, unknown> | null;
  pending_seats: number[];
  turn_deadline: string | null;
  updated_at: string;
}

export interface PrivateRow {
  seat_no: number;
  round_no: number;
  hand: unknown;
}

export interface Wallet {
  chips: number;
  nyang: number;
  chipsRefillsLeft: number;
  nyangRefillsLeft: number;
}

export interface AuthModule {
  requireLogin(): Promise<WorldUser>;
  onSignedOut(cb: () => void): () => void;
  loginUrl(redirect?: string): string;
}

export interface RoomModule {
  SEATS: Record<GameId, number>;
  GAME_NAME: Record<GameId, string>;
  CURRENCY: Record<GameId, Currency>;
  TOUCH_MS: number;
  friendly(e: unknown): string;
  listRooms(game: GameId): Promise<RoomRow[]>;
  watchRooms(game: GameId, cb: () => void): () => void;
  createRoom(o: { game: GameId; name: string; password: string; baseUnit: number; avatar: string }): Promise<string>;
  joinRoom(roomId: string, password: string, avatar: string): Promise<{ seat: number; pending: boolean; avatar: string }>;
  leaveRoom(roomId: string): Promise<void>;
  setAvatar(roomId: string, avatar: string): Promise<void>;
  touchRoom(roomId: string): Promise<void>;
  setReady(roomId: string, ready: boolean): Promise<boolean>;
  startRound(roomId: string): Promise<unknown>;
  act(roomId: string, payload: unknown): Promise<unknown>;
  getRoom(roomId: string): Promise<RoomRow | null>;
  getSeats(roomId: string): Promise<SeatRow[]>;
  getState(roomId: string): Promise<StateRow | null>;
  getPrivate(roomId: string): Promise<PrivateRow | null>;
  watchRoom(
    roomId: string,
    h: {
      onRoom?: (r: RoomRow | null) => void;
      onSeats?: () => void;
      onState?: (s: StateRow) => void;
      onPrivate?: (p: PrivateRow) => void;
      onResync?: () => void;
    },
  ): () => void;
}

export interface WalletModule {
  ensureWallet(): Promise<Wallet>;
  refill(currency: Currency, baseUnit: number): Promise<Wallet & { ok: boolean; reason?: string }>;
  canRefill(w: Wallet | null, currency: Currency, baseUnit: number): boolean;
  minEntry(baseUnit: number): number;
  formatAmount(n: number): string;
  getRanking(game: 'casino' | 'matgo'): Promise<{ key: string; nickname: string; amount: number }[]>;
  BASE_UNITS: number[];
  START_AMOUNT: number;
}

export interface ZodiacModule {
  ZODIAC: { id: string; name: string; nick: string; emoji: string }[];
  ZODIAC_IDS: string[];
  avatarUrl(id: string): string;
  fullUrl(id: string): string;
  lastAvatar(userId: string): string;
  saveAvatar(userId: string, id: string): void;
  pickFree(wanted: string, taken: string[]): string | null;
}

export interface RankModule {
  withTiers<T extends { amount: number }>(rows: T[], base?: number): (T & { place: number; tier: string })[];
  tierSvg(tier: string, size?: number): string;
}

/** shared/theme.js (DESIGN.md의 값) */
export interface ThemeModule {
  COLOR: Record<
    | 'skyTop' | 'skyMid' | 'skyBottom' | 'skyDeep' | 'panel' | 'panelStrong' | 'outline' | 'ink' | 'inkSoft' | 'lineSoft' | 'emptyLine'
    | 'primary' | 'primaryLight' | 'primaryDeep' | 'accent' | 'pink' | 'track' | 'white' | 'teamA' | 'teamB' | 'win' | 'lose' | 'draw' | 'cardRed',
    number
  >;
  TABLE: Record<'matgo' | 'poker' | 'holdem' | 'blackjack', number>;
  ROULETTE: Record<'spring' | 'summer' | 'autumn' | 'winter', number>;
  HWATU: Record<'hong' | 'cheong' | 'cho' | 'plain', number>;
  MATGO: Record<'matLight' | 'matDark', number>;
  CHIPS: { min: number; color: number; animal: string }[];
  css(n: number): string;
  FONT: string;
  SIZE: Record<'title' | 'logo' | 'panel' | 'button' | 'buttonBig' | 'body' | 'small', number>;
  SHAPE: Record<
    'radiusPanelBig' | 'radiusPanel' | 'radiusButton' | 'radiusItem' | 'radiusKey' | 'radiusCard' | 'radiusHwatu' | 'lineBig' | 'line' | 'lineThin' | 'depthBig' | 'depthPanel' | 'depthButton' | 'press',
    number
  >;
  MOTION: Record<'press' | 'deal' | 'flip' | 'cutin', number>;
}

/** shared/theme.css를 문서에 붙인다 (한 번만) */
export function linkThemeCss() {
  if (document.getElementById('sia-theme')) return;
  const l = document.createElement('link');
  l.id = 'sia-theme';
  l.rel = 'stylesheet';
  l.href = new URL('shared/theme.css', worldRoot()).href;
  document.head.prepend(l);
}

/** SIA WORLD 최상위 주소 (…/games/… 앞부분) */
export function worldRoot(): URL {
  const p = location.pathname;
  const i = p.lastIndexOf('/games/');
  return new URL(i >= 0 ? p.slice(0, i + 1) : '/', location.origin);
}

export const worldHome = () => new URL('index.html', worldRoot()).href;

const cache = new Map<string, Promise<unknown>>();
function load<T>(name: string): Promise<T> {
  let p = cache.get(name);
  if (!p) {
    p = import(/* @vite-ignore */ new URL(`shared/${name}.js`, worldRoot()).href);
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p as Promise<T>;
}

export const world = {
  auth: () => load<AuthModule>('auth'),
  room: () => load<RoomModule>('room'),
  wallet: () => load<WalletModule>('wallet'),
  zodiac: () => load<ZodiacModule>('zodiac'),
  rank: () => load<RankModule>('rank'),
  theme: () => load<ThemeModule>('theme'),
};
