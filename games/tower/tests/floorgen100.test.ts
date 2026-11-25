/** 51~100층 갇힘 검사 (1~50층은 floorgen.test.ts — 파일을 나눠 따로 돈다) */
import { describe, expect, it } from 'vitest';
import { generateFloor } from '../src/game/floorgen';
import { checkFloor } from './reach';

describe('층 만들기 (51~100층)', () => {
  it('갇히는 곳이 없다: 뇌석은 한 사슬로 이을 자리가, 구름 덩이는 물 건너 밀 자리가, 거울 너머 스위치는 꺾어 맞힐 자리가 있고, 쇠창살·짙은 구름 너머 상자에 닿는다 (51~100층 × 씨앗 40개)', () => {
    const seen: Record<string, number> = {};
    for (let seed = 1; seed <= 40; seed++) for (let f = 51; f <= 100; f++) checkFloor(generateFloor(seed * 7919, f), `${seed}:${f}`, seen);
    for (const k of ['rod', 'puff', 'mirror', 'fog', 'bars', 'pit', 'bell', 'gong', 'cold', 'post']) expect(seen[k], k).toBeGreaterThan(0);
  }, 60_000);
});
