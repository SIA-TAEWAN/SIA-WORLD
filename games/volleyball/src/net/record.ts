import type { MatchResult, MatchSetup, RecordOutcome } from '../match/game';
import type { SaveResult, VolleyApi } from './api';

/**
 * 내 보고가 먼저라 '기다리는 중'이면, 이 간격으로 확정됐는지 물어본다 (합 12초).
 * 상대 보고가 오면 바로 확정돼 있고, 끝내 안 오면(상대가 나가 버림) 서버가 10초 뒤부터 내 보고 하나로 확정해 준다.
 */
export const SETTLE_WAITS_MS = [1500, 2500, 8000] as const;
export const SETTLE_AFTER_MS = SETTLE_WAITS_MS.reduce((a, b) => a + b, 0);
/** 서버는 경기 시작(live) 5초 안의 보고를 받지 않는다: 너무 빨리 끝났으면 이만큼 뒤에 한 번 더 */
export const EARLY_RETRY_MS = 5500;
/** 시작 알림이 아직 live가 아니면 이만큼 뒤에 한 번 더 부른다 (누가 내 자리에 끼어든 경우를 바로잡는다) */
export const BEGIN_RETRY_MS = 2500;

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
 * 온라인 한 경기의 결과 저장 (양쪽 보고 일치 방식, supabase/migrations/034_volleyball.sql).
 * 경기 시작 때 만들면 서버에 시작을 알리고(begin), 끝나면 finish()가 보고(report)하고 필요하면 확정(settle)을 한 번 부른다.
 * 실패해도 경기 화면은 그대로 진행한다 (결과 화면에 '기록을 올리지 못했어요'만).
 */
export class MatchRecorder {
  private matchId: Promise<string | null>;

  constructor(
    private api: VolleyApi,
    room: string,
    private setup: MatchSetup,
  ) {
    const me = setup.mySide;
    const opp = setup.fighters[me === 0 ? 1 : 0];
    const no = setup.matchNo ?? 0;
    this.matchId =
      api.kind === 'local' || !opp.id
        ? Promise.resolve(null)
        : (async () => {
            const call = () => api.begin(room, no, me, opp.id!, setup.fighters[me].char);
            let r = await call();
            if (r && !r.live) {
              await sleep(BEGIN_RETRY_MS);
              r = (await call()) ?? r;
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
      if (!id) return { state: rep ? 'failed' : 'left' };
      // 내가 나간(끊긴) 경기: 보고하지 않는다. 남은 사람의 보고로 나는 패배로 기록된다
      if (!rep) return { state: 'left' };
      let r: SaveResult = await api.report(id, rep.left, rep.right, rep.reason);
      if (r.status === 'error' && /too early/.test(r.code ?? '')) {
        await sleep(EARLY_RETRY_MS);
        r = await api.report(id, rep.left, rep.right, rep.reason);
      }
      // 상대 보고를 기다린다. 끝내 안 오면(이탈 경기는 언제나) 내 보고 하나로 확정
      for (const ms of SETTLE_WAITS_MS) {
        if (r.status !== 'waiting') break;
        await sleep(ms);
        r = await api.settle(id);
      }
      if (r.status === 'done') return { state: 'saved', wins: r.wins, losses: r.losses };
      if (r.status === 'void') return { state: 'void', ...(await api.myRecord().catch(() => null)) };
      return { state: 'failed' };
    } catch {
      return { state: 'failed' };
    }
  }
}
