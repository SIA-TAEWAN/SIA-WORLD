/**
 * 판 진행기: 시작 · 행동 · 시간 초과 · AI 이어서 두기 · 정산.
 * Edge Function(game-action, game-timeout)이 쓰고, 단위 테스트는 메모리 Store로 돌린다.
 * DB 접근은 Store 인터페이스로만 한다.
 */
import { cryptoRng, EngineError, type Engine, type Rng, type SeatInfo } from './engine.ts';
import { soloOf, soloStep } from './solo.ts';

export type GameId = 'matgo' | 'poker' | 'blackjack' | 'holdem' | 'roulette';

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
  /** 이 엔진 상태가 몇 번째 판의 것인지 (방의 판 번호와 다르면 지난 판 상태) */
  round_no: number;
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
  saveDeck(id: string, expectVersion: number, state: unknown, carry: unknown, round: number): Promise<boolean>;
  /** 판 시작 (대기 중 + 사람 모두 레디일 때만) → 새 판 번호 또는 null */
  beginRound(id: string): Promise<number | null>;
  /** 화면용 상태 저장 (공개 + 자리별 비공개). version이 저장된 것보다 새로울 때만 바뀐다 */
  publish(
    id: string,
    version: number,
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
  /** (룰렛) 확정 베팅: 지갑에서 먼저 빼고 기록. 같은 스핀·사람은 한 번만. 칩이 모자라면 예외 */
  placeBet?(id: string, round: number, spin: number, userId: string, bets: unknown, total: number): Promise<void>;
  /** (룰렛) 결과 지급: 그 스핀 기록 기준으로 한 번만 */
  paySpin?(id: string, round: number, spin: number, result: number): Promise<void>;
}

/** 사람 차례 제한 시간 */
export const TURN_MS = 20_000;
/**
 * 혼자 하는 판(solo.ts)의 마감: 화면이 기기에서 진행하므로 서버의 차례 시간은 재지 않는다.
 * 버려진 판(화면이 멈췄는데 자리는 지키고 있는 경우)을 치우는 용도로만 길게 둔다 → 지나면 서버가 남은 판을 대신 두어 끝낸다.
 */
