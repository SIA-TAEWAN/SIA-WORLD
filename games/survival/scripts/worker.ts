/**
 * 밸런스 시뮬레이션 일꾼 (scripts/sweep.mjs 가 여러 개를 한꺼번에 띄운다).
 * 인자: 일감 목록(JSON) [{ key, map, char, upg, from, to }] → 일감마다 한 줄씩 결과(JSON)를 찍는다.
 */
import type { ZodiacId } from '../src/data/balance';
import { presetUpgrades } from '../src/data/upgrades';
import { dpsTable, normalPolicy, simulate } from '../src/game/policy';

interface Job {
  key: string;
  map: string;
  char: ZodiacId;
  upg: number;
  from: number;
  to: number;
}

const arg = process.argv[2] ?? '[]';
if (arg === 'dps') {
  console.log(JSON.stringify({ dps: dpsTable() }));
} else {
  const jobs = JSON.parse(arg) as Job[];
  for (const j of jobs) {
    const out = { key: j.key, runs: 0, time: 0, clears: 0, coins: 0, kills: 0, level: 0, times: [] as number[] };
    for (let i = j.from; i < j.to; i++) {
      // 판 번호마다 정해진 시드: 일꾼을 어떻게 나누든 같은 판이 나온다
      const r = simulate({ seed: 1 + i * 7919, char: j.char, map: j.map, upgrades: presetUpgrades(j.upg) }, normalPolicy(31 + i));
      out.runs++;
      out.time += r.time;
      out.clears += r.cleared ? 1 : 0;
      out.coins += r.coins;
      out.kills += r.kills;
      out.level += r.level;
      out.times.push(r.time);
    }
    console.log(JSON.stringify(out));
  }
}
