/** 이어 할 판 고르기 (src/ui/resume.ts) — 새 판 시작 직후 '← 처음' 에서 기기 저장이 지워지던 것 */
import { describe, expect, it } from 'vitest';
import { RULES_VERSION, apply, newRun } from '../src/game/rules';
import type { ServerRun } from '../src/net/api';
import { pickResume, startedRun } from '../src/ui/resume';

const srvRun = (o: Partial<ServerRun> = {}): ServerRun => ({
  runId: 'r1', mode: 'normal', hero: 'dog', mastery: 0, seed: 5, rules: RULES_VERSION, day: null, firstOfDay: false, log: [], acts: 0, floors: 0, coins: 0, ...o,
});
const none = () => false;

describe('pickResume', () => {
  it('새 판을 시작하고 몇 칸 간 뒤: card_start 의 판(기록 없음)과 같은 판 번호면 기기 저장이 이긴다', () => {
    const run = newRun({ seed: 5, hero: 'dog' });
    apply(run, { t: 'go', col: 0 });
    const saved = { runId: 'r1', run };
    const pick = pickResume(saved, startedRun(srvRun({ paidCoins: 2, log: [{ t: 'go', col: 1 }] })), none);
    expect(pick).toEqual({ saved });
  });
  it('서버에 진행 중인 판이 없으면(끝났거나 버림) 기기 저장은 지운다 — 예전처럼 비워 두면 이렇게 됐다', () => {
    const saved = { runId: 'r1', run: newRun({ seed: 5, hero: 'dog' }) };
    expect(pickResume(saved, undefined, none)).toEqual({ clear: true });
  });
  it('다른 판 번호면 서버 판 · 업로드 보관 중이면 기기 저장', () => {
    const saved = { runId: 'old', run: newRun({ seed: 5, hero: 'dog' }) };
    const srv = srvRun();
    expect(pickResume(saved, srv, none)).toEqual({ server: srv });
    expect(pickResume(saved, undefined, (id) => id === 'old')).toEqual({ saved });
    expect(pickResume(null, srvRun({ rules: RULES_VERSION - 1 }), none)).toBeNull();
  });
  it('다른 기기가 서버 기록을 앞서 나갔으면(앞부분이 다름) 기기 저장이 더 길어도 서버 판 — 올리면 bad log 로 버려진다', () => {
    const run = newRun({ seed: 5, hero: 'dog' });
    apply(run, { t: 'go', col: 0 });
    run.log.push({ t: 'end' } as never, { t: 'end' } as never);
    const saved = { runId: 'r1', run };
    const srv = srvRun({ log: [{ t: 'go', col: 1 }] });
    expect(pickResume(saved, srv, none)).toEqual({ server: srv });
    expect(pickResume(saved, srv, () => true)).toEqual({ server: srv });
    // 키 순서만 다른 같은 기록이면 기기 저장
    const same = srvRun({ log: [{ col: 0, t: 'go' } as never] });
    expect(pickResume(saved, same, none)).toEqual({ saved });
  });
  it('startedRun: 기록·코인 없이', () => {
    expect(startedRun(srvRun({ log: [{ t: 'end' }], acts: 2, paidCoins: 1 }))).toMatchObject({ runId: 'r1', log: [], acts: 0, paidCoins: undefined });
  });
});
