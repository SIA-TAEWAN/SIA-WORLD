import { describe, expect, it } from 'vitest';
import { BALL_R, MOVE_SPEED, NET_X, PLAYER_MAX_X, RIGHT, START_X, WIN_SCORE } from '../src/game/constants';
import { NO_INPUT, createState, step } from '../src/game/sim';
import { AI_NORMAL, aiInput, makeAi, predictLanding } from '../src/game/ai';
import { ai, chaser, idle, playMatch, playSeries, playSeriesAsync, type Series } from './helpers';

describe('경기가 끝나는가', () => {
  it('가만히 있는 둘이 붙어도 경기는 끝난다 (서브 공이 머리 위에서 끝없이 튀지 않는다)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = playMatch(idle, idle, seed, 60 * 120);
      expect(m.winner).not.toBe(-1);
      expect(Math.max(...m.score)).toBe(WIN_SCORE);
      expect(Math.min(...m.score)).toBeLessThan(WIN_SCORE);
    }
  });
});

describe('AI', () => {
  it('공이 떨어질 곳을 내다본다 (벽에 튀는 것까지)', () => {
    // 똑바로 떨어지는 공
    expect(predictLanding({ x: 500, y: 200, vx: 0, vy: 0 }, 0)).toBeCloseTo(500, 6);
    // 오른쪽 벽에 튀어 돌아오는 공
    const x = predictLanding({ x: 600, y: 600, vx: 12, vy: -4 }, 0);
    expect(x).toBeLessThan(RIGHT - BALL_R);
    expect(x).toBeGreaterThan(NET_X);
    // 벽이 없다고 치고 똑바로 갔을 때와는 다르다
    expect(x).toBeLessThan(600 + 12 * 8);
  });

  it('공이 상대 코트에 있으면 자기 코트 가운데로 돌아간다', () => {
    const s = createState(1);
    const a = makeAi(1, 1);
    s.players[1].x = PLAYER_MAX_X[1];
    for (let i = 0; i < 120; i++) {
      s.ball = { x: 150, y: 150, vx: 0, vy: 0 }; // 왼쪽 코트 위에 떠 있는 공
      step(s, [NO_INPUT, aiInput(a, s)]);
    }
    expect(Math.abs(s.players[1].x - START_X[1])).toBeLessThanOrEqual(MOVE_SPEED);
  });

  it('공의 방향이 바뀌어도 0.15~0.25초 동안은 알아채지 못한다', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createState(1);
      const a = makeAi(1, seed);
      // 왼쪽 코트로 떨어지는 공을 지켜보다가
      s.ball = { x: 100, y: 60, vx: 0, vy: 0 };
      s.players[0].x = PLAYER_MAX_X[0];
      for (let i = 0; i < 30; i++) step(s, [NO_INPUT, aiInput(a, s)]);
      expect(s.players[1].x).toBe(START_X[1]);
      // 갑자기 오른쪽 코트 구석으로 오는 공으로 바뀐다
      s.ball = { x: 640, y: 150, vx: 0, vy: 0 };
      let moved = -1;
      for (let i = 0; i < 40 && moved < 0; i++) {
        const k = aiInput(a, s);
        if (k.left || k.right) moved = i;
        step(s, [NO_INPUT, k]);
      }
      expect(moved).toBeGreaterThanOrEqual(Math.round(AI_NORMAL.reactMin * 60));
      expect(moved).toBeLessThanOrEqual(Math.round(AI_NORMAL.reactMax * 60));
    }
  });

  it('예측 오차는 ±20px 안', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = createState(1);
      const a = makeAi(1, seed);
      s.ball = { x: 560, y: 150, vx: 0, vy: 0 };
      for (let i = 0; i < 20; i++) {
        aiInput(a, s);
        s.tick++;
        s.ball.vy += 0.45; // 중력만 받는 공으로 보이게
      }
      expect(Math.abs(a.landX - 560)).toBeLessThanOrEqual(20);
    }
  });

  it('속도 상한에 걸려 떨어지는 공은 "방향이 바뀐 것"으로 보지 않는다 (그래야 그 공에도 점프한다)', () => {
    const s = createState(1);
    const a = makeAi(1, 3);
    // 오른쪽 코트 위에서 상한 속도(20)로 똑바로 떨어지는 공: 매 틱 중력이 붙었다가 다시 20으로 깎인다
    s.ball = { x: 560, y: 60, vx: 0, vy: 20 };
    let rearmed = 0;
    for (let i = 0; i < 24; i++) {
      aiInput(a, s);
      if (i > 16 && a.noticeAt >= 0) rearmed++;
      s.tick++;
      s.ball.y += 20;
      s.ball.vy = Math.min(20, s.ball.vy + 0.45);
    }
    // 처음 한 번 알아챈 뒤에는 다시 '알아채는 중'으로 돌아가지 않는다
    expect(rearmed).toBe(0);
    // 비스듬히 상한에 걸린 공도 같다
    const t = createState(1);
    const b = makeAi(1, 4);
    t.ball = { x: 420, y: 60, vx: 12, vy: 16 };
    let re2 = 0;
    for (let i = 0; i < 20; i++) {
      aiInput(b, t);
      if (i > 16 && b.noticeAt >= 0) re2++;
      t.tick++;
      const vy = t.ball.vy + 0.45;
      const k = Math.min(1, 20 / Math.hypot(t.ball.vx, vy));
      t.ball.vx *= k;
      t.ball.vy = vy * k;
      t.ball.x += t.ball.vx;
      t.ball.y += t.ball.vy;
    }
    expect(re2).toBe(0);
  });

  it('AI 설정은 PRD 값: 반응 0.15~0.25초, 오차 ±20px', () => {
    expect(AI_NORMAL.reactMin).toBe(0.15);
    expect(AI_NORMAL.reactMax).toBe(0.25);
    expect(AI_NORMAL.error).toBe(20);
  });

  // AI 대 AI 400경기: 한 테스트에 몰면 일꾼을 15~30초 붙잡아 vitest 가 "Timeout calling onTaskUpdate" 로 멈출 수 있어
  // 100경기씩 네 묶음으로 나누고(경기마다 양보), 마지막에 합쳐서 본다. 씨앗은 예전 한 번에 돌릴 때(1 + i*101, i=0~399)와 같다
  describe('AI끼리 붙어도 경기가 끝나고, 한쪽으로 치우치지 않는다', () => {
    const CHUNK = 100;
    const parts: Series[] = [];
    for (let k = 0; k < 4; k++) {
      it(`${k * CHUNK + 1}~${(k + 1) * CHUNK}번째 경기: 모두 끝난다`, async () => {
        const r = await playSeriesAsync(ai(), ai(), CHUNK, 1 + k * CHUNK * 101);
        parts[k] = r;
        expect(r.unfinished).toBe(0);
      }, 120000);
    }
    it('400경기를 합치면 한쪽으로 치우치지 않는다', () => {
      expect(parts.filter(Boolean)).toHaveLength(4);
      const games = parts.reduce((n, r) => n + r.games, 0);
      const left = parts.reduce((n, r) => n + r.leftWins, 0);
      const right = parts.reduce((n, r) => n + r.rightWins, 0);
      const unfinished = parts.reduce((n, r) => n + r.unfinished, 0);
      const avg = parts.reduce((n, r) => n + r.avgSec * r.games, 0) / games;
      const longest = Math.max(...parts.map((r) => r.longestRallySec));
      console.log(`[AI 대 AI ${games}경기] 왼쪽 ${left}승 · 오른쪽 ${right}승 · 안 끝남 ${unfinished} · 평균 ${avg.toFixed(0)}초 · 가장 긴 랠리 ${longest.toFixed(0)}초`);
      expect(games).toBe(400);
      expect(unfinished).toBe(0);
      expect(left / games).toBeGreaterThan(0.42);
      expect(left / games).toBeLessThan(0.58);
    });
  });

  it('가만히 있는 상대에게는 거의 항상 이긴다', () => {
    const a = playSeries(idle, ai(), 200);
    const b = playSeries(ai(), idle, 200);
    console.log(`[가만히 있는 상대 400경기] AI ${a.rightWins + b.leftWins}승 · 평균 ${((a.avgSec + b.avgSec) / 2).toFixed(0)}초`);
    expect(a.unfinished + b.unfinished).toBe(0);
    expect(a.rightWins + b.leftWins).toBeGreaterThanOrEqual(392);
  }, 120000);

  // 난이도 확인: 사람 흉내 상대들과의 승률 (수치 보고용).
  // 한 테스트에 몰아 300경기씩 돌리면 30초 넘게 일꾼을 붙잡아 vitest 가 "Timeout calling onTaskUpdate" 로 멈춘 적이 있어,
  // 상대마다 따로 나누고 100경기(씨앗 고정이라 결과는 늘 같다)만 돌린다. 300경기 때 수치: 96% · 85% · 15% · 74%
  describe('난이도 확인: 사람 흉내 상대들과의 승률 (수치 보고용)', () => {
    const N = 100;
    // 경기마다 양보한다 (빠르고 정확한 상대와는 경기가 길어 한 테스트가 10초 가까이 걸린다)
    const rate = async (name: string, maker: Parameters<typeof playSeries>[0]) => {
      const a = await playSeriesAsync(maker, ai(), N / 2);
      const b = await playSeriesAsync(ai(), maker, N / 2, 5000);
      const wins = a.rightWins + b.leftWins;
      console.log(`[AI 승률] ${name}: ${((100 * wins) / N).toFixed(0)}% (${wins}/${N}, 안 끝남 ${a.unfinished + b.unfinished}, 평균 ${((a.avgSec + b.avgSec) / 2).toFixed(0)}초)`);
      expect(a.unfinished + b.unfinished).toBe(0);
      return wins / N;
    };
    it('공만 따라다니는 초보 (떨어질 곳을 내다보지 않음)에게는 대부분 이긴다', async () => {
      expect(await rate('공만 따라다니는 초보 (반응 0.2초)', chaser(0.2))).toBeGreaterThan(0.7);
    }, 120000);
    it('AI와 같은 방식이지만 느리고 부정확한 상대에게는 대부분 이긴다', async () => {
      expect(await rate('느린 상대 (반응 0.30~0.45초, 오차 ±45)', ai({ ...AI_NORMAL, reactMin: 0.3, reactMax: 0.45, error: 45 }))).toBeGreaterThan(0.6);
    }, 120000);
    it('AI보다 빠르고 정확한 상대에게는 진다 (이길 수 있는 AI), 그래도 가끔은 이긴다', async () => {
      const strong = await rate('빠르고 정확한 상대 (반응 0.05초, 오차 0)', ai({ ...AI_NORMAL, reactMin: 0.05, reactMax: 0.05, error: 0 }));
      expect(strong).toBeLessThan(0.5);
      expect(strong).toBeGreaterThan(0.03);
    }, 120000);
    it('사람만큼 느리지만(반응 0.25~0.35초) 욕심내지 않고 안전하게 넘기기만 하는 상대 (수치만)', async () => {
      await rate('안전하게 넘기기만 하는 상대 (반응 0.25~0.35초)', ai({ ...AI_NORMAL, reactMin: 0.25, reactMax: 0.35, behind: 20, safety: 16, jumpRate: 0, riskRate: 0 }));
    }, 120000);
  });
});
