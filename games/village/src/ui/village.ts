import Phaser from 'phaser';
import { CAPPED, CONST, HALL_NEED, LEVEL_EXP, RES_IDS, RES_NAME, STORAGE_CAP, VIEW_W, lookOf, type ResId } from '../data/balance';
import { BUILDING, BUILDINGS, type BuildingType } from '../data/buildings';
import { goalText } from '../data/goals';
import {
  busyCount, countOf, goalStatus, hallLevel, maxCount, nextUnlock, ratePerHour, slots, storageCap, stored, upgradeCost, upgradeSec,
  type Building, type VillageState,
} from '../game/rules';
import { ApiError, LOCAL_MODE, type VillageApi } from '../net/api';
import { worldHome, zodiacFace, zodiacFull } from '../net/world';
import { VillageScene, type SceneData, type SceneHooks } from '../scenes/VillageScene';
import { texKey } from '../scenes/art';
import { duration, esc, num, screen, sfx, sound, stage, toast } from './app';
import { DPR } from './dpr';
import { icon } from './icons';

/** 길잡이 캐릭터: 첫 주민 찍찍이 (DESIGN.md: 어느 화면이든 캐릭터가 하나 이상) */
const GUIDE = 'rat';

/** 서버가 거절한 까닭 → 화면 문구 */
function reason(e: unknown, s: VillageState): string {
  if (!(e instanceof ApiError)) return '서버에 연결하지 못했어요. 잠시 후 다시 해 주세요';
  const map: Record<string, string> = {
    'not enough': '자원이 모자라요',
    'no slot': `한 번에 ${slots(s)}개까지만 지을 수 있어요`,
    occupied: '다른 건물과 겹쳐요',
    'out of land': '땅 밖에는 놓을 수 없어요',
    locked: '아직 지을 수 없는 건물이에요',
    limit: '지금 마을 레벨에서는 더 지을 수 없어요',
    'hall level': '마을 회관 레벨을 먼저 올려 주세요',
    'village level': '마을 레벨이 더 올라야 해요',
    busy: '짓는 중인 건물이에요',
    'max level': '이미 최고 레벨이에요',
    'not done': '아직 목표를 다 하지 못했어요',
    'need login': '로그인이 필요해요',
  };
  return map[e.message] ?? '지금은 할 수 없어요';
}

