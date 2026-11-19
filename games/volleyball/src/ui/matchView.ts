import Phaser from 'phaser';
import { COURT_H, COURT_W, WIN_SCORE } from '../game/constants';
import type { Side } from '../game/sim';
import { Match, type MatchEvent, type MatchSetup } from '../match/game';
import { OnlineMatch } from '../match/online';
import { getAiRpc, serverNow } from '../net/api';
import { MatchRecorder, forfeitResult, pendingStore } from '../net/record';
import { AiMatchRecorder, localPending } from '../net/aiRecord';
import { CourtScene, type SceneData } from '../scenes/CourtScene';
import { zodiacFaceUrl } from '../assets';
import { esc, leaveRoom, nav, openSettings, screen, stage, state, toast } from './app';
import { DPR } from './dpr';
import { sfx } from './sfx';

declare global {
  interface Window {
    /** 점검용: 지금 진행 중인 경기 */
    __match?: Match;
    /** 점검용: 방금 끝난 온라인 경기의 동기화 수치 */
    __lastStats?: unknown;
  }
}

type Btn = 'left' | 'right' | 'jump';

/** 경기 화면: 위에서부터 점수판 160 · 경기장 840 · 조작 280 (세로 720×1280 기준) */
export function showMatch(setup: MatchSetup) {
  const online = setup.mode === 'online';
  const room = online ? state.room : null;
  if (online && !room) return nav.lobby();
  const match: Match = room ? new OnlineMatch(setup, room, serverNow) : new Match(setup);
  window.__match = match;
  // 온라인: 경기 시작을 서버에 알린다 (두 기기가 각자). 끝나면 결과를 보고한다
  const recorder = room && state.api ? new MatchRecorder(state.api, room.key, setup, { store: pendingStore(state.user.id) }) : null;
  // AI 대전: 경기 시작을 서버에 알리고, 끝나면 승패를 올린다. 도중에 나가면 최소 시간(15초)이 지난 경기는 패배, 아니면 기록 없음.
  // 못 올린 결과는 기기에 맡겨 두었다가 다음 경기 시작 전에 다시 올린다 (새 경기를 시작하면 서버가 끝내지 않은 경기를 패배로 마감하므로)
  const aiRecorder = online ? null : new AiMatchRecorder(getAiRpc(setup.fighters[setup.mySide].char), { store: localPending(`siavolley:ai-pending:${state.user.id}`) });
  // 그림을 받는 동안에도 경기 시계가 돌게 한다 (방장이 늦게 시작해 상대만 기다리지 않도록). 화면이 그려지기 시작하면 멈춘다
  let drawing = false;
  const pump = online ? setInterval(() => drawing || match.update(performance.now()), 50) : null;
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
        <div class="speed" id="speed">${online ? '' : 'AI 대전'}</div></div>
      ${side(1)}</div>
    <div class="court bg${setup.bg}" id="court"><div class="cutin" id="cutin"></div><div class="waitbox hidden" id="waitbox"></div></div>
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
      if (pump) clearInterval(pump);
      ro?.disconnect();
      if (resultTimer) clearTimeout(resultTimer);
      if (cutTimer) clearTimeout(cutTimer);
      match.dispose();
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
  const waitbox = $('#waitbox');
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
    // 버튼에 포커스가 남으면 스페이스(점프)가 이 버튼을 다시 누른다
    (document.activeElement as HTMLElement | null)?.blur();
    releaseAll();
    // 온라인 경기는 멈출 수 없다 (창이 떠 있어도 계속 진행)
    if (!online) match.paused = true;
    // AI 대전: 시작하고 최소 시간이 지난 경기는 나가면 패배 (물을 때 기준으로 정한다)
    const forfeit = !!aiRecorder && match.phase !== 'over' && aiRecorder.forfeitable();
    const dim = document.createElement('div');
    dim.className = 'dim';
    dim.innerHTML = `<div class="dialog"><h3>경기를 그만둘까요?</h3><p class="soft" style="text-align:center;margin:0">${online || forfeit ? '지금 나가면 패배로 기록돼요' : '지금 나가면 이 경기는 기록되지 않아요'}</p>
      <div class="actions"><button class="btn" data-no>계속하기</button><button class="btn primary" data-yes>나가기</button></div></div>`;
    dim.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-yes]')) {
        sfx('click');
        dim.remove();
        if (match.phase !== 'over') {
          // AI가 이어받은 경기에서 남은 나까지 나간다: 몰수패(AI 3점)로 보고해야 이 경기가 기록된다 (나간 상대도 패, 나도 패)
          const solo = match instanceof OnlineMatch && match.solo;
          if (solo && recorder) void recorder.finish(forfeitResult(setup, match.state.score));
          // 온라인: 상대에게 알리고(내 자리는 AI가 이어받는다) 방에서도 나간다.
          // 남은 사람의 경기는 계속되므로 방의 '경기 끝'은 알리지 않는다 (이미 혼자였으면 알린다)
          match.quit();
          // AI 대전: 패배로 올리거나(최소 시간이 지난 경기) 서버에서 지운다. 통신을 기다리지 않고 나간다
          if (aiRecorder) void aiRecorder.leave(forfeit);
          if (room) {
            room.matchOver(setup.matchNo ?? 0, solo);
            leaveRoom();
          }
        } else if (room) {
          // 경기가 끝난 직후(결과 화면으로 넘어가기 전)에 나가기: 방에서도 나간다
          leaveRoom();
        }
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
    (document.activeElement as HTMLElement | null)?.blur();
    releaseAll();
    if (online) return openSettings();
    match.paused = true;
    openSettings(() => (match.paused = false));
  });

  match.onOver = (result) => {
    // 방은 대기 상태로 돌아간다 (방 목록의 '경기중' 표시도 풀린다).
    // 내가 끊겼던 쪽이면 남은 사람은 아직 AI와 경기 중이므로 내 기기에서만 정리한다
    const iLeft = result.reason === 'leave' && result.leaver === me;
    // 방장이 정상 종료했으면 결과도 함께 알린다 (상대가 끝 스냅샷을 못 받았어도 같은 결과로 끝나게)
    room?.matchOver(setup.matchNo ?? 0, !iLeft, result.reason === 'normal' && me === 0 ? { score: result.score, winner: result.winner } : undefined);
    if (match instanceof OnlineMatch) window.__lastStats = { side: me, solo: match.solo, ...match.stats };
    if (recorder) result.record = recorder.finish(result);
    if (aiRecorder) result.aiRecord = aiRecorder.finish(result.winner === me);
    stage.querySelector('.dim')?.remove();
    waitbox.classList.add('hidden');
    if (iLeft) {
      setCut('패배…<small>연결이 끊겨 AI가 대신했어요</small>', 'bad');
      cutin.dataset.k = 'over';
      sfx('volleyMiss');
      releaseAll();
    }
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
  let lastWait = 0;
  function frame(events: MatchEvent[]) {
    drawing = true;
    // 상대 연결을 기다리는 중 (10초가 지나면 AI가 상대 캐릭터를 이어받는다)
    if (match.waitingSec !== lastWait) {
      lastWait = match.waitingSec;
      waitbox.classList.toggle('hidden', lastWait <= 0);
      if (lastWait > 0) waitbox.innerHTML = `상대 연결을 기다리는 중…<small>${lastWait}초 뒤에도 돌아오지 않으면 AI가 대신해요</small>`;
    }
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
          speedEl.textContent = online ? '' : 'AI 대전';
          speedEl.classList.remove('fast');
          break;
        case 'takeover': {
          // 상대가 나갔다: 그 자리의 캐릭터를 AI가 이어받아 끝까지 한다
          const nm = root.querySelector(`.side.s${e.side} .nm`);
          if (nm) nm.innerHTML = `<i class="ai-tag">AI</i>${esc(setup.fighters[e.side].name)}`;
          // 오른쪽 기기가 넘겨받은 경우: 방장이 확인해 주기 전에 미리 계산해 둔 점수가 이제 진짜 점수다
          paintScore();
          toast('상대가 나가서 AI가 대신해요', 3200);
          sfx('toggle');
          break;
        }
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
    const data: SceneData = { match, bg: setup.bg, zoom: (w * DPR) / COURT_W, sfx: (name, opts) => sfx(name, opts), onFrame: frame };
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
