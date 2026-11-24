/** 블랙잭 화면: 딜러(위) + 플레이어 자리(아래), 베팅·히트·스탠드·더블·스플릿 */
import type PhaserNS from 'phaser';
import { BLACKJACK_MANUAL } from '../../lib/manuals.ts';
import { bootGame, esc, sfx, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { chipStack, clamp, drawTable, label, nameTag, playingCard, sweepTable, tc, theme, viewSize } from '../../lib/cards.ts';
import type { BjPublic, BjResult, BjSummary } from '../../../supabase/functions/_shared/blackjack.ts';
import { bjAddBet, bjClampBet, bjDayKey, bjDoubleBet, bjHint, bjLoad, bjRecord, bjSeenAdd, bjSeenLoad, bjStripHtml, nextStreak, streakCutin, type BjDay } from '../../lib/extras.ts';
import { worldRoot } from '../../lib/world.ts';
import { rewindBlackjack } from '../../../supabase/functions/_shared/blackjack-rewind.ts';

type Ctx = TableCtx<BjPublic, Record<string, never>>;

const RESULT: Record<BjResult, string> = { blackjack: '블랙잭!', win: '승', push: '무승부', lose: '패', bust: '버스트' };
const ACTION: Record<string, string> = { hit: '히트', stand: '스탠드', double: '더블다운', split: '스플릿' };

let betAmount = 0;
/** 지난번에 건 금액 ('같은 금액' · '2배' 버튼. 기본 단위가 다른 방으로 옮기면 지운다) */
let lastBet = 0;
let lastBetUnit = 0;

// ── 기본 전략 힌트 (켜고 끄기는 이 기기에 기억) ──
const HINT_KEY = 'sia-bj-hint';
let hintOn: boolean | null = null;
function hinting(): boolean {
  if (hintOn === null) {
    hintOn = false;
    try {
      hintOn = localStorage.getItem(HINT_KEY) === '1';
    } catch {
      /* 기억하지 못해도 스위치는 쓴다 */
    }
  }
  return hintOn;
}
function setHinting(on: boolean) {
  hintOn = on;
  try {
    localStorage.setItem(HINT_KEY, on ? '1' : '0');
  } catch {
    /* 무시 */
  }
}
/** 카드 통(슈) 자리 (판 정리 때 카드를 이리로 걷는다) */
let shoePos = { x: 0, y: 0 };
/** 말풍선용 짧은 이름 ('AI 어흥이' → '어흥이') */
const short = (n: string) => n.replace(/^AI /, '');
/** 카드 자리 이름 (연출용): 스플릿으로 갈라져도 원래 두 장은 같은 이름을 쓴다 → 뒤집히지 않고 제 핸드로 옮겨 간다 */
const cardKey = (seat: number, hi: number, ci: number, split: boolean) =>
  !split ? `${seat}:0:${ci}` : ci === 0 ? `${seat}:0:${hi}` : `${seat}:${hi ? 'b' : 'a'}:${ci}`;
/** 처음 두 장의 지난번 크기 (스플릿 때 크기도 자연스럽게 줄어들게) */
const lastWidth = new Map<string, number>();

// ── 오늘 기록 · 연승 (내 것은 이 기기에 저장: 날이 바뀌면 오늘 칸을 비운다. 다른 사람 연승은 이 방에서 본 판만 센다) ──
const dayKeyOf = (userId: string) => `sia-bj-today:${userId}`;
let day: BjDay | null = null;
let dayUser = '';
/** 내 기록 읽기 (저장소를 못 쓰면 이번에 연 화면 동안만 센다) */
function myDay(userId: string): BjDay {
  const today = bjDayKey(new Date());
  if (day && dayUser === userId && day.day === today) return day;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(dayKeyOf(userId));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  // 저장소에서 못 읽었으면 화면에 들고 있던 기록에서 날짜만 넘긴다
  day = raw === null && day && dayUser === userId ? bjLoad(JSON.stringify(day), today) : bjLoad(raw, today);
  dayUser = userId;
  return day;
}
function saveDay(userId: string, d: BjDay) {
  day = d;
  dayUser = userId;
  try {
    localStorage.setItem(dayKeyOf(userId), JSON.stringify(d));
  } catch {
    /* 저장하지 못해도 화면은 그대로 */
  }
}
/** 요즘 적은 판 열쇠 (저장소를 못 쓰면 이번에 연 화면 동안만 기억한다) */
let seenKeys: readonly string[] = [];
let seenUser = '';
const seenKeyOf = (userId: string) => `${dayKeyOf(userId)}:seen`;
function mySeen(userId: string): readonly string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(seenKeyOf(userId));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  if (raw !== null || seenUser !== userId) seenKeys = bjSeenLoad(raw);
  seenUser = userId;
  // 예전 판(이 목록이 생기기 전)에 마지막으로 적은 판도 본 것으로 친다
  const last = myDay(userId).last;
  return last && !seenKeys.includes(last) ? (seenKeys = bjSeenAdd(seenKeys, last)) : seenKeys;
}
function saveSeen(userId: string, seen: readonly string[]) {
  seenKeys = seen;
  seenUser = userId;
  try {
    localStorage.setItem(seenKeyOf(userId), JSON.stringify(seen));
  } catch {
    /* 저장하지 못해도 화면은 그대로 */
  }
}
/** 이 방에서 본 자리별 연승 (자리 → 이름·횟수) */
const streaks = new Map<number, { name: string; n: number }>();
let streakRoom = '';
let streakRound = '';
let cutinTimer: ReturnType<typeof setInterval> | null = null;
const stopCutinTimer = () => {
  if (cutinTimer) clearInterval(cutinTimer);
  cutinTimer = null;
};
/** 연승 컷인: 결과 창을 닫은 뒤에 띄운다 (결과 창이 컷인을 가린다). 결과 창을 오래 두어도 기다린다 — 방을 나가면(#cutin 이 사라지면) 멈춘다 */
function streakCut(text: string, avatar: string) {
  stopCutinTimer();
  cutinTimer = setInterval(() => {
    const el = document.getElementById('cutin');
    if (!el) return stopCutinTimer();
    if (document.querySelector('.modal .result')) return;
    stopCutinTimer();
    el.innerHTML = `<div><img src="${new URL(`shared/images/zodiac/full/${avatar}.png`, worldRoot()).href}" alt=""/><span>${esc(text)}</span></div>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    sfx('cutin');
  }, 200);
}
/** 결과 창이 뜰 때 띄울 연승 컷인 (판 열쇠와 함께 들고 있는다) */
let pendingCut: { key: string; text: string; avatar: string } | null = null;
/**
 * 끝난 판 적기: 자리별 연승, 내 오늘 기록, 3·5연승 컷인 (같은 판은 한 번만 적는다).
 * 끝난 판을 그릴 때 적는다 → 결과 창을 건너뛴 판(새로고침·다시 들어옴)도 빠지지 않는다. 컷인은 결과 창이 뜰 때(showCut) 건다
 */
function recordRound(t: Ctx, r: BjSummary, showCut: boolean) {
  const cutKey = `${t.room.id}:${t.room.round_no}`;
  try {
    recordOnce(t, r);
  } catch (e) {
    console.warn('bj-today', e);
  }
  if (showCut && pendingCut) {
    if (pendingCut.key === cutKey) streakCut(pendingCut.text, pendingCut.avatar);
    pendingCut = null;
  }
}
function recordOnce(t: Ctx, r: BjSummary) {
  if (streakRoom !== t.room.id) {
    streakRoom = t.room.id;
    streaks.clear();
    streakRound = '';
  }
  const key = `${t.room.id}:${t.room.round_no}`;
  if (key !== streakRound) {
    streakRound = key;
    for (const s of r.seats) {
      if (s.out) continue;
      const was = streaks.get(s.seat);
      streaks.set(s.seat, { name: s.name, n: nextStreak(was && was.name === s.name ? was.n : 0, s.delta) });
    }
  }
  // 내 기록은 판 열쇠로 중복을 막는다 (bjRecord) → 내 자리 정보가 늦게 와도 다음에 그릴 때 적힌다
  const mine = t.resultSeat === null ? null : r.seats.find((s) => s.seat === t.resultSeat);
  if (!mine || mine.out) return;
  const before = myDay(t.me.userId);
  // 요즘 적은 판이면 건너뛴다 (방을 오가다 예전 방의 끝난 판을 다시 보았을 때)
  const seen = mySeen(t.me.userId);
  const seenNow = bjSeenAdd(seen, key);
  if (seenNow === seen) return;
  saveSeen(t.me.userId, seenNow);
  const after = bjRecord(before, { key, delta: mine.delta, blackjacks: mine.hands.filter((h) => h.result === 'blackjack').length });
  if (after === before) return;
  saveDay(t.me.userId, after);
  const cut = mine.delta > 0 ? streakCutin(after.streak) : null;
  pendingCut = cut ? { key, text: cut, avatar: t.seatAvatar(mine.seat) } : null;
}
/** 이름패 옆 연승 꼬리표 (2연승부터) */
function streakBadge(t: Ctx, seat: number): string | undefined {
  const n = seat === t.mySeat ? myDay(t.me.userId).streak : streakRoom === t.room.id ? (streaks.get(seat)?.n ?? 0) : 0;
  return n >= 2 ? `${n}연승` : undefined;
}


const ui: GameUI<BjPublic, Record<string, never>> = {
  game: 'blackjack',
  // 자동 시작 스위치 (결과 창 3초 → 판 정리 → 자동 레디)
  autoStart: true,
  title: '블랙잭',
  manual: BLACKJACK_MANUAL,
  // 한 장씩 게임하듯이 (내 차례가 끝난 뒤 AI·딜러 카드도 차례로)
  dealGap: 450,
  icon: '🃏',
  back: 'games/casino/',
  backLabel: '카지노',
  felt: () => theme().COLOR.skyMid,

  draw(t: Ctx) {
    const { scene } = t;
    const { W, H } = viewSize(scene);
    const p = t.pub;
    // 끝난 판은 여기서 적는다 (다음 판이 시작되기 전까지만: 방 정보가 먼저 바뀐 순간에 지난 판을 새 판 번호로 적지 않게)
    if (p?.summary && t.room.status === 'waiting') recordRound(t, p.summary, false);
    drawTable(scene, 'blackjack');
    // 세로 화면(휴대폰): 왼쪽 위 딜러 · 왼쪽 가운데 카드 더미 · 왼쪽 아래 나 · 오른쪽에 다른 사람 1·2·3
    const portrait = H > W * 1.15 || W < 520;
    const LW = W * 0.56;
    const n = Math.max(1, p?.seats.length ?? 4);
    const cols = portrait ? 1 : n;
    // 카드 크기 (가로 화면은 자리 수로, 세로 화면은 왼쪽 칸 너비로)
    const cw = portrait ? clamp(Math.min(LW / 3, H / 8), 40, 96) : clamp(Math.min(W / (cols * 2.6), H / 4.3), 40, 124);
    const shoe = portrait ? { x: 18 + cw * 0.42, y: H * 0.46 } : { x: W - cw * 1.1, y: H * 0.19 };
    shoePos = shoe;
    for (let i = 0; i < 4; i++) playingCard(scene, shoe.x + i * 2, shoe.y - i * 2, null, cw * 0.8);
    if (!p) {
      label(scene, portrait ? W / 2 : W / 2, H / 2 - (portrait ? 0 : cw * 0.6), '모두 레디하면 시작해요', clamp(cw * 0.3, 18, 30));
      return;
    }
    if (p.shoeRemaining) label(scene, shoe.x, shoe.y + cw * 0.72, `${p.shoeRemaining}장`, clamp(cw * 0.17, 11, 15));
    // 처음 나눠 줄 때는 빠르게, 그 뒤(다른 사람·딜러가 받는 카드)는 한 장씩 천천히
    const firstDeal = p.phase === 'play' && p.seats.every((s) => s.hands.every((h) => h.cards.length <= 2)) && p.dealer.cards.length <= 2;
    ui.dealGap = firstDeal ? 300 : 650;

    /** 글자는 그 카드들이 다 놓인 뒤에 보이게 (한 장씩 진행하는 느낌) */
    const showAfter = (obj: PhaserNS.GameObjects.Text, ms: number) => {
      if (ms <= 0) return;
      obj.setAlpha(0);
      scene.tweens.add({ targets: obj, alpha: 1, delay: ms, duration: 160 });
    };

    // 딜러
    const dc = p.dealer.cards;
    const dcw = portrait ? cw * 0.95 : cw;
    const dx = portrait ? LW * 0.5 : W / 2;
    const dy = portrait ? dcw * 0.71 + 24 : H * 0.22;
    const dlabel = p.dealer.total !== null ? `딜러 ${p.dealer.total}${p.dealer.soft ? ' 소프트' : ''}${p.dealer.blackjack ? ' · 블랙잭' : ''}` : '딜러';

    // 플레이어 자리
    const seats = p.seats;
    const areaTop = H * 0.42;
    type Seat = (typeof seats)[number];
    /** 자리 하나 그리기: (x, 칸 위, 칸 높이, 카드 크기, 칸 너비, 이름패를 왼쪽 끝에) */
    const drawSeat = (s: Seat, x: number, rowTop: number, rowH: number, scw: number, slot: number, tagLeft = false, chipLeft = false) => {
      const y = rowTop + Math.min(rowH * 0.42, scw * 0.98 + 18);
      const isTurn = p.turn?.seat === s.seat;
      const me = s.seat === t.mySeat;
      const k = clamp(scw / 80, 0.75, 1.15);
      t.anchor(`seat:${s.seat}`, x, y - scw * 0.75);
      // 베팅 칩은 이름패에서 칩 자리로 날아간다
      t.anchor(`tag:${s.seat}`, tagLeft ? 30 * k : x - 44 * k, rowTop + rowH - 24 * k);
      t.anchor(`bet:${s.seat}`, x, y);
      nameTag(scene, tagLeft ? 30 * k : x - 44 * k, rowTop + rowH - 24 * k, t.seatName(s.seat), t.seatAvatar(s.seat), {
        turn: isTurn || (p.phase === 'bet' && p.waitingBets.includes(s.seat) && (!me || t.myTurn)),
        me,
        size: k,
        sub: s.out ? '쉬는 중' : s.bet ? `베팅 ${t.fmt(s.bet)}` : undefined,
        badge: streakBadge(t, s.seat),
      });
      const hands = s.hands;
      const hw = hands.length > 1 ? Math.min(scw * 1.5, slot / 2.05) : 0;
      const hcw = hands.length > 1 ? Math.min(scw * 0.86, slot / 2.6) : scw * 0.92;
      hands.forEach((h, hi) => {
        const hx = x + (hi - (hands.length - 1) / 2) * hw;
        const active = isTurn && p.turn?.hand === hi;
        let land = 0;
        h.cards.forEach((c, ci) => {
          // 카드 자리는 장수와 상관없이 고정 (3장 기준 가운데): 한 장 더 받아도 앞 카드가 움직이지 않는다
          // 4장부터는 같은 폭 안에서 촘촘히 (옆 자리·화면 밖으로 나가지 않게)
          const stp = h.cards.length <= 3 ? hcw * 0.36 : (hcw * 0.72) / (h.cards.length - 1);
          const card = playingCard(scene, hx - hcw * 0.36 + ci * stp, y - ci * hcw * 0.05, c, hcw, { lift: active });
          const key = cardKey(s.seat, hi, ci, h.fromSplit);
          // 제자리는 deal 전에 잰다 (deal은 날아오는 카드를 덱 자리로 옮겨 놓는다)
          const home = { x: card.x, y: card.y };
          const cl = t.deal(card, key, c, shoe);
          land = Math.max(land, cl);
          // 처음 두 장: 스플릿하면 제 핸드 자리로 미끄러져 간다 (나눠 주는 중에는 자리만 기록)
          if (!h.fromSplit ? ci < 2 : ci === 0) {
            const was = lastWidth.get(key);
            lastWidth.set(key, hcw);
            t.track(card, `mv:${key}`, { at: home, still: cl > 0, fromScale: was ? was / hcw : undefined, depth: 0 });
          }
        });
        const tot = `${h.total}${h.soft && h.total <= 21 ? 's' : ''}`;
        const res = h.result ? ` · ${RESULT[h.result]}${h.delta ? ` ${h.delta > 0 ? '+' : ''}${t.fmt(h.delta)}` : ''}` : '';
        const bad = h.result === 'lose' || h.result === 'bust';
        const lt = label(scene, hx, y - hcw * 0.98, `${tot}${h.doubled ? ' ×2' : ''}${res}`, clamp(hcw * 0.22, 12, 22), bad ? tc('lose') : h.result === 'win' || h.result === 'blackjack' ? tc('primary') : tc('white'));
        // 결과는 딜러 카드까지 다 놓인 뒤에 (딜러를 나중에 그릴 수 있어 모아 두었다가 맨 끝에)
        pendingLabels.push({ lt, land, result: !!h.result });
        // 칩은 카드 오른쪽 (아래 이름패와 겹치지 않게)
        const spread = chipLeft ? hcw * 1.14 : hcw * 1.14;
        chipStack(scene, chipLeft ? hx - spread : hx + spread, y + hcw * 0.3, h.bet, undefined, clamp(scw * 0.18, 9, 18));
      });
      // 베팅만 하고 카드가 없을 때: 칩은 칸 가운데
      if (!hands.length && s.bet) chipStack(scene, x, y, s.bet, undefined, clamp(scw * 0.2, 10, 20));
    };

    const pendingLabels: { lt: PhaserNS.GameObjects.Text; land: number; result: boolean }[] = [];
    const flushLabels = () => pendingLabels.forEach((x) => showAfter(x.lt, x.result ? Math.max(x.land, dealerLand) : x.land));
    // 딜러 카드는 사람 카드 다음에 (차례대로 한 장씩 보이게) → 먼저 자리를 그리면서 시각을 모으고, 딜러는 그 뒤에
    let dealerLand = 0;
    t.anchor('dealer', dx, dy - dcw * 0.6);
    const drawDealer = () => {
      dc.forEach((c, i) => {
        const dstep = dc.length <= 3 ? dcw * 0.62 : (dcw * 1.24) / (dc.length - 1);
        const card = playingCard(scene, dx - dcw * 0.62 + i * dstep, dy, c, dcw);
        dealerLand = Math.max(dealerLand, t.deal(card, `d:${i}`, c, shoe));
      });
      showAfter(label(scene, dx, dy + dcw * 0.95, dlabel, clamp(dcw * 0.22, 14, 22)), dealerLand);
    };

    const meIdx = seats.findIndex((s) => s.seat === t.mySeat);
    if (portrait) {
      // 판이 진행 중이면 딜러가 마지막에 받는다. 처음 나눠 줄 때는 딜러 카드가 사람 사이에 섞이므로 먼저
      const dealerFirst = p.phase !== 'dealer' && p.phase !== 'done' && !seats.some((s) => s.hands.some((h) => h.result));
      if (dealerFirst) drawDealer();
      // 오른쪽: 나를 뺀 사람들 위에서부터 1·2·3
      const others = seats.filter((_, i) => i !== meIdx);
      const RX0 = LW;
      const RW = W - LW;
      const top = 16;
      const orowH = (H - top - 10) / Math.max(1, others.length);
      const ocw = clamp(Math.min(RW / 2.4, orowH / 2.7), 30, 70);
      others.forEach((s, j) => {
        const rowTop = top + orowH * j;
        drawSeat(s, RX0 + RW * 0.56, rowTop, orowH, ocw, RW, false, true);
        // 순서 번호 (오른쪽 위부터 1, 2, 3)
        label(scene, RX0 + 12, rowTop + 12, `${j + 1}`, clamp(ocw * 0.3, 13, 20), tc('primary'));
      });
      if (meIdx >= 0) {
        const meCw = clamp(Math.min(LW / 2.6, H / 6.2), 44, 100);
        const meH = Math.min(H * 0.4, meCw * 2.25);
        drawSeat(seats[meIdx], LW * 0.48, H - meH, meH, meCw, LW, true);
      }
      if (!dealerFirst) drawDealer();
      flushLabels();
      return;
    }
    drawDealer();
    const slot = W / cols;
    // 자리 칸: 딜러 아래부터 바닥까지
    const rowH = H - areaTop;
    seats.forEach((s, i) => drawSeat(s, slot * ((i % cols) + 0.5), areaTop, rowH, cw, slot));
    flushLabels();
  },

  controls(t: Ctx, el: HTMLElement) {
    if (!t.pub || t.mySeat === null) return;
    playControls(t, el);
    // 조작부 위 띠: 오늘 기록 (이 기기에서 한 판만 센다)
    const d = myDay(t.me.userId);
    el.insertAdjacentHTML('afterbegin', `<p class="bj-today">${bjStripHtml(d, t.fmt)}${d.streak >= 2 ? `<span class="tag">${d.streak}연승</span>` : ''}</p>`);
  },

  resultHtml(t: Ctx) {
    const r = t.pub?.summary ?? ((t.pub as unknown as { result?: BjPublic['summary'] })?.result ?? null);
    if (!r) return '<p>판이 끝났어요</p>';
    recordRound(t, r, true);
    const rows = r.seats
      .map((s) => {
        const d = s.delta;
        const res = s.out ? '쉼' : s.hands.map((h) => RESULT[h.result]).join(' / ');
        return `<tr><td>${esc(s.name)}${s.seat === t.resultSeat ? ' (나)' : ''}</td><td>${res}</td><td class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${t.fmt(d)}</td></tr>`;
      })
      .join('');
    return `<h3>🃏 판 결과</h3><p>딜러 ${r.dealer.total}${r.dealer.blackjack ? ' (블랙잭)' : r.dealer.bust ? ' (버스트)' : ''}</p><table>${rows}</table>`;
  },

  leave() {
    stopCutinTimer();
    pendingCut = null;
  },

  // 서버 응답에 행동이 여러 개면 하나씩: 말풍선 + 칩 (AI는 0.8초 간격)
  replay(ev, t: Ctx) {
    const who = typeof ev.seat === 'number' ? short(t.seatName(ev.seat)) : '';
    switch (ev.t) {
      case 'bet':
        return typeof ev.seat === 'number'
          ? { at: ev.seat, text: `${who} ${t.fmt(Number(ev.amount) || 0)} 베팅`, chips: { from: `tag:${ev.seat}`, to: `bet:${ev.seat}`, amount: Number(ev.amount) || 0 } }
          : null;
      case 'hit': {
        if (typeof ev.seat !== 'number') return null;
        // 스플릿한 핸드가 저절로 받는 두 번째 카드: 말풍선 없이 카드만 (받고 나서 잠깐 쉰다)
        const h = t.pub?.seats.find((x) => x.seat === ev.seat)?.hands[Number(ev.hand) || 0];
        if (h?.fromSplit && h.cards.length === 1) return { gap: 900 };
        return { at: ev.seat, text: `${who} 히트!` };
      }
      case 'stand':
        return typeof ev.seat === 'number' ? { at: ev.seat, text: `${who} 스탠드` } : null;
      case 'double':
        // ev.bet 은 두 배가 된 뒤 금액 → 더 건 금액(절반)만 칩으로 옮긴다
        return typeof ev.seat === 'number' ? { at: ev.seat, text: `${who} 더블다운!`, chips: { from: `tag:${ev.seat}`, to: `bet:${ev.seat}`, amount: Math.floor((Number(ev.bet) || 0) / 2) } } : null;
      case 'split':
        // 두 장이 두 핸드로 갈라지는 것을 다 본 뒤에 다음 카드
        return typeof ev.seat === 'number' ? { at: ev.seat, text: `${who} 스플릿!`, chips: { from: `tag:${ev.seat}`, to: `bet:${ev.seat}`, amount: Number(ev.bet) || 0 }, gap: 1000 } : null;
      case 'bust':
        return typeof ev.seat === 'number' ? { at: ev.seat, text: `${who} 버스트!`, sound: 'bust', after: true } : null;
      case 'dealer_reveal':
        return { at: 'dealer', text: `딜러 ${ev.total}`, sound: 'flip', gap: 800, after: true };
      case 'dealer_hit':
        return { at: 'dealer', text: `딜러 히트 (${ev.total})`, gap: 800, after: true };
      case 'dealer_stand':
        return { at: 'dealer', text: `딜러 ${ev.total} 스탠드`, gap: 800, after: true };
      case 'dealer_bust':
        return { at: 'dealer', text: '딜러 버스트!', sound: 'bust', gap: 800, after: true };
      case 'result': {
        if (typeof ev.seat !== 'number') return null;
        const d = Number(ev.delta) || 0;
        if (!d) return { at: ev.seat, text: `${who} 무승부`, gap: 500, after: true };
        return d > 0
          ? { at: ev.seat, text: `${who} +${t.fmt(d)}`, chips: { from: 'dealer', to: ev.seat, amount: d }, sound: 'coin', gap: 600, after: true }
          : { at: ev.seat, text: `${who} ${t.fmt(d)}`, chips: { from: ev.seat, to: 'dealer', amount: -d }, gap: 600, after: true };
      }
      default:
        return null;
    }
  },

  // 한 동작씩: 새 상태를 사건 하나씩 되돌린 중간 화면들 (베팅 → 딜 → 히트·스플릿 → 딜러 → 정산)
  rewind: rewindBlackjack,

  // 판 정리: 딜러가 플레이어 카드부터 (아래에서 위로) 걷어 카드 통으로 가져가고, 베팅 칩을 치운다
  cleanup(t: Ctx) {
    return sweepTable(t.scene, shoePos, { stagger: 55, order: 'bottom', onStart: (i) => i % 2 === 0 && sfx('deal', { volume: 0.5 }) });
  },

  // 블랙잭 이펙트는 그 카드가 보인 바로 뒤에 띄우고, 다 보인 뒤에 다음(칩 지급·회수)으로 넘어간다
  cutinHold: (ev) => ev.t === 'blackjack' || ev.t === 'dealer_blackjack',

  cutin(ev, t: Ctx) {
    if (ev.t === 'blackjack') return ev.seat === t.mySeat ? '블랙잭!' : null;
    if (ev.t === 'dealer_blackjack') return '딜러 블랙잭';
    if (ev.t === 'result' && ev.seat === t.mySeat) {
      const s = t.pub?.seats.find((x) => x.seat === t.mySeat);
      if (s?.hands.some((h) => h.doubled && h.result === 'win')) return '더블다운 승리!';
    }
    return null;
  },
};

/** 게임 중 조작 버튼: 베팅 · 히트/스탠드/더블/스플릿 · 안내 */
function playControls(t: Ctx, el: HTMLElement) {
  const p = t.pub;
  if (!p || t.mySeat === null) return;
  const mine = p.seats.find((s) => s.seat === t.mySeat);
  if (p.phase === 'bet' && p.waitingBets.includes(t.mySeat) && t.myTurn) {
    // 베팅은 기본 단위의 배수만, 상한(테이블 최대 · 내 잔액) 안에서
    const min = p.minBet;
    const max = Math.max(min, Math.floor((mine?.maxBet ?? p.maxBet) / min) * min);
    // 방을 옮기면 기본 단위가 달라 배수가 아닌 금액이 남을 수 있다 → 배수로 맞춰 상한·하한 안으로
    if (betAmount < min || betAmount > max || betAmount % min !== 0) betAmount = bjClampBet(betAmount, min, max);
    if (lastBetUnit !== min) lastBet = 0;
    const noLast = lastBet > 0 ? '' : 'disabled';
    // 칩: 누를 때마다 그만큼 더한다 (기본 단위의 1 · 5 · 10 · 50배. 상한을 넘는 칩은 끈다)
    const chips = [1, 5, 10, 50]
      .map((n) => n * min)
      .map((v) => `<button type="button" class="btn bj-chip" data-add="${v}" ${betAmount + v > max ? 'disabled' : ''}>+${t.fmt(v)}</button>`)
      .join('');
    el.innerHTML = `<div class="row bj-bet">${chips}
      <button type="button" class="btn" data-set="min" ${betAmount > min ? '' : 'disabled'}>지우기</button>
      <button type="button" class="btn" data-set="same" ${noLast} title="지난번에 건 금액">같은 금액</button>
      <button type="button" class="btn" data-set="double" ${noLast} title="지난번에 건 금액의 2배">2배</button>
      <button type="button" class="btn" data-set="max">최대</button></div>
      <div class="row bj-go">
      <span class="amount">${t.fmt(betAmount)}</span>
      <button class="btn big primary" id="bet" ${t.busy ? 'disabled' : ''}>베팅</button>
      <button class="btn" id="sit" ${t.busy ? 'disabled' : ''}>이번 판 쉬기</button></div>
      <p class="msg bj-range">베팅 ${t.fmt(min)} ~ ${t.fmt(max)}${lastBet > 0 ? ` · 지난번 ${t.fmt(lastBet)}` : ''}</p>`;
    el.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) =>
      b.addEventListener('click', () => {
        betAmount = bjAddBet(betAmount, Number(b.dataset.add), min, max);
        sfx('chip');
        t.redraw();
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.set;
        betAmount = k === 'max' ? max : k === 'same' ? bjClampBet(lastBet, min, max) : k === 'double' ? bjDoubleBet(lastBet, min, max) : min;
        t.redraw();
      }),
    );
    el.querySelector('#bet')!.addEventListener('click', () => {
      const amount = betAmount;
      void t.act({ type: 'bet', amount }).then((ok) => {
        if (!ok) return;
        lastBet = amount;
        lastBetUnit = min;
      });
    });
    el.querySelector('#sit')!.addEventListener('click', () => void t.act({ type: 'sitout' }));
    return;
  }
  if (p.phase === 'play' && t.myTurn && p.turn?.seat === t.mySeat) {
    // 기본 전략 힌트 (켰을 때만): 엔진의 기본 전략표가 고르는 행동의 버튼에 '추천' 꼬리표
    const hand = mine?.hands[p.turn.hand ?? 0];
    const rec = hinting() && hand ? bjHint(hand.cards, p.dealer.cards[0], p.legal) : null;
    el.innerHTML = `<div class="row">${p.legal
      .map((a) => `<button class="btn big ${a === 'hit' ? 'primary' : a === 'stand' ? 'alt' : ''} ${a === rec ? 'rec' : ''}" data-a="${a}" ${t.busy ? 'disabled' : ''}>${ACTION[a]}${a === rec ? '<em class="rec-tag">추천</em>' : ''}</button>`)
      .join('')}</div>
      <div class="hd-help bj-help"><button type="button" class="btn small auto-sw ${hinting() ? 'on' : ''}" id="bj-hint" role="switch" aria-checked="${hinting()}" title="기본 전략표가 고르는 행동을 알려 줘요 (이긴다는 뜻은 아니에요)">전략 힌트<i></i></button>${rec ? `<b>기본 전략: ${ACTION[rec]}</b>` : ''}</div>
      <p class="msg">${(mine?.hands.length ?? 0) > 1 ? `${(p.turn.hand ?? 0) + 1}번째 핸드 · ` : ''}20초 안에 고르지 않으면 스탠드해요</p>`;
    el.querySelector('#bj-hint')?.addEventListener('click', () => {
      setHinting(!hinting());
      t.redraw();
    });
    el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => void t.act({ type: b.dataset.a })));
    return;
  }
  // 내 차례여도 앞선 연출(베팅 말풍선·카드 나누기)이 끝나기 전에는 버튼 대신 안내만
  const who =
    p.phase === 'bet'
      ? p.waitingBets.includes(t.mySeat) ? '베팅을 받는 중…' : '다른 사람이 베팅하는 중…'
      : p.turn
        ? p.turn.seat === t.mySeat ? '카드를 받는 중…' : `${esc(t.seatName(p.turn.seat))} 차례…`
        : '딜러 차례…';
  el.innerHTML = `<p class="msg">${who}</p>`;
}

void bootGame(ui);
