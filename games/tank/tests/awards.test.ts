import { describe, expect, it } from 'vitest';
import { newAwardStats, parseAwardStats, pickAwards, recordSelfFall, recordShot, type TankBefore } from '../src/game/awards';
import { EMOTES, EMOTE_COOLDOWN_MS, EmoteGate, parseEmote } from '../src/game/emote';
import { Match } from '../src/game/match';
import { Rng } from '../src/game/rng';
import type { PlayerSetup, SimEvent } from '../src/game/types';
import { decideMove, decideShot } from '../src/ai/ai';
import { RoomSession } from '../src/net/room';
import type { Backend, Channel, NetMsg } from '../src/net/backend';

/** 0·1번은 0팀, 2번은 1팀 (0번 x=100, 1번 x=200, 2번 x=500) */
const before = (): TankBefore[] => [
  { idx: 0, team: 0, x: 100, y: 300, hp: 100, alive: true },
  { idx: 1, team: 0, x: 200, y: 300, hp: 100, alive: true },
  { idx: 2, team: 1, x: 500, y: 600, hp: 100, alive: true },
];
const dmg = (target: number, amount: number, direct = false, f = 10): SimEvent => ({ f, type: 'damage', target, amount, direct });
const death = (target: number, f = 10): SimEvent => ({ f, type: 'death', target });
const title = (s: ReturnType<typeof newAwardStats>) => Object.fromEntries(pickAwards(s).map((a) => [a.id, a]));

describe('판 끝 상장: 집계', () => {
  it('적에게 준 피해·직격·가장 먼 직격 거리를 쏜 탱크에 더한다', () => {
    const s = newAwardStats(3);
    recordShot(s, 0, before(), [dmg(2, 30, true), dmg(2, 12)]);
    expect(s.damage).toEqual([42, 0, 0]);
    expect(s.directs).toEqual([1, 0, 0]);
    expect(s.longest[0]).toBeCloseTo(500); // (400, 300) 떨어진 곳
    // 더 가까운 직격은 기록을 줄이지 않는다
    recordShot(s, 0, [before()[0], before()[1], { ...before()[2], x: 130, y: 300 }], [dmg(2, 5, true)]);
    expect(s.directs[0]).toBe(2);
    expect(s.longest[0]).toBeCloseTo(500);
  });

  it('우리 팀이 맞은 것은 피해·직격으로 세지 않고, 내가 맞은 것은 자폭으로 센다', () => {
    const s = newAwardStats(3);
    recordShot(s, 0, before(), [dmg(1, 40, true), dmg(0, 25, true)]);
    expect(s.damage).toEqual([0, 0, 0]);
    expect(s.directs).toEqual([0, 0, 0]);
    expect(s.selfDamage).toEqual([25, 0, 0]);
    expect(s.longest).toEqual([0, 0, 0]);
  });

  it('지속 피해는 결과 표와 같게 그 차례의 탱크에 더한다', () => {
    const s = newAwardStats(3);
    recordShot(s, 0, before(), [{ f: 50, type: 'dot', target: 2, amount: 4, kind: 'fire', last: false }]);
    expect(s.damage).toEqual([4, 0, 0]);
  });

  it('체력이 남았는데 죽으면 낙사: 적이면 낙사 유발, 나 자신이면 남은 체력만큼 자폭', () => {
    const s = newAwardStats(3);
    // 적: 피해 20을 입고 떨어짐 → 낙사 유발 1
    recordShot(s, 0, before(), [dmg(2, 20), death(2, 90)]);
    expect(s.fallKills).toEqual([1, 0, 0]);
    // 적: 체력이 다 닳아 죽음 → 낙사가 아니다
    recordShot(s, 1, before(), [dmg(2, 100), death(2)]);
    expect(s.fallKills).toEqual([1, 0, 0]);
    // 나: 수리킷으로 20 회복(체력 80 → 100) 뒤 10 맞고 발밑이 꺼져 떨어짐 → 자폭 10 + 남은 체력 90
    const b = before();
    b[0].hp = 80;
    recordShot(s, 0, b, [{ f: 0, type: 'heal', target: 0, amount: 20 }, dmg(0, 10), death(0, 90)]);
    expect(s.selfDamage[0]).toBe(100);
    // 우리 팀이 떨어진 것은 어느 칭호에도 넣지 않는다
    recordShot(s, 0, before(), [death(1, 90)]);
    expect(s.fallKills).toEqual([1, 0, 0]);
  });

  it('이동하다 스스로 떨어지면 잃은 체력만큼 자폭', () => {
    const s = newAwardStats(2);
    recordSelfFall(s, 1, 70);
    recordSelfFall(s, 5, 70); // 없는 탱크는 무시
    expect(s.selfDamage).toEqual([0, 70]);
  });

  it('백발백중: 과녁을 맞힌 거리로 최장거리만 센다', () => {
    const s = newAwardStats(3);
    recordShot(s, 0, before(), [{ f: 30, type: 'target', id: 1, by: 0, x: 100, y: 0, points: 200 }]);
    expect(s.longest[0]).toBeCloseTo(300);
    expect(pickAwards(s).map((a) => a.id)).toEqual(['long']);
  });
});

