import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RANDOM_TANK_IDS } from '../src/game/data';
import { LOCK_HINT, initUnlock, isLockedError, isTankOpen, onUnlockChange, openTankOr, setAllOpen, setOwned } from '../src/game/unlock';
import { friendly } from '../src/net/backend';

describe('고양이 탱크 잠금', () => {
  it('12지신·랜덤은 늘 열려 있고, 고양이는 연 사람만. 열두빛은 고를 수 없다', () => {
    setAllOpen(false);
    setOwned([]);
    for (const t of RANDOM_TANK_IDS) expect(isTankOpen(t)).toBe(true);
    expect(isTankOpen('random')).toBe(true);
    expect(isTankOpen('zodiac')).toBe(false);
    expect(isTankOpen('cat')).toBe(false);
    expect(isTankOpen('nope')).toBe(false);
    expect(openTankOr('cat')).toBe('tiger');
    expect(openTankOr('random')).toBe('random');
    setOwned(['cat']);
    expect(isTankOpen('cat')).toBe(true);
    expect(openTankOr('cat')).toBe('cat');
    setOwned([]);
  });
  it('연 목록이 바뀔 때만 화면에 알린다', () => {
    setOwned([]);
    let n = 0;
    const off = onUnlockChange(() => n++);
    setOwned([]);
    setOwned(['cat']);
    setOwned(['cat', 'cat']);
    setOwned([]);
    off();
    setOwned(['cat']);
    expect(n).toBe(2);
    setOwned([]);
  });
  it('테스트 모드: 서버를 부르지 않고 열림, &cat=0 이면 잠김', async () => {
    let called = 0;
    const load = async () => (called++, ['cat']);
    await initUnlock(load, true, null);
    expect(isTankOpen('cat')).toBe(true);
    await initUnlock(load, true, '0');
    expect(isTankOpen('cat')).toBe(false);
    expect(called).toBe(0);
    await initUnlock(load, false, null);
    expect(called).toBe(1);
    expect(isTankOpen('cat')).toBe(true);
    setOwned([]);
  });
  it('서버 거절 locked character 는 화면 문구로, 안내 글은 shared/characters.js 와 같다', () => {
    expect(isLockedError('locked character')).toBe(true);
    expect(isLockedError('bad character')).toBe(false);
    expect(friendly(new Error('locked character'))).toBe('고양이는 로비에서 시아코인으로 열 수 있어요');
    const shared = readFileSync(new URL('../../../shared/characters.js', import.meta.url), 'utf8');
    expect(shared).toContain(`LOCK_HINT = '${LOCK_HINT}'`);
  });
});
