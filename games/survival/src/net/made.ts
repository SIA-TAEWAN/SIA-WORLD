import { DEVICE_CODEX } from '../data/weapons';
import type { Store } from './pending';

/**
 * 이 기기에서 만들어 본 진화 무기 (data/weapons.ts 의 DEVICE_CODEX: 서버 도감 목록에 아직 없는 진화 무기).
 * 서버 도감에는 적히지 않으므로 도감의 진화 힌트·모은 수는 이 기록으로 보여 준다 (기기마다 따로, 계정을 가리지 않는다).
 * 서버 목록에 들어가면 DEVICE_CODEX 에서 빼기만 하면 된다 (그때부터는 서버 도감이 기억한다).
 */
const KEY = 'siasurvival:made';

function browser(): Store | null {
  try {
    localStorage.getItem(KEY);
    return localStorage;
  } catch {
    return null;
  }
}

export function readMade(store: Store | null = browser()): string[] {
  try {
    const list = JSON.parse(store?.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? DEVICE_CODEX.filter((id) => list.includes(id)) : [];
  } catch {
    return [];
  }
}

/** 진화 무기를 만들었다: 기기 기록에 넣는다 (DEVICE_CODEX 가 아닌 무기는 서버 도감이 기억하므로 넣지 않는다) */
export function rememberMade(id: string, store: Store | null = browser()): string[] {
  const have = readMade(store);
  if (!DEVICE_CODEX.includes(id) || have.includes(id)) return have;
  const next = DEVICE_CODEX.filter((x) => x === id || have.includes(x));
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장소가 꽉 찼거나 막혀 있으면 이번에는 기억하지 못한다
  }
  return next;
}
