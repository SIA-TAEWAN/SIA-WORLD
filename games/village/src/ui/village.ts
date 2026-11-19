import Phaser from 'phaser';
import { CAPPED, CONST, HALL_NEED, LAND_NEED, LAND_PRICE, LAND_SIZES, LEVEL_EXP, MARKET_LIMIT, PRICES, RES_IDS, RES_NAME, STORAGE_CAP, VIEW_W, kstDay, lookOf, pricePct, type ResId } from '../data/balance';
import { BUILDING, BUILDINGS, isGift, recipeOf, upgradable, type BuildingType } from '../data/buildings';
import { goalText } from '../data/goals';
import {
  batchMax, buildCost, busyCount, canPay, capSec, countOf, effRate, feasting, goalStatus, hallLevel, market, maxCount, nextUnlock, ratePct, sellCoins, sellLeft, slots,
  storageCap, stored, unitSec, upgradeCost, upgradeSec, type Building, type Cost, type VillageState,
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
    locked: '아직 지을 수 없어요',
    limit: '지금 마을 레벨에서는 더 가질 수 없어요',
    'hall level': '마을 회관 레벨을 먼저 올려 주세요',
    'village level': '마을 레벨이 더 올라야 해요',
    busy: '지금은 바쁜 건물이에요',
    'max level': '이미 최고 레벨이에요',
    'no upgrade': '업그레이드할 수 없는 것이에요',
    'not done': '아직 목표를 다 하지 못했어요',
    'no market': '장터를 다 지어야 팔 수 있어요',
    'too few': '너무 적어서 엽전이 되지 않아요',
    'sell limit': '오늘 팔 수 있는 만큼을 넘어요',
    'bad count': '개수를 다시 정해 주세요',
    'cannot store': '마을 회관은 보관할 수 없어요',
    'not enough coin': '시아코인이 모자라요. 다른 게임을 한 판 할 때마다 1코인을 받아요',
    'max land': '땅을 끝까지 넓혔어요',
    'no feast': '잔치 마당을 다 지어야 잔치를 열 수 있어요',
    'feast active': '지금 잔치가 한창이에요',
    'already spent': '이미 산 것이에요',
    'need login': '로그인이 필요해요',
  };
  return map[e.message] ?? '지금은 할 수 없어요';
}

const COST_KEYS = ['rice', 'wood', 'stone', 'coin'] as const;
/** 값 표시 (모자란 것은 빨갛게) */
const costHtml = (c: Partial<Cost>, have?: Record<ResId, number>) =>
  COST_KEYS.filter((k) => (c[k] ?? 0) > 0)
    .map((k) => `<span class="cost ${have && have[k] < c[k]! ? 'lack' : ''}">${icon(k)}${num(c[k]!)}</span>`)
    .join('');
/** 시아코인 값 */
const siaHtml = (n: number, have: number) => (n > 0 ? `<span class="cost sia ${have < n ? 'lack' : ''}">${icon('sia')}${num(n)}</span>` : '');

declare global {
  interface Window {
    __village?: { state: VillageState; api: VillageApi; scene: VillageScene | null; game: Phaser.Game | null };
  }
}

type Tab = 'main' | 'deco' | 'special' | 'stored';
type Sheet = { kind: 'build'; tab: Tab } | { kind: 'building'; id: string } | null;

