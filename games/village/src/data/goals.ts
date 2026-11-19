import { LEVEL_EXP } from './balance';
import { BUILDING, type BuildingType } from './buildings';
import { RESIDENT } from './residents';

/**
 * 마을 목표 (PRD 8장): 따로 튜토리얼 없이 이 목록이 길잡이다. 한 번에 하나씩, 순서대로, 마을 레벨 30까지.
 *   build    그 건물을 n채 다 짓기
 *   upgrade  그 건물 하나를 레벨 n 으로
 *   level    마을 레벨 n
 *   deco     장식물을 모두 n개 갖기 (보관함에 든 것도 센다)
 *   resident 주민 n명이 이사 오기
 *   — 아래는 이 목표가 시작된 뒤부터 센다 —
 *   harvest  수확 n번 (건물 하나를 거두면 한 번)
 *   sell     장터에서 엽전 n닢어치 팔기
 *   craft    그 건물(방앗간 · 장독대)에서 만든 것을 n개 거두기
 *   request  주민 부탁 n번 들어주기
 *   assign   주민을 건물에 배치하기 (n번)
 * SQL 의 _village_goals 와 같아야 한다 (tests/sql.test.ts). 문구는 화면에서만 쓴다.
 */
export type GoalKind = 'build' | 'upgrade' | 'harvest' | 'level' | 'sell' | 'craft' | 'deco' | 'resident' | 'request' | 'assign';
/** 그 목표가 시작된 뒤의 횟수(goalProgress)로 세는 종류 */
export const COUNTED: readonly GoalKind[] = ['harvest', 'sell', 'craft', 'request', 'assign'];

export interface GoalDef {
  kind: GoalKind;
  /** build · upgrade · craft 의 건물 (그 밖에는 '') */
  type: BuildingType | '';
  n: number;
  /** 보상 */
  rice: number;
  wood: number;
  stone: number;
  coin: number;
  exp: number;
}

type Short = [GoalKind, BuildingType | '', number];
const b = (type: BuildingType, n: number): Short => ['build', type, n];
const u = (type: BuildingType, n: number): Short => ['upgrade', type, n];
const h = (n: number): Short => ['harvest', '', n];
const sell = (n: number): Short => ['sell', '', n];
const craft = (type: BuildingType, n: number): Short => ['craft', type, n];
const deco = (n: number): Short => ['deco', '', n];
const res = (n: number): Short => ['resident', '', n];
const req = (n: number): Short => ['request', '', n];
const assign = (n: number): Short => ['assign', '', n];

/** 마을 레벨마다의 목표 (그 레벨에서 할 일들. 끝은 늘 '다음 레벨 달성') */
const BY_LEVEL: Short[][] = [
  /* 1 */ [b('paddy', 1), b('house', 1), res(1), h(1), b('paddy', 2)],
  /* 2 */ [b('lumber', 1), b('storage', 1), u('hall', 2), u('paddy', 2), b('house', 2), req(1), h(5)],
  /* 3 */ [b('market', 1), sell(20), b('paddy', 3), u('lumber', 2), assign(1)],
  /* 4 */ [b('quarry', 1), b('lumber', 3), u('hall', 3), u('storage', 2), deco(2)],
  /* 5 */ [b('mill', 1), craft('mill', 5), b('paddy', 4), u('paddy', 3), req(3), h(20)],
  /* 6 */ [u('hall', 4), b('quarry', 3), u('lumber', 3), sell(100)],
  /* 7 */ [b('paddy', 5), b('storage', 3), u('paddy', 4), craft('mill', 20), res(5)],
  /* 8 */ [b('jar', 1), craft('jar', 2), b('mill', 2), u('quarry', 4)],
  /* 9 */ [u('hall', 5), u('storage', 4), deco(6), sell(300), req(5)],
  /* 10 */ [b('paddy', 6), u('paddy', 5), u('mill', 3), craft('jar', 5)],
  /* 11 */ [b('lumber', 6), u('lumber', 5), res(7), h(40)],
  /* 12 */ [u('hall', 6), b('mill', 3), b('jar', 2), u('quarry', 5)],
  /* 13 */ [b('paddy', 7), u('paddy', 6), sell(600), req(8)],
  /* 14 */ [b('storage', 5), u('storage', 5), deco(10)],
  /* 15 */ [u('hall', 7), u('lumber', 6), craft('mill', 60), res(9)],
  /* 16 */ [b('quarry', 6), b('mill', 4), u('paddy', 7)],
  /* 17 */ [b('paddy', 8), b('jar', 3), craft('jar', 10), req(10)],
  /* 18 */ [b('lumber', 8), b('storage', 6), u('quarry', 7), res(10)],
  /* 19 */ [u('hall', 8), u('paddy', 8), sell(1200)],
  /* 20 */ [b('quarry', 7), u('lumber', 8), deco(14)],
  /* 21 */ [u('storage', 8), u('mill', 8), res(11), h(100)],
  /* 22 */ [u('market', 8), craft('jar', 20), sell(2000), req(12)],
  /* 23 */ [u('hall', 9), u('paddy', 9), u('lumber', 9)],
  /* 24 */ [u('quarry', 9), u('jar', 9), res(12), craft('mill', 150)],
  /* 25 */ [u('storage', 9), u('mill', 9), sell(3000)],
  /* 26 */ [u('market', 9), deco(18), h(200), req(15)],
  /* 27 */ [u('hall', 10), u('paddy', 10), u('lumber', 10)],
  /* 28 */ [u('quarry', 10), u('storage', 10), craft('jar', 40)],
  /* 29 */ [u('mill', 10), u('jar', 10), u('market', 10)],
];

