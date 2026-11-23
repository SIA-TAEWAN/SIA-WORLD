import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRAISE_LIST_MAX, agoText, cleanInbox, localInbox, praiseNotice, seenAfter, type PraiseInbox } from '../src/game/praise';
import { createLocalApi, createSupabaseApi, type RpcClient, type Store } from '../src/net/api';

const memory = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const row = (userId: string, nickname: string, at: number, fresh: boolean) => ({ userId, nickname, name: '', at, fresh });
const box = (rows: PraiseInbox['rows'], fresh?: number, freshUsers?: number): PraiseInbox => cleanInbox({ now: 10_000, seenAt: 5_000, rows, fresh, freshUsers });

describe('받은 칭찬 알림', () => {
  it('새로 받은 것이 없으면 알림이 없다', () => {
    expect(praiseNotice(null)).toBeNull();
    expect(praiseNotice(box([]))).toBeNull();
    expect(praiseNotice(box([row('a', '달토끼', 4000, false)]))).toBeNull();
  });

  it('한 사람: 이름과 함께, 누르면 그 마을로', () => {
    expect(praiseNotice(box([row('a', '달토끼', 9000, true), row('b', '솔바람', 1000, false)]))).toEqual({ text: '달토끼 님이 칭찬했어요', visit: 'a', count: 1 });
    // 같은 사람이 여러 날 칭찬했으면 횟수로
    expect(praiseNotice(box([row('a', '달토끼', 9000, true), row('a', '달토끼', 8000, true)]))).toEqual({ text: '달토끼 님이 2번 칭찬했어요', visit: 'a', count: 2 });
  });

  it('여러 사람: 가장 최근 사람 외 몇 명으로 묶고, 누르면 목록으로', () => {
    const n = praiseNotice(box([row('b', '솔바람', 9500, true), row('a', '달토끼', 9000, true), row('c', '새싹이', 8000, true), row('a', '달토끼', 1000, false)]));
    expect(n).toEqual({ text: '솔바람 님 외 2명이 칭찬했어요', visit: null, count: 3 });
    // 목록 20개에 다 들어오지 않은 것은 서버가 센 수를 쓴다
    expect(praiseNotice(box([row('b', '솔바람', 9500, true)], 31, 25))).toEqual({ text: '솔바람 님 외 24명이 칭찬했어요', visit: null, count: 31 });
  });

  it('서버 답 다듬기: 모양이 다른 줄은 버리고, 최근 것부터, 20개까지', () => {
    const c = cleanInbox({ now: 100, seenAt: 'x', fresh: -3, rows: [null, { userId: 5 }, { userId: 'a', nickname: 3, at: 10, fresh: 'yes' }, { userId: 'b', nickname: '비', name: '비마을', at: 50, fresh: true }] });
    expect(c).toEqual({ now: 100, seenAt: 0, fresh: 1, freshUsers: 1, rows: [{ userId: 'b', nickname: '비', name: '비마을', at: 50, fresh: true }, { userId: 'a', nickname: '', name: '', at: 10, fresh: false }] });
    expect(cleanInbox(null)).toEqual({ now: 0, seenAt: 0, fresh: 0, freshUsers: 0, rows: [] });
    expect(cleanInbox({ rows: Array.from({ length: 30 }, (_, i) => row(`u${i}`, 'n', i, false)) }).rows).toHaveLength(PRAISE_LIST_MAX);
  });

  it('얼마나 전인지', () => {
    const t = 1_700_000_000_000;
    expect(agoText(t, t)).toBe('방금');
    expect(agoText(t + 5000, t)).toBe('방금');
    expect(agoText(t - 59_000, t)).toBe('방금');
    expect(agoText(t - 60_000, t)).toBe('1분 전');
    expect(agoText(t - 3 * 3600_000 - 1, t)).toBe('3시간 전');
    expect(agoText(t - 49 * 3600_000, t)).toBe('2일 전');
  });

  it('다 봤음: 뒤로 가지 않고 지금을 넘지 않는다', () => {
    expect(seenAfter(100, 200, 1000)).toBe(201);
    expect(seenAfter(500, 200, 1000)).toBe(500);
    expect(seenAfter(100, 5000, 1000)).toBe(1000);
    expect(seenAfter(100, NaN, 1000)).toBe(1000);
    expect(seenAfter(100, -1, 1000)).toBe(1000);
  });

  it('테스트 모드 기록 → 목록: 모르는 사람 · 아직 오지 않은 것은 뺀다', () => {
    const who = (id: string) => (id === 'x' ? null : { nickname: id.toUpperCase(), name: '' });
    const r = localInbox({ seenAt: 50, log: [{ from: 'a', at: 10 }, { from: 'b', at: 60 }, { from: 'x', at: 70 }, { from: 'a', at: 80 }, { from: 'b', at: 999 }] }, 100, who);
    expect(r).toMatchObject({ now: 100, seenAt: 50, fresh: 2, freshUsers: 2 });
    expect(r.rows.map((v) => `${v.nickname}${v.at}${v.fresh ? '*' : ''}`)).toEqual(['A80*', 'B60*', 'A10']);
  });
});

