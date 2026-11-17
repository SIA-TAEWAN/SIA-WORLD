/** 시아맞고 화면: 상대(위) · 바닥(가운데) · 나(아래). 손패를 눌러 내고, 고르기·고/스톱은 아래 버튼 */
import { bootGame, esc, type GameUI, type TableCtx } from '../lib/shell.ts';
import { cardBack, label, nameTag } from '../lib/cards.ts';
import { cardById, type MatgoPrivate, type MatgoPublic, type MatgoSummary } from '../../supabase/functions/_shared/matgo.ts';
import type PhaserNS from 'phaser';

type Ctx = TableCtx<MatgoPublic, MatgoPrivate>;

/** 달마다 바탕색 (임시 그래픽) */
const MONTH_COLOR = [0, 0xe9f2e4, 0xfbe3ea, 0xffe1ec, 0xe6e1f2, 0xe2eefc, 0xfbe8f0, 0xf6e3dc, 0xe8eef6, 0xfff4d6, 0xffe4d2, 0xe9ece0, 0xe2e7ee];
const DAN_COLOR: Record<string, number> = { hong: 0xd0312d, cheong: 0x2d6fd0, cho: 0x2f9e5a };
/** 원래 화투 그림(식물·배경)을 바탕에 연하게: 송학 · 매조 · 벚꽃 · 흑싸리 · 난초 · 모란 · 홍싸리 · 공산 · 국화 · 단풍 · 오동 · 비 */
const PLANT = ['', '🌲', '🌸', '🌸', '🌿', '🌾', '🌺', '🍂', '🌕', '🌼', '🍁', '🍃', '☔'];

/** 화투 한 장 (id가 null이면 뒷면). 가운데 기준 */
function hwatu(scene: PhaserNS.Scene, x: number, y: number, id: string | null, w: number, opts: { lift?: boolean; glow?: boolean; onClick?: () => void } = {}) {
  const h = Math.round(w * 1.55);
  const c = scene.add.container(x, y - (opts.lift ? 8 : 0));
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillRoundedRect(-w / 2 + 2, -h / 2 + 3, w, h, 5);
  if (!id) {
    c.add(g);
    c.add(scene.add.image(0, 0, cardBack(scene, 'back-red')).setDisplaySize(w, h));
    return c;
  }
  const card = cardById(id);
  g.fillStyle(MONTH_COLOR[card.month], 1).fillRoundedRect(-w / 2, -h / 2, w, h, 5);
  if (card.kind === 'gwang') g.lineStyle(3, 0xd9a521, 1).strokeRoundedRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 5);
  else g.lineStyle(1.5, 0x444444, 0.7).strokeRoundedRect(-w / 2, -h / 2, w, h, 5);
  if (opts.glow) g.lineStyle(3, 0xffd23a, 1).strokeRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 7);
  if (card.kind === 'tti') {
    const col = card.dan ? DAN_COLOR[card.dan] : 0x8a8a8a;
    g.fillStyle(col, 1).fillRect(-w * 0.12, -h * 0.28, w * 0.24, h * 0.62);
  }
  c.add(g);
  c.add(scene.add.text(0, -h * 0.05, PLANT[card.month], { fontFamily: 'sans-serif', fontSize: `${Math.round(w * 0.7)}px` }).setOrigin(0.5).setAlpha(0.22));
  const fs = Math.max(9, Math.round(w * 0.22));
  c.add(scene.add.text(-w / 2 + 3, -h / 2 + 2, `${card.month}월`, { fontFamily: 'Jua, sans-serif', fontSize: `${fs}px`, color: '#3a2a1e' }));
  const key = `av-${['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'][card.month - 1]}`;
  if (card.kind !== 'pi' && scene.textures.exists(key)) {
    const img = scene.add.image(0, h * 0.08, key);
    img.setScale(((card.kind === 'yeol' || card.kind === 'gwang' ? 0.78 : 0.5) * w) / Math.max(img.width, img.height));
    if (card.kind === 'tti') img.setAlpha(0.55);
    c.add(img);
  }
  let tag = '';
  if (card.kind === 'gwang') tag = card.bigwang ? '비광' : '광';
  else if (card.kind === 'pi') tag = card.ssangpi ? '🐾🐾' : '🐾';
  else if (card.godori) tag = '고도리';
  else if (card.gukjin) tag = '국진';
  else if (card.kind === 'tti') tag = card.dan === 'hong' ? '홍단' : card.dan === 'cheong' ? '청단' : card.dan === 'cho' ? '초단' : '띠';
  if (tag)
    c.add(
      scene.add
        .text(0, h / 2 - 3, tag, { fontFamily: 'Jua, sans-serif', fontSize: `${Math.max(9, Math.round(w * (tag.length > 2 ? 0.2 : 0.26)))}px`, color: card.kind === 'gwang' ? '#b07c00' : '#3a2a1e' })
        .setOrigin(0.5, 1),
    );
  if (opts.onClick) {
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerdown', opts.onClick);
  }
  return c;
}

