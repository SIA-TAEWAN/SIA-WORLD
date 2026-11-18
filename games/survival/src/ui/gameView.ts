import Phaser from 'phaser';
import { BONUS, RUN_SEC, VIEW_W } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { ENEMIES } from '../data/enemies';
import { ITEM } from '../data/items';
import { PASSIVES } from '../data/passives';
import { presetUpgrades } from '../data/upgrades';
import { WEAPONS } from '../data/weapons';
import { activeBoss } from '../game/sim';
import { CARD, EV, type Card, type Ev, type State } from '../game/state';
import { ApiError, LOCAL_MODE } from '../net/api';
import { fillBench } from '../run/devtools';
import { Run } from '../run/run';
import { GameScene, type SceneData } from '../scenes/GameScene';
import { esc, mmss, nav, openSettings, screen, showNumbers, stage, state, toast, type GameResult, type GameSetup } from './app';
import { DPR } from './dpr';
import { music } from './music';
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

const KEY_DIR: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

/** 레벨업 카드에 적을 것 */
function cardView(c: Card): { icon: string; name: string; tag: string; text: string; kind: string } {
  if (c.type === CARD.weapon) {
    const d = WEAPONS[c.def];
    return { icon: d.icon, name: d.name, tag: c.isNew ? '새 무기' : `무기 Lv ${c.lv}`, text: d.levels[c.lv - 1]?.text ?? d.desc, kind: 'weapon' };
  }
  if (c.type === CARD.passive) {
    const d = PASSIVES[c.def];
    return { icon: d.icon, name: d.name, tag: c.isNew ? '새 패시브' : `패시브 Lv ${c.lv}`, text: d.text, kind: 'passive' };
  }
  if (c.type === CARD.heal) return { icon: '🍡', name: '떡', tag: '덤', text: `체력 ${BONUS.heal} 회복`, kind: 'bonus' };
  return { icon: '🪙', name: '엽전', tag: '덤', text: `엽전 ${BONUS.coins}닢`, kind: 'bonus' };
}

