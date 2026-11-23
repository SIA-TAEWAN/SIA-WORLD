/** 기기에 마지막 설정을 기억한다. 저장소를 못 쓰는 환경에서도 게임은 돌아간다. (로그인은 SIA WORLD가 맡는다) */
const KEY = 'siatank:v1';

export interface Saved {
  tank?: string;
  map?: string;
  difficulty?: string;
  opponent?: string;
  /** 서든데스 켬/끔 (AI 1:1) */
  sudden?: boolean;
}

export function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

export function save(patch: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch }));
  } catch {
    /* 무시 */
  }
}
