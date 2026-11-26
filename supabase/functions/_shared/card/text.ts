/** 카드·의도 설명 글 (데이터의 연산 목록에서 만든다 — 숫자가 데이터와 늘 같다) */
import { cardDef, cardExhaust, cardOps } from './data.ts';
import type { Op, PowerId, StatusId } from './types.ts';

export const STATUS_NAME: Record<StatusId, string> = { fire: '화상', poison: '독', wet: '젖음', mud: '진흙', weak: '약화' };
/** '○○인 적' 꼴 (번개부적: 젖은 적 2배) */
const STATUS_ADJ: Record<StatusId, string> = { fire: '화상인', poison: '독에 걸린', wet: '젖은', mud: '진흙 묻은', weak: '약화된' };
export const STATUS_HELP: Record<StatusId | 'str', string> = {
  fire: '턴 끝에 숫자만큼 피해, 1 감소',
  poison: '턴 시작에 숫자만큼 피해(방어 무시), 1 감소',
  wet: '받는 피해 +50%, 턴마다 1 감소',
  mud: '다음 턴 뽑기 -1',
  weak: '주는 피해 -25%, 턴마다 1 감소',
  str: '공격 피해에 더해지는 수치',
};
const POWER_TEXT: Record<PowerId, (n: number) => string> = {
  atkUp: (n) => `공격카드 피해+${n}`,
  regen: (n) => `매 턴 체력${n} 회복`,
  weakBonus: (n) => `약화된 적에게 피해 +${n}%`,
  guard: (n) => `매 턴 방어${n}`,
  energyUp: (n) => `매 턴 기력+${n}`,
  drawUp: (n) => `매 턴 ${n}장 더`,
  blockUp: (n) => `방어 얻을 때마다 +${n}`,
  echoAtk: () => '매 턴 첫 공격카드 한 번 더 발동',
  firstDraw: (n) => `매 턴 첫 카드 쓰면 ${n}장 뽑기`,
  poisonUp: (n) => `내가 거는 독+${n}`,
  drawBlock: (n) => `카드 뽑을 때마다 방어${n}`,
  phoenix: (n) => `쓰러지면 한 번 체력${n}%로 일어남`,
};

/** allBefore: 바로 앞 연산도 '모든 적' 이면 상태이상의 '모든 적' 을 줄인다 (천둥 신장: 모든 적 20, 젖음2) */
function opText(o: Op, allBefore = false): string {
  switch (o.op) {
    case 'dmg': {
      const n = o.times && o.times > 1 ? `${o.n}×${o.times}` : `${o.n}`;
      const pre = o.to === 'all' ? '모든 적 ' : o.to === 'random' ? '무작위 적 ' : o.to === 'others' ? '다른 적 모두 ' : '피해 ';
      const cond = o.ifSt ? (o.ifK ? `, ${STATUS_ADJ[o.ifSt]} 적 ${o.ifK}배` : `, ${STATUS_ADJ[o.ifSt]} 적 +${o.ifN ?? 0}`) : '';
      const steal = o.steal ? `, 준 피해 ${o.steal === 0.5 ? '절반' : `${Math.round(o.steal * 100)}%`} 회복` : '';
      return `${pre}${n}${cond}${o.pierce ? ', 방어 무시' : ''}${steal}`;
    }
    case 'block':
      return `방어${o.n}`;
    case 'draw':
      return `${o.n}장 뽑기`;
    case 'energy':
      return `기력+${o.n}`;
    case 'status': {
      const name = STATUS_NAME[o.id];
      return `${o.to === 'all' && !allBefore ? '모든 적 ' : ''}${name}${o.n}${o.plus ? `, 이미 ${name}이면 +${o.plus}` : ''}`;
    }
    case 'heal':
      return `체력${o.n} 회복`;
    case 'nextBlock':
      return `다음 턴 방어${o.n}`;
    case 'thorns':
      return `맞으면 반격${o.n}`;
    case 'power':
      return POWER_TEXT[o.id](o.n);
    case 'clearBlock':
      return '내 방어 전부 없앰';
    case 'cleanse':
      return '내 상태이상 모두 제거';
    case 'mulSt':
      return `대상 ${STATUS_NAME[o.id]} ${o.k}배`;
    case 'maxHp':
      return `최대 체력+${o.n}`;
    case 'nextEnergy':
      return `다음 턴 기력+${o.n}`;
    case 'discount':
      return `이번 턴 손패 ${KIND_NAME[o.kind]}카드 기력-${o.n}`;
    case 'nextFreeAtk':
      return '다음 턴 첫 공격카드 기력0';
    case 'peek':
      return '적 하나 2턴치 의도 보기';
    case 'mimic':
      return '직전 카드 한 번 더';
    case 'pick':
      return o.kind === 'discard' ? `손패 ${o.n}장 버림` : `손패 1장 복사본 ${o.n}장`;
    case 'winGold':
      return `이기면 엽전+${o.n}`;
    case 'nextCut':
      return `이번 턴 다음 카드 기력-${o.n}`;
    case 'aim':
      return '다음 공격카드 피해 2배';
    case 'freeRandom':
      return `손패 무작위 ${o.n}장 이번 턴 기력0`;
    case 'nextDraw':
      return `다음 턴 ${o.n}장 더`;
    case 'ward':
      return `이번에 받는 상태이상 ${o.n}번 막기`;
    case 'spread':
      return `대상의 ${STATUS_NAME[o.id]}만큼 다른 적 모두에게 ${STATUS_NAME[o.id]}`;
    case 'stun':
      return '모든 적 다음 행동 건너뜀';
  }
}

const isAll = (o: Op | undefined) => !!o && (o.op === 'dmg' || o.op === 'status') && o.to === 'all';

export function cardText(id: string, up?: boolean): string {
  const d = cardDef(id);
  if (d.text && !(up && d.textUp)) return d.text + (cardExhaust(id, up) && d.kind !== 'curse' ? ', 소멸' : d.kind === 'curse' ? ' (쓰면 소멸)' : '');
  if (up && d.textUp) return d.textUp;
  const ops = cardOps(id, up);
  const parts = ops.map((o, i) => opText(o, isAll(ops[i - 1])));
  if (cardExhaust(id, up)) parts.push('소멸');
  return parts.join(', ');
}

export const KIND_NAME = { atk: '공격', def: '방어', skill: '술법', power: '부적술', curse: '내림' } as const;
export const RARITY_NAME = { basic: '기본', common: '일반', uncommon: '고급', legend: '전설', hero: '전용', hero2: '전용', curse: '내림' } as const;

export function cardName(id: string, up?: boolean): string {
  return cardDef(id).name + (up ? '+' : '');
}
