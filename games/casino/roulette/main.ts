/**
 * 십이지신 룰렛 화면: 위 휠(12칸, 계절 색 + 십이지신) · 최근 20개 결과 · 아래 베팅판.
 * 칩 놓기는 브라우저에서만 하고 '확정'할 때 한 번 보낸다 (안 보냈으면 마감 직전에 자동으로).
 * 모든 화면이 같은 칸에 멈추도록, 회전은 서버 결과로 정해진 각도까지 같은 시간(6초) 동안 돈다.
 */
import { ROULETTE_MANUAL } from '../../lib/manuals.ts';
import { bootGame, esc, sfx, sfxMany, type GameUI, type TableCtx } from '../../lib/shell.ts';
import { clamp, drawTable, label, tc, theme, viewSize } from '../../lib/cards.ts';
import { BET_MS, MULT, SEASONS, WHEEL, hits, seasonCells, type BetKind, type RBet, type RoulettePublic } from '../../../supabase/functions/_shared/roulette.ts';
import { worldRoot } from '../../lib/world.ts';
import type PhaserNS from 'phaser';

type Ctx = TableCtx<RoulettePublic, Record<string, never>>;

const NAME: Record<string, string> = {
  rat: '쥐', ox: '소', tiger: '호랑이', rabbit: '토끼', dragon: '용', snake: '뱀', horse: '말', sheep: '양', monkey: '원숭이', rooster: '닭', dog: '개', pig: '돼지',
};
const SEASON_KEY = ['spring', 'summer', 'autumn', 'winter'] as const;
/** 칸 → 계절 번호 */
const seasonOf = (cell: number) => [0, 1, 2, 3].find((t) => seasonCells(t).includes(cell))!;
const faceUrl = (id: string) => new URL(`shared/images/zodiac/face/${id}.png`, worldRoot()).href;
const SPIN_ANIM = 6000;

// ── 브라우저에서만 놓는 칩 (확정 전) ──
let unit = 1;
let local: RBet[] = [];
let localKey = '';
/** 지난 라운드에 확정한 베팅 ('지난 라운드와 같게') */
let lastBets: RBet[] = [];
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let sentFor = '';
/** 스핀별 회전 시작 시각 (다시 그려도 이어서 돈다) */
const spinStart = new Map<string, number>();
const shownWin = new Set<string>(); // (예전: 한 번만 보이기, 지금은 시각 기준)
let countdown: ReturnType<typeof setTimeout> | null = null;
/** 지금 화면의 방 (바뀌면 위 상태를 모두 비운다) */
let roomId = '';
/** 서버 시각 − 내 시각 (베팅이 새로 열리는 순간을 보고 맞춘다) */
let skew = 0;
let skewSeen = false;
let lastPhase = '';
let lastBase = 0;
let lastTick = '';

function enterRoom(id: string, base: number) {
  if (id === roomId && base === lastBase) return;
  roomId = id;
  lastBase = base;
  local = [];
  localKey = '';
  lastBets = [];
  sentFor = '';
  skew = 0;
  skewSeen = false;
  lastPhase = '';
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
  if (countdown) clearTimeout(countdown);
  countdown = null;
  spinStart.clear();
  shownWin.clear();
}
const serverNow = () => Date.now() + skew;
/** 베팅이 막 열린 순간이면 서버 시계와의 차이를 잰다 (중간에 들어왔을 때는 재지 않는다) */
function syncClock(p: RoulettePublic) {
  const key = `${p.phase}:${p.spin}`;
  if (key === lastPhase) return;
  if (p.phase === 'bet' && p.endsAt && lastPhase.startsWith('spin:')) {
    const est = p.endsAt - BET_MS - Date.now();
    // 터무니없는 값은 버린다 (네트워크 지연이 매우 큰 경우 등)
    // 늦게 본 경우(백그라운드·재연결) 값이 작게 나오므로, 지금까지 잰 것 중 가장 큰 값을 쓴다
    if (Math.abs(est) < 5 * 60_000) {
      skew = skewSeen ? Math.max(skew, est) : est;
      skewSeen = true;
    }
  }
  lastPhase = key;
}

