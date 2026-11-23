import { describe, expect, it } from 'vitest';
import { EMOTES, EMOTE_GAP_MS, EMOTE_RECV_GAP_MS, EMOTE_SHOW_MS, EmoteGate, emoteMsg, emoteText, readEmote } from '../src/game/emote';

describe('이모티콘: 말 목록과 시간', () => {
  it('정해진 말 여섯 개, 1.5초 간격, 2.5초 표시', () => {
    expect([...EMOTES]).toEqual(['ㅋㅋ', '나이스!', '아깝다', '한 판 더!', '헉', 'ㅠㅠ']);
    expect(EMOTE_GAP_MS).toBe(1500);
    expect(EMOTE_SHOW_MS).toBe(2500);
    expect(EMOTE_RECV_GAP_MS).toBeLessThan(EMOTE_GAP_MS);
  });

  it('번호 → 말. 없는 번호·숫자가 아닌 값은 null', () => {
    expect(emoteText(0)).toBe('ㅋㅋ');
    expect(emoteText(5)).toBe('ㅠㅠ');
    for (const bad of [-1, 6, 1.5, NaN, Infinity, '1', null, undefined, {}]) expect(emoteText(bad)).toBeNull();
  });
});

describe('이모티콘: 간격 제한', () => {
  it('한 번 보낸 뒤 1.5초가 지나야 다음 것이 나간다', () => {
    const g = new EmoteGate();
    expect(g.leftMs(1000)).toBe(0);
    expect(g.pass(1000)).toBe(true);
    expect(g.pass(1001)).toBe(false);
    expect(g.pass(2499)).toBe(false);
    expect(g.leftMs(2000)).toBe(500);
    expect(g.pass(2500)).toBe(true);
    // 막힌 시도는 시간을 다시 재지 않는다 (계속 눌러도 1.5초 뒤에는 나간다)
    expect(g.pass(3900)).toBe(false);
    expect(g.pass(4000)).toBe(true);
  });

  it('시계가 거꾸로 가도 영영 막히지 않는다', () => {
    const g = new EmoteGate();
    expect(g.pass(10_000)).toBe(true);
    expect(g.pass(5)).toBe(true);
  });

  it('받는 쪽은 조금 느슨하게 (지연으로 간격이 좁혀져 와도 받는다), 마구 보내는 것은 버린다', () => {
    const g = new EmoteGate(EMOTE_RECV_GAP_MS);
    expect(g.pass(0)).toBe(true);
    expect(g.pass(300)).toBe(false);
    expect(g.pass(1200)).toBe(true);
  });
});

describe('이모티콘: 받은 메시지 검사', () => {
  it('상대가 보낸 것만, 있는 번호만 받는다', () => {
    expect(emoteMsg('L', 3)).toEqual({ t: 'emo', from: 'L', i: 3 });
    // 통신을 거친 것과 같은 모양
    const wire = JSON.parse(JSON.stringify(emoteMsg('L', 3))) as unknown;
    expect(readEmote(wire, 'L')).toBe(3);
    expect(readEmote(emoteMsg('L', 0), 'L')).toBe(0);
    // 다른 사람(구경꾼)·내가 보낸 것·상대를 모르는 경우
    expect(readEmote(emoteMsg('X', 3), 'L')).toBe(-1);
    expect(readEmote(emoteMsg('L', 3), undefined)).toBe(-1);
    // 없는 번호·이상한 값·다른 종류의 메시지
    for (const i of [6, -1, 2.5, '2', null]) expect(readEmote({ t: 'emo', from: 'L', i }, 'L')).toBe(-1);
    expect(readEmote({ t: 'pos', from: 'L', i: 1 }, 'L')).toBe(-1);
    expect(readEmote(null, 'L')).toBe(-1);
    expect(readEmote('emo', 'L')).toBe(-1);
  });
});
