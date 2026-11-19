import { describe, expect, it } from 'vitest';
import { kstHour, skyAt } from '../src/scenes/sky';

describe('9단계: 낮 · 저녁 · 밤 (한국 시간)', () => {
  it('서버 시각을 한국 시각으로 본다', () => {
    expect(kstHour(Date.UTC(2026, 10, 19, 13, 30))).toBeCloseTo(22.5);
    expect(kstHour(Date.UTC(2026, 10, 19, 20, 0))).toBeCloseTo(5);
  });
  it('낮은 덮지 않고, 저녁은 노을빛, 밤은 등불이 켜진다', () => {
    expect(skyAt(12)).toMatchObject({ phase: 'day', alpha: 0, glow: 0 });
    expect(skyAt(18).phase).toBe('evening');
    expect(skyAt(22)).toMatchObject({ phase: 'night', glow: 1 });
    expect(skyAt(3).phase).toBe('night');
    expect(skyAt(6).phase).toBe('evening');
    // 시간 사이에서 부드럽게 바뀐다
    expect(skyAt(17.5).alpha).toBeGreaterThan(0);
    expect(skyAt(17.5).alpha).toBeLessThan(skyAt(18).alpha);
  });
});