/** 먹은 패 (광·열끗·띠·피) 작게 겹쳐서 */
function captured(scene: PhaserNS.Scene, x: number, y: number, p: MatgoPublic['players'][number], w: number) {
  const groups: [string, string[]][] = [
    ['광', p.captured.gwang],
    ['열끗', p.captured.yeol],
    ['띠', p.captured.tti],
    ['피', p.captured.pi],
  ].filter((g): g is [string, string[]] => g[1].length > 0) as [string, string[]][];
  // 먹은 패가 많아도 화면 안에 들어오게 겹침 간격을 줄인다
  const avail = scene.scale.width - x - 10;
  const fixed = groups.length * w * 1.4;
  const extra = groups.reduce((a, [, ids]) => a + ids.length - 1, 0);
  const step = Math.min(w * 0.32, extra ? Math.max(3, (avail - fixed) / extra) : w * 0.32);
  let cx = x;
  for (const [name, ids] of groups) {
    ids.forEach((id, i) => hwatu(scene, cx + i * step, y, id, w));
    const gw = w + (ids.length - 1) * step;
    label(scene, cx - w / 2 + gw / 2, y + w * 0.95, `${name} ${name === '피' ? p.piCount : ids.length}`, 14, name === '띠' ? '#ffc9c9' : '#ffe9a8');
    cx += gw + w * 0.4;
  }
}

let shake = false;
/** 5광 컷인을 이미 보여 준 판:자리 */
const fiveGwang = new Set<string>();

