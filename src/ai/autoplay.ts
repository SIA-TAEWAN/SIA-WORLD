import { Match } from '../game/match';
import { Rng } from '../game/rng';
import type { Difficulty, PlayerSetup } from '../game/types';
import type { TankId } from '../game/data';
import type { MapId } from '../data/maps';
import { decideMove, decideShot, aiItems } from './ai';

/** 화면 없이 AI끼리 한 판을 돌린다. 승리 팀(0/1, 무승부 -1)과 턴 수를 돌려준다. */
export function autoplay(a: TankId, b: TankId, mapId: MapId, seed: number, diff: Difficulty = 'normal', items = false) {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const setups: PlayerSetup[] = [
    { name: 'A', tank: a, team: 0, ai: diff, items: items ? aiItems(diff, rng) : [] },
    { name: 'B', tank: b, team: 1, ai: diff, items: items ? aiItems(diff, rng) : [] },
  ];
  const m = new Match(setups, mapId, seed);
  let turns = 0;
  while (!m.over && turns < 200) {
    m.startTurn();
    turns++;
    const mv = decideMove(m, diff, rng);
    for (let i = 0; i < Math.abs(mv); i++) if (!m.moveStep(mv > 0 ? 1 : -1)) break;
    if (m.over) break;
    m.fire(decideShot(m, diff, rng));
  }
  return { winner: m.winner ?? -1, turns, hp: m.tanks.map((t) => t.hp) };
}
