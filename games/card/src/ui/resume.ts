/**
 * 이어 할 판 고르기 (화면 app.ts 의 resumable 이 쓰는 순수 함수 — tests/resume.test.ts).
 * 이 기기의 저장이 서버 판과 같은 판이면 기기 것(더 많이 감), 서버에만 있으면(다른 기기) 서버 기록을 다시 돌린 것
 * = 마지막으로 깬 막 다음부터. 서버에서 끝났거나 버린 판의 기기 저장은 지운다(clear).
 */
import type { ServerRun } from '../net/api';
import { RULES_VERSION, type RunState } from '../game/rules';

export interface Saved {
  runId: string | null;
  run: RunState;
}

export type ResumePick = { saved: Saved } | { server: ServerRun } | { clear: true } | null;

export function pickResume(saved: Saved | null, srv: ServerRun | undefined, pending: (runId: string) => boolean): ResumePick {
  if (saved && srv && saved.runId === srv.runId && saved.run.log.length >= srv.log.length) return { saved };
  if (saved && saved.runId && pending(saved.runId) && (!srv || srv.runId === saved.runId)) return { saved };
  if (srv && srv.rules === RULES_VERSION) return { server: srv };
  if (saved) return { clear: true };
  return null;
}

/** card_start 가 돌려준 새 판 → 처음 화면이 아는 '진행 중인 서버 판' (기록 없음 — 기기 저장이 이긴다) */
export const startedRun = (r: ServerRun): ServerRun => ({ ...r, log: [], acts: 0, floors: 0, coins: 0, paidCoins: undefined });
