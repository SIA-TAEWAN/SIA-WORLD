/** 세븐포커 화면: 나는 아래, 다른 사람은 왼쪽·위·오른쪽. 4장 받고 1장 버리고 1장 공개 → 4~6구 공개, 7구 히든 */
import { bootGame, esc, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { chipStack, label, nameTag, playingCard } from '../../lib/cards.ts';
import type { PokerPrivate, PokerPublic } from '../../../supabase/functions/_shared/poker.ts';

type Ctx = TableCtx<PokerPublic, PokerPrivate>;

const BET: Record<string, string> = { check: '체크', bbing: '삥', call: '콜', ddadang: '따당', half: '하프', die: '다이' };
/** 단계 이름 (phase로 정한다: choose / bet4~bet7 / done) */
const ROUND = (phase: string) => (phase === 'choose' ? '카드 고르기' : phase === 'bet7' ? '7구 (히든)' : /^bet\d$/.test(phase) ? `${phase.slice(3)}구` : '결과');

/** 선택 단계: 버릴 카드 → 공개할 카드 */
let discard: string | null = null;

const ui: GameUI<PokerPublic, PokerPrivate> = {
  game: 'poker',
  title: '세븐포커',
  icon: '♠️',
  back: 'games/casino/',
  backLabel: '카지노',
  felt: 0x174d6b,

  draw(t: Ctx) {
    const { scene } = t;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const p = t.pub;
    const cw = Math.max(30, Math.min(54, W / 16, H / 8));
    if (!p) {
      label(scene, W / 2, H / 2, '모두 레디하면 시작해요', 22);
      return;
    }
    // 가운데 판돈
    chipStack(scene, W / 2, H / 2 - 10, p.pot, `판돈 ${t.fmt(p.pot)}`);
    label(scene, W / 2, H / 2 + 34, `${ROUND(p.phase)}${p.curBet ? ` · 베팅 ${t.fmt(p.curBet)}` : ''}${p.pots.length > 1 ? ` · 사이드 팟 ${p.pots.length - 1}` : ''}`, 14, '#d9ecff');

    // 자리 배치: 내 자리가 아래 가운데
    const order = [...p.seats].sort((a, b) => a.seat - b.seat);
    const myIdx = Math.max(0, order.findIndex((s) => s.seat === t.mySeat));
    // 좁은 화면에서 왼쪽·오른쪽 자리가 잘리지 않게
    const side = Math.max(cw * 1.6, W * 0.13);
    const spots = [
      [W / 2, H * 0.8],
      [side, H * 0.45],
      [W / 2, H * 0.14],
      [W - side, H * 0.45],
    ];
    const shown = new Map((p.showdown ?? []).map((h) => [h.seat, h]));
    order.forEach((s, i) => {
      const rel = (i - myIdx + order.length) % order.length;
      const [x, y] = spots[order.length === 2 && rel === 1 ? 2 : rel];
      const me = s.seat === t.mySeat;
      const sd = shown.get(s.seat);
      let cards: (string | null)[];
      if (sd) cards = sd.cards;
      else if (me && t.priv) cards = p.phase === 'choose' && t.priv.choices.length ? t.priv.choices : [...t.priv.hidden.slice(0, 2), ...s.open, ...t.priv.hidden.slice(2)];
      else cards = [...Array(Math.min(2, s.hiddenCount)).fill(null), ...s.open, ...Array(Math.max(0, s.hiddenCount - 2)).fill(null)];
      const scale = me ? 1 : 0.78;
      const gap = cw * scale * (me ? 0.75 : 0.5);
      cards.forEach((c, ci) => {
        const isOpen = c !== null && s.open.includes(c);
        playingCard(scene, x + (ci - (cards.length - 1) / 2) * gap, y, c, cw * scale, {
          dim: s.folded,
          lift: me && !!c && !isOpen && p.phase !== 'choose',
        });
      });
      const sub = s.excluded ? '이번 판 쉼' : s.folded ? '다이' : [s.last, s.allIn ? '올인' : '', s.openLabel ?? ''].filter(Boolean).join(' · ');
      nameTag(scene, Math.min(W - 120, Math.max(22, x - 50)), y + cw * scale * 0.95, t.seatName(s.seat), t.seatAvatar(s.seat), { turn: p.turn === s.seat, me, sub: sub || undefined });
      if (s.total) label(scene, x + cw * 1.8 * scale, y - cw * 0.95 * scale, `${t.fmt(s.total)}`, 13, '#ffe9a8');
      if (sd) label(scene, x, y - cw * 0.95 * scale, `${sd.hand}${p.winners.includes(s.seat) ? ' 🏆' : ''}`, 16, p.winners.includes(s.seat) ? '#ffe066' : '#ffffff');
      else if (me && t.priv?.hand && p.phase !== 'choose') label(scene, x, y - cw * 0.95, `내 패: ${t.priv.hand}`, 15, '#ffe066');
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
      const choices = t.priv.choices;
      if (discard && !choices.includes(discard)) discard = null;
      const step = discard ? '공개할 카드를 고르세요' : '버릴 카드를 고르세요';
      el.innerHTML = `<p class="msg">${step}</p><div class="row">${choices
        .filter((c) => c !== discard)
        .map((c) => `<button class="btn big" data-c="${c}" ${t.busy ? 'disabled' : ''}>${cardText(c)}</button>`)
        .join('')}${discard ? '<button class="btn" id="undo">다시 고르기</button>' : ''}</div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) =>
        b.addEventListener('click', () => {
          if (!discard) {
            discard = b.dataset.c!;
            t.redraw();
          } else {
            const d = discard;
            discard = null;
            void t.act({ type: 'choose', discard: d, open: b.dataset.c });
          }
        }),
      );
      el.querySelector('#undo')?.addEventListener('click', () => ((discard = null), t.redraw()));
      return;
    }
    if (t.myTurn && p.turn === t.mySeat) {
      el.innerHTML = `<div class="row">${p.actions
        .map((a) => `<button class="btn big ${a.type === 'die' ? '' : a.type === 'call' || a.type === 'check' ? 'primary' : ''}" data-a="${a.type}" ${t.busy ? 'disabled' : ''}>
          ${BET[a.type]}${a.amount ? ` ${t.fmt(a.amount)}` : ''}${a.allIn ? ' (올인)' : ''}</button>`)
        .join('')}</div><p class="msg">레이즈 ${p.raises}/${p.maxRaises} · 20초가 지나면 체크(안 되면 다이)</p>`;
      el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => void t.act({ type: b.dataset.a })));
      return;
    }
    el.innerHTML = `<p class="msg">${p.turn !== null ? `${esc(t.seatName(p.turn))} 차례…` : '카드를 나누는 중…'}</p>`;
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

  cutin(ev, t: Ctx) {
    if (ev.t === 'royal') return '로열 스트레이트 플러시!';
    if (ev.t === 'straight_flush') return '스트레이트 플러시!';
    if (ev.t === 'four_kind') return '포카드!';
    if (ev.t === 'win' && typeof ev.amount === 'number' && t.pub && ev.amount >= t.pub.baseUnit * 100) return '대박 판돈!';
    return null;
  },
};

function cardText(c: string) {
  const sym: Record<string, string> = { S: '♠', D: '◆', H: '♥', C: '♣' };
  const r = c[0] === 'T' ? '10' : c.slice(0, -1);
  return `${r}${sym[c.slice(-1)] ?? ''}`;
}

void bootGame(ui);
