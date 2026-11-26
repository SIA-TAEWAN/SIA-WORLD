import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { METER } from '../src/data/balance';
import { NO_MODS, endlessCoins } from '../src/data/growth';
import { DAILY_ID, ENDLESS_SEG, REGION_ENEMIES, STAGES, buildSegment, crateCoinsOf, dailyBossShift, dailyStage, endlessSegment, endlessStage } from '../src/data/stages';
import { DAILY_GAME, dailyCourse, dailySeed, dayLabel, isDay, isPastDay, localDay, normalizeDaily, placeText } from '../src/game/daily';
import { applyReport, checkReport, checkStart, emptyProfile, type RunReport } from '../src/game/progress';
import { STEP, createRun, metersOf, setTarget, step } from '../src/game/sim';
import { ApiError, createLocalApi, createSupabaseApi } from '../src/net/api';
import { greedy } from './policy';

// shared/daily.js 는 실행 중에 불러오는 공통 모듈이다. 테스트에서는 Supabase 클라이언트만 빼고 그대로 읽는다
vi.mock('../../../shared/supabase.js', () => ({ supabase: {} }));

const DAY = '2026-11-23';
const NEXT = '2026-11-24';

/** 자동 조종으로 오늘의 길을 끝까지 (최대 maxSec) */
function runDaily(day: string, maxSec = 240) {
  const s = createRun(dailyStage(dailyCourse(day).seed), 'rat', NO_MODS);
  for (let i = 0; i < maxSec / STEP && s.phase !== 'fail'; i++) {
    setTarget(s, greedy(s));
    step(s);
    s.events.length = 0;
  }
  return s;
}

