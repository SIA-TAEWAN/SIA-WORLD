/**
 * 카드 데이터 (games/card/src/data/cards.json 과 같은 내용 — `npm run json` 이 만들고 tests/data.test.ts 가 같은지 본다).
 * 값은 PRD 사용자 스펙 그대로. 강화(up) 값은 스펙의 '수치 30~50% 상승 또는 기력-1' 안에서 정한 것.
 * 카드 86장 = 기본 2 + 일반 28 + 고급 20 + 전설 10 + 영웅 전용 26장(13명 × 2), 그 밖에 내림카드 2장.
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
  { id: 'spearThrow', name: '창 던지기', kind: 'atk', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 9 }], up: { ops: [{ op: 'dmg', n: 12 }] }, art: 'ic-sk-throw' },
  { id: 'bowShot', name: '활 쏘기', kind: 'atk', rarity: 'common', cost: 0, target: 'enemy', ops: [{ op: 'dmg', n: 4 }], up: { ops: [{ op: 'dmg', n: 6 }] }, art: 'ic-w-bow-0' },
  { id: 'windCut', name: '바람 베기', kind: 'atk', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 7 }, { op: 'block', n: 3 }], up: { ops: [{ op: 'dmg', n: 10 }, { op: 'block', n: 4 }] }, art: 'fx-wind' },
  { id: 'coinThrow', name: '엽전 던지기', kind: 'atk', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 5 }, { op: 'winGold', n: 5 }], up: { ops: [{ op: 'dmg', n: 7 }, { op: 'winGold', n: 7 }] }, art: 'ic-coin' },
  { id: 'sling', name: '돌팔매', kind: 'atk', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 6, pierce: true }], up: { ops: [{ op: 'dmg', n: 9, pierce: true }] }, art: 'ic-stone' },
  { id: 'tripleStab', name: '세 번 찌르기', kind: 'atk', rarity: 'common', cost: 2, target: 'enemy', ops: [{ op: 'dmg', n: 5, times: 3 }], up: { ops: [{ op: 'dmg', n: 7, times: 3 }] }, art: 'ic-sk-triple' },
  { id: 'trident', name: '삼지창', kind: 'atk', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 5 }, { op: 'dmg', n: 3, to: 'others' }], up: { ops: [{ op: 'dmg', n: 7 }, { op: 'dmg', n: 4, to: 'others' }] }, art: 'ic-sk-fork' },
  { id: 'endure', name: '버티기', kind: 'def', rarity: 'common', cost: 2, target: 'none', ops: [{ op: 'block', n: 13 }], up: { ops: [{ op: 'block', n: 18 }] }, art: 'ic-w-fan-1' },
  { id: 'shadowStep', name: '그림자 걸음', kind: 'def', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'block', n: 4 }, { op: 'nextCut', n: 1 }], up: { ops: [{ op: 'block', n: 6 }, { op: 'nextCut', n: 1 }] }, art: 'ic-sk-dash' },
  { id: 'stoneWall', name: '돌담', kind: 'def', rarity: 'common', cost: 2, target: 'none', ops: [{ op: 'block', n: 10 }, { op: 'nextBlock', n: 5 }], up: { ops: [{ op: 'block', n: 13 }, { op: 'nextBlock', n: 7 }] }, art: 'ic-w-fan-2' },
  { id: 'fanWind', name: '부채 바람', kind: 'skill', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'block', n: 4 }, { op: 'draw', n: 2 }], up: { ops: [{ op: 'block', n: 6 }, { op: 'draw', n: 2 }] }, art: 'ic-fan' },
  { id: 'rainDrop', name: '물벼락', kind: 'skill', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'status', id: 'wet', n: 1, to: 'all' }], up: { cost: 0 }, art: 'fx-rain' },
  { id: 'herb', name: '약초', kind: 'skill', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'heal', n: 4 }], exhaust: true, up: { ops: [{ op: 'heal', n: 6 }] }, art: 'fx-heal' },
  { id: 'aim', name: '겨누기', kind: 'skill', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'aim' }], up: { cost: 0 }, art: 'ic-acc-crit' },
  { id: 'stickyBurr', name: '끈끈이 가시', kind: 'skill', rarity: 'common', cost: 1, target: 'enemy', ops: [{ op: 'status', id: 'weak', n: 2 }], up: { ops: [{ op: 'status', id: 'weak', n: 3 }] }, art: 'p-burr' },
  { id: 'pollen', name: '꽃가루', kind: 'skill', rarity: 'common', cost: 1, target: 'none', ops: [{ op: 'status', id: 'weak', n: 1, to: 'all' }], up: { cost: 0 }, art: 'p-pollen' },
  { id: 'breathe', name: '숨 고르기', kind: 'skill', rarity: 'common', cost: 0, target: 'none', ops: [{ op: 'draw', n: 1 }, { op: 'energy', n: 1 }], exhaust: true, up: { ops: [{ op: 'draw', n: 2 }, { op: 'energy', n: 1 }] }, art: 'ic-mp' },

  // ---------- 고급 ----------
  { id: 'fireTalisman', name: '불부적', kind: 'atk', rarity: 'uncommon', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 5 }, { op: 'status', id: 'fire', n: 3 }], up: { ops: [{ op: 'dmg', n: 7 }, { op: 'status', id: 'fire', n: 4 }] }, art: 'fx-flame' },
  { id: 'ironWall', name: '철벽', kind: 'def', rarity: 'uncommon', cost: 2, target: 'none', ops: [{ op: 'block', n: 18 }], up: { ops: [{ op: 'block', n: 25 }] }, art: 'ic-w-fan-5' },
  { id: 'temper', name: '담금질', kind: 'power', rarity: 'uncommon', cost: 1, target: 'none', ops: [{ op: 'power', id: 'atkUp', n: 2 }], up: { cost: 0 }, art: 'ic-w-sword-6' },
  { id: 'gather', name: '기 모으기', kind: 'skill', rarity: 'uncommon', cost: 1, target: 'none', ops: [{ op: 'energy', n: 2 }], exhaust: true, up: { cost: 0 }, art: 'ic-acc-mp' },
  { id: 'boltTalisman', name: '번개부적', kind: 'atk', rarity: 'uncommon', cost: 2, target: 'none', ops: [{ op: 'dmg', n: 5, times: 4, to: 'random', ifSt: 'wet', ifK: 2 }], up: { ops: [{ op: 'dmg', n: 7, times: 4, to: 'random', ifSt: 'wet', ifK: 2 }] }, art: 'fx-bolt' },
  { id: 'whirlwind', name: '회오리', kind: 'atk', rarity: 'uncommon', cost: 2, target: 'none', ops: [{ op: 'dmg', n: 5, times: 2, to: 'all' }], up: { ops: [{ op: 'dmg', n: 7, times: 2, to: 'all' }] }, art: 'ic-sk-tornado' },
  { id: 'arrowStorm', name: '화살 소나기', kind: 'atk', rarity: 'uncommon', cost: 3, target: 'none', ops: [{ op: 'dmg', n: 4, times: 3, to: 'all' }], up: { cost: 2 }, art: 'ic-sk-rain' },
  { id: 'shockwave', name: '충격파', kind: 'atk', rarity: 'uncommon', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 8 }, { op: 'status', id: 'weak', n: 2 }], up: { ops: [{ op: 'dmg', n: 11 }, { op: 'status', id: 'weak', n: 3 }] }, art: 'fx-shock' },
  { id: 'poisonSpear', name: '독 묻힌 창', kind: 'atk', rarity: 'uncommon', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 6 }, { op: 'status', id: 'poison', n: 4 }], up: { ops: [{ op: 'dmg', n: 8 }, { op: 'status', id: 'poison', n: 6 }] }, art: 'ic-w-spear-5' },
  { id: 'vampSlash', name: '흡혈 베기', kind: 'atk', rarity: 'uncommon', cost: 2, target: 'enemy', ops: [{ op: 'dmg', n: 10, steal: 0.5 }], exhaust: true, up: { ops: [{ op: 'dmg', n: 14, steal: 0.5 }] }, art: 'fx-fang' },
  { id: 'foxBead', name: '여우구슬', kind: 'atk', rarity: 'uncommon', cost: 1, target: 'enemy', ops: [{ op: 'dmg', n: 4 }, { op: 'freeRandom', n: 1 }], up: { ops: [{ op: 'dmg', n: 6 }, { op: 'freeRandom', n: 1 }] }, art: 'p-foxorb' },
  { id: 'boneBreak', name: '뼈 부수기', kind: 'atk', rarity: 'uncommon', cost: 2, target: 'enemy', ops: [{ op: 'dmg', n: 12 }, { op: 'status', id: 'wet', n: 2 }], up: { ops: [{ op: 'dmg', n: 16 }, { op: 'status', id: 'wet', n: 3 }] }, art: 'ic-w-sword-7' },
  { id: 'roll', name: '구르기', kind: 'def', rarity: 'uncommon', cost: 0, target: 'none', ops: [{ op: 'block', n: 4 }, { op: 'nextDraw', n: 1 }], up: { ops: [{ op: 'block', n: 6 }, { op: 'nextDraw', n: 1 }] }, art: 'ic-roll' },
  { id: 'mirrorFan', name: '거울 부채', kind: 'def', rarity: 'uncommon', cost: 1, target: 'none', ops: [{ op: 'block', n: 7 }, { op: 'ward', n: 1 }], up: { ops: [{ op: 'block', n: 10 }, { op: 'ward', n: 1 }] }, art: 'ic-w-fan-6' },
  { id: 'wisdomOrb', name: '지혜구슬', kind: 'skill', rarity: 'uncommon', cost: 1, target: 'none', ops: [{ op: 'draw', n: 3 }], up: { cost: 0 }, art: 'p-orb' },
  { id: 'spreadPoison', name: '독 퍼뜨리기', kind: 'skill', rarity: 'uncommon', cost: 1, target: 'enemy', ops: [{ op: 'spread', id: 'poison' }], up: { cost: 0 }, art: 'fx-pool' },
  { id: 'wildfire', name: '불길 번지기', kind: 'skill', rarity: 'uncommon', cost: 1, target: 'none', ops: [{ op: 'status', id: 'fire', n: 2, to: 'all', plus: 2 }], up: { ops: [{ op: 'status', id: 'fire', n: 3, to: 'all', plus: 3 }] }, art: 'fx-boom' },
  { id: 'viperPath', name: '독사의 길', kind: 'power', rarity: 'uncommon', cost: 1, target: 'none', ops: [{ op: 'power', id: 'poisonUp', n: 1 }], up: { cost: 0 }, art: 'ic-w-spear-6' },
  { id: 'swiftBody', name: '날랜 몸', kind: 'power', rarity: 'uncommon', cost: 2, target: 'none', ops: [{ op: 'power', id: 'drawUp', n: 1 }], up: { cost: 1 }, art: 'ic-acc-speed' },
  { id: 'guardian', name: '수호신', kind: 'power', rarity: 'uncommon', cost: 2, target: 'none', ops: [{ op: 'power', id: 'guard', n: 3 }], up: { ops: [{ op: 'power', id: 'guard', n: 4 }] }, art: 'ic-star' },

  // ---------- 전설 ----------
  { id: 'diamond', name: '금강', kind: 'def', rarity: 'legend', cost: 2, target: 'none', ops: [{ op: 'block', n: 30 }], exhaust: true, up: { ops: [{ op: 'block', n: 42 }] }, art: 'ic-w-fan-11' },
  { id: 'twelveArray', name: '십이지 대진', kind: 'power', rarity: 'legend', cost: 3, target: 'none', ops: [{ op: 'power', id: 'energyUp', n: 1 }], up: { cost: 2 }, art: 'ic-key' },
  { id: 'thunderGeneral', name: '천둥 신장', kind: 'atk', rarity: 'legend', cost: 3, target: 'none', ops: [{ op: 'dmg', n: 20, to: 'all' }, { op: 'status', id: 'wet', n: 2, to: 'all' }], up: { ops: [{ op: 'dmg', n: 28, to: 'all' }, { op: 'status', id: 'wet', n: 3, to: 'all' }] }, art: 'ic-w-spear-11' },
  { id: 'dragonRise', name: '용오름', kind: 'atk', rarity: 'legend', cost: 2, target: 'enemy', ops: [{ op: 'dmg', n: 6, per: 'battleAtk', k: 2 }], up: { ops: [{ op: 'dmg', n: 8, per: 'battleAtk', k: 3 }] }, art: 'ic-w-sword-11', text: '피해6, 이 전투 공격카드 1장당 +2', textUp: '피해8, 이 전투 공격카드 1장당 +3' },
  { id: 'meteor', name: '별똥별', kind: 'atk', rarity: 'legend', cost: 3, target: 'none', ops: [{ op: 'dmg', n: 8, times: 6, to: 'random' }], up: { ops: [{ op: 'dmg', n: 11, times: 6, to: 'random' }] }, art: 'ic-w-bow-9' },
  { id: 'infiniteFan', name: '무한 부채', kind: 'power', rarity: 'legend', cost: 2, target: 'none', ops: [{ op: 'power', id: 'drawBlock', n: 1 }], up: { cost: 1 }, art: 'ic-w-fan-10' },
  { id: 'myriadPoison', name: '만독', kind: 'skill', rarity: 'legend', cost: 2, target: 'enemy', ops: [{ op: 'mulSt', id: 'poison', k: 3 }], exhaust: true, up: { cost: 1 }, art: 'ic-w-spear-10' },
  { id: 'timeStop', name: '시간 멈춤', kind: 'skill', rarity: 'legend', cost: 3, target: 'none', ops: [{ op: 'stun' }], exhaust: true, up: { cost: 2 }, art: 'ic-w-bow-10' },
  { id: 'phoenixFeather', name: '불사조 깃', kind: 'power', rarity: 'legend', cost: 2, target: 'none', ops: [{ op: 'power', id: 'phoenix', n: 10 }], up: { cost: 1 }, art: 'ic-w-bow-11' },
  { id: 'haetae', name: '해태의 축복', kind: 'power', rarity: 'legend', cost: 1, target: 'none', ops: [{ op: 'power', id: 'regen', n: 2 }], up: { ops: [{ op: 'power', id: 'regen', n: 3 }] }, art: 'ic-hp' },

  // ---------- 영웅 전용 (전용1 = 시작 덱 · 전용2 = 고급, 그 영웅 보상에서만) · 그림은 열두길 고유 스킬 아이콘 ic-u-<영웅> ----------
  // 찍찍이 (쥐)
  { id: 'ratHole', name: '쥐구멍', kind: 'skill', rarity: 'hero', cost: 0, target: 'none', ops: [{ op: 'draw', n: 2 }, { op: 'pick', kind: 'discard', n: 1 }], up: { ops: [{ op: 'draw', n: 3 }, { op: 'pick', kind: 'discard', n: 1 }] }, art: 'ic-u-rat', hero: 'rat', text: '2장 뽑고 1장 버림', textUp: '3장 뽑고 1장 버림' },
  { id: 'ratFire', name: '쥐불놀이', kind: 'atk', rarity: 'hero2', cost: 1, target: 'none', ops: [{ op: 'dmg', n: 0, to: 'all', per: 'drawn', k: 2 }], up: { ops: [{ op: 'dmg', n: 0, to: 'all', per: 'drawn', k: 3 }] }, art: 'ic-u-rat', hero: 'rat', text: '이번 턴 뽑은 카드당 모든 적 피해 2', textUp: '이번 턴 뽑은 카드당 모든 적 피해 3' },
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
  { id: 'shear', name: '털깎기', kind: 'atk', rarity: 'hero2', cost: 0, target: 'none', ops: [{ op: 'dmg', n: 0, to: 'all', per: 'block', k: 1 }, { op: 'clearBlock' }], up: { ops: [{ op: 'dmg', n: 0, to: 'all', per: 'block', k: 1.5 }, { op: 'clearBlock' }] }, art: 'ic-u-sheep', hero: 'sheep', text: '방어를 모두 없애고 그만큼 모든 적 피해', textUp: '방어를 모두 없애고 1.5배만큼 모든 적 피해' },
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
