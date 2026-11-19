import Phaser from 'phaser';
import { BOARD_H, MAX_LV, RUN_SEC, SLOT_SIZE, SQUAD_SIZE, VIEW_W, WAVES, WAVE_SEC } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { stageBg } from '../data/stages';
import { TOWERS } from '../data/characters';
import { ENEMIES, ENEMY_INDEX } from '../data/enemies';
import { ACT, DASH } from '../game/bosses';
import { endlessBoss, endlessWave } from '../data/endless';
import { endlessCoins, partialCoins } from '../game/progress';
import { activeBoss, canPlace, sellValue, towerLevel, upgradeCost } from '../game/sim';
import { EV, type Ev, type State } from '../game/state';
import { presetUpgrades } from '../data/growth';
import { ApiError, LOCAL_MODE } from '../net/api';
import { fillBench } from '../run/devtools';
import { Run, SPEEDS, type Speed } from '../run/run';
import { GameScene, type SceneData } from '../scenes/GameScene';
import { artUrl, zodiacFaceUrl } from '../assets';
import { esc, mmss, nav, screen, setProfile, stage, state, toast, whyText, type GameResult, type GameSetup } from './app';
import { levelText } from './codex';
import { DPR } from './dpr';
import { bgTrack, music } from './music';
import { attackSfx, sfx, sound } from './sfx';

declare global {
  interface Window {
    /** 점검용: 지금 진행 중인 판 (테스트 모드에서만). slotAt(i) = i번 배치 칸의 화면 좌표 · bench(n) = 성능 재기 (run/devtools.ts) */
    __def?: { run: Run; game: Phaser.Game | null; slotAt: (i: number) => { x: number; y: number }; bench: (enemies?: number) => { enemies: number; towers: number } };
  }
}

/** 판은 위 HUD(이만큼)와 아래 카드(이만큼) 사이 가운데에 온다 (가로 720 기준 px) */
const TOP_PAD = 150;
const BOT_PAD = 250;
/** 이만큼(px, 판 좌표) 안쪽을 누르면 그 배치 칸을 누른 것으로 본다 */
const SLOT_HIT = SLOT_SIZE / 2 + 8;

/** 배속 선택을 기기에 기억한다 (다음 판도 같은 배속으로 시작) */
const SPEED_KEY = 'siadefense:speed';
function loadSpeed(): Speed {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.find((x) => x === v) ?? 1;
  } catch {
    return 1;
  }
}
function saveSpeed(v: Speed) {
  try {
    localStorage.setItem(SPEED_KEY, String(v));
  } catch {
    /* 무시 */
  }
}

const statLine = levelText;

