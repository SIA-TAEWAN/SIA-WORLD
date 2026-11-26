/**
 * 간단한 봇: 화면과 같은 입력(apply)만 써서 전투·판을 끝까지 돌린다.
 * 규칙: 들어올 피해보다 방어가 적으면 방어 카드, 아니면 공격(체력 낮은 적부터), 쓸 게 없으면 턴 끝.
 * 위험하면 물약(회복·방어 → 불), 보스·정예 첫 턴에는 기력·뽑기 물약.
 */
import {
  aliveFoes,
  apply,
  canChoose,
  canUpgrade,
  cardDef,
  cardOps,
  choices,
  eventDef,
  foeHits,
  perValue,
  playCost,
  potionDef,
  removePrice,
  restHeal,
  restUpgrades,
  upgradable,
  type Battle,
  type Input,
  type RunState,
} from '../src/game/rules';

/** 이번 요괴 차례에 들어올 피해 합 */
export function incoming(run: RunState, b: Battle): number {
  let n = 0;
  for (const f of aliveFoes(b)) for (const h of foeHits(run, b, f)) n += h.n * h.times;
  return n;
}

function potionInput(run: RunState, b: Battle, need: number): Input | null {
  if (!run.potions.length) return null;
  const big = b.kind !== 'battle';
  const foes = aliveFoes(b).filter((f) => !f.minion);
  const target = (foes.length ? foes : aliveFoes(b)).sort((x, y) => x.hp - y.hp)[0];
  const danger = need >= run.hp || run.hp < run.maxHp * 0.3;
  for (let slot = 0; slot < run.potions.length; slot++) {
    const id = run.potions[slot];
    const p = potionDef(id);
    const use =
      (danger && (id === 'heal' || id === 'block')) ||
      (danger && id === 'fire') ||
      (big && b.turn === 1 && (id === 'energy' || id === 'swift' || id === 'fire')) ||
      (id === 'fire' && target && target.hp <= 15);
    if (!use) continue;
    return p.target === 'enemy' ? { t: 'potion', slot, target: target?.uid } : { t: 'potion', slot };
  }
  return null;
}

