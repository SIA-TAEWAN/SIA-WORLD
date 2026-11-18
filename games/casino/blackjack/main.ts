/** 블랙잭 화면: 딜러(위) + 플레이어 자리(아래), 베팅·히트·스탠드·더블·스플릿 */
import type PhaserNS from 'phaser';
import { BLACKJACK_MANUAL } from '../../lib/manuals.ts';
import { bootGame, esc, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { chipStack, clamp, drawTable, label, nameTag, playingCard, tc, theme, viewSize } from '../../lib/cards.ts';
import type { BjPublic, BjResult } from '../../../supabase/functions/_shared/blackjack.ts';
import { rewindBlackjack } from '../../../supabase/functions/_shared/blackjack-rewind.ts';

type Ctx = TableCtx<BjPublic, Record<string, never>>;

const RESULT: Record<BjResult, string> = { blackjack: '블랙잭!', win: '승', push: '무승부', lose: '패', bust: '버스트' };
const ACTION: Record<string, string> = { hit: '히트', stand: '스탠드', double: '더블다운', split: '스플릿' };

let betAmount = 0;
/** 말풍선용 짧은 이름 ('AI 어흥이' → '어흥이') */
const short = (n: string) => n.replace(/^AI /, '');
/** 카드 자리 이름 (연출용): 스플릿으로 갈라져도 원래 두 장은 같은 이름을 쓴다 → 뒤집히지 않고 제 핸드로 옮겨 간다 */
const cardKey = (seat: number, hi: number, ci: number, split: boolean) =>
  !split ? `${seat}:0:${ci}` : ci === 0 ? `${seat}:0:${hi}` : `${seat}:${hi ? 'b' : 'a'}:${ci}`;
/** 처음 두 장의 지난번 크기 (스플릿 때 크기도 자연스럽게 줄어들게) */
const lastWidth = new Map<string, number>();


const ui: GameUI<BjPublic, Record<string, never>> = {
  game: 'blackjack',
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
    drawTable(scene, 'blackjack');
    // 세로 화면(휴대폰): 왼쪽 위 딜러 · 왼쪽 가운데 카드 더미 · 왼쪽 아래 나 · 오른쪽에 다른 사람 1·2·3
    const portrait = H > W * 1.15 || W < 520;
    const LW = W * 0.56;
    const n = Math.max(1, p?.seats.length ?? 4);
    const cols = portrait ? 1 : n;
    // 카드 크기 (가로 화면은 자리 수로, 세로 화면은 왼쪽 칸 너비로)
    const cw = portrait ? clamp(Math.min(LW / 3, H / 8), 40, 96) : clamp(Math.min(W / (cols * 2.6), H / 4.3), 40, 124);
    const shoe = portrait ? { x: 18 + cw * 0.42, y: H * 0.46 } : { x: W - cw * 1.1, y: H * 0.19 };
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
          const card = playingCard(scene, hx + (ci - 1) * hcw * 0.36, y - ci * hcw * 0.05, c, hcw, { lift: active });
          const key = cardKey(s.seat, hi, ci, h.fromSplit);
          const cl = t.deal(card, key, c, shoe);
          land = Math.max(land, cl);
          // 처음 두 장: 스플릿하면 제 핸드 자리로 미끄러져 간다 (나눠 주는 중에는 자리만 기록)
          if (!h.fromSplit ? ci < 2 : ci === 0) {
            const was = lastWidth.get(key);
            lastWidth.set(key, hcw);
            t.track(card, `mv:${key}`, { still: cl > 0, fromScale: was ? was / hcw : undefined, depth: 0 });
          }
        });
        const tot = `${h.total}${h.soft && h.total <= 21 ? 's' : ''}`;
        const res = h.result ? ` · ${RESULT[h.result]}${h.delta ? ` ${h.delta > 0 ? '+' : ''}${t.fmt(h.delta)}` : ''}` : '';
        const bad = h.result === 'lose' || h.result === 'bust';
        const lt = label(scene, hx, y - hcw * 0.98, `${tot}${h.doubled ? ' ×2' : ''}${res}`, clamp(hcw * 0.22, 12, 22), bad ? tc('lose') : h.result === 'win' || h.result === 'blackjack' ? tc('primary') : tc('white'));
        // 결과는 딜러 카드까지 다 놓인 뒤에 (딜러를 나중에 그릴 수 있어 모아 두었다가 맨 끝에)
        pendingLabels.push({ lt, land, result: !!h.result });
        // 칩은 카드 오른쪽 (아래 이름패와 겹치지 않게)
        const spread = chipLeft ? hcw * 1.14 : hcw * (0.36 * (Math.max(3, h.cards.length) - 2) + 0.78);
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
        const card = playingCard(scene, dx + (i - 1) * dcw * 0.62, dy, c, dcw);
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
    const p = t.pub;
    if (!p || t.mySeat === null) return;
    const mine = p.seats.find((s) => s.seat === t.mySeat);
    if (p.phase === 'bet' && p.waitingBets.includes(t.mySeat) && t.myTurn) {
      // 베팅은 기본 단위의 배수만
      const max = Math.floor((mine?.maxBet ?? p.maxBet) / p.minBet) * p.minBet;
      if (betAmount < p.minBet || betAmount > max) betAmount = p.minBet;
      el.innerHTML = `<div class="row">
        <button class="btn" data-m="1">×1</button><button class="btn" data-m="2">×2</button><button class="btn" data-m="5">×5</button>
        <button class="btn" data-m="10">×10</button><button class="btn" data-m="max">최대</button>
        <span class="amount">${t.fmt(betAmount)}</span>
        <button class="btn big primary" id="bet" ${t.busy ? 'disabled' : ''}>베팅</button>
        <button class="btn" id="sit" ${t.busy ? 'disabled' : ''}>이번 판 쉬기</button></div>
        <p class="msg">베팅 ${t.fmt(p.minBet)} ~ ${t.fmt(max)}</p>`;
      el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) =>
        b.addEventListener('click', () => {
          betAmount = b.dataset.m === 'max' ? max : Math.min(max, p.minBet * Number(b.dataset.m));
          t.redraw();
        }),
      );
      el.querySelector('#bet')!.addEventListener('click', () => void t.act({ type: 'bet', amount: betAmount }));
      el.querySelector('#sit')!.addEventListener('click', () => void t.act({ type: 'sitout' }));
      return;
    }
    if (p.phase === 'play' && t.myTurn && p.turn?.seat === t.mySeat) {
      el.innerHTML = `<div class="row">${p.legal
        .map((a) => `<button class="btn big ${a === 'hit' ? 'primary' : a === 'stand' ? 'alt' : ''}" data-a="${a}" ${t.busy ? 'disabled' : ''}>${ACTION[a]}</button>`)
        .join('')}</div><p class="msg">${(mine?.hands.length ?? 0) > 1 ? `${(p.turn.hand ?? 0) + 1}번째 핸드 · ` : ''}20초 안에 고르지 않으면 스탠드해요</p>`;
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
  },

  resultHtml(t: Ctx) {
    const r = t.pub?.summary ?? ((t.pub as unknown as { result?: BjPublic['summary'] })?.result ?? null);
    if (!r) return '<p>판이 끝났어요</p>';
    const rows = r.seats
      .map((s) => {
        const d = s.delta;
        const res = s.out ? '쉼' : s.hands.map((h) => RESULT[h.result]).join(' / ');
        return `<tr><td>${esc(s.name)}${s.seat === t.resultSeat ? ' (나)' : ''}</td><td>${res}</td><td class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${t.fmt(d)}</td></tr>`;
      })
      .join('');
    return `<h3>🃏 판 결과</h3><p>딜러 ${r.dealer.total}${r.dealer.blackjack ? ' (블랙잭)' : r.dealer.bust ? ' (버스트)' : ''}</p><table>${rows}</table>`;
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
        return typeof ev.seat === 'number' ? { at: ev.seat, text: `${who} 더블다운!`, chips: { from: `tag:${ev.seat}`, to: `bet:${ev.seat}`, amount: Number(ev.bet) || 0 } } : null;
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

void bootGame(ui);
