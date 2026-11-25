/**
 * 체크포인트에서 시작하는 진행 상태 (봇 시험용): 1층부터 봇으로 올라온 것과 비슷하게 만든다.
 * 레벨은 봇이 1→50층에서 실제로 닿은 값(PROGRESS.md '밸런스' — 49층 뒤 Lv 54~55), 51층부터는 6구역 이후 곡선(BOT_LEVEL).
 * 구슬은 그 층 아래에서 받는 것 모두, 소지품은 휴식층에서 봇이 사는 만큼.
 * 1→100층을 씨앗 여럿으로 다 오르면 CI 가 너무 오래 걸려서, 51·71·91층 체크포인트에서 나눠 오른다 (tests/climb100-*.test.ts).
 */
import { ORBS, ZONE_SIZE, isCheckpoint } from '../src/data';
import { newData, type TowerData } from '../src/game/progress';

/** 체크포인트 층에 들어설 때 봇의 레벨 (봇 측정 — scripts/bot-run.ts) */
export const BOT_LEVEL: Record<number, number> = { 51: 56, 61: 63, 71: 71, 81: 79, 91: 87 };

export function startData(seed: number, floor: number, level = BOT_LEVEL[floor] ?? Math.min(99, floor + 5)): TowerData {
  if (!isCheckpoint(floor)) throw new Error(`${floor}층은 체크포인트가 아니에요`);
  const d = newData(seed);
  d.level = level;
  d.floor = floor;
  d.checkpoint = floor;
  d.best = floor - 1;
  for (const o of ORBS) if (o.floor < floor) d.orbs[o.id] = 1;
  d.equipped = d.orbs.rat ? 'rat' : null;
  // 앞 구역에서 받은 첫 보상 (다시 받지 않게)
  for (let f = 1; f < floor; f++) {
    if (f % ZONE_SIZE === 0) d.got.push(`${f}:boss`);
    else d.got.push(`${f}:chest`);
  }
  d.items.potionL = 4;
  d.items.potionS = 3;
  d.items.revive = 1;
  d.shards = 6;
  d.coins = 0;
  return d;
}
