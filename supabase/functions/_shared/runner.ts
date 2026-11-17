/**
 * 판 진행기: 시작 · 행동 · 시간 초과 · AI 이어서 두기 · 정산.
 * Edge Function(game-action, game-timeout)이 쓰고, 단위 테스트는 메모리 Store로 돌린다.
 * DB 접근은 Store 인터페이스로만 한다.
 */
import { cryptoRng, EngineError, type Engine, type Rng, type SeatInfo } from './engine.ts';

export type GameId = 'matgo' | 'poker' | 'blackjack';

export interface RoomRow {
  id: string;
  game: GameId;
  base_unit: number;
  status: 'waiting' | 'playing';
  round_no: number;
}

export interface SeatRow {
  seat_no: number;
  user_id: string | null;
  nickname: string;
  avatar: string;
  ready: boolean;
  left_game: boolean;
}

export interface DeckRow {
  version: number;
  state: unknown;
  carry: unknown;
}

export interface Store {
  room(id: string): Promise<RoomRow | null>;
  seats(id: string): Promise<SeatRow[]>;
  /** 사람들의 지갑 잔액 (게임 화폐) */
  balances(userIds: string[], game: GameId): Promise<Record<string, number>>;
  deck(id: string): Promise<DeckRow>;
  /** 낙관적 잠금: version이 그대로일 때만 저장 → 저장했으면 true */
  saveDeck(id: string, expectVersion: number, state: unknown, carry: unknown): Promise<boolean>;
  /** 판 시작 (대기 중 + 사람 모두 레디일 때만) → 새 판 번호 또는 null */
  beginRound(id: string): Promise<number | null>;
  /** 화면용 상태 저장 (공개 + 자리별 비공개) */
  publish(
    id: string,
    round: number,
    pub: unknown,
    pendingSeats: number[],
    deadline: Date | null,
    privates: { seat: number; userId: string | null; hand: unknown }[],
  ): Promise<void>;
  /** 정산 반영 (같은 판은 한 번만) */
  applyResult(id: string, round: number, deltas: Record<number, number>): Promise<boolean>;
  /** 판 끝 정리 (나간 자리 AI로, 예약자 앉히기, 대기 상태로) */
  finishRound(id: string): Promise<boolean>;
}

/** 사람 차례 제한 시간 */
export const TURN_MS = 20_000;
/** AI가 한 번에 이어서 둘 수 있는 최대 횟수 (무한 반복 방지) */
const MAX_AUTO_STEPS = 5000;

// deno-lint-ignore no-explicit-any
export type AnyEngine = Engine<any, any, any, any, any>;

export class GameError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface Loaded {
  room: RoomRow;
  seats: SeatRow[];
  deck: DeckRow;
  engine: AnyEngine;
}

export class Runner {
  constructor(
    private store: Store,
    private engines: Record<GameId, AnyEngine>,
    private rng: Rng = cryptoRng(),
    private now: () => number = () => Date.now(),
  ) {}

  private async load(roomId: string): Promise<Loaded> {
    const room = await this.store.room(roomId);
    if (!room) throw new GameError('room not found', 404);
    const engine = this.engines[room.game];
    if (!engine) throw new GameError('bad game');
    const [seats, deck] = await Promise.all([this.store.seats(roomId), this.store.deck(roomId)]);
    return { room, seats, deck, engine };
  }

  /** 사람이 직접 두지 않는 자리 (AI, 또는 판 도중 나간 사람) */
  private auto(seats: SeatRow[], seat: number) {
    const s = seats.find((x) => x.seat_no === seat);
    return !s || s.user_id === null || s.left_game;
  }

  /** 판 시작 (사람이 모두 레디했을 때 아무 참가자나 부른다) */
  async start(roomId: string, userId: string) {
    const { room, seats, deck, engine } = await this.load(roomId);
    if (!seats.some((s) => s.user_id === userId && !s.left_game)) throw new GameError('not in room', 403);
    if (room.status !== 'waiting') return { started: false };
    const round = await this.store.beginRound(roomId);
    if (round === null) return { started: false };

    const humans = seats.filter((s) => s.user_id && !s.left_game).map((s) => s.user_id!);
    const bal = await this.store.balances(humans, room.game);
    const info: SeatInfo[] = [...seats]
      .sort((a, b) => a.seat_no - b.seat_no)
      .map((s) => ({
        seat: s.seat_no,
        kind: s.user_id && !s.left_game ? 'human' : 'ai',
        name: s.nickname,
        stack: s.user_id ? (bal[s.user_id] ?? 0) : null,
      }));
    const state = engine.newRound({ seats: info, baseUnit: room.base_unit, carry: deck.carry ?? null, rng: this.rng });
    await this.advance(roomId, { ...room, status: 'playing', round_no: round }, seats, engine, deck.version, state);
    return { started: true, round };
  }

