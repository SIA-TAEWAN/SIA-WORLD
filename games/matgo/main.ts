/** 시아맞고 화면: 상대(위) · 바닥(가운데) · 나(아래). 손패를 눌러 내고, 고르기·고/스톱은 아래 버튼 */
import { bootGame, esc, type GameUI, type TableCtx } from '../lib/shell.ts';
import { C, FONT, cardBack, clamp, drawTable, label, nameTag } from '../lib/cards.ts';
import { cardById, type MatgoPrivate, type MatgoPublic, type MatgoSummary } from '../../supabase/functions/_shared/matgo.ts';
import type PhaserNS from 'phaser';

type Ctx = TableCtx<MatgoPublic, MatgoPrivate>;

/** 계절 색 (단청): 봄 1~3월 녹청 · 여름 4~6월 주홍 · 가을 7~9월 황 · 겨울 10~12월 감청 */
const SEASON = [0, 0x2f8f83, 0x2f8f83, 0x2f8f83, 0xd9452f, 0xd9452f, 0xd9452f, 0xc9932a, 0xc9932a, 0xc9932a, 0x3b5ba5, 0x3b5ba5, 0x3b5ba5];
const DAN_COLOR: Record<string, number> = { hong: 0xc8372d, cheong: 0x2d5fb8, cho: 0x2f8f53 };
const DAN_NAME: Record<string, string> = { hong: '홍단', cheong: '청단', cho: '초단' };
/** 원래 화투 그림(식물·배경)을 바탕에 연하게: 송학 · 매조 · 벚꽃 · 흑싸리 · 난초 · 모란 · 홍싸리 · 공산 · 국화 · 단풍 · 오동 · 비 */
const PLANT = ['', '🌲', '🌸', '🌸', '🌿', '🌾', '🌺', '🍂', '🌕', '🌼', '🍁', '🍃', '☔'];
const ANIMAL_KEY = ['', 'rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];

/**
 * 화투 한 장 (id가 null이면 뒷면). 가운데 기준.
 * 한지색 바탕 + 검은 테두리(진짜 화투처럼) · 왼쪽 위 달 표시(계절 색) · 광은 금테와 光 · 띠는 단 색 리본 · 피는 발자국
 */
function hwatu(scene: PhaserNS.Scene, x: number, y: number, id: string | null, w: number, opts: { lift?: boolean; glow?: boolean; onClick?: () => void } = {}) {
  const h = Math.round(w * 1.55);
  const r = Math.max(3, w * 0.08);
  const c = scene.add.container(x, y - (opts.lift ? w * 0.14 : 0));
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.32).fillRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, r);
  if (opts.glow) g.lineStyle(Math.max(3, w * 0.07), C.gold, 1).strokeRoundedRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, r + 3);
  if (!id) {
    c.add(g);
    c.add(scene.add.image(0, 0, cardBack(scene, 'back-hwatu')).setDisplaySize(w, h));
    return c;
  }
  const card = cardById(id);
  g.fillStyle(0x1d1a18, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
  const b = Math.max(1.5, w * 0.045);
  g.fillStyle(0xfbf5e6, 1).fillRoundedRect(-w / 2 + b, -h / 2 + b, w - b * 2, h - b * 2, r * 0.7);
  if (card.kind === 'gwang') g.lineStyle(Math.max(2, w * 0.05), C.gold, 1).strokeRoundedRect(-w / 2 + b * 1.6, -h / 2 + b * 1.6, w - b * 3.2, h - b * 3.2, r * 0.5);
  c.add(g);
  // 식물 (원래 화투 그림)
  c.add(scene.add.text(0, h * 0.04, PLANT[card.month], { fontFamily: 'sans-serif', fontSize: `${Math.round(w * 0.78)}px` }).setOrigin(0.5).setAlpha(0.2));
  const g2 = scene.add.graphics();
  c.add(g2);
  // 띠: 단 색 리본
  if (card.kind === 'tti') {
    const col = card.dan ? DAN_COLOR[card.dan] : 0x8a8178;
    g2.fillStyle(col, 1).fillRect(-w * 0.13, -h * 0.3, w * 0.26, h * 0.6);
    g2.fillStyle(0xffffff, 0.25).fillRect(-w * 0.13, -h * 0.3, w * 0.05, h * 0.6);
    if (card.dan) {
      const t = scene.add.text(0, 0, DAN_NAME[card.dan].split('').join('\n'), { fontFamily: FONT, fontSize: `${Math.round(w * 0.17)}px`, color: '#fff6e5', align: 'center', lineSpacing: -w * 0.04 }).setOrigin(0.5);
      c.add(t);
    }
  }
  // 동물 (광·열끗은 크게, 띠는 작게 위쪽, 피는 없음)
  const key = `av-${ANIMAL_KEY[card.month]}`;
  if (card.kind !== 'pi' && scene.textures.exists(key)) {
    const big = card.kind === 'yeol' || card.kind === 'gwang';
    const img = scene.add.image(card.kind === 'tti' ? w * 0.27 : 0, card.kind === 'tti' ? -h * 0.3 : h * 0.06, key);
    img.setScale(((big ? 0.82 : 0.36) * w) / Math.max(img.width, img.height));
    c.add(img);
  }
  // 달 표시 (왼쪽 위 계절 색 동그라미)
  const mr = Math.max(6, w * 0.15);
  g2.fillStyle(SEASON[card.month], 1).fillCircle(-w / 2 + b + mr * 1.05, -h / 2 + b + mr * 1.05, mr);
  c.add(scene.add.text(-w / 2 + b + mr * 1.05, -h / 2 + b + mr * 1.05, `${card.month}`, { fontFamily: FONT, fontSize: `${Math.round(mr * 1.25)}px`, color: '#fff6e5' }).setOrigin(0.5));
  // 광: 오른쪽 위 붉은 원 안의 光
  if (card.kind === 'gwang') {
    const gx = w / 2 - b - mr * 1.05;
    const gy = -h / 2 + b + mr * 1.05;
    g2.fillStyle(C.red, 1).fillCircle(gx, gy, mr);
    g2.lineStyle(1.5, C.gold, 1).strokeCircle(gx, gy, mr);
    c.add(scene.add.text(gx, gy, card.bigwang ? '雨' : '光', { fontFamily: 'serif', fontSize: `${Math.round(mr * 1.2)}px`, color: '#fff6e5' }).setOrigin(0.5));
  }
  // 아래 표시: 피 발자국 / 고도리 / 국진
  let tag = '';
  if (card.kind === 'pi') tag = card.ssangpi ? '🐾🐾' : '🐾';
  else if (card.godori) tag = '고도리';
  else if (card.gukjin) tag = '국진';
  if (tag) {
    const pi = card.kind === 'pi';
    c.add(
      scene.add
        .text(0, pi ? h * 0.08 : h / 2 - b * 1.6, tag, {
          fontFamily: FONT,
          fontSize: `${Math.round(w * (pi ? 0.3 : 0.19))}px`,
          color: '#3a2a1e',
          backgroundColor: pi ? undefined : '#f2c14e',
          padding: pi ? undefined : { x: 3, y: 0 },
        })
        .setOrigin(0.5, pi ? 0.5 : 1),
    );
  }
  if (opts.onClick) {
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerdown', opts.onClick);
  }
  return c;
}

