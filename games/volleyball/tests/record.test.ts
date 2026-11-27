import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchResult, MatchSetup } from '../src/match/game';
import type { SaveResult, VolleyApi } from '../src/net/api';
import { MatchRecorder, forfeitResult, reportFor, settlePending, type PendingEntry, type PendingStore } from '../src/net/record';

const setup = (mySide: 0 | 1): MatchSetup => ({
  mode: 'online', mySide, seed: 1, bg: 0, matchNo: 1234, startAt: 0,
  fighters: [{ id: 'L', name: 'L', char: 'tiger', ai: false }, { id: 'R', name: 'R', char: 'pig', ai: false }],
});
const result = (mySide: 0 | 1, score: [number, number], winner: 0 | 1, reason: 'normal' | 'leave' = 'normal', leaver?: 0 | 1): MatchResult => ({ setup: setup(mySide), score, winner, reason, leaver });

/** 부른 것을 적어 두는 가짜 서버 */
function fakeApi(over: Partial<VolleyApi> = {}) {
  const calls: string[] = [];
  const api: VolleyApi = {
    kind: 'supabase',
    channel: () => {
      throw new Error('쓰지 않음');
    },
    async syncClock() {},
    async begin(room, no, side, opp, char) {
      calls.push(`begin ${room} ${no} ${side} ${opp} ${char}`);
      return { match: 'm1', live: true };
    },
    async report(m, l, r, reason) {
      calls.push(`report ${m} ${l}:${r} ${reason}`);
      return { status: 'done', wins: 4, losses: 2 };
    },
    async settle(m) {
      calls.push(`settle ${m}`);
      return { status: 'done', wins: 4, losses: 2 };
    },
    async h2h() {
      return null;
    },
    async myRecord() {
      calls.push('myRecord');
      return { wins: 1, losses: 1 };
    },
    ...over,
  };
  return { api, calls };
}

describe('무엇을 보고할지', () => {
  it('정상 종료: 이긴 쪽도 진 쪽도 같은 점수를 보고한다', () => {
    expect(reportFor(result(0, [3, 1], 0), 0)).toEqual({ left: 3, right: 1, reason: 'normal' });
    expect(reportFor(result(1, [3, 1], 0), 1)).toEqual({ left: 3, right: 1, reason: 'normal' });
  });
  it('이탈: 남아서 AI와 끝까지 한 사람이 최종 점수를 leave로 보고한다 (이겼든 졌든)', () => {
    // 오른쪽이 나감 → 왼쪽(나)이 AI를 3:1로 이김
    expect(reportFor(result(0, [3, 1], 0, 'leave', 1), 0)).toEqual({ left: 3, right: 1, reason: 'leave' });
    // 오른쪽이 나감 → 왼쪽(나)이 AI에게 2:3으로 짐
    expect(reportFor(result(0, [2, 3], 1, 'leave', 1), 0)).toEqual({ left: 2, right: 3, reason: 'leave' });
    // 방장(왼쪽)이 나감 → 오른쪽(나)이 마무리
    expect(reportFor(result(1, [1, 3], 1, 'leave', 0), 1)).toEqual({ left: 1, right: 3, reason: 'leave' });
  });
  it('이탈: 나간(끊긴) 사람은 보고하지 않는다', () => {
    expect(reportFor(result(1, [1, 2], 0, 'leave', 1), 1)).toBeNull();
    expect(reportFor(result(0, [1, 2], 1, 'leave', 0), 0)).toBeNull();
  });
});

