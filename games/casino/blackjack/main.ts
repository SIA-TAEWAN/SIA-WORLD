/** 블랙잭 화면: 딜러(위) + 플레이어 자리(아래), 베팅·히트·스탠드·더블·스플릿 */
import { bootGame, esc, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { chipStack, clamp, drawTable, label, nameTag, playingCard } from '../../lib/cards.ts';
import type { BjPublic, BjResult } from '../../../supabase/functions/_shared/blackjack.ts';

type Ctx = TableCtx<BjPublic, Record<string, never>>;

const RESULT: Record<BjResult, string> = { blackjack: '블랙잭!', win: '승', push: '무승부', lose: '패', bust: '버스트' };
const ACTION: Record<string, string> = { hit: '히트', stand: '스탠드', double: '더블다운', split: '스플릿' };

let betAmount = 0;

const ui: GameUI<BjPublic, Record<string, never>> = {
  game: 'blackjack',
  title: '블랙잭',
  icon: '🃏',
  back: 'games/casino/',
  backLabel: '카지노',
  felt: 0x2a1712,

  draw(t: Ctx) {
    const { scene } = t;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const p = t.pub;
    drawTable(scene, 'lacquer', 0x1d6b4f);
    const n = Math.max(1, p?.seats.length ?? 4);
    // 세로 화면이면 자리를 2×2로, 가로면 한 줄로
    const portrait = H > W * 1.15;
    const cols = portrait ? Math.min(2, n) : n;
    const rows = Math.ceil(n / cols);
    // 카드 크기: 화면 비율에 맞춰 (좁으면 자리 수로, 낮으면 높이로 제한)
    const cw = clamp(Math.min(W / (cols * 2.6), H / (portrait ? 3.4 + rows * 2.3 : 4.3)), 40, 124);
    const shoe = { x: W - cw * 1.1, y: H * 0.19 };
    // 슈 (카드를 꺼내는 곳)
    for (let i = 0; i < 4; i++) playingCard(scene, shoe.x + i * 2, shoe.y - i * 2, null, cw * 0.8);
    if (portrait || H > 380) label(scene, W / 2, portrait ? cw * 2.15 + 14 : H * 0.455, '블랙잭 3:2 · 딜러는 17부터 섭니다', clamp(cw * 0.17, 12, 16), '#bfe3d3').setAlpha(0.85);
    if (!p) {
      label(scene, W / 2, H / 2 - cw * 0.6, '모두 레디하면 시작해요', clamp(cw * 0.3, 18, 30));
      return;
    }
    if (p.shoeRemaining) label(scene, shoe.x, shoe.y + cw * 0.72, `${p.shoeRemaining}장`, clamp(cw * 0.17, 11, 15), '#d8c7b0');
    // 딜러
    const dc = p.dealer.cards;
    const dy = portrait ? cw * 1.0 + 12 : H * 0.22;
    dc.forEach((c, i) => {
      const card = playingCard(scene, W / 2 + (i - (dc.length - 1) / 2) * cw * 0.62, dy, c, cw);
      t.deal(card, `d:${i}`, c, shoe);
    });
    const dlabel = p.dealer.total !== null ? `딜러 ${p.dealer.total}${p.dealer.soft ? ' 소프트' : ''}${p.dealer.blackjack ? ' · 블랙잭' : ''}` : '딜러';
    label(scene, W / 2, dy + cw * 0.95, dlabel, clamp(cw * 0.22, 14, 22));

    // 플레이어 자리
    const seats = p.seats;
    const slot = W / cols;
    // 자리 칸: 딜러 아래부터 바닥까지를 줄 수만큼 나눈다
    const areaTop = portrait ? cw * 2.4 + 20 : H * 0.42;
    const rowH = (H - areaTop) / rows;
    seats.forEach((s, i) => {
      const x = slot * ((i % cols) + 0.5);
      const rowTop = areaTop + rowH * Math.floor(i / cols);
      const y = rowTop + Math.min(rowH * 0.42, cw * 0.98 + 18);
      const isTurn = p.turn?.seat === s.seat;
      const me = s.seat === t.mySeat;
      const k = clamp(cw / 80, 0.8, 1.15);
      nameTag(scene, x - 44 * k, rowTop + rowH - 26 * k, t.seatName(s.seat), t.seatAvatar(s.seat), {
        turn: isTurn || (p.phase === 'bet' && p.waitingBets.includes(s.seat)),
        me,
        size: k,
        sub: s.out ? '쉬는 중' : s.bet ? `베팅 ${t.fmt(s.bet)}` : undefined,
      });
      const hands = s.hands;
      const hw = hands.length > 1 ? Math.min(cw * 1.5, slot / 2.05) : 0;
      const hcw = hands.length > 1 ? Math.min(cw * 0.86, slot / 2.6) : cw * 0.92;
      hands.forEach((h, hi) => {
        const hx = x + (hi - (hands.length - 1) / 2) * hw;
        const active = isTurn && p.turn?.hand === hi;
        h.cards.forEach((c, ci) => {
          const card = playingCard(scene, hx - hcw * 0.18 * (h.cards.length - 1) + ci * hcw * 0.36, y - ci * hcw * 0.05, c, hcw, { lift: active });
          t.deal(card, `${s.seat}:${hi}:${ci}`, c, shoe);
        });
        const tot = `${h.total}${h.soft && h.total <= 21 ? 's' : ''}`;
        const res = h.result ? ` · ${RESULT[h.result]}${h.delta ? ` ${h.delta > 0 ? '+' : ''}${t.fmt(h.delta)}` : ''}` : '';
        const bad = h.result === 'lose' || h.result === 'bust';
        label(scene, hx, y - hcw * 0.98, `${tot}${h.doubled ? ' ×2' : ''}${res}`, clamp(hcw * 0.22, 13, 22), bad ? '#ffb4a8' : h.result === 'win' || h.result === 'blackjack' ? '#f7d77a' : '#fff6e5');
        // 칩: 가로는 카드 아래, 세로(2×2)는 이름패와 겹치지 않게 카드 오른쪽
        if (portrait) chipStack(scene, hx + hcw * 0.18 * (h.cards.length - 1) + hcw * 0.78, y + hcw * 0.25, h.bet, undefined, clamp(cw * 0.18, 10, 16));
        else chipStack(scene, hx, y + hcw * 0.92, h.bet, undefined, clamp(cw * 0.2, 11, 20));
      });
      if (!hands.length && s.bet) chipStack(scene, x, y + cw * 0.3, s.bet, undefined, clamp(cw * 0.2, 11, 20));
    });
  },

  controls(t: Ctx, el: HTMLElement) {
    const p = t.pub;
    if (!p || t.mySeat === null) return;
    const mine = p.seats.find((s) => s.seat === t.mySeat);
    if (p.phase === 'bet' && p.waitingBets.includes(t.mySeat)) {
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
    const who = p.phase === 'bet' ? '다른 사람이 베팅하는 중…' : p.turn ? `${esc(t.seatName(p.turn.seat))} 차례…` : '딜러 차례…';
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
