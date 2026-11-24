/** 텍사스 홀덤 화면: 가운데 공용 카드 5장 · 나는 아래 · 다른 사람은 왼쪽·위·오른쪽 (세로 화면은 위 한 줄) */
import { HOLDEM_MANUAL } from '../../lib/manuals.ts';
import { holdemAdvice, holdemAdviceText, holdemBookAction, holdemBookKeep, holdemToCall, potOddsNeed, potRealWinners, potRefundOf, potRefundOnly, type HoldemBook } from '../../lib/extras.ts';
import { bootGame, esc, sfx, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { chipStack, clamp, drawTable, label, nameTag, playingCard, sweepTable, tc, theme, viewSize } from '../../lib/cards.ts';
import type { HoldemPrivate, HoldemPublic } from '../../../supabase/functions/_shared/holdem.ts';
import { holdemRoundStart, rewindHoldem } from '../../../supabase/functions/_shared/holdem-rewind.ts';
import type PhaserNS from 'phaser';

type Ctx = TableCtx<HoldemPublic, HoldemPrivate>;

const STREET: Record<string, string> = { preflop: '프리플롭', flop: '플롭', turn: '턴', river: '리버', done: '결과' };

/** 레이즈(베트) 금액: 이번 라운드 총액 (슬라이더) */
let raiseTo = 0;
let raiseKey = '';
/** 카드 더미 자리 (판 정리 때 카드를 이리로 모은다) */
let deckPos = { x: 0, y: 0 };
/** 마지막으로 그린 공개 상태 (한 동작씩 되돌려 보여 줄 때 기준) */
let lastPub: HoldemPublic | null = null;
/** 말풍선용 짧은 이름 ('AI 어흥이' → '어흥이') */
const short = (n: string) => n.replace(/^AI /, '');

/** 이 자리가 받은 것이 아무도 못 받은 베팅을 돌려받은 것(refund 팟)뿐인가 (재생 중이면 재생해 가는 판 결과로 가른다: 중간 화면의 pub 은 결과가 비어 있다) */
const refunded = (t: Ctx, seat: number) => potRefundOnly(seat, (t.pubNext ?? t.pub)?.summary);

// ── 미리 고르기: 남의 차례에 [체크/폴드]·[콜] 을 예약해 두면 내 차례가 오자마자 실행한다 (베팅 금액이 바뀌면 콜 예약은 취소) ──
let book: HoldemBook | null = null;
/** 예약을 건 판·단계 (판이나 단계가 바뀌면 예약을 지운다) */
let bookKey = '';
/** 예약을 방금 실행해 서버 답을 기다리는 중 (그동안은 버튼 대신 안내) */
let bookRan = '';

// ── 승률 · 팟 오즈 도우미 (켜고 끄기는 이 기기에 기억) ──
const HELP_KEY = 'sia-holdem-helper';
let helpOn: boolean | null = null;
function helperOn(): boolean {
  if (helpOn === null) {
    helpOn = false;
    try {
      helpOn = localStorage.getItem(HELP_KEY) === '1';
    } catch {
      /* 기억하지 못해도 스위치는 쓴다 */
    }
  }
  return helpOn;
}
function setHelper(on: boolean) {
  helpOn = on;
  try {
    localStorage.setItem(HELP_KEY, on ? '1' : '0');
  } catch {
    /* 무시 */
  }
}
/** 같은 상황이면 다시 셈하지 않는다 (조작부를 다시 그릴 때마다 수백 판을 돌리지 않게) */
let adviceKey = '';
/** adviceKey 상황의 승률 (셈하지 못했으면 null) */
let adviceEquity: number | null = null;
let adviceTimer: ReturnType<typeof setTimeout> | null = null;
const stopAdvice = () => {
  if (adviceTimer) clearTimeout(adviceTimer);
  adviceTimer = null;
};
/**
 * 내 패 + 공개 정보(공용 카드 · 남은 상대 수 · 판돈 · 콜 금액)만 쓴다.
 * 승률(수백 판 돌려 보기)은 카드·상대 수가 바뀔 때만 다시 셈하고, 판돈·콜 금액으로 정해지는 필요 승률은 그릴 때마다 가볍게 셈한다.
 * → { text } 이미 셈해 둔 상황, { fill } 아직 셈하지 않은 상황 (버튼을 먼저 그린 뒤에 불러서 숫자를 채운다)
 */
function helperAdvice(t: Ctx): { text: string; fill?: () => string } {
  const p = t.pub;
  const hole = t.priv?.hole ?? [];
  if (!p || !p.options || hole.length !== 2) return { text: '' };
  const { call, callAllIn } = p.options;
  const pot = p.pot;
  const board = p.board;
  const opponents = p.seats.filter((s) => s.seat !== t.mySeat && !s.folded && !s.excluded).length;
  const key = `${t.room.id}:${t.room.round_no}:${hole.join('')}:${board.join('')}:${opponents}`;
  const textOf = () => (adviceEquity === null ? '' : holdemAdviceText({ equity: adviceEquity, need: potOddsNeed(pot, call) }, { allIn: !!callAllIn, short: true }));
  if (key === adviceKey) return { text: textOf() };
  return {
    text: '',
    fill: () => {
      adviceKey = key;
      adviceEquity = holdemAdvice({ hole, board, opponents, pot, call })?.equity ?? null;
      return textOf();
    },
  };
}


/** 딜러 버튼 표시: 흰 알약에 '딜러' (예전의 'D' 한 글자는 뜻을 알기 어려웠다) */
function marker(scene: PhaserNS.Scene, x: number, y: number, _text: string, r: number) {
  const T = theme();
  const fs = Math.round(r * 1.15);
  const tx = scene.add.text(0, 0, '딜러', { fontFamily: T.FONT, fontSize: `${fs}px`, color: tc('ink') }).setOrigin(0.5);
  const w = tx.width + r * 1.2;
  const h = r * 2;
  const g = scene.add.graphics();
  g.fillStyle(T.COLOR.outline, 1).fillRoundedRect(x - w / 2, y - h / 2 + 2, w, h, h / 2);
  g.fillStyle(T.COLOR.white, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
  g.lineStyle(T.SHAPE.lineThin, T.COLOR.outline, 1).strokeRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
  tx.setPosition(x, y).setDepth(1);
  scene.children.bringToTop(tx);
}

const ui: GameUI<HoldemPublic, HoldemPrivate> = {
  game: 'holdem',
  // 자동 시작 스위치 (결과 창 3초 → 판 정리 → 자동 레디)
  autoStart: true,
  title: '텍사스 홀덤',
  manual: HOLDEM_MANUAL,
  icon: '♥️',
  back: 'games/casino/',
  backLabel: '카지노',
  felt: () => theme().COLOR.skyMid,
  leave: stopAdvice,

  draw(t: Ctx) {
    const { scene } = t;
    const { W, H } = viewSize(scene);
    const p = t.pub;
    lastPub = p;
    drawTable(scene, 'holdem');
    const portrait = H > W * 1.15 || W < 520;
    // 내 카드 크기 (2장이라 크게), 공용 카드, 다른 사람
    // 내 카드 (조금 작게)
    const cw = clamp(Math.min(W / (portrait ? 5.3 : 8.6), H / (portrait ? 5.4 : 7.1)), 40, 96);
    const bc = clamp(Math.min((W * 0.9) / 5.6, H / (portrait ? 6.2 : 4.4)), 36, 100);
    const nOpp = Math.max(1, (p?.seats.length ?? 4) - 1);
    const oc = portrait ? Math.min(cw * 0.55, W / nOpp / 3.2) : cw * 0.55;
    const center = { x: W / 2, y: portrait ? H * 0.43 : H * 0.38 };
    // 카드 더미: 가로는 공용 카드 오른쪽 위, 세로는 공용 카드 바로 위 오른쪽 (화면 밖으로 나가지 않게)
    const deck = portrait ? { x: Math.min(W - bc * 0.4 - 16, center.x + bc * 2.1), y: center.y - bc * 1.55 } : { x: center.x + bc * 2.6 + 6, y: center.y - bc * 1.15 };
    deckPos = deck;
    for (let i = 0; i < 3; i++) playingCard(scene, deck.x + i * 2, deck.y - i * 2, null, bc * 0.6);
    if (!p) {
      label(scene, W / 2, H / 2, '모두 레디하면 시작해요', clamp(cw * 0.26, 18, 30));
      return;
    }
    // 올인 뒤 남은 공용 카드는 한 장씩 천천히
    ui.dealGap = p.runout ? 1100 : 200;

    // 공용 카드 5칸 (빈칸은 점선)
    const T = theme();
    const slots = scene.add.graphics();
    for (let i = 0; i < 5; i++) {
      const x = center.x + (i - 2) * bc * 1.08;
      const card = p.board[i];
      if (card) {
        const c = playingCard(scene, x, center.y, card, bc);
        t.deal(c, `b:${i}`, card, deck);
      } else {
        slots.lineStyle(T.SHAPE.lineThin, T.COLOR.white, 0.55).strokeRoundedRect(x - bc / 2, center.y - bc * 0.71, bc, bc * 1.42, 8);
      }
    }
    // 판돈 · 단계
    const chip = clamp(bc * 0.2, 12, 20);
    chipStack(scene, center.x - bc * 0.3, center.y + bc * 0.95, p.pot, `판돈 ${t.fmt(p.pot)}`, chip);
    t.anchor('pot', center.x - bc * 0.3, center.y + bc * 0.95);
    label(
      scene,
      center.x + bc * 1.3,
      center.y + bc * 1.05,
      `${STREET[p.phase]}${p.pots.length > 1 ? ` · 사이드 팟 ${p.pots.length - 1}` : ''}${p.runout ? ' · 올인!' : ''}`,
      clamp(bc * 0.18, 12, 18),
      p.runout ? tc('primary') : undefined,
    );

    // 자리: 내 자리가 아래 가운데
    const order = [...p.seats].sort((a, b) => a.seat - b.seat);
    const myIdx = Math.max(0, order.findIndex((s) => s.seat === t.mySeat));
    const side = Math.max(oc * 1.8, W * 0.15);
    const myY = H - cw * 0.71 - Math.max(46, cw * 0.5);
    const spots: number[][] = portrait
      ? [[W / 2, myY], ...Array.from({ length: nOpp }, (_, j) => [(W * (j + 0.5)) / nOpp, oc * 0.71 + 24])]
      : [
          [W / 2, myY],
          [side, H * 0.4],
          [W / 2, oc * 0.71 + 24],
          [W - side, H * 0.4],
        ];
    const shown = new Map((p.showdown ?? []).map((h) => [h.seat, h]));
    order.forEach((s, i) => {
      const rel = (i - myIdx + order.length) % order.length;
      const [x, y] = spots[!portrait && order.length === 2 && rel === 1 ? 2 : rel];
      const me = s.seat === t.mySeat;
      const sd = shown.get(s.seat);
      // 내 패가 아직 안 왔으면 그리지 않는다 (뒷면으로 먼저 받으면 패가 온 뒤 얇게 뒤집힌다) → 오면 딜러에게서 앞면으로 한 장씩 받는다
      const cards: (string | null)[] = sd ? sd.cards : me && t.priv ? t.priv.hole : s.excluded || (me && t.privWait) ? [] : Array(s.holeCount).fill(null);
      const w = me ? cw : oc;
      const gap = w * (me ? 0.78 : 0.5);
      const best = new Set(sd?.best ?? []);
      cards.forEach((c, ci) => {
        const card = playingCard(scene, x + (ci - (cards.length - 1) / 2) * gap, y, c, w, {
          dim: s.folded,
          // 쇼다운: 최고 5장에 들어간 내 카드는 살짝 올라온다
          lift: !!c && best.has(c),
        });
        t.deal(card, `${s.seat}:${ci}`, c, deck);
      });
      const tags = [s.seat === p.sbSeat ? 'SB' : '', s.seat === p.bbSeat ? 'BB' : ''].filter(Boolean).join('·');
      const mineHand = me && !sd && t.priv?.hand ? t.priv.hand : '';
      const sub = s.excluded
        ? '이번 판 쉼'
        : s.folded
          ? '폴드'
          : [s.last, s.allIn ? '올인' : '', mineHand, tags, `칩 ${t.fmt(s.stackLeft)}`].filter(Boolean).join(' · ');
      const k = me ? clamp(cw / 85, 0.85, 1.15) : clamp(oc / 60, 0.75, 1);
      const tagY = y + w * 0.71 + 24 * k;
      nameTag(scene, Math.max(26, Math.min(x - 52 * k, W - 160 * k)), tagY, t.seatName(s.seat), t.seatAvatar(s.seat), { turn: p.turn === s.seat, me, size: k, sub: sub || undefined });
      t.anchor(`seat:${s.seat}`, x, y - w * 0.72);
      // 위쪽 줄 자리: 한마디 말풍선이 카드를 가리지 않게 이름패 아래에 띄운다
      if (!me && (portrait || y < H * 0.3)) t.anchor(`seat-below:${s.seat}`, x, tagY + 22 * k);
      // 딜러 버튼
      if (s.seat === p.button) marker(scene, x + ((cards.length || 2) / 2) * gap + w * 0.42, y + w * 0.5, 'D', clamp(w * 0.16, 9, 15));
      // 이번 라운드에 낸 칩 (가운데 쪽으로)
      if (s.betRound > 0) {
        const toward = me ? -1 : 1;
        chipStack(scene, x - ((cards.length || 2) / 2) * gap - w * 0.42, y + toward * w * 0.1, s.betRound, t.fmt(s.betRound), clamp(w * 0.16, 9, 16));
      }
      // 🏆 는 진짜 승자만 (돌려받기만 한 사람은 빼고)
      const won = p.winners.includes(s.seat) && !refunded(t, s.seat);
      if (sd) label(scene, x, y - w * 0.95, `${sd.hand}${won ? ' 🏆' : ''}`, clamp(w * (me ? 0.2 : 0.26), 12, 22), won ? tc('primary') : tc('white'));
    });
  },

  controls(t: Ctx, el: HTMLElement) {
    const p = t.pub;
    if (!p || t.mySeat === null) return;
    const o = p.options;
    // 예약은 그 판 · 그 단계에서만, 콜 예약은 베팅 금액이 그대로일 때만 남긴다
    const bk = `${t.room.id}:${t.room.round_no}:${p.phase}`;
    if (bk !== bookKey) {
      bookKey = bk;
      book = null;
    }
    book = holdemBookKeep(book, p.curBet);
    if (!(t.myTurn && p.turn === t.mySeat && o)) {
      // 내 차례여도 앞선 연출(말풍선·카드 나누기)이 끝나기 전에는 버튼 대신 안내
      const msg = `<p class="msg">${p.turn === null ? (p.phase === 'done' ? '' : '카드를 나누는 중…') : p.turn === t.mySeat ? '진행 중이에요…' : `${esc(t.seatName(p.turn))} 차례…`}</p>`;
      const mine = p.seats.find((s) => s.seat === t.mySeat);
      // 미리 고르기: 아직 판에 남아 있고 누군가의 차례일 때 (올인했으면 고를 것이 없다)
      bookRan = '';
      if (!mine || mine.folded || mine.excluded || mine.allIn || p.phase === 'done' || p.runout) {
        book = null;
        el.innerHTML = msg;
        return;
      }
      // 차례가 잠깐 비는 화면(올인 연출 등 한 동작씩 보여 주는 중간 화면)에서는 버튼만 숨기고 예약은 그대로 둔다
      if (p.turn === null) {
        el.innerHTML = msg;
        return;
      }
      const toCall = holdemToCall(p.curBet, mine.betRound, mine.stackLeft);
      const on = (k: HoldemBook['kind']) => (book?.kind === k ? 'sel' : '');
      el.innerHTML = `<div class="row hd-book"><span>미리 고르기</span>
        <button type="button" class="btn small ${on('checkfold')}" data-b="checkfold" aria-pressed="${book?.kind === 'checkfold'}">${toCall > 0 ? '폴드' : '체크/폴드'}</button>
        ${toCall > 0 ? `<button type="button" class="btn small ${on('call')}" data-b="call" aria-pressed="${book?.kind === 'call'}">콜 ${t.fmt(toCall)}${toCall >= mine.stackLeft ? ' (올인)' : ''}</button>` : ''}</div>${msg}`;
      el.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((b) =>
        b.addEventListener('click', () => {
          const k = b.dataset.b as HoldemBook['kind'];
          book = book?.kind === k ? null : k === 'call' ? { kind: 'call', curBet: p.curBet } : { kind: 'checkfold' };
          t.redraw();
        }),
      );
      return;
    }
    // 내 차례가 왔다: 예약해 둔 것이 있으면 바로 실행 (한 번 쓰면 지운다)
    const booked = t.busy ? null : holdemBookAction(book, o, p.curBet);
    book = null;
    if (booked) bookRan = booked === 'check' ? '체크' : booked === 'call' ? '콜' : '폴드';
    else if (!t.busy) bookRan = '';
    if (bookRan) {
      el.innerHTML = `<p class="msg">예약한 대로 ${bookRan}했어요…</p>`;
      // 서버가 받지 않았으면 (act 가 알림을 띄우고 조작부를 다시 그린다) 버튼이 다시 나온다
      if (booked) void t.act({ type: booked });
      return;
    }
    const dis = t.busy ? 'disabled' : '';
    // 슬라이더 값은 차례가 바뀔 때마다 최소 금액에서 시작
    const key = `${p.phase}:${p.curBet}:${o.minTo}:${o.maxTo}`;
    if (key !== raiseKey) {
      raiseKey = key;
      raiseTo = o.minTo;
    }
    raiseTo = clamp(raiseTo, o.minTo, o.maxTo);
    const potAfterCall = p.pot + o.call;
    const quick = (frac: number) => clamp(Math.round(p.curBet + potAfterCall * frac), o.minTo, o.maxTo);
    const raiseLabel = o.isBet ? '베트' : '레이즈';
    const step = Math.max(1, p.sb);
    stopAdvice();
    const advice = helperOn() ? helperAdvice(t) : null;
    el.innerHTML = `<div class="row">
        <button class="btn big" data-a="fold" ${dis}>폴드</button>
        ${o.canCheck ? `<button class="btn big primary" data-a="check" ${dis}>체크</button>` : `<button class="btn big primary" data-a="call" ${dis}>콜 ${t.fmt(o.call)}${o.callAllIn ? ' (올인)' : ''}</button>`}
        ${o.canRaise ? `<button class="btn big alt" id="raise" ${dis}>${raiseTo >= o.maxTo ? '올인' : raiseLabel} ${t.fmt(raiseTo)}</button>` : ''}
      </div>
      ${
        o.canRaise
          ? `<div class="row raise-row">
        <button class="btn small" data-q="0.5" ${dis}>½팟</button><button class="btn small" data-q="1" ${dis}>팟</button><button class="btn small" data-q="all" ${dis}>올인</button>
        <input type="range" id="raise-range" min="${o.minTo}" max="${o.maxTo}" step="${step}" value="${raiseTo}" ${dis} aria-label="${raiseLabel} 금액"/>
      </div>`
          : ''
      }
      <div class="hd-help"><button type="button" class="btn small auto-sw ${helperOn() ? 'on' : ''}" id="helper" role="switch" aria-checked="${helperOn()}" title="내 패와 공개된 카드만으로 어림한 값이에요">도우미<i></i></button>${advice ? `<b id="hd-advice">${advice.fill ? '셈하는 중…' : esc(advice.text)}</b>` : ''}</div>
      <p class="msg">20초가 지나면 체크(안 되면 폴드)</p>`;
    // 승률을 새로 셈해야 하면 버튼을 먼저 그리고 나서 (휴대폰에서 조작부가 늦게 뜨지 않게)
    if (advice?.fill) {
      const fill = advice.fill;
      adviceTimer = setTimeout(() => {
        adviceTimer = null;
        const out = el.querySelector('#hd-advice');
        if (out?.isConnected) out.textContent = fill();
      }, 30);
    }
    el.querySelector('#helper')?.addEventListener('click', () => {
      setHelper(!helperOn());
      t.redraw();
    });
    el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => void t.act({ type: b.dataset.a })));
    const btn = el.querySelector<HTMLButtonElement>('#raise');
    const range = el.querySelector<HTMLInputElement>('#raise-range');
    const setTo = (v: number) => {
      // 슬라이더 칸(SB 단위)이 끝까지 안 닿으면 마지막 칸은 올인으로
      raiseTo = clamp(Math.round(v), o.minTo, o.maxTo);
      if (o.maxTo - raiseTo < step) raiseTo = o.maxTo;
      if (btn) btn.textContent = `${raiseTo >= o.maxTo ? '올인' : raiseLabel} ${t.fmt(raiseTo)}`;
      if (range) range.value = String(raiseTo);
    };
    range?.addEventListener('input', () => setTo(Number(range.value)));
    el.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) =>
      b.addEventListener('click', () => setTo(b.dataset.q === 'all' ? o.maxTo : quick(Number(b.dataset.q)))),
    );
    btn?.addEventListener('click', () => void t.act(raiseTo >= o.maxTo ? { type: 'allin' } : { type: 'raise', to: raiseTo }));
  },

  resultHtml(t: Ctx) {
    const r = t.pub?.summary;
    if (!r) return '<p>판이 끝났어요</p>';
    if (r.cancelled) return '<h3>판이 취소됐어요</h3><p>참가할 수 있는 사람이 2명보다 적었어요</p>';
    const names = new Map((t.pub?.seats ?? []).map((s) => [s.seat, s.name]));
    const real = potRealWinners(r);
    const rows = Object.entries(r.deltas)
      .map(([seat, d]) => {
        const n = Number(seat);
        const hand = r.hands[n]?.name ?? (r.winners.includes(n) && r.uncontested ? '무혈 승리' : '');
        return `<tr><td>${esc(names.get(n) ?? t.seatName(n))}${n === t.resultSeat ? ' (나)' : ''}${real.includes(n) ? ' 🏆' : ''}</td><td>${esc(hand)}</td><td class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${t.fmt(d)}</td></tr>`;
      })
      .join('');
    // 칩이 모자라 이번 판에서 빠진 자리는 deltas 에 없다 → 따로 보여 준다 (내 자리면 안내 한 줄)
    const excluded = (r.excluded ?? []).filter((n) => !(String(n) in r.deltas));
    const sat = excluded
      .map((n) => `<tr><td>${esc(names.get(n) ?? t.seatName(n))}${n === t.resultSeat ? ' (나)' : ''}</td><td>이번 판 쉼</td><td>${t.fmt(0)}</td></tr>`)
      .join('');
    const satMe = t.resultSeat !== null && excluded.includes(t.resultSeat) ? '<p>이번 판은 쉬었어요</p>' : '';
    const split = r.pots.some((x) => x.winners.length > 1) ? '<p>동점이라 판돈을 나눴어요</p>' : '';
    return `<h3>♥️ 판 결과</h3>${satMe}${split}<table>${rows}${sat}</table>`;
  },

  // 판 정리: 공용 카드부터 (더미에서 가까운 순) 모두의 카드를 더미로 모으고 칩을 치운다
  cleanup(t: Ctx) {
    return sweepTable(t.scene, deckPos, { stagger: 45, onStart: (i) => i % 3 === 0 && sfx('deal', { volume: 0.5 }) });
  },

  // 한 동작씩: 베팅 → 공용 카드 → 다음 베팅 순서로, 앞 동작의 카드 연출이 끝난 뒤에 다음 동작 (판 시작은 예전 방식)
  // (판 시작 묶음은 되돌리지 않는다 → null: 셸이 예전 방식으로 보여 준다)
  rewind: (next, events) => (holdemRoundStart(events) ? null : rewindHoldem(next, events, lastPub)),

  // 서버 응답에 행동이 여러 개면 하나씩: 말풍선 + 칩 (AI는 0.8초 간격)
  replay(ev, t: Ctx) {
    if (typeof ev.seat !== 'number') return null;
    const who = short(t.seatName(ev.seat));
    const amount = typeof ev.amount === 'number' ? ev.amount : 0;
    switch (ev.t) {
      case 'blind':
        return { at: ev.seat, text: `${who} ${ev.kind === 'sb' ? 'SB' : 'BB'}`, chips: { from: ev.seat, to: 'pot', amount }, gap: 450 };
      case 'fold':
        return { at: ev.seat, text: `${who} 폴드`, sound: 'fold' };
      case 'check':
        return { at: ev.seat, text: `${who} 체크`, sound: 'tick' };
      case 'call':
        return { at: ev.seat, text: `${who} 콜!`, chips: { from: ev.seat, to: 'pot', amount } };
      case 'bet':
      case 'raise':
        return {
          at: ev.seat,
          text: `${who} ${ev.t === 'bet' ? '베트' : '레이즈'} ${t.fmt(Number(ev.to) || 0)}!`,
          chips: { from: ev.seat, to: 'pot', amount: Number(ev.to) || t.pub?.bb || 1 },
        };
      case 'allin':
        return { at: ev.seat, text: `${who} 올인!`, gap: 500 };
      case 'win':
        // 아무도 못 받은 베팅(혼자 낸 몫, refund 팟)만 받았으면 이긴 것이 아니다: '돌려받음' 으로, 코인 소리 없이
        if (refunded(t, ev.seat)) return { at: ev.seat, text: `${who} 돌려받음 ${t.fmt(amount)}`, chips: { from: 'pot', to: ev.seat, amount }, gap: 900, after: true };
        {
          // 이기고 아무도 못 받은 베팅도 돌려받았으면 둘을 나눠 적는다
          const back = Math.min(amount, potRefundOf(ev.seat, (t.pubNext ?? t.pub)?.summary));
          const text = back > 0 ? `${who} +${t.fmt(amount - back)} · 돌려받음 ${t.fmt(back)}` : `${who} +${t.fmt(amount)}`;
          return { at: ev.seat, text, chips: { from: 'pot', to: ev.seat, amount }, sound: 'coin', gap: 900, after: true };
        }
      default:
        return null;
    }
  },

  cutin(ev, t: Ctx) {
    if (ev.t === 'royal') return '로열 스트레이트 플러시!';
    if (ev.t === 'straight_flush') return '스트레이트 플러시!';
    if (ev.t === 'four_kind') return '포카드!';
    // 돌려받은 남는 팟은 승리가 아니다 → 컷인 없음
    if (ev.t === 'win' && typeof ev.seat === 'number' && refunded(t, ev.seat)) return null;
    if (ev.t === 'win' && ev.allIn) return '올인 승리!';
    if (ev.t === 'win' && typeof ev.amount === 'number' && t.pub && ev.amount >= t.pub.bb * 50) return '대박 판돈!';
    if (ev.t === 'allin' && ev.seat === t.mySeat) return '올인!';
    return null;
  },
};

void bootGame(ui);