const round5 = (v: number) => Math.round(v / 5) * 5;
/** 보상은 마을 레벨에 맞춰 정한다: 자원은 레벨에 비례, 경험치는 그 레벨에 필요한 양의 6% (적어도 10) */
export const GOALS: GoalDef[] = BY_LEVEL.flatMap((list, i) => {
  const lv = i + 1;
  const base = { rice: 20 + 15 * lv, wood: 20 + 15 * lv, stone: lv >= 5 ? 5 * lv : 0, coin: lv >= 3 ? 5 * lv : 0 };
  const exp = Math.max(10, round5(LEVEL_EXP[lv - 1] * 0.04));
  const out: GoalDef[] = list.map(([kind, type, n]) => ({ kind, type, n, ...base, exp }));
  out.push({ kind: 'level', type: '', n: lv + 1, rice: base.rice * 2, wood: base.wood * 2, stone: base.stone * 2, coin: base.coin * 2, exp: 0 });
  return out;
});

/** 목표 문구 */
export function goalText(d: GoalDef): string {
  const name = d.type ? BUILDING[d.type].name : '';
  switch (d.kind) {
    case 'build':
      return d.n === 1 ? `${name}${josa(name, '을', '를')} 지어 보세요` : `${name}${josa(name, '을', '를')} ${d.n}채까지 지어 보세요`;
    case 'upgrade':
      return `${name}${josa(name, '을', '를')} 레벨 ${d.n}${josa(String(d.n), '으로', '로')} 올려 보세요`;
    case 'harvest':
      return d.n === 1 ? '쌓인 자원을 수확해 보세요' : `자원을 ${d.n}번 수확해 보세요`;
    case 'level':
      return `마을 레벨 ${d.n}${josa(String(d.n), '을', '를')} 달성해 보세요`;
    case 'sell':
      return `장터에서 엽전 ${d.n}닢어치를 팔아 보세요`;
    case 'craft':
      return d.type === 'jar' ? `장독대에서 특산품을 ${d.n}개 만들어 보세요` : `방앗간에서 떡을 ${d.n}개 만들어 보세요`;
    case 'deco':
      return `장식물을 ${d.n}개 모아 보세요`;
    case 'resident':
      return d.n === 1 ? `주민 집에 ${RESIDENT.rat.nick}${josa(RESIDENT.rat.nick, '이', '가')} 이사 오게 해 보세요` : `주민 ${d.n}명이 살게 해 보세요 (주민 집을 지으면 이사 와요)`;
    case 'request':
      return d.n === 1 ? '주민의 부탁을 들어주세요' : `주민의 부탁을 ${d.n}번 들어주세요`;
    case 'assign':
      return '주민을 잘하는 일터에 배치해 보세요';
  }
}

const DIGIT_END = [true, true, false, true, false, false, true, true, true, false]; // 0 영 1 일 2 이 3 삼 4 사 5 오 6 육 7 칠 8 팔 9 구
/** 받침이 있으면 a, 없으면 b (숫자는 읽는 소리로. '로'는 ㄹ 받침 뒤에도 '로') */
export function josa(word: string, a: string, b: string): string {
  const last = word[word.length - 1];
  if (last >= '0' && last <= '9') {
    const d = Number(last);
    if (a === '으로' && (d === 1 || d === 7 || d === 8)) return b;
    return DIGIT_END[d] ? a : b;
  }
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return a;
  const jong = (c - 0xac00) % 28;
  if (a === '으로' && jong === 8) return b;
  return jong === 0 ? b : a;
}
