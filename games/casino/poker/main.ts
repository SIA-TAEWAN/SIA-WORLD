/** 세븐포커 화면: 나는 아래, 다른 사람은 왼쪽·위·오른쪽. 4장 받고 1장 버리고 1장 공개 → 4~6구 공개, 7구 히든 */
import { POKER_MANUAL } from '../../lib/manuals.ts';
import { pokerHint, pokerStory, pokerWeak, potRealWinners, potRefundOf, potRefundOnly, sidePotCount } from '../../lib/extras.ts';
import { bootGame, esc, sfx, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { chipStack, clamp, drawTable, label, nameTag, playingCard, sweepTable, tc, theme, viewSize } from '../../lib/cards.ts';
import type { PokerPrivate, PokerPublic } from '../../../supabase/functions/_shared/poker.ts';
import { pokerRoundStart, rewindPoker } from '../../../supabase/functions/_shared/poker-rewind.ts';

type Ctx = TableCtx<PokerPublic, PokerPrivate>;

const BET: Record<string, string> = { check: '체크', bbing: '삥', call: '콜', ddadang: '따당', half: '하프', die: '다이' };
/** 단계 이름 (phase로 정한다: choose / bet4~bet7 / done) */
const ROUND = (phase: string) => (phase === 'choose' ? '카드 고르기' : phase === 'bet7' ? '7구 (히든)' : /^bet\d$/.test(phase) ? `${phase.slice(3)}구` : '결과');

/** 선택 단계: 버릴 카드 → 공개할 카드 */
let discard: string | null = null;
/** 버리는 연출을 이미 보여 준 카드 */
let thrownShown: string | null = null;
/** 서버에 보낸 고르기 (답이 올 때까지 화면을 그대로 유지) */
let sent: { discard: string; open: string } | null = null;
let roundKey = '';
/** 카드 더미 자리 (판 정리 때 카드를 이리로 모은다) */
let deckPos = { x: 0, y: 0 };
/** 마지막으로 그린 공개 상태 (한 동작씩 되돌려 보여 줄 때 기준) */
let lastPub: PokerPublic | null = null;
/** 말풍선용 짧은 이름 ('AI 어흥이' → '어흥이') */
const short = (n: string) => n.replace(/^AI /, '');

/** 이 자리가 받은 것이 아무도 못 받은 베팅을 돌려받은 것(refund 팟)뿐인가 (재생 중이면 재생해 가는 판 결과로 가른다: 중간 화면의 pub 은 결과가 비어 있다) */
const refunded = (t: Ctx, seat: number) => potRefundOnly(seat, (t.pubNext ?? t.pub)?.summary);

// ── 판 요약 한 줄용 사건 기록: 공개 상태에는 최근 사건만 실리므로 판 동안 모아 둔다 ──
type Ev = PokerPublic['events'][number];
const evLog = new Map<number, Ev>();
let evKey = '';
function noteEvents(t: Ctx) {
  const evs = t.pub?.events ?? [];
  const key = `${t.room.id}:${t.room.round_no}`;
  // 방·판이 바뀌었거나, 같은 번호에 다른 사건이 왔으면(새 판의 사건 번호는 1부터 다시 센다) 새로 모은다
  if (key !== evKey || evs.some((e) => evLog.has(e.id) && evLog.get(e.id)!.t !== e.t)) evLog.clear();
  evKey = key;
  for (const e of evs) evLog.set(e.id, e);
}


const ui: GameUI<PokerPublic, PokerPrivate> = {
  game: 'poker',
  // 자동 시작 스위치 (결과 창 3초 → 판 정리 → 자동 레디)
  autoStart: true,
  title: '세븐포커',
  manual: POKER_MANUAL,
  // 배경음: 7구(히든) 마지막 베팅부터 쇼다운까지 긴장 곡
  bgmBoss: (pub) => pub.phase === 'bet7' || pub.phase === 'showdown',
  icon: '♠️',
  back: 'games/casino/',
  backLabel: '카지노',
  felt: () => theme().COLOR.skyMid,

  draw(t: Ctx) {
    const { scene } = t;
    const { W, H } = viewSize(scene);
    const p = t.pub;
    lastPub = p;
    noteEvents(t);
    drawTable(scene, 'poker');
    const portrait = H > W * 1.15 || W < 520;
    // 내 카드 크기: 화면 비율에 맞춰 (7장이 한 줄에 들어오게). 다른 사람은 0.6배
    const cw = clamp(Math.min(W / 5.8, H / 4.9), 40, 118);
    const nOpp = Math.max(1, (p?.seats.length ?? 4) - 1);
    const oc = portrait ? Math.min(cw * 0.6, W / nOpp / 3.9) : cw * 0.6;
    const center = { x: W / 2, y: portrait ? H * 0.42 : H * 0.36 };
    const deck = { x: center.x + cw * 1.15, y: center.y };
    deckPos = deck;
    for (let i = 0; i < 3; i++) playingCard(scene, deck.x + i * 2, deck.y - i * 2, null, oc);
    if (!p) {
      label(scene, W / 2, H / 2, '모두 레디하면 시작해요', clamp(cw * 0.3, 18, 30));
      return;
    }
    // 가운데 판돈
    const chip = clamp(cw * 0.22, 13, 22);
    chipStack(scene, center.x - cw * 0.15, center.y, p.pot, `판돈 ${t.fmt(p.pot)}`, chip);
    t.anchor('pot', center.x - cw * 0.15, center.y);
    const midFs = clamp(cw * 0.18, 12, 18);
    const midY = center.y + chip * 2.3 + midFs;
    label(
      scene,
      center.x,
      midY,
      `${ROUND(p.phase)}${p.curBet ? ` · 베팅 ${t.fmt(p.curBet)}` : ''}${sidePotCount(p.seats) ? ` · 사이드 팟 ${sidePotCount(p.seats)}` : ''}`,
      midFs,
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
      // 고르기를 보낸 뒤 (서버 답을 기다리는 동안): 버린 카드는 빼고 남은 3장만, 공개할 카드는 올려서 보여 준다
      if (me && roundKey !== `${t.room.id}:${t.room.round_no}`) {
        // 방·판이 바뀌면 지난 고르기 기록은 버린다
        roundKey = `${t.room.id}:${t.room.round_no}`;
        sent = null;
        discard = null;
        thrownShown = null;
      }
      // 내 패: 연출 재생 중에 먼저 온 새 패가 있으면 그것으로 (한 동작씩 보여 주는 중간 화면에서 내 카드가 빠지지 않게)
      const pv = me ? (t.privNext ?? t.priv) : null;
      const choosing = me && !sd && p.phase === 'choose' && !!pv?.choices.length;
      // 서버 답(고른 뒤의 내 패)이 왔으면 보낸 기록은 지운다
      if (me && sent && (!pv || !pv.choices.includes(sent.open))) sent = null;
      const gone = choosing ? (sent?.discard ?? discard) : null;
      // 고른 뒤 모두 고르기를 기다리는 중: 남긴 3장 (공개할 카드는 올려서)
      // (앞선 내 패에는 4구 카드까지 들어 있을 수 있다 → 고른 공개 카드 한 장만)
      const waitingOpen = me && !sd && !choosing && p.phase === 'choose' && pv ? pv.open.slice(0, 1) : [];
      if (sd) {
        // 쇼다운 카드는 [비공개 2 · 히든 · 공개 …] 순서로 온다 → 진행 중과 같은 자리(비공개 2 · 공개 · 히든)로 다시 세운다
        // (자리 번호 키로 그리므로 순서가 다르면 이미 보이던 공개 카드가 다른 카드로 뒤집힌다)
        const nHid = sd.cards.length - s.open.length;
        const tailIsOpen = nHid >= 0 && s.open.every((c, i) => sd.cards[nHid + i] === c);
        cards = tailIsOpen ? [...sd.cards.slice(0, Math.min(2, nHid)), ...s.open, ...sd.cards.slice(Math.min(2, nHid), nHid)] : sd.cards;
      }
      else if (me && pv) {
        if (choosing) cards = pv.choices.filter((c) => c !== gone);
        else if (p.phase === 'choose') cards = [...pv.hidden.slice(0, 2), ...pv.open.slice(0, 1)];
        else {
          // 새 패가 아직 안 왔으면 (고르기 직후의 중간 화면) 내가 보낸 고르기로 남은 2장을 안다
          // 시간 초과로 서버가 대신 골랐으면 무엇을 버렸는지 모른다 → 새 패가 올 때까지 내 카드는 그리지 않는다 (뒷면으로 그리면 한 번 더 받는 연출이 나온다)
          const hid: string[] | null = !pv.choices.length ? pv.hidden : sent ? pv.choices.filter((c) => c !== sent!.discard && c !== sent!.open) : null;
          // 히든(7구)은 공개 상태에서 받은 만큼만
          cards = hid ? [...hid.slice(0, 2), ...s.open, ...hid.slice(2, Math.max(2, s.hiddenCount))] : [];
        }
      }
      // 내 패가 아직 안 왔으면 그리지 않는다 (뒷면으로 먼저 받으면 패가 온 뒤 한 번 더 받는 연출이 나온다)
      else if (me && t.privWait) cards = [];
      else cards = [...Array(Math.min(2, s.hiddenCount)).fill(null), ...s.open, ...Array(Math.max(0, s.hiddenCount - 2)).fill(null)];
      const w = me ? cw : oc;
      const gap = w * (me ? 0.72 : 0.4);
      // 쇼다운: 족보를 이룬 5장(서버가 내려 준 best)은 살짝 올리고 나머지 2장은 흐리게
      const best = sd && sd.best.length === 5 ? new Set(sd.best) : null;
      // 카드 고르기 단계: 내 카드를 눌러서 버릴 카드 → 공개할 카드를 고른다 (아래 버튼과 같은 동작)
      // 카드를 다 받은 뒤에 고른다 (t.myTurn: 앞선 연출이 끝난 내 차례)
      const picking = choosing && !s.chosen && !t.busy && t.myTurn && !sent;
      // 버린 카드: 고른 순간 한 번 덱 쪽으로 날아가 사라진다 (남은 카드 중에서 공개할 카드를 고른다)
      if (choosing && gone && thrownShown !== gone) {
        thrownShown = gone;
        const from = t.lastPos(`pk:${gone}`) ?? { x, y };
        const fly = playingCard(scene, from.x, from.y, gone, w, {});
        fly.setDepth(20);
        sfx('fold');
        scene.tweens.add({ targets: fly, x: deck.x, y: deck.y, angle: -25, scale: 0.5, alpha: 0, duration: 420, ease: 'Cubic.easeIn', onComplete: () => fly.destroy() });
      }
      cards.forEach((c, ci) => {
        const isOpen = c !== null && s.open.includes(c);
        const cx = x + (ci - (cards.length - 1) / 2) * gap;
        const opening = (choosing && !!sent && c === sent.open) || (c !== null && waitingOpen.includes(c));
        const card = playingCard(scene, cx, y, c, w, {
          dim: s.folded || (!!best && !!c && !best.has(c)),
          lift: best ? !!c && best.has(c) : (me && !!c && !isOpen && p.phase !== 'choose') || picking || opening,
        });
        if (opening) label(scene, cx, y - w * 0.98, '공개', clamp(w * 0.22, 13, 20), tc('primary'));
        if (me && c) {
          // 내 카드는 카드마다 따라간다: 버리고 고른 뒤 남은 카드가 새 자리로 미끄러져 간다 (순번으로 따라가면 엉뚱한 카드가 뒤집힌다)
          // 제자리는 deal 전에 잰다 (deal은 날아오는 카드를 덱 자리로 옮겨 놓는다)
          const home = { x: card.x, y: card.y };
          const landAt = t.deal(card, `${s.seat}:c:${c}`, c, deck);
          t.track(card, `pk:${c}`, { at: home, still: landAt > 0 || (choosing && !gone), depth: 0 });
        } else t.deal(card, `${s.seat}:${ci}`, c, deck);
        if (picking && c) {
          card.setSize(w, w * 1.42).setInteractive({ useHandCursor: true });
          card.on('pointerdown', () => pickChoice(t, c));
        }
      });
      // 족보 이름은 화면의 카드와 내 패가 같은 때만 (중간 화면에서 아직 안 받은 카드까지 센 족보가 보이지 않게)
      const handNow = pv && !pv.choices.length && pv.hidden.length === s.hiddenCount && pv.open.length === s.open.length ? pv.hand : null;
      const mineHand = me && !sd && handNow && p.phase !== 'choose' ? `내 패 ${handNow}` : '';
      // 진행 중 내 패 옆 한 줄 힌트: 한 장만 더 오면 되는 족보 ('플러시까지 1장'). 화면의 카드와 내 패가 같은 때만
      const hint = me && !sd && !s.folded && handNow && pv && /^bet[4-6]$/.test(p.phase) ? pokerHint([...pv.hidden, ...pv.open]) : null;
      // 낮은 가로 화면: 내 카드 위 힌트가 가운데 'N구 · 베팅' 글자와 겹친다 → 그때는 이름패 아랫줄에 붙인다
      const hintFs = clamp(w * 0.19, 12, 18);
      const hintY = y - w * 1.02;
      const hintInTag = !!hint && hintY - hintFs * 0.8 < midY + midFs * 0.8;
      const sub = s.excluded ? '이번 판 쉼' : s.folded ? '다이' : [s.last, s.allIn ? '올인' : '', mineHand || (s.openLabel ?? ''), hintInTag ? `💡 ${hint}` : ''].filter(Boolean).join(' · ');
      const k = me ? clamp(cw / 85, 0.85, 1.15) : clamp(cw / 100, 0.75, 1);
      const tagY = y + w * 0.71 + 24 * k;
      nameTag(scene, clamp(x - 52 * k, 26, W - 150 * k), tagY, t.seatName(s.seat), t.seatAvatar(s.seat), { turn: p.turn === s.seat, me, size: k, sub: sub || undefined });
      t.anchor(`seat:${s.seat}`, x, y - w * 0.72);
      // 위쪽 줄 자리: 한마디 말풍선이 카드를 가리지 않게 이름패 아래에 띄운다
      if (!me && (portrait || y < H * 0.3)) t.anchor(`seat-below:${s.seat}`, x, tagY + 22 * k);
      const fs = clamp(w * (me ? 0.2 : 0.28), 12, 22);
      if (s.total) label(scene, x + ((cards.length - 1) / 2) * gap + w * 0.62, y - w * 0.55, `${t.fmt(s.total)}`, fs * 0.85, tc('primary'));
      if (hint && !hintInTag) label(scene, x, hintY, `💡 ${hint}`, hintFs, tc('primary'));
      // 🏆 는 진짜 승자만 (돌려받기만 한 사람은 빼고)
      const won = p.winners.includes(s.seat) && !refunded(t, s.seat);
      if (sd) label(scene, x, y - w * 0.92, `${sd.hand}${won ? ' 🏆' : ''}`, fs, won ? tc('primary') : tc('white'));
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
      if (sent) {
        el.innerHTML = '<p class="msg">카드를 골랐어요. 모두 고르면 공개해요…</p>';
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
      el.querySelector('#undo')?.addEventListener('click', () => ((discard = null), (thrownShown = null), t.redraw()));
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
    // 판 요약 한 줄 ('어흥이의 하프에 2명 다이' · '7구 역전!'): 이번 판의 사건과 결과로 셈한다
    noteEvents(t);
    const w = r.winners[0];
    // 무혈 승리한 사람이 나일 때만 패를 안다 → 원페어 이하였으면 '뻥카'
    const bluff = r.uncontested && w !== undefined && w === t.resultSeat && !!t.priv && !t.priv.choices.length && pokerWeak([...t.priv.hidden, ...t.priv.open]);
    const story = pokerStory({
      events: [...evLog.values()].sort((a, b) => a.id - b.id),
      summary: r,
      showdown: t.pub?.showdown,
      nameOf: (n) => short(names.get(n) ?? t.seatName(n)),
      bluff,
    });
    return `<h3>♠️ 판 결과</h3>${story ? `<p class="story">${esc(story)}</p>` : ''}${satMe}<table>${rows}${sat}</table>`;
  },

  // 판 정리: 모든 카드를 더미로 차례로 모으고 (가까운 카드부터) 판돈 칩을 치운다
  cleanup(t: Ctx) {
    return sweepTable(t.scene, deckPos, { stagger: 40, onStart: (i) => i % 3 === 0 && sfx('deal', { volume: 0.5 }) });
  },

  // 한 동작씩: 내 카드 공개 → 다음 카드 → 다른 사람 베팅 순서로, 앞 동작의 카드 연출이 끝난 뒤에 다음 동작 (판 시작은 예전 방식)
  // (판 시작 묶음은 되돌리지 않는다 → null: 셸이 예전 방식으로 보여 준다)
  rewind: (next, events) => (pokerRoundStart(events) ? null : rewindPoker(next, events, lastPub)),

  // 서버 응답에 행동이 여러 개면 하나씩: 말풍선 + 칩 (AI는 0.8초 간격)
  replay(ev, t: Ctx) {
    // 모두 골랐다: 잠깐 알리고 나서 공개 카드를 뒤집는다
    if (ev.t === 'reveal') return { at: 'pot', text: '카드 공개!', sound: 'cutin', gap: 900 };
    if (typeof ev.seat !== 'number') return null;
    if (ev.t === 'choose') return { at: ev.seat, text: `${short(t.seatName(ev.seat))} 골랐어요`, sound: 'tick', gap: 450 };
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
    // 돌려받은 몫(refund 팟)은 뺀 딴 돈으로만 (돌려받기만 했으면 0)
    if (ev.t === 'win' && typeof ev.amount === 'number' && t.pub && ev.amount - (typeof ev.seat === 'number' ? potRefundOf(ev.seat, (t.pubNext ?? t.pub)?.summary) : 0) >= t.pub.baseUnit * 100) return '대박 판돈!';
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
    sent = { discard: d, open: c };
    sfx('flip');
    void t.act({ type: 'choose', discard: d, open: c }).then((ok) => {
      // 서버가 받지 않았으면 다시 고를 수 있게
      if (!ok) {
        sent = null;
        thrownShown = null;
        t.redraw();
      }
    });
  }
}

function cardText(c: string) {
  const sym: Record<string, string> = { S: '♠', D: '◆', H: '♥', C: '♣' };
  const r = c[0] === 'T' ? '10' : c.slice(0, -1);
  return `${r}${sym[c.slice(-1)] ?? ''}`;
}

void bootGame(ui);
