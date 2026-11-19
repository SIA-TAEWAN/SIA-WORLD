import type { RunReport } from '../game/progress';

/**
 * 못 올린 판 결과의 임시 보관 (PRD 11장: 실패하면 기기에 임시 보관 후 재전송). 시아서바이벌 net/pending.ts 와 같은 방식.
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

/** 보관해 두는 최대 판 수 (넘으면 오래된 것부터 버린다) */
export const PENDING_MAX = 5;

const key = (uid: string) => `siadefense:pending:${uid}`;

function isReport(v: unknown): v is RunReport {
  const r = v as RunReport;
  return !!r && typeof r.run === 'string' && typeof r.stage === 'string' && typeof r.cleared === 'boolean' && Number.isFinite(r.time) && Number.isFinite(r.lives);
}

export function readPending(store: Store, uid: string): RunReport[] {
  try {
    const list = JSON.parse(store.getItem(key(uid)) ?? '[]');
    return Array.isArray(list) ? list.filter(isReport) : [];
  } catch {
    return [];
  }
}

function writePending(store: Store, uid: string, list: RunReport[]) {
  try {
    if (list.length === 0) store.removeItem(key(uid));
    else store.setItem(key(uid), JSON.stringify(list.slice(-PENDING_MAX)));
  } catch {
    /* 저장하지 못해도 게임은 계속 */
  }
}

/** 결과를 보관한다 (같은 판은 한 번만: 나중 것이 앞의 것을 덮어쓴다) */
export function keepPending(store: Store, uid: string, report: RunReport) {
  const list = readPending(store, uid).filter((r) => r.run !== report.run);
  list.push(report);
  writePending(store, uid, list);
}

export function dropPending(store: Store, uid: string, run: string) {
  writePending(store, uid, readPending(store, uid).filter((r) => r.run !== run));
}

/**
 * 보관해 둔 결과를 다시 보낸다. 받았거나 서버가 거절한 것은 지우고, 통신 실패만 남긴다.
 * skip: 지금 다른 곳에서 보내는 중인 판은 건너뛴다 (같은 판을 두 번 보내지 않게).
 * → 이번에 올라간 판 수
 */
export async function flushPending(
  store: Store,
  uid: string,
  send: (r: RunReport) => Promise<SendOutcome>,
  skip: (run: string) => boolean = () => false,
): Promise<number> {
  let sent = 0;
  for (const r of readPending(store, uid)) {
    if (skip(r.run)) continue;
    const out = await send(r).catch((): SendOutcome => 'failed');
    if (out === 'failed') continue;
    if (out === 'ok') sent++;
    dropPending(store, uid, r.run);
  }
  return sent;
}
