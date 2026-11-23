import { BOSS_ART, BOSS_DESC, BOSS_IDS, ENEMIES, ENEMY_IDS, type BossId, type EnemyKind } from '../data/balance';
import { REGION_NAMES } from '../data/growth';
import { STAGES, type StageDef } from '../data/stages';
import type { RunState, SimEvent } from './sim';

/**
 * 요괴·보스 도감 (서버 없음: 만난 것은 기기에만 저장한다).
 * "만났다" = 판에서 그 요괴 무리와 실제로 엮였다(쏘아 쓰러뜨림 · 부딪힘 · 불에 맞음 · 튀어나옴 · 되살아남 · 불려 나옴),
 * 보스는 싸움이 시작돼 공격 예고가 한 번이라도 떴다. 작은 대장 요괴(chief)는 그 지역 요괴를 크게 그린 것이라 도감에 따로 없다.
 */

export type CodexId = `e:${EnemyKind}` | `b:${BossId}`;

export interface CodexEntry {
  id: CodexId;
  group: 'enemy' | 'boss';
  name: string;
  desc: string;
  /** 그림 이름 (public/art/<이름>.png) */
  art: string;
  /** 수치 한 줄씩 [이름, 값] */
  facts: [string, string][];
}

const speedText = (v: number) => (v <= 0 ? '제자리' : v < 40 ? '느림' : v < 100 ? '보통' : '빠름');

export const CODEX: CodexEntry[] = [
  ...ENEMY_IDS.map((k): CodexEntry => {
    const d = ENEMIES[k];
    return {
      id: `e:${k}`,
      group: 'enemy',
      name: d.name,
      desc: d.desc,
      art: d.art,
      facts: [
        ['체력', String(d.hp)],
        ['부딪히면', `대원 ${d.strength}명`],
        ['빠르기', speedText(d.speed)],
      ],
    };
  }),
  ...BOSS_IDS.map((k, i): CodexEntry => ({
    id: `b:${k}`,
    group: 'boss',
    name: BOSS_ART[k].name,
    desc: BOSS_DESC[k],
    art: BOSS_ART[k].art,
    facts: [['사는 곳', `${i + 1}지역 ${REGION_NAMES[i]}`]],
  })),
];

export const CODEX_IDS: CodexId[] = CODEX.map((c) => c.id);
const KNOWN = new Set<string>(CODEX_IDS);
export const isCodexId = (v: unknown): v is CodexId => typeof v === 'string' && KNOWN.has(v);
export const codexEntry = (id: CodexId): CodexEntry => CODEX.find((c) => c.id === id)!;

const bossId = (kind: string): CodexId | null => (kind === 'chief' ? null : (`b:${kind}` as CodexId));

/** 판 이벤트 하나 → 이 이벤트로 만난 도감 항목 (없으면 null) */
export function seenOf(s: Pick<RunState, 'boss'>, e: SimEvent): CodexId | null {
  switch (e.type) {
    case 'kill':
    case 'emerge':
    case 'revive':
    case 'clash':
    case 'fire':
    case 'summon':
      return `e:${e.horde.kind}`;
    case 'bossWarn':
    case 'bossHit':
      return bossId(s.boss.kind);
    case 'bossDown':
      return bossId(e.boss.kind);
    default:
      return null;
  }
}

/** 한 스테이지에 나오는 요괴(길에 놓인 순서, 보스가 불러내는 요괴 포함)와 지역 보스 (작은 대장이면 null) */
export function stageFoes(st: Pick<StageDef, 'items' | 'boss'>): { enemies: EnemyKind[]; boss: BossId | null } {
  const enemies: EnemyKind[] = [];
  const add = (k: EnemyKind) => {
    if (!enemies.includes(k)) enemies.push(k);
  };
  for (const it of st.items) if (it.t === 'horde') add(it.kind);
  if (st.boss.traits?.summon) add(st.boss.traits.summon.kind);
  return { enemies, boss: st.boss.kind === 'chief' ? null : st.boss.kind };
}

/** 스테이지 화면의 "이번에 나오는 요괴" 줄: 요괴들 + (보스 스테이지면) 지역 보스 */
export const stageFoeIds = (st: Pick<StageDef, 'items' | 'boss'>): CodexId[] => {
  const f = stageFoes(st);
  return [...f.enemies.map((k): CodexId => `e:${k}`), ...(f.boss ? [`b:${f.boss}` as CodexId] : [])];
};

let firstMemo: Map<CodexId, string> | null = null;
/** 모험에서 처음 나오는 스테이지 id ('3-2'). 모험에 나오지 않으면 '' */
export function firstStageOf(id: CodexId): string {
  if (!firstMemo) {
    firstMemo = new Map();
    for (const st of STAGES) for (const f of stageFoeIds(st)) if (!firstMemo.has(f)) firstMemo.set(f, st.id);
  }
  return firstMemo.get(id) ?? '';
}

// ---------- 기기 저장 ----------

export interface CodexStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 저장된 글 → 만난 항목 (망가진 값·모르는 이름은 버린다) */
export function parseSeen(raw: string | null): Set<CodexId> {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return new Set(Array.isArray(v) ? v.filter(isCodexId) : []);
  } catch {
    return new Set();
  }
}

export const codexKey = (userId: string) => `siacharge:codex:${userId}`;

export interface Codex {
  has(id: CodexId): boolean;
  /** 처음 만났으면 저장하고 true */
  add(id: CodexId): boolean;
  count(): number;
}

/** 계정마다 따로 (한 기기를 여럿이 써도 섞이지 않게). 저장에 실패해도 이번 실행 동안은 기억한다 */
export function createCodex(store: CodexStore | null, userId: string): Codex {
  const key = codexKey(userId);
  let seen = new Set<CodexId>();
  try {
    seen = parseSeen(store?.getItem(key) ?? null);
  } catch {
    /* 저장 공간을 읽지 못함 */
  }
  return {
    has: (id) => seen.has(id),
    add(id) {
      if (seen.has(id) || !KNOWN.has(id)) return false;
      seen.add(id);
      try {
        // 다른 탭에서 그 사이 적은 것을 지우지 않게 합쳐서 쓴다
        for (const x of parseSeen(store?.getItem(key) ?? null)) seen.add(x);
        store?.setItem(key, JSON.stringify(CODEX_IDS.filter((x) => seen.has(x))));
      } catch {
        /* 이번 실행만 */
      }
      return true;
    },
    count: () => seen.size,
  };
}
