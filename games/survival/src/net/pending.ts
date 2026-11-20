import type { RunReport } from '../game/progress';

/**
 * 못 올린 판 결과의 임시 보관 (PRD 11장: 실패하면 기기에 임시 보관 후 다음 접속 때 재전송).
 * 결과는 보내기 전에 먼저 보관하고, 서버가 받았거나 거절했을 때 지운다 (보내는 도중에 창이 닫혀도 남는다.
 * 같은 판이 두 번 올라가는 것은 서버가 'already finished' 로 막는다).
 * 보관하는 곳(localStorage)과 보내는 함수를 바깥에서 받아서, 화면 없이 시험할 수 있다.
 */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 한 번 보낸 결과: ok 받았다 · rejected 서버가 거절했다(다시 보내도 소용없다) · failed 통신 실패(나중에 다시) */
export type SendOutcome = 'ok' | 'rejected' | 'failed';

/** 보관해 두는 최대 판 수 (넘으면 오래된 것부터 버린다). 판 도중 결과(partial)는 끝난 판 결과를 밀어내지 않는다 (trim) */
export const PENDING_MAX = 5;

/**
 * 판 도중에 보관한 결과(stash)가 아직 살아 있는 판일 수 있다고 보는 시간.
 * 다른 탭이 숨으며 남긴 중간 결과는 그 탭에서 판이 이어지고 있을 수 있다 → 이 시간 동안은 다른 탭이 보내지 않는다
 * (무한 모드 최대 20분 + 쉬는 시간. 숨을 때마다 새로 적으므로 이어지는 판은 계속 젊다)
 */
export const PARTIAL_LIVE_MS = 30 * 60_000;

/** 보관된 결과 하나. partial: 판 도중에 보관한 중간 결과 · tab: 그것을 남긴 탭 · at: 남긴 시각(ms) */
export type PendingEntry = RunReport & { partial?: true; tab?: string; at?: number };

const key = (uid: string) => `siasurvival:pending:${uid}`;

function isReport(v: unknown): v is PendingEntry {
  const r = v as RunReport;
  return !!r && typeof r.run === 'string' && typeof r.map === 'string' && typeof r.character === 'string' && Number.isFinite(r.time) && Number.isFinite(r.kills);
}

export function readPending(store: Store, uid: string): PendingEntry[] {
  try {
    const list = JSON.parse(store.getItem(key(uid)) ?? '[]');
    return Array.isArray(list) ? list.filter(isReport) : [];
  } catch {
    return [];
  }
}

/**
 * 끝난 판 결과는 최근 PENDING_MAX 판까지. 중간 결과는 남는 자리에만 (자리가 없어도 가장 최근 것 하나는 따로 둔다).
 * → 숨을 때마다 생기는 중간 결과가 못 올린 끝 결과를 밀어내지 않는다
 */
function trim(list: PendingEntry[]): PendingEntry[] {
  const finals = list.filter((r) => !r.partial).slice(-PENDING_MAX);
  const partials = list.filter((r) => r.partial).slice(-Math.max(1, PENDING_MAX - finals.length));
  const keep = new Set([...finals, ...partials]);
  return list.filter((r) => keep.has(r));
}

function writePending(store: Store, uid: string, list: PendingEntry[]) {
  try {
    if (list.length === 0) store.removeItem(key(uid));
    else store.setItem(key(uid), JSON.stringify(trim(list)));
  } catch {
    /* 저장하지 못해도 게임은 계속 */
  }
}

/**
 * 결과를 보관한다 (같은 판은 한 번만: 나중 것이 앞의 것을 덮어쓴다).
 * partial 을 주면 판 도중의 중간 결과로 적는다 (어느 탭이 언제 남겼는지와 함께). 끝 결과는 partial 없이 → 중간 결과를 덮어쓴다
 */
export function keepPending(store: Store, uid: string, report: RunReport, partial?: { tab: string; at: number }) {
  const list = readPending(store, uid).filter((r) => r.run !== report.run);
  const { partial: _p, tab: _t, at: _a, ...plain } = report as PendingEntry;
  list.push(partial ? { ...plain, partial: true, tab: partial.tab, at: partial.at } : plain);
  writePending(store, uid, list);
}

/** 그 판을 지운다. only 를 주면 보관된 것이 그것과 똑같을 때만 (보내는 사이에 다른 탭이 끝 결과로 덮어썼으면 남긴다) */
export function dropPending(store: Store, uid: string, run: string, only?: PendingEntry) {
  const list = readPending(store, uid);
  const same = (r: PendingEntry) => !only || JSON.stringify(r) === JSON.stringify(only);
  writePending(store, uid, list.filter((r) => r.run !== run || !same(r)));
}

/**
 * 이 보관분이 아직 어느 탭에서 이어지고 있는 판일 수 있는가 (그러면 다시 보내지 않는다).
 *   held: 지금 잡혀 있는 판 잠금(navigator.locks)의 판 id 들. 알 수 있으면 그것만 본다 (잠금은 판이 끝나거나 탭이 닫히면 풀린다)
 *   held 를 모르면(잠금을 못 쓰는 브라우저): 다른 탭이 남긴 중간 결과는 PARTIAL_LIVE_MS 동안 살아 있다고 본다
 */
export function mayBeLive(e: PendingEntry, tab: string, now: number, held: ReadonlySet<string> | null): boolean {
  if (held) return held.has(e.run);
  return !!e.partial && e.tab !== tab && now - (Number(e.at) || 0) < PARTIAL_LIVE_MS;
}

/**
 * 보관해 둔 결과를 다시 보낸다. 받았거나 서버가 거절한 것은 지우고, 통신 실패만 남긴다.
 * skip: 지금 다른 곳에서 보내는 중이거나 아직 이어지는 판은 건너뛴다 (같은 판을 두 번 보내지 않게).
 * 보내기 직전에 보관된 값을 다시 읽는다 (그 사이 다른 탭이 끝 결과로 덮어썼으면 그것을 보낸다)
 * → 이번에 올라간 판 수
 */
export async function flushPending(
  store: Store,
  uid: string,
  send: (r: PendingEntry) => Promise<SendOutcome>,
  skip: (r: PendingEntry) => boolean = () => false,
): Promise<number> {
  let sent = 0;
  for (const { run } of readPending(store, uid)) {
    const r = readPending(store, uid).find((x) => x.run === run);
    if (!r || skip(r)) continue;
    const out = await send(r).catch((): SendOutcome => 'failed');
    if (out === 'failed') continue;
    if (out === 'ok') sent++;
    dropPending(store, uid, r.run, r);
  }
  return sent;
}
