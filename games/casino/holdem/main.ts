/** 텍사스 홀덤 화면: 가운데 공용 카드 5장 · 나는 아래 · 다른 사람은 왼쪽·위·오른쪽 (세로 화면은 위 한 줄) */
import { HOLDEM_MANUAL } from '../../lib/manuals.ts';
import { bootGame, esc, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { chipStack, clamp, drawTable, label, nameTag, playingCard, tc, theme, viewSize } from '../../lib/cards.ts';
import type { HoldemPrivate, HoldemPublic } from '../../../supabase/functions/_shared/holdem.ts';
import { rewindHoldem } from '../../../supabase/functions/_shared/holdem-rewind.ts';
import type PhaserNS from 'phaser';

type Ctx = TableCtx<HoldemPublic, HoldemPrivate>;

const STREET: Record<string, string> = { preflop: '프리플롭', flop: '플롭', turn: '턴', river: '리버', done: '결과' };

/** 레이즈(베트) 금액: 이번 라운드 총액 (슬라이더) */
let raiseTo = 0;
let raiseKey = '';
/** 마지막으로 그린 공개 상태 (한 동작씩 되돌려 보여 줄 때 기준) */
let lastPub: HoldemPublic | null = null;
/** 말풍선용 짧은 이름 ('AI 어흥이' → '어흥이') */
const short = (n: string) => n.replace(/^AI /, '');


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
  title: '텍사스 홀덤',
  manual: HOLDEM_MANUAL,
  icon: '♥️',
  back: 'games/casino/',
  backLabel: '카지노',
  felt: () => theme().COLOR.skyMid,

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
      // 딜러 버튼
      if (s.seat === p.button) marker(scene, x + ((cards.length || 2) / 2) * gap + w * 0.42, y + w * 0.5, 'D', clamp(w * 0.16, 9, 15));
      // 이번 라운드에 낸 칩 (가운데 쪽으로)
      if (s.betRound > 0) {
        const toward = me ? -1 : 1;
        chipStack(scene, x - ((cards.length || 2) / 2) * gap - w * 0.42, y + toward * w * 0.1, s.betRound, t.fmt(s.betRound), clamp(w * 0.16, 9, 16));
      }
      if (sd) label(scene, x, y - w * 0.95, `${sd.hand}${p.winners.includes(s.seat) ? ' 🏆' : ''}`, clamp(w * (me ? 0.2 : 0.26), 12, 22), p.winners.includes(s.seat) ? tc('primary') : tc('white'));
    });
  },

  controls(t: Ctx, el: HTMLElement) {
    const p = t.pub;
    if (!p || t.mySeat === null) return;
    const o = p.options;
    if (!(t.myTurn && p.turn === t.mySeat && o)) {
      // 내 차례여도 앞선 연출(말풍선·카드 나누기)이 끝나기 전에는 버튼 대신 안내
      el.innerHTML = `<p class="msg">${p.turn === null ? (p.phase === 'done' ? '' : '카드를 나누는 중…') : p.turn === t.mySeat ? '진행 중이에요…' : `${esc(t.seatName(p.turn))} 차례…`}</p>`;
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
      <p class="msg">20초가 지나면 체크(안 되면 폴드)</p>`;
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
    const rows = Object.entries(r.deltas)
      .map(([seat, d]) => {
        const n = Number(seat);
        const hand = r.hands[n]?.name ?? (r.winners.includes(n) && r.uncontested ? '무혈 승리' : '');
        return `<tr><td>${esc(names.get(n) ?? t.seatName(n))}${n === t.resultSeat ? ' (나)' : ''}${r.winners.includes(n) ? ' 🏆' : ''}</td><td>${esc(hand)}</td><td class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${t.fmt(d)}</td></tr>`;
      })
      .join('');
    const split = r.pots.some((x) => x.winners.length > 1) ? '<p>동점이라 판돈을 나눴어요</p>' : '';
    return `<h3>♥️ 판 결과</h3>${split}<table>${rows}</table>`;
  },

  // 한 동작씩: 베팅 → 공용 카드 → 다음 베팅 순서로, 앞 동작의 카드 연출이 끝난 뒤에 다음 동작 (판 시작은 예전 방식)
  rewind: (next, events) => rewindHoldem(next, events, lastPub),

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
        return { at: ev.seat, text: `${who} +${t.fmt(amount)}`, chips: { from: 'pot', to: ev.seat, amount }, sound: 'coin', gap: 900, after: true };
      default:
        return null;
    }
  },

  cutin(ev, t: Ctx) {
    if (ev.t === 'royal') return '로열 스트레이트 플러시!';
    if (ev.t === 'straight_flush') return '스트레이트 플러시!';
    if (ev.t === 'four_kind') return '포카드!';
    if (ev.t === 'win' && ev.allIn) return '올인 승리!';
    if (ev.t === 'win' && typeof ev.amount === 'number' && t.pub && ev.amount >= t.pub.bb * 50) return '대박 판돈!';
    if (ev.t === 'allin' && ev.seat === t.mySeat) return '올인!';
    return null;
  },
};

void bootGame(ui);
