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
  /** 서버에서 온 것이 아니라 기기에서 진행해 만든 상태 (혼자 하는 맞고). updated_at 은 서버 시각이 아니라 순번이다 */
  local?: boolean;
  /** (local) 내가 방금 기기에서 둔 행동의 상태: 누른 패가 내려앉을 시간만 두고 바로 보여 준다 (손패가 자리를 고치는 것까지 기다리지 않는다) */
  eager?: boolean;
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
  setReady(roomId: string, ready: boolean, onStart?: (res: unknown) => void): Promise<boolean>;
  startRound(roomId: string): Promise<unknown>;
  /** n: 기기에서 먼저 진행하는 화면이 보내는 진행 수 (서버 상태와 다르면 409 'out of sync'). 없으면 지금 상태에 적용 */
  act(roomId: string, payload: unknown, n?: number): Promise<unknown>;
  /** 기기에서 진행하는 판의 전체 상태 (이어서 두려고). duo = 사람이 둘인 판. 실패하면 code(서버 문구)·status 가 실린 오류 */
  soloSync(roomId: string): Promise<{ state: unknown; version: number; round: number; duo?: boolean }>;
  /**
   * 방 채널 (같은 방 화면끼리 바로 주고받는 알림. 서버를 거치지 않으므로 받은 내용은 믿으면 안 된다)
   * → send(msg): 다른 화면들에 보낸다 (맞고 2인전의 행동), emote(msg): 한마디 (카드 5종 공통), close(): 닫는다
   * (emote 는 예전 shared/room.js 에는 없다 → 없으면 한마디만 쉰다)
   */
  roomCast?(roomId: string, onMessage: (msg: unknown) => void, onEmote?: (msg: unknown) => void): { send(msg: unknown): void; emote?(msg: unknown): void; close(): void };
  /** 기기에서 둔 사람 행동 목록 보내기 (n: 목록이 시작되는 서버 진행 수) */
  soloReplay(roomId: string, payload: { n: number; actions: unknown[] }): Promise<{ ok: boolean; n: number | null; done: boolean }>;
  /** 페이지를 떠나는 중에 보내기 (응답을 기다리지 않는다) → 보냈으면 true */
  soloReplayOnExit(roomId: string, payload: { n: number; actions: unknown[] }): boolean;
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

/** shared/presence.js (게임마다 지금 몇 명 · 정원 30명) */
export interface PresenceHandle {
  full: boolean;
  count(): number;
  onChange(fn: () => void): () => void;
  leave(): Promise<void>;
}
export interface PresenceModule {
  GAME_MAX: number;
  cardChannel(game: GameId): string;
  enterGame(topic: string, user: WorldUser): Promise<PresenceHandle>;
}

export const world = {
  presence: () => load<PresenceModule>('presence'),
  auth: () => load<AuthModule>('auth'),
  room: () => load<RoomModule>('room'),
  wallet: () => load<WalletModule>('wallet'),
  zodiac: () => load<ZodiacModule>('zodiac'),
  rank: () => load<RankModule>('rank'),
  theme: () => load<ThemeModule>('theme'),
};
