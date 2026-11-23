import { describe, expect, it } from 'vitest';
import { CHAR_IDS, ZODIAC_IDS } from '../src/game/constants';
import { LOCK_HINT, initUnlock, isCharOpen, isLockedError, onUnlockChange, openOr, setAllOpen, setOwned } from '../src/game/unlock';
import { readFileSync } from 'node:fs';

describe('고양이 잠금', () => {
  it('십이지는 늘 열려 있고, 고양이는 연 사람만', () => {
    setAllOpen(false);
    setOwned([]);
    for (const c of ZODIAC_IDS) expect(isCharOpen(c)).toBe(true);
    expect(isCharOpen('cat')).toBe(false);
    expect(isCharOpen('nope')).toBe(false);
    expect(openOr('cat')).toBe('tiger');
    setOwned(['cat']);
    expect(isCharOpen('cat')).toBe(true);
    expect(openOr('cat')).toBe('cat');
    expect(CHAR_IDS.every((c) => isCharOpen(c))).toBe(true);
    setOwned([]);
  });
  it('연 목록이 바뀔 때만 화면에 알린다', () => {
    setOwned([]);
    let n = 0;
    const off = onUnlockChange(() => n++);
    setOwned([]);
    setOwned(['cat']);
    setOwned(['cat']);
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
    expect(isCharOpen('cat')).toBe(true);
    await initUnlock(load, true, '0');
    expect(isCharOpen('cat')).toBe(false);
    expect(called).toBe(0);
    await initUnlock(load, false, null);
    expect(called).toBe(1);
    expect(isCharOpen('cat')).toBe(true);
    setOwned([]);
  });
  it('서버 거절 문구 알아보기, 안내 글은 shared/characters.js 와 같다', () => {
    expect(isLockedError('locked character')).toBe(true);
    expect(isLockedError('bad character')).toBe(false);
    expect(isLockedError(undefined)).toBe(false);
    const shared = readFileSync(new URL('../../../shared/characters.js', import.meta.url), 'utf8');
    expect(shared).toContain(`LOCK_HINT = '${LOCK_HINT}'`);
  });
});
