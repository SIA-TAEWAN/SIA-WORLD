/** 세븐포커 화면: 나는 아래, 다른 사람은 왼쪽·위·오른쪽. 4장 받고 1장 버리고 1장 공개 → 4~6구 공개, 7구 히든 */
import { POKER_MANUAL } from '../../lib/manuals.ts';
import { bootGame, esc, sfx, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { chipStack, clamp, drawTable, label, nameTag, playingCard, tc, theme, viewSize } from '../../lib/cards.ts';
import type { PokerPrivate, PokerPublic } from '../../../supabase/functions/_shared/poker.ts';

type Ctx = TableCtx<PokerPublic, PokerPrivate>;

const BET: Record<string, string> = { check: '체크', bbing: '삥', call: '콜', ddadang: '따당', half: '하프', die: '다이' };
/** 단계 이름 (phase로 정한다: choose / bet4~bet7 / done) */
const ROUND = (phase: string) => (phase === 'choose' ? '카드 고르기' : phase === 'bet7' ? '7구 (히든)' : /^bet\d$/.test(phase) ? `${phase.slice(3)}구` : '결과');

/** 선택 단계: 버릴 카드 → 공개할 카드 */
let discard: string | null = null;
/** 버리는 연출을 이미 보여 준 카드 */
let thrownShown: string | null = null;
/** 말풍선용 짧은 이름 ('AI 어흥이' → '어흥이') */
const short = (n: string) => n.replace(/^AI /, '');


const ui: GameUI<PokerPublic, PokerPrivate> = {
  game: 'poker',
  title: '세븐포커',
  manual: POKER_MANUAL,
  icon: '♠️',
  back: 'games/casino/',
  backLabel: '카지노',
  felt: () => theme().COLOR.skyMid,

  draw(t: Ctx) {
    const { scene } = t;
    const { W, H } = viewSize(scene);
    const p = t.pub;
    drawTable(scene, 'poker');
    const portrait = H > W * 1.15 || W < 520;
    // 내 카드 크기: 화면 비율에 맞춰 (7장이 한 줄에 들어오게). 다른 사람은 0.6배
    const cw = clamp(Math.min(W / 5.8, H / 4.9), 40, 118);
    const nOpp = Math.max(1, (p?.seats.length ?? 4) - 1);
    const oc = portrait ? Math.min(cw * 0.6, W / nOpp / 3.9) : cw * 0.6;
    const center = { x: W / 2, y: portrait ? H * 0.42 : H * 0.36 };
    const deck = { x: center.x + cw * 1.15, y: center.y };
    for (let i = 0; i < 3; i++) playingCard(scene, deck.x + i * 2, deck.y - i * 2, null, oc);
    if (!p) {
      label(scene, W / 2, H / 2, '모두 레디하면 시작해요', clamp(cw * 0.3, 18, 30));
      return;
    }
    // 가운데 판돈
    const chip = clamp(cw * 0.22, 13, 22);
    chipStack(scene, center.x - cw * 0.15, center.y, p.pot, `판돈 ${t.fmt(p.pot)}`, chip);
    t.anchor('pot', center.x - cw * 0.15, center.y);
    label(
      scene,
      center.x,
      center.y + chip * 2.3 + clamp(cw * 0.18, 12, 18),
      `${ROUND(p.phase)}${p.curBet ? ` · 베팅 ${t.fmt(p.curBet)}` : ''}${p.pots.length > 1 ? ` · 사이드 팟 ${p.pots.length - 1}` : ''}`,
      clamp(cw * 0.18, 12, 18),
    );

    // 자리 배치: 내 자리가 아래 가운데
    const order = [...p.seats].sort((a, b) => a.seat - b.seat);
    const myIdx = Math.max(0, order.findIndex((s) => s.seat === t.mySeat));
    const side = Math.max(oc * 2.1, W * 0.16);
    const myY = H - cw * 0.71 - Math.max(46, cw * 0.55);
    // 가로: 왼쪽·위·오른쪽 / 세로: 위에 한 줄
    const spots: number[][] = portrait
      ? [[W / 2, myY], ...Array.from({ length: nOpp }, (_, j) => [(W * (j + 0.5)) / nOpp, oc * 0.71 + 22])]
      : [
          [W / 2, myY],
          [side, H * 0.36],
          [W / 2, oc * 0.71 + 24],
          [W - side, H * 0.36],
        ];
    const shown = new Map((p.showdown ?? []).map((h) => [h.seat, h]));
    order.forEach((s, i) => {
      const rel = (i - myIdx + order.length) % order.length;
      const [x, y] = spots[!portrait && order.length === 2 && rel === 1 ? 2 : rel];
      const me = s.seat === t.mySeat;
      const sd = shown.get(s.seat);
      let cards: (string | null)[];
      if (sd) cards = sd.cards;
      else if (me && t.priv) cards = p.phase === 'choose' && t.priv.choices.length ? t.priv.choices : [...t.priv.hidden.slice(0, 2), ...s.open, ...t.priv.hidden.slice(2)];
      else cards = [...Array(Math.min(2, s.hiddenCount)).fill(null), ...s.open, ...Array(Math.max(0, s.hiddenCount - 2)).fill(null)];
      const w = me ? cw : oc;
      const gap = w * (me ? 0.72 : 0.4);
      // 카드 고르기 단계: 내 카드를 눌러서 버릴 카드 → 공개할 카드를 고른다 (아래 버튼과 같은 동작)
      // 카드를 다 받은 뒤에 고른다 (t.myTurn: 앞선 연출이 끝난 내 차례)
      const picking = me && !sd && p.phase === 'choose' && !!t.priv?.choices.length && !s.chosen && !t.busy && t.myTurn;
      cards.forEach((c, ci) => {
        const isOpen = c !== null && s.open.includes(c);
        const thrown = picking && c === discard;
        const cx = x + (ci - (cards.length - 1) / 2) * gap;
        if (thrown) {
          // 버린 카드는 바로 버린다: 고른 순간 한 번 날아가 사라지고, 남은 카드 중에서 공개할 카드를 고른다
          if (thrownShown !== c) {
            thrownShown = c;
            const fly = playingCard(scene, cx, y, c, w, {});
            sfx('fold');
            scene.tweens.add({ targets: fly, x: deck.x, y: deck.y, angle: -25, scale: 0.5, alpha: 0, duration: 420, ease: 'Cubic.easeIn', onComplete: () => fly.destroy() });
          }
          return;
        }
        const card = playingCard(scene, cx, y, c, w, {
          dim: s.folded || thrown,
          lift: (me && !!c && !isOpen && p.phase !== 'choose') || (picking && !thrown),
        });
        t.deal(card, `${s.seat}:${ci}`, c, deck);
        if (picking && c) {
          card.setSize(w, w * 1.42).setInteractive({ useHandCursor: true });
          card.on('pointerdown', () => pickChoice(t, c));
        }
      });
      const mineHand = me && !sd && t.priv?.hand && p.phase !== 'choose' ? `내 패 ${t.priv.hand}` : '';
      const sub = s.excluded ? '이번 판 쉼' : s.folded ? '다이' : [s.last, s.allIn ? '올인' : '', mineHand || (s.openLabel ?? '')].filter(Boolean).join(' · ');
      const k = me ? clamp(cw / 85, 0.85, 1.15) : clamp(cw / 100, 0.75, 1);
      const tagY = y + w * 0.71 + 24 * k;
      nameTag(scene, clamp(x - 52 * k, 26, W - 150 * k), tagY, t.seatName(s.seat), t.seatAvatar(s.seat), { turn: p.turn === s.seat, me, size: k, sub: sub || undefined });
      t.anchor(`seat:${s.seat}`, x, y - w * 0.72);
      const fs = clamp(w * (me ? 0.2 : 0.28), 12, 22);
      if (s.total) label(scene, x + ((cards.length - 1) / 2) * gap + w * 0.62, y - w * 0.55, `${t.fmt(s.total)}`, fs * 0.85, tc('primary'));
      if (sd) label(scene, x, y - w * 0.92, `${sd.hand}${p.winners.includes(s.seat) ? ' 🏆' : ''}`, fs, p.winners.includes(s.seat) ? tc('primary') : tc('white'));
    });
  },

  controls(t: Ctx, el: HTMLElement) {
    const p = t.pub;
    if (!p || t.mySeat === null) return;
    const mine = p.seats.find((s) => s.seat === t.mySeat);
    if (p.phase === 'choose') {
      if (!mine || mine.chosen || !t.priv?.choices.length) {
        el.innerHTML = '<p class="msg">다른 사람이 카드를 고르는 중…</p>';
        discard = null;
        return;
      }
      if (!t.myTurn) {
        el.innerHTML = '<p class="msg">카드를 나누는 중…</p>';
        return;
      }
      const choices = t.priv.choices;
      if (discard && !choices.includes(discard)) discard = null;
      const step = discard ? '공개할 카드를 고르세요' : '버릴 카드를 고르세요';
      el.innerHTML = `<p class="msg">${step}</p><div class="row">${choices
        .filter((c) => c !== discard)
        .map((c) => `<button class="btn big" data-c="${c}" ${t.busy ? 'disabled' : ''}>${cardText(c)}</button>`)
        .join('')}${discard ? '<button class="btn" id="undo">다시 고르기</button>' : ''}</div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.addEventListener('click', () => pickChoice(t, b.dataset.c!)));
      el.querySelector('#undo')?.addEventListener('click', () => ((discard = null), t.redraw()));
      return;
    }
    if (t.myTurn && p.turn === t.mySeat) {
      el.innerHTML = `<div class="row">${p.actions
        .map((a) => `<button class="btn big ${a.type === 'die' ? '' : a.type === 'call' || a.type === 'check' ? 'primary' : 'alt'}" data-a="${a.type}" ${t.busy ? 'disabled' : ''}>
          ${BET[a.type]}${a.amount ? ` ${t.fmt(a.amount)}` : ''}${a.allIn ? ' (올인)' : ''}</button>`)
        .join('')}</div><p class="msg">레이즈 ${p.raises}/${p.maxRaises} · 20초가 지나면 체크(안 되면 다이)</p>`;
      el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => void t.act({ type: b.dataset.a })));
      return;
    }
    // 내 차례여도 앞선 연출(말풍선·카드 나누기)이 끝나기 전에는 버튼 대신 안내
    el.innerHTML = `<p class="msg">${p.turn === null ? (p.phase === 'done' ? '' : '카드를 나누는 중…') : p.turn === t.mySeat ? '진행 중이에요…' : `${esc(t.seatName(p.turn))} 차례…`}</p>`;
  },

  resultHtml(t: Ctx) {
    const r = t.pub?.summary;
    if (!r) return '<p>판이 끝났어요</p>';
    if (r.cancelled) return '<h3>판이 취소됐어요</h3><p>참가할 수 있는 사람이 2명보다 적었어요</p>';
    const names = new Map((t.pub?.seats ?? []).map((s) => [s.seat, s.name]));
    const rows = Object.entries(r.deltas)
      .map(([seat, d]) => {
        const n = Number(seat);
        const hand = r.hands[n]?.name ?? (r.winners.includes(n) && r.uncontested ? '무혈 승리' : '');
        return `<tr><td>${esc(names.get(n) ?? t.seatName(n))}${n === t.resultSeat ? ' (나)' : ''}${r.winners.includes(n) ? ' 🏆' : ''}</td><td>${esc(hand)}</td><td class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${t.fmt(d)}</td></tr>`;
      })
      .join('');
    return `<h3>♠️ 판 결과</h3><table>${rows}</table>`;
  },

  // 서버 응답에 행동이 여러 개면 하나씩: 말풍선 + 칩 (AI는 0.8초 간격)
  replay(ev, t: Ctx) {
    if (typeof ev.seat !== 'number') return null;
    const who = short(t.seatName(ev.seat));
    const amount = typeof ev.amount === 'number' ? ev.amount : 0;
    switch (ev.t) {
      case 'ante':
        return { chips: { from: ev.seat, to: 'pot', amount }, gap: 140 };
      case 'check':
      case 'bbing':
      case 'call':
      case 'ddadang':
      case 'half':
        return { at: ev.seat, text: `${who} ${BET[ev.t]}!`, chips: amount ? { from: ev.seat, to: 'pot', amount } : undefined, sound: amount ? undefined : 'tick' };
      case 'die':
        return { at: ev.seat, text: `${who} 다이`, sound: 'fold' };
      case 'allin':
        return { at: ev.seat, text: `${who} 올인!`, gap: 500 };
      case 'win':
        return { at: ev.seat, text: `${who} +${t.fmt(amount)}`, chips: { from: 'pot', to: ev.seat, amount }, sound: 'coin', gap: 900, after: true };
      default:
        return null;
    }
  },

  cutin(ev, t: Ctx) {
    if (ev.t === 'royal') return '로열 스트레이트 플러시!';
    if (ev.t === 'straight_flush') return '스트레이트 플러시!';
    if (ev.t === 'four_kind') return '포카드!';
    if (ev.t === 'win' && typeof ev.amount === 'number' && t.pub && ev.amount >= t.pub.baseUnit * 100) return '대박 판돈!';
    return null;
  },
};

/** 카드 고르기: 첫 번째는 버릴 카드, 두 번째는 공개할 카드 (버린 카드를 다시 누르면 취소) */
function pickChoice(t: Ctx, c: string) {
  if (t.busy) return;
  if (!discard) {
    discard = c;
    thrownShown = null;
    t.redraw();
  } else if (c === discard) {
    discard = null;
    t.redraw();
  } else {
    const d = discard;
    discard = null;
    void t.act({ type: 'choose', discard: d, open: c });
  }
}

function cardText(c: string) {
  const sym: Record<string, string> = { S: '♠', D: '◆', H: '♥', C: '♣' };
  const r = c[0] === 'T' ? '10' : c.slice(0, -1);
  return `${r}${sym[c.slice(-1)] ?? ''}`;
}

void bootGame(ui);
