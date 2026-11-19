import { BUILDING, type BuildingType } from './buildings';

/**
 * 마을 목표 (PRD 8장): 따로 튜토리얼 없이 이 목록이 길잡이다. 한 번에 하나씩, 순서대로.
 *   build   그 건물을 n채 다 짓기
 *   upgrade 그 건물 하나를 레벨 n 으로
 *   harvest 이 목표가 시작된 뒤 수확 n번 (건물 하나를 거두면 한 번)
 *   level   마을 레벨 n
 * SQL 의 _village_goals 와 같아야 한다 (tests/sql.test.ts). 문구는 화면에서만 쓴다.
 */
export type GoalKind = 'build' | 'upgrade' | 'harvest' | 'level';

export interface GoalDef {
  kind: GoalKind;
  /** build · upgrade 의 건물 (그 밖에는 '') */
  type: BuildingType | '';
  n: number;
  /** 보상 */
  rice: number;
  wood: number;
  exp: number;
}

const g = (kind: GoalKind, type: BuildingType | '', n: number, rice: number, wood: number, exp: number): GoalDef => ({ kind, type, n, rice, wood, exp });

export const GOALS: GoalDef[] = [
  // 마을 레벨 1: 논과 집
  g('build', 'paddy', 1, 0, 20, 10),
  g('build', 'house', 1, 20, 0, 10),
  g('harvest', '', 1, 0, 20, 10),
  g('build', 'paddy', 2, 20, 0, 15),
  g('level', '', 2, 30, 30, 0),
  // 2: 벌목장 · 창고 · 마을 회관
  g('build', 'lumber', 1, 30, 0, 20),
  g('build', 'storage', 1, 0, 30, 20),
  g('upgrade', 'hall', 2, 40, 40, 25),
  g('upgrade', 'paddy', 2, 30, 0, 25),
  g('harvest', '', 5, 0, 40, 30),
  g('level', '', 3, 50, 50, 0),
  // 3
  g('build', 'paddy', 3, 40, 20, 30),
  g('build', 'house', 3, 30, 30, 30),
  g('upgrade', 'lumber', 2, 40, 40, 35),
  g('level', '', 4, 60, 60, 0),
  // 4
  g('build', 'lumber', 3, 60, 30, 40),
  g('upgrade', 'hall', 3, 80, 80, 50),
  g('upgrade', 'storage', 2, 60, 60, 40),
  g('level', '', 5, 80, 80, 0),
  // 5
  g('build', 'paddy', 4, 60, 60, 50),
  g('upgrade', 'paddy', 3, 80, 40, 60),
  g('harvest', '', 20, 60, 60, 70),
  g('level', '', 6, 100, 100, 0),
  // 6
  g('upgrade', 'hall', 4, 150, 150, 90),
  g('upgrade', 'lumber', 3, 100, 100, 80),
  g('level', '', 7, 120, 120, 0),
  // 7
  g('build', 'paddy', 5, 120, 120, 100),
  g('build', 'storage', 3, 150, 150, 110),
  g('upgrade', 'paddy', 4, 150, 150, 120),
  g('level', '', 8, 150, 150, 0),
];

/** 목표 문구 */
export function goalText(d: GoalDef): string {
  const name = d.type ? BUILDING[d.type].name : '';
  switch (d.kind) {
    case 'build':
      return d.n === 1 ? `${name}${josa(name, '을', '를')} 지어 보세요` : `${name}${josa(name, '을', '를')} ${d.n}채까지 지어 보세요`;
    case 'upgrade':
      return `${name}${josa(name, '을', '를')} 레벨 ${d.n}로 올려 보세요`;
    case 'harvest':
      return d.n === 1 ? '쌓인 자원을 수확해 보세요' : `자원을 ${d.n}번 수확해 보세요`;
    case 'level':
      return `마을 레벨 ${d.n}를 달성해 보세요`;
  }
}

/** 받침이 있으면 a, 없으면 b */
export function josa(word: string, a: string, b: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return a;
  return (c - 0xac00) % 28 === 0 ? b : a;
}
