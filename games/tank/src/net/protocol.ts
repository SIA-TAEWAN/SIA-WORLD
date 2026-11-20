import type { Match, MatchSnapshot } from '../game/match';
import type { TurnInput } from '../game/types';

/** 기준 기기가 턴 시간을 이만큼(초) 더 넘겨도 턴을 넘기지 않으면 다음 후보 기기가 대신 넘긴다 */
export const BACKUP_OVERDUE = 10;

/** 한 턴의 결과로 주고받는 것: 이동 기록 + 발사 입력(시간 초과면 null) */
export interface TurnRecord {
  turn: number;
  /** 이동 기록. 부호 = 방향, 크기 = 걸음 수 */
  runs: number[];
  input: TurnInput | null;
  facing: 1 | -1;
  /** 이번 턴에 바로 쓴 아이템 칸 (수리킷) */
  used?: number[];
  /** 보낸 기기 (AI 탱크의 턴은 기준 기기가 보낸 것만 받는다) */
  from?: string;
}

/** 조종 중인 기기가 0.12초마다 보내는 진행 상황 (화면 표시용) */
export interface LiveState {
  turn: number;
  runs: number[];
  angle: number;
  facing: 1 | -1;
  power: number;
  charging: boolean;
  weapon: 0 | 1 | 2;
  itemSlot: number | null;
  /** 이번 턴에 바로 쓴 아이템 칸 (수리킷) */
  used?: number[];
}

/** 네트워크가 게임 화면에 요청하는 것 */
export interface SceneApi {
  onRemoteLive(l: LiveState): void;
  onRemoteTurn(r: TurnRecord): void;
  loadSnapshot(snap: MatchSnapshot, records: TurnRecord[], elapsed: number): void;
  setConn(idx: number, text: string | null): void;
  takeover(idx: number): void;
  readonly matchState: Match;
}

/** 게임 화면이 네트워크에 요청하는 것 */
export interface NetHooks {
  myIdx: number;
  isHost(): boolean;
  /** 기준 기기가 멈췄을 때 대신 턴을 넘길 기기인가 */
  isBackup(): boolean;
  /** 판 상태를 다시 받는 중이라 화면을 진행하지 않는다 */
  frozen(): boolean;
  /** 기준 기기만 보내는 것(AI 탱크의 턴)을 이 기기가 보냈다고 믿을 수 있는가 */
  trusted(from?: string): boolean;
  sendLive(l: LiveState): void;
  sendTurn(r: TurnRecord): void;
  /** 턴을 계산한 직후의 상태 지문 */
  turnDone(turn: number, hash: string): void;
  turnStarted(m: Match): void;
  attach(scene: SceneApi): void;
}
