import { autopilot } from '../game/autopilot';
import { STEP, createRun, setTarget, step } from '../game/sim';
import { UPGRADES, modsOf, type Upgrades } from './growth';
import { STAGES } from './stages';

/** 그 지역까지 보통만큼 한 강화 (f = (지역-1)/11, 엽전 강화는 빼고) */
export const expectedUpgrades = (f: number): Upgrades =>
  Object.fromEntries(UPGRADES.filter((u) => u.key !== 'coin').map((u) => [u.key, Math.round(u.max * f)]));

/** 만든 스테이지마다 생각하는 플레이어가 보스 앞에 왔을 때의 대원 수 (scripts/calib.ts · tests/data.test.ts) */
export function measureArrivals(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const st of STAGES) {
    if (st.region <= 1) continue;
    const s = createRun({ ...st, boss: { ...st.boss, hp: 1e12 } }, 'rat', modsOf(expectedUpgrades((st.region - 1) / 11)));
    for (let i = 0; i < 120 / STEP && s.phase === 'run'; i++) {
      setTarget(s, autopilot(s));
      step(s);
      s.events.length = 0;
    }
    out[st.id] = s.phase === 'boss' ? s.troops : 0;
  }
  return out;
}
