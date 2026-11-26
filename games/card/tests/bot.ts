/**
 * 간단한 봇: 화면과 같은 입력(apply)만 써서 전투·판을 끝까지 돌린다.
 * 규칙: 들어올 피해보다 방어가 적으면 방어 카드, 아니면 공격(체력 낮은 적부터), 쓸 게 없으면 턴 끝.
 */
import { aliveFoes, apply, cardDef, cardOps, enemyDef, foeDamage, moveDef, playCost, type Battle, type Input, type RunState } from '../src/game/rules';

export function incoming(b: Battle): number {
  let n = 0;
  for (const f of aliveFoes(b)) {
    if (!f.intent) continue;
    for (const o of moveDef(enemyDef(f.id), f.phase, f.intent).ops) if (o.op === 'dmg') n += foeDamage(b, f, o.n) * (o.times ?? 1);
  }
  return n;
}

/** 전투 한 걸음 입력 고르기 */
export function battleInput(run: RunState): Input {
  const b = run.battle!;
  const playable = b.hand.filter((c) => playCost(run, b, c) <= b.energy);
  const need = incoming(b) - b.block;
  const foes = aliveFoes(b).sort((x, y) => x.hp - y.hp);
  const score = (id: string, up?: boolean) => {
    const d = cardDef(id);
    let s = 0;
    for (const o of cardOps(id, up)) {
      if (o.op === 'dmg') s += o.n * (o.times ?? 1) * (o.to === 'all' ? aliveFoes(b).length : 1);
      if (o.op === 'block') s += need > 0 ? o.n * 1.3 : o.n * 0.2;
      if (o.op === 'draw' || o.op === 'energy') s += 4 * o.n;
      if (o.op === 'status') s += 3 * o.n;
      if (o.op === 'power') s += 8;
      if (o.op === 'heal') s += o.n;
    }
    if (d.kind === 'curse') s = 0.5;
    return s / Math.max(1, playCost(run, b, { uid: 0, id, up }));
  };
  let best: { uid: number; s: number; enemy: boolean } | null = null;
  for (const c of playable) {
    const s = score(c.id, c.up);
    if (!best || s > best.s) best = { uid: c.uid, s, enemy: cardDef(c.id).target === 'enemy' };
  }
  if (!best || best.s <= 0) return { t: 'end' };
  return best.enemy ? { t: 'play', uid: best.uid, target: foes[0].uid } : { t: 'play', uid: best.uid };
}

/** 전투가 끝날 때까지 (돌려줌: 쓴 입력 수) */
export function playBattle(run: RunState, limit = 2000): number {
  let n = 0;
  while (run.phase === 'battle' && run.battle && !run.battle.over && n < limit) {
    const i = battleInput(run);
    const r = apply(run, i);
    if (!r.ok) throw new Error(`bot input refused: ${JSON.stringify(i)}`);
    n++;
  }
  return n;
}
