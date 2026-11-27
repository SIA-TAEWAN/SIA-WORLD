/**
 * 맞고 판을 기기에서 먼저 진행한다: 혼자 하는 판(사람 1명 + AI)과 사람 둘이 하는 판.
 *
 * ── 사람이 둘인 판 (duo): 서버는 계속 심판, 화면은 먼저 보여 준다 ──
 *   내 행동 → 기기에서 바로 적용·연출 + 상대에게 바로 알림(방 채널 broadcast) + 서버에는 뒤에서 하나씩 차례로 (act + 진행 수 n).
 *   상대 행동 → 알림이 오면 규칙 검사(엔진)를 통과한 것만, 내 연출이 끝난 뒤 순서대로 적용한다. 알림은 믿지 않는다:
 *   서버가 공개한 상태와 내 진행이 다르거나(지문 비교), 서버가 내 행동을 거절하거나, 알림을 놓쳐 서버가 앞서 있으면 sync 로 서버 상태에 맞춘다.
 *   정산·결과는 서버가 공개한 상태로만 보여 준다. 상대가 나가 AI 가 대신 두거나 시간 초과로 서버가 대신 둔 것도 공개 상태를 보고 따라간다.
 *
 * ── 혼자 하는 판 ──
 *
 * 서버는 판을 시작할 때 전체 상태(더미 순서·AI 패·씨앗 포함)를 한 번 내려 주고, 그 뒤로는 기기가 규칙 엔진을 직접 돌린다:
 *   내 행동 → 바로 적용 → 화면에 넣기 (실시간으로 받은 것과 같은 길) → 연출이 다 끝나면 AI 가 한 수 → …
 * 판이 끝나면 내가 한 행동 목록만 서버에 보내고(replay), 서버가 같은 걸음 규칙(solo.ts)으로 다시 두어 정산한다.
 * 결과(점수 창)는 서버가 공개한 상태가 실시간으로 오면 평소 길로 보여 준다.
 *
 * 서버와 닿는 때: 판 시작(또는 새로고침 뒤 sync), 판 끝(replay), 페이지를 떠날 때(그때까지의 목록), 그리고 어긋났을 때(sync).
 *
 * 화면(DOM·Phaser)을 모른다 → 셸이 주는 LocalHost 로만 일한다 (단위 테스트는 가짜 host 로 돌린다).
 */
import { EngineError, seededRng, type Engine } from '../../supabase/functions/_shared/engine.ts';
import { RULES_CHANGED, soloOf, soloStep } from '../../supabase/functions/_shared/solo.ts';
import type { PrivateRow, RoomRow, SeatRow, StateRow } from './world.ts';

/** 서버에 보내는 사람 행동 목록 (n: 이 목록이 시작되는 서버 진행 수, rules: 이 화면에 실린 엔진의 규칙 판) */
export interface ReplayPayload {
  n: number;
  actions: unknown[];
  rules?: number;
}

/** 서버가 '규칙 판이 다르다'고 거절한 오류인가 (화면은 새로고침을 안내한다) */
export function isRulesChanged(e: unknown): boolean {
  return String((e as { code?: unknown } | null)?.code ?? '').includes(RULES_CHANGED);
}

/** 셸이 기기 진행에 주는 것 */
export interface LocalHost {
  roomId: string;
  /** 지금 방·자리 */
  get(): { room: RoomRow | null; seats: SeatRow[]; mySeat: number | null };
  /** 서버 호출 (실패하면 code = 서버 문구, status = HTTP 상태가 실린 오류. 통신 실패면 status 가 없다) */
  api: {
    /** 전체 상태 받기. duo = 사람이 둘인 판인가 (상대 차례를 AI 로 두면 안 된다) */
    sync(): Promise<{ state: unknown; version: number; round: number; duo?: boolean }>;
    /** (사람이 둘인 판) 내 행동 하나를 서버에 보낸다. n = 이 행동을 적용할 진행 수 (서버와 다르면 409 'out of sync') */
    act?(payload: unknown, n: number): Promise<unknown>;
    /** (사람이 둘인 판) 내 행동을 상대 화면에 바로 알린다 (방 채널 broadcast. 못 보내도 된다 — 상대는 서버 공개 상태로 따라온다) */
    cast?(msg: unknown): void;
    replay(p: ReplayPayload): Promise<{ ok: boolean; n: number | null; done: boolean }>;
    /** 페이지를 떠나는 중에 보내기 (응답을 기다리지 않는다) */
    replayOnExit(p: ReplayPayload): boolean;
  };
  /** 새 상태를 실시간으로 받은 것과 똑같은 길로 넣는다 (연출·컷인 포함) */
  push(state: StateRow, priv: PrivateRow): void;
  /** 연출 없이 바로 그 상태로 (서버와 다시 맞출 때) */
  jump(state: StateRow, priv: PrivateRow): void;
  /** 앞선 연출(카드 이동 · 컷인 · 재생 대기열)이 모두 끝날 때까지 */
  settled(): Promise<void>;
  /** 지금 화면의 차례 마감 시각만 바꾼다 (타이머 막대) */
  setDeadline(iso: string | null): void;
  /** 서버 상태를 다시 읽는다 */
  reload(): Promise<void>;
  /** 다시 그리기 (조작부 · 누를 수 있는 패) */
  refresh(): void;
  toast(msg: string): void;
  /**
   * 서버의 규칙 판이 이 화면(이 탭이 열릴 때 받은 엔진)과 다르다: 기기에서 진행하지 않는다.
   * 셸은 '게임이 새 버전으로 바뀌었어요' 안내와 새로고침 버튼을 띄운다
   */
  outdated?(): void;
}