describe('판 끝 상장: 칭호 고르기', () => {
  it('아무 기록이 없으면 칭호도 없다', () => {
    expect(pickAwards(newAwardStats(4))).toEqual([]);
  });

  it('해당자가 없는 칭호는 빼고, 한 사람이 여러 칭호를 받을 수 있다', () => {
    const s = newAwardStats(3);
    recordShot(s, 0, before(), [dmg(2, 30, true)]);
    const a = title(s);
    expect(Object.keys(a).sort()).toEqual(['damage', 'direct', 'long']);
    expect(a.damage.holders).toEqual([0]);
    expect(a.direct.holders).toEqual([0]);
    expect(a.long.holders).toEqual([0]);
    expect(a.damage.title).toBe('최다 피해');
    expect(a.direct.text).toBe('직격 1번');
    expect(a.long.text).toBe('50m');
  });

  it('기록이 같으면 함께 받는다', () => {
    const s = newAwardStats(3);
    s.directs = [2, 0, 2];
    s.damage = [10, 0, 90];
    const a = title(s);
    expect(a.direct.holders).toEqual([0, 2]);
    expect(a.damage.holders).toEqual([2]);
  });

  it('다섯 칭호가 정해진 순서로 나온다', () => {
    const s = newAwardStats(2);
    s.damage = [5, 1];
    s.directs = [0, 1];
    s.fallKills = [1, 0];
    s.selfDamage = [0, 9];
    s.longest = [0, 321];
    expect(pickAwards(s).map((a) => a.title)).toEqual(['최다 피해', '직격왕', '낙사 유발', '자폭왕', '최장거리 명중']);
  });

  it('다른 기기에서 받은 집계는 모양이 맞을 때만 쓴다', () => {
    const s = newAwardStats(2);
    s.damage = [3, 4];
    expect(parseAwardStats(JSON.parse(JSON.stringify(s)), 2)).toEqual(s);
    expect(parseAwardStats(undefined, 2)).toBeNull();
    expect(parseAwardStats(s, 3)).toBeNull();
    expect(parseAwardStats({ ...s, directs: [1, -1] }, 2)).toBeNull();
    expect(parseAwardStats({ ...s, longest: ['a', 1] }, 2)).toBeNull();
  });
});

