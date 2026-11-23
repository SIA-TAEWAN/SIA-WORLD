/**
 * 맞대결 전적: 나와 한 사람 사이의 확정 경기만 센 숫자 (supabase/migrations/090_volley_h2h.sql 의 volleyball_h2h).
 * 게임방과 결과 화면에 "○○와 7승 4패 · 최근 2연승" 한 줄로 보인다. 읽지 못하면 그 줄을 숨긴다.
 */
export interface H2h {
  wins: number;
  losses: number;
  /** 가장 최근 경기부터 같은 결과가 이어진 판 수 (경기가 없으면 0) */
  streak: number;
  /** 그 이어진 결과가 내 승인가 */
  streakWon: boolean;
}

/** 이만큼 이어져야 '최근 N연승'을 붙인다 */
export const STREAK_MIN = 2;

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** 서버 답을 확인한다. 모양이 다르면 null (그 줄을 숨긴다) */
export function parseH2h(data: unknown): H2h | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const wins = count(d.wins);
  const losses = count(d.losses);
  const streak = count(d.streak);
  if (wins === null || losses === null || streak === null) return null;
  const total = wins + losses;
  if (total === 0) return { wins: 0, losses: 0, streak: 0, streakWon: false };
  if (typeof d.streak_won !== 'boolean') return null;
  // 이어진 판 수는 그 결과의 전체 판 수를 넘지 못한다
  if (streak < 1 || streak > (d.streak_won ? wins : losses)) return null;
  return { wins, losses, streak, streakWon: d.streak_won };
}

/** 받침 없이 읽히는 숫자 (이·사·오·구). 나머지(영·일·삼·육·칠·팔)는 받침이 있다 */
const DIGIT_OPEN = '2459';

/** 이름 뒤에 붙는 '와'/'과': 마지막 글자에 받침이 있으면 '과'. 한글·숫자가 아니면 '와' */
export function withParticle(name: string): '와' | '과' {
  const ch = name.trim().slice(-1);
  if (!ch) return '와';
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? '와' : '과';
  if (ch >= '0' && ch <= '9') return DIGIT_OPEN.includes(ch) ? '와' : '과';
  return '와';
}

/** 화면에 보일 조각. 이름(길면 줄임)과 나머지(줄이지 않음)를 따로 준다 */
export interface H2hView {
  name: string;
  /** 이름 바로 뒤에 붙는 조사 */
  particle: string;
  /** '7승 4패' (경기가 없으면 '첫 맞대결') */
  record: string;
  /** '최근 2연승' (없으면 빈 글) */
  streak: string;
}

/** 맞대결 한 줄의 조각. 경기가 없으면 '○○와 첫 맞대결' */
export function h2hView(name: string, h: H2h): H2hView {
  const who = name.trim() || '상대';
  const particle = withParticle(who);
  if (h.wins + h.losses === 0) return { name: who, particle, record: '첫 맞대결', streak: '' };
  return {
    name: who,
    particle,
    record: `${h.wins}승 ${h.losses}패`,
    streak: h.streak >= STREAK_MIN ? `최근 ${h.streak}연${h.streakWon ? '승' : '패'}` : '',
  };
}

/** 한 줄 글 (읽어 주기·시험용): "○○와 7승 4패 · 최근 2연승" */
export function h2hText(name: string, h: H2h): string {
  const v = h2hView(name, h);
  return `${v.name}${v.particle} ${v.record}${v.streak ? ` · ${v.streak}` : ''}`;
}

/** 테스트 모드의 ?h2h=7,4,2 (승,패,이어진 판 수 — 음수면 연패). 모양이 다르면 null */
export function parseH2hParam(raw: string | null): H2h | null {
  if (!raw) return null;
  const [w, l, s = 0] = raw.split(',').map((x) => Number(x));
  if (![w, l, s].every((n) => Number.isInteger(n))) return null;
  return parseH2h({ wins: w, losses: l, streak: Math.abs(s), streak_won: s >= 0 });
}
