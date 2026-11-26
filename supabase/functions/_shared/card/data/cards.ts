/**
 * 카드 데이터 (games/card/src/data/cards.json 과 같은 내용 — `npm run json` 이 만들고 tests/data.test.ts 가 같은지 본다).
 * 값은 PRD 사용자 스펙 그대로. 강화(up) 값은 스펙의 '수치 30~50% 상승 또는 기력-1' 안에서 정한 것.
 * 1~2단계: 기본 2 + 일반 12 + 고급 4 + 전설 2 = 공용 20장, 어흥이 전용 2장, 내림카드 2장.
 */
import type { CardDef } from '../types.ts';

export const CARDS: CardDef[] = [
  // ---------- 기본 ----------
  { id: 'slash', name: '베기', kind: 'atk', rarity: 'basic', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 6 }], up: { ops: [{ op: 'dmg', n: 9 }] }, art: 'fx-slash' },
  { id: 'guard', name: '막기', kind: 'def', rarity: 'basic', cost: 1, target: 'none', ops: [{ op: 'block', n: 5 }], up: { ops: [{ op: 'block', n: 7 }] }, art: 'ic-armor' },

  // ---------- 일반 ----------
  { id: 'arrowRain', name: '화살비', kind: 'atk', rarity: 'common', cost: 2, target: 'none', ops: [{ op: 'dmg', n: 7, to: 'all' }], up: { ops: [{ op: 'dmg', n: 10, to: 'all' }] }, art: 'fx-arrowfall' },
  { id: 'spin', name: '돌풀이', kind: 'atk', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'dmg', n: 4, to: 'all' }, { op: 'draw', n: 1 }], up: { ops: [{ op: 'dmg', n: 6, to: 'all' }, { op: 'draw', n: 1 }] }, art: 'fx-spin' },
  { id: 'thrust', name: '찌르기', kind: 'atk', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 8 }, { op: 'status', id: 'wet', n: 1 }], up: { ops: [{ op: 'dmg', n: 11 }, { op: 'status', id: 'wet', n: 1 }] }, art: 'fx-thrust' },
  { id: 'doubleSlash', name: '두 번 베기', kind: 'atk', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 4, times: 2 }], up: { ops: [{ op: 'dmg', n: 6, times: 2 }] }, art: 'ic-w-sword-1' },
  { id: 'smash', name: '내려찍기', kind: 'atk', rarity: 'common', cost: 2, target: 'enemy', ops: [{ op: 'dmg', n: 14 }], up: { ops: [{ op: 'dmg', n: 19 }] }, art: 'ic-w-sword-3' },
  { id: 'rake', name: '갈퀴 손', kind: 'atk', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 7 }, { op: 'status', id: 'weak', n: 1 }], up: { ops: [{ op: 'dmg', n: 10 }, { op: 'status', id: 'weak', n: 1 }] }, art: 'fx-claw' },
  { id: 'ember', name: '불씨', kind: 'atk', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 3 }, { op: 'status', id: 'fire', n: 3 }], up: { ops: [{ op: 'dmg', n: 4 }, { op: 'status', id: 'fire', n: 4 }] }, art: 'p-fire' },
  { id: 'shieldUp', name: '방패 들기', kind: 'def', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'block', n: 8 }], up: { ops: [{ op: 'block', n: 11 }] }, art: 'fx-shield' },
  { id: 'crouch', name: '몸 낮추기', kind: 'def', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'block', n: 6 }, { op: 'draw', n: 1 }], up: { ops: [{ op: 'block', n: 8 }, { op: 'draw', n: 1 }] }, art: 'ic-w-fan-0' },
  { id: 'counter', name: '반격 자세', kind: 'def', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'block', n: 5 }, { op: 'thorns', n: 3 }], up: { ops: [{ op: 'block', n: 7 }, { op: 'thorns', n: 4 }] }, art: 'ic-w-spear-1' },
  { id: 'poisonFog', name: '독안개', kind: 'skill', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'status', id: 'poison', n: 3, to: 'all' }], up: { ops: [{ op: 'status', id: 'poison', n: 4, to: 'all' }] }, art: 'fx-poison' },
  { id: 'breathe', name: '숨 고르기', kind: 'skill', rarity: 'common', cost: 0, target: 'none', ops: [{ op: 'draw', n: 1 }, { op: 'energy', n: 1 }], exhaust: true, up: { ops: [{ op: 'draw', n: 2 }, { op: 'energy', n: 1 }] }, art: 'ic-mp' },

  // ---------- 고급 ----------
  { id: 'fireTalisman', name: '불부적', kind: 'atk', rarity: 'uncommon', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 5 }, { op: 'status', id: 'fire', n: 3 }], up: { ops: [{ op: 'dmg', n: 7 }, { op: 'status', id: 'fire', n: 4 }] }, art: 'fx-flame' },
  { id: 'ironWall', name: '철벽', kind: 'def', rarity: 'uncommon', cost: 2, target: 'none', ops: [{ op: 'block', n: 18 }], up: { ops: [{ op: 'block', n: 25 }] }, art: 'ic-w-fan-5' },
  { id: 'temper', name: '담금질', kind: 'power', rarity: 'uncommon', cost: 1, target: 'none', ops: [{ op: 'power', id: 'atkUp', n: 2 }], up: { cost: 0 }, art: 'ic-w-sword-6' },
  { id: 'gather', name: '기 모으기', kind: 'skill', rarity: 'uncommon', cost: 1, target: 'none', ops: [{ op: 'energy', n: 2 }], exhaust: true, up: { cost: 0 }, art: 'ic-acc-mp' },

  // ---------- 전설 ----------
  { id: 'diamond', name: '금강', kind: 'def', rarity: 'legend', cost: 2, target: 'none', ops: [{ op: 'block', n: 30 }], exhaust: true, up: { ops: [{ op: 'block', n: 42 }] }, art: 'ic-w-fan-11' },
  { id: 'haetae', name: '해태의 축복', kind: 'power', rarity: 'legend', cost: 1, target: 'none', ops: [{ op: 'power', id: 'regen', n: 2 }], up: { ops: [{ op: 'power', id: 'regen', n: 3 }] }, art: 'ic-hp' },

  // ---------- 영웅 전용: 어흥이 ----------
  { id: 'tigerClaw', name: '호랑이 발톱', kind: 'atk', rarity: 'hero', cost: 2, target: 'enemy', ops: [{ op: 'dmg', n: 4, times: 3 }], up: { ops: [{ op: 'dmg', n: 6, times: 3 }] }, art: 'ic-u-tiger', hero: 'tiger' },
  { id: 'tigerMajesty', name: '산군의 위엄', kind: 'power', rarity: 'hero2', cost: 1, target: 'none', ops: [{ op: 'power', id: 'weakBonus', n: 50 }], up: { cost: 0 }, art: 'ic-u-tiger', hero: 'tiger' },

  // ---------- 내림카드 (전투가 끝나면 사라짐) ----------
  { id: 'prank', name: '도깨비 장난', kind: 'curse', rarity: 'curse', cost: 1, target: 'none', ops: [], exhaust: true, art: 'ic-w-sword-0', text: '효과 없음' },
  { id: 'chain', name: '저승 사슬', kind: 'curse', rarity: 'curse', cost: 1, target: 'none', ops: [], exhaust: true, endTurnHurt: 3, art: 'ic-w-bow-8', text: '턴 끝에 손에 있으면 피해 3' },
];
