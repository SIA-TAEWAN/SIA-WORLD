import type { ItemId, TankChoice } from '../game/data';
import type { MapId } from '../data/maps';
import type { GameMode, WindMode } from '../game/match';

export interface RoomPlayer {
  id: string;
  name: string;
  /** 'random'이면 게임 시작 때 정해진다 */
  tank: TankChoice;
  team: 0 | 1;
  items: ItemId[];
  /** 방장이 아닌 사람의 준비 완료 */
  ready?: boolean;
}

export interface Room {
  id: string;
  lobby: string;
  name: string;
  map: MapId | 'random';
  status: 'waiting' | 'playing';
  players: RoomPlayer[];
  seed: number | null;
  /** 방장 (맵·시작 권한, 게임 중엔 기준 기기) */
  host_id: string | null;
  game_no: number;
  created_at: string;
  /** 게임 중에 [나가기]로 나간 사람 */
  gone?: string[];
  /** 게임 속도 (1 또는 1.5) */
  speed?: number;
  /** 바람이 바뀌는 빠르기 */
  wind?: WindMode;
  /** 게임 모드 (없으면 일반) */
  mode?: GameMode;
  /** 마지막으로 방에 사람이 있다는 신호가 온 때 */
  updated_at?: string | number;
}

export interface Member<M> {
  key: string;
  meta: M;
}

/** 실시간 채널 하나 (Presence + Broadcast) */
export interface Channel<M> {
  onPresence(cb: (members: Member<M>[]) => void): void;
  onMessage(cb: (msg: NetMsg) => void): void;
  /** 구독하고 내 정보를 올린다 */
  join(meta: M): Promise<void>;
  track(meta: M): Promise<void>;
  send(msg: NetMsg): void;
  leave(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NetMsg = { t: string; [k: string]: any };

export interface Backend {
  kind: 'supabase' | 'local';
  channel<M>(name: string, key: string): Channel<M>;
  listRooms(lobby: string): Promise<Room[]>;
  /** 게임방 테이블이 바뀌면 cb를 부른다. 해제 함수를 돌려준다 */
  watchRooms(lobby: string, cb: () => void): () => void;
  createRoom(lobby: string, name: string, player: RoomPlayer): Promise<Room>;
  joinRoom(id: string, player: RoomPlayer): Promise<Room>;
  leaveRoom(id: string, playerId: string): Promise<void>;
  /** 방장이 다른 사람을 내보낸다 (대기 중일 때만) */
  kickPlayer(id: string, host: string, target: string): Promise<void>;
  updatePlayer(id: string, player: RoomPlayer): Promise<void>;
  setMap(id: string, playerId: string, map: MapId | 'random'): Promise<void>;
  /** 게임 속도·바람 빠르기 (방장만) */
  setOptions(id: string, playerId: string, speed: number, wind: WindMode): Promise<void>;
  /** 게임 모드 (방장만) */
  setMode(id: string, playerId: string, mode: GameMode): Promise<void>;
  startGame(id: string, host: string, seed: number): Promise<Room>;
  /** 판 정산 (winner: 이긴 팀, 무승부·모름은 null) */
  endGame(id: string, gameNo: number, present: string[], winner?: number | null): Promise<void>;
  /** ID별 포인트 (없으면 1000) */
  getPoints(name: string): Promise<number>;
  /** 포인트 랭킹 (포인트 높은 순) */
  getRanking(): Promise<{ name: string; points: number; wins: number; losses: number }[]>;
  /** 게임 중 나가기 (모두 나가면 방이 사라진다) */
  quitGame(id: string, playerId: string): Promise<void>;
  /** 방에 아직 사람이 있다는 신호 */
  touchRoom(id: string, playerId: string): Promise<void>;
  /** 2분 넘게 신호가 없는 방 정리 */
  sweepRooms(lobby: string): Promise<void>;
  /** 회원가입 → 로그인 토큰 */
  signUp(name: string, pw: string): Promise<string>;
  /** 로그인 → 토큰 */
  signIn(name: string, pw: string): Promise<string>;
  /** 저장해 둔 토큰이 아직 유효한지 */
  checkSession(name: string, token: string): Promise<boolean>;
  /** 이후 게임방 요청에 쓸 로그인 토큰 */
  setToken(token: string | null): void;
}

export class NetError extends Error {}

/** 서버 오류 메시지를 사람이 읽을 말로 */
export function friendly(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (m.includes('id taken')) return '이미 있는 ID예요. 다른 ID를 써 주세요';
  if (m.includes('wrong login')) return 'ID 또는 비밀번호가 맞지 않아요';
  if (m.includes('bad password')) return '비밀번호는 4~40자로 정해주세요';
  if (m.includes('need login')) return '로그인이 풀렸어요. 다시 로그인해 주세요';
  if (m.includes('room is full')) return '게임방이 가득 찼어요 (최대 4명)';
  if (m.includes('room is playing') || m.includes('already playing')) return '이미 게임이 진행 중인 방이에요';
  if (m.includes('room not found')) return '게임방이 사라졌어요';
  if (m.includes('need 2')) return '2명 이상이어야 시작할 수 있어요';
  if (m.includes('teams')) return '한 팀에 모두 몰려 있으면 시작할 수 없어요';
  if (m.includes('not host')) return '방장만 할 수 있어요';
  if (m.includes('not ready')) return '아직 레디하지 않은 사람이 있어요';
  if (m.includes('too many rooms')) return '게임방이 너무 많아요. 잠시 후 다시 시도해주세요';
  return '서버와 통신하지 못했어요. 잠시 후 다시 시도해주세요';
}

/** 방장: host_id가 방에 있으면 그 사람, 아니면 첫 번째 사람 */
export function hostOf(r: Room): string | undefined {
  return r.host_id && r.players.some((p) => p.id === r.host_id) ? r.host_id : r.players[0]?.id;
}

/** 방장 말고 모두 레디했는가 */
export function allReady(r: Room): boolean {
  const h = hostOf(r);
  return r.players.every((p) => p.id === h || p.ready);
}
