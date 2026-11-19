/**
 * AI 대전 한 경기의 전적 기록 (supabase/migrations/056_ai_matches.sql 의 ai_match_start · ai_match_finish).
 * 경기를 시작할 때 서버에 알리고, 끝나면 승패를 올린다. 서버는 시작~종료 시간이 최소 시간(15초) 이상인 경기만 받는다.
 * 사람끼리의 경기(net/record.ts, 양쪽 보고 일치)와는 따로다. 시아탱크 games/tank/src/net/aiRecord.ts 와 같은 모양.
 * 도중에 나간 판(leave): 나가는 순간 최소 시간이 지났으면 패배로 올리고, 아니면 서버에서 지운다.
 * 창을 그냥 닫아 아무것도 올리지 않은 판은 서버가 다음 시작 때 패배(최소 시간 전이면 버림)로 마감한다.
 * 그래서 끝난 판의 결과를 통신 실패로 못 올렸으면 기기에 맡겨 두었다가(PendingStore) 다음 판 시작 전에 먼저 다시 올린다.
 * 다시 올리기가 통신 실패면 맡겨 둔 채 새 판은 서버에 알리지 않는다 (기록되지 않는 판).
 * 화면·브라우저를 모르는 순수 모듈 (서버 호출은 AiRpc 로, 기기 저장은 PendingStore 로 받는다).
 */
/** ai_match_finish 의 답 */
export interface AiFinish {
  /** 전적에 반영했는가 (false: 하루 한도를 넘긴 판) */
  counted: boolean;
  /** 시아코인을 받았는가 */
  coin: boolean;
  wins: number;
  losses: number;
  /** 하루에 반영되는 AI 판 수 */
  perDay: number;
}

/** ai_match_cancel 의 답: cancelled 지웠다 · kept 최소 시간이 지나 서버가 그대로 둔다(다음 시작 때 패배) · none 지울 판이 없다 */
export type CancelStatus = 'cancelled' | 'kept' | 'none';

/** 서버 함수. 실패하면 예외 (message: 서버가 알려 준 까닭) */
export interface AiRpc {
  /** 판 시작 → 판 번호, 이 시간(초)이 지나야 종료를 받는다 (이 시간이 지난 뒤 버려진 판은 패배) */
  start(): Promise<{ id: string; minSec: number }>;
  finish(id: string, won: boolean): Promise<AiFinish>;
  /** 최소 시간 전에 나간 판을 지운다 (ai_match_cancel) */
  cancel(id: string): Promise<CancelStatus>;
  /** 무승부로 끝난 판을 기록 없이 마감한다 (ai_match_draw · 058). 무승부가 없는 게임은 두지 않는다 */
  draw?(id: string): Promise<void>;
}

/** 올리지 못한 결과 한 건 (won null: 무승부) */
export interface PendingResult {
  id: string;
  won: boolean | null;
}

/** 올리지 못한 결과를 기기에 맡겨 두는 곳 (게임별 한 칸) */
export interface PendingStore {
  get(): PendingResult | null;
  set(v: PendingResult | null): void;
}

/** localStorage 한 칸. 쓸 수 없는 브라우저(사생활 보호 등)에서는 아무것도 하지 않는다 */
export function localPending(key: string): PendingStore {
  const ls = () => (globalThis as { localStorage?: Storage }).localStorage;
  return {
    get() {
      try {
        const raw = ls()?.getItem(key);
        if (!raw) return null;
        const v = JSON.parse(raw) as Partial<PendingResult> | null;
        return v && typeof v.id === 'string' && (typeof v.won === 'boolean' || v.won === null) ? { id: v.id, won: v.won } : null;
      } catch {
        return null;
      }
    },
    set(v) {
      try {
        if (v) ls()?.setItem(key, JSON.stringify(v));
        else ls()?.removeItem(key);
      } catch {
        /* 저장하지 못해도 판은 그대로 */
      }
    },
  };
}

/**
 * saved 전적에 반영됨 · limit 하루 한도를 넘겨 반영 안 됨 · draw 무승부로 마감(기록 없음) · failed 올리지 못함
 * · unrecorded 앞 판 결과를 아직 올리지 못해 이 판은 서버에 알리지 않았다 · none 올릴 것이 없음(테스트 모드)
 */
export type AiOutcome =
  | { state: 'saved'; coin: boolean; wins: number; losses: number }
  | { state: 'limit'; perDay: number; wins: number; losses: number }
  | { state: 'draw' }
  | { state: 'failed' }
  | { state: 'unrecorded' }
  | { state: 'none' };

export interface AiRecorderOptions {
  now?: () => number;
  /** 올리지 못한 결과를 맡겨 둘 곳 (없으면 맡기지 않는다) */
  store?: PendingStore;
  sleep?: (ms: number) => Promise<void>;
}