const ui: GameUI<MatgoPublic, MatgoPrivate> = {
  game: 'matgo',
  title: '시아맞고',
  icon: '🎴',
  back: '',
  backLabel: 'SIA WORLD',
  felt: 0x6b3a1d,

  draw(t: Ctx) {
    const { scene } = t;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const p = t.pub;
    if (!p) {
      label(scene, W / 2, H / 2, '모두 레디하면 시작해요', 22);
      return;
    }
    const cw = Math.max(26, Math.min(50, W / 15, H / 9.5));
    const me = t.mySeat ?? p.seats[0];
    const opp = p.seats.find((s) => s !== me) ?? p.seats[1];
    const P = p.players;

    // 상대
    const op = P[opp];
    nameTag(scene, 28, 24, t.seatName(opp), t.seatAvatar(opp), { turn: p.turn === opp, sub: `${op.score}점${op.go ? ` · ${op.go}고` : ''}${op.shakes ? ` · 흔들${op.shakes}` : ''}` });
    for (let i = 0; i < op.handCount; i++) hwatu(scene, W * 0.42 + i * cw * 0.42, 30, null, cw * 0.6);
    captured(scene, 40, H * 0.2, op, cw * 0.7);

    // 바닥 (달별로 모아서)
    const floor = p.floor;
    const cols = Math.max(4, Math.ceil(floor.length / 2));
    floor.forEach((f, i) => {
      const row = i < cols ? 0 : 1;
      const col = row === 0 ? i : i - cols;
      const x = W * 0.18 + (col + 0.5) * ((W * 0.64) / cols);
      const y = H * 0.4 + row * cw * 1.75;
      f.cards.forEach((id, k) => hwatu(scene, x + k * cw * 0.22, y + k * 4, id, cw, { glow: p.choice?.kind === 'choose' && p.choice.options.includes(id) }));
      if (f.ppeok || f.stacked) label(scene, x, y - cw * 0.95, f.ppeok ? '뻑' : '쌓임', 13, '#ffb4b4');
    });
    // 더미
    hwatu(scene, W * 0.09, H * 0.47, null, cw);
    label(scene, W * 0.09, H * 0.47 + cw * 1.05, `더미 ${p.pileCount}`, 12);
    if (p.turnCards) {
      const tc = [...p.turnCards.played, ...(p.turnCards.flipped ? [p.turnCards.flipped] : [])];
      tc.forEach((id, i) => hwatu(scene, W * 0.91 - i * cw * 0.5, H * 0.47, id, cw * 0.8));
      label(scene, W * 0.91, H * 0.47 + cw * 1.05, '이번 차례', 12);
    }
    if (p.nagariMul > 1) label(scene, W / 2, H * 0.31, `나가리 ×${p.nagariMul}`, 15, '#ffe066');

    // 나
    const mp = P[me];
    captured(scene, 40, H * 0.69, mp, cw * 0.7);
    nameTag(scene, 28, H - 26, t.seatName(me), t.seatAvatar(me), { turn: p.turn === me, me: t.mySeat === me, sub: `${mp.score}점${mp.go ? ` · ${mp.go}고` : ''}${mp.bombFill ? ` · 폭탄피 ${mp.bombFill}` : ''}` });
    const hand = t.priv?.hand ?? [];
    const canPlay = t.myTurn && p.choice?.kind === 'play';
    const hx0 = W * 0.3;
    const step = Math.min(cw * 1.08, (W * 0.68) / Math.max(1, hand.length));
    hand.forEach((id, i) =>
      hwatu(scene, hx0 + i * step, H - cw * 1.0, id, cw, {
        lift: canPlay,
        onClick: canPlay && !t.busy ? () => void t.act({ type: 'play', card: id, shake: shake && !!t.priv?.shakeable.includes(cardById(id).month) }) : undefined,
      }),
    );
  },

  controls(t: Ctx, el: HTMLElement) {
    const p = t.pub;
    if (!p || t.mySeat === null) return;
    const c = p.choice;
    if (!t.myTurn || !c) {
      el.innerHTML = `<p class="msg">${p.turn !== null ? `${esc(t.seatName(p.turn))} 차례…` : ''}</p>`;
      return;
    }
    const dis = t.busy ? 'disabled' : '';
    if (c.kind === 'play') {
      const pv = t.priv;
      const shakeable = pv?.shakeable ?? [];
      const bombs = pv?.bombable ?? [];
      el.innerHTML = `<div class="row">
        ${shakeable.length ? `<label class="btn"><input type="checkbox" id="shake" ${shake ? 'checked' : ''}/> 흔들기 (${shakeable.map((m) => `${m}월`).join(', ')})</label>` : ''}
        ${bombs.map((m) => `<button class="btn primary" data-bomb="${m}" ${dis}>💣 ${m}월 폭탄</button>`).join('')}
        ${c.canFlip ? `<button class="btn" id="flip" ${dis}>더미 뒤집기 (폭탄 피)</button>` : ''}
      </div><p class="msg">낼 패를 누르세요 · 20초가 지나면 자동으로 내요</p>`;
      el.querySelector<HTMLInputElement>('#shake')?.addEventListener('change', (e) => (shake = (e.target as HTMLInputElement).checked));
      el.querySelectorAll<HTMLButtonElement>('[data-bomb]').forEach((b) => b.addEventListener('click', () => void t.act({ type: 'bomb', month: Number(b.dataset.bomb) })));
      el.querySelector('#flip')?.addEventListener('click', () => void t.act({ type: 'flip' }));
      return;
    }
    shake = false;
    if (c.kind === 'choose') {
      el.innerHTML = `<p class="msg">${c.stage === 'flip' ? '뒤집은 패로' : '낸 패로'} 가져올 패를 고르세요</p><div class="row">${c.options
        .map((id) => `<button class="btn big" data-c="${id}" ${dis}>${esc(cardById(id).name)}</button>`)
        .join('')}</div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.addEventListener('click', () => void t.act({ type: 'choose', card: b.dataset.c })));
      return;
    }
    if (c.kind === 'gukjin') {
      el.innerHTML = `<p class="msg">국진(9월 열끗)을 어떻게 쓸까요?</p><div class="row">
        <button class="btn big" data-g="yeol" ${dis}>열끗으로</button><button class="btn big primary" data-g="ssangpi" ${dis}>쌍피로</button></div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) => b.addEventListener('click', () => void t.act({ type: 'gukjin', as: b.dataset.g })));
      return;
    }
    if (c.kind === 'goStop') {
      el.innerHTML = `<p class="msg">${c.score}점! 고 할까요, 스톱 할까요? (지금 ${c.go}고)</p><div class="row">
        <button class="btn big primary" id="go" ${dis}>고!</button><button class="btn big" id="stop" ${dis}>스톱</button></div>`;
      el.querySelector('#go')!.addEventListener('click', () => void t.act({ type: 'go' }));
      el.querySelector('#stop')!.addEventListener('click', () => void t.act({ type: 'stop' }));
    }
  },

  resultHtml(t: Ctx) {
    const r = (t.pub as unknown as { result?: MatgoSummary })?.result;
    if (!r) return '<p>판이 끝났어요</p>';
    if (r.result === 'nagari') return `<h3>🎴 나가리!</h3><p class="big">다음 판 ×${r.nextNagari}</p>`;
    const meWin = r.winner === t.resultSeat;
    const name = (seat: number) => t.pub?.players[seat]?.name ?? t.seatName(seat);
    const lines = r.breakdown.map((l) => `<tr><td>${esc(l.label)}</td><td>${l.points}점</td></tr>`).join('');
    const meLose = r.loser === t.resultSeat;
    return `<h3>🎴 ${esc(name(r.winner!))} 승리${r.chongtong ? ' (총통)' : ''}</h3>
      <p class="big ${meWin ? 'plus' : meLose ? 'minus' : ''}">${meWin ? '+' : meLose ? '-' : ''}${t.fmt(r.paid)}냥</p>
      <table>${lines}
        ${r.goCount ? `<tr><td>${r.goCount}고</td><td>+${r.goBonus}${r.goMultiplier > 1 ? ` ×${r.goMultiplier}` : ''}</td></tr>` : ''}
        <tr><td>최종 점수</td><td>${r.score}점</td></tr>
        ${r.multipliers.length ? `<tr><td>배수</td><td>${r.multipliers.map(esc).join(' · ')} (×${r.multiplier})</td></tr>` : ''}
        <tr><td>점당</td><td>${t.fmt(r.baseUnit)}냥</td></tr>
        <tr><td>계산</td><td>${t.fmt(r.amount)}냥${r.paid < r.amount ? ` → 가진 만큼 ${t.fmt(r.paid)}냥` : ''}</td></tr>
      </table>`;
  },

  cutin(ev, t: Ctx) {
    const mine = ev.seat === t.mySeat;
    switch (ev.t) {
      case 'go':
        return `${ev.count ?? ''}고!`;
      case 'stop':
        return '스톱!';
      case 'pibak':
        return '피박!';
      case 'gwangbak':
        return '광박!';
      case 'meongbak':
        return '멍박!';
      case 'gobak':
        return '고박!';
      case 'chongtong':
        return '총통!';
      case 'bomb':
        return '폭탄!';
      case 'shake':
        return '흔들기!';
      case 'ppeok':
        return mine ? '뻑!' : null;
      case 'nagari':
        return '나가리';
      default: {
        // 5광: 광이 5장이 된 그 순간만 (자리마다 한 번)
        if (ev.t !== 'capture' || typeof ev.seat !== 'number' || !t.pub) return null;
        const n = t.pub.players[ev.seat]?.captured.gwang.length ?? 0;
        const key = `${(t.pub as unknown as { round?: number }).round ?? 0}:${ev.seat}`;
        if (n === 5 && !fiveGwang.has(key)) {
          fiveGwang.add(key);
          return '5광!';
        }
        return null;
      }
    }
  },
};

void bootGame(ui);