/** 기기 진행이 셸에 주는 것 */
export interface LocalPlay {
  /** 판 시작 응답 (혼자 하는 판이면 전체 상태가 들어 있다) */
  onStart(res: unknown): void;
  /** 서버에서 온 공개 상태를 버릴까 (기기 진행보다 낡았으면 true) */
  filterState(s: StateRow): boolean;
  /** 서버에서 온 내 비공개 패를 버릴까 */
  filterPrivate(p: PrivateRow): boolean;
  /** 다시 읽은 서버 상태 대신 보여 줄 기기 진행 상태 (서버 것을 그대로 쓰면 null) */
  onReload(r: { room: RoomRow | null; state: StateRow | null }): { state: StateRow; priv: PrivateRow } | null;
  /** 내 행동: 기기에서 처리했으면 true, 거절이면 false, 서버로 보내야 하면(기기 진행 중이 아니면) null */
  act(payload: unknown): boolean | null;
  /** (사람이 둘인 판) 상대 화면이 알려 온 행동 (방 채널 broadcast). 믿지 않는다: 규칙 검사를 통과한 것만 쓴다 */
  onCast(msg: unknown): void;
  /** 나가기 · 페이지 닫기 직전: 그때까지의 행동 목록을 서버에 보낸다 (실패해도 무시) */
  flush(kind: 'leave' | 'pagehide'): Promise<void>;
  /**
   * 자리가 바뀌었다 (셸이 자리 정보를 새로 받은 뒤 부른다). 사람이 둘인 판에서 상대가 나갔으면 바로 서버 상태를 받아
   * 혼자 하는 판으로 넘어간다 (내 차례 시간은 그때부터 기기에서 잰다)
   */
  onSeats?(): void;
  /** 조작부에 대신 보여 줄 안내 (없으면 null) */
  notice(): string | null;
  /**
   * 혼자 하는 판의 전체 상태를 받아 오는 중인가 (새로고침 직후 등). 그동안 화면에는 서버에 저장된 옛 상태가 보이므로
   * 조작을 잠깐 막는다 (옛 화면에서 누른 행동이 서버로 가면 그동안 기기에서 둔 것을 되돌리게 된다). 받지 못하면 풀린다
   */
  waiting(): boolean;
  dispose(): void;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface SoloPlayOpts {
  /** 내 차례 제한 시간 (기본 20초). 지나면 엔진의 자동 행동을 내 행동으로 둔다 */
  turnMs?: number;
  /** 연출이 끝난 뒤 AI 가 두기까지의 틈 (기본 350ms) */
  thinkMs?: number;
  /** 전체 상태 받기(sync)를 기다려 주는 시간 (기본 5초). 넘으면 실패로 치고 다시 시도한다 (그동안 조작이 막혀 있지 않게) */
  syncMs?: number;
  /** 셸이 모르는 게임 자체 연출이 끝나기까지 남은 시간 (ms) */
  busyLeft?(): number;
  /** 연출 없이 이 상태로 건너뛴다 (게임이 지난 사건의 연출 계획을 비우게) */
  onJump?(pub: Record<string, unknown>, round: number, roomId: string): void;
  /** 행동 목록을 보관할 곳 (기본 localStorage, null 이면 보관하지 않는다) */
  storage?: Store | null;
}

interface Entry {
  /** 이 행동을 적용하기 직전의 진행 수 (solo.n) */
  n: number;
  a: unknown;
  /** 그때 내가 보던 판의 지문 (다시 적용할 때 같은 판인지 확인한다) */
  h?: string;
}

/** 값의 지문: 키 순서와 상관없이 같은 내용이면 같다 (서버 DB 를 거친 상태는 키 순서가 바뀐다) */
function fingerprint(v: unknown): string {
  const canon = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(canon)
      : x && typeof x === 'object'
        ? Object.keys(x as object).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])
        : x;
  const s = JSON.stringify(canon(v));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return `${s.length}:${h.toString(36)}`;
}

