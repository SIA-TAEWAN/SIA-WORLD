import type { MatchResult, MatchSetup, RecordOutcome } from '../match/game';
import type { SaveResult, VolleyApi } from './api';

/**
 * 내 보고가 먼저라 '기다리는 중'이면, 이 간격으로 확정됐는지 물어본다 (합 12초).
 * 상대 보고가 오면 바로 확정돼 있고, 끝내 안 오면(상대가 나가 버림) 서버가 10초 뒤부터 내 보고 하나로 확정해 준다.
 */
export const SETTLE_WAITS_MS = [1500, 2500, 8000] as const;
export const SETTLE_AFTER_MS = SETTLE_WAITS_MS.reduce((a, b) => a + b, 0);
/** 서버는 경기 시작(live) 뒤 15초 안의 보고를 받지 않는다 ('too early'): 그 시간이 지난 뒤에 다시 보고한다 */
export const MIN_MATCH_MS = 15000;
/** 다시 보고할 때 두는 여유 (ms) */
export const EARLY_MARGIN_MS = 700;
/** 시작 알림이 아직 live가 아니면 이만큼 뒤에 한 번 더 부른다 (누가 내 자리에 끼어든 경우를 바로잡는다) */
export const BEGIN_RETRY_MS = 2500;
/** 확정을 기다리는 경기를 기억해 두는 시간 (서버는 30분이 지난 경기를 받지 않는다) */
export const PENDING_KEEP_MS = 40 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 어떤 결과를 서버에 보고할지 정한다 (순수 함수).
 * - 정상 종료: 두 사람 모두 같은 점수를 보고한다 (점수는 방장 스냅샷 값).
 * - 이탈: 남아서 AI와 끝까지 한 사람만 'leave'로 최종 점수를 보고한다 (이겼든 졌든). 나간 사람은 보고하지 않는다.
 *   서버는 나간 사람을 항상 패, 남은 사람을 AI와의 결과대로 승 또는 패로 기록한다.
 */
export function reportFor(result: Pick<MatchResult, 'score' | 'winner' | 'reason' | 'leaver'>, mySide: 0 | 1): { left: number; right: number; reason: 'normal' | 'leave' } | null {
  if (result.reason === 'leave') {
    if (result.leaver === undefined || result.leaver === mySide) return null;
    return { left: result.score[0], right: result.score[1], reason: 'leave' };
  }
  return { left: result.score[0], right: result.score[1], reason: 'normal' };
}

/**
 * AI가 이어받은 경기에서 남은 나까지 나갈 때의 결과 (몰수패): AI 쪽 3점, 내 점수는 지금 값(최대 2점).
 * 이것을 'leave'로 보고해야 이 경기가 기록된다 (나간 상대도 패, 나도 패).
 */
export function forfeitResult(setup: MatchSetup, score: readonly [number, number]): MatchResult {
  const me = setup.mySide;
  const ai = me === 0 ? 1 : 0;
  const s: [number, number] = [0, 0];
  s[me] = Math.max(0, Math.min(2, Math.floor(score[me]) || 0));
  s[ai] = 3;
  return { setup, score: s, winner: ai, reason: 'leave', leaver: ai };
}

// ---------- 확정을 기다리는 경기 (페이지를 떠나도 다음에 확정할 수 있게 적어 둔다) ----------

export interface PendingEntry {
  id: string;
  at: number;
}
export interface PendingStore {
  load(): PendingEntry[];
  save(list: PendingEntry[]): void;
}

/** 브라우저 저장소(localStorage)에 사용자별로 적어 둔다 */
export function pendingStore(uid: string): PendingStore {
  const key = `siavolley:pending:${uid}`;
  return {
    load() {
      try {
        const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
        if (!Array.isArray(v)) return [];
        return v.filter((e): e is PendingEntry => !!e && typeof (e as PendingEntry).id === 'string' && Number.isFinite((e as PendingEntry).at)).slice(-20);
      } catch {
        return [];
      }
    },
    save(list) {
      try {
        if (list.length) localStorage.setItem(key, JSON.stringify(list.slice(-20)));
        else localStorage.removeItem(key);
      } catch {
        /* 저장 못 해도 계속 */
      }
    },
  };
}

function addPending(store: PendingStore | null, id: string, now: number) {
  if (!store) return;
  const list = store.load().filter((e) => e.id !== id);
  list.push({ id, at: now });
  store.save(list);
}
function removePending(store: PendingStore | null, id: string) {
  if (!store) return;
  const list = store.load();
  if (list.some((e) => e.id === id)) store.save(list.filter((e) => e.id !== id));
}

/**
 * 지난번에 확정하지 못하고 떠난 경기를 확정한다 (로비에 들어올 때 한 번).
 * 내 보고 하나만 올라가 있고 10초가 지났으면 서버가 그 보고로 확정해 준다. → 이번에 확정(또는 무효)된 경기 수
 */
