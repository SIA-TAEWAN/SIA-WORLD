import Phaser from 'phaser';
import { BONUS, ENDLESS, RUN_SEC, VIEW_W } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { ENEMIES } from '../data/enemies';
import { ITEM } from '../data/items';
import { PASSIVES } from '../data/passives';
import { presetUpgrades } from '../data/upgrades';
import { WEAPONS } from '../data/weapons';
import { LIMITS, endlessOpen, enoughKills } from '../game/progress';
import { activeBoss } from '../game/sim';
import { CARD, EV, type Card, type Ev, type State } from '../game/state';
import { ApiError, LOCAL_MODE } from '../net/api';
import { fillBench } from '../run/devtools';
import { Run, SPEEDS, type Speed } from '../run/run';
import { GameScene, type SceneData } from '../scenes/GameScene';
import { esc, mmss, nav, openSettings, screen, setProfile, showNumbers, stage, state, toast, type GameResult, type GameSetup } from './app';
import { DPR } from './dpr';
import { icon } from './icons';
import { bossTrack, mapTrack, music } from './music';
import { sfx, weaponSfx } from './sfx';
import { whyText } from './upgrade';

declare global {
  interface Window {
    /** 점검용: 지금 진행 중인 판 (테스트 모드에서만) */
    __surv?: { run: Run; game: Phaser.Game | null; bench: (enemies?: number, projectiles?: number) => { enemies: number; projectiles: number } };
  }
}

/** 가상 조이스틱: 이만큼(px) 끌면 끝까지 민 것 */
const STICK_R = 56;
const STICK_DEAD = 0.14;
/** 레벨업 창이 뜬 직후 이만큼(ms)은 카드 클릭을 받지 않는다 (조이스틱을 잡으려던 탭이 카드 선택이 되지 않게) */
const LEVELUP_GUARD_MS = 300;

/** 배속 선택을 기기에 기억한다 (다음 판도 같은 배속으로 시작) */
const SPEED_KEY = 'siasurvival:speed';
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

const KEY_DIR: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

/** 레벨업 카드에 적을 것 */
function cardView(c: Card): { icon: string; name: string; tag: string; text: string; kind: string } {
  if (c.type === CARD.weapon) {
    const d = WEAPONS[c.def];
    return { icon: icon('w', d.id), name: d.name, tag: c.isNew ? '새 무기' : `무기 Lv ${c.lv}`, text: d.levels[c.lv - 1]?.text ?? d.desc, kind: 'weapon' };
  }
  if (c.type === CARD.passive) {
    const d = PASSIVES[c.def];
    return { icon: icon('p', d.id), name: d.name, tag: c.isNew ? '새 패시브' : `패시브 Lv ${c.lv}`, text: d.text, kind: 'passive' };
  }
  if (c.type === CARD.heal) return { icon: icon('x', 'cake'), name: '떡', tag: '덤', text: `체력 ${BONUS.heal} 회복`, kind: 'bonus' };
  return { icon: icon('x', 'coin'), name: '엽전', tag: '덤', text: `엽전 ${BONUS.coins}닢`, kind: 'bonus' };
}

