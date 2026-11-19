/**
 * 밸런스 시뮬레이션 일꾼 (scripts/sweep.mjs 가 여러 개를 한꺼번에 띄운다).
 * 인자: 일감 목록(JSON) [{ key, stage, skill, from, to }] → 일감마다 한 줄씩 결과(JSON)를 찍는다.
 * 인자가 'towers' 면 캐릭터별 효율 표를 찍는다.
 */
import { WAVES, type ZodiacId } from '../src/data/balance';
import { STARTERS, TOWERS, spentAt } from '../src/data/characters';
import { SKILLS, simulate, skillPolicy } from '../src/game/policy';

interface Job {
  key: string;
  stage: string;
  skill: keyof typeof SKILLS;
  /** 데려갈 캐릭터 (없으면 처음부터 열려 있는 4종) */
  squad?: ZodiacId[];
  from: number;
  to: number;
}

const arg = process.argv[2] ?? '[]';
if (arg === 'towers') {
  // 한 마리를 계속 때릴 때의 초당 피해와 기운 1당 효율 (범위 공격은 맞는 요괴 수만큼 곱해진다)
  const rows = TOWERS.map((t) => ({
    name: t.name,
    kind: t.kind,
    levels: t.levels.map((L, i) => {
      const dps = (L.dmg * (L.count ?? 1)) / L.every;
      const spent = spentAt(t, i + 1);
      return { spent, dps, per: dps / spent, range: L.range, splash: L.splash ?? 0, stun: L.stun ?? 0, every: L.every };
    }),
  }));
  console.log(JSON.stringify({ towers: rows }));
} else {
  const jobs = JSON.parse(arg) as Job[];
  for (const j of jobs) {
    const out = { key: j.key, runs: 0, clears: 0, stars: [0, 0, 0, 0], lives: 0, time: 0, kills: 0, towers: 0, bossDown: 0, failWave: new Array(WAVES).fill(0) as number[] };
    for (let i = j.from; i < j.to; i++) {
      // 판 번호마다 정해진 시드: 일꾼을 어떻게 나누든 같은 판이 나온다
      const r = simulate({ seed: 1 + i * 7919, stage: j.stage, squad: j.squad ?? STARTERS }, skillPolicy(31 + i * 104729, SKILLS[j.skill])).summary;
      out.runs++;
      out.clears += r.cleared ? 1 : 0;
      out.stars[r.stars]++;
      out.lives += r.lives;
      out.time += r.time;
      out.kills += r.kills;
      out.towers += r.towers;
      out.bossDown += r.bossDown ? 1 : 0;
      if (!r.cleared) out.failWave[Math.max(0, Math.min(WAVES - 1, r.wave - 1))]++;
    }
    console.log(JSON.stringify(out));
  }
}