/** 게임 화면: 필드(캔버스)가 화면을 가득 채우고, 그 위에 HUD·레벨업 카드·일시정지 창을 올린다 */
export function showGame(setup: GameSetup) {
  const run = new Run({
    seed: setup.seed ?? Math.floor(Math.random() * 0xffffffff),
    char: setup.char,
    map: setup.map,
    // 영구 강화: 저장된 값 (개발용 설정 ?upg=N 이 있으면 그 값)
    upgrades: setup.upg !== undefined ? presetUpgrades(setup.upg) : state.profile.upgrades,
    startAt: setup.startAt,
  });
  const s = run.state;
  let game: Phaser.Game | null = null;
  let ro: ResizeObserver | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let cutTimer: ReturnType<typeof setTimeout> | null = null;
  let ended = false;
  // 판 시작을 서버에 알린다 (해금 확인 + 시작 시각). 못 알렸으면 이 판은 기록되지 않는다 (플레이는 할 수 있다)
  const api = state.api;
  const started: Promise<string | null> = api
    ? api.start(setup.map, setup.char, setup.startAt ?? 0).catch((e) => {
        if (e instanceof ApiError) {
          // 잠긴 캐릭터·맵: 출전 준비로 돌아간다
          toast(whyText(e));
          nav.select();
        }
        return null;
      })
    : Promise.resolve(null);
  if (LOCAL_MODE) window.__surv = { run, game: null, bench: (e, p) => fillBench(run.state, e, p) };

  const root = screen(
    `<div class="field" id="field"></div>
    <div class="hud">
      <div class="xp"><i id="xpFill"></i><b id="lv">Lv 1</b></div>
      <div class="hud-row">
        <div class="owned" id="owned"></div>
        <div class="hud-mid"><b class="clock" id="clock">0:00</b><span class="counts"><span id="kills">💀 0</span><span id="coins">🪙 0</span></span></div>
        <button class="icon-btn" id="pause" aria-label="일시정지">⏸</button>
      </div>
      <div class="bossbar hidden" id="bossbar"><span id="bossName"></span><div class="track"><i id="bossFill"></i></div></div>
    </div>
    <div class="cutin" id="cutin"></div>
    <div class="stick hidden" id="stick"><i></i></div>`,
    'game',
    'field',
    () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onHide);
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
  const cutin = $('#cutin');
  const stick = $('#stick');
  const knob = stick.firstElementChild as HTMLElement;
  const el = {
    xp: $('#xpFill'), lv: $('#lv'), clock: $('#clock'), kills: $('#kills'), coins: $('#coins'), owned: $('#owned'),
    bossbar: $('#bossbar'), bossName: $('#bossName'), bossFill: $('#bossFill'),
  };

  // ---------- 조작: 키보드(WASD·방향키) + 화면 아무 곳이나 누르면 그 자리에 가상 조이스틱 ----------
  const keys = new Set<string>();
  let touchId = -1;
  let ox = 0;
  let oy = 0;
  let jx = 0;
  let jy = 0;
  function applyInput() {
    if (touchId >= 0) {
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
    touchId = -1;
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
  const moveTouch = (e: PointerEvent) => {
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
  fieldEl.addEventListener('pointerdown', (e) => {
    if (touchId >= 0 || blocked()) return;
    e.preventDefault();
    try {
      fieldEl.setPointerCapture(e.pointerId);
    } catch {
      /* 잡지 못해도 계속 */
    }
    touchId = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    const box = stage.getBoundingClientRect();
    stick.style.left = `${ox - box.left}px`;
    stick.style.top = `${oy - box.top}px`;
    stick.classList.remove('hidden');
    moveTouch(e);
  });
  fieldEl.addEventListener('pointermove', (e) => {
    if (e.pointerId === touchId) moveTouch(e);
  });
  const onTouchEnd = (e: PointerEvent) => {
    if (e.pointerId === touchId) endTouch();
  };
  fieldEl.addEventListener('pointerup', onTouchEnd);
  fieldEl.addEventListener('pointercancel', onTouchEnd);
  fieldEl.addEventListener('lostpointercapture', onTouchEnd);
  fieldEl.addEventListener('contextmenu', (e) => e.preventDefault());
  // 다른 앱으로 넘어가면 저절로 멈춘다
  const onHide = () => {
    if (document.hidden && !ended && !run.paused && s.phase === 'play') openPause();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onHide);

  // ---------- 가운데 큰 글자 (보스 경고 · 진화 · 게임 오버 · 클리어) ----------
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

  // ---------- 왼쪽 위: 가진 무기·패시브 아이콘 ----------
  function paintOwned() {
    const chip = (icon: string, lv: number, evo = false) => `<span class="own ${evo ? 'evo' : ''}"><em>${icon}</em><i>${evo ? '★' : lv}</i></span>`;
    el.owned.innerHTML =
      `<div>${s.weapons.map((w) => chip(WEAPONS[w.def].icon, w.lv, WEAPONS[w.def].evolved)).join('')}</div>` +
      `<div>${s.passives.map((p) => chip(PASSIVES[p.def].icon, p.lv)).join('')}</div>`;
  }

  // ---------- 레벨업: 게임이 멈추고 카드 3장 중 1장 (1·2·3 키 또는 클릭/터치) ----------
  let levelDim: HTMLElement | null = null;
  function showLevelUp() {
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
    else closeLevelUp();
  }
  function reroll() {
    if (s.phase !== 'levelup' || s.rerolls <= 0) return;
    sfx('toggle');
    run.reroll();
    showLevelUp();
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
        return row(d.icon, d.name, d.evolved ? '진화' : `Lv ${w.lv}`, d.desc);
      });
      const passives = s.passives.map((p) => row(PASSIVES[p.def].icon, PASSIVES[p.def].name, `Lv ${p.lv}`, `${PASSIVES[p.def].text} (레벨마다)`));
      dim.innerHTML = confirm
        ? `<div class="dialog"><h3>그만둘까요?</h3><p class="soft" style="text-align:center;margin:0">지금까지 주운 엽전 ${Math.floor(s.coins)}닢은 받아요</p>
            <div class="actions"><button class="btn" data-back>계속하기</button><button class="btn primary" data-quit>그만두기</button></div></div>`
        : `<div class="dialog"><h3>⏸ 잠깐 멈춤</h3>
            <p class="soft pause-info">${esc(s.char.nick)} · ${esc(s.map.name)} · ${mmss(Math.min(RUN_SEC, s.time))} · Lv ${s.level}</p>
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
        state.profile = out.profile;
        return out.result;
      } catch {
        return 'rejected';
      }
    });
    const result: GameResult = { ...summary, quit, setup, saved };
    if (quit) return nav.result(result);
    endTimer = setTimeout(() => nav.result(result), 1900);
  }

  // ---------- 걸음마다 생긴 일 → 소리·연출 ----------
  run.onEvent = (e: Ev, st: State) => {
    switch (e.t) {
      case EV.hurt:
        sfx('survHurt');
        break;
      case EV.fire: {
        const kind = WEAPONS[e.a].kind;
        if (kind === 'seek') weaponSfx('survShot');
        else if (kind === 'cone') weaponSfx('survSlash');
        else if (kind === 'lob' || kind === 'pool') weaponSfx('survPop');
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
        showLevelUp();
        break;
      case EV.bossWarn:
        sfx('survBossWarn');
        setCut(`⚠️ ${esc(BOSSES[e.a].name)}<small>보스가 다가온다!</small>`, 'bad', 2600);
        music.play('boss');
        break;
      case EV.bossDown:
        sfx('survBossDown');
        if (st.phase === 'play') {
          setCut(`${esc(BOSSES[e.a].name)} 처치!<small>보물상자를 주워요</small>`, 'go', 1800);
          if (!activeBoss(st)) music.play('field');
        }
        break;
      case EV.evolve:
        sfx('newRecord');
        setCut(`진화!<small>${esc(WEAPONS[e.a].icon)} ${esc(WEAPONS[e.a].name)}</small>`, 'go', 2200);
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
        setCut('부활!', 'go', 1200);
        break;
      case EV.boom:
        sfx('tankBoom', { volume: 0.45, rate: 1.3 });
        break;
      case EV.over:
        sfx('lose');
        closeLevelUp();
        setCut(`게임 오버<small>${mmss(Math.min(RUN_SEC, st.time))} 버텼어요</small>`, 'bad');
        music.play(null);
        finish(false);
        break;
      case EV.clear:
        sfx('win');
        setCut('클리어!<small>10분을 버텨 냈어요</small>', 'go');
        music.play(null);
        finish(false);
        break;
    }
  };

  // ---------- 매 프레임: 바뀐 값만 HUD에 반영 ----------
  const shown = { sec: -1, kills: -1, coins: -1, lv: -1, xp: -1, boss: -2, bossHp: -1 };
  function frame() {
    const sec = Math.floor(Math.min(RUN_SEC, s.time));
    if (sec !== shown.sec) {
      shown.sec = sec;
      el.clock.textContent = mmss(sec);
      el.clock.classList.toggle('final', s.time >= RUN_SEC);
    }
    if (s.kills !== shown.kills) el.kills.textContent = `💀 ${(shown.kills = s.kills)}`;
    const coins = Math.floor(s.coins);
    if (coins !== shown.coins) el.coins.textContent = `🪙 ${(shown.coins = coins)}`;
    if (s.level !== shown.lv) el.lv.textContent = `Lv ${(shown.lv = s.level)}`;
    const xp = Math.round(Math.min(1, s.xp / s.xpNext) * 200);
    if (xp !== shown.xp) {
      shown.xp = xp;
      el.xp.style.width = `${xp / 2}%`;
    }
    const boss = activeBoss(s);
    const bossId = boss ? boss.boss : -1;
    if (bossId !== shown.boss) {
      shown.boss = bossId;
      el.bossbar.classList.toggle('hidden', !boss);
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
    if (id === null && root.isConnected && !ended) toast('서버에 연결하지 못했어요. 이 판은 기록되지 않아요', 3600);
  });
}