const keyOf = (b: { kind: BetKind; target: number }) => `${b.kind}:${b.target}`;
const sumOf = (bs: RBet[]) => bs.reduce((a, b) => a + b.amount, 0);

function addBet(kind: BetKind, target: number, amount: number, max: number) {
  if (sumOf(local) + amount > max) return false;
  const cur = local.find((b) => b.kind === kind && b.target === target);
  if (cur) cur.amount += amount;
  else local.push({ kind, target, amount });
  return true;
}

/** 휠 그리기 (rot: 라디안, 0이면 0번 칸(쥐)이 위) */
function drawWheel(scene: PhaserNS.Scene, cx: number, cy: number, r: number, highlight: number | null) {
  const T = theme();
  const c = scene.add.container(cx, cy);
  const g = scene.add.graphics();
  // 바깥 테두리 (두께)
  g.fillStyle(T.COLOR.outline, 1).fillCircle(0, 4, r + 8);
  g.fillStyle(T.COLOR.panel, 1).fillCircle(0, 0, r + 8);
  g.lineStyle(T.SHAPE.line, T.COLOR.outline, 1).strokeCircle(0, 0, r + 8);
  const seg = (Math.PI * 2) / 12;
  for (let i = 0; i < 12; i++) {
    // i번 칸의 가운데가 위(−90°)에서 시계 방향으로 i×30°
    const a0 = -Math.PI / 2 + i * seg - seg / 2;
    const col = T.ROULETTE[SEASON_KEY[seasonOf(i)]];
    g.fillStyle(highlight === i ? T.COLOR.primary : col, 1).slice(0, 0, r, a0, a0 + seg, false).fillPath();
    g.lineStyle(T.SHAPE.lineThin, T.COLOR.outline, 1).slice(0, 0, r, a0, a0 + seg, false).strokePath();
  }
  c.add(g);
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + i * seg;
    const key = `avc-${WHEEL[i]}`;
    const fx = Math.cos(a) * r * 0.7;
    const fy = Math.sin(a) * r * 0.7;
    if (scene.textures.exists(key)) {
      const img = scene.add.image(fx, fy, key);
      img.setScale((r * 0.38) / img.width).setRotation(a + Math.PI / 2);
      c.add(img);
    }
    // 음양 점 (양 = 흰 점, 음 = 진한 점)
    const dot = scene.add.circle(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, Math.max(2.5, r * 0.035), i % 2 === 0 ? T.COLOR.white : T.COLOR.outline);
    dot.setStrokeStyle(1.5, T.COLOR.outline);
    c.add(dot);
  }
  // 가운데
  const hub = scene.add.graphics();
  hub.fillStyle(T.COLOR.primary, 1).fillCircle(0, 0, r * 0.2);
  hub.lineStyle(T.SHAPE.line, T.COLOR.outline, 1).strokeCircle(0, 0, r * 0.2);
  c.add(hub);
  return c;
}