describe('오늘의 길: 씨앗과 코스', () => {
  it('씨앗 식이 공통 모듈(shared/daily.js)과 같다', async () => {
    const shared = (await import('../../../shared/daily.js')) as { dailySeed: typeof dailySeed; localDailyDay: (now?: number) => string };
    for (const [g, d, s] of [['charge', DAY, 'road'], ['charge', NEXT, 'road'], ['finger', '2027-01-01', ''], ['charge', DAY, 'pick']] as const) {
      expect(dailySeed(g, d, s)).toBe(shared.dailySeed(g, d, s));
    }
    expect(dailyCourse(DAY, shared.dailySeed)).toEqual(dailyCourse(DAY));
    const t = Date.UTC(2026, 10, 23, 15, 30); // 한국 시간 24일 00:30
    expect(localDay(t)).toBe(shared.localDailyDay(t));
    expect(localDay(t)).toBe(NEXT);
  });

  it('같은 날은 어느 기기에서나 같은 코스, 날이 바뀌면 다른 코스', () => {
    const a = dailyCourse(DAY);
    expect(a).toEqual(dailyCourse(DAY));
    expect(a.seed).toBe(dailySeed(DAILY_GAME, DAY, 'road'));
    expect(JSON.stringify(dailyStage(a.seed))).toBe(JSON.stringify(dailyStage(dailyCourse(DAY).seed)));
    const b = dailyCourse(NEXT);
    expect(b.seed).not.toBe(a.seed);
    for (let k = 0; k < 4; k++) {
      expect(endlessSegment(k, a.seed)).toEqual(endlessSegment(k, a.seed));
      expect(JSON.stringify(endlessSegment(k, a.seed).items)).not.toBe(JSON.stringify(endlessSegment(k, b.seed).items));
    }
  });

  it('끝없는 길은 그대로: 씨앗을 넘기지 않으면 예전 코스, 오늘의 길과는 다르다', () => {
    const seed = dailyCourse(DAY).seed;
    for (let k = 0; k < 6; k++) {
      expect(endlessSegment(k)).toEqual(endlessSegment(k, undefined));
      expect(JSON.stringify(endlessSegment(k).items)).not.toBe(JSON.stringify(endlessSegment(k, seed).items));
    }
    // 끝없는 길 첫 구간의 고정 값 (코스 만드는 식을 건드리면 여기서 걸린다)
    const first = endlessSegment(0);
    expect(first.items[0]).toEqual(endlessStage().items[0]);
    expect(endlessStage().seed).toBeUndefined();
    expect(endlessStage().id).toBe('endless');
  });

  it('구간은 이어지고, 끝없는 길과 같은 틀(구간 길이·보스 자리)을 쓴다', () => {
    for (const day of [DAY, NEXT, '2027-02-28']) {
      const { seed } = dailyCourse(day);
      for (let k = 0; k < 8; k++) {
        const seg = endlessSegment(k, seed);
        expect(seg.bossZ).toBe((k + 1) * ENDLESS_SEG);
        expect(seg.items.length).toBeGreaterThan(2);
        expect(seg.boss.hp).toBeGreaterThan(0);
        expect(seg.boss.kind === 'chief').toBe(k % 3 !== 2);
        for (const it of seg.items) {
          const z = it.t === 'rail' ? it.z0 : it.z;
          expect(z).toBeGreaterThan(k * ENDLESS_SEG);
          expect(z).toBeLessThan(seg.bossZ);
        }
      }
    }
  });

  it('끝없는 길·오늘의 길 구간에는 엽전 상자가 없다 (서버가 쳐주지 않는다), 일반 스테이지는 그대로', () => {
    let crates = 0;
    for (const seed of [undefined, dailyCourse(DAY).seed, dailyCourse(NEXT).seed]) {
      for (let k = 0; k < 30; k++) {
        const items = endlessSegment(k, seed).items;
        expect(crateCoinsOf(items)).toBe(0);
        crates += items.filter((it) => it.t === 'crate').length;
      }
    }
    expect(crates).toBeGreaterThan(0);
    expect(STAGES.some((s) => crateCoinsOf(s.items) > 0)).toBe(true);
    // 엽전 상자만 힘 상자로 바뀌고 나머지 배치는 같다
    const seeded = (n: number) => () => ((n = (Math.imul(n, 1103515245) + 12345) >>> 0) / 2 ** 32);
    for (let n = 1; n <= 40; n++) {
      const a = buildSegment(seeded(n), 0.5, REGION_ENEMIES[3], 0, 30000, 30);
      const b = buildSegment(seeded(n), 0.5, REGION_ENEMIES[3], 0, 30000, 30, true);
      expect(b.troops).toBe(a.troops);
      expect(b.items).toEqual(a.items.map((it) => (it.t === 'crate' && it.reward.kind === 'coins' ? { ...it, reward: { kind: 'power', sec: 6 } } : it)));
    }
  });

  it('안내하는 보스 3마리가 실제 코스의 지역 보스와 같다', () => {
    for (const day of [DAY, NEXT, '2026-12-25']) {
      const c = dailyCourse(day);
      expect(c.bosses.map((b) => b.meters)).toEqual([540, 1080, 1620]);
      c.bosses.forEach((b, i) => {
        const seg = endlessSegment(i * 3 + 2, c.seed);
        expect(seg.boss.kind).toBe(b.id);
        expect(seg.bossZ / METER).toBe(b.meters);
        expect(b.name).toBeTruthy();
      });
      expect(dailyBossShift(c.seed)).toBeLessThan(12);
    }
  });

  it('씨앗 0 도 오늘의 길로 다룬다 (끝없는 길 코스로 돌아가지 않는다)', () => {
    expect(JSON.stringify(endlessSegment(1, 0).items)).not.toBe(JSON.stringify(endlessSegment(1).items));
    expect(dailyStage(0).seed).toBe(0);
  });

  it('판: 끝없는 길처럼 구간이 이어지고, 같은 조작이면 같은 거리', () => {
    const a = runDaily(DAY);
    const b = runDaily(DAY);
    expect(a.endless).toBe(true);
    expect(a.stage.id).toBe(DAILY_ID);
    expect(metersOf(a)).toBe(metersOf(b));
    expect(a.kills).toBe(b.kills);
    // 자동 조종이 첫 보스는 넘긴다 → 둘째 구간이 그날의 씨앗으로 붙는다
    expect(a.bosses).toBeGreaterThanOrEqual(1);
    expect(a.boss.z).toBe((a.segment + 1) * ENDLESS_SEG);
    expect(metersOf(a)).toBeGreaterThan(ENDLESS_SEG / METER - 20);
  }, 60_000);
});