  /** 사람의 행동 */
  async act(roomId: string, userId: string, action: unknown) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { room, seats, deck, engine } = await this.load(roomId);
      if (room.status !== 'playing' || !deck.state) throw new GameError('not playing', 409);
      const seat = seats.find((s) => s.user_id === userId && !s.left_game);
      if (!seat) throw new GameError('not in room', 403);
      if (!engine.pending(deck.state).includes(seat.seat_no)) throw new GameError('not your turn', 409);
      let state;
      try {
        state = engine.apply(deck.state, seat.seat_no, action, this.rng);
      } catch (e) {
        if (e instanceof EngineError) throw new GameError(e.message);
        throw e;
      }
      if (await this.advance(roomId, room, seats, engine, deck.version, state)) return { ok: true };
    }
    throw new GameError('busy, try again', 409);
  }

  /** 시간 초과 처리 (cron). expectVersion이 바뀌었으면(그 사이 누가 뒀으면) 건너뛴다 */
  async timeout(roomId: string, expectVersion?: number) {
    const { room, seats, deck, engine } = await this.load(roomId);
    if (room.status !== 'playing' || !deck.state) return { acted: false };
    if (expectVersion !== undefined && expectVersion !== deck.version) return { acted: false };
    let state = deck.state;
    for (const seat of engine.pending(state)) {
      if (!engine.pending(state).includes(seat)) continue;
      // 나간 사람은 AI가, 자리에 있는데 시간을 넘긴 사람은 정해진 자동 행동
      const a = this.auto(seats, seat) ? this.aiAction(engine, state, seat) : engine.timeout(state, seat, this.rng);
      state = engine.apply(state, seat, a, this.rng);
    }
    return { acted: await this.advance(roomId, room, seats, engine, deck.version, state) };
  }

  private aiAction(engine: AnyEngine, state: unknown, seat: number) {
    const v = engine.view(state);
    return engine.ai(v.public, v.private[seat], seat, this.rng);
  }

  /** AI 차례를 이어서 두고, 저장·공개하고, 판이 끝났으면 정산한다 → 저장했으면 true */
  private async advance(roomId: string, room: RoomRow, seats: SeatRow[], engine: AnyEngine, version: number, state: unknown) {
    let steps = 0;
    while (!engine.done(state)) {
      const autos = engine.pending(state).filter((s: number) => this.auto(seats, s));
      if (autos.length === 0) break;
      for (const seat of autos) {
        if (!engine.pending(state).includes(seat)) continue;
        state = engine.apply(state, seat, this.aiAction(engine, state, seat), this.rng);
        if (++steps > MAX_AUTO_STEPS) throw new Error('AI loop');
      }
    }

    const done = engine.done(state);
    const settlement = done ? engine.settle(state) : null;
    const deck = await this.store.deck(roomId);
    const carry = settlement ? settlement.carry : deck.carry;
    if (!(await this.store.saveDeck(roomId, version, state, carry))) return false;

    const view = engine.view(state);
    const pending: number[] = done ? [] : engine.pending(state);
    const humanPending = pending.some((s) => !this.auto(seats, s));
    const deadline = humanPending ? new Date(this.now() + TURN_MS) : null;
    const pub = { ...(view.public as object), round: room.round_no, result: settlement?.summary ?? null, deltas: settlement?.deltas ?? null };
    const privates = seats.map((s) => ({ seat: s.seat_no, userId: s.user_id, hand: view.private[s.seat_no] ?? null }));
    await this.store.publish(roomId, room.round_no, pub, pending, deadline, privates);

    if (settlement) {
      await this.store.applyResult(roomId, room.round_no, settlement.deltas);
      await this.store.finishRound(roomId);
    }
    return true;
  }
}
