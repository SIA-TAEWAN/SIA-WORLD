/**
 * 카드 데이터 (games/card/src/data/cards.json 과 같은 내용 — `npm run json` 이 만들고 tests/data.test.ts 가 같은지 본다).
 * 값은 PRD 사용자 스펙 그대로. 강화(up) 값은 스펙의 '수치 30~50% 상승 또는 기력-1' 안에서 정한 것.
 * 1~2단계: 기본 2 + 일반 12 + 고급 4 + 전설 2 = 공용 20장 · 3단계: 영웅 전용 26장(13명 × 2) · 내림카드 2장.
 * 영웅 전용 카드 중 연산으로 설명을 못 만드는 것('무엇 1당' 피해 등)은 text/textUp 으로 적는다.
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

  // ---------- 영웅 전용 (전용1 = 시작 덱 · 전용2 = 고급, 그 영웅 보상에서만) · 그림은 열두길 고유 스킬 아이콘 ic-u-<영웅> ----------
  // 찍찍이 (쥐)
  { id: 'ratHole', name: '쥐구멍', kind: 'skill', rarity: 'hero', cost: 0, target: 'none', ops: [{ op: 'draw', n: 2 }, { op: 'pick', kind: 'discard', n: 1 }], up: { ops: [{ op: 'draw', n: 3 }, { op: 'pick', kind: 'discard', n: 1 }] }, art: 'ic-u-rat', hero: 'rat', text: '2장 뽑고 1장 버림', textUp: '3장 뽑고 1장 버림' },
  { id: 'ratFire', name: '쥐불놀이', kind: 'atk', rarity: 'hero2', cost: 1, target: 'none', ops: [{ op: 'dmg', n: 0, to: 'all', per: 'drawn', k: 2 }], up: { ops: [{ op: 'dmg', n: 0, to: 'all', per: 'drawn', k: 3 }] }, art: 'ic-u-rat', hero: 'rat', text: '이번 턴 뽑은 카드 1장당 모든 적 피해 2', textUp: '이번 턴 뽑은 카드 1장당 모든 적 피해 3' },
  // 우직이 (소)
  { id: 'headbutt', name: '들이받기', kind: 'atk', rarity: 'hero', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 0, per: 'block', k: 1 }], up: { cost: 0 }, art: 'ic-u-ox', hero: 'ox', text: '내 방어만큼 피해' },
  { id: 'steadfast', name: '우직함', kind: 'power', rarity: 'hero2', cost: 1, target: 'none', ops: [{ op: 'power', id: 'blockUp', n: 2 }], up: { ops: [{ op: 'power', id: 'blockUp', n: 3 }] }, art: 'ic-u-ox', hero: 'ox' },
  // 어흥이 (호랑이)
  { id: 'tigerClaw', name: '호랑이 발톱', kind: 'atk', rarity: 'hero', cost: 2, target: 'enemy', ops: [{ op: 'dmg', n: 4, times: 3 }], up: { ops: [{ op: 'dmg', n: 6, times: 3 }] }, art: 'ic-u-tiger', hero: 'tiger' },
  { id: 'tigerMajesty', name: '산군의 위엄', kind: 'power', rarity: 'hero2', cost: 1, target: 'none', ops: [{ op: 'power', id: 'weakBonus', n: 50 }], up: { cost: 0 }, art: 'ic-u-tiger', hero: 'tiger' },
  // 깡총이 (토끼)
  { id: 'hop', name: '깡충', kind: 'def', rarity: 'hero', cost: 1, target: 'none', ops: [{ op: 'block', n: 8 }, { op: 'nextEnergy', n: 1 }], up: { ops: [{ op: 'block', n: 11 }, { op: 'nextEnergy', n: 1 }] }, art: 'ic-u-rabbit', hero: 'rabbit' },
  { id: 'mortar', name: '절구질', kind: 'atk', rarity: 'hero2', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 4, per: 'energy', k: 4 }], up: { ops: [{ op: 'dmg', n: 6, per: 'energy', k: 6 }] }, art: 'ic-u-rabbit', hero: 'rabbit', text: '피해4, 남은 기력1당 +4', textUp: '피해6, 남은 기력1당 +6' },
  // 여의룡 (용)
  { id: 'dragonBreath', name: '용의 숨결', kind: 'atk', rarity: 'hero', cost: 2, target: 'none', ops: [{ op: 'dmg', n: 10, to: 'all' }, { op: 'status', id: 'fire', n: 2, to: 'all' }], up: { ops: [{ op: 'dmg', n: 14, to: 'all' }, { op: 'status', id: 'fire', n: 3, to: 'all' }] }, art: 'ic-u-dragon', hero: 'dragon' },
  { id: 'ascend', name: '승천', kind: 'atk', rarity: 'hero2', cost: 3, target: 'enemy', ops: [{ op: 'dmg', n: 25, ifSt: 'fire', ifN: 10 }], up: { ops: [{ op: 'dmg', n: 34, ifSt: 'fire', ifN: 14 }] }, art: 'ic-u-dragon', hero: 'dragon', text: '피해25, 화상인 적 +10', textUp: '피해34, 화상인 적 +14' },
  // 스르르 (뱀)
  { id: 'coil', name: '똬리', kind: 'skill', rarity: 'hero', cost: 1, target: 'enemy', ops: [{ op: 'mulSt', id: 'poison', k: 2 }], up: { cost: 0 }, art: 'ic-u-snake', hero: 'snake' },
  { id: 'shed', name: '허물벗기', kind: 'def', rarity: 'hero2', cost: 1, target: 'none', ops: [{ op: 'cleanse' }, { op: 'block', n: 8 }], up: { ops: [{ op: 'cleanse' }, { op: 'block', n: 11 }] }, art: 'ic-u-snake', hero: 'snake' },
  // 따각이 (말)
  { id: 'charge', name: '돌진', kind: 'atk', rarity: 'hero', cost: 2, target: 'enemy', ops: [{ op: 'dmg', n: 12, per: 'played', k: 2 }], up: { ops: [{ op: 'dmg', n: 16, per: 'played', k: 3 }] }, art: 'ic-u-horse', hero: 'horse', text: '피해12, 이번 턴 쓴 카드 1장당 +2', textUp: '피해16, 이번 턴 쓴 카드 1장당 +3' },
  { id: 'galloper', name: '천리마', kind: 'power', rarity: 'hero2', cost: 2, target: 'none', ops: [{ op: 'power', id: 'echoAtk', n: 1 }], up: { cost: 1 }, art: 'ic-u-horse', hero: 'horse' },
  // 몽실이 (양)
  { id: 'woolShield', name: '양털 방패', kind: 'def', rarity: 'hero', cost: 2, target: 'none', ops: [{ op: 'block', n: 12 }, { op: 'thorns', n: 3 }], up: { ops: [{ op: 'block', n: 16 }, { op: 'thorns', n: 4 }] }, art: 'ic-u-sheep', hero: 'sheep' },
  { id: 'shear', name: '털깎기', kind: 'atk', rarity: 'hero2', cost: 0, target: 'none', ops: [{ op: 'dmg', n: 0, to: 'all', per: 'block', k: 1 }, { op: 'clearBlock' }], up: { ops: [{ op: 'dmg', n: 0, to: 'all', per: 'block', k: 1.5 }, { op: 'clearBlock' }] }, art: 'ic-u-sheep', hero: 'sheep', text: '내 방어 전부 없애고 그만큼 모든 적 피해', textUp: '내 방어 전부 없애고 그 1.5배만큼 모든 적 피해' },
  // 재롱이 (원숭이)
  { id: 'mimic', name: '흉내', kind: 'skill', rarity: 'hero', cost: 1, target: 'none', ops: [{ op: 'mimic' }], up: { cost: 0 }, art: 'ic-u-monkey', hero: 'monkey' },
  { id: 'cloneArt', name: '분신술', kind: 'skill', rarity: 'hero2', cost: 2, target: 'none', ops: [{ op: 'pick', kind: 'clone', n: 2 }], exhaust: true, up: { cost: 1 }, art: 'ic-u-monkey', hero: 'monkey' },
  // 꼬꼬댁 (닭)
  { id: 'peck', name: '쪼기', kind: 'atk', rarity: 'hero', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 3, times: 3 }, { op: 'status', id: 'weak', n: 1 }], up: { ops: [{ op: 'dmg', n: 4, times: 3 }, { op: 'status', id: 'weak', n: 1 }] }, art: 'ic-u-rooster', hero: 'rooster' },
  { id: 'crow', name: '홰치기', kind: 'power', rarity: 'hero2', cost: 1, target: 'none', ops: [{ op: 'power', id: 'firstDraw', n: 1 }], up: { cost: 0 }, art: 'ic-u-rooster', hero: 'rooster' },
  // 멍뭉이 (개)
  { id: 'watchdog', name: '지킴이', kind: 'def', rarity: 'hero', cost: 1, target: 'none', ops: [{ op: 'block', n: 10 }, { op: 'thorns', n: 6 }], up: { ops: [{ op: 'block', n: 13 }, { op: 'thorns', n: 8 }] }, art: 'ic-u-dog', hero: 'dog' },
  { id: 'track', name: '냄새 추적', kind: 'skill', rarity: 'hero2', cost: 1, target: 'enemy', ops: [{ op: 'peek' }, { op: 'status', id: 'wet', n: 2 }], up: { ops: [{ op: 'peek' }, { op: 'status', id: 'wet', n: 3 }] }, art: 'ic-u-dog', hero: 'dog' },
  // 꿀꿀이 (돼지)
  { id: 'bellyFlop', name: '배치기', kind: 'atk', rarity: 'hero', cost: 2, target: 'enemy', ops: [{ op: 'dmg', n: 0, per: 'maxHp', k: 0.1 }], up: { ops: [{ op: 'dmg', n: 0, per: 'maxHp', k: 0.15 }] }, art: 'ic-u-pig', hero: 'pig', text: '최대 체력 10% 피해', textUp: '최대 체력 15% 피해' },
  { id: 'gluttony', name: '먹성', kind: 'skill', rarity: 'hero2', cost: 1, target: 'none', ops: [{ op: 'heal', n: 8 }, { op: 'maxHp', n: 2 }], exhaust: true, up: { ops: [{ op: 'heal', n: 11 }, { op: 'maxHp', n: 3 }] }, art: 'ic-u-pig', hero: 'pig' },
  // 야옹이 (고양이, 해금)
  { id: 'scratch', name: '할퀴기', kind: 'atk', rarity: 'hero', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 5 }, { op: 'discount', kind: 'atk', n: 1 }], up: { ops: [{ op: 'dmg', n: 7 }, { op: 'discount', kind: 'atk', n: 1 }] }, art: 'ic-u-cat', hero: 'cat' },
  { id: 'sneak', name: '살금살금', kind: 'def', rarity: 'hero2', cost: 1, target: 'none', ops: [{ op: 'block', n: 6 }, { op: 'nextFreeAtk' }], up: { ops: [{ op: 'block', n: 8 }, { op: 'nextFreeAtk' }] }, art: 'ic-u-cat', hero: 'cat' },

  // ---------- 내림카드 (전투가 끝나면 사라짐) ----------
  { id: 'prank', name: '도깨비 장난', kind: 'curse', rarity: 'curse', cost: 1, target: 'none', ops: [], exhaust: true, art: 'ic-w-sword-0', text: '효과 없음' },
  { id: 'chain', name: '저승 사슬', kind: 'curse', rarity: 'curse', cost: 1, target: 'none', ops: [], exhaust: true, endTurnHurt: 3, art: 'ic-w-bow-8', text: '턴 끝에 손에 있으면 피해 3' },
];