describe('받은 칭찬 (api)', () => {
  it('테스트 모드: 처음에는 이웃 둘의 새 칭찬, 다 보면 사라지고 새로 열어도 그대로', async () => {
    const store = memory();
    let t = 1_700_000_000_000;
    const api = createLocalApi(store, () => t);
    await api.load();
    const a = await api.praiseInbox();
    expect(a).toMatchObject({ now: t, fresh: 2, freshUsers: 2 });
    expect(a.rows.map((r) => [r.userId, r.nickname, r.fresh])).toEqual([['bot-1', '달토끼', true], ['bot-2', '솔바람', true], ['bot-1', '달토끼', false]]);
    expect(praiseNotice(a)?.text).toBe('달토끼 님 외 1명이 칭찬했어요');
    // 목록의 그 마을로 구경 갈 수 있다 (답방)
    expect((await api.visit(a.rows[0].userId)).nickname).toBe('달토끼');
    t += 1000;
    await api.praiseSeen(a.now);
    const again = createLocalApi(store, () => t);
    const b = await again.praiseInbox();
    expect(b.fresh).toBe(0);
    expect(b.rows).toHaveLength(3);
    expect(praiseNotice(b)).toBeNull();
    // 마을 상태는 건드리지 않는다
    expect((await again.load()).profile.praiseCount).toBe(0);
  });

  it('서버: village_praise_inbox · village_praise_seen(p_at)', async () => {
    const calls: [string, unknown][] = [];
    const sb: RpcClient = {
      rpc: (fn, a) => (calls.push([fn, a]), Promise.resolve({ data: fn === 'village_praise_inbox' ? { now: 5000, seenAt: 100, fresh: 1, freshUsers: 1, rows: [{ userId: 'u1', nickname: '닉', name: '', at: 4000, fresh: true }] } : { now: 5001, seenAt: 5001 }, error: null })),
    };
    const api = createSupabaseApi(sb);
    const r = await api.praiseInbox();
    expect(praiseNotice(r)).toEqual({ text: '닉 님이 칭찬했어요', visit: 'u1', count: 1 });
    await api.praiseSeen(r.now);
    expect(calls).toEqual([['village_praise_inbox', undefined], ['village_praise_seen', { p_at: 5000 }]]);
    const down: RpcClient = { rpc: () => Promise.resolve({ data: null, error: { message: 'fetch failed' } }) };
    await expect(createSupabaseApi(down).praiseInbox()).rejects.toThrow('network');
  });
});

describe('091_village_praise_inbox.sql', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../../supabase/migrations/091_village_praise_inbox.sql', import.meta.url)), 'utf8');
  it('목록 수 · 권한이 화면과 같다', () => {
    expect(sql).toContain(`limit ${PRAISE_LIST_MAX})`);
    for (const fn of ['village_praise_inbox()', 'village_praise_seen(double precision)']) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
    expect(sql.match(/security definer set search_path = public/g)).toHaveLength(2);
  });
});