/** 게임 화면: 판(캔버스)이 화면을 가득 채우고, 그 위에 HUD(위)와 캐릭터 카드(아래)를 올린다 */
export function showGame(setup: GameSetup) {
  const run = new Run({
    seed: setup.seed ?? Math.floor(Math.random() * 0xffffffff),
    stage: setup.stage,
    squad: setup.squad,
    // 판 밖 성장: 저장된 레벨·강화 (개발용 설정 ?lv=N · ?upg=N 이 있으면 그 값)
    levels: setup.lv !== undefined ? Object.fromEntries(setup.squad.map((c) => [c, setup.lv])) : state.profile.levels,
    upgrades: setup.upg !== undefined ? presetUpgrades(setup.upg) : state.profile.upgrades,
  });
  run.speed = loadSpeed();
  const s = run.state;
  let game: Phaser.Game | null = null;
  let ro: ResizeObserver | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let cutTimer: ReturnType<typeof setTimeout> | null = null;
  let ended = false;
  // 판 시작을 서버에 알린다 (잠금·해금 확인 + 시작 시각). 못 알렸으면 이 판은 기록되지 않는다 (플레이는 할 수 있다)
  const api = state.api;
  const started: Promise<string | null> =
    api && !setup.offline
      ? api.start(setup.stage, setup.squad, s.endless ? 'endless' : 'normal').catch((e) => {
          if (e instanceof ApiError) {
            // 잠긴 스테이지·캐릭터: 스테이지 고르기로 돌아간다
            toast(whyText(e));
            leave();
          }
          return null;
        })
      : Promise.resolve(null);
  /** 판에서 나갈 때 돌아갈 화면: 스테이지 판은 그 지역의 스테이지 고르기, 끝없는 모드는 지역 지도 */
  const leave = () => (s.endless ? nav.regions() : nav.stages(s.stage.region));
  /** 판 시작을 서버에 알리지 못했다: 이 판은 기록되지 않는다 */
  let unrecorded = !!setup.offline;

  const cardHtml = (i: number) => {
    const c = s.squad[i];
    if (c === undefined) return '<div class="tcard empty">비어있음</div>';
    const def = TOWERS[c];
    return `<button class="tcard" data-i="${i}" aria-label="${esc(def.nick)} 배치 (기운 ${s.cost[c]})">
      <span class="key">${i + 1}</span><img src="${zodiacFaceUrl(def.id)}" alt="" /><b>${esc(def.nick)}</b><em>✨${s.cost[c]}</em></button>`;
  };
  const root = screen(
    `<div class="field" id="field"></div>
    <div class="hud">
      <div class="hud-row">
        <span class="stat" id="lives" aria-label="생명"></span>
        <span class="stat" id="wave"></span>
        <b class="clock" id="clock"></b>
        <span class="hud-btns"><button class="icon-btn speed" id="speed"></button><button class="icon-btn" id="pause" aria-label="일시정지">⏸</button></span>
      </div>
      <div class="next" id="next"></div>
      <div class="bossbar hidden" id="bossbar"><span id="bossName"></span><div class="track"><i id="bossFill"></i></div></div>
    </div>
    <div class="edge" id="edge"></div>
    <div class="cutin" id="cutin"></div>
    <div class="tray">
      <div class="tray-top">
        <span class="energy" id="energy" aria-label="기운"></span>
        <span class="hint" id="hint"></span><span class="norec hidden" id="norec">기록되지 않는 판</span>
        <button class="btn primary" id="start">시작 ▶</button>
      </div>
      <div class="cards" id="cards">${Array.from({ length: SQUAD_SIZE }, (_, i) => cardHtml(i)).join('')}</div>
      <div class="tpanel hidden" id="panel"></div>
    </div>`,
    `game bg-${s.stage.region}`,
    () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      ro?.disconnect();
      if (endTimer) clearTimeout(endTimer);
      if (cutTimer) clearTimeout(cutTimer);
      game?.destroy(true);
      game = null;
      if (window.__def?.run === run) delete window.__def;
    },
  );
  const $ = <T extends HTMLElement>(q: string) => root.querySelector(q) as T;
  const fieldEl = $('#field');
  const cutin = $('#cutin');
  const edge = $('#edge');
  const el = {
    lives: $('#lives'), wave: $('#wave'), clock: $('#clock'), energy: $('#energy'), hint: $('#hint'), start: $<HTMLButtonElement>('#start'),
    next: $('#next'), cards: $('#cards'), panel: $('#panel'), bossbar: $('#bossbar'), bossName: $('#bossName'), bossFill: $('#bossFill'),
  };
  const cardEls = [...el.cards.querySelectorAll<HTMLElement>('.tcard[data-i]')];
  const scene = () => (game?.scene.getScene('game') as GameScene | undefined) ?? null;

  // ---------- 화면 배치: 판은 위 HUD 와 아래 카드 사이 가운데 ----------
  const layout = () => {
    const w = Math.max(120, fieldEl.clientWidth);
    const h = Math.max(120, fieldEl.clientHeight);
    const u = w / VIEW_W;
    const free = h / u - TOP_PAD - BOT_PAD;
    return { w, h, u, offY: BOARD_H / 2 - (TOP_PAD + free / 2) };
  };
  /** 화면 좌표 → 가장 가까운 배치 칸 (없으면 -1) */
  const slotAtPoint = (cx: number, cy: number): number => {
    const box = fieldEl.getBoundingClientRect();
    const { u, offY } = layout();
    const x = (cx - box.left) / u;
    const y = (cy - box.top) / u + offY;
    let best = -1;
    let bestD = SLOT_HIT;
    for (let i = 0; i < s.slotX.length; i++) {
      const d = Math.max(Math.abs(s.slotX[i] - x), Math.abs(s.slotY[i] - y));
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  if (LOCAL_MODE) {
    window.__def = {
      run,
      game: null,
      bench: (n) => fillBench(s, n),
      slotAt: (i) => {
        const box = fieldEl.getBoundingClientRect();
        const { u, offY } = layout();
        return { x: box.left + s.slotX[i] * u, y: box.top + (s.slotY[i] - offY) * u };
      },
    };
  }

  // ---------- 고른 것: armed = 놓으려고 고른 캐릭터(카드), sel = 고른 배치 칸 ----------
  let armed = -1;
  let sel = -1;
  let hoverSlot = -1;
  let hoverCard = -1;
  const blocked = () => ended || run.paused || run.over || !!stage.querySelector('.dim');

  /** 고른 칸·사거리 원·카드 강조·아래 패널을 지금 상태에 맞춘다 */
  function refresh() {
    const tw = sel >= 0 ? s.towers[sel] : null;
    const onTower = !!tw && tw.char >= 0;
    // 사거리 원: 놓인 캐릭터를 골랐으면 그 사거리, 놓을 자리를 살피는 중이면 그 캐릭터의 사거리
    let showSlot = sel;
    let range = 0;
    if (onTower) range = towerLevel(s, sel)!.range;
    else if (sel >= 0) range = hoverCard >= 0 ? s.lv[hoverCard][0].range : 0;
    else if (armed >= 0 && hoverSlot >= 0 && s.towers[hoverSlot].char < 0) {
      showSlot = hoverSlot;
      range = s.lv[armed][0].range;
    }
    const sc = scene();
    sc?.setSelection(showSlot, range);
    sc?.setHint(armed >= 0 || (sel >= 0 && !onTower));
    el.cards.classList.toggle('hidden', onTower);
    el.panel.classList.toggle('hidden', !onTower);
    el.cards.classList.toggle('pick', sel >= 0 && !onTower);
    cardEls.forEach((c, i) => c.classList.toggle('armed', s.squad[i] === armed));
    el.hint.textContent =
      s.phase === 'prep' && sel < 0 && armed < 0
        ? '빈 칸을 눌러 캐릭터를 놓고 [시작]'
        : sel >= 0 && !onTower
          ? '여기에 놓을 캐릭터를 골라요'
          : armed >= 0
            ? `${TOWERS[armed].nick}: 놓을 칸을 눌러요`
            : '';
    if (onTower) paintPanel();
  }

  /** 아래 패널: 고른 캐릭터의 단계·수치와 [강화] [되팔기] */
  function paintPanel() {
    const tw = s.towers[sel];
    if (!tw || tw.char < 0) return;
    const def = TOWERS[tw.char];
    const cost = upgradeCost(s, sel);
    const nextText = cost === null ? '가장 높은 단계예요' : tw.lv + 1 === MAX_LV ? `▲ 3단계: ${def.special}` : `▲ ${tw.lv + 1}단계: ${statLine(s.lv[tw.char][tw.lv])}`;
    el.panel.innerHTML = `<img src="${zodiacFaceUrl(def.id)}" alt="" />
      <div class="tp-tx"><b>${esc(def.nick)} <span class="tag">${tw.lv}단계</span></b><small>${statLine(s.lv[tw.char][tw.lv - 1])}</small><small class="up">${esc(nextText)}</small></div>
      <div class="tp-btns">
        <button class="btn primary small" data-up ${cost === null ? 'disabled' : ''}>${cost === null ? '강화 완료' : `강화 ✨${cost}`}</button>
        <button class="btn small" data-sell>되팔기 +${sellValue(s, sel)}</button>
      </div>
      <button class="icon-btn" data-close aria-label="닫기">✕</button>`;
    shown.panelPoor = null;
  }

  function tryPlace(slot: number, char: number) {
    if (!canPlace(s, slot, char)) {
      sfx('toggle');
      if (s.towers[slot]?.char < 0 && s.energy < s.cost[char]) toast(`기운이 모자라요 (✨${s.cost[char]} 필요)`, 1400);
      return false;
    }
    return run.cmd('place', slot, char);
  }
  function tapSlot(slot: number) {
    if (slot < 0) {
      // 빈 땅: 고른 것을 모두 푼다
      sel = armed = -1;
    } else if (s.towers[slot].char >= 0) {
      sel = sel === slot ? -1 : slot;
      armed = -1;
      sfx('click');
    } else if (armed >= 0) {
      // 캐릭터를 먼저 골라 둔 상태: 누른 칸에 바로 놓는다 (이어서 다른 칸에도 놓을 수 있다)
      tryPlace(slot, armed);
      sel = -1;
    } else {
      sel = sel === slot ? -1 : slot;
      sfx('click');
    }
    refresh();
  }
  function tapCard(i: number) {
    const c = s.squad[i];
    if (c === undefined || blocked()) return;
    if (sel >= 0 && s.towers[sel].char < 0) {
      // 빈 칸을 먼저 골라 둔 상태: 그 칸에 놓는다
      if (tryPlace(sel, c)) sel = -1;
    } else {
      sel = -1;
      armed = armed === c ? -1 : c;
      sfx('click');
    }
    refresh();
  }
  function doUpgrade() {
    if (sel < 0 || blocked()) return;
    const cost = upgradeCost(s, sel);
    if (cost === null) return;
    if (!run.cmd('upgrade', sel)) {
      sfx('toggle');
      toast(`기운이 모자라요 (✨${cost} 필요)`, 1400);
    }
    refresh();
  }
  function doSell() {
    if (sel < 0 || blocked()) return;
    if (run.cmd('sell', sel)) sel = -1;
    refresh();
  }
  function doStart() {
    if (s.phase !== 'prep' || blocked()) return;
    if (!s.towers.some((t) => t.char >= 0)) return toast('캐릭터를 하나 이상 놓고 시작해요');
    run.cmd('start');
    refresh();
  }

  fieldEl.addEventListener('pointerdown', (e) => {
    if (blocked()) return;
    e.preventDefault();
    tapSlot(slotAtPoint(e.clientX, e.clientY));
  });
  fieldEl.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const h = slotAtPoint(e.clientX, e.clientY);
    fieldEl.style.cursor = h >= 0 ? 'pointer' : '';
    if (h === hoverSlot) return;
    hoverSlot = h;
    refresh();
  });
  fieldEl.addEventListener('pointerleave', () => {
    if (hoverSlot < 0) return;
    hoverSlot = -1;
    refresh();
  });
  fieldEl.addEventListener('contextmenu', (e) => e.preventDefault());
  el.cards.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.tcard[data-i]') as HTMLElement | null;
    if (b) tapCard(Number(b.dataset.i));
  });
  // 빈 칸을 고른 채 카드 위에 마우스를 올리면 그 캐릭터의 사거리를 미리 보여 준다
  el.cards.addEventListener('pointerover', (e) => {
    const b = (e.target as HTMLElement).closest('.tcard[data-i]') as HTMLElement | null;
    const c = b ? (s.squad[Number(b.dataset.i)] ?? -1) : -1;
    if (c === hoverCard) return;
    hoverCard = c;
    refresh();
  });
  el.cards.addEventListener('pointerleave', () => {
    hoverCard = -1;
    refresh();
  });
  el.panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-up]')) doUpgrade();
    else if (t.closest('[data-sell]')) doSell();
    else if (t.closest('[data-close]')) {
      sel = -1;
      sfx('click');
      refresh();
    }
  });
  el.start.addEventListener('click', doStart);

  // ---------- 키보드 (PRD 9장): 1~5 캐릭터 · Space 배속 · Esc 일시정지 (+ Enter 시작 · U 강화 · X 되팔기) ----------
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || ended) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      togglePause();
      return;
    }
    if (blocked()) return;
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (digit) tapCard(Number(digit[1]) - 1);
    else if (e.code === 'Space') {
      e.preventDefault();
      toggleSpeed();
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') doStart();
    else if (e.code === 'KeyU') doUpgrade();
    else if (e.code === 'KeyX' || e.code === 'Delete') doSell();
  };
  // 다른 앱으로 넘어가면 저절로 멈춘다
  const onHide = () => {
    if (document.hidden && !ended && !run.paused && s.phase === 'play') openPause();
  };
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);

  // ---------- 가운데 큰 글자 (웨이브 · 보스 경고 · 클리어 · 실패) ----------
  function setCut(html: string, cls = '', ms = 0) {
    if (cutTimer) clearTimeout(cutTimer);
    cutTimer = null;
    cutin.className = `cutin ${cls}`;
    cutin.innerHTML = html;
    if (!html) return;
    void cutin.offsetWidth;
    cutin.classList.add('pop');
    // 배속이면 글자도 그만큼 빨리 사라진다 (게임 시간 기준)
    if (ms > 0) cutTimer = setTimeout(() => setCut(''), ms / run.speed);
  }
  /** 화면 가장자리 테두리를 한 번 번쩍인다: hurt 요괴가 지나감(분홍) · warn 보스 경고(분홍, 세 번) · good 좋은 일(노랑) */
  const flashEdge = (kind: 'hurt' | 'warn' | 'good') => {
    edge.className = 'edge';
    void edge.offsetWidth;
    edge.className = `edge ${kind}`;
  };

  // ---------- 일시정지: 계속 · 다시하기 · 포기 · 소리 ----------
  let pauseDim: HTMLElement | null = null;
  function openPause() {
    if (ended || pauseDim) return;
    run.paused = true;
    const dim = document.createElement('div');
    dim.className = 'dim pause';
    const paint = (confirm: '' | 'quit' | 'retry') => {
      const part = s.endless ? endlessCoins(s.time) : partialCoins(s.stage, s.time);
      dim.innerHTML =
        confirm === 'quit'
          ? `<div class="dialog"><h3>포기할까요?</h3><p class="soft center">${part > 0 ? `지금까지 번 엽전 ${part}닢은 받아요` : '첫 웨이브를 넘기기 전에는 엽전을 받지 못해요'}</p>
              <div class="actions"><button class="btn" data-back>계속하기</button><button class="btn primary" data-quit>포기하기</button></div></div>`
          : confirm === 'retry'
            ? `<div class="dialog"><h3>처음부터 다시 할까요?</h3><p class="soft center">이 판의 기록은 남지 않아요</p>
              <div class="actions"><button class="btn" data-back>계속하기</button><button class="btn primary" data-again>다시하기</button></div></div>`
            : `<div class="dialog"><h3>⏸ 잠깐 멈춤</h3>
              <p class="soft center">${s.endless ? '♾️' : esc(s.stage.id)} ${esc(s.stage.name)} · 웨이브 ${Math.max(1, s.wave + 1)}${s.endless ? '' : `/${WAVES}`} · ❤️ ${s.lives}</p>
              <div class="row"><span>🔊 소리</span><div class="seg" data-k="sfx"><button data-v="1" class="${sound.on ? 'sel' : ''}">켜기</button><button data-v="0" class="${sound.on ? '' : 'sel'}">끄기</button></div></div>
              <div class="actions"><button class="btn primary" data-resume>계속하기</button></div>
              <div class="actions"><button class="btn small" data-retry>🔄 다시하기</button><button class="btn small" data-giveup>🏳️ 포기</button></div></div>`;
    };
    paint('');
    dim.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const seg = t.closest('.seg button') as HTMLElement | null;
      if (seg) {
        sound.set(seg.dataset.v === '1');
        sfx('toggle');
        paint('');
      } else if (t.closest('[data-resume]')) closePause();
      else if (t.closest('[data-giveup]')) {
        sfx('click');
        // 시작 전에는 잃을 것이 없다: 바로 나간다
        if (s.phase === 'prep') leave();
        else paint('quit');
      } else if (t.closest('[data-retry]')) {
        sfx('click');
        if (s.phase === 'prep') nav.game({ ...setup, seed: undefined });
        else paint('retry');
      } else if (t.closest('[data-back]')) {
        sfx('click');
        paint('');
      } else if (t.closest('[data-again]')) {
        sfx('click');
        nav.game({ ...setup, seed: undefined });
      } else if (t.closest('[data-quit]')) {
        sfx('click');
        finish(true);
      }
    });
    stage.append(dim);
    pauseDim = dim;
    sfx('click');
  }
  function closePause() {
    if (!pauseDim) return;
    sfx('click');
    pauseDim.remove();
    pauseDim = null;
    run.paused = false;
  }
  function togglePause() {
    if (pauseDim) closePause();
    else openPause();
  }
  $('#pause').addEventListener('click', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    openPause();
  });

  // ---------- 배속: 누를 때마다 1배속 ↔ 2배속 ----------
  const speedBtn = $<HTMLButtonElement>('#speed');
  function paintSpeed() {
    speedBtn.textContent = `×${run.speed}`;
    speedBtn.classList.toggle('on', run.speed > 1);
    speedBtn.setAttribute('aria-label', `배속 (지금 ${run.speed}배속)`);
    speedBtn.setAttribute('aria-pressed', String(run.speed > 1));
  }
  function toggleSpeed() {
    if (ended) return;
    run.speed = SPEEDS[(SPEEDS.indexOf(run.speed) + 1) % SPEEDS.length];
    saveSpeed(run.speed);
    paintSpeed();
    sfx('toggle');
  }
  speedBtn.addEventListener('click', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    toggleSpeed();
  });
  paintSpeed();

  // ---------- 끝: 결과 화면으로 (판이 끝날 때 한 번 저장한다) ----------
  function finish(quit: boolean) {
    if (ended) return;
    ended = true;
    run.paused = true;
    const summary = run.summary();
    // 판이 끝날 때 한 번 저장한다. 통신이 안 되면 기기에 보관해 두었다가 다음 접속 때 다시 보낸다
    const saved: GameResult['saved'] = started.then(async (id) => {
      if (!id || !api) return 'unrecorded';
      try {
        const out = await api.finish({
          run: id, stage: summary.stage, cleared: summary.cleared, lives: summary.lives, startLives: summary.startLives,
          time: summary.time, kills: summary.kills, placed: summary.placed, cmds: summary.cmds, bonus: summary.bonus, codex: summary.codex,
        });
        if (!out) return 'pending';
        setProfile(out.profile);
        return out.result;
      } catch {
        return 'rejected';
      }
    });
    const result: GameResult = { ...summary, quit, setup, saved };
    if (quit) return nav.result(result);
    endTimer = setTimeout(() => nav.result(result), 1700);
  }
  function onFail() {
    music.play(null);
    sfx('lose');
    if (s.endless) setCut(`웨이브 ${s.wave + 1}<small>여기까지 버텼어요</small>`, 'go');
    else setCut('실패…<small>마을에 요괴가 들어왔어요</small>', 'bad');
    finish(false);
  }
  function onClear() {
    music.play(null);
    sfx('win');
    setCut('클리어!<small>마을을 지켜 냈어요</small>', 'go');
    finish(false);
  }

  // ---------- 생긴 일 → 소리·연출 ----------
  /** 이 판의 배경 곡 (끝없는 모드는 들판 곡) */
  const bgm = bgTrack(s.endless ? 'field' : stageBg(s.stage));
  /** 캐릭터별 공격음: [공용 소리 이름, 높낮이]. 양(쉬지 않고 구름을 깐다)·돼지(공격하지 않는다)는 없다 */
  const ATTACK_SFX: Record<string, [string, number] | undefined> = {
    rat: ['survShot', 1.3], ox: ['tankTurn', 0.8], tiger: ['survSlash', 1], rabbit: ['survPop', 0.85], dragon: ['tankLaser', 1.4], snake: ['survPop', 1.4],
    horse: ['survShot', 0.7], monkey: ['survShot', 1.6], rooster: ['survSlash', 1.7], dog: ['survPop', 1.1],
  };
  run.onEvent = (e: Ev, st: State) => {
    switch (e.t) {
      case EV.start:
        sfx('raceGo');
        music.play(bgm);
        break;
      case EV.wave:
        if (e.a > 0) sfx('turn');
        setCut(`<small>웨이브 ${e.a + 1}${s.endless ? '' : ` / ${WAVES}`}</small>`, !s.endless && e.a === WAVES - 1 ? 'bad' : '', 1300);
        break;
      case EV.place:
        sfx('tankBuild');
        scene()?.spark('place', e.a);
        break;
      case EV.upgrade:
        sfx('survLevel');
        scene()?.spark('upgrade', e.a);
        break;
      case EV.sell:
        sfx('coin');
        scene()?.spark('sell', e.a);
        break;
      case EV.fire: {
        // 캐릭터마다 다른 소리 (같은 공용 소리의 높낮이를 바꿔 쓴다)
        const v = ATTACK_SFX[TOWERS[e.a].id];
        if (v) attackSfx(v[0], v[1]);
        break;
      }
      case EV.leak:
        sfx('survHurt');
        flashEdge('hurt');
        scene()?.burst('leak');
        // 보스가 지나갔으면 배경 곡으로 돌아간다
        if (e.b >= 0 && st.phase === 'play') music.play(bgm);
        break;
      case EV.bossWarn:
        music.play('boss');
        sfx('survBossWarn');
        setCut(`⚠️ ${esc(BOSSES[e.a].name)}<small>보스가 다가온다!</small>`, 'bad warn', 2600);
        flashEdge('warn');
        break;
      case EV.bossAct: {
        // 보스의 특수 행동: 무슨 일인지 짧게 알려 준다
        const say: Record<number, string> = {
          [DASH.dash]: '돌진!', [ACT.summon]: '졸개를 불렀다!', [ACT.vanish]: '사라졌다!', [ACT.appear]: '앞에서 나타났다!', [ACT.clone]: '분신!',
          [ACT.segment]: '마디를 먼저 쓰러뜨려요', [ACT.freeze]: '캐릭터가 멈췄다!', [ACT.geyser]: '물기둥!', [ACT.mark]: '표식!', [ACT.fire]: '불길!', [ACT.raise]: '되살아났다!',
        };
        if (e.b === DASH.windup && BOSSES[e.a].act === 'dash') sfx('cutin', { volume: 0.5 });
        else if (say[e.b] && !(e.b === DASH.dash && BOSSES[e.a].act !== 'dash')) {
          sfx('cutin', { volume: 0.4 });
          setCut(`<small>${say[e.b]}</small>`, 'bad', 1000);
        }
        break;
      }
      case EV.income:
        sfx('coin', { volume: 0.4 });
        scene()?.coin(e.b);
        break;
      case EV.bossDown:
        if (st.phase === 'play') music.play(bgm);
        sfx('survBossDown');
        scene()?.burst('boss');
        flashEdge('good');
        if (st.phase === 'play') setCut(`${esc(BOSSES[e.a].name)} 처치!`, 'go', 1600);
        break;
      case EV.fail:
        onFail();
        break;
      case EV.clear:
        onClear();
        break;
    }
    // 배치·강화·되팔기로 아래 패널의 값이 바뀐다
    if (e.t === EV.place || e.t === EV.upgrade || e.t === EV.sell) refresh();
  };

  // ---------- 다음 웨이브 미리 보기 (PRD 3장 편의 기능) ----------
  const foeIcons = (wave: number): string => {
    // 끝없는 모드의 웨이브는 번호로 정해진다
    const w = s.endless ? endlessWave(wave) : s.stage.waves[wave];
    if (!w) return '';
    const count = new Map<string, number>();
    for (const g of w.groups) count.set(g.enemy, (count.get(g.enemy) ?? 0) + g.count);
    let html = [...count].map(([id, n]) => `<span class="foe"><img src="${artUrl(`e-${id}`)}" alt="${esc(ENEMIES[ENEMY_INDEX[id]]?.name ?? id)}" />×${n}</span>`).join('');
    // 그 웨이브에 보스가 나오면 함께 보여 준다
    const eb = s.endless ? endlessBoss(wave) : null;
    if (eb) html += `<span class="foe boss"><img src="${artUrl(`b-${BOSSES[eb.boss].id}`)}" alt="" />보스</span>`;
    if (!s.endless && s.bossAt >= wave * WAVE_SEC && s.bossAt < (wave + 1) * WAVE_SEC) html += `<span class="foe boss"><img src="${artUrl(`b-${BOSSES[s.bossId].id}`)}" alt="" />보스</span>`;
    return html;
  };
  function paintNext() {
    const w = s.wave;
    if (s.phase === 'prep') el.next.innerHTML = `<b>첫 웨이브</b>${foeIcons(0)}`;
    else if (s.endless || w + 1 < WAVES) el.next.innerHTML = `<b>다음 웨이브 <i id="nextIn"></i></b>${foeIcons(w + 1)}`;
    else el.next.innerHTML = '<b id="left"></b>';
  }

  // ---------- 매 프레임: 바뀐 값만 HUD에 반영 ----------
  const shown = { lives: -1, wave: -2, sec: -1, energy: -1, phase: '', nextIn: -1, left: -1, boss: -2, bossHp: -1, over: false, panelPoor: null as boolean | null };
  function frame() {
    // 알림을 놓쳤을 때의 대비: 상태를 보고 판을 끝낸다
    if (!ended) {
      if (s.phase === 'fail') onFail();
      else if (s.phase === 'clear') onClear();
    }
    if (s.lives !== shown.lives) {
      // 생명이 줄면 알약이 한 번 흔들린다
      if (shown.lives >= 0) {
        el.lives.classList.remove('hit');
        void el.lives.offsetWidth;
        el.lives.classList.add('hit');
      }
      el.lives.textContent = `❤️ ${(shown.lives = s.lives)}`;
      el.lives.classList.toggle('low', s.lives < s.startLives / 2);
      // 생명이 5 이하면 화면 가장자리가 깜빡이며 경고한다
      root.classList.toggle('danger', s.lives > 0 && s.lives <= 5);
    }
    if (s.phase !== shown.phase || s.wave !== shown.wave) {
      shown.phase = s.phase;
      shown.wave = s.wave;
      el.wave.textContent = `웨이브 ${Math.max(1, s.wave + 1)}${s.endless ? '' : `/${WAVES}`}`;
      el.start.classList.toggle('hidden', s.phase !== 'prep');
      shown.nextIn = shown.left = -1;
      paintNext();
    }
    // 시계: 3분에서 거꾸로. 3분이 지나면 0:00 (남은 요괴가 없어질 때까지 계속된다)
    // (끝없는 모드는 버틴 시간이 올라간다)
    const sec = s.endless ? Math.floor(s.time) : Math.max(0, Math.ceil(RUN_SEC - s.time));
    if (sec !== shown.sec) {
      shown.sec = sec;
      el.clock.textContent = mmss(sec);
    }
    const over = !s.endless && s.time >= RUN_SEC;
    if (over !== shown.over) el.clock.classList.toggle('final', (shown.over = over));
    if (s.phase === 'play') {
      if (s.endless || s.wave + 1 < WAVES) {
        const left = Math.max(0, Math.ceil((s.wave + 1) * WAVE_SEC - s.time));
        if (left !== shown.nextIn) {
          shown.nextIn = left;
          const t = el.next.querySelector('#nextIn');
          if (t) t.textContent = `${left}초 뒤`;
        }
      } else {
        const left = s.enemyN + (s.spawns.length - s.spawnI);
        if (left !== shown.left) {
          shown.left = left;
          const t = el.next.querySelector('#left');
          if (t) t.textContent = over ? `남은 요괴 ${left}마리를 막아요!` : `마지막 웨이브! 남은 요괴 ${left}`;
        }
      }
    }
    if (s.energy !== shown.energy) {
      shown.energy = s.energy;
      el.energy.textContent = `✨ ${Math.floor(s.energy)}`;
      cardEls.forEach((c, i) => c.classList.toggle('poor', s.energy < s.cost[s.squad[i]]));
      shown.panelPoor = null;
    }
    // 강화 버튼: 기운이 모자라면 흐리게 (누르면 얼마가 필요한지 알려 준다)
    if (sel >= 0 && shown.panelPoor === null) {
      const cost = upgradeCost(s, sel);
      shown.panelPoor = cost !== null && s.energy < cost;
      el.panel.querySelector('[data-up]')?.classList.toggle('poor', shown.panelPoor);
    }
    const boss = activeBoss(s);
    const bossId = boss ? boss.boss : -1;
    if (bossId !== shown.boss) {
      shown.boss = bossId;
      // 보스가 있는 동안에는 다음 웨이브 줄 자리에 보스 체력 바를 보여 준다 (판의 맨 윗줄을 가리지 않게 한 줄만 쓴다)
      el.bossbar.classList.toggle('hidden', !boss);
      el.next.classList.toggle('hidden', !!boss);
      if (boss) el.bossName.textContent = BOSSES[bossId].name;
    }
    if (boss) {
      const hp = Math.round((boss.hp / boss.maxHp) * 200);
      if (hp !== shown.bossHp) {
        shown.bossHp = hp;
        el.bossFill.style.width = `${hp / 2}%`;
      }
    }
  }

  // ---------- Phaser: 캔버스는 화면 크기 × 기기 픽셀 배율, 장면 좌표는 가로 720 기준 ----------
  const boot = () => {
    const { w, h, u, offY } = layout();
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: fieldEl,
      width: Math.round(w * DPR),
      height: Math.round(h * DPR),
      backgroundColor: '#7cc08a',
      banner: false,
      audio: { noAudio: true },
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      scale: { mode: Phaser.Scale.NONE, autoRound: true },
      render: { antialias: true, powerPreference: 'high-performance' },
      scene: [],
    });
    if (window.__def?.run === run) window.__def.game = game;
    // 점검용: 한 프레임을 계산하고 그리는 데 걸린 시간
    let t0 = 0;
    game.events.on('prestep', () => (t0 = performance.now()));
    game.events.on('postrender', () => (run.perf.frameMs = performance.now() - t0));
    const data: SceneData = { run, zoom: u * DPR, offY, onFrame: frame };
    game.scene.add('game', GameScene, true, data);
    let last = `${w}x${h}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const z = layout();
        if (`${z.w}x${z.h}` === last || !game) return;
        last = `${z.w}x${z.h}`;
        // 화면 크기가 바뀌면 캔버스와 카메라만 다시 맞춘다 (판은 그대로)
        game.scale.resize(Math.round(z.w * DPR), Math.round(z.h * DPR));
        scene()?.setView(z.u * DPR, z.offY);
      }, 150);
    });
    ro.observe(fieldEl);
  };
  // 글꼴을 먼저 받아야 표지판 글자가 제 글꼴로 그려진다
  const fonts = document.fonts?.load ? Promise.race([document.fonts.load('22px Jua'), new Promise((r) => setTimeout(r, 1200))]) : Promise.resolve();
  void fonts.then(
    () => root.isConnected && boot(),
    () => root.isConnected && boot(),
  );
  frame();
  refresh();
  if (unrecorded) $('#norec').classList.remove('hidden');
  void started.then((id) => {
    // 잠긴 스테이지라 돌아갔으면 이 화면은 이미 없다
    if (id !== null || !root.isConnected || unrecorded) return;
    // 판 시작을 알리지 못했다 (실패했거나 12초 안에 답이 없다): 판이 끝날 때까지 표시해 둔다
    unrecorded = true;
    $('#norec').classList.remove('hidden');
    if (!ended) toast('서버에 연결하지 못했어요. 이 판은 기록되지 않아요', 5000);
  });
}
