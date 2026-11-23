import Phaser from 'phaser';
import { END_AFTER_GO, TRACK_LEN } from '../game/constants';
import { formatTime, livePlace } from '../game/ranking';
import type { SoloStart } from '../net/solo';
import { RaceGame } from '../race/game';
import { RaceScene, type SceneData } from '../scenes/RaceScene';
import { zodiacFaceUrl } from '../assets';
import { nav, screen, stage, state } from './app';
import { DPR } from './dpr';
import { sfx } from './sfx';

declare global {
  interface Window {
    /** 점검용: 지금 진행 중인 판 */
    __race?: RaceGame;
  }
}

/** 경기 화면: 위에서부터 HUD 15% · 트랙 55% · 버튼 30% */
export function showRace(start: SoloStart) {
  const api = state.api;
  if (!api) return nav.lobby();
  const race = new RaceGame(api, start);
  window.__race = race;
  // 판 전 이번 주 순위 (결과 화면이 판 뒤 순위와 비교해 '이번 주 N위 ↑'). 오늘의 도전 날짜가 있는 판만.
  // 앞 판 기록이 아직 올라가는 중이면(결과 화면에서 바로 '다시 도전') 그것이 끝난 뒤에 읽는다
  const prevDaily = state.dailyAfter;
  state.dailyAfter = null;
  if (start.day)
    race.weekBefore = (prevDaily ? prevDaily.catch(() => undefined) : Promise.resolve())
      .then(() => api.weeklyPlace())
      .catch(() => undefined);
  const me = race.mySlot;

  let game: Phaser.Game | null = null;
  let ro: ResizeObserver | null = null;
  let resultTimer: ReturnType<typeof setTimeout> | null = null;
  /** '경기를 그만둘까요?' 창 (#stage 에 붙으므로 화면이 바뀔 때 함께 치운다) */
  let quitDim: HTMLElement | null = null;
  // 키보드: 점프 = 스페이스·↑·W·엔터, 슬라이딩 = ↓·S
  const keyKind = (code: string): 'jump' | 'slide' | null =>
    code === 'Space' || code === 'Enter' || code === 'ArrowUp' || code === 'KeyW' ? 'jump' : code === 'ArrowDown' || code === 'KeyS' ? 'slide' : null;
  const onKey = (e: KeyboardEvent) => {
    const kind = keyKind(e.code);
    if (!kind) return;
    e.preventDefault();
    if (!e.repeat) press(kind);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (keyKind(e.code)) up();
  };

  const root = screen(
    `<div class="hud">
      <div class="hud-top">
        <button class="icon-btn" id="quit" aria-label="나가기">✕</button>
        <div class="time" id="time">0.00<small>초</small></div>
        <div class="place" id="place"><b>-</b>등</div>
      </div>
      <div class="prog" id="prog"><div class="rail"><i></i></div><span class="flag">🏁</span>
        ${race.roster.map((r) => `<img data-slot="${r.slot}" class="${r.slot === me ? 'me' : r.role === 'ghost' ? 'ghost' : ''}" src="${zodiacFaceUrl(r.char)}" alt="" />`).join('')}
      </div>
    </div>
    <div class="track" id="track"><div class="cutin" id="cutin"></div></div>
    <div class="pad solo" id="pad"><div class="pad-btns"><div class="go-btn slide" id="slide">슬라이딩</div><div class="go-btn" id="go">출발</div></div>
      <p class="hint" id="hint">스페이스 키 · 이 아래 아무 곳이나 눌러도 돼요</p></div>`,
    'race',
    'race',
    () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      ro?.disconnect();
      if (resultTimer) clearTimeout(resultTimer);
      quitDim?.remove();
      quitDim = null;
      // 이 판의 기록 올리기가 아직 끝나지 않았을 수 있다: 다음 판의 판 전 주간 순위는 이것을 기다린다
      if (race.dailySaved) state.dailyAfter = race.dailySaved;
      race.dispose();
      game?.destroy(true);
      game = null;
      if (window.__race === race) delete window.__race;
    },
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const trackEl = $('#track');
  const pad = $('#pad');
  const goBtn = $('#go');
  const hint = $('#hint');
  const timeEl = $('#time');
  const placeEl = $('#place');
  const cutin = $('#cutin');
  const rail = $<HTMLElement>('.rail i');
  const icons = [...root.querySelectorAll<HTMLImageElement>('#prog img')];

  /** 버튼이 둘(슬라이딩·점프)로 나뉘어 있는가. 출발 전에는 '출발' 하나 */
  let split = false;
  function press(kind: 'jump' | 'slide') {
    // 출발 전에는 어느 쪽을 눌러도 출발
    const k = split ? kind : 'jump';
    pad.classList.add(k === 'slide' ? 'down-l' : 'down');
    race.press(k);
  }
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // 버튼 영역 어디를 눌러도 인식: 왼쪽 반은 슬라이딩, 오른쪽 반은 점프
    const box = pad.getBoundingClientRect();
    press(e.clientX < box.left + box.width / 2 ? 'slide' : 'jump');
  });
  function up() {
    pad.classList.remove('down', 'down-l');
  }
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  pad.addEventListener('pointerleave', up);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  $('#quit').addEventListener('click', () => {
    if (quitDim?.isConnected) return;
    const dim = document.createElement('div');
    quitDim = dim;
    dim.className = 'dim';
    dim.innerHTML = `<div class="dialog"><h3>경기를 그만둘까요?</h3><p class="soft" style="text-align:center;margin:0">나가면 이번 판 기록은 남지 않아요</p>
      <div class="actions"><button class="btn" data-no>계속 달리기</button><button class="btn primary" data-yes>나가기</button></div></div>`;
    dim.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-yes]')) {
        dim.remove();
        nav.lobby();
      } else if (el === dim || el.closest('[data-no]')) dim.remove();
    });
    stage.append(dim);
  });

  race.onOver = (results) => {
    resultTimer = setTimeout(() => nav.result(race, results), 1400);
  };

  // ---------- 가운데 큰 글자 (준비 · GO · 실격 · 도착) ----------
  let cutKey = '';
  function setCut(key: string, html: string, cls = '') {
    if (key === cutKey) return;
    cutKey = key;
    cutin.className = `cutin ${cls}`;
    cutin.innerHTML = html;
    if (html) {
      void cutin.offsetWidth;
      cutin.classList.add('pop');
    }
  }

  // ---------- 매 프레임: HUD ----------
  let lastPhase = '';
  let lastTime = '';
  let lastPlace = 0;
  let lastBtn = '';
  function frame() {
    const phase = race.phase();
    const t = race.clock();
    const mine = me >= 0 ? race.view(me) : null;
    if (phase !== lastPhase) {
      if (phase === 'ready') sfx('raceReady');
      if (phase === 'go' && lastPhase !== '') sfx('raceGo');
      lastPhase = phase;
    }
    // 큰 글자
    if (mine?.state === 'foul') setCut('foul', '실격!<small>GO 전에 눌렀어요</small>', 'bad');
    else if (mine?.finishMs != null && race.amRacing()) setCut('fin', `도착!<small>${formatTime(mine.finishMs)}초</small>`, 'go');
    else if (phase === 'intro') setCut('intro', '제자리에');
    else if (phase === 'ready') setCut('ready', '준비');
    else if (phase === 'go' && t < 0.9) setCut('go', 'GO!', 'go');
    else if (phase === 'over') setCut('over', '경기 끝!');
    else setCut('', '');

    // 시간: 내가 도착하면 그 기록에서 멈춘다
    const ms = mine?.finishMs ?? Math.max(0, Math.min(t, END_AFTER_GO) * 1000);
    const ts = formatTime(ms);
    if (ts !== lastTime) {
      lastTime = ts;
      timeEl.firstChild!.textContent = ts;
    }
    const entries = race.entries();
    const place = me >= 0 ? livePlace(entries, me) : 0;
    if (place !== lastPlace) {
      lastPlace = place;
      placeEl.innerHTML = place ? `<b>${place}</b>등` : '구경';
    }
    for (const img of icons) {
      const v = race.view(Number(img.dataset.slot));
      img.style.left = `${Math.min(100, (v.x / TRACK_LEN) * 100).toFixed(1)}%`;
    }
    if (mine) rail.style.width = `${Math.min(100, (mine.x / TRACK_LEN) * 100).toFixed(1)}%`;

    // 버튼: 출발 전 '출발' 하나, 달리는 중에는 '슬라이딩'(왼쪽)과 '점프'(오른쪽)
    let label = '출발';
    let off = false;
    if (!mine || !race.amRacing()) [label, off] = ['구경 중', true];
    else if (mine.state === 'foul') [label, off] = ['실격', true];
    else if (mine.state === 'done') [label, off] = ['도착!', true];
    else if (mine.state !== 'wait') label = '점프';
    if (label !== lastBtn) {
      lastBtn = label;
      goBtn.textContent = label;
      goBtn.classList.toggle('off', off);
      split = label === '점프';
      pad.classList.toggle('solo', !split);
      hint.textContent = split ? '슬라이딩 ↓·S  ·  점프 스페이스·↑' : '스페이스 키 · 이 아래 아무 곳이나 눌러도 돼요';
    }

  }

  // ---------- Phaser ----------
  const size = () => ({ w: Math.max(200, trackEl.clientWidth), h: Math.max(160, trackEl.clientHeight) });
  const data = (): SceneData => {
    const { w, h } = size();
    return { race, width: w, height: h, dpr: DPR, sfx: (name, opts) => sfx(name, opts), onFrame: frame };
  };
  const boot = () => {
    const { w, h } = size();
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: trackEl,
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
    game.scene.add('race', RaceScene, true, data());
    let last = `${w}x${h}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const s = size();
        const key = `${s.w}x${s.h}`;
        if (key === last || !game) return;
        last = key;
        // 화면 크기가 바뀌면 캔버스를 다시 맞추고 장면을 새로 그린다 (경기 상태는 그대로)
        game.scale.resize(Math.round(s.w * DPR), Math.round(s.h * DPR));
        game.scene.getScene('race')?.scene.restart(data());
      }, 150);
    });
    ro.observe(trackEl);
  };
  // 글꼴을 먼저 받아야 이름표가 제 글꼴로 그려진다
  const fonts = document.fonts?.load ? Promise.race([document.fonts.load('16px Jua'), new Promise((r) => setTimeout(r, 1200))]) : Promise.resolve();
  void fonts.then(
    () => root.isConnected && boot(),
    () => root.isConnected && boot(),
  );
  frame();
}
