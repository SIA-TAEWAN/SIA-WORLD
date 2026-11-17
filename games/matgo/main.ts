/** 시아맞고 화면: 상대(위) · 바닥(가운데) · 나(아래). 손패를 눌러 내고, 고르기·고/스톱은 아래 버튼 */
import { bootGame, esc, type GameUI, type TableCtx } from '../lib/shell.ts';
import { worldRoot } from '../lib/world.ts';
import { cardBack, clamp, drawTable, label, nameTag, tc, theme } from '../lib/cards.ts';
import { cardById, type MatgoPrivate, type MatgoPublic, type MatgoSummary } from '../../supabase/functions/_shared/matgo.ts';
import type PhaserNS from 'phaser';

type Ctx = TableCtx<MatgoPublic, MatgoPrivate>;

const DAN_NAME: Record<string, string> = { hong: '홍단', cheong: '청단', cho: '초단' };
/** 원래 화투 그림(식물·배경): SpriteCook으로 그린 12달 식물 (shared/images/hwatu/plant-MM.png) */
const plantKey = (m: number) => `plant-${String(m).padStart(2, '0')}`;
const plantUrl = (m: number) => new URL(`shared/images/hwatu/${plantKey(m)}.png`, worldRoot()).href;
const ANIMAL_KEY = ['', 'rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];

/**
 * 화투 한 장 (id가 null이면 뒷면). 가운데 기준. DESIGN.md 7장:
 * 크림 바탕, 모서리 8px(가로 60px 기준), 외곽선 2px · 광: --accent 테두리 + '광' 도장 · 띠: 홍·청·초단 색 띠 · 열끗: 캐릭터 크게 · 피: 발자국
 */
function hwatu(scene: PhaserNS.Scene, x: number, y: number, id: string | null, w: number, opts: { lift?: boolean; glow?: boolean; onClick?: () => void } = {}) {
  const T = theme();
  const C = T.COLOR;
  const h = Math.round(w * 1.55);
  const r = Math.max(4, (T.SHAPE.radiusHwatu * w) / 60);
  const line = Math.max(T.SHAPE.lineThin, w * 0.03);
  const depth = Math.max(2, w * 0.045);
  const c = scene.add.container(x, y - (opts.lift ? w * 0.14 : 0));
  const g = scene.add.graphics();
  // 고를 수 있는 패: 노란 테두리로 강조
  if (opts.glow) {
    g.fillStyle(C.primary, 1).fillRoundedRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10 + depth, r + 4);
    g.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeRoundedRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10 + depth, r + 4);
  }
  g.fillStyle(C.outline, 1).fillRoundedRect(-w / 2, -h / 2 + depth, w, h, r);
  c.add(g);
  if (!id) {
    c.add(scene.add.image(0, 0, cardBack(scene, 'back-hwatu')).setDisplaySize(w, h));
    return c;
  }
  const card = cardById(id);
  g.fillStyle(C.panel, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
  g.lineStyle(line, C.outline, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  // 광: 금색 안쪽 테두리
  if (card.kind === 'gwang') g.lineStyle(Math.max(2.5, w * 0.05), C.accent, 1).strokeRoundedRect(-w / 2 + line * 1.8, -h / 2 + line * 1.8, w - line * 3.6, h - line * 3.6, r * 0.6);
  // 원래 화투 식물: 피는 식물이 주인공(진하게), 나머지는 캐릭터 뒤에 연하게
  if (scene.textures.exists(plantKey(card.month))) {
    const pl = scene.add.image(0, h * 0.04, plantKey(card.month));
    pl.setScale(Math.min((w * 0.86) / pl.width, (h * 0.8) / pl.height));
    pl.setAlpha(card.kind === 'pi' ? 0.95 : 0.4);
    c.add(pl);
  }
  const g2 = scene.add.graphics();
  c.add(g2);
  // 띠: 단 색 리본 (외곽선)
  if (card.kind === 'tti') {
    const col = card.dan ? T.HWATU[card.dan] : T.HWATU.plain;
    g2.fillStyle(col, 1).fillRect(-w * 0.13, -h * 0.3, w * 0.26, h * 0.6);
    g2.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeRect(-w * 0.13, -h * 0.3, w * 0.26, h * 0.6);
    if (card.dan) {
      c.add(
        scene.add
          .text(0, 0, DAN_NAME[card.dan].split('').join('\n'), { fontFamily: T.FONT, fontSize: `${Math.round(w * 0.17)}px`, color: tc('white'), align: 'center', lineSpacing: -w * 0.04 })
          .setOrigin(0.5),
      );
    }
  }
  // 캐릭터: 광·열끗은 크게, 띠는 작게 위쪽, 피는 없음
  const big = card.kind === 'yeol' || card.kind === 'gwang';
  const key = big ? `full-${ANIMAL_KEY[card.month]}` : `av-${ANIMAL_KEY[card.month]}`;
  if (card.kind !== 'pi' && scene.textures.exists(key)) {
    const img = scene.add.image(card.kind === 'tti' ? w * 0.26 : 0, card.kind === 'tti' ? -h * 0.3 : h * 0.08, key);
    if (big) img.setScale(Math.min((w * 0.8) / img.width, (h * 0.62) / img.height));
    else img.setScale((w * 0.36) / Math.max(img.width, img.height));
    c.add(img);
  }
  // 달: 왼쪽 위 키 배지 (바탕 --outline, 흰 숫자)
  const bw = Math.max(13, w * 0.28);
  const bh = Math.max(12, w * 0.24);
  const bx = -w / 2 + line + 2;
  const by = -h / 2 + line + 2;
  g2.fillStyle(C.outline, 1).fillRoundedRect(bx, by, bw, bh, Math.max(3, (T.SHAPE.radiusKey * w) / 60));
  c.add(scene.add.text(bx + bw / 2, by + bh / 2, `${card.month}`, { fontFamily: T.FONT, fontSize: `${Math.round(bh * 0.8)}px`, color: tc('white') }).setOrigin(0.5));
  // 광 도장: 오른쪽 위 둥근 도장 '광' (비광은 '비')
  if (card.kind === 'gwang') {
    const sr = Math.max(7, w * 0.15);
    const sx = w / 2 - line - sr - 2;
    const sy = -h / 2 + line + sr + 2;
    g2.fillStyle(C.cardRed, 1).fillCircle(sx, sy, sr);
    g2.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeCircle(sx, sy, sr);
    c.add(scene.add.text(sx, sy, card.bigwang ? '비' : '광', { fontFamily: T.FONT, fontSize: `${Math.round(sr * 1.15)}px`, color: tc('white') }).setOrigin(0.5));
  }
  // 아래: 피 발자국 / 고도리·국진 태그
  if (card.kind === 'pi') {
    c.add(scene.add.text(0, h / 2 - line - 2, card.ssangpi ? '🐾🐾' : '🐾', { fontFamily: 'sans-serif', fontSize: `${Math.round(w * 0.24)}px` }).setOrigin(0.5, 1));
  } else if (card.godori || card.gukjin) {
    const t = scene.add
      .text(0, h / 2 - line - 2, card.godori ? '고도리' : '국진', {
        fontFamily: T.FONT,
        fontSize: `${Math.round(w * 0.18)}px`,
        color: tc('white'),
        backgroundColor: tc('pink'),
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 1);
    c.add(t);
  }
  if (opts.onClick) {
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerdown', opts.onClick);
  }
  return c;
}

/** 먹은 패 (광·열끗·띠·피) 겹쳐서. maxX까지 들어오게 간격을 줄인다 */
function captured(t: Ctx, scene: PhaserNS.Scene, x: number, y: number, p: MatgoPublic['players'][number], w: number, maxX: number) {
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
  // 겹친 패가 더 보이게: 기본 간격을 넓히고, 화면이 모자랄 때만 줄인다
  const step = Math.min(w * 0.58, extra ? Math.max(3, (avail - fixed) / extra) : w * 0.58);
  let cx = x;
  for (const [name, ids] of groups) {
    ids.forEach((id, i) => t.track(hwatu(scene, cx + i * step, y, id, w), id, { order: 2 }));
    const gw = w + (ids.length - 1) * step;
    label(scene, cx - w / 2 + gw / 2, y + w * 1.0, `${name} ${name === '피' ? p.piCount : ids.length}`, clamp(w * 0.32, 12, 18), tc('primary'));
    cx += gw + w * 0.35;
  }
}

/** 고르기 버튼에 넣는 작은 화투 (HTML 그림) */
function miniCard(id: string) {
  const card = cardById(id);
  const animal = ANIMAL_KEY[card.month];
  const big = card.kind === 'yeol' || card.kind === 'gwang';
  const char = card.kind === 'pi' ? '' : `<img class="ch ${big ? 'big' : 'small'}" src="${new URL(`shared/images/zodiac/${big ? 'full' : 'face'}/${animal}.png`, worldRoot()).href}" alt=""/>`;
  const tti = card.kind === 'tti' ? `<i class="tti ${card.dan ?? 'plain'}">${card.dan ? DAN_NAME[card.dan] : ''}</i>` : '';
  const tag = card.kind === 'gwang' ? `<b class="stamp">${card.bigwang ? '비' : '광'}</b>` : '';
  const foot = card.kind === 'pi' ? `<em>${card.ssangpi ? '🐾🐾' : '🐾'}</em>` : card.godori ? '<em class="tag">고도리</em>' : card.gukjin ? '<em class="tag">국진</em>' : '';
  return `<span class="hw ${card.kind}"><img class="pl ${card.kind === 'pi' ? 'strong' : ''}" src="${plantUrl(card.month)}" alt=""/>${tti}${char}<u>${card.month}</u>${tag}${foot}</span>`;
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
  felt: () => theme().COLOR.skyMid,

  preload(scene) {
    for (let m = 1; m <= 12; m++) scene.load.image(plantKey(m), plantUrl(m));
  },

  draw(t: Ctx) {
    const { scene } = t;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const p = t.pub;
    drawTable(scene, 'matgo');
    if (!p) {
      label(scene, W / 2, H / 2, '모두 레디하면 시작해요', clamp(Math.min(W, H) * 0.05, 18, 30));
      return;
    }
    // 세로 화면: 손패 두 줄, 바닥 세 줄
    const portrait = H > W * 1.15;
    // 카드 크기: 화면 비율에 맞춰 (손패 기준). 바닥 0.86배(세로 0.8배), 먹은 패 0.5배
    const cw = portrait ? clamp(Math.min(W / 6.4, H / 11), 30, 90) : clamp(Math.min(W / 11.5, H / 7), 30, 96);
    const fw = cw * (portrait ? 0.8 : 0.86);
    const capW = cw * 0.56;
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
    const oppHand = { x: W * 0.45, y: bw * 0.8 + 4 };
    for (let i = 0; i < op.handCount; i++) hwatu(scene, oppHand.x + (i - (op.handCount - 1) / 2) * bw * 0.55, oppHand.y, null, bw);
    captured(t, scene, 24 + capW / 2, portrait ? H * 0.13 : H * 0.19, op, capW, W - 16);

    // 더미 위치 (세로 화면: 오른쪽 위, 가로: 바닥 왼쪽) — 뒤집은 패가 여기서 날아온다
    const y0 = portrait ? H * 0.255 : H * 0.355;
    const rowGap = fw * 1.68;
    const pile = portrait ? { x: W - fw * 0.8, y: fw * 0.85 + 6 } : { x: W * 0.075, y: y0 + rowGap * 0.5 };
    const myHand = { x: W * 0.6, y: H - cw * 0.86 };

    // 바닥 (달별로 모아서, 두 줄)
    const floor = p.floor;
    const nRows = portrait ? 3 : 2;
    const cols = Math.max(4, Math.ceil(floor.length / nRows));
    const left = portrait ? W * 0.04 : W * 0.17;
    const right = portrait ? W * 0.96 : W * 0.83;
    floor.forEach((f, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = left + (col + 0.5) * ((right - left) / cols) - fw * 0.3;
      const y = y0 + row * rowGap;
      const pick = p.choice?.kind === 'choose' && t.myTurn && !t.busy;
      f.cards.forEach((id, j) => {
        const glow = p.choice?.kind === 'choose' && p.choice.options.includes(id);
        const card = hwatu(scene, x + j * fw * 0.4, y + j * fw * 0.06, id, fw, {
          glow,
          onClick: glow && pick ? () => void t.act({ type: 'choose', card: id }) : undefined,
        });
        // 처음 보는 패: 이번 차례에 뒤집은 패면 더미에서, 낸 패면 낸 사람 손에서
        const flipped = p.turnCards?.flipped === id;
        const from = flipped ? pile : p.turn === me ? myHand : oppHand;
        t.track(card, id, { from, order: flipped ? 1 : 0 });
      });
      if (f.ppeok || f.stacked) label(scene, x, y - fw * 0.95, f.ppeok ? '뻑' : '쌓임', clamp(fw * 0.26, 12, 20), tc('pink'));
    });
    // 더미
    for (let i = 0; i < 3; i++) hwatu(scene, pile.x + i * 2, pile.y - i * 2, null, fw);
    label(scene, pile.x, pile.y + fw * 1.0, `더미 ${p.pileCount}`, clamp(fw * 0.22, 12, 18));
    // 이번 차례에 낸 패·뒤집은 패 (오른쪽)
    if (p.turnCards) {
      const tc = [...p.turnCards.played, ...(p.turnCards.flipped ? [p.turnCards.flipped] : [])];
      const tx = portrait ? W - fw * 2.1 : W * 0.925;
      tc.forEach((id, i) => hwatu(scene, tx - i * fw * 0.45, pile.y, id, fw * 0.85));
      label(scene, tx, pile.y + fw * 1.0, '이번 차례', clamp(fw * 0.22, 12, 18));
    }
    if (p.nagariMul > 1) label(scene, W / 2, y0 - fw * 1.05, `나가리 ×${p.nagariMul}`, clamp(fw * 0.3, 14, 22), tc('primary'));

    // 나: 먹은 패 · 이름패 · 손패
    const mp = P[me];
    captured(t, scene, 24 + capW / 2, portrait ? H - cw * 3.55 : H * 0.685, mp, capW, W - 16);
    nameTag(scene, 26 * k, H - 28 * k, t.seatName(me), t.seatAvatar(me), {
      turn: p.turn === me,
      me: t.mySeat === me,
      size: k,
      sub: `${mp.score}점${mp.go ? ` · ${mp.go}고` : ''}${mp.bombFill ? ` · 폭탄피 ${mp.bombFill}` : ''}`,
    });
    // 공개 상태가 내 비공개 손패보다 먼저 도착하면 방금 낸 패가 두 곳에 보인다 → 이미 바닥·먹은 패에 있는 패는 손패에서 뺀다
    const shown = new Set<string>([
      ...p.floor.flatMap((f) => f.cards),
      ...Object.values(P).flatMap((pl) => [...pl.captured.gwang, ...pl.captured.yeol, ...pl.captured.tti, ...pl.captured.pi]),
    ]);
    const hand = (t.priv?.hand ?? []).filter((id) => !shown.has(id));
    const canPlay = t.myTurn && p.choice?.kind === 'play';
    // 가로: 한 줄 (이름패 오른쪽부터) / 세로: 다섯 장씩 두 줄 (이름패 위)
    const perRow = portrait ? 5 : hand.length;
    const hx0 = portrait ? W / 2 - (Math.min(perRow, hand.length) - 1) * cw * 0.53 : Math.max(W * 0.27, 190 * k);
    const step = portrait ? cw * 1.06 : Math.min(cw * 1.06, (W - hx0 - cw * 0.6) / Math.max(1, hand.length - 1));
    const handY = (i: number) => (portrait ? H - cw * 0.86 - 46 * k - (Math.floor(i / perRow) === 0 ? cw * 1.62 : 0) : H - cw * 0.86);
    hand.forEach((id, i) =>
      t.track(
        hwatu(scene, hx0 + (i % perRow) * step, handY(i), id, cw, {
          lift: canPlay,
          onClick: canPlay && !t.busy ? () => void t.act({ type: 'play', card: id, shake: shake && !!t.priv?.shakeable.includes(cardById(id).month) }) : undefined,
        }),
        id,
        { from: pile },
      ),
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
      el.innerHTML = `<p class="msg">${c.stage === 'flip' ? '뒤집은 패로' : '낸 패로'} 가져올 패를 고르세요 (테이블에서 빛나는 패를 눌러도 돼요)</p><div class="row">${c.options
        .map((id) => `<button class="hw-pick" data-c="${id}" ${dis} title="${esc(cardById(id).name)}">${miniCard(id)}</button>`)
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