describe('결과 저장 순서', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('경기 시작 때 begin(방·경기 번호·내 자리·상대·내 캐릭터), 끝나면 report', async () => {
    const { api, calls } = fakeApi();
    const rec = new MatchRecorder(api, 'room01', setup(1));
    const out = await rec.finish(result(1, [3, 2], 0));
    expect(calls).toEqual(['begin room01 1234 1 L pig', 'report m1 3:2 normal']);
    expect(out).toEqual({ state: 'saved', wins: 4, losses: 2 });
  });

  it("내 보고가 먼저라 'waiting'이면 잠깐씩 기다리며 확정을 물어본다 (상대 보고가 오면 바로 끝)", async () => {
    let n = 0;
    const { api, calls } = fakeApi({
      async report() {
        return { status: 'waiting' };
      },
      async settle(): Promise<SaveResult> {
        n++;
        calls.push(`settle#${n}`);
        return n < 2 ? { status: 'waiting' } : { status: 'done', wins: 1, losses: 0 };
      },
    });
    const p = new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 0], 0));
    await vi.advanceTimersByTimeAsync(1400);
    expect(calls.filter((c) => c.startsWith('settle'))).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.filter((c) => c.startsWith('settle'))).toEqual(['settle#1']);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await p).toEqual({ state: 'saved', wins: 1, losses: 0 });
    expect(n).toBe(2);
  });

  it('상대 보고가 끝내 없으면 12초 뒤 마지막 확정 요청까지 하고 끝낸다', async () => {
    let n = 0;
    const { api } = fakeApi({
      async report() {
        return { status: 'waiting' };
      },
      async settle(): Promise<SaveResult> {
        n++;
        return n < 3 ? { status: 'waiting' } : { status: 'done', wins: 2, losses: 5 };
      },
    });
    const p = new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 0], 0, 'leave', 1));
    await vi.advanceTimersByTimeAsync(11900);
    expect(n).toBe(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toEqual({ state: 'saved', wins: 2, losses: 5 });
  });

  it("너무 빨리 끝나 'too early'면 서버가 받아 주는 시각(시작 15초 뒤)이 지난 다음에 다시 보고한다", async () => {
    let n = 0;
    const at: number[] = [];
    const t0 = Date.now();
    const { api } = fakeApi({
      async report(): Promise<SaveResult> {
        n++;
        at.push(Date.now() - t0);
        return n === 1 ? { status: 'error', code: 'too early' } : { status: 'done', wins: 1, losses: 0 };
      },
    });
    const rec = new MatchRecorder(api, 'room01', setup(0));
    await vi.advanceTimersByTimeAsync(6000); // 경기가 6초 만에 끝남
    const p = rec.finish(result(0, [3, 2], 0, 'leave', 1));
    await vi.advanceTimersByTimeAsync(9000);
    expect(n).toBe(1); // 아직 15초가 안 됐다
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ state: 'saved', wins: 1, losses: 0 });
    expect(n).toBe(2);
    expect(at[1]).toBeGreaterThanOrEqual(15000);
    expect(at[1]).toBeLessThan(16500);
  });

  it('하루 30판을 채워 begin이 거절되면(daily limit) 보고하지 않고 그렇게 알린다', async () => {
    const { api, calls } = fakeApi({
      async begin() {
        return { error: 'daily limit' };
      },
    });
    expect(await new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 0], 0))).toEqual({ state: 'limit' });
    expect(calls.some((c) => c.startsWith('report'))).toBe(false);
    // 다른 까닭으로 거절되면 그냥 실패
    const b = fakeApi({
      async begin() {
        return { error: 'too soon' };
      },
    });
    expect(await new MatchRecorder(b.api, 'room01', setup(0)).finish(result(0, [3, 0], 0))).toEqual({ state: 'failed' });
  });

  it('잠긴 캐릭터라서 begin이 거절되면(locked character) 보고하지 않고 그렇게 알린다', async () => {
    const { api, calls } = fakeApi({
      async begin() {
        return { error: 'locked character' };
      },
    });
    expect(await new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 0], 0))).toEqual({ state: 'locked' });
    expect(calls.some((c) => c.startsWith('report'))).toBe(false);
  });

  it('두 기기의 결과가 다르면(void) 기록되지 않았다고 알리고 내 전적만 읽는다', async () => {
    const { api } = fakeApi({
      async report() {
        return { status: 'void' };
      },
    });
    expect(await new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 1], 0))).toEqual({ state: 'void', wins: 1, losses: 1 });
  });

  it('남은 사람이 AI에게 져도 그 점수를 leave로 보고한다 (서버가 패로 기록)', async () => {
    const { api, calls } = fakeApi();
    const out = await new MatchRecorder(api, 'room01', setup(1)).finish(result(1, [3, 1], 0, 'leave', 0));
    expect(calls).toEqual(['begin room01 1234 1 L pig', 'report m1 3:1 leave']);
    expect(out.state).toBe('saved');
  });

  it('내가 나간(끊긴) 경기는 보고하지 않는다 (남은 사람의 보고로 패배가 기록된다)', async () => {
    const { api, calls } = fakeApi();
    const out = await new MatchRecorder(api, 'room01', setup(1)).finish(result(1, [1, 1], 0, 'leave', 1));
    expect(out).toEqual({ state: 'left' });
    expect(calls.some((c) => c.startsWith('report') || c.startsWith('settle'))).toBe(false);
  });

  it('begin이 아직 live가 아니면 2.5초 뒤 한 번 더 부른다', async () => {
    let n = 0;
    const { api } = fakeApi({
      async begin() {
        n++;
        return { match: 'm1', live: n > 1 };
      },
    });
    const rec = new MatchRecorder(api, 'room01', setup(0));
    await vi.advanceTimersByTimeAsync(2600);
    expect(n).toBe(2);
    expect((await rec.finish(result(0, [3, 0], 0))).state).toBe('saved');
  });

  it('서버가 안 되면(begin 실패·오류) 실패로만 알린다. 예외를 던지지 않는다', async () => {
    const a = fakeApi({
      async begin() {
        return null;
      },
    });
    const pa = new MatchRecorder(a.api, 'room01', setup(0)).finish(result(0, [3, 0], 0));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pa).toEqual({ state: 'failed' });
    expect(a.calls.some((c) => c.startsWith('report'))).toBe(false);
    const b = fakeApi({
      async report() {
        throw new Error('network');
      },
    });
    const pb = new MatchRecorder(b.api, 'room01', setup(0)).finish(result(0, [3, 0], 0));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pb).toEqual({ state: 'failed' });
  });

  it('begin 이 통신 실패(null)면 잠깐 뒤 한 번 더 알린다', async () => {
    let n = 0;
    const { api, calls } = fakeApi({
      async begin() {
        n++;
        return n < 2 ? null : { match: 'm2', live: true };
      },
    });
    const p = new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 0], 0));
    await vi.advanceTimersByTimeAsync(3000);
    expect(n).toBe(2);
    expect(await p).toEqual({ state: 'saved', wins: 4, losses: 2 });
    expect(calls).toContain('report m2 3:0 normal');
  });

  it('보고가 통신 실패면 1~2초 뒤 다시 보낸다. 끝내 안 되면 보고를 기기에 적어 둔다', async () => {
    const store = memStore();
    let n = 0;
    const { api } = fakeApi({
      async report(): Promise<SaveResult> {
        n++;
        return { status: 'error' };
      },
    });
    const p = new MatchRecorder(api, 'room01', setup(0), { store }).finish(result(0, [3, 1], 0, 'leave', 1));
    await vi.advanceTimersByTimeAsync(4000);
    expect(await p).toEqual({ state: 'failed' });
    expect(n).toBe(3);
    expect(store.list).toEqual([{ id: 'm1', at: expect.any(Number), report: { left: 3, right: 1, reason: 'leave' } }]);
  });

  it('보고가 한 번 실패해도 다시 보내 닿으면 그대로 저장된다', async () => {
    let n = 0;
    const { api } = fakeApi({
      async report(): Promise<SaveResult> {
        n++;
        return n < 2 ? { status: 'error' } : { status: 'done', wins: 3, losses: 1 };
      },
    });
    const p = new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 1], 0));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ state: 'saved', wins: 3, losses: 1 });
  });

  it('테스트 모드(local)는 서버를 부르지 않는다', async () => {
    const { api, calls } = fakeApi({ kind: 'local' });
    expect(await new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 0], 0))).toEqual({ state: 'none' });
    expect(calls).toEqual([]);
  });
});