/** 서버 시계와 어긋날 것을 생각한 여유 */
export const EARLY_MARGIN_MS = 700;
/** 그래도 'too early' 면 이만큼 뒤에 다시 (두 번까지) */
export const EARLY_RETRY_MS = 2000;

/** 서버가 그 결과를 다시는 받지 않는다는 거절인가 (이미 마감된 판·없는 판·너무 오래된 판). 통신 실패 등은 아니다 */
export function rejected(e: unknown): boolean {
  return /already finished|no match|too late|no draw|bad result/.test(String((e as Error)?.message ?? e));
}

/** 서버 요청은 한 번에 하나씩, 순서대로 (앞 판의 종료가 올라간 다음에 새 판의 시작을 알린다. 절대 reject 하지 않는다) */
let busy: Promise<unknown> = Promise.resolve();

type Started = { id: string; okAt: number } | 'none' | 'blocked' | null;

export class AiMatchRecorder {
  /** 'blocked': 앞 판 결과를 통신 실패로 다시 올리지 못해 이 판의 시작을 알리지 않았다 (기록되지 않는 판) */
  private started: Promise<Started>;
  /** 시작 답을 받은 뒤: 이 시각부터 나가면 패배 (요청을 보낸 시각부터 센다 — 서버가 적은 시작 시각보다 이르므로 경고가 늦지 않다) */
  private lossAt: number | null = null;
  private done: Promise<AiOutcome> | null = null;
  private store: PendingStore | null;
  private rpc: Promise<AiRpc | null>;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  /** rpc: null 이면 테스트 모드(서버를 부르지 않는다) */
  constructor(rpc: Promise<AiRpc | null> | AiRpc | null, opts: AiRecorderOptions = {}) {
    const now = (this.now = opts.now ?? (() => Date.now()));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const store = (this.store = opts.store ?? null);
    const prev = busy;
    // 연결하지 못했으면(reject) 그 판은 기록 실패로 끝난다
    const conn = (this.rpc = Promise.resolve(rpc));
    conn.catch(() => undefined);
    this.started = (async (): Promise<Started> => {
      await prev;
      const api = await conn;
      if (!api) return 'none';
      // 앞 판에서 못 올린 결과를 먼저 올린다 (새 판을 시작하면 서버가 그 판을 패배로 마감하므로).
      // 서버가 거절(이미 마감된 판 등)하면 버리고 새 판. 통신 실패면 맡겨 둔 채로 두고, 이 판은 서버에 알리지 않는다
      // (알리면 서버가 앞 판을 패배로 마감해 이긴 판이 패배로 바뀔 수 있다)
      const left = store?.get();
      if (left) {
        try {
          if (left.won === null) {
            if (!api.draw) throw new Error('no draw');
            await api.draw(left.id);
          } else await api.finish(left.id, left.won);
          store!.set(null);
        } catch (e) {
          if (!rejected(e)) return 'blocked';
          store!.set(null);
        }
      }
      const sentAt = now();
      const r = await api.start();
      this.lossAt = sentAt + r.minSec * 1000;
      // 답을 받은 시각부터 센다 (서버가 적은 시작 시각보다 늦으므로 안전한 쪽)
      return { id: r.id, okAt: now() + r.minSec * 1000 + EARLY_MARGIN_MS };
    })().catch(() => null);
    busy = this.started;
  }

  /** 승패가 난 판의 결과를 올린다 (여러 번 불러도 한 번만). 예외를 던지지 않는다 */
  finish(won: boolean): Promise<AiOutcome> {
    return this.once(() => this.send(won));
  }

  /** 무승부로 끝난 판을 기록 없이 마감한다 (안 하면 다음 시작 때 서버가 패배로 마감한다). 예외를 던지지 않는다 */
  draw(): Promise<AiOutcome> {
    return this.once(() => this.sendDraw());
  }

  /** 지금 나가면 패배로 기록되는 판인가 (시작을 알렸고, 아직 끝나지 않았고, 최소 시간이 지났다) */
  forfeitable(): boolean {
    return !this.done && this.lossAt !== null && this.now() >= this.lossAt;
  }