const ui: GameUI<RoulettePublic, Record<string, never>> = {
  game: 'roulette',
  title: '십이지신 룰렛',
  manual: ROULETTE_MANUAL,
  icon: '🎡',
  back: 'games/casino/',
  backLabel: '카지노',
  noAi: true,
  pageClass(t: Ctx) {
    const p = t.pub;
    if (!p || t.mySeat === null) return '';
    const betting = p.phase === 'bet' && p.players.some((x) => x.seat === t.mySeat) && !p.confirmed.includes(t.mySeat);
    return betting ? 'rl-betting' : 'rl-watch';
  },
  // 당첨금은 휠이 멈춘 뒤에 보이게
  liveWallet: (pub: RoulettePublic | null) => (pub?.phase === 'spin' ? SPIN_ANIM + 600 : 400),
  felt: () => theme().COLOR.skyMid,

  draw(t: Ctx) {
    const { scene } = t;
    const { W, H } = viewSize(scene);
    const p = t.pub;
    drawTable(scene, 'poker');
    const T = theme();
    enterRoom(t.room.id, t.room.base_unit);
    if (p) syncClock(p);
    // 결과가 처음 보인 순간부터 회전 (다시 그려도 이어서)
    const spinKey = p ? `${p.spin}:${t.room.round_no}` : '';
    if (p?.phase === 'spin' && p.landed !== null && !spinStart.has(spinKey)) spinStart.set(spinKey, performance.now());
    const isStopped = () => !p || p.phase !== 'spin' || wheelStopped(spinKey);
    // 최근 결과 (최대 20, 최신이 오른쪽)
    const hist = p?.history ?? [];
    const hs = clamp(Math.min(30, (W - 40) / 20), 12, 30);
    const shownHist = !isStopped() ? hist.slice(0, -1) : hist;
    shownHist.forEach((cell, i) => {
      const x = W - 20 - (shownHist.length - 1 - i) * (hs + 2) - hs / 2;
      const key = `avc-${WHEEL[cell]}`;
      const y = 20 + hs / 2;
      scene.add.circle(x, y, hs / 2 + 1.5, T.ROULETTE[SEASON_KEY[seasonOf(cell)]]).setStrokeStyle(1.5, T.COLOR.outline);
      if (scene.textures.exists(key)) scene.add.image(x, y, key).setScale((hs * 0.9) / 128);
    });
    if (hist.length) label(scene, 22, 20 + hs / 2, '최근', clamp(hs * 0.5, 11, 15)).setOrigin(0, 0.5);

    // 휠
    const top = 28 + hs;
    // 휠 아래 두 줄(남은 시간·결과) 자리를 남긴다
    const r = Math.max(56, Math.min(W * 0.42, (H - top - 96) / 2));
    const cx = W / 2;
    const cy = top + 14 + r;
    const result = p?.landed ?? null;
    const lastCell = hist.length ? hist[hist.length - 1] : 0;
    const stopped = isStopped();
    const wheel = drawWheel(scene, cx, cy, r, p?.phase === 'spin' && stopped ? result : null);
    const seg = (Math.PI * 2) / 12;
    // 칸 c가 위(바늘)에 오는 회전값
    const restAngle = (cell: number) => -cell * seg;
    if (p?.phase === 'spin' && result !== null) {
      const k = `${p.spin}:${t.room.round_no}`;
      if (!spinStart.has(k)) spinStart.set(k, performance.now());
      const t0 = spinStart.get(k)!;
      const prevCell = hist.length >= 2 ? hist[hist.length - 2] : 0;
      const from = restAngle(prevCell);
      // 같은 방향(시계)으로 5바퀴 이상 돌아 결과 칸에 멈춘다
      let to = restAngle(result) + Math.PI * 2 * 5;
      while (to - from < Math.PI * 2 * 5) to += Math.PI * 2;
      const prog = Math.min(1, (performance.now() - t0) / SPIN_ANIM);
      const ease = (x: number) => 1 - Math.pow(1 - x, 4);
      wheel.setRotation(from + (to - from) * ease(prog));
      if (prog < 1) {
        let lastSeg = Math.floor((from + (to - from) * ease(prog)) / seg);
        scene.tweens.addCounter({
          from: prog,
          to: 1,
          duration: SPIN_ANIM * (1 - prog),
          onUpdate: (tw) => {
            const rot = from + (to - from) * ease(tw.getValue() ?? 1);
            wheel.setRotation(rot);
            const segNow = Math.floor(rot / seg);
            if (segNow !== lastSeg) {
              lastSeg = segNow;
              sfx('spinTick');
            }
          },
          onComplete: () => {
            sfx('spinStop');
            const mine = t.mySeat !== null ? (p.wins[String(t.mySeat)] ?? 0) : 0;
            if (mine > 0) sfxMany('coin', 3, 120, { delay: 250 });
            t.redraw();
          },
        });
      }
    } else {
      wheel.setRotation(restAngle(lastCell));
    }
    // 바늘 (위)
    const pin = scene.add.graphics();
    pin.fillStyle(T.COLOR.outline, 1).fillTriangle(cx - r * 0.1, cy - r - 14, cx + r * 0.1, cy - r - 14, cx, cy - r + r * 0.14 + 3);
    pin.fillStyle(T.COLOR.lose, 1).fillTriangle(cx - r * 0.08, cy - r - 12, cx + r * 0.08, cy - r - 12, cx, cy - r + r * 0.14);

    // 아래 안내: 남은 시간 / 결과
    const msgY = cy + r + 26;
    if (!p) {
      label(scene, cx, msgY, '모두 레디하면 시작해요', clamp(r * 0.12, 16, 26));
      return;
    }
    if (p.phase === 'bet') {
      const left = p.endsAt ? Math.max(0, Math.ceil((p.endsAt - serverNow()) / 1000)) : 20;
      label(scene, cx, msgY, `베팅 ${left}초 · ${p.confirmed.length}/${p.players.length}명 확정`, clamp(r * 0.11, 15, 24));
      // 1초마다 남은 시간 갱신 (타이머는 하나만)
      const room = t.room.id;
      const leftEl = document.getElementById('rl-left');
      if (leftEl) leftEl.textContent = `${left}초`;
      if (left > 0 && left <= 3 && lastTick !== `${p.spin}:${left}`) {
        lastTick = `${p.spin}:${left}`;
        sfx('tick');
      }
      if (!countdown) countdown = setTimeout(() => ((countdown = null), room === roomId && t.redrawTable()), 1000);
    } else if (p.phase === 'spin' && result !== null) {
      if (!stopped) label(scene, cx, msgY, '돌아가는 중…', clamp(r * 0.11, 15, 24));
      else {
        const animal = WHEEL[result];
        const mine = t.mySeat !== null ? (p.wins[String(t.mySeat)] ?? 0) : 0;
        const bet = t.mySeat !== null ? sumOf(p.bets[String(t.mySeat)] ?? []) : 0;
        label(scene, cx, msgY, `${NAME[animal]}! ${SEASONS[seasonOf(result)]} · ${result % 2 === 0 ? '양' : '음'}`, clamp(r * 0.13, 16, 28), tc('primary'));
        if (bet > 0) label(scene, cx, msgY + clamp(r * 0.15, 20, 32), mine > 0 ? `+${t.fmt(mine)}칩 당첨!` : '꽝', clamp(r * 0.11, 14, 22), mine > 0 ? tc('win') : tc('white'));
        // 멈춘 뒤 2.1초 동안 당첨 띠를 크게 (시각 기준이라 중간에 다시 그려도 이어진다)
        const since = performance.now() - ((spinStart.get(spinKey) ?? 0) + SPIN_ANIM);
        if (since >= 0 && since < 2100 && scene.textures.exists(`full-${animal}`)) {
          const big = scene.add.image(cx, cy, `full-${animal}`).setDepth(50);
          const s0 = (r * 0.36) / Math.max(big.width, big.height);
          const grow = Math.min(1, since / 420);
          big.setScale(s0 * (1 + 1.5 * (1 - Math.pow(1 - grow, 3))));
          big.setAlpha(since < 1600 ? 1 : 1 - (since - 1600) / 500);
          if (grow < 1) scene.tweens.add({ targets: big, scale: s0 * 2.5, duration: 420 - since, ease: 'Back.easeOut' });
          scene.tweens.add({ targets: big, alpha: 0, delay: Math.max(0, 1600 - since), duration: Math.min(500, 2100 - since), onComplete: () => big.destroy() });
        }
      }
    }
  },

  controls(t: Ctx, el: HTMLElement) {
    const p = t.pub;
    // 자동 확정 예약은 그릴 때마다 새로 (확정했거나 회전 중이면 다시 걸지 않는다)
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
    if (!p || t.mySeat === null) return;
    enterRoom(t.room.id, t.room.base_unit);
    const me = String(t.mySeat);
    const base = p.baseUnit;
    // 스핀이 바뀌면 놓던 칩은 새로
    const k = `${t.room.round_no}:${p.spin}`;
    if (k !== localKey) {
      localKey = k;
      local = [];
    }
    const inSpin = p.players.some((x) => String(x.seat) === me);
    const confirmed = p.confirmed.includes(t.mySeat);
    if (p.phase === 'spin' || p.phase === 'done') {
      const mine = p.bets[me] ?? [];
      if (mine.length) lastBets = mine.map((b) => ({ ...b }));
      el.innerHTML = `<p class="msg">${p.phase === 'done' ? '' : '결과를 보고 나면 다음 베팅이 열려요'}</p>${board(p, t, false)}`;
      return;
    }
    if (!inSpin) {
      el.innerHTML = `<p class="msg">다음 베팅부터 참여해요 (지금은 구경 중)</p>${board(p, t, false)}`;
      return;
    }
    if (confirmed) {
      const mine = p.bets[me] ?? [];
      el.innerHTML = `<p class="msg">확정했어요 (${t.fmt(sumOf(mine))}칩) · 다른 사람을 기다리는 중</p>${board(p, t, false)}`;
      return;
    }
    const dis = t.busy ? 'disabled' : '';
    const total = sumOf(local);
    el.innerHTML = `<div class="row rl-top">
        <span class="rl-units">${[1, 5, 10].map((n) => `<button class="btn small ${unit === n ? 'sel' : ''}" data-u="${n}">${t.fmt(base * n)}</button>`).join('')}</span>
        <span class="rl-left" id="rl-left">${p.endsAt ? Math.max(0, Math.ceil((p.endsAt - serverNow()) / 1000)) : 20}초</span>
        <span class="amount">${t.fmt(total)} / ${t.fmt(p.maxTotal)}</span>
      </div>
      ${board(p, t, true)}
      <div class="row">
        <button class="btn" id="rl-clear" ${dis || (local.length ? '' : 'disabled')}>취소</button>
        <button class="btn" id="rl-repeat" ${dis || (lastBets.length ? '' : 'disabled')}>지난 라운드와 같게</button>
        <button class="btn big primary" id="rl-go" ${dis}>${local.length ? '베팅 확정' : '이번엔 안 걸기'}</button>
      </div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-u]').forEach((b) =>
      b.addEventListener('click', () => {
        unit = Number(b.dataset.u);
        t.redraw();
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-bk]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!addBet(b.dataset.bk as BetKind, Number(b.dataset.bt), base * unit, p.maxTotal)) return void flash(el, `한 번에 ${t.fmt(p.maxTotal)}칩까지 걸 수 있어요`);
        sfx('chip');
        t.redraw();
      }),
    );
    el.querySelector('#rl-clear')?.addEventListener('click', () => ((local = []), t.redraw()));
    el.querySelector('#rl-repeat')?.addEventListener('click', () => {
      local = lastBets.map((b) => ({ ...b }));
      if (sumOf(local) > p.maxTotal) local = [];
      t.redraw();
    });
    const room = t.room.id;
    const send = () => {
      // 이미 보냈거나, 방을 나갔거나 다른 방이면 보내지 않는다
      if (sentFor === k || room !== roomId || !el.isConnected) return;
      sentFor = k;
      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = null;
      const bets = local.map((b) => ({ ...b }));
      if (bets.length) lastBets = bets;
      void t.act({ type: 'bet', bets }).then((ok) => {
        // 서버가 받지 않았을 때만 다시 보낼 수 있게
        if (!ok && sentFor === k) sentFor = '';
      });
    };
    el.querySelector('#rl-go')?.addEventListener('click', send);
    // 마감 직전 자동 확정 (놓은 칩이 있을 때만, 없으면 서버가 '안 걸기'로 처리)
    if (p.endsAt && local.length && sentFor !== k && p.endsAt - serverNow() > 300) autoTimer = setTimeout(send, Math.max(0, p.endsAt - serverNow() - 1500));
  },

  resultHtml(t: Ctx) {
    const r = (t.pub as unknown as { result?: { stopReason?: string; spins?: number } })?.result;
    if (r?.stopReason === 'idle') return '<h3>🎡 잠깐 쉬어요</h3><p>3번 연속 아무도 걸지 않아 멈췄어요. 레디하면 다시 시작해요.</p>';
    return '<h3>🎡 룰렛을 멈췄어요</h3><p>레디하면 다시 시작해요.</p>';
  },

  cutin() {
    return null;
  },
};

/** 회전 연출이 끝났는가 */
function wheelStopped(key: string) {
  const t0 = spinStart.get(key);
  return t0 === undefined || performance.now() - t0 >= SPIN_ANIM;
}

function flash(el: HTMLElement, msg: string) {
  const m = el.querySelector('.rl-top .amount');
  if (m) {
    m.textContent = msg;
    m.classList.add('warn');
  }
}

/** 베팅판 HTML: 계절마다 한 줄 [계절][띠][이웃][띠][이웃][띠][다음 줄로 이웃] + 음양 줄 */
function board(p: RoulettePublic, t: Ctx, active: boolean) {
  const me = String(t.mySeat);
  // 당첨 칸 표시는 휠이 멈춘 뒤에
  const result = p.phase === 'spin' && wheelStopped(`${p.spin}:${t.room.round_no}`) ? p.landed : null;
  // 다른 사람 베팅 (확정한 것): 칸마다 아바타
  const others = new Map<string, string[]>();
  for (const [seat, bets] of Object.entries(p.bets)) {
    if (seat === me) continue;
    const av = t.seatAvatar(Number(seat));
    for (const b of bets) others.set(keyOf(b), [...(others.get(keyOf(b)) ?? []), av]);
  }
  const mineConfirmed = new Map((p.bets[me] ?? []).map((b) => [keyOf(b), b.amount]));
  const mineLocal = new Map(local.map((b) => [keyOf(b), b.amount]));
  const cell = (kind: BetKind, target: number, inner: string, cls: string, title: string) => {
    const k = keyOf({ kind, target });
    const amt = active ? mineLocal.get(k) : mineConfirmed.get(k);
    const win = result !== null && hits({ kind, target }, result);
    const avs = (others.get(k) ?? []).slice(0, 3).map((a) => `<img class="oc" src="${faceUrl(a)}" alt=""/>`).join('');
    return `<button class="rc ${cls} ${win ? 'win' : ''} ${amt ? 'has' : ''}" ${active ? `data-bk="${kind}" data-bt="${target}"` : 'disabled'} title="${esc(title)} ×${MULT[kind]}">
      ${inner}${amt ? `<b class="amt">${t.fmt(amt)}</b>` : ''}${avs ? `<span class="ocs">${avs}</span>` : ''}</button>`;
  };
  const z = (i: number) => cell('zodiac', i, `<img src="${faceUrl(WHEEL[i])}" alt=""/><i>${NAME[WHEEL[i]]}</i>`, 'z', NAME[WHEEL[i]]);
  const pair = (i: number) => cell('pair', i, '<i>↔</i>', 'pr', `${NAME[WHEEL[i]]}·${NAME[WHEEL[(i + 1) % 12]]}`);
  const rows = [0, 1, 2, 3]
    .map((s) => {
      const [a, b, c] = seasonCells(s);
      return `<div class="rrow ${SEASON_KEY[s]}">${cell('season', s, `<i>${SEASONS[s]}</i><small>×4</small>`, 'ss', SEASONS[s])}${z(a)}${pair(a)}${z(b)}${pair(b)}${z(c)}${pair(c)}</div>`;
    })
    .join('');
  const yy = `<div class="rrow yy">${cell('yinyang', 0, '<i>☀ 양</i><small>×2</small>', 'y', '양')}${cell('yinyang', 1, '<i>☾ 음</i><small>×2</small>', 'y', '음')}</div>`;
  return `<div class="rboard ${active ? '' : 'off'}"><p class="rhint">띠 ×12 · ↔ 이웃 두 칸 ×6 · 계절 ×4 · 음양 ×2</p>${rows}${yy}</div>`;
}

void bootGame(ui);
