import { describe, expect, it } from 'vitest';
import { clearCoins, endlessCoins, failCoins, firstCoins } from '../src/data/growth';
import { createLocalApi } from '../src/net/api';
import { applyReport, checkStart, emptyProfile, leadersOf, regionOpen, stageOpen, type RunReport } from '../src/game/progress';

const report = (o: Partial<RunReport>): RunReport => ({
  run: 'r', stage: '1-1', leader: 'rat', mode: 'normal', time: 58, cleared: true, troops: 120, kills: 50, progress: 1, meters: 0, bosses: 0, crate: 0, ...o,
});

describe('판 밖 기록', () => {
  it('클리어 엽전 + 첫 클리어 보너스, 두 번째는 보너스 없음 (서버와 같은 값)', () => {
    const p = emptyProfile();
    const a = applyReport(p, report({}));
    expect(a).toMatchObject({ coins: clearCoins(1, 3) + firstCoins(1), stars: 3, first: true });
    expect(a.coins).toBe(65);
    const b = applyReport(p, report({}));
    expect(b.coins).toBe(clearCoins(1, 3));
    expect(b.first).toBe(false);
  });

  it('실패는 진행도만큼 조금, 끝없는 모드는 거리와 보스', () => {
    const p = emptyProfile();
    expect(applyReport(p, report({ cleared: false, troops: 0, progress: 0.5, time: 30 })).coins).toBe(failCoins(1, 0.5));
    p.stages['1-5'] = 1;
    expect(applyReport(p, report({ stage: 'endless', mode: 'endless', cleared: false, meters: 700, bosses: 1, time: 120 })).coins).toBe(endlessCoins(700, 1));
    expect(p.endless).toEqual({ meters: 700, leader: 'rat' });
  });

  it('너무 빨리 클리어하거나 너무 멀리 달린 기록은 받지 않는다', () => {
    const p = emptyProfile();
    expect(() => applyReport(p, report({ time: 20 }))).toThrow();
    expect(() => applyReport(p, report({ stage: 'endless', mode: 'endless', cleared: false, meters: 5000, time: 60 }))).toThrow();
  });

  it('스테이지·지역·대장 열림', () => {
    const p = emptyProfile();
    expect(stageOpen(p, '1-1')).toBe(true);
    expect(stageOpen(p, '1-2')).toBe(false);
    for (const id of ['1-1', '1-2', '1-3', '1-4', '1-5']) p.stages[id] = 1;
    expect(regionOpen(p, 2)).toBe(false); // 별 5개 < 9
    for (const id of ['1-1', '1-2', '1-3', '1-4', '1-5']) p.stages[id] = 2;
    expect(regionOpen(p, 2)).toBe(true);
    expect(leadersOf(p)).toContain('rabbit');
    expect(checkStart(p, '2-1', 'rabbit', 'normal')).toBeNull();
    expect(checkStart(p, '2-2', 'rat', 'normal')).toBe('stage locked');
    expect(checkStart(p, '1-1', 'dragon', 'normal')).toBe('leader locked');
  });

  it('테스트 모드 저장: 강화를 사면 엽전이 줄고, 모자라면 거절', async () => {
    const mem = new Map<string, string>();
    const api = createLocalApi({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) });
    await expect(api.buyUpgrade('attack')).rejects.toThrow('not enough coins');
    const run = await api.start('1-1', 'rat', 'normal');
    await api.finish(report({ run }));
    const p = await api.buyUpgrade('troops');
    expect(p.upgrades.troops).toBe(1);
    expect(p.coins).toBe(65 - 60);
  });
});
