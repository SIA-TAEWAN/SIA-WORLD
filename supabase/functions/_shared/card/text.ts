/** 카드·의도 설명 글 (데이터의 연산 목록에서 만든다 — 숫자가 데이터와 늘 같다) */
import { cardDef, cardExhaust, cardOps } from './data.ts';
import type { Op, PowerId, StatusId } from './types.ts';

export const STATUS_NAME: Record<StatusId, string> = { fire: '화상', poison: '독', wet: '젖음', mud: '진흙', weak: '약화' };
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
};

function opText(o: Op): string {
  switch (o.op) {
    case 'dmg': {
      const n = o.times && o.times > 1 ? `${o.n}×${o.times}` : `${o.n}`;
      const pre = o.to === 'all' ? '모든 적 ' : o.to === 'random' ? '무작위 적 ' : o.to === 'others' ? '다른 적 모두 ' : '피해 ';
      return `${pre}${n}${o.pierce ? ', 방어 무시' : ''}`;
    }
    case 'block':
      return `방어${o.n}`;
    case 'draw':
      return `${o.n}장 뽑기`;
    case 'energy':
      return `기력+${o.n}`;
    case 'status':
      return `${o.to === 'all' ? '모든 적 ' : ''}${STATUS_NAME[o.id]}${o.n}`;
    case 'heal':
      return `체력${o.n} 회복`;
    case 'nextBlock':
      return `다음 턴 방어${o.n}`;
    case 'thorns':
      return `맞으면 반격${o.n}`;
    case 'power':
      return POWER_TEXT[o.id](o.n);
  }
}

export function cardText(id: string, up?: boolean): string {
  const d = cardDef(id);
  if (d.text && !(up && d.textUp)) return d.text + (cardExhaust(id, up) && d.kind !== 'curse' ? ', 소멸' : d.kind === 'curse' ? ' (쓰면 소멸)' : '');
  if (up && d.textUp) return d.textUp;
  const parts = cardOps(id, up).map(opText);
  if (cardExhaust(id, up)) parts.push('소멸');
  return parts.join(', ');
}

export const KIND_NAME = { atk: '공격', def: '방어', skill: '술법', power: '부적술', curse: '내림' } as const;
export const RARITY_NAME = { basic: '기본', common: '일반', uncommon: '고급', legend: '전설', hero: '전용', hero2: '전용', curse: '내림' } as const;

export function cardName(id: string, up?: boolean): string {
  return cardDef(id).name + (up ? '+' : '');
}