  /**
   * 판 도중에 나간다. 부르는 순간 forfeitable() 이면 패배로 올리고, 아니면 서버에서 판을 지운다 (기록 없음).
   * 화면은 나가기를 확정하는 순간의 forfeitable() 로 안내를 맞춰야 한다 (확인 창을 오래 띄워 둔 사이 바뀔 수 있다).
   * 지우려 했는데 서버가 이미 최소 시간이 지났다고(kept) 하면 패배로 올린다 (그냥 두어도 다음 시작 때 패배가 되므로, 지금 맞춘다).
   * 기다리지 않아도 된다. 예외를 던지지 않는다
   */
  leave(): Promise<AiOutcome> {
    if (this.forfeitable()) return this.finish(false);
    return this.once(async (): Promise<AiOutcome> => {
      const s = await this.started;
      if (s === 'blocked') return { state: 'unrecorded' };
      const api = await this.rpc.catch(() => null);
      if (s && s !== 'none' && api) {
        if ((await api.cancel(s.id)) === 'kept') return this.send(false);
      }
      return { state: 'none' };
    });
  }

  private once(run: () => Promise<AiOutcome>): Promise<AiOutcome> {
    if (!this.done) {
      this.done = run().catch((): AiOutcome => ({ state: 'failed' }));
      busy = this.done;
    }
    return this.done;
  }

  private async send(won: boolean): Promise<AiOutcome> {
    const s = await this.started;
    if (s === 'none') return { state: 'none' };
    if (s === 'blocked') return { state: 'unrecorded' };
    const api = await this.rpc;
    if (!s || !api) return { state: 'failed' };
    // 올리기 전에 기기에 맡겨 둔다 (기다리는 사이 창을 닫거나 통신이 끊겨도 다음 판 시작 전에 다시 올린다)
    this.store?.set({ id: s.id, won });
    // 너무 빨리 끝난 판: 서버가 받아 주는 시각까지 기다렸다가 올린다
    const wait = s.okAt - this.now();
    if (wait > 0) await this.sleep(wait);
    let r: AiFinish;
    for (let i = 0; ; i++) {
      try {
        r = await api.finish(s.id, won);
        break;
      } catch (e) {
        if (i >= 2 || !/too early/.test(String((e as Error)?.message ?? e))) return { state: 'failed' };
        await this.sleep(EARLY_RETRY_MS);
      }
    }
    this.store?.set(null);
    if (!r.counted) return { state: 'limit', perDay: r.perDay, wins: r.wins, losses: r.losses };
    return { state: 'saved', coin: r.coin, wins: r.wins, losses: r.losses };
  }

  private async sendDraw(): Promise<AiOutcome> {
    const s = await this.started;
    if (s === 'none') return { state: 'none' };
    if (s === 'blocked') return { state: 'unrecorded' };
    const api = await this.rpc;
    if (!s || !api?.draw) return { state: 'failed' };
    // 못 올리면 다음 판 시작 전에 다시 알린다
    this.store?.set({ id: s.id, won: null });
    await api.draw(s.id);
    this.store?.set(null);
    return { state: 'draw' };
  }
}

/** 서버 답(jsonb)을 읽는다. 모양이 다르면 예외 */
export function parseStart(data: unknown): { id: string; minSec: number } {
  const d = data as { id?: unknown; min_sec?: unknown } | null;
  if (!d || typeof d.id !== 'string') throw new Error('bad answer');
  const n = Number(d.min_sec);
  return { id: d.id, minSec: Number.isFinite(n) && n >= 0 ? n : 0 };
}
export function parseFinish(data: unknown): AiFinish {
  const d = data as { status?: unknown; counted?: unknown; coin?: unknown; wins?: unknown; losses?: unknown; per_day?: unknown } | null;
  if (!d || d.status !== 'done') throw new Error('bad answer');
  return { counted: d.counted === true, coin: d.coin === true, wins: Number(d.wins) || 0, losses: Number(d.losses) || 0, perDay: Number(d.per_day) || 0 };
}
export function parseCancel(data: unknown): CancelStatus {
  const s = (data as { status?: unknown } | null)?.status;
  if (s !== 'cancelled' && s !== 'kept' && s !== 'none') throw new Error('bad answer');
  return s;
}
export function parseDraw(data: unknown): void {
  if ((data as { status?: unknown } | null)?.status !== 'draw') throw new Error('bad answer');
}

/** 결과 화면에 보일 한 줄 */
export function outcomeText(o: AiOutcome): string {
  if (o.state === 'saved') return `🏅 전적 +1${o.coin ? ' · 시아코인 +1' : ' · 시아코인은 이번엔 없어요'} · 내 전적 ${o.wins}승 ${o.losses}패`;
  if (o.state === 'limit') return `오늘은 AI 대전 ${o.perDay}판을 채워서 전적·시아코인에 반영되지 않았어요`;
  if (o.state === 'draw') return '무승부는 전적에 기록되지 않아요';
  if (o.state === 'failed') return '전적을 기록하지 못했어요';
  if (o.state === 'unrecorded') return '앞 판 결과를 아직 서버에 올리지 못해 이 판은 기록되지 않아요 · 인터넷 연결을 확인해 주세요';
  return '테스트 모드라 기록되지 않아요';
}