/** 먹은 패 (광·열끗·띠·피) 겹쳐서. maxX까지 들어오게 간격을 줄인다 */
function captured(scene: PhaserNS.Scene, x: number, y: number, p: MatgoPublic['players'][number], w: number, maxX: number) {
  const groups = (
    [
      ['광', p.captured.gwang],
      ['열끗', p.captured.yeol],
      ['띠', p.captured.tti],
      ['피', p.captured.pi],
    ] as [string, string[]][]
  ).filter((g) => g[1].length > 0);
  const avail = maxX - x;
  const fixed = groups.length * w * 1.35;
  const extra = groups.reduce((a, [, ids]) => a + ids.length - 1, 0);
  const step = Math.min(w * 0.36, extra ? Math.max(3, (avail - fixed) / extra) : w * 0.36);
  let cx = x;
  for (const [name, ids] of groups) {
    ids.forEach((id, i) => hwatu(scene, cx + i * step, y, id, w));
    const gw = w + (ids.length - 1) * step;
    label(scene, cx - w / 2 + gw / 2, y + w * 1.0, `${name} ${name === '피' ? p.piCount : ids.length}`, clamp(w * 0.32, 12, 18), name === '띠' ? '#ffd2c8' : '#f7d77a');
    cx += gw + w * 0.35;
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
  felt: 0x56603a,

  draw(t: Ctx) {
    const { scene } = t;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const p = t.pub;
    drawTable(scene, 'blanket');
    if (!p) {
      label(scene, W / 2, H / 2, '모두 레디하면 시작해요', clamp(Math.min(W, H) * 0.05, 18, 30));
      return;
    }
    // 세로 화면: 손패 두 줄, 바닥 세 줄
    const portrait = H > W * 1.15;
    // 카드 크기: 화면 비율에 맞춰 (손패 기준). 바닥 0.86배(세로 0.8배), 먹은 패 0.5배
    const cw = portrait ? clamp(Math.min(W / 6.4, H / 11), 30, 90) : clamp(Math.min(W / 11.5, H / 7), 30, 96);
    const fw = cw * (portrait ? 0.8 : 0.86);
    const capW = cw * 0.5;
    const me = t.mySeat ?? p.seats[0];
    const opp = p.seats.find((s) => s !== me) ?? p.seats[1];
    const P = p.players;
    const k = clamp(cw / 75, 0.8, 1.2);

    // 상대: 이름패 · 손패(뒷면) · 먹은 패
    const op = P[opp];
    nameTag(scene, 26 * k, 26 * k, t.seatName(opp), t.seatAvatar(opp), {
      turn: p.turn === opp,
      size: k,
      sub: `${op.score}점${op.go ? ` · ${op.go}고` : ''}${op.shakes ? ` · 흔들${op.shakes}` : ''}`,
    });
    const bw = cw * 0.42;
    for (let i = 0; i < op.handCount; i++) hwatu(scene, W * 0.45 + (i - (op.handCount - 1) / 2) * bw * 0.55, bw * 0.8 + 4, null, bw);
    captured(scene, 24 + capW / 2, portrait ? H * 0.13 : H * 0.19, op, capW, W - 16);

    // 바닥 (달별로 모아서, 두 줄)
    const floor = p.floor;
    const nRows = portrait ? 3 : 2;
    const cols = Math.max(4, Math.ceil(floor.length / nRows));
    const left = portrait ? W * 0.04 : W * 0.17;
    const right = portrait ? W * 0.96 : W * 0.83;
    const rowGap = fw * 1.68;
    const y0 = portrait ? H * 0.255 : H * 0.355;
    floor.forEach((f, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = left + (col + 0.5) * ((right - left) / cols) - fw * 0.1;
      const y = y0 + row * rowGap;
      f.cards.forEach((id, j) => hwatu(scene, x + j * fw * 0.2, y + j * 4, id, fw, { glow: p.choice?.kind === 'choose' && p.choice.options.includes(id) }));
      if (f.ppeok || f.stacked) label(scene, x, y - fw * 0.95, f.ppeok ? '뻑' : '쌓임', clamp(fw * 0.26, 12, 20), '#ffd2c8');
    });
    // 더미 (왼쪽)
    // 세로 화면: 더미는 오른쪽 위 (상대 손패 옆), 가로: 바닥 왼쪽
    const pile = portrait ? { x: W - fw * 0.8, y: fw * 0.85 + 6 } : { x: W * 0.075, y: y0 + rowGap * 0.5 };
    for (let i = 0; i < 3; i++) hwatu(scene, pile.x + i * 2, pile.y - i * 2, null, fw);
    label(scene, pile.x, pile.y + fw * 1.0, `더미 ${p.pileCount}`, clamp(fw * 0.22, 12, 18));
    // 이번 차례에 낸 패·뒤집은 패 (오른쪽)
    if (p.turnCards) {
      const tc = [...p.turnCards.played, ...(p.turnCards.flipped ? [p.turnCards.flipped] : [])];
      const tx = portrait ? W - fw * 2.1 : W * 0.925;
      tc.forEach((id, i) => hwatu(scene, tx - i * fw * 0.45, pile.y, id, fw * 0.85));
      label(scene, tx, pile.y + fw * 1.0, '이번 차례', clamp(fw * 0.22, 12, 18));
    }
    if (p.nagariMul > 1) label(scene, W / 2, y0 - fw * 1.05, `나가리 ×${p.nagariMul}`, clamp(fw * 0.3, 14, 22), '#f7d77a');

    // 나: 먹은 패 · 이름패 · 손패
    const mp = P[me];
    captured(scene, 24 + capW / 2, portrait ? H - cw * 3.55 : H * 0.685, mp, capW, W - 16);
    nameTag(scene, 26 * k, H - 28 * k, t.seatName(me), t.seatAvatar(me), {
      turn: p.turn === me,
      me: t.mySeat === me,
      size: k,
      sub: `${mp.score}점${mp.go ? ` · ${mp.go}고` : ''}${mp.bombFill ? ` · 폭탄피 ${mp.bombFill}` : ''}`,
    });
    const hand = t.priv?.hand ?? [];
    const canPlay = t.myTurn && p.choice?.kind === 'play';
    // 가로: 한 줄 (이름패 오른쪽부터) / 세로: 다섯 장씩 두 줄 (이름패 위)
    const perRow = portrait ? 5 : hand.length;
    const hx0 = portrait ? W / 2 - (Math.min(perRow, hand.length) - 1) * cw * 0.53 : Math.max(W * 0.27, 190 * k);
    const step = portrait ? cw * 1.06 : Math.min(cw * 1.06, (W - hx0 - cw * 0.6) / Math.max(1, hand.length - 1));
    const handY = (i: number) => (portrait ? H - cw * 0.86 - 46 * k - (Math.floor(i / perRow) === 0 ? cw * 1.62 : 0) : H - cw * 0.86);
    hand.forEach((id, i) =>
      hwatu(scene, hx0 + (i % perRow) * step, handY(i), id, cw, {
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
        <button class="btn big primary" id="go" ${dis}>고!</button><button class="btn big alt" id="stop" ${dis}>스톱</button></div>`;
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
