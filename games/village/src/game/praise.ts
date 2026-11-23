/**
 * 받은 칭찬 (서버: 091_village_praise_inbox.sql 의 village_praise_inbox · village_praise_seen).
 * 화면 없이 돌릴 수 있는 것만: 서버 답 다듬기 · 알림 글 · "몇 분 전" 글.
 */

/** 한 번에 보여 주는 받은 칭찬의 수 (서버의 limit 와 같다) */
export const PRAISE_LIST_MAX = 20;

export interface PraiseRow {
  /** 칭찬한 사람 (그 마을로 구경 간다) */
  userId: string;
  nickname: string;
  /** 그 사람의 마을 이름 (안 지었으면 빈 글) */
  name: string;
  /** 칭찬한 서버 시각 (ms) */
  at: number;
  /** 마지막으로 본 뒤에 받은 것 */
  fresh: boolean;
}

export interface PraiseInbox {
  /** 이 목록을 만든 서버 시각 (ms). "다 봤음"을 보낼 때 그대로 돌려준다 */
  now: number;
  seenAt: number;
  /** 새로 받은 칭찬 수 · 새로 칭찬한 사람 수 (목록 20개에 다 안 들어온 것까지) */
  fresh: number;
  freshUsers: number;
  /** 최근 것부터 */
  rows: PraiseRow[];
}

const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/** 서버가 준 받은 칭찬 목록을 다듬는다 (모양이 다른 줄은 버린다) */
export function cleanInbox(raw: unknown): PraiseInbox {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rows: PraiseRow[] = [];
  for (const v of Array.isArray(r.rows) ? r.rows : []) {
    const x = (v ?? {}) as Record<string, unknown>;
    if (typeof x.userId !== 'string' || !x.userId) continue;
    rows.push({ userId: x.userId, nickname: typeof x.nickname === 'string' ? x.nickname : '', name: typeof x.name === 'string' ? x.name : '', at: n0(x.at), fresh: x.fresh === true });
    if (rows.length >= PRAISE_LIST_MAX) break;
  }
  rows.sort((a, b) => b.at - a.at);
  const inList = rows.filter((x) => x.fresh);
  return {
    now: n0(r.now), seenAt: n0(r.seenAt), rows,
    // 서버의 수가 목록보다 적을 수는 없다
    fresh: Math.max(n0(r.fresh), inList.length),
    freshUsers: Math.max(n0(r.freshUsers), new Set(inList.map((x) => x.userId)).size),
  };
}

export interface PraiseNotice {
  text: string;
  /** 한 사람이면 그 사람의 마을로 바로 간다. 여러 사람이면 null → 받은 칭찬 목록을 연다 */
  visit: string | null;
  /** 새로 받은 칭찬 수 */
  count: number;
}

/** 접속했을 때의 알림: 마지막으로 본 뒤 새로 받은 칭찬을 한 줄로 묶는다 (없으면 null) */
export function praiseNotice(inbox: PraiseInbox | null): PraiseNotice | null {
  if (!inbox || inbox.fresh <= 0) return null;
  const first = inbox.rows.find((r) => r.fresh);
  if (!first) return null;
  const who = first.nickname || '이웃';
  if (inbox.freshUsers <= 1) return { text: inbox.fresh > 1 ? `${who} 님이 ${inbox.fresh}번 칭찬했어요` : `${who} 님이 칭찬했어요`, visit: first.userId, count: inbox.fresh };
  return { text: `${who} 님 외 ${inbox.freshUsers - 1}명이 칭찬했어요`, visit: null, count: inbox.fresh };
}

/** 얼마나 전인지: 방금 · 5분 전 · 3시간 전 · 2일 전 */
export function agoText(at: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 60) return '방금';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

/** 테스트 모드의 기록: 이웃이 칭찬한 때와 마지막으로 본 때 */
export interface LocalPraises {
  seenAt: number;
  log: { from: string; at: number }[];
}

/** 테스트 모드의 기록을 서버 답과 같은 모양으로 */
export function localInbox(p: LocalPraises, now: number, who: (id: string) => { nickname: string; name: string } | null): PraiseInbox {
  const all = p.log.filter((x) => x.at <= now && who(x.from)).sort((a, b) => b.at - a.at);
  const fresh = all.filter((x) => x.at > p.seenAt);
  return {
    now, seenAt: p.seenAt, fresh: fresh.length, freshUsers: new Set(fresh.map((x) => x.from)).size,
    rows: all.slice(0, PRAISE_LIST_MAX).map((x) => ({ userId: x.from, ...who(x.from)!, at: x.at, fresh: x.at > p.seenAt })),
  };
}

/** "다 봤음": 뒤로 가지 않고, 지금보다 앞서지도 않는다 (서버와 같이. at 이 이상하면 지금) */
export const seenAfter = (seenAt: number, at: number, now: number) => Math.max(seenAt, Number.isFinite(at) && at >= 0 ? Math.min(now, Math.floor(at) + 1) : now);
