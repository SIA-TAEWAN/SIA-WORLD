// 시아블록 화면: 메인 → 게임(점수 띠 · 판 · 조각 3개 · 정령 마당) → 결과.
// 판은 기기에서 돌고(src/rules.ts = 서버와 같은 규칙), 끝나면 놓기 기록을 보내 서버가 다시 돌려 점수를 확정한다.
import * as SPR from '../../../pang/src/game/spirits.js';
import * as PangScene from '../../../pang/src/ui/scene.js';
import { COLOR, css, PANG } from '../../../../shared/theme.js';
import {
  BLOCK_RULES, canPlace, fitsAnywhere, newGame, place, previewLines, shapeOf, shapeSize, SIZE, SPIRITS,
  type BlockState, type Move, type PlaceEvent, type Shape,
} from '../rules.ts';
import { ApiError, type BlockApi, type BlockInfo, type FinishResult } from '../net/api.ts';
import { createFx } from './fx.ts';
import { rr, tile } from './tiles.ts';

const BOARD_BG = css(PANG.board), CELL = css(PANG.cell), CELL_ALT = css(PANG.cellAlt);
const GOLD_LIGHT = css(COLOR.primaryLight), CREAM = css(COLOR.panelStrong), WHITE = css(COLOR.white);
/** 큰 콤보 · 판 비우기 글자 (시아팡팡과 같은 분홍) */
const TEXT_PINK = '#FFB3C8';
const PRAISE = ['', '', '좋아요', '멋져요', '대단해요'];
/** 마우스 쓰는 기기: 조각 아래에 1·2·3 키 번호를 보인다 */
const FINE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

interface SoundModule {
  play(name: string, o?: { volume?: number; rate?: number; delay?: number }): void;
  playBgm(game: string, scene?: string): void;
  openSoundSettings(onClose?: () => void): HTMLElement;
}
export interface AppOpts {
  api: BlockApi;
  info: BlockInfo;
  local: boolean;
  loadSound: () => Promise<SoundModule>;
  worldHome: () => string;
  openRanking: () => Promise<boolean>;
}

type Phase = 'home' | 'play' | 'paused' | 'dying' | 'result';

