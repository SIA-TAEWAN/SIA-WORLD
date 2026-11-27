// 121_ace.sql 과 클라이언트가 같은 규칙을 쓰는지 (한계값 · 기체 해금 · 고양이 게임 목록) + 테스트 모드 API 흐름
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LIMITS, SHIP_BY_STAGE, createLocalApi, scoreCap, type Store } from '../src/net/api';
import { SHIPS, SHIP_ORDER } from '../src/data/ships';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SQL = readFileSync(ROOT + 'supabase/migrations/121_ace.sql', 'utf8');
const CHARS = readFileSync(ROOT + 'shared/characters.js', 'utf8');

describe('121_ace.sql 과 같은 규칙', () => {
  it('_ace_const = LIMITS', () => {
    const m = SQL.match(/_ace_const\(\)[\s\S]*?select '(\{[^']+\})'::jsonb/);
    expect(m).toBeTruthy();
    expect(JSON.parse(m![1])).toEqual(LIMITS);
  });

  it('기체 해금 스테이지 = ships.ts 의 unlock', () => {
    const m = SQL.match(/_ace_ship_unlock[\s\S]*?select case p_ship([\s\S]*?)else null end/);
    const table: Record<string, number> = {};
    for (const [, id, n] of m![1].matchAll(/when '(\w+)' then (-?\d+)/g)) table[id] = Number(n);
    for (const id of SHIP_ORDER) {
      const u = SHIPS[id].unlock;
      expect(table[id], id).toBe(u === 'buy' ? -1 : u);
    }
  });

  it('스테이지 n 클리어로 열리는 기체 목록이 같다', () => {
    const m = SQL.match(/unnest\(array\[([^\]]+)\]\)/);
    expect(m![1].split(',').map(s => s.trim().replace(/'/g, ''))).toEqual(SHIP_BY_STAGE);
    SHIP_BY_STAGE.forEach((id, i) => expect(SHIPS[id].unlock).toBe(i + 1));
  });

  it("고양이를 살 수 있는 게임 목록에 'ace' (SQL · shared/characters.js 둘 다)", () => {
    const sql = SQL.match(/_character_games\(\)[\s\S]*?array\[([^\]]+)\]/)![1];
    const js = CHARS.match(/CHARACTER_GAMES = \[([^\]]+)\]/)![1];
    const list = (s: string) => s.split(',').map(v => v.trim().replace(/'/g, ''));
    expect(list(sql)).toContain('ace');
    expect(list(js)).toEqual(list(sql));
  });

  it('점수 상한: 스테이지 12까지 = 12 × 60만 + 5만 × 78', () => {
    expect(scoreCap(12)).toBe(12 * 600000 + 50000 * 78);
    expect(scoreCap(1)).toBe(650000);
  });
});

describe('테스트 모드 API (서버와 같은 흐름)', () => {
  const mem = (): Store => { const m = new Map<string, string>(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

  it('잠긴 기체 · 모드는 거절, 스테이지를 깨면 열리고, 판마다 시아코인 +1', async () => {
    let t = 0;
    const api = createLocalApi(mem(), 'k', () => t);
    await expect(api.start('arcade', 'normal', 'tiger', 1)).rejects.toThrow('locked ship');
    await expect(api.start('rush', 'normal', 'dragon', 1)).rejects.toThrow('locked mode');
    const run = await api.start('arcade', 'normal', 'dragon', 1);
    await expect(api.clear(run, 1)).rejects.toThrow('too fast');
    t = 120_000;
    expect(await api.clear(run, 1)).toEqual({ cleared: 1, unlocked: 'tiger' });
    await expect(api.clear(run, 1)).rejects.toThrow('bad stage');
    const r = await api.finish(run, { score: 200000, rankScore: 150000, kills: 300, seconds: 110, stage: 2, done: false });
    expect(r).toEqual({ gotCoin: true, siaCoins: 101, best: 150000 });
    const s = await api.state();
    expect([s.cleared, s.best.normal]).toEqual([1, 150000]);
    await expect(api.start('arcade', 'normal', 'tiger', 1)).resolves.toBeTruthy();
  });

  it('불가능한 기록은 거절 (실제 시간보다 긴 게임 시간 · 점수 상한)', async () => {
    let t = 0;
    const api = createLocalApi(mem(), 'k', () => t);
    const run = await api.start('arcade', 'easy', 'rat', 1);
    t = 60_000;
    await expect(api.finish(run, { score: 1000, rankScore: 1000, kills: 10, seconds: 600, stage: 1, done: false })).rejects.toThrow('too fast');
    await expect(api.finish(run, { score: 9_000_000, rankScore: 1000, kills: 10, seconds: 50, stage: 1, done: false })).rejects.toThrow('bad score');
  });
});
