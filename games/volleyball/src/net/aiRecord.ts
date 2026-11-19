/**
 * AI 대전 한 경기의 전적 기록 (supabase/migrations/056_ai_matches.sql 의 ai_match_start · ai_match_finish).
 * 경기를 시작할 때 서버에 알리고, 끝나면 승패를 올린다. 서버는 시작~종료 시간이 최소 시간(15초) 이상인 경기만 받는다.
 * 사람끼리의 경기(net/record.ts, 양쪽 보고 일치)와는 따로다. 시아탱크 games/tank/src/net/aiRecord.ts 와 같은 모양.
 * 화면·브라우저를 모르는 순수 모듈 (서버 호출은 AiRpc 로 받는다).
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

/** 서버 함수 두 개. 실패하면 예외 (message: 서버가 알려 준 까닭) */
export interface AiRpc {
  /** 판 시작 → 판 번호, 이 시간(초)이 지나야 종료를 받는다 */
  start(): Promise<{ id: string; minSec: number }>;
  finish(id: string, won: boolean): Promise<AiFinish>;
}

/**
 * saved 전적에 반영됨 · limit 하루 한도를 넘겨 반영 안 됨 · failed 올리지 못함 · none 올릴 것이 없음(테스트 모드)
 */
export type AiOutcome =
  | { state: 'saved'; coin: boolean; wins: number; losses: number }
  | { state: 'limit'; perDay: number; wins: number; losses: number }
  | { state: 'failed' }
  | { state: 'none' };

export interface AiRecorderOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** 서버 시계와 어긋날 것을 생각한 여유 */
export const EARLY_MARGIN_MS = 700;
/** 그래도 'too early' 면 이만큼 뒤에 다시 (두 번까지) */
export const EARLY_RETRY_MS = 2000;

/** 서버 요청은 한 번에 하나씩, 순서대로 (앞 판의 종료가 올라간 다음에 새 판의 시작을 알린다. 절대 reject 하지 않는다) */
let busy: Promise<unknown> = Promise.resolve();

export class AiMatchRecorder {
  private started: Promise<{ id: string; okAt: number } | 'none' | null>;
  private done: Promise<AiOutcome> | null = null;
  private rpc: Promise<AiRpc | null>;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  /** rpc: null 이면 테스트 모드(서버를 부르지 않는다) */
  constructor(rpc: Promise<AiRpc | null> | AiRpc | null, opts: AiRecorderOptions = {}) {
    const now = (this.now = opts.now ?? (() => Date.now()));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const prev = busy;
    // 연결하지 못했으면(reject) 그 판은 기록 실패로 끝난다
    const conn = (this.rpc = Promise.resolve(rpc));
    conn.catch(() => undefined);
    this.started = (async () => {
      await prev;
      const api = await conn;
      if (!api) return 'none' as const;
      const r = await api.start();
      // 답을 받은 시각부터 센다 (서버가 적은 시작 시각보다 늦으므로 안전한 쪽)
      return { id: r.id, okAt: now() + r.minSec * 1000 + EARLY_MARGIN_MS };
    })().catch(() => null);
    busy = this.started;
  }

  /** 승패가 난 판의 결과를 올린다 (여러 번 불러도 한 번만). 예외를 던지지 않는다 */
  finish(won: boolean): Promise<AiOutcome> {
    if (!this.done) {
      this.done = this.send(won).catch((): AiOutcome => ({ state: 'failed' }));
      busy = this.done;
    }
    return this.done;
  }

  private async send(won: boolean): Promise<AiOutcome> {
    const s = await this.started;
    if (s === 'none') return { state: 'none' };
    const api = await this.rpc;
    if (!s || !api) return { state: 'failed' };
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
    if (!r.counted) return { state: 'limit', perDay: r.perDay, wins: r.wins, losses: r.losses };
    return { state: 'saved', coin: r.coin, wins: r.wins, losses: r.losses };
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

/** 결과 화면에 보일 한 줄 */
export function outcomeText(o: AiOutcome): string {
  if (o.state === 'saved') return `🏅 전적 +1${o.coin ? ' · 시아코인 +1' : ' · 시아코인은 이번엔 없어요'} · 내 전적 ${o.wins}승 ${o.losses}패`;
  if (o.state === 'limit') return `오늘은 AI 대전 ${o.perDay}판을 채워서 전적·시아코인에 반영되지 않았어요`;
  if (o.state === 'failed') return '전적을 기록하지 못했어요';
  return '테스트 모드라 기록되지 않아요';
}
