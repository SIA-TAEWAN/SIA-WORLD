// 기체 13종. 처음에는 쥐·소·용만 열려 있고, 나머지는 아케이드 스테이지를 처음 깰 때마다 하나씩,
// 고양이호는 스테이지 5 클리어 뒤 시아코인 100개로 산다 (M5 에서 서버 구매).
// speed = 키보드로 움직일 때 한 스텝(1/60초) 거리. 드래그는 손가락이 움직인 만큼 따라가되 한 스텝 최대 speed × 2.6.
// fire[파워-1] = 한 번에 나가는 탄들 (x = 기체 기준 가로 위치, a = 각도(0 = 위), v = 속도).
import { CHARGE, COLOR, MATGO, TABLE } from '../theme';

export type ShipId = 'rat' | 'ox' | 'dragon' | 'tiger' | 'rabbit' | 'snake' | 'horse' | 'sheep' | 'monkey' | 'rooster' | 'dog' | 'pig' | 'cat';
export const SHIP_ORDER: ShipId[] = ['rat', 'ox', 'dragon', 'tiger', 'rabbit', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig', 'cat'];

export type ShotKind = 'straight' | 'homing' | 'wave' | 'bounce';
export interface ShotSpec { x: number; a?: number; v?: number; dmg: number; kind?: ShotKind; pierce?: boolean; r?: number; life?: number }
export type OptionKind = 'basic' | 'cloud' | 'clone' | 'hunter';
export type ChargeKind = 'burst' | 'dash' | 'laser' | 'tigerDash' | 'teleport' | 'poison' | 'pierceDash' | 'wool' | 'cloneRush' | 'homing' | 'bite' | 'magnet' | 'absorb';
export type BombKind = 'chain' | 'quake' | 'flame' | 'roar' | 'moon' | 'mist' | 'hooves' | 'longGuard' | 'barrage' | 'feather' | 'track' | 'coinRain' | 'freeze';

export interface Ship {
  id: ShipId;
  name: string;
  pilot: string;
  animal: string;
  /** 속도 표시 (1 느림 ~ 4 매우 빠름) */
  speedLv: 1 | 2 | 3 | 4;
  speed: number;
  /** 화면 표시용 능력치 (0~1) */
  power: number;
  range: number;
  every: number;
  fire: ShotSpec[][];
  option: OptionKind;
  charge: ChargeKind;
  bomb: BombKind;
  shotText: string;
  chargeText: string;
  bombText: string;
  /** 해금: 0 = 처음부터, n = 아케이드 스테이지 n 을 처음 깨면, 'buy' = 고양이 (스테이지 5 + 시아코인 100) */
  unlock: number | 'buy';
  /** 황소호: 피격 1회를 막는 실드 (20초마다 다시 참) */
  shield?: boolean;
  /** 임시 그림 색 (몸통 · 날개). 받은 그림(public/art/ship-<id>.png)을 못 읽을 때만 */
  color: [number, number];
}

const SPEED = { 1: 7.5, 2: 9, 3: 10.5, 4: 12 } as const;
const fan = (n: number, spread: number, dmg: number, extra: Partial<ShotSpec> = {}): ShotSpec[] =>
  Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * 8, a: n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1), dmg, ...extra }));
const row = (n: number, gap: number, dmg: number, extra: Partial<ShotSpec> = {}): ShotSpec[] =>
  Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * gap, dmg, ...extra }));

const S = (s: Omit<Ship, 'speed'>): Ship => ({ ...s, speed: SPEED[s.speedLv] });