describe('오늘의 길: 판 밖 규칙', () => {
  const report = (o: Partial<RunReport>): RunReport => ({
    run: 'r', stage: DAILY_ID, leader: 'rat', mode: 'daily', time: 120, cleared: false, troops: 0, kills: 80, progress: 0.4, meters: 700, bosses: 1, crate: 0, ...o,
  });

  it('누구나 시작할 수 있고(끝없는 길 잠금과 무관), 스테이지 이름이 맞아야 한다', () => {
    const p = emptyProfile();
    expect(checkStart(p, DAILY_ID, 'rat', 'daily')).toBeNull();
    expect(checkStart(p, 'endless', 'rat', 'daily')).toBe('bad stage');
    expect(checkStart(p, DAILY_ID, 'rat', 'endless')).toBe('bad stage');
    expect(checkStart(p, 'endless', 'rat', 'endless')).toBe('endless locked');
    expect(checkStart(p, DAILY_ID, 'pig', 'daily')).toBe('leader locked');
  });

  it('엽전은 끝없는 길과 같고, 끝없는 길 최고 기록은 건드리지 않는다', () => {
    const p = emptyProfile();
    p.endless = { meters: 300, leader: 'ox' };
    const r = applyReport(p, report({}));
    expect(r.coins).toBe(endlessCoins(700, 1));
    expect(r.best).toBe(false);
    expect(p.endless).toEqual({ meters: 300, leader: 'ox' });
  });

  it('끝없는 길과 같은 검사: 클리어 불가, 시간보다 먼 거리 불가, 모드와 스테이지가 어긋나면 불가', () => {
    expect(checkReport(report({}))).toBeNull();
    expect(checkReport(report({ cleared: true }))).toBe('bad result');
    expect(checkReport(report({ meters: 5000, time: 60 }))).toBe('bad result');
    expect(checkReport(report({ bosses: 9 }))).toBe('bad result');
    expect(checkReport(report({ stage: 'endless' }))).toBe('bad stage');
    expect(checkReport(report({ mode: 'endless' }))).toBe('bad stage');
    expect(checkReport(report({ mode: 'normal' }))).toBe('bad stage');
  });

  it('테스트 모드: 서버 없이 시작·끝 (기록은 남기지 않는다)', async () => {
    const mem = new Map<string, string>();
    const api = createLocalApi({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) });
    const run = await api.start(DAILY_ID, 'rat', 'daily');
    const out = await api.finish(report({ run }));
    expect(out?.result.coins).toBe(endlessCoins(700, 1));
    expect(out?.result.daily ?? null).toBeNull();
    expect(out?.profile.endless).toBeNull();
  });
});

