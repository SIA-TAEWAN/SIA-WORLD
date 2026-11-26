/** 밸런스 측정 봇(scripts/smart-bot.ts)이 화면과 같은 입력만으로 판을 끝까지 가는지 (무거운 측정은 npm run bot) */
import { describe, expect, it } from 'vitest';
import { newRun, replay } from '../src/game/rules';
import { smartPlayRun } from '../scripts/smart-bot';

describe('사람 흉내 봇', () => {
  it('판을 끝까지 가고, 그 기록을 다시 돌리면 같은 결과', () => {
    for (const [seed, hero] of [
      [11, 'tiger'],
      [12, 'monkey'],
    ] as const) {
      const run = newRun({ seed, hero });
      const tr = smartPlayRun(run);
      expect(['dead', 'won']).toContain(run.phase);
      expect(tr.battles).toBeGreaterThan(0);
      expect(tr.fights.length).toBe(tr.battles);
      const again = replay(seed, hero, run.log);
      expect(again.bad).toBe(-1);
      expect(again.run.hp).toBe(run.hp);
      expect(again.run.stats).toEqual(run.stats);
    }
  });
});