export async function settlePending(api: VolleyApi, store: PendingStore, now = Date.now()): Promise<number> {
  if (api.kind === 'local') return 0;
  const list = store.load().filter((e) => now - e.at < PENDING_KEEP_MS);
  let settled = 0;
  const keep: PendingEntry[] = [];
  for (const e of list) {
    let r: SaveResult;
    try {
      r = await api.settle(e.id);
    } catch {
      keep.push(e);
      continue;
    }
    if (r.status === 'done' || r.status === 'void') settled++;
    // 아직 기다리는 중이거나 통신이 안 된 것만 다음에 다시 (서버가 거절한 것은 지운다)
    else if (r.status === 'waiting' || !r.code) keep.push(e);
  }
  store.save(keep);
  return settled;
}

export interface RecorderOptions {
  /** 지금 시각 (ms). 테스트에서 바꿔 끼운다 */
  now?: () => number;
  /** 확정을 기다리는 경기를 적어 둘 곳 (없으면 적지 않는다) */
  store?: PendingStore | null;
}

/**
 * 온라인 한 경기의 결과 저장 (양쪽 보고 일치 방식, supabase/migrations/034_volleyball.sql).
 * 경기 시작 때 만들면 서버에 시작을 알리고(begin), 끝나면 finish()가 보고(report)하고 필요하면 확정(settle)을 부른다.
 * 실패해도 경기 화면은 그대로 진행한다 (결과 화면에 '기록을 올리지 못했어요'만).
 */
export class MatchRecorder {
  private matchId: Promise<string | null>;
  private now: () => number;
  private store: PendingStore | null;
  /** 서버가 '같은 상대와 하루 30판'을 채웠다고 거절했는가 */
  private limit = false;
  /** 서버가 경기를 시작(live)으로 본 시각 (대략: begin 답을 받은 때) */
  private liveAt = 0;

  constructor(
    private api: VolleyApi,
    room: string,
    private setup: MatchSetup,
    opts: RecorderOptions = {},
  ) {
    const now = opts.now ?? (() => Date.now());
    this.now = now;
    this.store = opts.store ?? null;
    const me = setup.mySide;
    const opp = setup.fighters[me === 0 ? 1 : 0];
    const no = setup.matchNo ?? 0;
    this.matchId =
      api.kind === 'local' || !opp.id
        ? Promise.resolve(null)
        : (async () => {
            const call = () => api.begin(room, no, me, opp.id!, setup.fighters[me].char);
            let r = await call();
            if (r && 'match' in r && !r.live) {
              await sleep(BEGIN_RETRY_MS);
              const again = await call();
              if (again && 'match' in again) r = again;
            }
            this.liveAt = now();
            if (r && 'error' in r) {
              if (/daily limit/.test(r.error)) this.limit = true;
              return null;
            }
            return r?.match ?? null;
          })().catch(() => null);
  }

  async finish(result: MatchResult): Promise<RecordOutcome> {
    const api = this.api;
    if (api.kind === 'local') return { state: 'none' };
    try {
      const rep = reportFor(result, this.setup.mySide);
      const id = await this.matchId;
      if (this.limit) return { state: 'limit' };
      if (!id) return { state: rep ? 'failed' : 'left' };
      // 내가 나간(끊긴) 경기: 보고하지 않는다. 남은 사람의 보고로 나는 패배로 기록된다
      if (!rep) return { state: 'left' };
      let r: SaveResult = await api.report(id, rep.left, rep.right, rep.reason);
      // 너무 빨리 끝난 경기: 서버가 받아 주는 시각(live 뒤 15초)이 지난 다음에 다시 보고한다
      for (let i = 0; i < 2 && r.status === 'error' && /too early/.test(r.code ?? ''); i++) {
        await sleep(Math.max(1000, this.liveAt + MIN_MATCH_MS + EARLY_MARGIN_MS - this.now()));
        r = await api.report(id, rep.left, rep.right, rep.reason);
      }
      // 여기서 페이지를 떠나도 다음에 확정할 수 있게 적어 둔다
      if (r.status === 'waiting') addPending(this.store, id, this.now());
      // 상대 보고를 기다린다. 끝내 안 오면(이탈 경기는 언제나) 내 보고 하나로 확정
      for (const ms of SETTLE_WAITS_MS) {
        if (r.status !== 'waiting') break;
        await sleep(ms);
        r = await api.settle(id);
      }
      if (r.status === 'done' || r.status === 'void') removePending(this.store, id);
      if (r.status === 'done') return { state: 'saved', wins: r.wins, losses: r.losses };
      if (r.status === 'void') return { state: 'void', ...(await api.myRecord().catch(() => null)) };
      return { state: 'failed' };
    } catch {
      return { state: 'failed' };
    }
  }
}