const cost = (rice: number, wood: number, have?: Record<ResId, number>) =>
  ([['rice', rice], ['wood', wood]] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<span class="cost ${have && have[k] < n ? 'lack' : ''}">${icon(k)}${num(n)}</span>`)
    .join('');

declare global {
  interface Window {
    __village?: { state: VillageState; api: VillageApi; scene: VillageScene | null; game: Phaser.Game | null };
  }
}

export function showVillage(api: VillageApi, user: { id: string; name: string }, first: VillageState) {
  let state = first;
  let scene: VillageScene | null = null;
  let game: Phaser.Game | null = null;
  let siaCoins: number | null = null;

  const root = screen(
    `<div class="field" id="field"></div>
    <header class="hud">
      <div class="hud-top">
        <a class="back" href="${worldHome()}" aria-label="SIA WORLD로">←</a>
        <div class="lv-box">
          <em class="lv" id="lv">1</em>
          <div class="lv-tx"><b id="vname"></b><div class="exp"><i id="expfill"></i><span id="exptx"></span></div></div>
        </div>
        <div class="pill sia" title="시아코인">${icon('sia')}<b id="sia">-</b></div>
      </div>
      <div class="res-row" id="res"></div>
      <button class="goal" id="goal"></button>
    </header>
    <div class="place-bar hidden" id="placebar">
      <p id="placetx"></p>
      <div class="actions"><button class="btn" id="placeno">취소</button><button class="btn primary" id="placeok">여기에 놓기 ✔</button></div>
    </div>
    <button class="icon-btn sound" id="sound" aria-label="소리"></button>
    <nav class="menu" id="menu">
      <button data-m="build"><em>🔨</em>짓기</button>
      <button data-m="residents"><em>🐭</em>주민</button>
      <button data-m="requests"><em>📜</em>부탁</button>
      <button data-m="monuments"><em>🗿</em>기념물</button>
      <button data-m="ranking"><em>🏆</em>랭킹</button>
    </nav>
    <div class="sheet-wrap hidden" id="sheetwrap"><div class="sheet" id="sheet"></div></div>`,
    'village',
  );
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const fieldEl = $('#field');

  // ───────────────────────── HUD ─────────────────────────

  function paintHud() {
    const p = state.profile;
    $('#lv').textContent = String(p.level);
    $('#vname').textContent = p.name || `${user.name}네 마을`;
    const need = p.level >= CONST.max_level ? 0 : LEVEL_EXP[p.level - 1];
    $('#expfill').style.width = need ? `${Math.min(100, (p.exp / need) * 100)}%` : '100%';
    $('#exptx').textContent = need ? `${num(p.exp)} / ${num(need)}` : '최고 레벨';
    const cap = storageCap(state);
    $('#res').innerHTML =
      RES_IDS.map((k) => `<div class="pill ${CAPPED.includes(k) && p.resources[k] >= cap ? 'full' : ''}" title="${RES_NAME[k]}">${icon(k)}<b>${num(p.resources[k])}</b></div>`).join('') +
      `<div class="cap">창고 ${num(cap)}</div>`;
    $('#sia').textContent = siaCoins === null ? '-' : num(siaCoins);
    const g = goalStatus(state);
    const el = $('#goal');
    el.classList.toggle('done', !!g?.done);
    el.innerHTML = g
      ? `<img src="${zodiacFace(GUIDE)}" alt="" /><span class="g-tx"><small>마을 목표</small><b>${esc(goalText(g.def))}</b></span>
         <span class="g-side">${g.done ? '<i class="tag">보상 받기</i>' : `<i class="g-n">${g.have}/${g.def.n}</i>`}<span class="g-rw">${cost(g.def.rice, g.def.wood)}${g.def.exp ? `<span class="cost">${icon('exp')}${g.def.exp}</span>` : ''}</span></span>`
      : `<img src="${zodiacFace(GUIDE)}" alt="" /><span class="g-tx"><small>마을 목표</small><b>목표를 모두 해냈어요! 다음 목표는 준비 중이에요</b></span>`;
  }

  const paintSound = () => ($('#sound').textContent = sound.on ? '🔊' : '🔇');
  $('#sound').addEventListener('click', () => {
    sound.set(!sound.on);
    paintSound();
    sfx('toggle');
  });
  sound.whenReady(paintSound);
  paintSound();

  // ───────────────────────── 서버와 주고받기 (한 번에 하나씩, 온 순서대로 화면에 반영) ─────────────────────────

  let queue: Promise<unknown> = Promise.resolve();
  /** 서버 일을 줄 세운다. 실패하면 까닭을 알리고 false */
  function act<T>(job: () => Promise<T>, done?: (out: T) => void, quiet = false): Promise<boolean> {
    const run = queue.then(async () => {
      try {
        const out = await job();
        done?.(out);
        return true;
      } catch (e) {
        if (!quiet) {
          toast(reason(e, state), 2600);
          sfx('fold');
        }
        return false;
      }
    });
    queue = run;
    return run;
  }

  /** 새 상태를 화면에 반영한다. 레벨업 · 완공을 알린다 */
  function apply(next: VillageState) {
    const prev = state;
    state = next;
    if (window.__village) window.__village.state = state;
    for (const b of next.buildings) {
      const old = prev.buildings.find((v) => v.id === b.id);
      if (old && old.state !== 'done' && b.state === 'done') {
        toast(old.state === 'building' ? `${BUILDING[b.type].name} 완성!` : `${BUILDING[b.type].name} 레벨 ${b.level}!`);
        sfx('tankBuild');
      }
    }
    paintHud();
    scene?.refresh();
    paintSheet();
    if (next.profile.level > prev.profile.level) levelUp(prev.profile.level, next.profile.level);
  }

  const reload = (quiet = true) => act(() => api.load(), apply, quiet);

  // ───────────────────────── 수확 (끌면서 지나간 건물을 모아 한 번에 보낸다) ─────────────────────────

  let batch: string[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  function flushHarvest() {
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = null;
    const ids = batch;
    batch = [];
    if (ids.length === 0) return;
    void act(
      () => api.harvest(ids),
      (r) => {
        apply(r.state);
        scene?.harvested(ids, r.harvest.per);
        if (Object.keys(r.harvest.per).length > 0) sfx('coin');
        if (r.harvest.lost > 0) toast(`창고가 가득 차서 ${num(r.harvest.lost)}개는 담지 못했어요`, 2800);
      },
    ).then((ok) => !ok && scene?.harvested(ids, {}));
  }

  // ───────────────────────── 아래 판 (짓기 메뉴 · 건물 관리) ─────────────────────────

  type Sheet = { kind: 'build' } | { kind: 'building'; id: string } | null;
  let sheet: Sheet = null;
  const wrap = $('#sheetwrap');
  const sheetEl = $('#sheet');
  /** 건물 그림 (Phaser 가 그린 임시 그림을 그대로 쓴다) */
  const artCache = new Map<string, string>();
  function art(type: BuildingType, look: number): string {
    const key = texKey(type, look);
    let src = artCache.get(key);
    if (!src && scene?.textures.exists(key)) {
      src = scene.textures.getBase64(key);
      artCache.set(key, src);
    }
    return src ? `<img class="b-art" src="${src}" alt="" />` : '<span class="b-art"></span>';
  }

  function openSheet(s: Sheet) {
    sheet = s;
    paintSheet();
  }

  function paintSheet() {
    if (sheet?.kind === 'building' && !state.buildings.some((b) => b.id === (sheet as { id: string }).id)) sheet = null;
    wrap.classList.toggle('hidden', !sheet);
    if (!sheet) return;
    sheetEl.innerHTML = sheet.kind === 'build' ? buildMenu() : buildingPanel(state.buildings.find((b) => b.id === (sheet as { id: string }).id)!);
    tickSheet();
  }

  function buildMenu(): string {
    const p = state.profile;
    const busy = busyCount(state);
    const rows = BUILDINGS.filter((d) => d.id !== 'hall')
      .map((d) => {
        const have = countOf(state, d.id);
        const max = maxCount(d.id, p.level);
        const next = nextUnlock(state, d.id);
        let side: string;
        if (have < max) side = `<button class="btn small primary" data-build="${d.id}">짓기</button>`;
        else if (next !== null) side = `<span class="lock">🔒 마을 레벨 ${next}</span>`;
        else side = '<span class="lock">모두 지었어요</span>';
        return `<div class="b-row ${have < max ? '' : 'off'}">
          ${art(d.id, 1)}
          <div class="b-tx"><b>${d.name} <small>${have}/${Math.max(max, have)}</small></b><span class="soft">${d.desc}</span>
            <span class="costs">${cost(d.rice, d.wood, p.resources)}<span class="cost">${icon('time')}${duration(d.buildSec)}</span></span></div>
          ${side}
        </div>`;
      })
      .join('');
    return `<div class="sheet-head"><h3>🔨 짓기</h3><span class="soft">짓는 중 ${busy}/${slots(state)}</span><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
      <div class="b-list">${rows}</div>`;
  }

  function buildingPanel(b: Building): string {
    const d = BUILDING[b.type];
    const p = state.profile;
    const lines: string[] = [];
    if (b.state !== 'done') lines.push(`<p class="live"><span data-live="left"></span></p>`);
    if (d.product) {
      lines.push(`<p>${icon(d.product)} 한 시간에 <b>${num(ratePerHour(b.type, b.level))}</b>개 · 최대 12시간 분량까지 쌓여요</p>`);
      if (b.state === 'done') lines.push(`<p class="live">지금 쌓인 양 <b data-live="stored"></b></p>`);
    }
    if (b.type === 'storage') lines.push(`<p>창고 용량 <b>+${num(STORAGE_CAP[b.level - 1])}</b></p>`);
    if (b.type === 'hall') lines.push(`<p>창고 용량 <b>${num(storageCap(state))}</b> · 동시에 짓기 <b>${slots(state)}</b>개 · 다른 건물은 레벨 <b>${b.level}</b>까지</p>`);
    if (b.type === 'house') lines.push('<p class="soft">주민은 곧 이사 와요 (준비 중)</p>');

    let up = '';
    if (b.state === 'done') {
      if (b.level >= CONST.building_max_level) up = '<p class="up-note">최고 레벨이에요</p>';
      else {
        const c = upgradeCost(b.type, b.level);
        let block = '';
        if (b.type === 'hall' && p.level < HALL_NEED[b.level - 1]) block = `마을 레벨 ${HALL_NEED[b.level - 1]}이 되면 올릴 수 있어요`;
        else if (b.type !== 'hall' && b.level >= hallLevel(state)) block = '마을 회관 레벨을 먼저 올려 주세요';
        else if (busyCount(state) >= slots(state)) block = `짓는 중인 건물이 ${slots(state)}개예요`;
        else if (p.resources.rice < c.rice || p.resources.wood < c.wood) block = '자원이 모자라요';
        const gain = d.product ? ` · 한 시간에 ${num(ratePerHour(b.type, b.level + 1))}개` : b.type === 'storage' ? ` · 용량 +${num(STORAGE_CAP[b.level])}` : '';
        up = `<div class="up-box"><div class="up-tx"><b>레벨 ${b.level + 1}로 올리기</b><span class="costs">${cost(c.rice, c.wood, p.resources)}<span class="cost">${icon('time')}${duration(upgradeSec(b.type, b.level))}</span></span>
          <span class="soft">${block || `레벨 ${b.level + 1}${gain}`}</span></div>
          <button class="btn primary" data-upgrade="${b.id}" ${block ? 'disabled' : ''}>업그레이드</button></div>`;
      }
    }
    return `<div class="sheet-head">${art(b.type, b.state === 'building' ? 1 : lookOf(b.level))}<h3>${d.name} <small>레벨 ${b.level}</small></h3><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
      <div class="b-info">${lines.join('')}</div>${up}
      <div class="actions"><button class="btn" data-move="${b.id}">옮기기</button><button class="btn soon" data-soon>주민 배치</button><button class="btn soon" data-soon>보관</button></div>`;
  }

  /** 시간에 따라 바뀌는 글자만 고친다 (버튼을 누르는 도중에 판 전체를 다시 그리지 않게) */
  function tickSheet() {
    if (sheet?.kind !== 'building') return;
    const b = state.buildings.find((v) => v.id === (sheet as { id: string }).id);
    if (!b) return;
    const now = api.now();
    const st = sheetEl.querySelector('[data-live="stored"]');
    if (st) st.textContent = `${num(stored(b, now))} / ${num(Math.floor((CONST.prod_cap_sec * ratePerHour(b.type, b.level)) / 3600))}`;
    const left = sheetEl.querySelector('[data-live="left"]');
    if (left && b.finishAt !== null) left.textContent = `${b.state === 'building' ? '짓는 중' : `레벨 ${b.level + 1}로 올리는 중`} · ${b.finishAt > now ? `${duration((b.finishAt - now) / 1000)} 남음` : '곧 끝나요'}`;
  }

  wrap.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === wrap || el.closest('[data-close]')) {
      sfx('click');
      return openSheet(null);
    }
    const bt = el.closest('button') as HTMLButtonElement | null;
    if (!bt || bt.disabled) return;
    if (bt.dataset.build) {
      sfx('click');
      startPlacing(bt.dataset.build as BuildingType, null);
    } else if (bt.dataset.move) {
      sfx('click');
      const b = state.buildings.find((v) => v.id === bt.dataset.move);
      if (b) startPlacing(b.type, b.id);
    } else if (bt.dataset.upgrade) {
      const id = bt.dataset.upgrade;
      bt.disabled = true;
      void act(() => api.upgrade(id), (s) => {
        sfx('tankBuild');
        apply(s);
      });
    } else if (bt.dataset.soon !== undefined) {
      sfx('click');
      toast('준비 중이에요');
    }
  });

  // ───────────────────────── 놓을 자리 고르기 ─────────────────────────

  const bar = $('#placebar');
  function startPlacing(type: BuildingType, movingId: string | null) {
    openSheet(null);
    $('#placetx').innerHTML = `<b>${BUILDING[type].name}</b> ${movingId ? '옮길' : '놓을'} 칸을 눌러 주세요 <small>(끌어서 옮길 수도 있어요)</small>`;
    bar.classList.remove('hidden');
    $('#menu').classList.add('hidden');
    $('#sound').classList.add('hidden');
    scene?.startPlacing(type, movingId);
  }
  function stopPlacing() {
    bar.classList.add('hidden');
    $('#menu').classList.remove('hidden');
    $('#sound').classList.remove('hidden');
    scene?.stopPlacing();
  }
  $('#placeno').addEventListener('click', () => {
    sfx('click');
    stopPlacing();
  });
  $<HTMLButtonElement>('#placeok').addEventListener('click', () => {
    const p = scene?.placing;
    if (!p) return;
    if (!p.ok) {
      toast('여기에는 놓을 수 없어요');
      return;
    }
    const { type, movingId, x, y } = p;
    const ok = $<HTMLButtonElement>('#placeok');
    ok.disabled = true;
    void act(
      () => (movingId ? api.move(movingId, x, y) : api.build(type, x, y).then((r) => r.state)),
      (s) => {
        sfx(movingId ? 'chip' : 'tankBuild');
        stopPlacing();
        apply(s);
      },
    ).finally(() => (ok.disabled = false));
  });

  // ───────────────────────── 메뉴 · 목표 ─────────────────────────

  $('#menu').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    sfx('click');
    if (b.dataset.m === 'build') openSheet({ kind: 'build' });
    else toast('준비 중이에요');
  });

  $('#goal').addEventListener('click', () => {
    const g = goalStatus(state);
    if (!g) return;
    if (!g.done) {
      sfx('click');
      toast(`${goalText(g.def)} (${g.have}/${g.def.n})`);
      return;
    }
    void act(() => api.claimGoal(), (s) => {
      sfx('win');
      toast('목표 달성! 보상을 받았어요');
      apply(s);
    });
  });

  // ───────────────────────── 레벨업 ─────────────────────────

  function levelUp(from: number, to: number) {
    sfx('survLevel');
    const opened: string[] = [];
    for (const d of BUILDINGS) {
      const more = maxCount(d.id, to) - maxCount(d.id, from);
      if (more > 0) opened.push(maxCount(d.id, from) === 0 ? `<li><b>새 건물</b> ${d.name}</li>` : `<li>${d.name} +${more}채</li>`);
    }
    const hallUp = HALL_NEED.findIndex((l) => l > from && l <= to);
    if (hallUp >= 0) opened.push(`<li>마을 회관 레벨 ${hallUp + 2}</li>`);
    stage.querySelector('.dim')?.remove();
    const dim = document.createElement('div');
    dim.className = 'dim';
    dim.innerHTML = `<div class="dialog levelup" role="dialog" aria-modal="true">
      <div class="burst"><img src="${zodiacFull(GUIDE)}" alt="" /></div>
      <h3>마을 레벨 ${to}!</h3>
      ${opened.length ? `<p class="soft">이제 할 수 있어요</p><ul>${opened.join('')}</ul>` : '<p class="soft">마을이 한층 커졌어요</p>'}
      <div class="actions"><button class="btn primary" data-close>좋아요</button></div>
    </div>`;
    dim.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === dim || el.closest('[data-close]')) {
        sfx('click');
        dim.remove();
      }
    });
    stage.append(dim);
  }

  // ───────────────────────── Phaser ─────────────────────────

  const hooks: SceneHooks = {
    state: () => state,
    now: () => api.now(),
    tapBuilding(id) {
      sfx('click');
      openSheet({ kind: 'building', id });
    },
    tapGround() {
      if (sheet) openSheet(null);
    },
    harvest(id) {
      batch.push(id);
      sfx('chip');
      // 손을 떼지 않고 오래 끌어도 0.6초마다 보낸다
      batchTimer ??= setTimeout(flushHarvest, 600);
    },
    harvestEnd: flushHarvest,
    placeChanged(p) {
      $('#placeok').classList.toggle('off', !p.ok);
    },
    due: () => void reload(),
  };

  const size = () => ({ w: Math.max(120, fieldEl.clientWidth), h: Math.max(120, fieldEl.clientHeight) });
  const boot = () => {
    const { w, h } = size();
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: fieldEl,
      width: Math.round(w * DPR),
      height: Math.round(h * DPR),
      backgroundColor: '#5fa772',
      banner: false,
      audio: { noAudio: true },
      input: { keyboard: false, gamepad: false, activePointers: 3 },
      // 캔버스는 화면 크기 × 기기 픽셀 배율로 만들고 1/배율로 줄여 보여 준다 (휴대폰에서 선명하게)
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / DPR, autoRound: true },
      render: { antialias: true },
      scene: [],
    });
    const data: SceneData = { hooks, unit: (w * DPR) / VIEW_W };
    game.scene.add('village', VillageScene, true, data);
    game.events.once('poststep', () => {
      scene = game!.scene.getScene('village') as VillageScene;
      if (window.__village) Object.assign(window.__village, { scene, game });
    });
    let last = `${w}x${h}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const z = size();
        if (`${z.w}x${z.h}` === last || !game) return;
        last = `${z.w}x${z.h}`;
        game.scale.resize(Math.round(z.w * DPR), Math.round(z.h * DPR));
        scene?.setUnit((z.w * DPR) / VIEW_W);
      }, 150);
    });
    ro.observe(fieldEl);
  };
  const fonts = document.fonts?.load ? Promise.race([document.fonts.load('24px Jua'), new Promise((r) => setTimeout(r, 1200))]) : Promise.resolve();
  void fonts.then(boot, boot);

  // ───────────────────────── 주기적으로 ─────────────────────────

  if (LOCAL_MODE) window.__village = { state, api, scene: null, game: null };
  paintHud();
  void api.siaCoins().then((n) => {
    siaCoins = n;
    paintHud();
  });
  // 판의 남은 시간 · 쌓인 양
  setInterval(tickSheet, 500);
  // 다른 기기에서 한 일이나 놓친 완공을 반영한다: 1분마다, 그리고 화면으로 돌아왔을 때
  setInterval(() => document.visibilityState === 'visible' && void reload(), 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void reload();
    void api.siaCoins().then((n) => {
      siaCoins = n;
      paintHud();
    });
  });
}
