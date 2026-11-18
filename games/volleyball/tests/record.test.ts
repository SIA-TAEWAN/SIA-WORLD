import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchResult, MatchSetup } from '../src/match/game';
import type { SaveResult, VolleyApi } from '../src/net/api';
import { MatchRecorder, reportFor } from '../src/net/record';

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

  it("너무 빨리 끝나 'too early'면 5.5초 뒤 한 번 더 보고한다", async () => {
    let n = 0;
    const { api } = fakeApi({
      async report(): Promise<SaveResult> {
        n++;
        return n === 1 ? { status: 'error', code: 'too early' } : { status: 'done', wins: 1, losses: 0 };
      },
    });
    const p = new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 2], 0, 'leave', 1));
    await vi.advanceTimersByTimeAsync(5600);
    expect(await p).toEqual({ state: 'saved', wins: 1, losses: 0 });
    expect(n).toBe(2);
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
    expect(await new MatchRecorder(a.api, 'room01', setup(0)).finish(result(0, [3, 0], 0))).toEqual({ state: 'failed' });
    expect(a.calls.some((c) => c.startsWith('report'))).toBe(false);
    const b = fakeApi({
      async report() {
        throw new Error('network');
      },
    });
    expect(await new MatchRecorder(b.api, 'room01', setup(0)).finish(result(0, [3, 0], 0))).toEqual({ state: 'failed' });
  });

  it('테스트 모드(local)는 서버를 부르지 않는다', async () => {
    const { api, calls } = fakeApi({ kind: 'local' });
    expect(await new MatchRecorder(api, 'room01', setup(0)).finish(result(0, [3, 0], 0))).toEqual({ state: 'none' });
    expect(calls).toEqual([]);
  });
});