/** 게임 화면: 필드(캔버스)가 화면을 가득 채우고, 그 위에 HUD·레벨업 카드·일시정지 창을 올린다 */
export function showGame(setup: GameSetup) {
  const run = new Run({
    seed: setup.seed ?? Math.floor(Math.random() * 0xffffffff),
    char: setup.char,
    map: setup.map,
    mode: setup.mode,
    // 영구 강화: 저장된 값 (개발용 설정 ?upg=N 이 있으면 그 값)
    upgrades: setup.upg !== undefined ? presetUpgrades(setup.upg) : state.profile.upgrades,
    startAt: setup.startAt,
  });
  run.speed = loadSpeed();
  const s = run.state;
  /** 화면에 보이는 시계: 4분 모드는 4분에서 멈추고(최종 보스와 싸우는 동안), 무한 모드는 계속 올라간다 */
  const clockSec = () => Math.min(s.endless ? ENDLESS.maxSec : RUN_SEC, s.time);
  let game: Phaser.Game | null = null;
  let ro: ResizeObserver | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let cutTimer: ReturnType<typeof setTimeout> | null = null;
  let ended = false;
  // 판 시작을 서버에 알린다 (해금 확인 + 시작 시각). 못 알렸으면 이 판은 기록되지 않는다 (플레이는 할 수 있다)
  const api = state.api;
  const started: Promise<string | null> = api
    ? api.start(setup.map, setup.char, setup.startAt ?? 0, setup.mode ?? 'normal').catch((e) => {
        if (e instanceof ApiError) {
          // 잠긴 캐릭터·맵·무한 모드: 출전 준비로 돌아간다
          toast(whyText(e));
          nav.select();
        }
        return null;
      })
    : Promise.resolve(null);
  /** 서버가 준 판 id (아직 답이 없거나 기록되지 않는 판이면 null) */
  let runId: string | null = null;
  /** 판 시작을 서버에 알리지 못했다: 이 판은 기록되지 않는다 */
  let unrecorded = false;
  // 판 도중에 창이 닫히면(새로고침·탭 닫기·강제 로그아웃 이동) 그때까지의 결과를 기기에 보관한다 → 다음 접속 때 올라간다
  const onLeave = () => {
    if (!ended && runId && api) api.stash({ ...run.summary(), run: runId });
  };
  if (LOCAL_MODE) window.__surv = { run, game: null, bench: (e, p) => fillBench(run.state, e, p) };

  const root = screen(
    `<div class="field" id="field"></div>
    <div class="hud">
      <div class="xp"><i id="xpFill"></i><b id="lv">Lv 1</b></div>
      <div class="hud-row">
        <div class="owned" id="owned"></div>
        <div class="hud-mid">${s.endless ? '<span class="mode-tag">♾️ 무한 모드</span>' : s.hell ? '<span class="mode-tag hell">🔥 헬</span>' : ''}<b class="clock" id="clock">0:00</b><span class="counts"><span id="kills">💀 0</span><span id="coins">🪙 0</span></span><span class="norec hidden" id="norec">기록되지 않는 판</span></div>
        <div class="hud-btns"><button class="icon-btn speed" id="speed"></button><button class="icon-btn" id="pause" aria-label="일시정지">⏸</button></div>
      </div>
      <div class="bossbar hidden" id="bossbar"><span id="bossName"></span><div class="track"><i id="bossFill"></i></div></div>
    </div>
    <div class="mood"><i></i><i></i></div>
    ${s.hell ? '<div class="hellmood"><div class="embers" id="embers"></div></div>' : ''}
    <div class="edge" id="edge"></div>
    <div class="cutin" id="cutin"></div>
    <div class="stick hidden" id="stick"><i></i></div>`,
    `game m-${s.map.id}${s.hell ? ' hell' : ''}`,
    mapTrack(s.map.id, s.hell),
    () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onLeave);
      ro?.disconnect();
      if (endTimer) clearTimeout(endTimer);
      if (cutTimer) clearTimeout(cutTimer);
      game?.destroy(true);
      game = null;
      if (window.__surv?.run === run) delete window.__surv;
    },
  );
  const $ = <T extends HTMLElement>(q: string) => root.querySelector(q) as T;
  const fieldEl = $('#field');
  // 헬 모드: 화면 가장자리에서 불씨(위로)와 재(아래로)가 흩날린다. 가운데(내 캐릭터 둘레)는 비워 둔다
  const embers = root.querySelector('#embers');
  if (embers) {
    for (let i = 0; i < 26; i++) {
      const e = document.createElement('i');
      const ash = i % 3 === 2;
      // 왼쪽·오른쪽 가장자리 쪽에 몰려 있다
      const side = Math.random() < 0.5 ? Math.random() * 22 : 78 + Math.random() * 22;
      e.className = ash ? 'ash' : '';
      e.style.left = `${side}%`;
      e.style.animationDelay = `${-Math.random() * 7}s`;
      e.style.animationDuration = `${(ash ? 6 : 3.4) + Math.random() * 3.2}s`;
      embers.append(e);
    }
  }
  const cutin = $('#cutin');
  const edge = $('#edge');
  /** 화면 가장자리 테두리를 한 번 번쩍인다: hurt 맞음(분홍) · warn 보스 경고(분홍, 세 번) · good 좋은 일(노랑) */
  const flashEdge = (kind: 'hurt' | 'warn' | 'good') => {
    edge.className = 'edge';
    void edge.offsetWidth;
    edge.className = `edge ${kind}${lowHp ? ' low' : ''}`;
  };
  let lowHp = false;
  const scene = () => (game?.scene.getScene('game') as GameScene | undefined) ?? null;
  const stick = $('#stick');
  const knob = stick.firstElementChild as HTMLElement;
  const el = {
    xp: $('#xpFill'), lv: $('#lv'), clock: $('#clock'), kills: $('#kills'), coins: $('#coins'), owned: $('#owned'),
    bossbar: $('#bossbar'), bossName: $('#bossName'), bossFill: $('#bossFill'),
  };

  // ---------- 조작: 키보드(WASD·방향키) + 화면 아무 곳이나 누르면 그 자리에 가상 조이스틱 ----------
  const keys = new Set<string>();
  /** 지금 조이스틱을 쥔 손가락·포인터 ("t<번호>" 터치 · "p<번호>" 포인터, 없으면 null). 아이폰은 손가락 번호가 음수일 때도 있어 번호 크기로 판단하면 안 된다 */
  let touchId: string | null = null;
  let ox = 0;
  let oy = 0;
  let jx = 0;
  let jy = 0;
  function applyInput() {
    if (touchId !== null) {
      run.input.mx = jx;
      run.input.my = jy;
      return;
    }
    let x = 0;
    let y = 0;
    for (const k of keys) {
      x += KEY_DIR[k][0];
      y += KEY_DIR[k][1];
    }
    // 대각선도 같은 빠르기
    const len = Math.hypot(x, y) || 1;
    run.input.mx = x / len;
    run.input.my = y / len;
  }
  function releaseAll() {
    keys.clear();
    endTouch();
  }
  function endTouch() {
    touchId = null;
    jx = jy = 0;
    stick.classList.add('hidden');
    applyInput();
  }
  const blocked = () => run.paused || s.phase !== 'play' || !!stage.querySelector('.dim');
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) togglePause();
      return;
    }
    if (s.phase === 'levelup' && !run.paused) {
      const n = e.code === 'Digit1' || e.code === 'Numpad1' ? 0 : e.code === 'Digit2' || e.code === 'Numpad2' ? 1 : e.code === 'Digit3' || e.code === 'Numpad3' ? 2 : -1;
      if (n >= 0 && !e.repeat) choose(n);
      else if (e.code === 'KeyR' && !e.repeat) reroll();
    }
    if (!KEY_DIR[e.code]) return;
    e.preventDefault();
    keys.add(e.code);
    applyInput();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (keys.delete(e.code)) applyInput();
  };
  const moveTouch = (e: { clientX: number; clientY: number }) => {
    const dx = e.clientX - ox;
    const dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    const k = Math.min(1, d / STICK_R);
    if (k < STICK_DEAD || d === 0) jx = jy = 0;
    else {
      jx = (dx / d) * k;
      jy = (dy / d) * k;
    }
    knob.style.transform = `translate(${jx * STICK_R}px, ${jy * STICK_R}px)`;
    applyInput();
  };
  const beginTouch = (id: string, p: { clientX: number; clientY: number }) => {
    touchId = id;
    ox = p.clientX;
    oy = p.clientY;
    const box = stage.getBoundingClientRect();
    stick.style.left = `${ox - box.left}px`;
    stick.style.top = `${oy - box.top}px`;
    stick.classList.remove('hidden');
    moveTouch(p);
  };
  // 손가락은 터치 이벤트로 받는다. 아이폰(WebKit)은 손가락을 오래 대고 있거나 조금 끌면 자기 제스처(길게 누름·돋보기·스크롤)가
  // 끼어들어 포인터 이벤트를 pointercancel 로 끊어 버린다 → touchstart 에서 기본 동작을 막아야 끝까지 이어진다.
  // 터치 쪽 id 는 포인터 id 와 겹치지 않게 "t" 를 붙인다
  const findTouch = (list: TouchList) => {
    for (let i = 0; i < list.length; i++) if (`t${list[i].identifier}` === touchId) return list[i];
    return null;
  };
  fieldEl.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      if (touchId !== null || blocked()) return;
      const t = e.changedTouches[0];
      if (t) beginTouch(`t${t.identifier}`, t);
    },
    { passive: false },
  );
  fieldEl.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      const t = findTouch(e.changedTouches);
      if (t) moveTouch(t);
    },
    { passive: false },
  );
  const onTouchListEnd = (e: TouchEvent) => {
    if (findTouch(e.changedTouches)) endTouch();
  };
  fieldEl.addEventListener('touchend', onTouchListEnd);
  fieldEl.addEventListener('touchcancel', onTouchListEnd);
  // 마우스·펜은 포인터 이벤트로 (손가락은 위의 터치 이벤트가 맡는다)
  fieldEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || touchId !== null || blocked()) return;
    e.preventDefault();
    try {
      fieldEl.setPointerCapture(e.pointerId);
    } catch {
      /* 잡지 못해도 계속 */
    }
    beginTouch(`p${e.pointerId}`, e);
  });
  fieldEl.addEventListener('pointermove', (e) => {
    if (`p${e.pointerId}` === touchId) moveTouch(e);
  });
  const onTouchEnd = (e: PointerEvent) => {
    if (`p${e.pointerId}` === touchId) endTouch();
  };
  fieldEl.addEventListener('pointerup', onTouchEnd);
  fieldEl.addEventListener('pointercancel', onTouchEnd);
  // lostpointercapture 는 거품처럼 올라온다. 아이폰(WebKit)은 손가락이 닿은 요소(안쪽 캔버스)를 누르는 순간 저절로 잡아 두므로,
  // 위에서 판이 잡아 오면 캔버스가 "놓쳤다"를 보낸다 → 그걸 판 자신의 것으로 알면 누르자마자 조이스틱이 꺼진다. 판 자신의 것만 본다
  fieldEl.addEventListener('lostpointercapture', (e) => {
    if (e.target === fieldEl) onTouchEnd(e);
  });
  fieldEl.addEventListener('contextmenu', (e) => e.preventDefault());
  // 점검용 (?debug=1): 아이폰에서 손가락이 어디에 닿고 입력이 어떻게 들어가는지 화면 왼쪽 아래에 보여 준다
  if (new URLSearchParams(location.search).get('debug') === '1') {
    const box = document.createElement('pre');
    box.style.cssText =
      'position:absolute;left:4px;bottom:4px;z-index:50;margin:0;padding:4px 6px;font:11px/1.3 monospace;color:#fff;background:rgba(0,0,0,.65);pointer-events:none;white-space:pre-wrap;max-width:70%';
    stage.append(box);
    const cnt: Record<string, number> = {};
    let last = '';
    const tag = (t: EventTarget | null) => (t instanceof Element ? `${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}${t.classList[0] ? '.' + t.classList[0] : ''}` : String(t));
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      window.addEventListener(ev, (e) => {
        cnt[ev] = (cnt[ev] ?? 0) + 1;
        if (ev !== 'touchmove' && ev !== 'pointermove') last = `${ev} → ${tag(e.target)}${'pointerType' in e ? ' ' + (e as PointerEvent).pointerType : ''}`;
      }, { capture: true, passive: true });
    }
    let frames = 0;
    const tick = () => {
      if (!box.isConnected) return;
      frames++;
      const p = s.player;
      box.textContent = [
        `ts ${cnt.touchstart ?? 0} tm ${cnt.touchmove ?? 0} te ${cnt.touchend ?? 0} tc ${cnt.touchcancel ?? 0}`,
        `pd ${cnt.pointerdown ?? 0} pm ${cnt.pointermove ?? 0} pu ${cnt.pointerup ?? 0} pc ${cnt.pointercancel ?? 0}`,
        `last ${last}`,
        `touchId ${touchId} in ${run.input.mx.toFixed(2)},${run.input.my.toFixed(2)}`,
        `phase ${s.phase} paused ${run.paused} blocked ${blocked()} dim ${!!stage.querySelector('.dim')}`,
        `p ${Math.round(p.x)},${Math.round(p.y)} t ${s.time.toFixed(1)} f ${frames}`,
      ].join('\n');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  // 다른 앱으로 넘어가면 저절로 멈춘다
  const onHide = () => {
    if (document.hidden && !ended && !run.paused && s.phase === 'play') openPause();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onLeave);

  // ---------- 가운데 큰 글자 (보스 경고 · 진화 · 게임 오버 · 클리어) ----------
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
  /**
   * 꼭 읽혀야 하는 큰 글자 (무한 모드에서 최종 보스를 잡았을 때의 "끝이 아니에요"):
   * 레벨업 창이 떠 있으면 닫힌 뒤에 보여 주고, 보이는 도중에 레벨업 창이 가리면 닫힌 뒤에 다시 보여 준다.
   */
  let held: { html: string; cls: string; ms: number } | null = null;
  /** held 가 다 보이는 시각 (0: 아직 보여 주지 못했다 → 레벨업 창이 닫히면 보여 준다) */
  let heldUntil = 0;
  function setCutHeld(html: string, cls: string, ms: number) {
    held = { html, cls, ms };
    heldUntil = 0;
    if (!levelDim && s.phase === 'play') showHeld();
  }
  function showHeld() {
    if (!held || ended) return;
    heldUntil = performance.now() + held.ms / run.speed;
    setCut(held.html, held.cls, held.ms);
  }

  // ---------- 왼쪽 위: 가진 무기·패시브 아이콘 ----------
  function paintOwned() {
    const chip = (icon: string, lv: number, evo = false) => `<span class="own ${evo ? 'evo' : ''}"><em>${icon}</em><i>${evo ? '★' : lv}</i></span>`;
    el.owned.innerHTML =
      `<div>${s.weapons.map((w) => chip(icon('w', WEAPONS[w.def].id), w.lv, WEAPONS[w.def].evolved)).join('')}</div>` +
      `<div>${s.passives.map((p) => chip(icon('p', PASSIVES[p.def].id), p.lv)).join('')}</div>`;
  }

  // ---------- 레벨업: 게임이 멈추고 카드 3장 중 1장 (1·2·3 키 또는 클릭/터치) ----------
  let levelDim: HTMLElement | null = null;
  /** 레벨업 창이 뜬 시각 (다시 뽑기로 새로 그릴 때는 그대로) */
  let levelAt = 0;
  function showLevelUp(fresh = true) {
    if (fresh) levelAt = performance.now();
    // 꼭 읽혀야 하는 큰 글자가 이 창에 가려진다: 다 보인 뒤였으면 잊고, 아니면 창이 닫힌 뒤에 다시 보여 준다
    if (held) {
      if (heldUntil > 0 && performance.now() >= heldUntil) held = null;
      else heldUntil = 0;
    }
    releaseAll();
    levelDim?.remove();
    const dim = document.createElement('div');
    dim.className = 'dim levelup';
    const cards = s.cards.slice(0, s.cardN).map((c, i) => {
      const v = cardView(c);
      return `<button class="lv-card ${v.kind}" data-i="${i}">
        <span class="key">${i + 1}</span><span class="ic">${v.icon}</span>
        <span class="tx"><b>${esc(v.name)}</b><span class="tag ${c.isNew ? 'new' : ''}">${esc(v.tag)}</span><small>${esc(v.text)}</small></span></button>`;
    });
    dim.innerHTML = `<div class="lv-box"><h3>레벨 업! <b>Lv ${s.level}</b></h3><p class="soft">하나를 골라요</p>${cards.join('')}
      ${s.rerolls > 0 ? `<button class="btn small" data-reroll>🔄 다시 뽑기 (${s.rerolls}번 남음) <span class="key">R</span></button>` : ''}</div>`;
    dim.addEventListener('click', (e) => {
      // 창이 뜬 직후의 클릭은 무시한다 (움직이려고 누른 것이 카드를 고르지 않게. 1·2·3 키는 바로 듣는다)
      if (performance.now() - levelAt < LEVELUP_GUARD_MS) return;
      const t = e.target as HTMLElement;
      const b = t.closest('.lv-card') as HTMLElement | null;
      if (b) choose(Number(b.dataset.i));
      else if (t.closest('[data-reroll]')) reroll();
    });
    stage.append(dim);
    levelDim = dim;
  }
  function closeLevelUp() {
    levelDim?.remove();
    levelDim = null;
  }
  function choose(i: number) {
    if (s.phase !== 'levelup' || i >= s.cardN) return;
    sfx('click');
    run.pick(i);
    paintOwned();
    // 한꺼번에 여러 레벨이 올랐으면 이어서 또 고른다
    if (run.state.phase === 'levelup') showLevelUp();
    else {
      closeLevelUp();
      // 창에 가려졌던 큰 글자를 이제 보여 준다
      if (held && heldUntil === 0) showHeld();
    }
  }
  function reroll() {
    if (s.phase !== 'levelup' || s.rerolls <= 0) return;
    sfx('toggle');
    run.reroll();
    showLevelUp(false);
  }

  // ---------- 일시정지: 가진 무기·패시브 확인, 포기 ----------
  let pauseDim: HTMLElement | null = null;
  function openPause() {
    if (ended || pauseDim) return;
    releaseAll();
    run.paused = true;
    const dim = document.createElement('div');
    dim.className = 'dim pause';
    const row = (icon: string, name: string, lv: string, text: string) =>
      `<li><em>${icon}</em><span><b>${esc(name)}</b><small>${esc(text)}</small></span><i>${lv}</i></li>`;
    const paint = (confirm: boolean) => {
      const weapons = s.weapons.map((w) => {
        const d = WEAPONS[w.def];
        return row(icon('w', d.id), d.name, d.evolved ? '진화' : `Lv ${w.lv}`, d.desc);
      });
      const passives = s.passives.map((p) => row(icon('p', PASSIVES[p.def].id), PASSIVES[p.def].name, `Lv ${p.lv}`, `${PASSIVES[p.def].text} (레벨마다)`));
      // 그만두면 무엇을 받는지: 기록되지 않는 판 · 너무 짧은 판·요괴를 너무 적게 잡은 판(서버가 엽전을 주지 않는다) · 그 밖에는 주운 엽전
      const need = LIMITS.count_min_time;
      const quitNote = unrecorded
        ? '서버에 연결하지 못한 판이라 엽전이 기록되지 않아요'
        : Math.floor(s.time) < need
          ? `${need}초를 버티기 전에 그만두면 엽전을 받지 못해요`
          : !enoughKills({ time: Math.floor(clockSec()), kills: s.kills })
            ? '요괴를 너무 적게 잡아서, 지금 그만두면 엽전을 받지 못해요'
            : `지금까지 주운 엽전 ${Math.floor(s.coins)}닢은 받아요`;
      dim.innerHTML = confirm
        ? `<div class="dialog"><h3>그만둘까요?</h3><p class="soft" style="text-align:center;margin:0">${quitNote}</p>
            <div class="actions"><button class="btn" data-back>계속하기</button><button class="btn primary" data-quit>그만두기</button></div></div>`
        : `<div class="dialog"><h3>⏸ 잠깐 멈춤</h3>
            <p class="soft pause-info">${esc(s.char.nick)} · ${esc(s.map.name)}${s.endless ? ' · 무한 모드' : s.hell ? ' · 🔥 헬 모드' : ''} · ${mmss(clockSec())} · Lv ${s.level}</p>
            <h4>무기 ${s.weapons.length}/6</h4><ul class="own-list">${weapons.join('')}</ul>
            <h4>패시브 ${s.passives.length}/6</h4><ul class="own-list">${passives.join('') || '<li class="none">아직 없어요</li>'}</ul>
            <div class="actions"><button class="btn primary" data-resume>계속하기</button></div>
            <div class="actions"><button class="btn small" data-settings>⚙️ 설정</button><button class="btn small" data-giveup>🏳️ 포기</button></div></div>`;
    };
    paint(false);
    dim.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-resume]')) closePause();
      else if (t.closest('[data-settings]')) openSettings();
      else if (t.closest('[data-giveup]')) {
        sfx('click');
        paint(true);
      } else if (t.closest('[data-back]')) {
        sfx('click');
        paint(false);
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
    // 위에 뜬 설정 창도 함께 닫는다
    stage.querySelectorAll('.dim').forEach((d) => d !== levelDim && d.remove());
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

  // ---------- 배속: 누를 때마다 1배속 ↔ 2배속 (레벨업·일시정지 중에는 어차피 멈춰 있다) ----------
  const speedBtn = $<HTMLButtonElement>('#speed');
  function paintSpeed() {
    speedBtn.textContent = `×${run.speed}`;
    speedBtn.classList.toggle('on', run.speed > 1);
    speedBtn.setAttribute('aria-label', `배속 (지금 ${run.speed}배속)`);
    speedBtn.setAttribute('aria-pressed', String(run.speed > 1));
  }
  speedBtn.addEventListener('click', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    if (ended) return;
    run.speed = SPEEDS[(SPEEDS.indexOf(run.speed) + 1) % SPEEDS.length];
    saveSpeed(run.speed);
    paintSpeed();
    sfx('toggle');
  });
  paintSpeed();

  // ---------- 끝: 결과 화면으로 ----------
  function finish(quit: boolean) {
    if (ended) return;
    ended = true;
    run.paused = true;
    const summary = run.summary();
    // 판이 끝날 때 한 번 저장한다. 통신이 안 되면 기기에 보관해 두었다가 다음 접속 때 다시 보낸다
    const saved: GameResult['saved'] = started.then(async (id) => {
      if (!id || !api) return 'unrecorded';
      try {
        const out = await api.finish({ ...summary, run: id });
        if (!out) return 'pending';
        setProfile(out.profile);
        return out.result;
      } catch {
        return 'rejected';
      }
    });
    // 저장 답이 오기 전의 값 (답이 오면 프로필이 바뀐다)
    const endlessWasOpen = endlessOpen(state.profile, setup.map);
    const result: GameResult = { ...summary, quit, setup, endlessWasOpen, saved };
    if (quit) return nav.result(result);
    endTimer = setTimeout(() => nav.result(result), 1900);
  }

  function onOver() {
    sfx('lose');
    closeLevelUp();
    setCut(`게임 오버<small>${mmss(clockSec())} 버텼어요</small>`, 'bad');
    music.play(null);
    finish(false);
  }
  function onClear() {
    sfx('win');
    closeLevelUp();
    setCut(s.hell ? '헬 클리어!<small>헬의 최종 보스를 물리쳤어요</small>' : '클리어!<small>최종 보스를 물리쳤어요</small>', 'go');
    music.play(null);
    finish(false);
  }

  // ---------- 걸음마다 생긴 일 → 소리·연출 ----------
  run.onEvent = (e: Ev, st: State) => {
    switch (e.t) {
      case EV.hurt:
        sfx('survHurt');
        flashEdge('hurt');
        break;
      case EV.fire: {
        const kind = WEAPONS[e.a].kind;
        if (kind === 'seek' || kind === 'radial') weaponSfx('survShot');
        else if (kind === 'cone' || kind === 'lance') weaponSfx('survSlash');
        else if (kind === 'lob' || kind === 'pool' || kind === 'slowCloud' || kind === 'trail' || kind === 'dash') weaponSfx('survPop');
        break;
      }
      case EV.pick:
        if (e.a <= ITEM.gemL) sfx('chip', { volume: 0.5, rate: 1.2 + e.a * 0.15 });
        else if (e.a === ITEM.coin) sfx('coin', { volume: 0.6 });
        else if (e.a === ITEM.cake) sfx('tankHeal');
        else if (e.a === ITEM.pouch) sfx('boost');
        else if (e.a === ITEM.talisman) {
          sfx('tankBoom', { volume: 0.7 });
          setCut('부적!<small>요괴가 모두 사라졌다</small>', 'go', 1100);
        } else if (e.a === ITEM.chest) sfx('survChest');
        break;
      case EV.levelup:
        sfx('survLevel');
        scene()?.burst('level');
        showLevelUp();
        break;
      case EV.bossWarn:
        sfx('survBossWarn');
        setCut(`⚠️ ${esc(BOSSES[e.a].name)}<small>${st.hell ? '🔥 헬의 보스가 다가온다!' : '보스가 다가온다!'}</small>`, 'bad warn', 2600);
        flashEdge('warn');
        music.play(bossTrack(st.hell));
        break;
      case EV.bossDown:
        sfx('survBossDown');
        scene()?.burst('boss');
        flashEdge('good');
        if (st.phase === 'play' || st.phase === 'levelup') {
          // 무한 모드에서 최종 보스를 잡았을 때: 끝나지 않고 계속된다는 것을 알려 준다.
          // 보스를 잡으면 곧바로 레벨업 창이 뜨는 일이 많아서, 창이 닫힌 뒤에 보이게 한다 (setCutHeld)
          const more = st.endless && st.bossKind[st.map.bosses.length - 1] === e.a && st.bossNext === st.map.bosses.length;
          if (more) setCutHeld(`${esc(BOSSES[e.a].name)} 처치!<small>끝이 아니에요. 요괴가 점점 강해져요</small>`, 'go', 2400);
          else if (st.phase === 'play') setCut(`${esc(BOSSES[e.a].name)} 처치!<small>보물상자를 주워요</small>`, 'go', 1800);
          if (!activeBoss(st)) music.play(mapTrack(st.map.id, st.hell));
        }
        break;
      case EV.evolve:
        sfx('newRecord');
        scene()?.burst('evolve');
        flashEdge('good');
        setCut(`진화!<small>${esc(WEAPONS[e.a].name)}</small>`, 'go', 2200);
        paintOwned();
        break;
      case EV.chestGain: {
        const name = e.a === CARD.weapon ? WEAPONS[e.b].name : e.a === CARD.passive ? PASSIVES[e.b].name : '엽전';
        toast(`🎁 보물상자: ${name} 강화!`);
        paintOwned();
        break;
      }
      case EV.swarm:
        sfx('cutin', { volume: 0.6 });
        setCut(`<small>${esc(ENEMIES[e.a].name)} 떼가 몰려온다!</small>`, 'bad', 1500);
        break;
      case EV.revive:
        sfx('tankHeal');
        scene()?.burst('evolve');
        setCut('부활!', 'go', 1200);
        break;
      case EV.hellPattern: {
        // 헬 전용 패턴: 이름을 작게 띄워 알린다 (다른 큰 글자가 떠 있으면 건드리지 않는다)
        sfx('cutin', { volume: 0.5, rate: 0.8 });
        flashEdge('warn');
        if (!cutin.innerHTML) setCut(`<small>🔥 ${esc(BOSSES[e.a].hell.name ?? '헬 패턴')}</small>`, 'bad', 1300);
        break;
      }
      case EV.boom:
        sfx('tankBoom', { volume: 0.45, rate: 1.3 });
        break;
      case EV.over:
        onOver();
        break;
      case EV.clear:
        onClear();
        break;
    }
  };

  // ---------- 매 프레임: 바뀐 값만 HUD에 반영 ----------
  const shown = { sec: -1, kills: -1, coins: -1, lv: -1, xp: -1, boss: -2, bossHp: -1 };
  function frame() {
    // 알림을 놓쳤을 때의 대비 (한 걸음에 알림이 너무 많으면 빠질 수 있다): 상태를 보고 창을 띄우거나 판을 끝낸다
    if (!ended) {
      if (s.phase === 'levelup' && !levelDim) showLevelUp();
      else if (s.phase === 'over') onOver();
      else if (s.phase === 'clear') onClear();
    }
    const sec = Math.floor(clockSec());
    if (sec !== shown.sec) {
      shown.sec = sec;
      el.clock.textContent = mmss(sec);
      // 4분 모드: 최종 보스와 싸우는 동안 / 무한 모드: 4분을 넘겨 요괴가 계속 강해지는 동안
      el.clock.classList.toggle('final', s.time >= RUN_SEC);
    }
    if (s.kills !== shown.kills) el.kills.textContent = `💀 ${(shown.kills = s.kills)}`;
    const coins = Math.floor(s.coins);
    if (coins !== shown.coins) {
      // 무한 모드: 이 판에 받을 수 있는 엽전을 다 채웠으면 알려 준다
      el.coins.textContent = `🪙 ${(shown.coins = coins)}${coins >= s.coinCap ? ' 최대' : ''}`;
      el.coins.classList.toggle('full', coins >= s.coinCap);
    }
    if (s.level !== shown.lv) el.lv.textContent = `Lv ${(shown.lv = s.level)}`;
    const xp = Math.round(Math.min(1, s.xp / s.xpNext) * 200);
    if (xp !== shown.xp) {
      shown.xp = xp;
      el.xp.style.width = `${xp / 2}%`;
    }
    // 체력이 30% 아래면 가장자리가 계속 붉게 깜빡인다
    const low = s.player.hp > 0 && s.player.hp < s.stats.maxHp * 0.3 && s.phase !== 'clear';
    if (low !== lowHp) {
      lowHp = low;
      edge.classList.toggle('low', low);
    }
    const boss = activeBoss(s);
    const bossId = boss ? boss.boss : -1;
    if (bossId !== shown.boss) {
      shown.boss = bossId;
      el.bossbar.classList.toggle('hidden', !boss);
      if (boss) el.bossName.textContent = `${s.hell ? '🔥 ' : ''}${BOSSES[bossId].name}`;
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
  const size = () => ({ w: Math.max(120, fieldEl.clientWidth), h: Math.max(120, fieldEl.clientHeight) });
  const boot = () => {
    const { w, h } = size();
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: fieldEl,
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
    if (window.__surv?.run === run) window.__surv.game = game;
    // 점검용: 한 프레임을 계산하고 그리는 데 걸린 시간
    let t0 = 0;
    game.events.on('prestep', () => (t0 = performance.now()));
    game.events.on('postrender', () => (run.perf.frameMs = performance.now() - t0));
    const data: SceneData = { run, zoom: (w * DPR) / VIEW_W, showNumbers, onFrame: frame };
    game.scene.add('game', GameScene, true, data);
    let last = `${w}x${h}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const z = size();
        if (`${z.w}x${z.h}` === last || !game) return;
        last = `${z.w}x${z.h}`;
        // 화면 크기가 바뀌면 캔버스와 카메라 배율만 다시 맞춘다 (판은 그대로)
        game.scale.resize(Math.round(z.w * DPR), Math.round(z.h * DPR));
        (game.scene.getScene('game') as GameScene | null)?.setZoom((z.w * DPR) / VIEW_W);
      }, 150);
    });
    ro.observe(fieldEl);
  };
  // 글꼴을 먼저 받아야 피해 숫자가 제 글꼴로 그려진다
  const fonts = document.fonts?.load ? Promise.race([document.fonts.load('40px Jua'), new Promise((r) => setTimeout(r, 1200))]) : Promise.resolve();
  void fonts.then(
    () => root.isConnected && boot(),
    () => root.isConnected && boot(),
  );
  paintOwned();
  frame();
  void started.then((id) => {
    runId = id;
    // 잠긴 캐릭터·맵이라 출전 준비로 돌아갔으면 이 화면은 이미 없다
    if (id !== null || !root.isConnected) return;
    // 판 시작을 알리지 못했다 (실패했거나 12초 안에 답이 없다): 판이 끝날 때까지 시계 아래에 표시해 둔다
    unrecorded = true;
    $('#norec').classList.remove('hidden');
    if (!ended) toast('서버에 연결하지 못했어요. 이 판은 기록되지 않아요', 5000);
  });
}