describe('오늘의 길: 순위 읽기', () => {
  it('daily_ranking 답을 화면용으로', () => {
    const r = normalizeDaily({
      day: DAY, today: DAY, total: 12,
      top: [
        { place: 1, nickname: '가', score: 900, detail: { meters: 900, kills: 140 }, me: false },
        { place: 2, nickname: '나', score: 700, detail: { meters: 700, kills: 80 }, me: true },
        { place: 0, nickname: 'x', score: 1 },
      ],
      mine: { place: 2, score: 700, detail: { kills: 80 }, plays: 3 },
    })!;
    expect(r.top).toEqual([
      { place: 1, nickname: '가', meters: 900, kills: 140, me: false },
      { place: 2, nickname: '나', meters: 700, kills: 80, me: true },
    ]);
    expect(r.mine).toEqual({ place: 2, meters: 700, kills: 80, plays: 3 });
    expect(placeText(r)).toBe('오늘 2위 · 12명 중');
  });

  it('기록된 날이 서버의 오늘이 아니면 "오늘" 대신 날짜로', () => {
    const ans = { day: DAY, total: 5, top: [{ place: 3, nickname: '나', score: 500, me: true }], mine: { place: 3, score: 500, plays: 1 } };
    const past = normalizeDaily({ ...ans, today: NEXT })!;
    expect(isPastDay(past)).toBe(true);
    expect(placeText(past)).toBe('11월 23일 3위 · 5명 중');
    // 서버의 오늘과 같거나, 답에 오늘이 없으면(모르면) 오늘로
    expect(placeText(normalizeDaily({ ...ans, today: DAY })!)).toBe('오늘 3위 · 5명 중');
    const unknown = normalizeDaily({ ...ans, today: 'x' })!;
    expect(unknown.today).toBeNull();
    expect(isPastDay(unknown)).toBe(false);
    expect(placeText(unknown)).toBe('오늘 3위 · 5명 중');
  });

  it('기록이 없거나 모양이 이상하면 조용히', () => {
    expect(normalizeDaily(null)).toBeNull();
    expect(normalizeDaily({ day: 'x', top: [] })).toBeNull();
    expect(normalizeDaily({ day: DAY })).toBeNull();
    const empty = normalizeDaily({ day: DAY, top: [], mine: null, total: 0 })!;
    expect(empty).toEqual({ day: DAY, today: null, top: [], total: 0, mine: null });
    expect(placeText(empty)).toBe('');
  });

  it('날짜 글', () => {
    expect(isDay(DAY)).toBe(true);
    expect(isDay('2026-1-1')).toBe(false);
    expect(isDay(null)).toBe(false);
    expect(dayLabel('2026-01-05')).toBe('1월 5일');
    expect(dayLabel('')).toBe('');
  });
});

describe('SQL 085', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/085_charge_daily.sql', import.meta.url), 'utf8');
  it('오늘 순위에는 거리(m)를 넣고, 엽전 식은 끝없는 길과 같다', () => {
    expect(sql).toContain("public._daily_record(me, 'charge', p_meters::bigint,");
    expect(sql.match(/raw := floor\(p_meters \/ 20\.0\) \+ 5 \* p_bosses;/g)).toHaveLength(2);
    expect(sql).toContain("p_mode not in ('normal', 'endless', 'daily')");
    expect(sql).toContain("check (mode in ('normal', 'endless', 'daily'))");
  });
});

describe('SQL 088: 오늘의 길 날짜는 기기가 코스를 만든 날짜로', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/088_charge_daily_day.sql', import.meta.url), 'utf8');
  it('옛 시그니처를 지우고(오버로드 금지) 날짜를 저장해 그 날짜로 적는다', () => {
    expect(sql).toContain('drop function if exists public.charge_start(text, text, text);');
    expect(sql).toContain("p_mode text default 'normal', p_day text default null) returns uuid");
    expect(sql).toContain('values (me, p_stage, p_leader, p_mode, d_day)');
    expect(sql).toContain("d_day := coalesce(rn.daily_day, (rn.started_at at time zone 'Asia/Seoul')::date);");
    expect(sql).toContain("public._daily_record(me, 'charge', p_meters::bigint,");
  });

  it('기기는 오늘의 길에서만 p_day 를 보내고, bad day 는 거절로 읽는다', async () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const calls: Record<string, unknown>[] = [];
    let error: { message: string } | null = null;
    const api = createSupabaseApi({ rpc: async (_fn: string, args?: Record<string, unknown>) => (calls.push(args ?? {}), { data: 'run-1', error }) }, 'u1', store);
    await api.start(DAILY_ID, 'rat', 'daily', DAY);
    await api.start('1-1', 'rat', 'normal', DAY);
    await api.start('endless', 'rat', 'endless');
    expect(calls[0]).toEqual({ p_stage: DAILY_ID, p_leader: 'rat', p_mode: 'daily', p_day: DAY });
    expect(calls[1]).toEqual({ p_stage: '1-1', p_leader: 'rat', p_mode: 'normal' });
    expect(calls[2]).toEqual({ p_stage: 'endless', p_leader: 'rat', p_mode: 'endless' });
    error = { message: 'bad day' };
    const e = await api.start(DAILY_ID, 'rat', 'daily', DAY).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).message).toBe('bad day');
  });
});