describe('판 끝 상장: 판 진행과 함께', () => {
  const setups = (): PlayerSetup[] => [
    { name: 'A', tank: 'tiger', team: 0, ai: 'hard', items: [] },
    { name: 'B', tank: 'rooster', team: 1, ai: 'hard', items: [] },
  ];
  /** AI끼리 한 판. at 턴에서 판 상태를 저장했다 되살려 이어 간다 (다시 맞추기). track=false 면 집계를 매 턴 지운다 */
  const play = (at = -1, track = true) => {
    let m = new Match(setups(), 'valley', 42);
    const rng = new Rng(42 ^ 0x9e3779b9);
    let turns = 0;
    while (!m.over && turns < 200) {
      m.startTurn();
      turns++;
      if (!track) m.awards = newAwardStats(2);
      const mv = decideMove(m, 'hard', rng);
      for (let i = 0; i < Math.abs(mv); i++) if (!m.moveStep(mv > 0 ? 1 : -1)) break;
      if (m.over) break;
      m.fire(decideShot(m, 'hard', rng));
      if (turns === at) m = Match.fromSnapshot(JSON.parse(JSON.stringify(m.snapshot())));
    }
    return m;
  };

  it('집계한 피해가 결과 표의 가한 피해와 같고, 집계가 판 결과를 바꾸지 않는다', () => {
    const m = play();
    expect(m.over).toBe(true);
    expect(m.awards.damage).toEqual(m.tanks.map((t) => t.damageDealt));
    expect(m.awards.damage.some((d) => d > 0)).toBe(true);
    expect(pickAwards(m.awards).some((a) => a.id === 'damage')).toBe(true);
    // 집계를 매 턴 지우며 돌려도 판 상태 지문이 같다 (집계는 시뮬레이션에 쓰이지 않는다)
    expect(play(-1, false).stateHash()).toBe(m.stateHash());
  }, 30_000);

  it('판 상태를 다시 받아도(스냅샷) 집계가 이어진다', () => {
    const a = play();
    const b = play(3);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.awards).toEqual(a.awards);
  }, 30_000);

  it('예전 판본이 보낸 판 상태(집계 없음)도 받아서 0부터 센다', () => {
    const m = new Match(setups(), 'valley', 7);
    const snap = JSON.parse(JSON.stringify(m.snapshot()));
    delete snap.awards;
    expect(Match.fromSnapshot(snap).awards).toEqual(newAwardStats(2));
  });
});

describe('빠른 감정 표현', () => {
  it('문구 6개, 모르는 번호는 버린다', () => {
    expect([...EMOTES]).toEqual(['ㅋㅋ', '나이스!', '아깝다', '한 판 더!', '헉', 'ㅠㅠ']);
    expect(parseEmote(0)).toBe(0);
    expect(parseEmote(5)).toBe(5);
    for (const v of [6, -1, 1.5, '1', null, undefined, NaN]) expect(parseEmote(v)).toBeNull();
  });

  it('1.5초에 한 번만 보낼 수 있다', () => {
    const g = new EmoteGate();
    expect(EMOTE_COOLDOWN_MS).toBe(1500);
    expect(g.try(1000)).toBe(true);
    expect(g.try(2499)).toBe(false);
    expect(g.left(2000)).toBe(500);
    expect(g.try(2500)).toBe(true);
    expect(g.left(4000)).toBe(0);
  });

  /** 가짜 방 채널: 보낸 메시지를 모으고, 받은 것처럼 넣어 줄 수 있다 */
  const fakeRoom = (me = 'me') => {
    const sent: NetMsg[] = [];
    let onMsg: (m: NetMsg) => void = () => undefined;
    const ch: Channel<unknown> = {
      onPresence: () => undefined,
      onMessage: (cb) => void (onMsg = cb),
      join: async () => undefined,
      track: async () => undefined,
      send: (m) => void sent.push(m),
      leave: async () => undefined,
    };
    const room = new RoomSession({ channel: () => ch } as unknown as Backend, 'r1', { id: me, name: '나' });
    return { room, sent, recv: (m: NetMsg) => onMsg(m) };
  };

  it('방 채널: 감정 표현을 보내고(간격 제한), 받은 것은 게임 메시지와 섞이지 않게 따로 알린다', () => {
    const { room, sent, recv } = fakeRoom();
    expect(room.sendEmote(1)).toBe(true);
    expect(room.sendEmote(2)).toBe(false); // 바로 또 누르면 보내지 않는다
    expect(room.sendEmote(99)).toBe(false);
    expect(sent).toEqual([{ t: 'emote', from: 'me', i: 1 }]);

    const got: [string, number][] = [];
    const game: NetMsg[] = [];
    room.onEmote((from, i) => got.push([from, i]));
    room.on((m) => game.push(m));
    recv({ t: 'emote', from: 'you', i: 3 });
    recv({ t: 'emote', from: 'you', i: 4 }); // 너무 잦은 것은 버린다
    recv({ t: 'emote', from: 'she', i: 0 });
    recv({ t: 'emote', from: 'you', i: 42 }); // 모르는 번호
    recv({ t: 'emote', from: 'me', i: 1 }); // 내가 보낸 것이 되돌아와도 두 번 띄우지 않는다
    recv({ t: 'emote', i: 1 });
    expect(got).toEqual([
      ['you', 3],
      ['she', 0],
    ]);
    expect(game).toEqual([]);
    recv({ t: 'turn', g: 1 });
    expect(game).toHaveLength(1);
  });
});
