/** 블랙잭 화면: 딜러(위) + 플레이어 자리(아래), 베팅·히트·스탠드·더블·스플릿 */
import { bootGame, esc, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { chipStack, label, nameTag, playingCard } from '../../lib/cards.ts';
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
  felt: 0x1d6b45,

  draw(t: Ctx) {
    const { scene } = t;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const p = t.pub;
    const cw = Math.max(34, Math.min(62, W / 14, H / 7));
    // 테이블 테두리
    const g = scene.add.graphics();
    g.lineStyle(4, 0xe8c66a, 0.6).strokeEllipse(W / 2, H * 0.05, W * 1.1, H * 1.5);
    label(scene, W / 2, H * 0.47, '딜러는 16 이하 히트 · 17 이상 스탠드 · 블랙잭 3:2', 13, '#cfe9d8').setAlpha(0.8);
    if (!p) {
      label(scene, W / 2, H / 2 - 30, '모두 레디하면 시작해요', 22);
      return;
    }
    // 딜러
    const dc = p.dealer.cards;
    dc.forEach((c, i) => playingCard(scene, W / 2 + (i - (dc.length - 1) / 2) * cw * 0.7, H * 0.2, c, cw));
    if (p.dealer.total !== null) label(scene, W / 2, H * 0.2 + cw * 0.95, `딜러 ${p.dealer.total}${p.dealer.soft ? ' (소프트)' : ''}`, 16);
    label(scene, W / 2, H * 0.2 - cw * 1.05, '🎩 딜러', 16);

    // 플레이어 자리
    const seats = p.seats;
    seats.forEach((s, i) => {
      const x = (W * (i + 0.5)) / seats.length;
      const y = H * 0.72;
      const isTurn = p.turn?.seat === s.seat;
      const me = s.seat === t.mySeat;
      nameTag(scene, x - 40, H - 26, t.seatName(s.seat), t.seatAvatar(s.seat), {
        turn: isTurn || (p.phase === 'bet' && p.waitingBets.includes(s.seat)),
        me,
        sub: s.out ? '쉬는 중' : s.bet ? `베팅 ${t.fmt(s.bet)}` : undefined,
      });
      const hands = s.hands;
      hands.forEach((h, hi) => {
        const hx = x + (hi - (hands.length - 1) / 2) * (cw * 1.9);
        h.cards.forEach((c, ci) => playingCard(scene, hx - cw * 0.25 + ci * cw * 0.32, y - ci * 6, c, cw * 0.9, { lift: isTurn && p.turn?.hand === hi }));
        const tot = `${h.total}${h.soft && h.total <= 21 ? 's' : ''}`;
        const res = h.result ? ` · ${RESULT[h.result]}${h.delta ? ` ${h.delta > 0 ? '+' : ''}${t.fmt(h.delta)}` : ''}` : '';
        label(scene, hx, y - cw * 1.05, `${tot}${h.doubled ? ' ×2' : ''}${res}`, 15, h.result === 'lose' || h.result === 'bust' ? '#ffb4b4' : '#ffffff');
        chipStack(scene, hx, y + cw * 0.85, h.bet);
      });
      if (!hands.length && s.bet) chipStack(scene, x, y + cw * 0.3, s.bet);
    });
  },

  controls(t: Ctx, el: HTMLElement) {
    const p = t.pub;
    if (!p || t.mySeat === null) return;
    const mine = p.seats.find((s) => s.seat === t.mySeat);
    if (p.phase === 'bet' && p.waitingBets.includes(t.mySeat)) {
      const max = mine?.maxBet ?? p.maxBet;
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
        .map((a) => `<button class="btn big ${a === 'hit' ? 'primary' : ''}" data-a="${a}" ${t.busy ? 'disabled' : ''}>${ACTION[a]}</button>`)
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
        return `<tr><td>${esc(t.seatName(s.seat))}${s.seat === t.mySeat ? ' (나)' : ''}</td><td>${res}</td><td class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${t.fmt(d)}</td></tr>`;
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
