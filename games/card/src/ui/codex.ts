/**
 * 도감 (PRD [진행·재화]): 얻은 카드·부적, 만난 요괴. 이 기기에만 저장하고 게임에는 영향이 없다 (오늘의 도전은 넣지 않는다).
 */
import type { RunState } from '../game/rules';

export interface Codex {
  cards: string[];
  relics: string[];
  foes: string[];
}

const empty = (): Codex => ({ cards: [], relics: [], foes: [] });
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function loadCodex(key: string): Codex {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ? { cards: list(v.cards), relics: list(v.relics), foes: list(v.foes) } : empty();
  } catch {
    return empty();
  }
}

/** 판 상태에서 새로 본 것을 더한다 → 바뀌었으면 true */
export function addToCodex(c: Codex, run: RunState): boolean {
  let changed = false;
  const add = (arr: string[], id: string) => {
    if (!arr.includes(id)) {
      arr.push(id);
      changed = true;
    }
  };
  for (const d of run.deck) add(c.cards, d.id);
  for (const r of run.relics) add(c.relics, r);
  for (const f of run.battle?.foes ?? []) add(c.foes, f.id);
  return changed;
}

export function saveCodex(key: string, c: Codex) {
  try {
    localStorage.setItem(key, JSON.stringify(c));
  } catch {
    /* 저장 못 해도 게임은 그대로 */
  }
}