export const SHIPS: Record<ShipId, Ship> = {
  rat: S({
    id: 'rat', name: '재빠르호', pilot: '찍찍이', animal: '쥐', speedLv: 3, power: 0.45, range: 1, every: 5,
    fire: [fan(3, 0.3, 0.8), fan(5, 0.55, 0.8), fan(5, 0.6, 0.85), fan(7, 0.85, 0.85)],
    option: 'basic', charge: 'burst', bomb: 'chain', unlock: 0, color: [TABLE.blackjack, COLOR.skyDeep],
    shotText: '넓은 확산탄', chargeText: '주변 파편 폭발', bombText: '작은 폭탄 연쇄',
  }),
  ox: S({
    id: 'ox', name: '황소호', pilot: '우직이', animal: '소', speedLv: 1, power: 0.8, range: 0.35, every: 5,
    fire: [row(2, 22, 1.5, { r: 14 }), row(3, 20, 1.5, { r: 14 }), row(3, 22, 1.6, { r: 14 }), row(4, 20, 1.6, { r: 14 })],
    option: 'basic', charge: 'dash', bomb: 'quake', unlock: 0, shield: true, color: [CHARGE.crate, CHARGE.log],
    shotText: '굵은 연사탄 + 피격 1회 막는 실드', chargeText: '전방 돌진', bombText: '지진 충격파',
  }),
  dragon: S({
    id: 'dragon', name: '청룡호', pilot: '여의룡', animal: '용', speedLv: 2, power: 0.65, range: 0.45, every: 4,
    fire: [row(2, 18, 1), row(3, 16, 1), [{ x: -24, a: -0.02, dmg: 1 }, ...row(2, 16, 1), { x: 24, a: 0.02, dmg: 1 }], [{ x: -30, a: -0.05, dmg: 1 }, { x: -15, a: -0.013, dmg: 1 }, { x: 0, dmg: 1 }, { x: 15, a: 0.013, dmg: 1 }, { x: 30, a: 0.05, dmg: 1 }]],
    option: 'basic', charge: 'laser', bomb: 'flame', unlock: 0, color: [TABLE.matgo, MATGO.matDark],
    shotText: '전방 집중 발칸', chargeText: '관통 레이저', bombText: '화면 세로 화염',
  }),
  tiger: S({
    id: 'tiger', name: '백호호', pilot: '어흥이', animal: '호랑이', speedLv: 1, power: 0.85, range: 0.35, every: 7,
    fire: [row(1, 0, 2.2, { pierce: true, r: 16 }), row(2, 26, 2, { pierce: true, r: 16 }), row(2, 28, 2.2, { pierce: true, r: 16 }), row(3, 26, 2.2, { pierce: true, r: 16 })],
    option: 'basic', charge: 'tigerDash', bomb: 'roar', unlock: 1, color: [COLOR.white, COLOR.primaryDeep],
    shotText: '굵은 관통탄', chargeText: '전방 돌격 (짧은 무적)', bombText: '포효 충격파',
  }),
  rabbit: S({
    id: 'rabbit', name: '옥토끼호', pilot: '깡총이', animal: '토끼', speedLv: 4, power: 0.5, range: 0.75, every: 4,
    fire: [[{ x: -12, a: -0.12, dmg: 0.9 }, { x: 12, a: 0.12, dmg: 0.9 }], [{ x: -12, a: -0.1, dmg: 0.9 }, { x: -6, a: -0.22, dmg: 0.9 }, { x: 6, a: 0.22, dmg: 0.9 }, { x: 12, a: 0.1, dmg: 0.9 }],
      [{ x: -12, a: -0.08, dmg: 1 }, { x: -6, a: -0.2, dmg: 1 }, { x: 6, a: 0.2, dmg: 1 }, { x: 12, a: 0.08, dmg: 1 }],
      [{ x: -14, a: -0.06, dmg: 1 }, { x: -8, a: -0.16, dmg: 1 }, { x: -2, a: -0.28, dmg: 1 }, { x: 2, a: 0.28, dmg: 1 }, { x: 8, a: 0.16, dmg: 1 }, { x: 14, a: 0.06, dmg: 1 }]],
    option: 'basic', charge: 'teleport', bomb: 'moon', unlock: 2, color: [0xffb3c8, 0xff8fb1],
    shotText: '양갈래 탄', chargeText: '짧은 순간이동 (무적)', bombText: '달빛 폭풍',
  }),
  snake: S({
    id: 'snake', name: '흑사호', pilot: '스르르', animal: '뱀', speedLv: 2, power: 0.6, range: 0.7, every: 7,
    fire: [row(1, 0, 2.4, { kind: 'wave', r: 13 }), row(2, 20, 2.2, { kind: 'wave', r: 13 }), row(2, 24, 2.4, { kind: 'wave', r: 13 }), row(3, 22, 2.4, { kind: 'wave', r: 13 })],
    option: 'basic', charge: 'poison', bomb: 'mist', unlock: 3, color: [TABLE.poker, 0x3f9a8a],
    shotText: '휘어지는 파동탄', chargeText: '독구름 장판', bombText: '독안개 전체 피해',
  }),
  horse: S({
    id: 'horse', name: '천마호', pilot: '따각이', animal: '말', speedLv: 3, power: 0.7, range: 0.3, every: 4,
    fire: [row(2, 12, 1.05, { v: 42 }), row(3, 12, 1.05, { v: 42 }), row(3, 14, 1.15, { v: 42 }), row(4, 12, 1.15, { v: 42 })],
    option: 'basic', charge: 'pierceDash', bomb: 'hooves', unlock: 4, color: [0xf9a873, 0xe08a4f],
    shotText: '전방 고속탄', chargeText: '돌진 관통', bombText: '말발굽 연속 폭격',
  }),
  sheep: S({
    id: 'sheep', name: '운양호', pilot: '몽실이', animal: '양', speedLv: 1, power: 0.45, range: 0.5, every: 5,
    fire: [row(2, 18, 1), row(3, 16, 1), row(3, 18, 1.1), [{ x: -24, a: -0.06, dmg: 1.1 }, ...row(3, 16, 1.1), { x: 24, a: 0.06, dmg: 1.1 }]],
    option: 'cloud', charge: 'wool', bomb: 'longGuard', unlock: 5, color: [COLOR.panel, COLOR.lineSoft],
    shotText: '탄을 막는 구름 보조기', chargeText: '양털 방어막', bombText: '화면 탄 제거 + 긴 무적',
  }),
  monkey: S({
    id: 'monkey', name: '금원호', pilot: '재롱이', animal: '원숭이', speedLv: 2, power: 0.55, range: 0.6, every: 5,
    fire: [row(2, 18, 1), row(3, 16, 1), row(3, 16, 1), [{ x: -22, a: -0.05, dmg: 1 }, ...row(2, 14, 1), { x: 22, a: 0.05, dmg: 1 }]],
    option: 'clone', charge: 'cloneRush', bomb: 'barrage', unlock: 6, color: [0xe0a060, 0xb87a3a],
    shotText: '분신 보조기 추가', chargeText: '분신 돌격', bombText: '분신 일제 사격',
  }),
  rooster: S({
    id: 'rooster', name: '홍닭호', pilot: '꼬꼬댁', animal: '닭', speedLv: 2, power: 0.55, range: 0.8, every: 5,
    fire: [[...row(2, 16, 1), { x: 0, a: 0.5, dmg: 0.8, kind: 'homing', life: 90 }], [...row(2, 16, 1), { x: -20, a: -0.6, dmg: 0.8, kind: 'homing', life: 90 }, { x: 20, a: 0.6, dmg: 0.8, kind: 'homing', life: 90 }],
      [...row(3, 16, 1), { x: -20, a: -0.6, dmg: 0.8, kind: 'homing', life: 90 }, { x: 20, a: 0.6, dmg: 0.8, kind: 'homing', life: 90 }],
      [...row(3, 16, 1), { x: -24, a: -0.8, dmg: 0.8, kind: 'homing', life: 90 }, { x: 0, a: 0, dmg: 0.8, kind: 'homing', life: 90 }, { x: 24, a: 0.8, dmg: 0.8, kind: 'homing', life: 90 }]],
    option: 'basic', charge: 'homing', bomb: 'feather', unlock: 7, color: [COLOR.lose, 0xc04a3a],
    shotText: '전방탄 + 유도 깃털', chargeText: '유도탄 다발', bombText: '탄 지우는 방어막',
  }),
  dog: S({
    id: 'dog', name: '견우호', pilot: '멍뭉이', animal: '개', speedLv: 2, power: 0.6, range: 0.6, every: 5,
    fire: [row(2, 18, 1.1), row(3, 16, 1.1), row(3, 16, 1.1), row(4, 14, 1.1)],
    option: 'hunter', charge: 'bite', bomb: 'track', unlock: 8, color: [0xd9a05b, 0xb07a3a],
    shotText: '적을 쫓는 추적 보조기', chargeText: '근접 물어뜯기', bombText: '추적 폭격',
  }),
  pig: S({
    id: 'pig', name: '복돼지호', pilot: '꿀꿀이', animal: '돼지', speedLv: 1, power: 0.75, range: 0.9, every: 7,
    fire: [fan(5, 0.8, 1.4, { life: 34 }), fan(7, 1, 1.4, { life: 34 }), fan(7, 1.1, 1.5, { life: 36 }), fan(9, 1.3, 1.5, { life: 38 })],
    option: 'basic', charge: 'magnet', bomb: 'coinRain', unlock: 9, color: [0xffb3c8, 0xf08aa8],
    shotText: '넓은 산탄', chargeText: '금화 자석 (점수 특화)', bombText: '금화 비',
  }),
  cat: S({
    id: 'cat', name: '고양이호', pilot: '야옹이', animal: '고양이', speedLv: 3, power: 0.6, range: 0.75, every: 5,
    fire: [fan(3, 0.5, 1, { kind: 'bounce' }), fan(3, 0.6, 1.1, { kind: 'bounce' }), fan(4, 0.7, 1.1, { kind: 'bounce' }), fan(5, 0.8, 1.1, { kind: 'bounce' })],
    option: 'basic', charge: 'absorb', bomb: 'freeze', unlock: 'buy', color: [0xc9b0f0, 0x9a7ad8],
    shotText: '반사되는 발톱탄', chargeText: '탄 흡수 후 반격', bombText: '화면 전체 정지 2초',
  }),
};