/** 메모리에 두는 가짜 저장소 */
function memStore(init: PendingEntry[] = []): PendingStore & { list: PendingEntry[] } {
  const st = {
    list: [...init],
    load: () => [...st.list],
    save: (l: PendingEntry[]) => {
      st.list = [...l];
    },
  };
  return st;
}

describe('확정하지 못하고 떠난 경기 (M4)', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("내 보고가 'waiting'이면 적어 두고, 확정되면 지운다", async () => {
    const store = memStore();
    let n = 0;
    const { api } = fakeApi({
      async report() {
        return { status: 'waiting' };
      },
      async settle(): Promise<SaveResult> {
        n++;
        return n < 3 ? { status: 'waiting' } : { status: 'done', wins: 1, losses: 0 };
      },
    });
    const p = new MatchRecorder(api, 'room01', setup(0), { store }).finish(result(0, [3, 1], 0, 'leave', 1));
    await vi.advanceTimersByTimeAsync(100);
    expect(store.list.map((e) => e.id)).toEqual(['m1']); // 여기서 페이지를 떠나도 남아 있다
    await vi.advanceTimersByTimeAsync(12100);
    expect((await p).state).toBe('saved');
    expect(store.list).toEqual([]);
  });

  it('끝내 확정을 못 했으면 남겨 두고, 다음에 로비에 들어올 때 확정한다', async () => {
    const store = memStore();
    const a = fakeApi({
      async report() {
        return { status: 'waiting' };
      },
      async settle() {
        return { status: 'waiting' };
      },
    });
    const p = new MatchRecorder(a.api, 'room01', setup(0), { store }).finish(result(0, [3, 1], 0, 'leave', 1));
    await vi.advanceTimersByTimeAsync(12100);
    expect((await p).state).toBe('failed');
    expect(store.list).toHaveLength(1);
    // 다음 접속
    const b = fakeApi();
    expect(await settlePending(b.api, store)).toBe(1);
    expect(b.calls).toEqual(['settle m1']);
    expect(store.list).toEqual([]);
  });

  it('아직 기다리는 중·통신 실패는 남기고, 서버가 거절한 것·40분 지난 것은 지운다', async () => {
    const now = Date.now();
    const store = memStore([{ id: 'wait', at: now }, { id: 'net', at: now }, { id: 'gone', at: now }, { id: 'old', at: now - 41 * 60 * 1000 }, { id: 'void', at: now }]);
    const { api, calls } = fakeApi({
      async settle(m): Promise<SaveResult> {
        calls.push(`settle ${m}`);
        if (m === 'wait') return { status: 'waiting' };
        if (m === 'net') return { status: 'error' };
        if (m === 'gone') return { status: 'error', code: 'no match' };
        return { status: 'void' };
      },
    });
    expect(await settlePending(api, store, now)).toBe(1);
    expect(calls).toEqual(['settle wait', 'settle net', 'settle gone', 'settle void']);
    expect(store.list.map((e) => e.id)).toEqual(['wait', 'net']);
  });

  it('보내지 못한 보고는 보고부터 다시 보낸다 (닿으면 다음엔 확정만, 통신 실패는 그대로, 거절은 지운다)', async () => {
    const now = Date.now();
    const rep = { left: 3, right: 1, reason: 'leave' as const };
    const store = memStore([{ id: 'ok', at: now, report: rep }, { id: 'wait', at: now, report: rep }, { id: 'net', at: now, report: rep }, { id: 'late', at: now, report: rep }]);
    const { api, calls } = fakeApi({
      async report(m, l, r, reason): Promise<SaveResult> {
        calls.push(`report ${m} ${l}:${r} ${reason}`);
        if (m === 'ok') return { status: 'done', wins: 1, losses: 0 };
        if (m === 'wait') return { status: 'waiting' };
        if (m === 'net') return { status: 'error' };
        return { status: 'error', code: 'too late' };
      },
    });
    expect(await settlePending(api, store, now)).toBe(1);
    expect(calls).toEqual(['report ok 3:1 leave', 'report wait 3:1 leave', 'report net 3:1 leave', 'report late 3:1 leave']);
    expect(store.list).toEqual([{ id: 'wait', at: now }, { id: 'net', at: now, report: rep }]);
  });

  it('테스트 모드(local)는 서버를 부르지 않는다', async () => {
    const store = memStore([{ id: 'x', at: Date.now() }]);
    const { api, calls } = fakeApi({ kind: 'local' });
    expect(await settlePending(api, store)).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('AI가 이어받은 경기에서 남은 사람까지 나감 (M5)', () => {
  it('몰수패로 보고한다: AI 쪽 3점, 내 점수는 지금 값(최대 2점), 나간 사람은 상대', () => {
    expect(forfeitResult(setup(0), [2, 1])).toMatchObject({ score: [2, 3], winner: 1, reason: 'leave', leaver: 1 });
    expect(forfeitResult(setup(1), [1, 0])).toMatchObject({ score: [3, 0], winner: 0, reason: 'leave', leaver: 0 });
    expect(forfeitResult(setup(0), [3, 0]).score).toEqual([2, 3]);
    expect(reportFor(forfeitResult(setup(1), [2, 2]), 1)).toEqual({ left: 3, right: 2, reason: 'leave' });
  });
  it('나가면서 보고가 올라가고, 확정을 기다리는 경기로 적힌다', async () => {
    const store = memStore();
    const { api, calls } = fakeApi({
      async report(m, l, r, reason) {
        calls.push(`report ${m} ${l}:${r} ${reason}`);
        return { status: 'waiting' };
      },
    });
    const rec = new MatchRecorder(api, 'room01', setup(0), { store });
    void rec.finish(forfeitResult(setup(0), [1, 2]));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toContain('report m1 1:3 leave');
    expect(store.list.map((e) => e.id)).toEqual(['m1']);
  });
});