export function startApp(opts: AppOpts) {
  const { api, local } = opts;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let info = opts.info;

  // ---------- 소리 · 진동 ----------
  let snd: SoundModule | null = null;
  const sfx = (name: string, o?: { volume?: number; rate?: number; delay?: number }) => { try { snd?.play(name, o); } catch { /* 소리는 없어도 계속 */ } };
  let bgmScene = 'main';
  const bgm = (scene: string) => { bgmScene = scene; try { snd?.playBgm('block', scene); } catch { /* 배경음은 없어도 계속 */ } };
  opts.loadSound().then(m => { snd = m; bgm(bgmScene); }).catch(() => {});
  const openSound = () => { try { snd?.openSoundSettings(); } catch { /* 없음 */ } };
  const VIBE_KEY = 'sia:block:vibe';
  let vibeOn = (() => { try { return localStorage.getItem(VIBE_KEY) !== '0'; } catch { return true; } })();
  const vibe = (p: number | number[]) => { if (!vibeOn) return; try { navigator.vibrate?.(p); } catch { /* 막힌 기기 */ } };

  // ---------- 상태 ----------
  let phase: Phase = 'home';
  let G: BlockState | null = null;
  let log: Move[] = [];
  let runId = '', seed = 0;
  let bestAtStart = 0, passedBest = false;
  let dieT = 0;
  let lastResult: FinishResult | null = null;

  // ---------- 판 크기 ----------
  const cv = $<HTMLCanvasElement>('board'), bx = cv.getContext('2d')!;
  const tcv = $<HTMLCanvasElement>('tray'), tx = tcv.getContext('2d')!;
  const dcv = $<HTMLCanvasElement>('drag'), dx = dcv.getContext('2d')!;
  let dpr = 1, BW = 400, S = 50, TW = 400, TH = 150, TS = 26;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    BW = cv.clientWidth || 400; S = BW / SIZE;
    cv.style.height = BW + 'px';
    cv.width = Math.round(BW * dpr); cv.height = Math.round(BW * dpr);
    TW = tcv.clientWidth || BW;
    TS = Math.min(S * 0.52, (TW / 3 - 14) / 5);
    TH = Math.round(TS * 5 + 18);
    tcv.style.height = TH + 'px';
    tcv.width = Math.round(TW * dpr); tcv.height = Math.round(TH * dpr);
    dcv.width = Math.round(innerWidth * dpr); dcv.height = Math.round(innerHeight * dpr);
    layoutScene();
  }
  new ResizeObserver(() => resize()).observe(cv);
  addEventListener('resize', resize);

  // ---------- 정령 마당 (시아팡팡 scene.js 그대로. 게임에는 영향 없음) ----------
  const scene = PangScene.create($('scene'), SPR);
  scene.setup(0, SPIRITS.slice());
  $('scene').addEventListener('pointerdown', (e: PointerEvent) => {
    if (!scene.st.on) return;
    const r = $('scene').getBoundingClientRect();
    if (scene.tap(e.clientX - r.left, e.clientY - r.top)) { sfx('pangTap', { rate: 0.85 + Math.random() * 0.3 }); vibe(12); }
  });
  function layoutScene() {
    const wrap = $('sceneWrap');
    if (phase === 'home') return;
    wrap.classList.remove('hidden');
    const top = wrap.getBoundingClientRect().top + scrollY;
    const avail = innerHeight - top - 22;
    if (avail < 110) { wrap.classList.add('hidden'); scene.st.on = false; return; }
    const H = Math.min(260, Math.round(avail));
    $('scene').style.height = H + 'px';
    scene.resize($('scene').clientWidth || BW, H);
    scene.st.on = true;
  }

  // ---------- 화면 띠 ----------
  const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
  function toast(msg: string, ms = 2200) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout((toast as unknown as { h?: number }).h);
    (toast as unknown as { h?: number }).h = window.setTimeout(() => t.classList.remove('on'), ms);
  }
  function renderHome() {
    $('coinPill').textContent = '🪙 ' + fmt(info.siaCoins);
    $('homeBest').textContent = fmt(info.best);
    $('homeWeek').textContent = info.weekTop ? `${info.weekTop.name} · ${fmt(info.weekTop.score)}점` : '아직 없어요';
  }
  function hud() {
    if (!G) return;
    $('scoreNum').textContent = fmt(G.score);
    $('bestNum').textContent = fmt(Math.max(bestAtStart, G.score));
    $('bestBox').classList.toggle('beat', passedBest);
  }
  function popup(html: string, bind?: (el: HTMLElement) => void) {
    const pop = $('pop'); pop.innerHTML = html; $('overlay').classList.remove('hidden');
    bind?.(pop);
    for (const b of pop.querySelectorAll('.btn')) b.addEventListener('click', () => sfx('click'), true);
    (pop.querySelector('.btn.primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }
  const closePop = () => $('overlay').classList.add('hidden');

  // ---------- 시작 · 끝 ----------
  function toHome() {
    phase = 'home'; G = null; drag = null; kb = null; closePop();
    $('game').classList.add('hidden'); $('home').classList.remove('hidden');
    scene.st.on = false;
    bgm('main');
    renderHome();
    void api.flush().then(n => { if (n) refreshInfo(); });
  }
  async function refreshInfo() {
    try { info = await api.state(); if (phase === 'home') renderHome(); } catch { /* 그대로 */ }
  }
  let starting = false;
  async function startRun() {
    if (starting) return;
    starting = true;
    try {
      const r = await api.start();
      runId = r.run; seed = r.seed;
    } catch (e) {
      starting = false;
      toast(e instanceof ApiError && e.message === 'game closed' ? '지금은 시아블록이 닫혀 있어요' : 'SIA WORLD에 연결하지 못했어요. 다시 해 주세요');
      return;
    }
    starting = false;
    closePop();
    G = newGame(seed); log = [];
    bestAtStart = info.best; passedBest = false; dieT = 0; lastResult = null;
    pops = []; lands.clear(); trayPop = [1, 1, 1].map(() => 0); fx.clear(); drag = null; kb = null; shake = 0;
    phase = 'play';
    $('home').classList.add('hidden'); $('game').classList.remove('hidden');
    resize(); hud();
    bgm('main');
    sfx('blockPick');
  }
  function showPause() {
    if (phase !== 'play') return;
    phase = 'paused'; drag = null; kb = null;
    popup(`<h3>멈춤</h3>
      <div class="info">지금 점수 <b>${fmt(G?.score ?? 0)}</b></div>
      <div class="col">
        <button class="btn primary" id="pResume">이어서</button>
        <button class="btn" id="pRestart">처음부터</button>
        <button class="btn" id="pHome">메인으로</button>
        <div class="row"><button class="btn" id="pSound">⚙️ 소리</button><button class="btn" id="pVibe">${vibeOn ? '📳 진동 켜짐' : '📴 진동 꺼짐'}</button></div>
      </div>
      <div class="note">처음부터 · 메인으로 나가면 이 판은 기록되지 않아요</div>`, el => {
      el.querySelector('#pResume')!.addEventListener('click', () => { closePop(); phase = 'play'; });
      el.querySelector('#pRestart')!.addEventListener('click', () => void startRun());
      el.querySelector('#pHome')!.addEventListener('click', toHome);
      el.querySelector('#pSound')!.addEventListener('click', openSound);
      el.querySelector('#pVibe')!.addEventListener('click', e => {
        vibeOn = !vibeOn;
        try { localStorage.setItem(VIBE_KEY, vibeOn ? '1' : '0'); } catch { /* 저장 못 함 */ }
        (e.currentTarget as HTMLElement).textContent = vibeOn ? '📳 진동 켜짐' : '📴 진동 꺼짐';
        vibe(20);
      });
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && phase === 'play') showPause(); });

  async function finishRun() {
    if (!G) return;
    phase = 'result';
    const st = G;
    const localNew = st.score > bestAtStart;
    bgm(localNew ? 'win' : 'lose');
    if (localNew) sfx('newRecord');
    renderResult(st, null, true);
    let res: FinishResult | null = null, why = '';
    try {
      res = await api.finish({ run: runId, seed, log: log.slice(), score: st.score, rules: BLOCK_RULES });
    } catch (e) {
      why = e instanceof ApiError ? e.message : 'error';
    }
    if (phase !== 'result' || G !== st) return;
    lastResult = res;
    if (res) {
      info = { ...info, best: res.best, weekBest: res.weekBest, siaCoins: res.siaCoins };
      if (info.weekTop == null || res.weekBest > info.weekTop.score) void refreshInfo();
    }
    renderResult(st, res, false, why);
  }
  function renderResult(st: BlockState, res: FinishResult | null, waiting: boolean, why = '') {
    const newBest = res ? res.newBest : st.score > bestAtStart;
    const best = res ? res.best : Math.max(bestAtStart, st.score);
    let rankLine = '';
    if (waiting) rankLine = '<div class="note">기록을 확인하는 중…</div>';
    else if (res && !res.verified) rankLine = '<div class="note bad">기록이 서버 계산과 달라 랭킹에 넣지 않았어요</div>';
    else if (res) rankLine = `<div class="ranks"><span>전체 <b>${res.rank ? res.rank + '위' : '-'}</b></span><span>이번 주 <b>${res.weekRank ? res.weekRank + '위' : '-'}</b></span></div>`;
    else if (why) rankLine = '<div class="note bad">이 판은 기록되지 않았어요</div>';
    else rankLine = '<div class="note">연결이 끊겨 기록을 보관했어요. 다음에 다시 보낼게요</div>';
    const coin = res?.gotCoin ? `<div class="coin">🪙 시아코인 +1 (모두 ${fmt(res.siaCoins)})</div>` : '';
    popup(`<h3>${newBest ? '최고 기록!' : '게임 끝'}</h3>
      <div class="score ${newBest ? 'big' : ''}">${fmt(st.score)}</div>
      <div class="stats">
        <div><small>최고 점수</small><b>${fmt(best)}</b></div>
        <div><small>지운 줄</small><b>${fmt(st.lines)}</b></div>
        <div><small>최대 콤보</small><b>${fmt(st.maxCombo)}</b></div>
      </div>
      ${rankLine}${coin}
      <div class="row"><button class="btn primary" id="rAgain">다시 하기</button></div>
      <div class="row"><button class="btn" id="rHome">메인</button><button class="btn" id="rRank">🏆 랭킹</button></div>`, el => {
      el.querySelector('#rAgain')!.addEventListener('click', () => void startRun());
      el.querySelector('#rHome')!.addEventListener('click', toHome);
      el.querySelector('#rRank')!.addEventListener('click', () => void openRank());
    });
    if (newBest && !waiting) { const sc = el('score'); sc?.classList.add('stamp'); }
  }
  const el = (cls: string) => $('pop').querySelector('.' + cls) as HTMLElement | null;
  async function openRank() {
    if (local) { toast('테스트 모드에서는 랭킹이 없어요'); return; }
    if (!(await opts.openRanking())) toast('랭킹을 불러오지 못했어요');
  }

  // ---------- 놓기 ----------
  /** 지워지는 칸 (차례로 튀어 오르며 사라짐) */
  let pops: { r: number; c: number; spirit: number; delay: number; t: number; burst: boolean }[] = [];
  /** 방금 놓인 칸 → 남은 눌림 (0~1) */
  const lands = new Map<number, number>();
  let trayPop = [0, 0, 0];
  let shake = 0;
  const fx = createFx();

  function doPlace(slot: number, r: number, c: number) {
    if (!G || phase !== 'play') return;
    const { state, ev } = place(G, slot, r, c);
    G = state;
    log.push([slot, r, c]);
    effects(ev);
    hud();
    if (ev.over) { phase = 'dying'; dieT = ev.cleared.length ? -0.5 : -0.2; drag = null; kb = null; }
  }

  function effects(ev: PlaceEvent) {
    sfx('blockPlace', { rate: 0.9 + Math.random() * 0.15 });
    vibe(10);
    for (const [r, c] of ev.cells) lands.set(r * SIZE + c, 1);
    let sx = 0, sy = 0;
    for (const [r, c] of ev.cells) { sx += (c + 0.5) * S; sy += (r + 0.5) * S; }
    sx /= ev.cells.length; sy /= ev.cells.length;
    const n = ev.rows.length + ev.cols.length;
    if (n) {
      for (const q of ev.cleared) {
        const delay = (ev.rows.includes(q.r) ? q.c : q.r) * 0.035;
        pops.push({ r: q.r, c: q.c, spirit: q.spirit, delay, t: 0, burst: false });
      }
      sfx('blockClear', { rate: Math.min(2, 1 + (n - 1) * 0.14 + Math.max(0, ev.combo - 1) * 0.06) });
      if (n >= 2) shake = Math.max(shake, 4 + n * 2);
      // 정령 마당: 지운 줄에 있던 정령들이 기뻐한다 (콤보 3 이상이면 모두 뜀)
      const cnt: Record<string, number> = {};
      for (const q of ev.cleared) { const k = SPIRITS[q.spirit]; cnt[k] = (cnt[k] ?? 0) + 1; }
      for (const k in cnt) scene.ability(k, Math.min(12, cnt[k]));
      if (ev.combo >= 3) scene.cheer();
      const cx = ev.cols.length && !ev.rows.length ? (ev.cols[0] + 0.5) * S : sx;
      const cy = ev.rows.length ? (ev.rows[0] + 0.5) * S : sy;
      fx.text('+' + fmt(ev.linePoints + ev.placePoints), Math.min(BW - S, Math.max(S, cx)), Math.max(S * 0.5, cy - S * 0.2), 22, WHITE);
    } else {
      fx.text('+' + ev.placePoints, sx, sy - S * 0.3, 15, CREAM, undefined, 1.6);
    }
    if (ev.combo >= 2 && n) {
      const big = ev.combo >= 5, col = big ? TEXT_PINK : GOLD_LIGHT;
      vibe(big ? [40, 30, 60] : Math.min(50, 15 + ev.combo * 8));
      sfx('blockCombo', { rate: Math.min(1.6, 0.9 + ev.combo * 0.08), volume: 0.8 });
      const size = Math.min(BW * 0.24, 26 + (ev.combo - 1) * 8), sub = Math.min(32, 16 + ev.combo * 2);
      fx.text(ev.combo + ' 콤보!', BW / 2, BW * 0.38, size, col, 'combo');
      fx.text(big ? '정령 폭풍!' : PRAISE[ev.combo] + '!', BW / 2, BW * 0.38 + size * 0.55 + sub * 0.7, sub, col, 'praise');
    }
    if (ev.perfect) {
      sfx('blockPerfect');
      vibe([30, 40, 30, 40, 80]);
      fx.text('판 비우기!', BW / 2, BW * 0.55, Math.min(BW * 0.16, 48), TEXT_PINK, 'perfect', 0.6);
      fx.text('+' + fmt(ev.perfectPoints), BW / 2, BW * 0.55 + 44, 28, GOLD_LIGHT, 'perfect2', 0.6);
      fx.sparkle(BW / 2, BW / 2, 60, S);
      scene.cheer();
    }
    if (G && !passedBest && bestAtStart > 0 && G.score > bestAtStart) {
      passedBest = true;
      sfx('newRecord', { delay: 0.15 });
      fx.text('최고 기록!', BW / 2, BW * 0.2, Math.min(BW * 0.13, 40), GOLD_LIGHT, 'best', 0.55);
      fx.sparkle(BW / 2, BW * 0.2, 40, S);
      bgm('boss');
    }
    if (ev.dealt) { trayPop = [1, 1, 1]; sfx('blockPick', { rate: 1.3, volume: 0.6, delay: 0.12 }); }
    if (ev.over) sfx('blockOver', { delay: 0.45 });
  }

  // ---------- 끌어서 놓기 ----------
  interface Drag { slot: number; id: number; x: number; y: number; touch: boolean; grow: number; ghost: [number, number] | null; back?: { t: number; fx: number; fy: number } }
  let drag: Drag | null = null;
  /** 키보드: 고른 조각 · 위치 */
  let kb: { slot: number; r: number; c: number } | null = null;

  const slotCenter = (slot: number) => { const r = tcv.getBoundingClientRect(); return [r.left + (slot + 0.5) * (r.width / 3), r.top + r.height / 2]; };
  function slotAt(clientX: number): number { const r = tcv.getBoundingClientRect(); return Math.max(0, Math.min(2, Math.floor(((clientX - r.left) / r.width) * 3))); }
  /** 떠 있는 조각의 왼쪽 위 (화면 좌표). 손가락보다 위에 뜬다 */
  function pieceTopLeft(d: Drag, sh: Shape, cell: number): [number, number] {
    const { h, w } = shapeSize(sh);
    const lift = d.touch ? h * cell * 0.5 + S * 1.2 : 0;
    return [d.x - (w * cell) / 2, d.y - lift - (h * cell) / 2];
  }
  /** 가까운 칸으로 자석처럼: 놓을 수 있는 칸 가운데 0.8칸 안에서 가장 가까운 곳 */
  function snap(sh: Shape, left: number, top: number): [number, number] | null {
    if (!G) return null;
    const r = cv.getBoundingClientRect();
    const fxc = (left - r.left) / S, fyc = (top - r.top) / S;
    let best: [number, number] | null = null, bd = 0.8;
    for (let rr0 = Math.floor(fyc) - 1; rr0 <= Math.floor(fyc) + 2; rr0++) for (let cc = Math.floor(fxc) - 1; cc <= Math.floor(fxc) + 2; cc++) {
      if (!canPlace(G.board, sh, rr0, cc)) continue;
      const d = Math.hypot(rr0 - fyc, cc - fxc);
      if (d < bd) { bd = d; best = [rr0, cc]; }
    }
    return best;
  }
  function updateGhost() {
    if (!drag || !G) return;
    const p = G.tray[drag.slot]; if (!p) return;
    const sh = shapeOf(p);
    const [l, t] = pieceTopLeft(drag, sh, S);
    const g = snap(sh, l, t);
    if (g && (!drag.ghost || g[0] !== drag.ghost[0] || g[1] !== drag.ghost[1])) sfx('tick', { volume: 0.25, rate: 1.4 });
    drag.ghost = g;
  }
  tcv.addEventListener('pointerdown', e => {
    if (phase !== 'play' || !G || drag) return;
    const slot = slotAt(e.clientX);
    if (!G.tray[slot]) return;
    e.preventDefault();
    kb = null;
    drag = { slot, id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', grow: 0, ghost: null };
    try { tcv.setPointerCapture(e.pointerId); } catch { /* 그대로 */ }
    sfx('blockPick');
    vibe(6);
    updateGhost();
  });
  tcv.addEventListener('pointermove', e => {
    if (!drag || drag.back || e.pointerId !== drag.id) return;
    drag.x = e.clientX; drag.y = e.clientY;
    updateGhost();
  });
  const release = (e: PointerEvent, cancel: boolean) => {
    if (!drag || drag.back || e.pointerId !== drag.id) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!cancel) updateGhost();
    const g = cancel ? null : drag.ghost;
    if (g && phase === 'play') { const s = drag.slot; drag = null; doPlace(s, g[0], g[1]); return; }
    // 놓을 수 없는 자리: 제자리로 돌아간다
    const p = G?.tray[drag.slot];
    if (p) { const [l, t] = pieceTopLeft(drag, shapeOf(p), S); drag.back = { t: 0, fx: l, fy: t }; }
    else drag = null;
    const over = cv.getBoundingClientRect();
    if (!cancel && e.clientY < over.bottom + 10) { sfx('blockNope'); vibe([8, 30, 8]); }
  };
  tcv.addEventListener('pointerup', e => release(e, false));
  tcv.addEventListener('pointercancel', e => release(e, true));

  // 키보드: 1·2·3 으로 조각 고르기 → 방향키로 옮기기 → Enter 놓기 (Esc 취소)
  addEventListener('keydown', e => {
    if (phase === 'home' || !$('overlay').classList.contains('hidden')) return;
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (kb) kb = null; else showPause(); e.preventDefault(); return; }
    if (phase !== 'play' || !G || drag) return;
    const n = ['1', '2', '3'].indexOf(e.key);
    if (n >= 0) {
      if (!G.tray[n]) { sfx('blockNope'); return; }
      const sh = shapeOf(G.tray[n]!), { h, w } = shapeSize(sh);
      let r = Math.floor((SIZE - h) / 2), c = Math.floor((SIZE - w) / 2);
      if (!canPlace(G.board, sh, r, c)) {
        let bd = Infinity;
        for (let rr0 = 0; rr0 <= SIZE - h; rr0++) for (let cc = 0; cc <= SIZE - w; cc++) if (canPlace(G.board, sh, rr0, cc)) { const d = Math.hypot(rr0 - r, cc - c); if (d < bd) { bd = d; r = rr0; c = cc; } }
        if (bd === Infinity) { r = Math.floor((SIZE - h) / 2); c = Math.floor((SIZE - w) / 2); }
      }
      kb = { slot: n, r, c }; sfx('blockPick'); e.preventDefault(); return;
    }
    if (!kb) return;
    const sh = shapeOf(G.tray[kb.slot]!), { h, w } = shapeSize(sh);
    const mv: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (mv[e.key]) {
      kb.r = Math.max(0, Math.min(SIZE - h, kb.r + mv[e.key][0]));
      kb.c = Math.max(0, Math.min(SIZE - w, kb.c + mv[e.key][1]));
      sfx('tick', { volume: 0.3 }); e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (canPlace(G.board, sh, kb.r, kb.c)) { const k = kb; kb = null; doPlace(k.slot, k.r, k.c); }
      else { sfx('blockNope'); shake = 3; }
    }
  });

  $('pauseBtn').addEventListener('click', () => { sfx('click'); showPause(); });
  $('startBtn').addEventListener('click', () => { sfx('click'); void startRun(); });
  $('rankBtn').addEventListener('click', () => { sfx('click'); void openRank(); });
  $('soundBtn').addEventListener('click', () => { sfx('click'); openSound(); });

  // ---------- 그리기 ----------
  /** 지금 끌거나 키보드로 고른 조각의 놓일 자리 + 지워질 줄 */
  function aim(): { sh: Shape; spirit: number; r: number; c: number; ok: boolean; rows: number[]; cols: number[] } | null {
    if (!G) return null;
    let slot = -1, r = 0, c = 0, ok = false;
    if (drag && !drag.back && drag.ghost) { slot = drag.slot; [r, c] = drag.ghost; ok = true; }
    else if (kb) { slot = kb.slot; r = kb.r; c = kb.c; }
    const p = slot >= 0 ? G.tray[slot] : null;
    if (!p) return null;
    const sh = shapeOf(p);
    if (kb) ok = canPlace(G.board, sh, r, c);
    const { rows, cols } = ok ? previewLines(G.board, sh, r, c) : { rows: [], cols: [] };
    return { sh, spirit: p.spirit, r, c, ok, rows, cols };
  }

  function drawBoard(T: number, k: number) {
    if (!G) return;
    const x = bx;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, BW, BW);
    x.fillStyle = BOARD_BG; x.fillRect(0, 0, BW, BW);
    if (shake > 0.3) { x.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.6); shake *= Math.pow(0.86, k); } else shake = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      x.fillStyle = (r + c) % 2 ? CELL : CELL_ALT;
      rr(x, c * S + 1.5, r * S + 1.5, S - 3, S - 3, S * 0.18); x.fill();
    }
    const a = aim();
    const lineSet = new Set<number>();
    if (a) { for (const rr0 of a.rows) for (let j = 0; j < SIZE; j++) lineSet.add(rr0 * SIZE + j); for (const cc of a.cols) for (let j = 0; j < SIZE; j++) lineSet.add(j * SIZE + cc); }
    const glow = 0.5 + 0.5 * Math.sin(T * 10);
    // 판 위 블록
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const i = r * SIZE + c, v = G.board[i];
      if (!v) continue;
      const grey = phase === 'dying' || phase === 'result' ? dieT > r * 0.09 : false;
      // 지워질 줄 미리 보기: 끄는 조각의 정령 색으로 바뀌어 반짝인다
      const sp = lineSet.has(i) && a ? a.spirit : v - 1;
      let s = S;
      const ld = lands.get(i);
      if (ld) { s = S * (1 + Math.sin(ld * Math.PI) * 0.12); const nv = ld - 0.09 * k; if (nv <= 0) lands.delete(i); else lands.set(i, nv); }
      x.drawImage(tile(sp, S, dpr, grey), (c + 0.5) * S - s / 2, (r + 0.5) * S - s / 2, s, s);
    }
    // 놓일 자리 그림자
    if (a) {
      x.globalAlpha = a.ok ? 0.5 : 0.3;
      for (const [dr, dc] of a.sh.cells) {
        const r = a.r + dr, c = a.c + dc;
        if (a.ok) x.drawImage(tile(a.spirit, S, dpr), c * S, r * S, S, S);
        else { x.fillStyle = 'rgba(255,90,90,0.7)'; rr(x, c * S + 3, r * S + 3, S - 6, S - 6, S * 0.18); x.fill(); }
      }
      x.globalAlpha = 1;
      if (kb) {
        x.strokeStyle = a.ok ? WHITE : '#FF8A8A'; x.lineWidth = 3;
        for (const [dr, dc] of a.sh.cells) { rr(x, (a.c + dc) * S + 2, (a.r + dr) * S + 2, S - 4, S - 4, S * 0.18); x.stroke(); }
      }
      // 지워질 줄 반짝임
      if (lineSet.size) {
        x.save(); x.globalCompositeOperation = 'lighter';
        x.fillStyle = `rgba(255,250,220,${0.12 + glow * 0.22})`;
        for (const rr0 of a.rows) { rr(x, 1, rr0 * S + 1, BW - 2, S - 2, S * 0.2); x.fill(); }
        for (const cc of a.cols) { rr(x, cc * S + 1, 1, S - 2, BW - 2, S * 0.2); x.fill(); }
        x.restore();
      }
    }
    // 지워지는 정령: 한 칸씩 차례로 튀어 오르며 사라짐
    pops = pops.filter(p => p.t < 1);
    for (const p of pops) {
      if (p.delay > 0) { p.delay -= k / 60; x.drawImage(tile(p.spirit, S, dpr), p.c * S, p.r * S, S, S); continue; }
      if (!p.burst) { p.burst = true; fx.burst(SPIRITS[p.spirit], (p.c + 0.5) * S, (p.r + 0.5) * S, 7, S); }
      p.t += 0.055 * k;
      const X = (p.c + 0.5) * S, Y = (p.r + 0.5) * S - Math.sin(Math.min(1, p.t * 1.4) * Math.PI) * S * 0.7 - p.t * S * 0.3;
      x.save(); x.globalAlpha = Math.max(0, 1 - p.t);
      x.translate(X, Y); const s = (1 + p.t * 0.35) * S / 50; x.scale(s, s);
      SPR.draw(x, SPIRITS[p.spirit], T * 1.5, null, null);
      x.restore();
    }
    fx.draw(x, k);
  }

  function drawPiece(x: CanvasRenderingContext2D, sh: Shape, spirit: number, left: number, top: number, cell: number, grey = false) {
    for (const [r, c] of sh.cells) x.drawImage(tile(spirit, cell, dpr, grey), left + c * cell, top + r * cell, cell, cell);
  }
  function drawTray(k: number) {
    const x = tx;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, TW, TH);
    if (!G) return;
    const sw = TW / 3;
    for (let i = 0; i < 3; i++) {
      const p = G.tray[i];
      if (!p) continue;
      if (drag && drag.slot === i && !drag.back) continue;
      const sh = shapeOf(p), { h, w } = shapeSize(sh);
      const fits = fitsAnywhere(G.board, sh);
      let cell = TS;
      if (trayPop[i] > 0) { cell = TS * (1 - Math.sin(trayPop[i] * Math.PI) * 0.25 - trayPop[i] * 0.4); trayPop[i] = Math.max(0, trayPop[i] - 0.08 * k); }
      const left = (i + 0.5) * sw - (w * cell) / 2, top = TH / 2 - (h * cell) / 2;
      // 놓을 수 없는 조각은 흐리게
      x.globalAlpha = fits ? 1 : 0.4;
      drawPiece(x, sh, p.spirit, left, top, cell, !fits);
      x.globalAlpha = 1;
      if (kb && kb.slot === i) { x.strokeStyle = WHITE; x.lineWidth = 3; rr(x, i * sw + 6, 4, sw - 12, TH - 8, 14); x.stroke(); }
      if (FINE) { x.font = '13px Jua, sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(42,26,16,0.35)'; x.fillText(String(i + 1), i * sw + 12, 14); }
    }
  }
  function drawDrag(k: number) {
    const x = dx;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, innerWidth, innerHeight);
    if (!drag || !G) return;
    const p = G.tray[drag.slot];
    if (!p) { drag = null; return; }
    const sh = shapeOf(p), { h, w } = shapeSize(sh);
    if (drag.back) {
      // 제자리로 돌아가는 중
      drag.back.t += 0.12 * k;
      const t = Math.min(1, drag.back.t), e = 1 - Math.pow(1 - t, 3);
      const cell = S + (TS - S) * e;
      const [cx, cy] = slotCenter(drag.slot);
      const l = drag.back.fx + (cx - (w * cell) / 2 - drag.back.fx) * e, tp = drag.back.fy + (cy - (h * cell) / 2 - drag.back.fy) * e;
      drawPiece(x, sh, p.spirit, l, tp, cell);
      if (t >= 1) drag = null;
      return;
    }
    drag.grow = Math.min(1, drag.grow + 0.2 * k);
    const cell = TS + (S - TS) * drag.grow;
    let [l, t] = pieceTopLeft(drag, sh, cell);
    if (drag.ghost) {
      // 자석: 놓일 칸 쪽으로 살짝 당겨진다
      const r = cv.getBoundingClientRect();
      const gx = r.left + drag.ghost[1] * S, gy = r.top + drag.ghost[0] * S;
      l += (gx - l) * 0.45; t += (gy - t) * 0.45;
    }
    x.save(); x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 12; x.shadowOffsetY = 6;
    drawPiece(x, sh, p.spirit, l, t, cell);
    x.restore();
  }

  // ---------- 반복 ----------
  let last = performance.now(), T0 = 0;
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; T0 += dt;
    const k = dt * 60;
    if (G && phase !== 'home') {
      if (phase === 'dying') {
        dieT += dt;
        if (dieT > SIZE * 0.09 + 0.7) void finishRun();
      }
      drawBoard(T0, k);
      drawTray(k);
      drawDrag(k);
      if (scene.st.on) { scene.update(dt); scene.draw(); }
    }
    requestAnimationFrame(frame);
  }
  renderHome();
  bgm('main');
  void api.flush().then(n => { if (n) void refreshInfo(); });
  requestAnimationFrame(frame);
  if (local) (window as unknown as Record<string, unknown>).__block = { get G() { return G; }, get phase() { return phase; }, get log() { return log; }, place: doPlace, startRun, get texts() { return fx.texts; }, get result() { return lastResult; } };
}