export function showVillage(api: VillageApi, user: { id: string; name: string }, first: VillageState) {
  let state = first;
  let scene: VillageScene | null = null;
  let game: Phaser.Game | null = null;

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
    // 특산품은 생긴 뒤에만 보인다
    $('#res').innerHTML =
      RES_IDS.filter((k) => k !== 'special' || p.resources.special > 0)
        .map((k) => `<div class="pill ${CAPPED.includes(k) && p.resources[k] >= cap ? 'full' : ''}" title="${RES_NAME[k]}">${icon(k)}<b>${num(p.resources[k])}</b></div>`)
        .join('') + `<div class="cap">창고 ${num(cap)}</div>` + (feasting(state, api.now()) ? `<div class="cap feast" id="feasttx"></div>` : '');
    $('#sia').textContent = num(state.sia);
    tickHud();
    const g = goalStatus(state);
    const el = $('#goal');
    el.classList.toggle('done', !!g?.done);
    el.innerHTML = g
      ? `<img src="${zodiacFace(GUIDE)}" alt="" /><span class="g-tx"><small>마을 목표</small><b>${esc(goalText(g.def))}</b></span>
         <span class="g-side">${g.done ? '<i class="tag">보상 받기</i>' : g.def.kind === 'upgrade' ? '' : `<i class="g-n">${num(g.have)}/${num(g.def.n)}</i>`}<span class="g-rw">${costHtml(g.def)}${g.def.exp ? `<span class="cost">${icon('exp')}${g.def.exp}</span>` : ''}</span></span>`
      : `<img src="${zodiacFace(GUIDE)}" alt="" /><span class="g-tx"><small>마을 목표</small><b>목표를 모두 해냈어요! 마을을 마음껏 꾸며 보세요</b></span>`;
  }

  /** 잔치의 남은 시간 */
  function tickHud() {
    const el = root.querySelector('#feasttx');
    if (!el) return;
    const left = state.profile.feastUntil - api.now();
    if (left <= 0) return paintHud();
    el.textContent = `🎉 잔치 +${state.profile.feastPct}% · ${duration(left / 1000)}`;
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
      if (old && (old.state === 'building' || old.state === 'upgrading') && b.state === 'done') {
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

  let sheet: Sheet = null;
  /** 가공에 넣을 개수 (건물 판에서 고른 값) */
  let craftN = 1;
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
    if (s?.kind === 'building' && (sheet?.kind !== 'building' || sheet.id !== s.id)) craftN = 0;
    sheet = s;
    paintSheet();
  }

  function paintSheet() {
    if (sheet?.kind === 'building') {
      const b = state.buildings.find((v) => v.id === (sheet as { id: string }).id);
      if (!b || b.state === 'stored') sheet = null;
    }
    wrap.classList.toggle('hidden', !sheet);
    if (!sheet) return;
    const top = sheetEl.scrollTop;
    sheetEl.innerHTML = sheet.kind === 'build' ? buildMenu(sheet.tab) : buildingPanel(state.buildings.find((b) => b.id === (sheet as { id: string }).id)!);
    sheetEl.scrollTop = top;
    tickSheet();
  }

  function buildMenu(tab: Tab): string {
    const p = state.profile;
    const kept = state.buildings.filter((b) => b.state === 'stored');
    const tabs = ([['main', '건물'], ['deco', '장식'], ['special', '특별'], ['stored', `보관함${kept.length ? ` ${kept.length}` : ''}`]] as const)
      .map(([id, name]) => `<button data-tab="${id}" class="${tab === id ? 'sel' : ''}">${name}</button>`)
      .join('');
    let rows: string;
    if (tab === 'stored') {
      rows = kept.length
        ? kept
            .map((b) => `<div class="b-row">${art(b.type, lookOf(b.level))}
              <div class="b-tx"><b>${BUILDING[b.type].name}${upgradable(b.type) ? ` <small>레벨 ${b.level}</small>` : ''}</b><span class="soft">${BUILDING[b.type].desc}</span></div>
              <button class="btn small primary" data-take="${b.id}">놓기</button></div>`)
            .join('')
        : '<p class="soft empty">보관함이 비어 있어요. 건물이나 장식물을 누르고 [보관]을 누르면 여기에 들어와요</p>';
    } else {
      // 장식 탭에는 길도 함께. 특별 탭에는 시아코인으로 사는 것 (땅 넓히기 · 특별 건물)
      const list = BUILDINGS.filter((d) => d.id !== 'hall' && !isGift(d.id) && (tab === 'main' ? d.kind === 'main' : tab === 'special' ? d.kind === 'special' : d.kind === 'deco' || d.kind === 'road'));
      rows = (tab === 'special' ? landRow() : '') + list
        .map((d) => {
          const have = countOf(state, d.id);
          const max = maxCount(d.id, p.level);
          const next = nextUnlock(state, d.id);
          let side: string;
          if (have < max) side = `<button class="btn small primary" data-build="${d.id}">${d.kind === 'deco' || d.kind === 'road' ? '놓기' : '짓기'}</button>`;
          else if (next !== null && next > p.level) side = `<span class="lock">🔒 마을 레벨 ${next}</span>`;
          else side = '<span class="lock">모두 가졌어요</span>';
          const total = d.cap > 0 ? d.cap : Math.max(max, have);
          return `<div class="b-row ${have < max ? '' : 'off'}">
            ${art(d.id, 1)}
            <div class="b-tx"><b>${d.name} <small>${have}/${total}</small></b><span class="soft">${d.desc}</span>
              <span class="costs">${siaHtml(d.sia, state.sia)}${costHtml(buildCost(d.id), p.resources)}${d.buildSec ? `<span class="cost">${icon('time')}${duration(d.buildSec)}</span>` : ''}${d.points ? `<span class="cost pts">번영도 +${d.points}</span>` : ''}</span></div>
            ${side}
          </div>`;
        })
        .join('');
    }
    const note = tab === 'special' ? `<p class="soft sia-note">${icon('sia')} 시아코인 <b>${num(state.sia)}</b> · SIA WORLD 의 어느 게임이든 한 판을 끝낼 때마다 1코인을 받아요</p>` : '';
    return `<div class="sheet-head"><h3>🔨 짓기</h3><span class="soft">짓는 중 ${busyCount(state)}/${slots(state)}</span><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
      <div class="seg wide">${tabs}</div>${note}<div class="b-list">${rows}</div>`;
  }

  /** 땅 넓히기 (특별 탭의 첫 줄) */
  function landRow(): string {
    const p = state.profile;
    const stage = p.landStage;
    const size = LAND_SIZES[stage];
    if (stage >= LAND_SIZES.length - 1) return `<div class="b-row off"><span class="b-art land">${size}×${size}</span><div class="b-tx"><b>땅 넓히기</b><span class="soft">땅을 끝까지 넓혔어요</span></div><span class="lock">끝</span></div>`;
    const next = LAND_SIZES[stage + 1];
    const locked = p.level < LAND_NEED[stage];
    return `<div class="b-row ${locked ? 'off' : ''}"><span class="b-art land">${next}×${next}</span>
      <div class="b-tx"><b>땅 넓히기 <small>${stage}/6</small></b><span class="soft">${size}×${size} → ${next}×${next} 칸. 건물은 그 자리에 그대로 있어요</span>
        <span class="costs">${siaHtml(LAND_PRICE[stage], state.sia)}</span></div>
      ${locked ? `<span class="lock">🔒 마을 레벨 ${LAND_NEED[stage]}</span>` : `<button class="btn small primary" data-expand ${state.sia < LAND_PRICE[stage] ? 'disabled' : ''}>넓히기</button>`}</div>`;
  }

  /** 잔치 마당: 잔치 열기 */
  function feastBox(b: Building): string {
    const p = state.profile;
    const pct = CONST.feast_pct + CONST.feast_pct_per * (b.level - 1);
    if (feasting(state, api.now())) return `<p>🎉 잔치가 한창이에요! 마을 전체 생산 <b>+${p.feastPct}%</b></p><p class="live"><span data-live="feast"></span></p>`;
    if (b.state !== 'done') return `<p class="soft">다 지으면 떡 ${CONST.feast_cake}개로 잔치를 열 수 있어요</p>`;
    const lack = p.resources.cake < CONST.feast_cake;
    return `<div class="up-box"><div class="up-tx"><b>잔치 열기</b><span class="costs"><span class="cost ${lack ? 'lack' : ''}">${icon('cake')}${CONST.feast_cake}</span><span class="cost">${icon('time')}하루</span></span>
        <span class="soft">${lack ? '떡이 모자라요 (방앗간에서 만들어요)' : `하루 동안 마을 전체 생산 +${pct}%`}</span></div>
      <button class="btn primary" data-feast ${lack ? 'disabled' : ''}>잔치 열기</button></div>`;
  }

  /** 장터: 오늘의 시세와 팔기 */
  function marketBox(): string {
    const now = api.now();
    const p = state.profile;
    const m = market(state);
    if (!m) return '<p class="soft">다 지으면 자원을 엽전으로 팔 수 있어요</p>';
    const left = sellLeft(state, now);
    const day = kstDay(now);
    const rows = PRICES.filter((v) => v.res !== 'special' || p.resources.special > 0)
      .map((v) => {
        const pct = pricePct(day, v.idx);
        const have = p.resources[v.res];
        // 한도 안에서 팔 수 있는 가장 많은 개수
        let all = have;
        while (all > 0 && sellCoins(v.res, all, now) > left) all = Math.floor(all * 0.9);
        const btn = (n: number, label: string) => {
          const coins = sellCoins(v.res, n, now);
          return `<button class="btn small" data-sell="${v.res}" data-n="${n}" ${n < 1 || n > have || coins < 1 || coins > left ? 'disabled' : ''}>${label}</button>`;
        };
        const unit = v.res === 'special' ? 1 : 100;
        return `<div class="m-row">${icon(v.res)}<div class="m-tx"><b>${RES_NAME[v.res]} <small>${num(have)}개</small></b>
          <span class="cost ${pct >= 110 ? 'up' : pct <= 90 ? 'down' : ''}">${unit}개 = ${icon('coin')}${num(sellCoins(v.res, unit, now))} <small>${pct >= 110 ? '▲ 비싸요' : pct <= 90 ? '▼ 싸요' : '보통'}</small></span></div>
          ${btn(unit, `${unit}개`)}${btn(all, '전부')}</div>`;
      })
      .join('');
    return `<p>오늘 더 벌 수 있는 엽전 <b>${num(left)}</b> / ${num(MARKET_LIMIT[m.level - 1])} <small class="soft">(시세는 날마다 바뀌어요)</small></p><div class="m-list">${rows}</div>`;
  }

  /** 방앗간 · 장독대: 재료를 넣고 만들기 */
  function craftBox(b: Building): string {
    const r = recipeOf(b.type)!;
    const p = state.profile;
    const unit = unitSec(b.type, b.level);
    const recipe = `<p>${icon(r.in1)}${r.n1}${r.in2 ? ` + ${icon(r.in2)}${r.n2}` : ''} → ${icon(r.out)}1 <small class="soft">(하나에 ${duration(unit)})</small></p>`;
    if (b.state === 'working') return `${recipe}<p class="live"><span data-live="job"></span></p>`;
    if (b.state !== 'done') return recipe;
    const afford = Math.min(Math.floor(p.resources[r.in1] / r.n1), r.in2 ? Math.floor(p.resources[r.in2] / r.n2) : Infinity);
    const max = Math.min(batchMax(b.type, b.level), afford);
    if (craftN < 1 || craftN > max) craftN = Math.max(1, max);
    return `${recipe}<div class="up-box"><div class="up-tx"><b>${RES_NAME[r.out]} 만들기</b>
        <span class="stepper"><button class="btn small" data-step="-1" ${craftN <= 1 ? 'disabled' : ''}>−</button><b>${craftN}개</b><button class="btn small" data-step="1" ${craftN >= max ? 'disabled' : ''}>+</button><button class="btn small" data-step="max" ${craftN >= max ? 'disabled' : ''}>최대</button></span>
        <span class="soft">${max < 1 ? '재료가 모자라요' : `한 번에 ${batchMax(b.type, b.level)}개까지 · ${duration(unit * craftN)}`}</span></div>
      <button class="btn primary" data-craft="${b.id}" ${max < 1 ? 'disabled' : ''}>만들기</button></div>`;
  }

  function buildingPanel(b: Building): string {
    const d = BUILDING[b.type];
    const p = state.profile;
    const lines: string[] = [];
    if (b.state === 'building' || b.state === 'upgrading') lines.push(`<p class="live"><span data-live="left"></span></p>`);
    if (d.product) {
      const pct = ratePct(state, b);
      const bonus = [pct ? `정자 +${pct}%` : '', feasting(state, api.now()) ? `잔치 +${p.feastPct}%` : ''].filter(Boolean).join(' · ');
      lines.push(`<p>${icon(d.product)} 한 시간에 <b>${num(effRate(state, b))}</b>개${bonus ? ` <small class="bonus">${bonus}</small>` : ''} · 최대 ${capSec(state) / 3600}시간 분량까지 쌓여요</p>`);
      if (b.state === 'done') lines.push(`<p class="live">지금 쌓인 양 <b data-live="stored"></b></p>`);
    }
    if (b.type === 'pavilion') lines.push(`<p>둘레 ${CONST.pavilion_range}칸 안의 생산 건물이 <b>${CONST.pavilion_pct + CONST.pavilion_pct_per * (b.level - 1)}%</b> 더 만들어요${b.state === 'building' ? ' (다 지은 뒤부터)' : ''}</p>`);
    if (b.type === 'feast') lines.push(feastBox(b));
    if (b.type === 'shrine') lines.push('<p class="soft">마을의 상징이에요. 주민과 더 빨리 친해지고 번영도가 크게 올라요 (주민 · 랭킹이 열리면 힘을 내요)</p>');
    if (b.type === 'storage') lines.push(`<p>창고 용량 <b>+${num(STORAGE_CAP[b.level - 1])}</b></p>`);
    if (b.type === 'hall') lines.push(`<p>창고 용량 <b>${num(storageCap(state))}</b> · 동시에 짓기 <b>${slots(state)}</b>개 · 다른 건물은 레벨 <b>${b.level}</b>까지</p>`);
    if (b.type === 'house') lines.push('<p class="soft">주민은 곧 이사 와요 (준비 중)</p>');
    if (b.type === 'market') lines.push(marketBox());
    if (recipeOf(b.type)) lines.push(craftBox(b));
    if (b.type !== 'pavilion' && b.type !== 'feast' && b.type !== 'shrine' && !upgradable(b.type)) lines.push(`<p class="soft">${d.desc}${d.points ? ` · 번영도 +${d.points}` : ''}</p>`);

    let up = '';
    if (b.state === 'done' && upgradable(b.type)) {
      if (b.level >= CONST.building_max_level) up = '<p class="up-note">최고 레벨이에요</p>';
      else {
        const c = upgradeCost(b.type, b.level);
        let block = '';
        if (b.type === 'hall' && p.level < HALL_NEED[b.level - 1]) block = `마을 레벨 ${HALL_NEED[b.level - 1]}이 되면 올릴 수 있어요`;
        else if (b.type !== 'hall' && b.level >= hallLevel(state)) block = '마을 회관 레벨을 먼저 올려 주세요';
        else if (busyCount(state) >= slots(state)) block = `짓는 중인 건물이 ${slots(state)}개예요`;
        else if (!canPay(p, c)) block = '자원이 모자라요';
        const gain = d.product
          ? ` · 한 시간에 ${num(Math.floor((effRate(state, { ...b, level: b.level + 1 }))))}개`
          : b.type === 'storage'
            ? ` · 용량 +${num(STORAGE_CAP[b.level])}`
            : b.type === 'market'
              ? ` · 하루 ${num(MARKET_LIMIT[b.level])}닢까지`
              : recipeOf(b.type)
                ? ` · 한 번에 ${batchMax(b.type, b.level + 1)}개, 더 빨리`
                : '';
        up = `<div class="up-box"><div class="up-tx"><b>레벨 ${b.level + 1}로 올리기</b><span class="costs">${costHtml(c, p.resources)}<span class="cost">${icon('time')}${duration(upgradeSec(b.type, b.level))}</span></span>
          <span class="soft">${block || `레벨 ${b.level + 1}${gain}`}</span></div>
          <button class="btn primary" data-upgrade="${b.id}" ${block ? 'disabled' : ''}>업그레이드</button></div>`;
      }
    }
    const canStore = b.type !== 'hall' && b.state === 'done';
    return `<div class="sheet-head">${art(b.type, b.state === 'building' ? 1 : lookOf(b.level))}<h3>${d.name}${upgradable(b.type) ? ` <small>레벨 ${b.level}</small>` : ''}</h3><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
      <div class="b-info">${lines.join('')}</div>${up}
      <div class="actions"><button class="btn" data-move="${b.id}">옮기기</button>${upgradable(b.type) ? '<button class="btn soon" data-soon>주민 배치</button>' : ''}<button class="btn" data-store="${b.id}" ${canStore ? '' : 'disabled'}>보관</button></div>`;
  }

  /** 시간에 따라 바뀌는 글자만 고친다 (버튼을 누르는 도중에 판 전체를 다시 그리지 않게) */
  function tickSheet() {
    if (sheet?.kind !== 'building') return;
    const b = state.buildings.find((v) => v.id === (sheet as { id: string }).id);
    if (!b) return;
    const now = api.now();
    const st = sheetEl.querySelector('[data-live="stored"]');
    if (st) st.textContent = `${num(stored(state, b, now))} / ${num(Math.floor((capSec(state) * effRate(state, b)) / 3600))}`;
    const fe = sheetEl.querySelector('[data-live="feast"]');
    if (fe) fe.textContent = state.profile.feastUntil > now ? `${duration((state.profile.feastUntil - now) / 1000)} 남았어요` : '잔치가 끝났어요';
    const left = sheetEl.querySelector('[data-live="left"]');
    if (left && b.finishAt !== null) left.textContent = `${b.state === 'building' ? '짓는 중' : `레벨 ${b.level + 1}로 올리는 중`} · ${b.finishAt > now ? `${duration((b.finishAt - now) / 1000)} 남음` : '곧 끝나요'}`;
    const job = sheetEl.querySelector('[data-live="job"]');
    if (job && b.finishAt !== null) {
      const out = RES_NAME[recipeOf(b.type)!.out];
      job.textContent = b.finishAt > now ? `${out} ${b.jobN}개 만드는 중 · ${duration((b.finishAt - now) / 1000)} 남음` : `${out} ${b.jobN}개가 다 됐어요! 건물 위의 방울을 눌러 거두세요`;
    }
  }

  wrap.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === wrap || el.closest('[data-close]')) {
      sfx('click');
      return openSheet(null);
    }
    const bt = el.closest('button') as HTMLButtonElement | null;
    if (!bt || bt.disabled) return;
    const d = bt.dataset;
    if (d.tab) {
      sfx('click');
      sheetEl.scrollTop = 0;
      openSheet({ kind: 'build', tab: d.tab as Tab });
    } else if (d.build) {
      sfx('click');
      startPlacing(d.build as BuildingType, null);
    } else if (d.move || d.take) {
      sfx('click');
      const b = state.buildings.find((v) => v.id === (d.move ?? d.take));
      if (b) startPlacing(b.type, b.id);
    } else if (d.upgrade) {
      const id = d.upgrade;
      bt.disabled = true;
      void act(() => api.upgrade(id), (s) => {
        sfx('tankBuild');
        apply(s);
      });
    } else if (d.store) {
      const id = d.store;
      bt.disabled = true;
      void act(() => api.store(id), (s) => {
        sfx('chip');
        toast('보관함에 넣었어요 ([짓기] → 보관함에서 다시 놓을 수 있어요)', 2600);
        apply(s);
      });
    } else if (d.step) {
      sfx('click');
      craftN = d.step === 'max' ? 9999 : craftN + Number(d.step);
      paintSheet();
    } else if (d.craft) {
      const id = d.craft;
      const n = craftN;
      bt.disabled = true;
      void act(() => api.craft(id, n), (s) => {
        sfx('tankBuild');
        apply(s);
      });
    } else if (d.sell) {
      const res = d.sell;
      const n = Number(d.n);
      bt.disabled = true;
      void act(() => api.sell(res, n), (r) => {
        sfx('coin');
        toast(`${RES_NAME[res as ResId]} ${num(n)}개를 팔아 엽전 ${num(r.sold)}닢을 받았어요`);
        apply(r.state);
      });
    } else if (d.expand !== undefined) {
      bt.disabled = true;
      void act(() => api.expand(), (s) => {
        sfx('win');
        const size = LAND_SIZES[s.profile.landStage];
        toast(`땅이 ${size}×${size} 칸으로 넓어졌어요!`, 2600);
        openSheet(null);
        apply(s);
      });
    } else if (d.feast !== undefined) {
      bt.disabled = true;
      void act(() => api.feast(), (s) => {
        sfx('win');
        toast('잔치가 열렸어요! 하루 동안 마을 전체 생산이 늘어나요', 2800);
        apply(s);
      });
    } else if (d.soon !== undefined) {
      sfx('click');
      toast('준비 중이에요');
    }
  });

  // ───────────────────────── 놓을 자리 고르기 ─────────────────────────

  const bar = $('#placebar');
  function startPlacing(type: BuildingType, movingId: string | null) {
    openSheet(null);
    const kept = movingId !== null && state.buildings.find((b) => b.id === movingId)?.state === 'stored';
    $('#placetx').innerHTML = `<b>${BUILDING[type].name}</b> ${movingId && !kept ? '옮길' : '놓을'} 칸을 눌러 주세요 <small>(끌어서 옮길 수도 있어요)</small>`;
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
    const kept = movingId !== null && state.buildings.find((b) => b.id === movingId)?.state === 'stored';
    const ok = $<HTMLButtonElement>('#placeok');
    ok.disabled = true;
    void act(
      () => (movingId ? (kept ? api.place(movingId, x, y) : api.move(movingId, x, y)) : api.build(type, x, y).then((r) => r.state)),
      (s) => {
        sfx(movingId ? 'chip' : 'tankBuild');
        stopPlacing();
        apply(s);
        // 길은 이어서 놓는다 (더 놓을 수 있고 값이 있으면)
        if (!movingId && BUILDING[type].kind === 'road' && countOf(s, type) < maxCount(type, s.profile.level) && canPay(s.profile, buildCost(type))) startPlacing(type, null);
      },
    ).finally(() => (ok.disabled = false));
  });

  // ───────────────────────── 메뉴 · 목표 ─────────────────────────

  $('#menu').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    sfx('click');
    if (b.dataset.m === 'build') openSheet({ kind: 'build', tab: 'main' });
    else toast('준비 중이에요');
  });

  $('#goal').addEventListener('click', () => {
    const g = goalStatus(state);
    if (!g) return;
    if (!g.done) {
      sfx('click');
      toast(`${goalText(g.def)} (${num(g.have)}/${num(g.def.n)})`);
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
      if (isGift(d.id)) continue;
      const more = maxCount(d.id, to) - maxCount(d.id, from);
      if (more <= 0) continue;
      if (maxCount(d.id, from) === 0) opened.push(`<li><b>${d.kind === 'main' ? '새 건물' : d.kind === 'special' ? '특별 건물' : '새 장식'}</b> ${d.name}</li>`);
      else opened.push(`<li>${d.name} +${more}채</li>`);
    }
    const hallUp = HALL_NEED.findIndex((l) => l > from && l <= to);
    if (hallUp >= 0) opened.push(`<li>마을 회관 레벨 ${hallUp + 2}</li>`);
    const land = LAND_NEED.findIndex((l) => l > from && l <= to);
    if (land >= 0 && land >= state.profile.landStage) opened.push(`<li>땅 넓히기 ${LAND_SIZES[land + 1]}×${LAND_SIZES[land + 1]} (시아코인)</li>`);
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
  // 판의 남은 시간 · 쌓인 양, 잔치의 남은 시간
  setInterval(() => {
    tickSheet();
    tickHud();
  }, 500);
  // 다른 기기에서 한 일이나 놓친 완공을 반영한다: 1분마다, 그리고 화면으로 돌아왔을 때
  setInterval(() => document.visibilityState === 'visible' && void reload(), 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void reload();
  });
}