const KEY = 'sia-solo:';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function defaultStorage(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 서버가 '이 판은 더 받지 않는다'고 한 오류 (판이 이미 끝났거나, 혼자 하는 판이 아니거나, 방에 없다) */
function isGone(e: unknown): boolean {
  const code = String((e as { code?: unknown } | null)?.code ?? '');
  return /not playing|not solo|not in room|room not found/.test(code);
}

// deno-lint-ignore no-explicit-any
export function soloPlay<S, A>(engine: Engine<S, A, any, any, any>, opts: SoloPlayOpts = {}): (host: LocalHost) => LocalPlay {
  return (host) => {
    const TURN = opts.turnMs ?? 20_000;
    const THINK = opts.thinkMs ?? 350;
    const SYNC_MS = opts.syncMs ?? 5000;
    /** 서버가 이만큼(걸음)까지만 앞서 있으면 다시 맞출 때 그 걸음을 연출로 보여 준다 (한 차례가 내기 + 고르기 + 고/스톱으로 3걸음일 수 있다 → 한두 차례) */
    const AHEAD_MAX = 4;
    const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    /** 이 화면에 실린 엔진의 규칙 판 (서버에 보내는 목록·행동에 싣는다) */
    const RULES = engine.rulesVersion;
    const withRules = (p: ReplayPayload): ReplayPayload => (RULES === undefined ? p : { ...p, rules: RULES });
    /** 서버가 다른 규칙 판이다: 이 탭에서는 더 기기에서 진행하지 않는다 (새로고침해야 풀린다) */
    let outdated = false;

    interface Cur {
      round: number;
      /** 내 자리 */
      seat: number;
      state: S;
      /** 서버에 저장된 진행 수 (이 뒤의 내 행동이 아직 보내지 않은 것) */
      savedN: number;
      /** 서버 진행 수(savedN) 이후에 내가 한 행동 (앞선 것은 서버에 있다) */
      log: Entry[];
      /** 마지막으로 화면에 넣은 상태 */
      row: StateRow;
      priv: PrivateRow;
      /** 사람이 둘인 판: 상대 차례는 알림(또는 서버)을 기다리고, 내 행동은 하나씩 서버에 보낸다 */
      duo: boolean;
      /** (duo) 아직 서버에 보내지 못한 내 행동 (차례대로) */
      outbox: { n: number; a: unknown }[];
      /** (duo) 상대가 알려 온 행동: 진행 수 → 행동 (아직 적용하지 않은 것) */
      inbox: Map<number, { seat: number; a: unknown }>;
      /** (duo) 진행 수마다 내가 본 공개 상태의 지문 (서버가 공개한 상태와 견준다) */
      prints: Map<number, string>;
      /** (duo) 서버가 공개한 가장 앞선 진행 수 */
      serverN: number;
      /** (duo) 내가 아직 가지 못한 진행 수에 대해 서버가 먼저 공개한 상태의 지문 (내가 거기 닿았을 때 견준다) */
      seen: Map<number, string>;
    }
    let cur: Cur | null = null;
    let seq = 0;
    /** 다시 맞출 때마다 늘린다: 그 전에 돌던 진행 고리는 멈춘다 */
    let gen = 0;
    let runningGen = -1;
    let sending = false;
    let sendAgain = false;
    let syncing = false;
    let disposed = false;
    let lastSyncTry = 0;
    /** 전체 상태를 받아 오기로 했고 아직 끝나지 않았다 */
    let wanted = 0;
    let turnTimer: ReturnType<typeof setTimeout> | null = null;
    let lateTimer: ReturnType<typeof setTimeout> | null = null;
    let lagTimer: ReturnType<typeof setTimeout> | null = null;
    /** 가려진 탭에서 내 시간이 다 됐다: 화면이 다시 보이기를 기다리는 중 (그때 시간을 처음부터 다시 잰다) */
    let visWait: (() => void) | null = null;
    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    let pumping = false;
    /** 공개 상태의 지문 (서버가 덧붙이는 칸은 빼고, DB 를 거친 것과 같은 모양으로) */
    const pubPrint = (pub: unknown) => {
      const o = { ...(JSON.parse(JSON.stringify(pub ?? {})) as Record<string, unknown>) };
      for (const k of ['round', 'result', 'deltas', 'soloN']) delete o[k];
      return fingerprint(o);
    };

    const nOf = (s: S) => soloOf(s)?.n ?? 0;
    /** 내 자리에서 보이는 판 (공개 + 내 패)의 지문 */
    const print = (s: S, seat: number) => {
      const v = engine.view(s);
      return fingerprint([v.public, v.private[seat] ?? null]);
    };

    // ── 행동 목록 보관 (새로고침해도 이어 가게) ──
    const keyOf = (round: number) => `${KEY}${host.roomId}:${round}`;
    const readLog = (round: number): Entry[] => {
      try {
        const j = JSON.parse(storage?.getItem(keyOf(round)) ?? 'null') as { log?: unknown } | null;
        if (!j || !Array.isArray(j.log)) return [];
        return (j.log as Entry[]).filter((e) => e && Number.isInteger(e.n) && !!e.a && typeof e.a === 'object');
      } catch {
        return [];
      }
    };
    const writeLog = () => {
      if (!cur || !storage) return;
      try {
        storage.setItem(keyOf(cur.round), JSON.stringify({ t: Date.now(), log: cur.log }));
      } catch {
        /* 보관하지 못해도 판은 이어 간다 (새로고침하면 서버에 저장된 데서부터) */
      }
    };
    /** 이 방의 다른 판 · 하루 넘은 보관분을 치운다 */
    const prune = (keepRound: number | null) => {
      if (!storage) return;
      try {
        const drop: string[] = [];
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (!k || !k.startsWith(KEY)) continue;
          if (k.startsWith(`${KEY}${host.roomId}:`)) {
            if (keepRound === null || k !== keyOf(keepRound)) drop.push(k);
            continue;
          }
          const t = (JSON.parse(storage.getItem(k) ?? 'null') as { t?: number } | null)?.t ?? 0;
          if (Date.now() - t > 86_400_000) drop.push(k);
        }
        for (const k of drop) storage.removeItem(k);
      } catch {
        /* 무시 */
      }
    };

    // ── 화면에 넣기 ──
    const show = (c: Cur, mode: 'push' | 'jump', mine = false) => {
      const v = engine.view(c.state);
      const pending: number[] = engine.done(c.state) ? [] : engine.pending(c.state);
      c.row = {
        round_no: c.round,
        // 결과(result · deltas)는 서버가 정산해 공개한 상태로만 보여 준다
        public_state: { ...(v.public as object), round: c.round, result: null, deltas: null, soloN: nOf(c.state) },
        pending_seats: pending,
        // 내 시간은 앞선 연출이 끝난 뒤부터 잰다 (arm 이 다시 맞춘다). 사람이 둘인 판은 서버가 차례 시간을 잰다 → 누구 차례든 그만큼
        turn_deadline: c.duo ? (pending.length ? new Date(Date.now() + TURN).toISOString() : null) : pending.includes(c.seat) ? new Date(Date.now() + TURN + 3000).toISOString() : null,
        // 서버 시각이 아니라 순번 (셸은 local 표시가 있으면 시각으로 낡았는지 따지지 않는다)
        updated_at: `local:${String(++seq).padStart(9, '0')}`,
        local: true,
        // 내가 방금 둔 행동: 기다리지 않고 바로 보여 준다
        ...(mine ? { eager: true } : {}),
      };
      c.priv = { seat_no: c.seat, round_no: c.round, hand: v.private[c.seat] ?? null };
      if (c.duo) {
        const n = nOf(c.state);
        const mine = pubPrint(v.public);
        c.prints.set(n, mine);
        if (c.prints.size > 400) c.prints.delete(c.prints.keys().next().value as number);
        // 서버가 이 진행 수의 상태를 먼저 공개했는데 내용이 다르다 (서버가 대신 뒀다 · 가짜 알림): 서버 상태로 맞춘다
        const theirs = c.seen.get(n);
        if (theirs !== undefined && theirs !== mine && mode !== 'jump') void resync();
      }
      if (mode === 'jump') {
        opts.onJump?.(c.row.public_state!, c.round, host.roomId);
        host.jump(c.row, c.priv);
      } else host.push(c.row, c.priv);
    };

    /** 전체 상태 받기: 답이 SYNC_MS 안에 안 오면 실패로 친다 (걸려 있는 동안 조작이 막히거나 다시 맞추기가 멈추지 않게) */
    const syncOnce = () =>
      new Promise<Awaited<ReturnType<LocalHost['api']['sync']>>>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('sync timeout')), SYNC_MS);
        host.api.sync().then(
          (r) => (clearTimeout(t), resolve(r)),
          (e) => (clearTimeout(t), reject(e)),
        );
      });

    /** 판의 사건 기록 (공개 상태의 events. 없는 게임이면 null) */
    const eventsOf = (st: S): { id?: unknown }[] | null => {
      const e = (engine.view(st).public as { events?: unknown } | null)?.events;
      return Array.isArray(e) ? (e as { id?: unknown }[]) : null;
    };
    /** b 가 a 에서 그대로 이어진 판인가: a 의 사건이 b 에 똑같이 있고 b 에 새 사건이 더 있다 (내 예측이 틀린 판이 아니다) */
    const continues = (a: S, b: S) => {
      const mine = eventsOf(a);
      const theirs = eventsOf(b);
      if (!mine || !theirs) return false;
      const idOf = (e: { id?: unknown }) => (typeof e?.id === 'number' ? e.id : -1);
      const byId = new Map(theirs.map((e) => [idOf(e), fingerprint(e)]));
      const maxMine = mine.reduce((m, e) => Math.max(m, idOf(e)), 0);
      const maxTheirs = theirs.reduce((m, e) => Math.max(m, idOf(e)), 0);
      if (maxTheirs <= maxMine) return false;
      for (const e of mine) {
        const t = byId.get(idOf(e));
        if (t !== undefined && t !== fingerprint(e)) return false;
      }
      // 내 마지막 사건이 서버 기록에 없으면 (기록이 잘렸다) 이어 붙일 수 없다
      return mine.length === 0 || byId.has(maxMine);
    };

    const clearTurn = () => {
      if (turnTimer) clearTimeout(turnTimer);
      turnTimer = null;
      if (visWait) document.removeEventListener('visibilitychange', visWait);
      visWait = null;
    };
    const stop = () => {
      gen++;
      clearTurn();
      if (lateTimer) clearTimeout(lateTimer);
      lateTimer = null;
      if (lagTimer) clearTimeout(lagTimer);
      lagTimer = null;
    };
    /** 기기 진행을 끝낸다 (서버가 공개하는 상태를 그대로 따른다) */
    const drop = () => {
      stop();
      if (!cur) return;
      try {
        storage?.removeItem(keyOf(cur.round));
      } catch {
        /* 무시 */
      }
      cur = null;
      host.refresh();
    };
    /**
     * 서버의 규칙 판이 다르다 (판 시작·sync 응답의 solo.rules, 또는 서버가 409 RULES_CHANGED 로 거절했다).
     * 기기 진행을 끝내고 다시 받아 오지도 않는다 (받아도 또 어긋난다) → 셸이 새로고침 안내를 띄운다
     */
    const markOutdated = () => {
      if (outdated) return;
      outdated = true;
      wanted = 0;
      drop();
      try {
        host.outdated?.();
      } catch (e) {
        console.warn('outdated', e);
      }
    };

    /** 사람이 아닌 자리의 차례를 이어서 둔다 (연출 없이: 보관한 행동을 다시 적용할 때만 쓴다) */
    const runAi = (state: S, seat: number): S => {
      let s = state;
      for (let i = 0; i < 5000 && !engine.done(s); i++) {
        const ai = (engine.pending(s) as number[]).find((x) => x !== seat);
        if (ai === undefined) break;
        s = soloStep(engine, s, ai, null);
      }
      return s;
    };

    /**
     * 서버에서 받은 전체 상태로 기기 진행을 시작한다 (판 시작 응답 · sync).
     * 보관해 둔 내 행동 가운데 서버 진행 수 이후의 것은 다시 적용해 이어 간다. 서버 상태와 안 맞으면 맞는 데까지만 (서버 상태를 따른다).
     */
    const adopt = (state: unknown, round: number, mode: 'start' | 'sync' | 'resync', duo = false): boolean => {
      const solo = soloOf(state);
      const seat = host.get().mySeat;
      if (!solo || seat === null || disposed || outdated) return false;
      // 서버 엔진의 규칙 판이 이 화면과 다르다: 같은 행동을 두어도 결과가 달라 영영 어긋난다 → 기기에서 진행하지 않는다
      if (RULES !== undefined && solo.rules !== undefined && solo.rules !== RULES) {
        markOutdated();
        return false;
      }
      // 사람이 둘인 판인데 행동을 하나씩 보낼 길이 없으면 기기에서 진행하지 않는다 (서버 진행 그대로)
      if (duo && !host.api.act) return false;
      // 이미 이 판을 더 앞서 진행 중이면 그대로 둔다 (늦게 온 판 시작 응답 등)
      if (cur && cur.round === round && mode !== 'resync' && nOf(cur.state) >= solo.n) return false;
      const before = cur;
      stop();
      let s = state as S;
      const log: Entry[] = [];
      // (사람이 둘인 판은 행동을 그때그때 서버에 보내므로 보관해 둔 것이 없다)
      const stored = duo ? [] : readLog(round).filter((e) => e.n >= solo.n).sort((x, y) => x.n - y.n);
      try {
        for (const e of stored) {
          const before = runAi(s, seat);
          if (engine.done(before) || nOf(before) !== e.n || !(engine.pending(before) as number[]).includes(seat)) break;
          // 진행 수가 같아도 다른 길로 온 판이면 (다른 기기에서 뒀다 등) 이어 붙이지 않는다
          if (e.h !== print(before, seat)) break;
          s = soloStep(engine, before, seat, e.a as A);
          log.push(e);
        }
      } catch {
        /* 보관한 행동이 서버 상태와 맞지 않는다: 맞는 데까지만 */
      }
      cur = {
        round, seat, state: s, savedN: solo.n, log, row: null as unknown as StateRow, priv: null as unknown as PrivateRow,
        duo, outbox: [], inbox: new Map(), prints: new Map(), serverN: solo.n, seen: new Map(),
      };
      prune(duo ? null : round);
      writeLog();
      const was = before && before.round === round && before.seat === seat && before.row ? before : null;
      const ahead = was ? solo.n - nOf(was.state) : 0;
      if (was && mode === 'resync' && !log.length && ahead === 0 && print(was.state, seat) === print(s, seat)) {
        // 화면에 보이는 것과 같은 상태다 (상대가 나가 혼자 하는 판으로 넘어가는 때 등): 화면은 건드리지 않는다 (하던 연출이 끊기지 않게)
        const mine = !engine.done(s) && (engine.pending(s) as number[]).includes(seat);
        const iso = duo ? was.row.turn_deadline : mine ? new Date(Date.now() + TURN + 3000).toISOString() : null;
        cur.row = { ...was.row, turn_deadline: iso };
        cur.priv = was.priv;
        if (duo) cur.prints.set(solo.n, pubPrint(engine.view(s).public));
        host.setDeadline(iso);
        host.refresh();
      } else {
        // 이어 붙인 행동이 있으면(새로고침) 그 사이의 연출은 건너뛴다. 판 시작이면 평소처럼 (나눠 주기 · AI 의 첫 수).
        // 다시 맞출 때도 건너뛰지만, 서버가 내 화면에서 몇 걸음만 앞서 있으면 (시간 초과로 대신 뒀다 · 나간 자리를 AI 가 뒀다) 그 걸음은 연출로 보여 준다
        const smooth = !!was && mode === 'resync' && !log.length && ahead > 0 && ahead <= AHEAD_MAX && continues(was.state, s);
        show(cur, log.length > 0 || (mode === 'resync' && !smooth) ? 'jump' : 'push');
      }
      if (engine.done(s)) void send();
      kick();
      return true;
    };

    const settled = async () => {
      for (let i = 0; i < 300; i++) {
        await host.settled();
        const more = opts.busyLeft?.() ?? 0;
        if (more <= 0 || disposed) return;
        await sleep(more + 30);
      }
    };

    /** 내 차례: 시간을 재기 시작한다 (지나면 엔진의 자동 행동을 내 행동으로 둔다) */
    const arm = (c: Cur) => {
      clearTurn();
      const n = nOf(c.state);
      const iso = new Date(Date.now() + TURN).toISOString();
      c.row = { ...c.row, turn_deadline: iso };
      host.setDeadline(iso);
      turnTimer = setTimeout(() => {
        turnTimer = null;
        if (cur !== c || nOf(c.state) !== n || disposed) return;
        // 탭이 가려져 있으면 대신 두지 않는다 (가려 둔 채로 20초마다 판이 저절로 흘러가지 않게).
        // 서버는 혼자 하는 판의 차례 시간을 재지 않으므로(SOLO_DEADLINE_MS 30분) 기다려도 된다. 다시 보이면 시간을 처음부터 잰다
        if (isHidden()) {
          host.setDeadline(null);
          const back = () => {
            if (isHidden()) return;
            document.removeEventListener('visibilitychange', back);
            if (visWait === back) visWait = null;
            if (cur === c && nOf(c.state) === n && !disposed) arm(c);
          };
          visWait = back;
          document.addEventListener('visibilitychange', back);
          return;
        }
        let a: A;
        try {
          a = engine.timeout(c.state, c.seat, seededRng((Date.now() ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0));
        } catch {
          return;
        }
        apply(a);
      }, TURN);
    };

    /** 진행 고리: 연출이 다 끝나면 AI 가 한 수 → 화면에 넣기 → 다시 연출이 끝나면 다음 수 … 내 차례가 오면 멈춘다 */
    const kick = () => {
      if (runningGen === gen || disposed) return;
      void run(gen);
    };
    const run = async (g: number) => {
      runningGen = g;
      try {
        for (;;) {
          // 앞선 행동의 연출(낸 패 → 뒤집은 패 → 먹기 → 컷인)이 전부 끝난 뒤에 다음 행동
          const at = cur ? nOf(cur.state) : -1;
          await settled();
          const c = cur;
          if (g !== gen || !c || disposed) return;
          // 기다리는 사이에 내가 뒀으면 그 행동의 연출까지 다시 기다린다
          if (nOf(c.state) !== at) continue;
          if (engine.done(c.state)) {
            host.refresh();
            return;
          }
          const pend = engine.pending(c.state) as number[];
          if (pend.includes(c.seat)) {
            // (사람이 둘인 판은 서버가 차례 시간을 잰다: 넘기면 서버가 대신 두고, 공개 상태를 보고 따라간다)
            if (!c.duo) arm(c);
            return;
          }
          const ai = pend[0];
          if (ai === undefined) return;
          if (c.duo) {
            // 상대 차례: 상대가 알려 온 행동이 있으면 적용한다 (규칙 검사는 엔진이 한다). 없으면 기다린다 (알림이 오면 다시 돈다)
            const m = c.inbox.get(at);
            if (!m) {
              lag(c);
              return;
            }
            c.inbox.delete(at);
            if (m.seat === c.seat || !pend.includes(m.seat)) continue;
            let next: S;
            try {
              next = soloStep(engine, c.state, m.seat, m.a as A);
            } catch (e) {
              // 규칙에 안 맞는 알림: 버리고 서버가 공개하는 상태를 기다린다
              if (e instanceof EngineError) continue;
              throw e;
            }
            c.state = next;
            show(c, 'push');
            continue;
          }
          await sleep(THINK);
          if (g !== gen || cur !== c || disposed) return;
          if (nOf(c.state) !== at) continue;
          c.state = soloStep(engine, c.state, ai, null);
          show(c, 'push');
          if (engine.done(c.state)) void send();
        }
      } catch (e) {
        console.warn('solo', e);
        // 기기 진행이 꼬였다: 서버 상태로 다시 맞춘다
        if (g === gen) void resync();
      } finally {
        if (runningGen === g) runningGen = -1;
      }
    };

    /** (사람이 둘인 판) 서버가 내 진행보다 앞서 있는데 상대의 알림이 없다 (놓쳤거나, 서버가 대신 뒀다): 잠깐 기다려 보고 서버 상태로 맞춘다 */
    const lag = (c: Cur) => {
      if (lagTimer || c.serverN <= nOf(c.state)) return;
      lagTimer = setTimeout(() => {
        lagTimer = null;
        if (cur !== c || disposed) return;
        if (c.serverN > nOf(c.state) && !c.inbox.has(nOf(c.state))) void resync();
      }, 400);
    };

    /** (사람이 둘인 판) 내 행동을 서버에 하나씩 차례로 보낸다. 화면은 응답을 기다리지 않는다 */
    const pump = async () => {
      if (pumping) return;
      pumping = true;
      try {
        for (let attempt = 0; !disposed; ) {
          const c = cur;
          if (!c || !c.duo || !host.api.act) return;
          const m = c.outbox[0];
          if (!m) return;
          try {
            // 규칙 판을 행동에 실어 보낸다 (서버가 떼어 내고 견준다)
            await host.api.act(RULES === undefined ? m.a : { ...(m.a as object), rules: RULES }, m.n);
            if (cur !== c) return;
            c.outbox.shift();
            attempt = 0;
          } catch (e) {
            if (cur !== c) return;
            const err = e as { code?: unknown; status?: unknown } | null;
            if (isRulesChanged(err)) {
              markOutdated();
              return;
            }
            if (isGone(err)) {
              // 서버에서는 이미 끝난 판: 서버 상태를 따른다
              drop();
              void host.reload();
              return;
            }
            // 진행 수가 다르다: 상대의 앞선 행동이 아직 서버에 닿지 않았을 수 있다 (알림이 서버보다 빨리 온다) → 잠깐씩 기다려 다시 보낸다.
            // 정말 어긋난 것이면 (서버가 대신 뒀다 등) 서버 공개 상태를 보고 먼저 맞추게 되고, 그래도 안 되면 여기서 맞춘다
            const outOfSync = String(err?.code ?? '').includes('out of sync');
            // 그 밖의 거절 (규칙 위반 · 내 차례 아님): 내 예측이 틀렸다 → 서버 상태로
            if (!outOfSync && typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
              void resync();
              return;
            }
            // 통신 문제도 몇 번 다시 보내 보고, 안 되면 서버 상태로 (그사이 서버가 시간 초과로 대신 뒀을 수 있다)
            if (attempt >= 4) {
              void resync();
              return;
            }
            await sleep(Math.min(4000, (outOfSync ? 150 : 400) * 2 ** attempt++));
          }
        }
      } finally {
        pumping = false;
      }
    };

    /** 내 행동 하나 (누른 것 · 시간 초과) */
    const apply = (a: A): boolean | null => {
      const c = cur;
      if (!c || disposed) return null;
      if (engine.done(c.state) || !(engine.pending(c.state) as number[]).includes(c.seat)) return false;
      let next: S;
      try {
        next = soloStep(engine, c.state, c.seat, a);
      } catch (e) {
        if (e instanceof EngineError) {
          host.toast(e.message);
          return false;
        }
        throw e;
      }
      clearTurn();
      if (c.duo) {
        // 바로 보여 주고, 상대에게 바로 알리고, 서버에는 뒤에서 차례로 보낸다
        const n = nOf(c.state);
        c.state = next;
        show(c, 'push', true);
        c.outbox.push({ n, a });
        try {
          host.api.cast?.({ r: c.round, n, seat: c.seat, a });
        } catch {
          /* 알림을 못 보내도 상대는 서버 공개 상태로 따라온다 */
        }
        void pump();
        kick();
        return true;
      }
      c.log.push({ n: nOf(c.state), a, h: print(c.state, c.seat) });
      c.state = next;
      writeLog();
      show(c, 'push', true);
      // 판이 끝났으면 바로 보낸다 (연출과 함께). 구경하는 사람(다음 판 예약)이 있으면 그때그때 보내 진행을 보여 준다
      if (engine.done(next) || host.get().seats.some((x) => x.pending_user_id)) void send();
      kick();
      return true;
    };

    /**
     * 서버가 내 행동만 받아서 갈 수 있는 가장 먼 진행 수: 지금 기기 상태에서 AI 차례를 마저 둔 데까지.
     * (서버는 내 목록을 적용한 뒤 AI 차례를 바로 이어 두지만, 기기는 연출이 끝나기를 기다렸다 둔다 → 서버가 잠깐 앞설 수 있다)
     */
    const reachN = (c: Cur) => {
      if (c.duo) return nOf(c.state);
      try {
        return nOf(runAi(c.state, c.seat));
      } catch {
        return nOf(c.state);
      }
    };
    /** 서버에 soloN 까지 저장돼 있다 (응답을 못 받은 전송이 저장된 것을 공개 상태로 알았다): 그만큼은 다시 보내지 않는다 */
    const saved = (c: Cur, soloN: number) => {
      if (soloN <= c.savedN) return;
      c.savedN = soloN;
      c.log = c.log.filter((e) => e.n >= c.savedN);
      writeLog();
    };
    /** 서버에 아직 없는 내 행동 */
    const unsent = (c: Cur) => c.log.filter((e) => e.n >= c.savedN);

    /** 서버에 보내기 (한 번에 하나씩). 끝난 판은 될 때까지 다시 보낸다 (간격을 늘려 가며) */
    const send = async () => {
      if (sending) {
        sendAgain = true;
        return;
      }
      sending = true;
      try {
        for (let attempt = 0; !disposed; ) {
          const c = cur;
          // (사람이 둘인 판은 행동을 하나씩 보낸다: 목록으로 한꺼번에 내지 않는다)
          if (!c || c.duo) return;
          const done = engine.done(c.state);
          const batch = unsent(c);
          if (!batch.length && !done) return;
          sendAgain = false;
          try {
            const res = await host.api.replay(withRules({ n: c.savedN, actions: batch.map((e) => e.a) }));
            if (cur !== c) return;
            if (typeof res?.n === 'number') {
              c.savedN = res.n;
              c.log = c.log.filter((e) => e.n >= c.savedN);
              writeLog();
            }
            if (res?.done) {
              // 결과는 서버가 공개한 상태가 실시간으로 온다. 혹시 안 오면 다시 읽는다
              const tick = (left: number) => {
                lateTimer = setTimeout(() => {
                  lateTimer = null;
                  if (cur !== c || disposed) return;
                  void host.reload();
                  if (left > 0) tick(left - 1);
                }, 3000);
              };
              tick(4);
              return;
            }
            // 기기에서는 끝난 판인데 서버는 아니라고 한다: 어긋났다 → 서버 상태로
            if (done) {
              void resync();
              return;
            }
            if (sendAgain) {
              attempt = 0;
              continue;
            }
            return;
          } catch (e) {
            if (cur !== c) return;
            const err = e as { code?: unknown; status?: unknown } | null;
            if (isRulesChanged(err)) {
              markOutdated();
              return;
            }
            if (isGone(err)) {
              // 서버에서는 이미 끝난 판 (30분 마감으로 대신 뒀거나, 내가 방에서 빠졌다): 서버 상태를 따른다
              drop();
              void host.reload();
              return;
            }
            if (String(err?.code ?? '').includes('out of sync') || err?.status === 400) {
              void resync();
              return;
            }
            // 통신 문제: 중간 저장은 다음 기회에, 끝난 판은 다시 보낸다
            if (!done) return;
            await sleep(Math.min(15_000, 1000 * 2 ** attempt++));
          }
        }
      } finally {
        sending = false;
      }
    };

    /** 서버 상태로 다시 맞춘다 (기기 진행을 버리고 sync → 보관한 행동 가운데 맞는 것만 이어 붙인다) */
    const resync = async () => {
      if (syncing || disposed || outdated) return;
      syncing = true;
      stop();
      try {
        const r = await syncOnce();
        if (!disposed) adopt(r.state, r.round, 'resync', !!r.duo);
      } catch (e) {
        if (isRulesChanged(e)) markOutdated();
        else if (isGone(e)) {
          drop();
          void host.reload();
        } else setTimeout(() => !disposed && cur && void resync(), 3000);
      } finally {
        syncing = false;
      }
    };

    /** 이 판을 기기에서 이어 둘 수 있게 전체 상태를 받아 온다 (판 시작 응답을 못 받았거나 새로고침한 경우) */
    const wantSync = (round: number, delay: number, tries = 0) => {
      // 첫 시도만 조작을 막는다. 다시 받아 보는 동안에는 서버 진행 그대로 둘 수 있다
      const hold = tries === 0;
      const end = () => {
        if (!hold) return;
        wanted = Math.max(0, wanted - 1);
        // 조작을 다시 켠다 (받았으면 adopt 가 이미 새 상태를 넣었다)
        if (!wanted && !disposed) host.refresh();
      };
      const go = () => {
        if (syncing || disposed || outdated || (cur && cur.round === round) || host.get().mySeat === null) return end();
        if (Date.now() - lastSyncTry < 1500) return end();
        lastSyncTry = Date.now();
        syncing = true;
        syncOnce().then(
          (r) => {
            syncing = false;
            if (!disposed && (!cur || cur.round !== r.round)) adopt(r.state, r.round, 'sync', !!r.duo);
            end();
          },
          (e) => {
            // 받지 못하면 (오류 · 5초 안에 답이 없음) 서버 진행 그대로 (행동은 하나씩 서버로 간다): 조작은 바로 풀고, 뒤에서 두 번 더 받아 본다
            syncing = false;
            if (isRulesChanged(e)) markOutdated();
            end();
            if (!isGone(e) && !outdated && tries < 2 && !disposed) setTimeout(() => !disposed && !cur && wantSync(round, 0, tries + 1), 2000);
          },
        );
      };
      if (hold) wanted++;
      if (delay > 0) setTimeout(go, delay);
      else go();
    };

    /** 지금 자리에 앉아 있는 사람 수 */
    const humansNow = () => host.get().seats.filter((x) => x.user_id && !x.left_game).length;
    let loneFor: Cur | null = null;
    /**
     * (사람이 둘인 판) 상대가 나갔다: 서버 상태를 받아 혼자 하는 판으로 넘어간다.
     * 서버는 이 sync 를 받으면 그 판의 마감을 혼자 하는 판처럼 길게 바꾼다 → 내 차례 시간은 여기서부터 기기에서 잰다 (arm)
     */
    const goLone = async (c: Cur) => {
      if (loneFor === c) return;
      loneFor = c;
      // 보내던 내 행동이 서버에 닿기를 잠깐 기다린다
      for (let i = 0; i < 60 && cur === c && c.outbox.length && !disposed; i++) await sleep(50);
      for (let k = 0; k < 5 && !disposed; k++) {
        if (cur !== c || !c.duo || humansNow() > 1) return;
        await resync();
        if (cur !== c) return;
        // 다른 sync 가 돌고 있었거나 받지 못했다: 잠깐 뒤 다시
        await sleep(800);
      }
    };

    const soloNOf = (s: StateRow | null) => {
      const n = s?.public_state?.soloN;
      return typeof n === 'number' ? n : null;
    };

    return {
      onStart(res) {
        const r = res as { round?: unknown; solo?: unknown; duo?: unknown } | null;
        if (r && typeof r.round === 'number' && r.solo) adopt(r.solo, r.round, 'start');
        // 사람이 둘인 판 (시작을 부른 사람만 이 응답을 받는다. 상대는 공개 상태를 보고 sync 로 받아 온다)
        else if (r && typeof r.round === 'number' && r.duo) adopt(r.duo, r.round, 'start', true);
      },

      filterState(s) {
        const soloN = soloNOf(s);
        const ended = !!s.public_state?.result;
        const c = cur;
        if (!c) {
          // 혼자 하는 판인데 아직 전체 상태가 없다 (판 시작 응답보다 공개 상태가 먼저 왔다 등): 잠깐 기다렸다가 받아 온다
          if (soloN !== null && !ended) wantSync(s.round_no, 700);
          return false;
        }
        if (s.round_no < c.round) return true;
        if (s.round_no > c.round || ended || soloN === null) {
          // 결과가 왔다 (또는 다음 판): 기기 진행은 끝, 서버 상태를 그대로 보여 준다
          drop();
          if (soloN !== null && !ended) wantSync(s.round_no, 700);
          return false;
        }
        if (c.duo) {
          // 사람이 둘인 판: 평소에는 이미 본 상태다 (내 행동의 되울림 · 알림으로 먼저 본 상대 행동) → 화면에 넣지 않는다.
          // 다만 같은 진행 수인데 내용이 다르면 내 예측이 틀린 것이다 (서버가 대신 뒀다 · 가짜 알림) → 서버 상태로
          const n = nOf(c.state);
          if (soloN <= n) {
            const mine = c.prints.get(soloN);
            if (mine !== undefined && mine !== pubPrint(s.public_state)) void resync();
            return true;
          }
          // 서버가 앞서 있다: 상대의 알림이 곧 오거나 이미 와 있으면 그것으로, 아니면 잠깐 뒤 서버 상태로
          c.serverN = Math.max(c.serverN, soloN);
          c.seen.set(soloN, pubPrint(s.public_state));
          if (c.seen.size > 60) c.seen.delete(c.seen.keys().next().value as number);
          lag(c);
          return true;
        }
        // 같은 판의 진행 중 상태: 내가 보낸 중간 저장이 되돌아온 것 → 화면을 되돌리지 않게 버린다 (기기 진행이 같거나 앞서 있다)
        if (sending) return true;
        if (soloN <= reachN(c)) {
          saved(c, soloN);
          return true;
        }
        // 서버가 내 행동만으로는 갈 수 없는 데까지 가 있다 (서버가 대신 뒀거나 다른 기기에서 뒀다): 서버 상태로
        void resync();
        return true;
      },

      filterPrivate(p) {
        return !!cur && p.round_no <= cur.round;
      },

      onReload({ room, state }) {
        const soloN = soloNOf(state);
        const ended = !!state?.public_state?.result;
        const c = cur;
        if (!c) {
          if (room?.status === 'playing' && state && soloN !== null && !ended) wantSync(state.round_no, 0);
          return null;
        }
        if (!room || !state || state.round_no !== c.round || ended || soloN === null || (room.status !== 'playing' && !engine.done(c.state))) {
          drop();
          if (room?.status === 'playing' && state && soloN !== null && !ended) wantSync(state.round_no, 0);
          return null;
        }
        if (c.duo) {
          // 서버가 앞서 있으면 알림을 잠깐 기다려 보고 맞춘다 (화면은 그동안 기기 진행 그대로)
          if (soloN > nOf(c.state)) {
            c.serverN = Math.max(c.serverN, soloN);
            lag(c);
          }
          return { state: c.row, priv: c.priv };
        }
        if (!sending) {
          if (soloN > reachN(c)) {
            void resync();
            return null;
          }
          saved(c, soloN);
        }
        return { state: c.row, priv: c.priv };
      },

      act(payload) {
        return apply(payload as A);
      },

      onCast(msg) {
        const c = cur;
        const m = msg as { r?: unknown; n?: unknown; seat?: unknown; a?: unknown } | null;
        if (!c || !c.duo || disposed || !m || typeof m !== 'object') return;
        if (m.r !== c.round || !Number.isInteger(m.n) || !Number.isInteger(m.seat) || !m.a || typeof m.a !== 'object' || Array.isArray(m.a)) return;
        const n = m.n as number;
        // 이미 지난 것 · 터무니없이 앞선 것 · 내 자리라고 우기는 것은 버린다
        if (m.seat === c.seat || n < nOf(c.state) || n > nOf(c.state) + 40 || c.inbox.has(n)) return;
        c.inbox.set(n, { seat: m.seat as number, a: m.a });
        kick();
      },

      async flush(kind) {
        const c = cur;
        if (!c) return;
        if (c.duo) {
          // 사람이 둘인 판: 행동은 이미 하나씩 보내고 있다. 나갈 때는 보내던 것이 끝나기를 잠깐 기다린다
          if (kind === 'pagehide') return;
          for (let i = 0; i < 60 && cur === c && c.outbox.length && pumping; i++) await sleep(50);
          if (cur === c) drop();
          return;
        }
        const batch = unsent(c);
        const payload: ReplayPayload = withRules({ n: c.savedN, actions: batch.map((e) => e.a) });
        if (kind === 'pagehide') {
          // 페이지가 살아 돌아올 수도 있으니 기기 진행은 그대로 둔다
          if (batch.length) host.api.replayOnExit(payload);
          return;
        }
        // 나가기: 그때까지를 서버에 맞춰 두면 서버 AI 가 거기서 이어 둔다
        stop();
        // 중간 저장을 보내는 중이면 잠깐 기다렸다가 그 뒤에 남은 것을 보낸다 (그냥 버리면 마지막 행동을 서버 AI 가 대신 둔다)
        for (let i = 0; i < 40 && cur === c && sending; i++) await sleep(100);
        if (cur !== c) return;
        const rest = unsent(c);
        if (rest.length && !sending) {
          try {
            await Promise.race([host.api.replay(withRules({ n: c.savedN, actions: rest.map((e) => e.a) })), sleep(4000)]);
          } catch {
            /* 실패해도 나간다 (서버에 저장된 데서부터 AI 가 이어 둔다) */
          }
        }
        drop();
      },

      onSeats() {
        const c = cur;
        if (!c || !c.duo || disposed || humansNow() > 1) return;
        void goLone(c);
      },

      notice() {
        if (outdated) return RULES_CHANGED;
        return cur && engine.done(cur.state) ? '결과를 저장하는 중…' : null;
      },

      waiting() {
        return wanted > 0 && !cur && !outdated;
      },

      dispose() {
        disposed = true;
        stop();
      },
    };
  };
}
