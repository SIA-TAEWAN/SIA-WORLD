/**
 * 밸런스 시뮬레이션 일꾼 (scripts/sweep.mjs 가 여러 개를 한꺼번에 띄운다).
 * 인자: 일감 목록(JSON) [{ key, map, char, upg, from, to }] → 일감마다 한 줄씩 결과(JSON)를 찍는다.
 */
import { ENDLESS, type RunMode, type ZodiacId } from '../src/data/balance';
import { MAPS, MAP_INDEX } from '../src/data/maps';
import { presetUpgrades } from '../src/data/upgrades';
import { WEAPONS } from '../src/data/weapons';
import { dpsTable, normalPolicy, simulate } from '../src/game/policy';

interface Job {
  key: string;
  map: string;
  char: ZodiacId;
  upg: number;
  /** 모드 (없으면 4분 모드) */
  mode?: RunMode;
  from: number;
  to: number;
}

const arg = process.argv[2] ?? '[]';
if (arg === 'dps') {
  console.log(JSON.stringify({ dps: dpsTable() }));
} else {
  const jobs = JSON.parse(arg) as Job[];
  for (const j of jobs) {
    const out = { key: j.key, runs: 0, time: 0, clears: 0, coins: 0, clearCoins: 0, kills: 0, level: 0, cakes: 0, bosses: 0, evos: 0, times: [] as number[], max: { coins: 0, coinRate: 0, killRate: 0, levelRate: 0, cakeRate: 0 } };
    for (let i = j.from; i < j.to; i++) {
      // 판 번호마다 정해진 시드: 일꾼을 어떻게 나누든 같은 판이 나온다
      // 무한 모드는 죽을 때까지 돌린다 (시간 상한까지)
      const r = j.mode === 'endless'
        ? simulate({ seed: 1 + i * 7919, char: j.char, map: j.map, mode: 'endless', upgrades: presetUpgrades(j.upg) }, normalPolicy(31 + i), ENDLESS.maxSec + 60)
        : simulate({ seed: 1 + i * 7919, char: j.char, map: j.map, upgrades: presetUpgrades(j.upg) }, normalPolicy(31 + i));
      out.runs++;
      out.time += r.time;
      out.clears += r.cleared ? 1 : 0;
      out.coins += r.coins;
      out.clearCoins += r.cleared ? r.coins : 0;
      out.bosses += r.bossKills;
      out.kills += r.kills;
      out.level += r.level;
      out.cakes += r.cakes;
      // 무기 진화가 일어난 판 (보스 보물상자를 열 때 5레벨 무기 + 짝 패시브가 있었다)
      out.evos += r.state.weapons.some((x) => WEAPONS[x.def].evolved) ? 1 : 0;
      out.times.push(r.time);
      // 서버 상한(초당 값)을 정할 때 보는 실제 최대치: 엽전은 맵 배율로 나눈 초당 값, 나머지는 기본 여유(처치 100 · 레벨 5 · 떡 5)를 뺀 초당 값
      const m = out.max;
      const t = Math.max(20, r.time);
      m.coins = Math.max(m.coins, r.coins);
      m.coinRate = Math.max(m.coinRate, r.coins / MAPS[MAP_INDEX[j.map] ?? 0].coinMul / t);
      m.killRate = Math.max(m.killRate, (r.kills - 100) / t);
      m.levelRate = Math.max(m.levelRate, (r.level - 5) / t);
      m.cakeRate = Math.max(m.cakeRate, (r.cakes - 5) / t);
    }
    console.log(JSON.stringify(out));
  }
}
