import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHAR_IDS, ZODIAC_IDS } from '../src/game/constants';
import { CAT_PRICE, GAME_ID, LOCKED_MSG, UNLOCK_LABEL, initUnlock, isCharOpen, isLockedError, onUnlockChange, openOr, setAllOpen, setOwned, unlockCat, CAT_NEED, condText, getProgress, progressDone, refreshProgress, setProgress } from '../src/game/unlock';

const reset = () => {
  setAllOpen(false);
  setOwned([]);
};

describe('고양이 잠금 (게임마다 따로)', () => {
  it('십이지는 늘 열려 있고, 고양이는 이 게임에서 연 사람만', () => {
    reset();
    for (const c of ZODIAC_IDS) expect(isCharOpen(c)).toBe(true);
    expect(isCharOpen('cat')).toBe(false);
    expect(isCharOpen('nope')).toBe(false);
    expect(openOr('cat')).toBe('tiger');
    setOwned(['cat']);
    expect(isCharOpen('cat')).toBe(true);
    expect(openOr('cat')).toBe('cat');
    expect(CHAR_IDS.every((c) => isCharOpen(c))).toBe(true);
    reset();
  });
  it('서버를 못 읽으면(null) 가진 목록을 그대로 둔다. 바뀔 때만 화면에 알린다', () => {
    reset();
    let n = 0;
    const off = onUnlockChange(() => n++);
    setOwned([]);
    setOwned(['cat']);
    setOwned(null);
    expect(isCharOpen('cat')).toBe(true);
    setOwned(['cat']);
    setOwned([]);
    off();
    setOwned(['cat']);
    expect(n).toBe(2);
    reset();
  });
  it('처음 불러오기: 이 게임 id 로 묻고, 못 읽으면 잠긴 것으로 시작', async () => {
    reset();
    const asked: string[] = [];
    await initUnlock(async (g) => (asked.push(g), null), false, null);
    expect(asked).toEqual([GAME_ID]);
    expect(isCharOpen('cat')).toBe(false);
    await initUnlock(async () => ['cat'], false, null);
    expect(isCharOpen('cat')).toBe(true);
    reset();
  });
  it('열기: 성공·이미 연 것이면 열린다, 시아코인이 모자라면 그대로', async () => {
    reset();
    let list: string[] = [];
    await initUnlock(async () => list, false, null);
    const games: string[] = [];
    const coin = await unlockCat(async (g) => (games.push(g), { ok: false, reason: 'coin', siaCoins: 20, price: CAT_PRICE }));
    expect(coin.opened).toBe(false);
    expect(isCharOpen('cat')).toBe(false);
    list = ['cat'];
    const ok = await unlockCat(async (g) => (games.push(g), { ok: true, siaCoins: 50, price: CAT_PRICE }));
    expect(ok.opened).toBe(true);
    expect(isCharOpen('cat')).toBe(true);
    reset();
    list = [];
    const owned = await unlockCat(async () => ({ ok: false, reason: 'owned' }));
    expect(owned.opened).toBe(true);
    expect(isCharOpen('cat')).toBe(true); // 다시 읽기가 [] 여도 산 것은 확실
    expect(games).toEqual([GAME_ID, GAME_ID]);
    reset();
  });
  it('테스트 모드: 기본은 열림, &cat=0 이면 잠김, 열기는 서버 없이 바로', async () => {
    let called = 0;
    const load = async () => (called++, ['cat']);
    await initUnlock(load, true, null);
    expect(isCharOpen('cat')).toBe(true);
    await initUnlock(load, true, '0');
    expect(isCharOpen('cat')).toBe(false);
    const r = await unlockCat(async () => {
      throw new Error('서버를 부르면 안 된다');
    });
    expect(r).toMatchObject({ opened: true, local: true });
    expect(isCharOpen('cat')).toBe(true);
    expect(called).toBe(0);
    reset();
  });
  it('글·가격은 shared/characters.js · 071 과 같다', () => {
    expect(isLockedError('locked character')).toBe(true);
    expect(isLockedError('bad character')).toBe(false);
    expect(LOCKED_MSG).toBe('고양이는 캐릭터 고르기 화면에서 시아코인 100개로 열 수 있어요');
    const shared = readFileSync(new URL('../../../shared/characters.js', import.meta.url), 'utf8');
    expect(shared).toMatch(new RegExp(String.raw`CHARACTER_PRICE = \{ cat: ${CAT_PRICE} \}`));
    expect(shared).toContain("unlockLabel = (id) => `시아코인 ${CHARACTER_PRICE[id] ?? ''}개로 열기`");
    expect(UNLOCK_LABEL).toBe(`시아코인 ${CAT_PRICE}개로 열기`);
    expect(shared).toContain(`'${GAME_ID}'`);
    const sql = readFileSync(new URL('../../../supabase/migrations/071_characters.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(new RegExp(String.raw`'cat'\s+then\s+${CAT_PRICE}`));
  });
});

describe('고양이 구매 조건 (이 게임 {CAT_NEED}판)', () => {
  it('조건 값은 072 의 _cat_progress_<게임> need 와 같다', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/072_cat_versus.sql', import.meta.url), 'utf8');
    const m = sql.match(new RegExp(String.raw`function public\._cat_progress_${GAME_ID}\(p_user uuid\)[\s\S]*?'need', (\d+)\)`));
    expect(m, '072 에 _cat_progress_' + GAME_ID + ' 가 있어야 한다').not.toBeNull();
    expect(Number(m![1])).toBe(CAT_NEED);
    expect(CAT_NEED).toBe(30);
  });
  it('남은 조건 글: 지금 값을 알면 함께, 모르면 조건만', () => {
    expect(condText(12)).toBe('시아배구 30판(AI전 포함)을 하면 열 수 있어요 · 지금 12판');
    expect(condText(null)).toBe('시아배구 30판(AI전 포함)을 하면 열 수 있어요');
  });
  it('테스트 모드 &cat=cond: 잠김 + 조건 미달(지금 12판), 열기는 조건 미달로 거절', async () => {
    await initUnlock(async () => [], true, 'cond');
    expect(isCharOpen('cat')).toBe(false);
    expect(getProgress()).toEqual({ have: 12, need: CAT_NEED });
    expect(progressDone()).toBe(false);
    const r = await unlockCat(async () => {
      throw new Error('서버를 부르면 안 된다');
    });
    expect(r.opened).toBe(false);
    expect(r.result.reason).toBe('condition');
    expect(isCharOpen('cat')).toBe(false);
    await initUnlock(async () => [], true, '0');
    expect(progressDone()).toBe(true);
  });
  it('서버: 진행을 읽어 두고, 구매가 condition 이면 서버 값으로 고친다. 못 읽으면(null) 그대로', async () => {
    setAllOpen(false);
    setOwned([]);
    let prog: { have: number; need: number; owned: string[] } | null = { have: 7, need: 30, owned: [] };
    await initUnlock(async () => [], false, null, async () => prog);
    expect(getProgress()).toEqual({ have: 7, need: 30 });
    prog = null;
    await refreshProgress();
    expect(getProgress()).toEqual({ have: 7, need: 30 });
    const r = await unlockCat(async () => ({ ok: false, reason: 'condition', have: 9, need: 30 }));
    expect(r.opened).toBe(false);
    expect(getProgress()).toEqual({ have: 9, need: 30 });
    setProgress({ have: 30, need: 30 });
    expect(progressDone()).toBe(true);
    // 진행에 owned 가 실려 오면 연 목록도 맞춘다
    prog = { have: 30, need: 30, owned: ['cat'] };
    await refreshProgress();
    expect(isCharOpen('cat')).toBe(true);
    setOwned([]);
  });
});
