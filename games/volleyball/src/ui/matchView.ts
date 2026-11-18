import Phaser from 'phaser';
import { COURT_H, COURT_W, WIN_SCORE } from '../game/constants';
import type { Side } from '../game/sim';
import { Match, type MatchEvent, type MatchSetup } from '../match/game';
import { CourtScene, type SceneData } from '../scenes/CourtScene';
import { zodiacFaceUrl } from '../assets';
import { esc, nav, openSettings, screen, stage } from './app';
import { DPR } from './dpr';
import { sfx } from './sfx';

declare global {
  interface Window {
    /** 점검용: 지금 진행 중인 경기 */
    __match?: Match;
  }
}

type Btn = 'left' | 'right' | 'jump';

/** 경기 화면: 위에서부터 점수판 160 · 경기장 840 · 조작 280 (세로 720×1280 기준) */
export function showMatch(setup: MatchSetup) {
  const match = new Match(setup);
  window.__match = match;
  const me = match.mySide;

  let game: Phaser.Game | null = null;
  let ro: ResizeObserver | null = null;
  let resultTimer: ReturnType<typeof setTimeout> | null = null;
  let cutTimer: ReturnType<typeof setTimeout> | null = null;

  const side = (s: Side) => {
    const f = setup.fighters[s];
    return `<div class="side s${s} ${s === me ? 'me' : ''}">
      <img class="av" src="${zodiacFaceUrl(f.char)}" alt="" />
      <div class="who"><span class="nm">${esc(f.name)}</span><span class="dots" id="dots${s}">${'<i></i>'.repeat(WIN_SCORE)}</span></div>
      <b class="pt" id="pt${s}">0</b></div>`;
  };
  const root = screen(
    `<div class="score">${side(0)}
      <div class="mid"><div class="mid-btns"><button class="icon-btn" id="quit" aria-label="나가기">✕</button><button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
        <div class="speed" id="speed">${setup.mode === 'ai' ? '연습 경기' : ''}</div></div>
      ${side(1)}</div>
    <div class="court" id="court"><div class="cutin" id="cutin"></div></div>
    <div class="pad" id="pad">
      <div class="pad-move"><div class="pbtn" data-b="left">◀</div><div class="pbtn" data-b="right">▶</div></div>
      <div class="pbtn jump" data-b="jump">점프</div>
    </div>`,
    'match',
    'match',
    () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      ro?.disconnect();
      if (resultTimer) clearTimeout(resultTimer);
      if (cutTimer) clearTimeout(cutTimer);
      game?.destroy(true);
      game = null;
      if (window.__match === match) delete window.__match;
    },
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const courtEl = $('#court');
  const pad = $('#pad');
  const cutin = $('#cutin');
  const speedEl = $('#speed');
  const btnEls: Record<Btn, HTMLElement> = { left: $('[data-b="left"]'), right: $('[data-b="right"]'), jump: $('[data-b="jump"]') };

  // ---------- 조작: 키보드 + 터치(여러 손가락) → match.input ----------
  const keys = new Set<Btn>();
  /** 손가락(포인터) 번호 → 누르고 있는 버튼 */
  const touches = new Map<number, Btn>();
  /** 좌우를 함께 누르면 나중에 누른 쪽으로 */
  let lastDir: 'left' | 'right' = 'right';
  function apply() {
    const on = (b: Btn) => keys.has(b) || [...touches.values()].includes(b);
    const l = on('left');
    const r = on('right');
    match.input.left = l && (!r || lastDir === 'left');
    match.input.right = r && (!l || lastDir === 'right');
    match.input.jump = on('jump');
    for (const b of ['left', 'right', 'jump'] as const) btnEls[b].classList.toggle('down', on(b));
  }
  const keyBtn = (code: string): Btn | null =>
    code === 'ArrowLeft' || code === 'KeyA' ? 'left' : code === 'ArrowRight' || code === 'KeyD' ? 'right' : code === 'ArrowUp' || code === 'KeyW' || code === 'Space' ? 'jump' : null;
  const onKey = (e: KeyboardEvent) => {
    const b = keyBtn(e.code);
    if (!b || stage.querySelector('.dim')) return;
    e.preventDefault();
    if (e.repeat) return;
    keys.add(b);
    if (b !== 'jump') lastDir = b;
    apply();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const b = keyBtn(e.code);
    if (!b) return;
    keys.delete(b);
    apply();
  };
  function releaseAll() {
    keys.clear();
    touches.clear();
    apply();
  }
  /** 조작 영역의 어느 버튼 자리인가: 왼쪽 절반을 둘로 나눠 ◀ ▶, 오른쪽 절반은 점프 (버튼 그림보다 넓게 잡는다) */
  function zone(e: PointerEvent): Btn {
    const box = pad.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    return x < 0.27 ? 'left' : x < 0.54 ? 'right' : 'jump';
  }
  const onTouch = (e: PointerEvent) => {
    e.preventDefault();
    const b = zone(e);
    if (touches.get(e.pointerId) === b) return;
    touches.set(e.pointerId, b);
    if (b !== 'jump') lastDir = b;
    apply();
  };
  pad.addEventListener('pointerdown', (e) => {
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      /* 잡지 못해도 계속 */
    }
    onTouch(e);
  });
  // 누른 채로 옆 버튼으로 미끄러지면 그 버튼으로 바뀐다
  pad.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) onTouch(e);
  });
  const onTouchEnd = (e: PointerEvent) => {
    if (touches.delete(e.pointerId)) apply();
  };
  pad.addEventListener('pointerup', onTouchEnd);
  pad.addEventListener('pointercancel', onTouchEnd);
  pad.addEventListener('lostpointercapture', onTouchEnd);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);

  // ---------- 나가기·설정 (창이 떠 있는 동안 AI 경기는 멈춘다) ----------
  $('#quit').addEventListener('click', () => {
    sfx('click');
    releaseAll();
    match.paused = true;
    const dim = document.createElement('div');
    dim.className = 'dim';
    dim.innerHTML = `<div class="dialog"><h3>경기를 그만둘까요?</h3><p class="soft" style="text-align:center;margin:0">연습 경기라 기록은 남지 않아요</p>
      <div class="actions"><button class="btn" data-no>계속하기</button><button class="btn primary" data-yes>나가기</button></div></div>`;
    dim.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-yes]')) {
        sfx('click');
        dim.remove();
        nav.lobby();
      } else if (el === dim || el.closest('[data-no]')) {
        sfx('click');
        dim.remove();
        match.paused = false;
      }
    });
    stage.append(dim);
  });
  $('#settings').addEventListener('click', () => {
    releaseAll();
    match.paused = true;
    openSettings(() => (match.paused = false));
  });

  match.onOver = (result) => {
    resultTimer = setTimeout(() => nav.result(result), 1800);
  };

  // ---------- 가운데 큰 글자 (3·2·1 · 시작 · 득점 · 승리) ----------
  function setCut(html: string, cls = '', ms = 0) {
    if (cutTimer) clearTimeout(cutTimer);
    cutTimer = null;
    cutin.className = `cutin ${cls}`;
    cutin.innerHTML = html;
    if (!html) return;
    void cutin.offsetWidth;
    cutin.classList.add('pop');
    if (ms > 0) cutTimer = setTimeout(() => setCut(''), ms);
  }

  function paintScore() {
    const sc = match.state.score;
    for (const s of [0, 1] as const) {
      $(`#pt${s}`).textContent = String(sc[s]);
      $(`#dots${s}`).querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < sc[s]));
    }
  }
  function bump(s: Side) {
    const el = $(`#pt${s}`);
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  // ---------- 매 프레임: 이번에 생긴 일을 점수판·큰 글자에 반영 ----------
  function frame(events: MatchEvent[]) {
    for (const e of events) {
      switch (e.t) {
        case 'count':
          setCut(String(e.n));
          break;
        case 'go':
          setCut('시작!', 'go', 700);
          break;
        case 'serve':
          if (cutin.dataset.k === 'point') {
            setCut('');
            delete cutin.dataset.k;
          }
          speedEl.textContent = setup.mode === 'ai' ? '연습 경기' : '';
          speedEl.classList.remove('fast');
          break;
        case 'speedup':
          speedEl.textContent = `⚡ 빠르기 +${e.stage * 10}%`;
          speedEl.classList.add('fast');
          break;
        case 'point': {
          paintScore();
          bump(e.side);
          const sc = match.state.score;
          if (match.state.phase !== 'over') {
            setCut(`${e.side === me ? '득점!' : '실점…'}<small>${sc[0]} : ${sc[1]}</small>`, e.side === me ? 'go' : 'bad');
            cutin.dataset.k = 'point';
          }
          break;
        }
        case 'over': {
          const sc = match.state.score;
          setCut(`${e.winner === me ? '승리!' : '패배…'}<small>${sc[0]} : ${sc[1]}</small>`, e.winner === me ? 'go' : 'bad');
          cutin.dataset.k = 'over';
          releaseAll();
          break;
        }
      }
    }
  }

  // ---------- Phaser: 캔버스는 화면 크기 × 기기 픽셀 배율, 장면 좌표는 720×840 ----------
  const size = () => {
    const w = Math.max(120, courtEl.clientWidth);
    return { w, h: Math.round((w * COURT_H) / COURT_W) };
  };
  const boot = () => {
    const { w, h } = size();
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: courtEl,
      width: Math.round(w * DPR),
      height: Math.round(h * DPR),
      backgroundColor: '#9fd6ff',
      banner: false,
      audio: { noAudio: true },
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      scale: { mode: Phaser.Scale.NONE, autoRound: true },
      render: { antialias: true, powerPreference: 'high-performance' },
      scene: [],
    });
    const data: SceneData = { match, zoom: (w * DPR) / COURT_W, sfx: (name, opts) => sfx(name, opts), onFrame: frame };
    game.scene.add('court', CourtScene, true, data);
    let last = w;
    let timer: ReturnType<typeof setTimeout> | null = null;
    ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const s = size();
        if (s.w === last || !game) return;
        last = s.w;
        // 화면 크기가 바뀌면 캔버스와 카메라 배율만 다시 맞춘다 (경기는 그대로)
        game.scale.resize(Math.round(s.w * DPR), Math.round(s.h * DPR));
        (game.scene.getScene('court') as CourtScene | null)?.setZoom((s.w * DPR) / COURT_W);
      }, 150);
    });
    ro.observe(courtEl);
  };
  // 글꼴을 먼저 받아야 이름표가 제 글꼴로 그려진다
  const fonts = document.fonts?.load ? Promise.race([document.fonts.load('16px Jua'), new Promise((r) => setTimeout(r, 1200))]) : Promise.resolve();
  void fonts.then(
    () => root.isConnected && boot(),
    () => root.isConnected && boot(),
  );
  paintScore();
}