/** 전투 한 걸음 입력 고르기 */
export function battleInput(run: RunState): Input {
  const b = run.battle!;
  // 쥐구멍(버리기)·분신술(복사): 버리기는 가장 약한 카드, 복사는 가장 센 카드
  if (b.pending) {
    const sorted = [...b.hand].sort((x, y) => RANK[cardDef(x.id).rarity] - RANK[cardDef(y.id).rarity]);
    return { t: 'pick', uid: (b.pending.kind === 'discard' ? sorted[0] : sorted[sorted.length - 1]).uid };
  }
  const need = incoming(run, b) - b.block;
  const pot = potionInput(run, b, need);
  if (pot) return pot;
  const playable = b.hand.filter((c) => playCost(run, b, c) <= b.energy);
  // 분신·병졸은 계속 나오므로 주인(보스)을 먼저 노린다. 어둠 속(피해 -75%)인 적은 뒤로
  const foes = aliveFoes(b).sort((x, y) => Number(!!x.dark) - Number(!!y.dark) || Number(x.minion) - Number(y.minion) || x.hp - y.hp);
  const hasAtk = b.hand.some((c) => cardDef(c.id).kind === 'atk');
  const score = (id: string, up?: boolean) => {
    const d = cardDef(id);
    let s = 0;
    for (const o of cardOps(id, up)) {
      if (o.op === 'dmg') s += (o.n + (o.per ? Math.floor((o.k ?? 1) * perValue(run, b, o.per)) : 0)) * (o.times ?? 1) * (o.to === 'all' ? aliveFoes(b).length : 1);
      if (o.op === 'mimic' || o.op === 'pick' || o.op === 'peek' || o.op === 'mulSt' || o.op === 'spread') s += 5;
      if (o.op === 'nextEnergy' || o.op === 'nextFreeAtk' || o.op === 'thorns' || o.op === 'nextDraw' || o.op === 'nextCut' || o.op === 'freeRandom') s += 3;
      if (o.op === 'aim') s += hasAtk ? 6 : 0;
      if (o.op === 'stun') s += need > 10 ? need : 2;
      if (o.op === 'block') s += need > 0 ? Math.min(o.n, need + 3) * 1.3 : o.n * 0.2;
      if (o.op === 'nextBlock') s += o.n * 0.5;
      if (o.op === 'draw' || o.op === 'energy') s += 4 * o.n;
      if (o.op === 'status') s += 3 * o.n * (o.to === 'all' ? aliveFoes(b).length : 1);
      if (o.op === 'power') s += b.turn <= 3 ? 14 : 6;
      if (o.op === 'heal') s += run.hp < run.maxHp * 0.8 ? o.n : 0;
      if (o.op === 'maxHp') s += 4;
    }
    // 저승 사슬은 손에 두면 아프니 기력이 남으면 쓴다
    if (d.kind === 'curse') s = d.endTurnHurt ? 3 : 0.5;
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
export function playBattle(run: RunState, limit = 3000): number {
  let n = 0;
  while (run.phase === 'battle' && run.battle && !run.battle.over && n < limit) {
    const i = battleInput(run);
    const r = apply(run, i);
    if (!r.ok) throw new Error(`bot input refused: ${JSON.stringify(i)}`);
    n++;
  }
  return n;
}

const RANK: Record<string, number> = { legend: 4, uncommon: 3, hero2: 3, common: 2, basic: 0, hero: 1, curse: -5 };

/** 판 한 걸음 입력 고르기 (어느 화면이든) */
export function runInput(run: RunState): Input {
  switch (run.phase) {
    case 'battle':
      return battleInput(run);
    case 'map': {
      const cols = choices(run);
      const next = run.map.rows[run.row + 1];
      const low = run.hp < run.maxHp * 0.5;
      const score = (col: number) => {
        const t = next[col].type;
        if (t === 'rest') return low ? 10 : 3;
        if (t === 'elite') return run.hp > run.maxHp * 0.75 ? 5 : -5;
        if (t === 'shop') return run.gold >= 120 ? 6 : 1;
        if (t === 'treasure') return 8;
        if (t === 'event') return 4;
        return 2;
      };
      return { t: 'go', col: [...cols].sort((a, b) => score(b) - score(a) || a - b)[0] };
    }
    case 'reward': {
      const rw = run.reward!;
      for (let i = 0; i < rw.items.length; i++) {
        const it = rw.items[i];
        if (it.taken) continue;
        if (it.k === 'potion' && run.potions.length >= 3) continue;
        if (it.k === 'card') {
          let best = 0;
          it.options.forEach((c, k) => {
            if (RANK[cardDef(c.id).rarity] > RANK[cardDef(it.options[best].id).rarity]) best = k;
          });
          // 덱이 커지면 일반 카드는 건너뛴다
          if (run.deck.length >= 22 && RANK[cardDef(it.options[best].id).rarity] < 3) continue;
          return { t: 'take', i, pick: best };
        }
        if (it.k === 'bossRelic') return { t: 'take', i, pick: 0 };
        return { t: 'take', i };
      }
      return { t: 'leave' };
    }
    case 'shop': {
      const s = run.shop!;
      if (!s.removed && run.gold >= removePrice(run) && run.deck.length > 5) {
        const bad = run.deck.find((c) => cardDef(c.id).kind === 'curse') ?? run.deck.find((c) => c.id === 'guard') ?? run.deck.find((c) => c.id === 'slash');
        if (bad) return { t: 'remove', uid: bad.uid };
      }
      const i = s.cards.findIndex((c) => !c.sold && c.price <= run.gold && RANK[cardDef(c.id).rarity] >= 3);
      if (i >= 0) return { t: 'buy', kind: 'card', i };
      const j = s.relics.findIndex((c) => !c.sold && c.price <= run.gold);
      if (j >= 0) return { t: 'buy', kind: 'relic', i: j };
      const k = s.potions.findIndex((c) => !c.sold && c.price <= run.gold);
      if (k >= 0 && run.potions.length < 2 && run.gold >= 100) return { t: 'buy', kind: 'potion', i: k };
      return { t: 'leave' };
    }
    case 'rest': {
      if (run.rest!.done) return { t: 'leave' };
      if (run.hp < run.maxHp * 0.65 && restHeal(run) > 0) return { t: 'heal' };
      const can = upgradable(run).sort((x, y) => RANK[cardDef(y.id).rarity] - RANK[cardDef(x.id).rarity]);
      if (can.length) return { t: 'upgrade', uids: can.slice(0, Math.min(restUpgrades(run), can.length)).map((c) => c.uid) };
      return restHeal(run) > 0 ? { t: 'heal' } : { t: 'leave' };
    }
    case 'treasure':
      return run.treasure!.opened ? { t: 'leave' } : { t: 'open' };
    case 'event': {
      const e = run.event!;
      const def = eventDef(e.id);
      if (e.chosen < 0) {
        const i = def.choices.findIndex((c) => canChoose(run, c.ops, c.needGold));
        return { t: 'choose', i };
      }
      if (e.need) {
        const k = e.need.kind;
        const c =
          k === 'upgrade'
            ? run.deck.find((x) => canUpgrade(x.id, x.up))!
            : k === 'remove'
              ? (run.deck.find((x) => cardDef(x.id).kind === 'curse') ?? run.deck[0])
              : run.deck[run.deck.length - 1];
        return { t: 'pickCard', uid: c.uid };
      }
      return { t: 'leave' };
    }
    default:
      throw new Error(`no input for phase ${run.phase}`);
  }
}

/** 판이 끝날 때까지 (죽음·클리어) */
export function playRun(run: RunState, limit = 40000): number {
  let n = 0;
  while (run.phase !== 'dead' && run.phase !== 'won' && n < limit) {
    const i = runInput(run);
    const r = apply(run, i);
    if (!r.ok) throw new Error(`bot input refused in ${run.phase}: ${JSON.stringify(i)}`);
    n++;
  }
  return n;
}