export const SOLO_DEADLINE_MS = 30 * 60_000;
/** 한 번에 받아 주는 사람 행동 수 (맞고 한 판은 수십 번이면 끝난다) */
const MAX_REPLAY_ACTIONS = 300;
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
    const loaded = await this.load(roomId);
    const { room, deck, engine } = loaded;
    let { seats } = loaded;
    if (!seats.some((s) => s.user_id === userId && !s.left_game)) throw new GameError('not in room', 403);
    if (room.status !== 'waiting') return { started: false };
    const round = await this.store.beginRound(roomId);
    if (round === null) return { started: false };
    // 시작 직전에 자리가 바뀌었을 수 있으니 시작한 뒤의 자리로 판을 만든다
    seats = await this.store.seats(roomId);

    const info = await this.seatInfo(room, seats);
    let state = engine.newRound({ seats: info, baseUnit: room.base_unit, carry: deck.carry ?? null, rng: this.rng });
    // 혼자 하는 맞고(사람 1명 + AI): 화면이 기기에서 진행한다 (solo.ts). 판마다 씨앗을 정해 상태에 싣는다
    const solo = room.game === 'matgo' && this.humans(seats).length === 1 && !engine.done(state);
    if (solo) state = { ...state, solo: { seed: Math.floor(this.rng.next() * 4294967296) >>> 0, n: 0 } };
    const saved = await this.advance(roomId, { ...room, status: 'playing', round_no: round }, seats, engine, deck.version, state);
    // 화면이 이어서 둘 수 있게 전체 상태를 같이 돌려준다 (그 방의 유일한 사람만 부를 수 있는 응답)
    if (solo && saved !== null && !engine.done(saved)) return { started: true, round, solo: saved };
    return { started: true, round };
  }

  /** 자리에 앉아 있는 사람들 (판 도중 나간 사람 제외) */
  private humans(seats: SeatRow[]) {
    return seats.filter((s) => s.user_id !== null && !s.left_game);
  }

  /** 혼자 하는 판인지 확인하고 불러온다: 진행 중인 solo 판이고, 부른 사람이 그 방의 유일한 사람이어야 한다 */
  private async loadSolo(roomId: string, userId: string) {
    const loaded = await this.load(roomId);
    const { room, seats, deck } = loaded;
    const seat = seats.find((s) => s.user_id === userId && !s.left_game);
    if (!seat) throw new GameError('not in room', 403);
    if (room.status !== 'playing' || !deck.state || deck.round_no !== room.round_no) throw new GameError('not playing', 409);
    const solo = soloOf(deck.state);
    if (!solo || this.humans(seats).length !== 1) throw new GameError('not solo', 409);
    return { ...loaded, seat, solo };
  }

  /** 혼자 하는 판의 전체 상태 (새로고침·재접속한 화면이 이어서 두려고 부른다) */
  async sync(roomId: string, userId: string) {
    const { room, deck } = await this.loadSolo(roomId, userId);
    return { state: deck.state, version: deck.version, round: room.round_no };
  }

  /**
   * 혼자 하는 판: 화면이 기기에서 둔 사람 행동 목록을 받아 서버 상태에서 그대로 다시 둔다.
   * payload { n, actions }: n = 이 목록이 시작되는 서버 상태의 solo.n (다르면 409 'out of sync').
   * AI 차례는 서버가 직접 둔다 (화면이 보낸 것은 사람 행동으로만 쓴다). 판이 안 끝나는 부분 목록도 받는다 (중간 저장).
   */
  async replay(roomId: string, userId: string, payload: unknown) {
    const p = payload as { n?: unknown; actions?: unknown } | null;
    const actions = p?.actions;
    if (!p || !Number.isInteger(p.n) || !Array.isArray(actions) || actions.length > MAX_REPLAY_ACTIONS) throw new GameError('bad replay');
    if (actions.some((a) => !a || typeof a !== 'object' || Array.isArray(a))) throw new GameError('bad replay');
    for (let attempt = 0; attempt < 3; attempt++) {
      const { room, seats, deck, engine, seat, solo } = await this.loadSolo(roomId, userId);
      if (solo.n !== p.n) throw new GameError('out of sync', 409);
      let state = deck.state;
      try {
        for (const a of actions) {
          // 사람 행동 앞의 AI 차례는 서버가 직접 둔다
          state = this.soloAutos(engine, seats, state);
          if (engine.done(state) || !engine.pending(state).includes(seat.seat_no)) throw new GameError('not your turn');
          state = soloStep(engine, state, seat.seat_no, a);
        }
      } catch (e) {
        if (e instanceof EngineError) throw new GameError(e.message);
        throw e;
      }
      // 뒤따르는 AI 차례·저장·공개·(끝났으면) 정산은 평소대로
      const saved = await this.advance(roomId, room, seats, engine, deck.version, state);
      if (saved !== null) return { ok: true, n: soloOf(saved)?.n ?? null, done: engine.done(saved) };
    }
    throw new GameError('busy, try again', 409);
  }

  /** solo 판: 사람이 두지 않는 자리의 차례를 이어서 둔다 (사람 차례나 판 끝까지) */
  private soloAutos(engine: AnyEngine, seats: SeatRow[], state: unknown) {
    for (let steps = 0; !engine.done(state); steps++) {
      const seat = (engine.pending(state) as number[]).find((s) => this.auto(seats, s));
      if (seat === undefined) break;
      if (steps > MAX_AUTO_STEPS) throw new Error('AI loop');
      state = soloStep(engine, state, seat, null);
    }
    return state;
  }

  /** 엔진에 넘길 자리 정보 (사람은 지갑 잔액) */
  private async seatInfo(room: RoomRow, seats: SeatRow[]): Promise<SeatInfo[]> {
    const humans = seats.filter((s) => s.user_id && !s.left_game).map((s) => s.user_id!);
    const bal = await this.store.balances(humans, room.game);
    return [...seats]
      .sort((a, b) => a.seat_no - b.seat_no)
      .map((s) => ({
        seat: s.seat_no,
        kind: s.user_id && !s.left_game ? 'human' : 'ai',
        name: s.nickname,
        stack: s.user_id ? (bal[s.user_id] ?? 0) : null,
      }));
  }

  /** 사람의 행동 */
  async act(roomId: string, userId: string, action: unknown) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { room, seats, deck, engine } = await this.load(roomId);
      if (room.status !== 'playing' || !deck.state || deck.round_no !== room.round_no) throw new GameError('not playing', 409);
      const seat = seats.find((s) => s.user_id === userId && !s.left_game);
      if (!seat) throw new GameError('not in room', 403);
      if (!engine.pending(deck.state).includes(seat.seat_no)) throw new GameError('not your turn', 409);
      let state;
      let charge: { spin: number; bets: unknown; total: number } | null = null;
      try {
        // solo 판에 직접 온 행동 (기기에서 진행하지 못한 화면): 같은 걸음 규칙으로 적용한다
        state = soloOf(deck.state) ? soloStep(engine, deck.state, seat.seat_no, action) : engine.apply(deck.state, seat.seat_no, action, this.rng);
        charge = engine.charge ? engine.charge(deck.state, seat.seat_no, action) : null;
      } catch (e) {
        if (e instanceof EngineError) throw new GameError(e.message);
        throw e;
      }
      // 확정 베팅: 칩을 먼저 뺀다 (같은 스핀은 한 번만이라 다시 시도해도 두 번 빠지지 않는다)
      if (charge && this.store.placeBet) {
        try {
          await this.store.placeBet(roomId, room.round_no, charge.spin, userId, charge.bets, charge.total);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/not enough money/.test(msg)) throw new GameError('not enough money');
          if (/spin closed|not playing/.test(msg)) throw new GameError('베팅 시간이 끝났어요', 409);
          if (/already bet/.test(msg)) throw new GameError('이미 확정했어요', 409);
          throw new GameError(msg);
        }
      }
      if ((await this.advance(roomId, room, seats, engine, deck.version, state, engine.spinResult ? engine.spinResult(deck.state) : null)) !== null) return { ok: true };
    }
    throw new GameError('busy, try again', 409);
  }

  /**
   * 시간 초과 처리 (cron). expectVersion이 바뀌었으면(그 사이 누가 뒀으면) 건너뛴다.
   * autoOnly: 마감 전이지만 나간 사람 자리만 AI로 처리할 때 (남은 사람의 차례 시간은 그대로)
   */
  async timeout(roomId: string, expectVersion?: number, autoOnly = false) {
    const { room, seats, deck, engine } = await this.load(roomId);
    if (room.status !== 'playing') return { acted: false };
    if (expectVersion !== undefined && expectVersion !== deck.version) return { acted: false };
    // 판을 시작하다 오류로 멈춘 방: 이번 판 상태가 없으면 정산 없이 대기 상태로 되돌린다
    if (!deck.state || deck.round_no !== room.round_no) {
      await this.store.finishRound(roomId);
      return { acted: true, recovered: true };
    }
    let state: unknown = deck.state;
    // 사람 차례가 없던 상태(룰렛 회전·결과)에서 마감이 지났으면 다음 단계로
    const waitingTimer = !engine.done(state) && engine.pending(state).length === 0;
    if (waitingTimer && engine.tick && !autoOnly) {
      // 지난번 지급이 실패했어도 여기서 마저 (기록 기준, 한 번만) — 다음 스핀으로 넘어가면 결과를 잃는다
      const prev = engine.spinResult ? engine.spinResult(state) : null;
      if (prev && this.store.paySpin) await this.store.paySpin(roomId, room.round_no, prev.spin, prev.result);
      state = engine.tick(state, this.rng, await this.seatInfo(room, seats));
    } else if (!engine.done(state) && soloOf(state)) {
      // solo 판: 나간 사람 자리는 AI가 이어서 둔다 (autoOnly). 자리는 지키는데 30분 마감이 지났으면 버려진 판이다
      // → 사람 차례는 정해진 자동 행동으로, 판이 끝날 때까지 서버가 대신 둔다
      for (let steps = 0; !engine.done(state); steps++) {
        if (steps > MAX_AUTO_STEPS) throw new Error('AI loop');
        state = this.soloAutos(engine, seats, state);
        if (engine.done(state) || autoOnly) break;
        const seat = (engine.pending(state) as number[])[0];
        if (seat === undefined) break;
        state = soloStep(engine, state, seat, engine.timeout(state, seat, this.rng));
      }
    } else if (!engine.done(state)) {
      for (const seat of engine.pending(state)) {
        if (!engine.pending(state).includes(seat)) continue;
        const auto = this.auto(seats, seat);
        if (autoOnly && !auto) continue;
        // 나간 사람은 AI가, 자리에 있는데 시간을 넘긴 사람은 정해진 자동 행동
        const a = auto ? this.aiAction(engine, state, seat) : engine.timeout(state, seat, this.rng);
        state = engine.apply(state, seat, a, this.rng);
      }
    }
    // 끝난 판이면(정산 도중 멈춘 경우 포함) advance가 정산·정리를 마저 한다 (정산은 판마다 한 번만)
    return { acted: (await this.advance(roomId, room, seats, engine, deck.version, state, engine.spinResult ? engine.spinResult(deck.state) : null)) !== null };
  }

  private aiAction(engine: AnyEngine, state: unknown, seat: number) {
    const v = engine.view(state);
    return engine.ai(v.public, v.private[seat], seat, this.rng);
  }

  /** AI 차례를 이어서 두고, 저장·공개하고, 판이 끝났으면 정산한다 → 저장했으면 저장한 상태, 못 했으면(버전 충돌) null */
  /** savedSpin: 불러온(이미 저장된) 상태의 스핀 결과. 넘겨받은 state는 호출한 쪽에서 이미 바뀌었을 수 있어 여기서 재지 않는다 */
  private async advance(roomId: string, room: RoomRow, seats: SeatRow[], engine: AnyEngine, version: number, state: unknown, savedSpin: { spin: number; result: number } | null = null) {
    let steps = 0;
    // solo 판: AI 차례는 solo.ts 의 걸음 규칙으로 둔다 (화면이 같은 결과를 내도록)
    if (soloOf(state)) state = this.soloAutos(engine, seats, state);
    // 이번 호출에서 새로 나온 결과(저장 전)로는 여기서 지급·다음 단계로 넘기지 않는다 (savedSpin과 다르면 저장 전)
    while (!engine.done(state)) {
      const autos = engine.pending(state).filter((s: number) => this.auto(seats, s));
      if (autos.length === 0) {
        // 모두 결과를 확인했으면 (룰렛) 마감을 기다리지 않고 다음 단계로 → 새 단계의 자동 자리를 이어서 처리
        if (engine.tick && engine.tickNow && engine.tickNow(state)) {
          const prev = engine.spinResult ? engine.spinResult(state) : null;
          // 저장되지 않은 결과로 지급하면, 저장에 실패해 다시 돌렸을 때 기록과 지급이 어긋난다 → 먼저 저장·공개하고 다음 마감 때 넘어간다
          if (prev && (!savedSpin || savedSpin.spin !== prev.spin || savedSpin.result !== prev.result)) break;
          if (prev && this.store.paySpin) await this.store.paySpin(roomId, room.round_no, prev.spin, prev.result);
          state = engine.tick(state, this.rng, await this.seatInfo(room, seats));
          if (++steps > MAX_AUTO_STEPS) throw new Error('AI loop');
          continue;
        }
        break;
      }
      for (const seat of autos) {
        if (!engine.pending(state).includes(seat)) continue;
        state = engine.apply(state, seat, this.aiAction(engine, state, seat), this.rng);
        if (++steps > MAX_AUTO_STEPS) throw new Error('AI loop');
      }
    }

    if (engine.stamp) state = engine.stamp(state, this.now());
    const done = engine.done(state);
    const settlement = done ? engine.settle(state) : null;
    const deck = await this.store.deck(roomId);
    const carry = settlement ? settlement.carry : deck.carry;
    if (!(await this.store.saveDeck(roomId, version, state, carry, room.round_no))) return null;

    const view = engine.view(state);
    const pending: number[] = done ? [] : engine.pending(state);
    const humanPending = pending.some((s) => !this.auto(seats, s));
    const fixed = engine.deadlineAt ? engine.deadlineAt(state) : undefined;
    const solo = soloOf(state);
    const deadline = fixed !== undefined ? (fixed === null ? null : new Date(fixed)) : humanPending ? new Date(this.now() + (solo ? SOLO_DEADLINE_MS : TURN_MS)) : null;
    // soloN: 혼자 하는 판이면 지금까지 적용한 행동 수 (화면이 자기 진행과 견줘 낡은 공개 상태를 가려낸다. 씨앗은 싣지 않는다)
    const pub = {
      ...(view.public as object),
      round: room.round_no,
      result: settlement?.summary ?? null,
      deltas: settlement?.deltas ?? null,
      ...(solo ? { soloN: solo.n } : {}),
    };
    const privates = seats.map((s) => ({ seat: s.seat_no, userId: s.user_id, hand: view.private[s.seat_no] ?? null }));
    // 룰렛: 결과가 나온 스핀은 공개 전에 지급 (기록 기준, 한 번만). 실패해도 다음 마감 처리 때 다시 지급한다
    const spun = engine.spinResult ? engine.spinResult(state) : null;
    if (spun && this.store.paySpin) await this.store.paySpin(roomId, room.round_no, spun.spin, spun.result);
    await this.store.publish(roomId, version + 1, room.round_no, pub, pending, deadline, privates);

    if (settlement) {
      await this.store.applyResult(roomId, room.round_no, settlement.deltas);
      await this.store.finishRound(roomId);
    }
    return state;
  }
}
