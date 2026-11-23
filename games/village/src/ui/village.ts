import Phaser from 'phaser';
import { CAPPED, CONST, HALL_NEED, LAND_NEED, LAND_PRICE, LAND_SIZES, LEVEL_EXP, MARKET_LIMIT, NAME_RE, PRICES, RES_IDS, RES_NAME, STORAGE_CAP, VIEW_W, kstDay, lookOf, pricePct, type ResId } from '../data/balance';
import { BUILDING, BUILDINGS, isReward, recipeOf, upgradable, type BuildingType } from '../data/buildings';
import { GAMES, visibleMonuments, type GameStats } from '../data/monuments';
import { goalText, josa } from '../data/goals';
import { CAT_LAND_STAGE, CAT_PRICE, RATE_WORKERS, RESIDENT, RESIDENTS, affLevel, type ResidentId } from '../data/residents';
import {
  batchMax, buildCost, buildSec, busyCount, canHaveMore, canPay, capSec, countCap, countOf, effRate, feasting, goalStatus, landOpen, market, marketLimit, maxCount, nextUnlock, pavilionRange, payOf, ratePct, residentOf, residentPct, sellCoins, isFull, normalMax,
  newVillage, nextResident, praiseLeft, sellLeft, siaOf, slotFree, slots, standing, storageCap, stored, storedMax, unitSec, upgradeCost, upgradeGate, upgradeSec, workersAt, workplace, type Building, type Cost, type VillageState,
} from '../game/rules';
import { makeShowcase } from '../data/showcase';
import { ApiError, LOCAL_MODE, type RankRow, type Ranking, type VillageApi, type Visit } from '../net/api';
import { worldGameOpen, worldHome, zodiacFace, zodiacFull } from '../net/world';
import { PRAISE_LIST_MAX, agoText, praiseNotice, type PraiseInbox } from '../game/praise';
import { VillageScene, type SceneData, type SceneHooks } from '../scenes/VillageScene';
import { texKey } from '../scenes/art';
import { kstHour, skyAt } from '../scenes/sky';
import { music } from './music';
import { duration, esc, num, screen, sfx, sound, stage, toast } from './app';
import { DPR } from './dpr';
import { icon, menuIcon } from './icons';
import { bonusOf, claimable, requestsPanel, residentsPanel, workersBox } from './people';

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
    'no resident': '아직 이사 오지 않은 주민이에요',
    'no work': '이 주민은 배치하지 않아도 힘을 내요',
    'wrong building': '이 주민의 일터가 아니에요',
    'no request': '부탁이 이미 끝났어요',
    'no task': '없는 할 일이에요',
    claimed: '이미 받았어요',
    'bad name': '한글 · 영문 · 숫자로 12자까지 지을 수 있어요',
    self: '내 마을은 칭찬할 수 없어요',
    'no village': '없는 마을이에요',
    'already praised': '오늘은 이 마을을 이미 칭찬했어요',
    'praise limit': '칭찬은 하루에 다섯 번까지 할 수 있어요',
    'need login': '로그인이 필요해요',
    'not admin': '관리자만 할 수 있어요',
    'bad state': '전시 마을의 모양이 올바르지 않아요',
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
type Sheet = { kind: 'build'; tab: Tab } | { kind: 'building'; id: string } | { kind: 'residents' } | { kind: 'requests' } | { kind: 'ranking'; praise?: boolean } | { kind: 'monuments' } | null;

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
          <div class="lv-tx"><b id="vname" role="button" title="마을 이름 바꾸기"></b><div class="exp"><i id="expfill"></i><span id="exptx"></span></div></div>
        </div>
        <div class="pill sia" title="시아코인">${icon('sia')}<b id="sia">-</b></div>
      </div>
      <div class="res-row" id="res"></div>
      <button class="goal" id="goal"></button>
      <div class="praise-note hidden" id="praisenote">
        <button class="pn-main" id="praisego"><em>👏</em><b id="praisetx"></b><i class="tag" id="praisetag"></i></button>
        <button class="icon-btn" id="praisex" aria-label="칭찬 알림 닫기">✕</button>
      </div>
    </header>
    <div class="visit-top hidden" id="visittop"></div>
    <div class="visit-bar hidden" id="visitbar">
      <button class="btn" id="visitback">← 내 마을로</button><button class="btn primary" id="visitpraise">👏 칭찬하기</button>
    </div>
    <div class="place-bar hidden" id="placebar">
      <p id="placetx"></p>
      <div class="actions"><button class="btn" id="placeno">취소</button><button class="btn primary" id="placeok">여기에 놓기 ✔</button></div>
    </div>
    <button class="icon-btn sound" id="sound" aria-label="소리"></button>
    <nav class="menu" id="menu">
      <button data-m="build"><em>${menuIcon('build', '🔨')}</em>짓기</button>
      <button data-m="residents"><em>${menuIcon('residents', '🐭')}</em>주민</button>
      <button data-m="requests"><em>${menuIcon('requests', '📜')}</em>부탁<i class="dot hidden" id="reqdot"></i></button>
      <button data-m="monuments"><em>${menuIcon('monuments', '🏯')}</em>기념물</button>
      <button data-m="ranking"><em>${menuIcon('ranking', '🏆')}</em>랭킹<i class="dot hidden" id="praisedot"></i></button>
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
        // 창고 · 번영도는 한 묶음 (좁은 화면에서 번영도만 혼자 다음 줄로 내려가지 않게)
        .join('') + `<div class="caps"><div class="cap">창고 ${num(cap)}</div><div class="cap pros" title="번영도">🏵 ${num(p.prosperity)}</div></div>` + (feasting(state, api.now()) ? `<div class="cap feast" id="feasttx"></div>` : '');
    $('#sia').textContent = num(state.sia);
    const todo = claimable(state);
    $('#reqdot').textContent = String(todo);
    $('#reqdot').classList.toggle('hidden', todo === 0);
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

  // ───────────────────────── 마을 이름 ─────────────────────────

  $('#vname').addEventListener('click', () => {
    // 구경 중에는 HUD 가 숨어 있다
    if (visiting) return;
    sfx('click');
    stage.querySelector('.dim')?.remove();
    const dim = document.createElement('div');
    dim.className = 'dim';
    dim.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="마을 이름">
      <h3>마을 이름</h3>
      <input class="name-in" maxlength="${CONST.name_max}" placeholder="${esc(user.name)}네 마을" />
      <p class="soft">한글 · 영문 · 숫자 · 띄어쓰기로 ${CONST.name_max}자까지. 랭킹과 구경하는 사람에게 보여요</p>
      <div class="actions"><button class="btn" data-close>취소</button><button class="btn primary" data-ok>바꾸기</button></div>
    </div>`;
    const input = dim.querySelector('input')!;
    input.value = state.profile.name;
    dim.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === dim || el.closest('[data-close]')) return dim.remove();
      if (!el.closest('[data-ok]')) return;
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (!NAME_RE.test(name) || name.length > CONST.name_max) return toast('한글 · 영문 · 숫자로 12자까지 지을 수 있어요');
      void act(() => api.rename(name), (s) => {
        sfx('win');
        dim.remove();
        apply(s);
      });
    });
    stage.append(dim);
    input.focus();
  });

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
  /**
   * 서버 일을 줄 세운다. 실패하면 까닭을 알리고 false.
   * 서버가 거절한 것(ApiError)이 아닌 실패(통신 오류 · 12초 시간 초과)는 서버에서는 됐을 수도 있으므로, 곧바로 다시 읽기를 줄에 넣어 서버 상태로 맞춘다
   */
  function act<T>(job: () => Promise<T>, done?: (out: T) => void, quiet = false, resync = true): Promise<boolean> {
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
        if (resync && !(e instanceof ApiError)) void reload();
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
        sfx('villDone');
      }
    }
    // 새 주민 · 친밀도 단계
    for (const r of next.residents) {
      const d = RESIDENT[r.id];
      const old = prev.residents.find((v) => v.id === r.id);
      if (!old) {
        toast(`${d.nick}${josa(d.nick, '이', '가')} 이사 왔어요! 🎉`, 3000);
        sfx('villWelcome');
      } else if (affLevel(r.affinity) > affLevel(old.affinity)) {
        const lv = affLevel(r.affinity);
        toast(lv >= 5 && r.gifted && !old.gifted ? `${d.nick}${josa(d.nick, '과', '와')} 단짝이 됐어요! 선물이 보관함에 들어왔어요 🎁` : `${d.nick}${josa(d.nick, '과', '와')} 더 친해졌어요 (♥${lv})`, 3200);
        sfx('win');
      }
    }
    const fresh = next.monuments.filter((m) => !prev.monuments.includes(m));
    if (fresh.length) {
      toast(`새 기념물: ${fresh.map((m) => BUILDING[m].name).join(' · ')} — 보관함에 들어왔어요 🏯`, 3500);
      sfx('win');
    }
    paintHud();
    if (!visiting) scene?.refresh();
    paintSheet();
    if (next.profile.level > prev.profile.level) levelUp(prev.profile.level, next.profile.level);
  }

  // ───────────────────────── 기념물 (PRD 9장) ─────────────────────────

  let gameStats: GameStats | null = null;
  let statsFailed = false;
  /** 게임별 오픈 여부 (아직 못 읽었거나 못 불러왔으면 null → 기념물을 모두 보여 준다) */
  let gameOpen: Record<string, boolean> | null = null;
  /** 한 번만 읽는다 (못 읽었으면 [기념물]을 열 때 다시 해 본다. 테스트 모드는 서버가 없다 → 모두 보인다) */
  function loadGameOpen() {
    if (gameOpen || LOCAL_MODE) return;
    void worldGameOpen().then((o) => {
      if (!o) return;
      gameOpen = o;
      if (sheet?.kind === 'monuments') paintSheet();
    });
  }
  // 창을 열기 전에 미리 읽어 둔다 (닫힌 게임의 기념물이 잠깐 보였다 사라지지 않게)
  loadGameOpen();
  function monumentsPanel(): string {
    // 닫힌 게임의 기념물은 감춘다 (관리자 · 이미 받은 것은 그대로). 합계도 보이는 것만 센다
    const list = visibleMonuments(gameOpen, state.admin, state.monuments);
    const head = `<div class="sheet-head"><h3>${menuIcon('monuments', '🏯')} 기념물</h3><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
      <p class="soft note">SIA WORLD 의 다른 게임에서 성과를 내면 열려요. 열린 기념물은 보관함으로 들어오고, 번영도가 크게 올라요 · <b>${list.filter((m) => state.monuments.includes(m.id)).length}</b> / ${list.length}</p>`;
    const groups = GAMES.map((g) => {
      const mine = list.filter((m) => m.game === g.id);
      if (!mine.length) return '';
      const rows = mine
        .map((m) => {
          const d = BUILDING[m.id];
          const open = state.monuments.includes(m.id);
          const b = state.buildings.find((v) => v.type === m.id);
          const have = Math.min(m.need, gameStats?.[m.stat] ?? 0);
          const side = !open ? `<span class="lock">🔒 ${gameStats && m.need > 1 ? `${num(have)} / ${num(m.need)}` : '잠김'}</span>`
            : b?.state === 'stored' ? `<button class="btn small primary" data-take="${b.id}">놓기</button>`
            : '<span class="lock on">마을에 세웠어요</span>';
          return `<div class="b-row mon ${open ? '' : 'shut'}">${art(m.id, 1)}
            <div class="b-tx"><b>${d.name} <small>🏵 +${d.points}</small></b><span class="soft">${m.cond}</span></div>${side}</div>`;
        })
        .join('');
      return `<h4 class="mon-game">${g.icon} ${g.name}</h4>${rows}`;
    }).join('');
    return `${head}${statsFailed ? '<p class="soft empty">기록을 불러오지 못했어요</p>' : ''}<div class="b-list">${groups}</div>`;
  }
  function openMonuments() {
    statsFailed = false;
    openSheet({ kind: 'monuments' });
    loadGameOpen();
    // 다른 서버 일과 같은 줄에서 (늦게 온 답이 그 뒤의 새 상태를 덮지 않게)
    void act(
      () => api.monuments(),
      (r) => {
        gameStats = r.stats;
        apply(r.state);
      },
      true,
    ).then((ok) => {
      if (ok) return;
      statsFailed = true;
      paintSheet();
    });
  }

  // ───────────────────────── 랭킹 · 다른 마을 구경 · 칭찬 ─────────────────────────

  let ranking: Ranking | null = null;
  let rankingFailed = false;
  /** 구경 중인 마을과, 장면이 그릴 수 있게 옮긴 모양 */
  let visiting: Visit | null = null;
  let viewState: VillageState | null = null;
  const villageName = (name: string, nick: string) => name || `${nick}네 마을`;

  function rankingPanel(praise: boolean): string {
    const head = `<div class="sheet-head"><h3>${praise ? '👏 받은 칭찬' : `${menuIcon('ranking', '🏆')} 번영도 랭킹`}</h3><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
      <div class="seg wide"><button data-rtab="rank" class="${praise ? '' : 'sel'}">🏆 순위</button><button data-rtab="praise" class="${praise ? 'sel' : ''}">👏 받은 칭찬</button></div>`;
    if (praise) return head + praiseBody();
    if (rankingFailed) return `${head}<p class="soft empty">랭킹을 불러오지 못했어요</p>`;
    if (!ranking) return `${head}<p class="soft empty">불러오는 중…</p>`;
    const row = (r: Ranking['rows'][number]) => `<div class="r-row ${r.userId === user.id ? 'me' : ''}"><em class="r-pl ${r.place <= 3 ? `top${r.place}` : ''}">${r.place}</em>
        <div class="p-tx"><b>${esc(r.nickname)}</b><span class="soft">${esc(villageName(r.name, r.nickname))} · 레벨 ${r.level}</span></div>
        <span class="r-pt">🏵 ${num(r.prosperity)}</span>${r.userId === user.id ? '<span class="lock on">내 마을</span>' : `<button class="btn small" data-visit="${esc(r.userId)}">구경</button>`}</div>`;
    const adminRow = (r: RankRow) => `<div class="r-row ${r.userId === user.id ? 'me' : ''}"><em class="r-pl">👑</em>
        <div class="p-tx"><b>${esc(r.nickname)}</b><span class="soft">${esc(villageName(r.name, r.nickname))} · 레벨 ${r.level}</span></div>
        ${r.userId === user.id ? '<span class="lock on">내 마을</span>' : `<button class="btn small" data-visit="${esc(r.userId)}">구경</button>`}</div>`;
    const mine = ranking.mine;
    return `${head}<p class="soft note">${mine ? `내 순위 <b>${mine.place}위</b> / ${num(ranking.total)}곳 · 번영도 ${num(mine.prosperity)}` : state.admin ? '관리자는 랭킹에 나오지 않아요' : '아직 순위가 없어요'} · 건물 레벨 · 장식물 · 기념물 · 주민 친밀도 · 받은 칭찬을 더한 값이에요</p>
      ${ranking.admins.length ? `<h4>👑 관리자 마을 <small class="soft">랭킹에는 나오지 않아요</small></h4><div class="b-list">${ranking.admins.map(adminRow).join('')}</div><h4>🏆 순위</h4>` : ''}
      <div class="b-list">${mine && !ranking.rows.some((r) => r.userId === mine.userId) ? row(mine) : ''}${ranking.rows.map(row).join('') || '<p class="soft empty">아직 마을이 없어요</p>'}</div>`;
  }
  function openRanking() {
    ranking = null;
    rankingFailed = false;
    openSheet({ kind: 'ranking' });
    void api.ranking().then(
      (r) => {
        ranking = r;
        paintSheet();
      },
      () => {
        rankingFailed = true;
        paintSheet();
      },
    );
  }

  // ───────────────────────── 받은 칭찬: 접속했을 때의 알림 · 목록 · 답방 ─────────────────────────

  let inbox: PraiseInbox | null = null;
  let inboxFailed = false;
  /** 알림을 눌렀거나 닫았다 (새로 읽을 때까지 다시 띄우지 않는다) */
  let noteOff = false;
  /** 읽기와 "다 봤음"은 보낸 순서대로 (다 봤다고 한 것이 늦게 온 옛 목록으로 되살아나지 않게) */
  let praiseJob: Promise<unknown> = Promise.resolve();
  const praiseOpen = () => sheet?.kind === 'ranking' && sheet.praise === true;
  function paintPraise() {
    const n = noteOff ? null : praiseNotice(inbox);
    $('#praisenote').classList.toggle('hidden', !n);
    $('#praisedot').classList.toggle('hidden', !n);
    if (!n) return;
    $('#praisedot').textContent = String(Math.min(99, n.count));
    $('#praisetx').textContent = n.text;
    $('#praisetag').textContent = n.visit ? '구경 가기' : '모두 보기';
  }
  function loadInbox(): Promise<unknown> {
    praiseJob = praiseJob
      .then(() => api.praiseInbox())
      .then(
        (r) => {
          inbox = r;
          inboxFailed = false;
          noteOff = false;
        },
        () => {
          inboxFailed = true;
        },
      )
      .then(() => {
        paintPraise();
        if (praiseOpen()) paintSheet();
      });
    return praiseJob;
  }
  /** 다 봤음: 알림을 내리고 서버에 적는다 (목록의 "새 칭찬" 표시는 다음에 읽을 때까지 남는다) */
  function markSeen(box: PraiseInbox | null = inbox) {
    // 그사이 목록을 새로 읽었으면(더 새 칭찬이 있을 수 있다) 알림은 그대로 두고, 그때 본 것까지만 서버에 적는다
    const cur = box === inbox;
    const had = (!cur || !noteOff) && !!box && box.fresh > 0;
    if (cur) {
      noteOff = true;
      paintPraise();
    }
    // 본 시각 = 실제로 받은 목록의 가장 최근 칭찬 시각 (서버가 +1ms 해서 그 칭찬까지 본 것으로 친다).
    // 서버의 '지금'(box.now)을 보내면, 읽는 순간 아직 커밋되지 않은 칭찬(created_at 이 그보다 앞)이 본 것으로 묻힌다
    const at = box?.rows.length ? Math.max(...box.rows.map((r) => r.at)) : null;
    if (had && at !== null) praiseJob = praiseJob.then(() => api.praiseSeen(at)).catch(() => undefined);
  }
  function openPraises() {
    openSheet({ kind: 'ranking', praise: true });
    void loadInbox().then(() => markSeen());
  }
  function praiseBody(): string {
    if (!inbox) return `<p class="soft empty">${inboxFailed ? '받은 칭찬을 불러오지 못했어요' : '불러오는 중…'}</p>`;
    const now = api.now();
    const rows = inbox.rows
      .map((r) => `<div class="r-row pr-row ${r.fresh ? 'me' : ''}"><em class="r-pl">👏</em>
        <div class="p-tx"><b>${esc(r.nickname)}${r.fresh ? ' <i class="tag">새 칭찬</i>' : ''}</b><span class="soft">${esc(villageName(r.name, r.nickname))} · ${agoText(r.at, now)}</span></div>
        <button class="btn small" data-visit="${esc(r.userId)}">구경</button></div>`)
      .join('');
    return `<p class="soft note">지금까지 받은 칭찬 <b>${num(state.profile.praiseCount)}번</b> · 한 번에 번영도 +${CONST.praise_points} · 최근 ${PRAISE_LIST_MAX}개까지 보여요. 구경 가서 답방해 보세요</p>
      <div class="b-list">${rows || '<p class="soft empty">아직 받은 칭찬이 없어요.<br />다른 마을을 구경하고 먼저 칭찬해 보세요</p>'}</div>`;
  }
  $('#praisego').addEventListener('click', () => {
    const n = noteOff ? null : praiseNotice(inbox);
    if (!n || visiting || scene?.placing) return;
    sfx('click');
    if (!n.visit) return openPraises();
    // 구경이 성공한 뒤에 본 것으로 적는다 (통신 오류로 못 갔는데 알림만 사라지지 않게)
    const box = inbox;
    startVisit(n.visit, () => markSeen(box));
  });
  $('#praisex').addEventListener('click', () => {
    sfx('click');
    markSeen();
  });

  /** 구경하는 마을을 장면이 그릴 수 있는 모양으로 (수확 방울 · 진행 막대는 뜨지 않는다) */
  function toViewState(v: Visit): VillageState {
    const s = newVillage(api.now());
    s.profile.level = v.level;
    s.profile.landStage = v.landStage;
    s.profile.name = v.name;
    s.profile.prosperity = v.prosperity;
    s.buildings = v.buildings.map((b) => ({ id: b.id, type: b.type, level: b.level, x: b.x, y: b.y, state: b.state, finishAt: null, startAt: null, collectedAt: Number.MAX_SAFE_INTEGER, jobN: 0, banked: 0, accFrom: 0 }));
    s.residents = v.residents.map((r) => ({ id: r.id, affinity: r.affinity, building: r.building, gifted: false }));
    return s;
  }
  function paintVisit() {
    const v = visiting;
    for (const sel of ['.hud', '#menu', '#sound']) $(sel).classList.toggle('hidden', !!v);
    $('#visittop').classList.toggle('hidden', !v);
    $('#visitbar').classList.toggle('hidden', !v);
    if (!v) return;
    $('#visittop').innerHTML = `<img src="${zodiacFace(GUIDE)}" alt="" /><span class="g-tx"><small>${esc(v.nickname)} 님의 마을을 구경하는 중</small><b>${esc(villageName(v.name, v.nickname))}</b></span>
      <span class="g-side"><i class="g-n">레벨 ${v.level}</i><i class="g-n">🏵 ${num(v.prosperity)}</i></span>`;
    const bt = $<HTMLButtonElement>('#visitpraise');
    bt.disabled = v.mine || v.praised || v.praiseLeft <= 0;
    bt.textContent = v.mine ? '내 마을이에요' : v.praised ? '오늘 칭찬했어요 👏' : v.praiseLeft <= 0 ? '오늘 칭찬을 다 했어요' : `👏 칭찬하기 (${v.praiseLeft}번 남음)`;
  }
  function showVisit(v: Visit) {
    openSheet(null);
    if (scene?.placing) stopPlacing();
    const other = visiting?.userId !== v.userId;
    visiting = v;
    viewState = toViewState(v);
    paintVisit();
    // 다른 마을: 주민은 그 마을 회관 앞에서 새로 나타난다 (앞 마을의 자리에서 걸어 들어오지 않게)
    if (other) scene?.switchVillage();
    scene?.refresh();
    scene?.fit();
  }
  function startVisit(id: string, then?: () => void) {
    void act(() => api.visit(id), (v) => {
      showVisit(v);
      then?.();
    });
  }
  function endVisit() {
    visiting = null;
    viewState = null;
    paintVisit();
    scene?.switchVillage();
    scene?.refresh();
    scene?.fit();
  }
  $('#visitback').addEventListener('click', () => {
    sfx('click');
    endVisit();
  });
  $('#visitpraise').addEventListener('click', () => {
    const v = visiting;
    if (!v) return;
    void act(() => api.praise(v.userId), (r) => {
      sfx('win');
      toast(`${v.nickname} 님의 마을을 칭찬했어요! 엽전 ${CONST.praise_coin}닢을 받았어요 (오늘 ${Math.max(0, praiseLeft(r.state, api.now()))}번 남음)`, 3000);
      apply(r.state);
      if (visiting?.userId === r.visit.userId) {
        visiting = r.visit;
        viewState = toViewState(r.visit);
        paintVisit();
      }
    });
  });

  /**
   * 서버 상태를 다시 읽는다 (게임에 들어올 때가 아니므로 entry = false). 이것이 실패해도 또 다시 읽지는 않는다.
   * 이미 줄에 선 다시 읽기가 있으면 그것을 같이 기다린다 (통신이 멈춘 동안 2초마다 다시 읽기가 쌓이지 않게)
   */
  let reloading: Promise<boolean> | null = null;
  const reload = (quiet = true) =>
    reloading ??
    (reloading = act(() => api.load(false), apply, quiet, false).finally(() => {
      reloading = null;
    }));

  // ───────────────────────── 수확 (끌면서 지나간 건물을 모아 한 번에 보낸다) ─────────────────────────

  let batch: string[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 창고가 가득할 때: 넘친 양은 버린다 (서버 규칙). 거두기 전에 한 번 묻는다 — 끌어서 한꺼번에 거둘 때는 처음 넘치는 건물부터
   * 모은 것을 손을 뗄 때 한 번만 (넘치기 전에 모은 것은 그대로 보낸다).
   *   ask 넘치는 것을 모으는 중 (손을 떼면 묻는다) · asking 묻는 창이 떠 있다
   */
  let gate: 'none' | 'ask' | 'asking' = 'none';
  /** 보냈거나 보낼 수확이 창고에 넣을 양 (답이 와서 상태에 들어가면 지운다) */
  const planned = new Map<string, { res: ResId; n: number }>();

  /** 그 건물에 쌓인 것을 지금 거두면 넘쳐서 버려지는 양 (창고 용량이 있는 자원만. harvest: 닭의 첫 수확 보너스까지) */
  function lossOf(b: Building, harvesting: boolean): { res: ResId; have: number; lost: number } | null {
    const res = b.state === 'working' ? recipeOf(b.type)?.out : BUILDING[b.type].product;
    const now = api.now();
    let have = stored(state, b, now);
    if (!res || have <= 0) return null;
    if (harvesting && b.state === 'done' && state.profile.roosterDay !== kstDay(now)) have += Math.floor((have * residentPct(state, 'rooster')) / 100);
    if (!CAPPED.includes(res)) return { res, have, lost: 0 };
    let room = storageCap(state) - state.profile.resources[res];
    for (const [id, p] of planned) if (id !== b.id && p.res === res) room -= p.n;
    return { res, have, lost: Math.max(0, have - Math.max(0, room)) };
  }

  /** 확인 창 하나 (다른 창이 덮어 지워지면 '아니요'로 본다) */
  function ask(title: string, html: string, okLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      stage.querySelector('.dim')?.remove();
      const dim = document.createElement('div');
      dim.className = 'dim';
      dim.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h3>${esc(title)}</h3><p>${html}</p>
        <div class="actions"><button class="btn" data-close>그만두기</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>
      </div>`;
      let over = false;
      const end = (yes: boolean) => {
        if (over) return;
        over = true;
        watch.disconnect();
        dim.remove();
        resolve(yes);
      };
      const watch = new MutationObserver(() => !dim.isConnected && end(false));
      dim.addEventListener('click', (e) => {
        const el = e.target as HTMLElement;
        if (el === dim || el.closest('[data-close]')) {
          sfx('click');
          end(false);
        } else if (el.closest('[data-ok]')) {
          sfx('click');
          end(true);
        }
      });
      stage.append(dim);
      watch.observe(stage, { childList: true });
    });
  }
  /** 모아 둔 수확을 보내면 넘쳐서 버려지는 양 (자원마다 모아서 센다) */
  function batchLoss(ids: string[]): number {
    const have = new Map<ResId, number>();
    for (const id of ids) {
      const p = planned.get(id);
      if (p && CAPPED.includes(p.res)) have.set(p.res, (have.get(p.res) ?? 0) + p.n);
    }
    let lost = 0;
    for (const [res, n] of have) {
      let room = storageCap(state) - state.profile.resources[res];
      for (const [id, p] of planned) if (!ids.includes(id) && p.res === res) room -= p.n;
      lost += Math.max(0, n - Math.max(0, room));
    }
    return lost;
  }

  /** 업그레이드 · 보관이 쌓인 것을 먼저 거둘 때 넘치면 묻는다 (넘치지 않으면 바로 true) */
  function askLoss(id: string, okLabel: string): Promise<boolean> {
    const b = state.buildings.find((v) => v.id === id);
    const o = b ? lossOf(b, false) : null;
    if (!o || o.lost <= 0) return Promise.resolve(true);
    return ask('창고가 가득해요', `쌓여 있던 ${RES_NAME[o.res]} ${num(o.have)}개를 먼저 거두는데, 창고가 가득해서 <b>${num(o.lost)}개</b>는 버려져요`, okLabel);
  }

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
        if (Object.keys(r.harvest.per).length > 0) sfx('villHarvest');
        if (r.harvest.lost > 0) toast(`창고가 가득 차서 ${num(r.harvest.lost)}개는 담지 못했어요`, 2800);
        else if (r.harvest.rooster > 0) toast(`${RESIDENT.rooster.nick} 덕분에 오늘의 첫 수확이 ${r.harvest.rooster}% 더 많아요! 🐔`, 2800);
      },
    ).then((ok) => {
      for (const id of ids) planned.delete(id);
      if (!ok) scene?.harvested(ids, {});
    });
  }

  // ───────────────────────── 아래 판 (짓기 메뉴 · 건물 관리) ─────────────────────────

  let sheet: Sheet = null;
  /** 새 부탁을 서버에 마지막으로 물어본 때 */
  let askedAt = 0;
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
    sheetEl.innerHTML =
      sheet.kind === 'build' ? buildMenu(sheet.tab)
      : sheet.kind === 'residents' ? residentsPanel(state)
      : sheet.kind === 'requests' ? requestsPanel(state)
      : sheet.kind === 'ranking' ? rankingPanel(sheet.praise === true)
      : sheet.kind === 'monuments' ? monumentsPanel()
      : buildingPanel(state.buildings.find((b) => b.id === (sheet as { id: string }).id)!);
    sheetEl.scrollTop = top;
    markBusy();
    tickSheet();
  }

  /** 답을 기다리는 판의 일 (판을 다시 그려도 그 버튼은 막아 둔다) */
  const busy = new Set<string>();
  const busyKey = (d: DOMStringMap): string | null =>
    d.upgrade ? `upgrade:${d.upgrade}`
    : d.store ? `store:${d.store}`
    : d.craft ? `craft:${d.craft}`
    : d.sell ? `sell:${d.sell}`
    : d.assign ? `assign:${d.assign.split(':')[0]}`
    : d.rest ? `assign:${d.rest}`
    : d.done ? `req:${d.done}`
    : d.skip ? `req:${d.skip}`
    : d.daily ? `daily:${d.daily}`
    : d.expand !== undefined ? 'expand'
    : d.buycat !== undefined ? 'buycat'
    : d.feast !== undefined ? 'feast'
    : null;
  function markBusy() {
    if (busy.size === 0) return;
    for (const b of sheetEl.querySelectorAll<HTMLButtonElement>('button')) {
      const k = busyKey(b.dataset);
      if (k && busy.has(k)) b.disabled = true;
    }
  }
  /** 판의 버튼 하나로 서버 일을 한다: 답이 올 때까지 그 버튼(같은 일의 버튼)을 막는다 */
  function sheetAct<T>(bt: HTMLButtonElement, job: () => Promise<T>, done: (out: T) => void): void {
    const key = busyKey(bt.dataset) ?? `btn:${Math.random()}`;
    if (busy.has(key)) return;
    busy.add(key);
    bt.disabled = true;
    markBusy();
    void act(job, done).finally(() => {
      busy.delete(key);
      paintSheet();
    });
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
      // 주민 선물 · 기념물은 지을 수 없다. 관리자도 여기서는 못 놓는다 (서버 village_build 는 선물 표시 · 기념물 기록을 남기지 않아 나중에 또 생긴다 → 전시 마을 [꾸미기]로)
      const list = BUILDINGS.filter((d) => d.id !== 'hall' && !isReward(d.id) && (tab === 'main' ? d.kind === 'main' : tab === 'special' ? d.kind === 'special' : d.kind === 'deco' || d.kind === 'road'));
      rows = (tab === 'special' ? landRow() : '') + list
        .map((d) => {
          const have = countOf(state, d.id);
          // 고양이를 산 마을은 주민 집 한 채 더 (countCap)
          const max = countCap(state, d.id);
          const next = nextUnlock(state, d.id);
          const more = canHaveMore(state, d.id);
          let side: string;
          if (more) side = `<button class="btn small primary" data-build="${d.id}">${d.kind === 'deco' || d.kind === 'road' ? '놓기' : '짓기'}</button>`;
          else if (next !== null && next > p.level) side = `<span class="lock">🔒 마을 레벨 ${next}</span>`;
          else side = '<span class="lock">모두 가졌어요</span>';
          const total = d.cap > 0 ? d.cap : Math.max(max, have);
          // 관리자: 개수 제한 · 값이 없다
          const costs = state.admin ? '<span class="cost pts">관리자 무료</span>' : `${siaHtml(d.sia, state.sia)}${costHtml(buildCost(d.id), p.resources)}`;
          return `<div class="b-row ${more ? '' : 'off'}">
            ${art(d.id, 1)}
            <div class="b-tx"><b>${d.name} <small>${state.admin ? `${have}개` : `${have}/${total}`}</small></b><span class="soft">${d.desc}</span>
              <span class="costs">${costs}${d.buildSec ? `<span class="cost">${icon('time')}${duration(buildSec(state, d.id))}</span>` : ''}${d.points ? `<span class="cost pts">번영도 +${d.points}</span>` : ''}</span></div>
            ${side}
          </div>`;
        })
        .join('');
    }
    const note = tab === 'special' ? `<p class="soft sia-note">${icon('sia')} 시아코인 <b>${num(state.sia)}</b> · SIA WORLD 의 어느 게임이든 한 판을 끝낼 때마다 1코인을 받아요</p>` : '';
    // 관리자만: 마을을 다 자란 모습(전시 마을)으로 바꾼다
    const admin = state.admin && tab === 'special'
      ? `<div class="b-row"><span class="b-art land">전시</span><div class="b-tx"><b>전시 마을로 꾸미기 <small>관리자</small></b><span class="soft">모든 땅 · 모든 건물(최고 레벨) · 장식물 · 선물 · 기념물을 다 놓은 최종 모습으로 바꿔요. 지금 마을의 건물 · 주민은 사라져요</span></div>
          <button class="btn small primary" data-showcase>꾸미기</button></div>`
      : '';
    return `<div class="sheet-head"><h3>${menuIcon('build', '🔨')} 짓기</h3><span class="soft">${state.admin ? `짓는 중 ${busyCount(state)} · 제한 없음` : `짓는 중 ${busyCount(state)}/${slots(state)}`}</span><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
      <div class="seg wide">${tabs}</div>${note}<div class="b-list">${admin}${rows}</div>`;
  }

  /** 땅 넓히기 (특별 탭의 첫 줄) */
  function landRow(): string {
    const p = state.profile;
    const stage = p.landStage;
    const size = LAND_SIZES[stage];
    if (stage >= LAND_SIZES.length - 1) return `<div class="b-row off"><span class="b-art land">${size}×${size}</span><div class="b-tx"><b>땅 넓히기</b><span class="soft">땅을 끝까지 넓혔어요</span></div><span class="lock">끝</span></div>`;
    const next = LAND_SIZES[stage + 1];
    const locked = !landOpen(state);
    const price = siaOf(state, LAND_PRICE[stage]);
    return `<div class="b-row ${locked ? 'off' : ''}"><span class="b-art land">${next}×${next}</span>
      <div class="b-tx"><b>땅 넓히기 <small>${stage}/6</small></b><span class="soft">${size}×${size} → ${next}×${next} 칸. 건물은 그 자리에 그대로 있어요</span>
        <span class="costs">${state.admin ? '<span class="cost pts">관리자 무료</span>' : siaHtml(price, state.sia)}</span></div>
      ${locked ? `<span class="lock">🔒 마을 레벨 ${LAND_NEED[stage]}</span>` : `<button class="btn small primary" data-expand ${state.sia < price ? 'disabled' : ''}>넓히기</button>`}</div>`;
  }

  /** 잔치 마당: 잔치 열기 */
  function feastBox(b: Building): string {
    const p = state.profile;
    const pct = CONST.feast_pct + CONST.feast_pct_per * (b.level - 1);
    if (feasting(state, api.now())) return `<p>🎉 잔치가 한창이에요! 마을 전체 생산 <b>+${p.feastPct}%</b></p><p class="live"><span data-live="feast"></span></p>`;
    if (b.state !== 'done') return `<p class="soft">다 지으면 떡 ${CONST.feast_cake}개로 잔치를 열 수 있어요</p>`;
    // 관리자는 떡을 내지 않는다 (063)
    const lack = !state.admin && p.resources.cake < CONST.feast_cake;
    const cake = state.admin ? '<span class="cost pts">관리자 무료</span>' : `<span class="cost ${lack ? 'lack' : ''}">${icon('cake')}${CONST.feast_cake}</span>`;
    return `<div class="up-box"><div class="up-tx"><b>잔치 열기</b><span class="costs">${cake}<span class="cost">${icon('time')}하루</span></span>
        <span class="soft">${lack ? '떡이 모자라요 (방앗간에서 만들어요)' : `하루 동안 마을 전체 생산 +${pct}%`}</span></div>
      <button class="btn primary" data-feast ${lack ? 'disabled' : ''}>잔치 열기</button></div>`;
  }

  /** 장터: 오늘의 시세와 팔기 */
  function marketBox(): string {
    const now = api.now();
    const p = state.profile;
    const m = market(state);
    if (!m) return '<p class="soft">다 지으면 자원을 엽전으로 팔 수 있어요</p>';
    // 관리자는 하루 한도가 없고 판 자원이 줄지 않는다 (063)
    const left = state.admin ? Infinity : sellLeft(state, now);
    const day = kstDay(now);
    const rows = PRICES.filter((v) => state.admin || v.res !== 'special' || p.resources.special > 0)
      .map((v) => {
        const pct = pricePct(day, v.idx);
        const have = p.resources[v.res];
        // 한도 안에서 팔 수 있는 가장 많은 개수
        let all = state.admin ? Math.min(have, 1000000) : have;
        while (all > 0 && sellCoins(state, v.res, all, now) > left) all = Math.floor(all * 0.9);
        const btn = (n: number, label: string) => {
          const coins = sellCoins(state, v.res, n, now);
          return `<button class="btn small" data-sell="${v.res}" data-n="${n}" ${n < 1 || (!state.admin && n > have) || coins < 1 || coins > left ? 'disabled' : ''}>${label}</button>`;
        };
        const unit = v.res === 'special' ? 1 : 100;
        return `<div class="m-row">${icon(v.res)}<div class="m-tx"><b>${RES_NAME[v.res]} <small>${num(have)}개</small></b>
          <span class="cost ${pct >= 110 ? 'up' : pct <= 90 ? 'down' : ''}">${unit}개 = ${icon('coin')}${num(sellCoins(state, v.res, unit, now))} <small>${pct >= 110 ? '▲ 비싸요' : pct <= 90 ? '▼ 싸요' : '보통'}</small></span></div>
          ${btn(unit, `${unit}개`)}${btn(all, '전부')}</div>`;
      })
      .join('');
    const pig = residentPct(state, 'pig');
    const limit = state.admin ? '관리자 무료 · 하루 한도 없음 · 판 자원은 줄지 않아요' : `오늘 더 벌 수 있는 엽전 <b>${num(left)}</b> / ${num(marketLimit(state))}`;
    return `<p>${limit} <small class="soft">(시세는 날마다 바뀌어요)</small>${pig ? ` <small class="bonus">${RESIDENT.pig.nick} 값 +${pig}%</small>` : ''}</p><div class="m-list">${rows}</div>`;
  }

  /** 방앗간 · 장독대: 재료를 넣고 만들기 */
  function craftBox(b: Building): string {
    const r = recipeOf(b.type)!;
    const p = state.profile;
    const unit = unitSec(state, b);
    const recipe = `<p>${icon(r.in1)}${r.n1}${r.in2 ? ` + ${icon(r.in2)}${r.n2}` : ''} → ${icon(r.out)}1 <small class="soft">(하나에 ${duration(unit)})</small></p>`;
    if (b.state === 'working') return `${recipe}<p class="live"><span data-live="job"></span></p>`;
    if (b.state !== 'done') return recipe;
    // 관리자는 재료를 내지 않는다 (063)
    const afford = state.admin ? Infinity : Math.min(Math.floor(p.resources[r.in1] / r.n1), r.in2 ? Math.floor(p.resources[r.in2] / r.n2) : Infinity);
    const max = Math.min(batchMax(b.type, b.level), afford);
    if (craftN < 1 || craftN > max) craftN = Math.max(1, max);
    return `${recipe}<div class="up-box"><div class="up-tx"><b>${RES_NAME[r.out]} 만들기${state.admin ? ' <small class="soft">관리자 무료</small>' : ''}</b>
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
      // 보너스가 어디서 왔나: 그 건물에서 일하는 주민 · 정자 · 잔치
      const helpers = workersAt(state, b).filter((id) => RATE_WORKERS.includes(id));
      const byWorkers = helpers.reduce((n, id) => n + residentPct(state, id), 0);
      const bonus = [...helpers.map((id) => `${RESIDENT[id].nick} +${residentPct(state, id)}%`), pct - byWorkers > 0 ? `정자 +${pct - byWorkers}%` : '', feasting(state, api.now()) ? `잔치 +${p.feastPct}%` : '']
        .filter(Boolean)
        .join(' · ');
      lines.push(`<p>${icon(d.product)} 한 시간에 <b>${num(effRate(state, b))}</b>개${bonus ? ` <small class="bonus">${bonus}</small>` : ''} · 최대 ${capSec(state) / 3600}시간 분량까지 쌓여요</p>`);
      if (b.state === 'done') lines.push(`<p class="live">지금 쌓인 양 <b data-live="stored"></b></p>`);
    }
    if (b.type === 'pavilion') lines.push(`<p>둘레 ${pavilionRange(state)}칸 안의 생산 건물이 <b>${CONST.pavilion_pct + CONST.pavilion_pct_per * (b.level - 1)}%</b> 더 만들어요${b.state === 'building' ? ' (다 지은 뒤부터)' : ''}</p>`);
    if (b.type === 'feast') lines.push(feastBox(b));
    if (b.type === 'shrine') lines.push('<p class="soft">마을의 상징이에요. 주민과 더 빨리 친해지고 번영도가 크게 올라요 (주민 · 랭킹이 열리면 힘을 내요)</p>');
    if (b.type === 'storage') lines.push(`<p>창고 용량 <b>+${num(STORAGE_CAP[b.level - 1])}</b></p>`);
    if (b.type === 'hall') lines.push(`<p>창고 용량 <b>${num(storageCap(state))}</b> · 동시에 짓기 <b>${slots(state)}</b>개 · 다른 건물은 레벨 <b>${b.level}</b>까지</p>`);
    if (b.type === 'house') {
      const next = nextResident(state);
      const houses = state.buildings.filter((v) => v.type === 'house' && standing(v)).length;
      lines.push(`<p>주민 <b>${state.residents.length}</b>명이 살고 있어요 (집 ${houses}채)</p>`);
      if (next) lines.push(`<p class="soft">다음 주민 ${next.nick}: ${p.level < next.level ? `마을 레벨 ${next.level}에 이사 와요` : houses <= state.residents.length ? '빈 집을 한 채 더 지으면 이사 와요' : '곧 이사 와요'}</p>`);
    }
    const workers = workersBox(state, b);
    if (workers) lines.push(`<div class="w-list">${workers}</div>`);
    if (b.type === 'market') lines.push(marketBox());
    if (recipeOf(b.type)) lines.push(craftBox(b));
    if (b.type !== 'pavilion' && b.type !== 'feast' && b.type !== 'shrine' && !upgradable(b.type)) lines.push(`<p class="soft">${d.desc}${d.points ? ` · 번영도 +${d.points}` : ''}</p>`);

    let up = '';
    if (b.state === 'done' && upgradable(b.type)) {
      if (b.level >= CONST.building_max_level) up = '<p class="up-note">최고 레벨이에요</p>';
      else {
        // 관리자는 레벨 조건 · 건설 슬롯 · 값이 없다
        const c = payOf(state, upgradeCost(b.type, b.level));
        const gate = upgradeGate(state, b);
        let block = '';
        if (gate === 'village level') block = `마을 레벨 ${HALL_NEED[b.level - 1]}이 되면 올릴 수 있어요`;
        else if (gate === 'hall level') block = '마을 회관 레벨을 먼저 올려 주세요';
        else if (!slotFree(state)) block = `짓는 중인 건물이 ${slots(state)}개예요`;
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
        up = `<div class="up-box"><div class="up-tx"><b>레벨 ${b.level + 1}로 올리기</b><span class="costs">${state.admin ? '<span class="cost pts">관리자 무료</span>' : costHtml(c, p.resources)}<span class="cost">${icon('time')}${duration(upgradeSec(state, b.type, b.level))}</span></span>
          <span class="soft">${block || `레벨 ${b.level + 1}${gain}`}</span></div>
          <button class="btn primary" data-upgrade="${b.id}" ${block ? 'disabled' : ''}>업그레이드</button></div>`;
      }
    }
    const canStore = b.type !== 'hall' && b.state === 'done';
    return `<div class="sheet-head">${art(b.type, b.state === 'building' ? 1 : lookOf(b.level))}<h3>${d.name}${upgradable(b.type) ? ` <small>레벨 ${b.level}</small>` : ''}</h3><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
      <div class="b-info">${lines.join('')}</div>${up}
      <div class="actions"><button class="btn" data-move="${b.id}">옮기기</button><button class="btn" data-store="${b.id}" ${canStore ? '' : 'disabled'}>보관</button></div>`;
  }

  /** 시간에 따라 바뀌는 글자만 고친다 (버튼을 누르는 도중에 판 전체를 다시 그리지 않게) */
  function tickSheet() {
    if (sheet?.kind === 'requests') {
      // 새 부탁까지 남은 시간. 다 됐으면 서버에 묻는다 (새 부탁은 서버가 만든다)
      let due = false;
      for (const q of state.requests) {
        const el = sheetEl.querySelector(`[data-live="wait-${q.slot}"]`);
        if (!el) continue;
        const left = q.readyAt - api.now();
        el.textContent = left > 0 ? `${duration(left / 1000)} 뒤에 와요` : '곧 와요';
        if (left <= 0) due = true;
      }
      if (due && Date.now() - askedAt > 3000) {
        askedAt = Date.now();
        void reload();
      }
      return;
    }
    if (sheet?.kind !== 'building') return;
    const b = state.buildings.find((v) => v.id === (sheet as { id: string }).id);
    if (!b) return;
    const now = api.now();
    const st = sheetEl.querySelector('[data-live="stored"]');
    if (st) {
      // 분모는 보통 최대(최대 시간 분량). 잔치·적어 둔 양으로 그보다 많이 쌓였을 때만 여유분까지 넣은 최대를 보인다
      const n = stored(state, b, now);
      const max = normalMax(state, b);
      st.textContent = `${num(n)} / ${num(n > max ? storedMax(state, b) : max)}${isFull(state, b, now) ? ' · 가득' : ''}`;
    }
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
    if (d.rtab) {
      sfx('click');
      sheetEl.scrollTop = 0;
      if (d.rtab === 'praise') openPraises();
      else if (ranking) openSheet({ kind: 'ranking' });
      else openRanking();
    } else if (d.tab) {
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
      void askLoss(id, '그래도 올리기').then((yes) => yes && sheetAct(bt, () => api.upgrade(id), (s) => {
        sfx('villBuild');
        apply(s);
      }));
    } else if (d.store) {
      const id = d.store;
      void askLoss(id, '그래도 보관하기').then((yes) => yes && sheetAct(bt, () => api.store(id), (s) => {
        sfx('chip');
        toast('보관함에 넣었어요 ([짓기] → 보관함에서 다시 놓을 수 있어요)', 2600);
        apply(s);
      }));
    } else if (d.step) {
      sfx('click');
      craftN = d.step === 'max' ? 9999 : craftN + Number(d.step);
      paintSheet();
    } else if (d.craft) {
      const id = d.craft;
      const n = craftN;
      sheetAct(bt, () => api.craft(id, n), (s) => {
        sfx('villBuild');
        apply(s);
      });
    } else if (d.sell) {
      const res = d.sell;
      const n = Number(d.n);
      sheetAct(bt, () => api.sell(res, n), (r) => {
        sfx('coin');
        toast(`${RES_NAME[res as ResId]} ${num(n)}개를 팔아 엽전 ${num(r.sold)}닢을 받았어요`);
        apply(r.state);
      });
    } else if (d.visit) {
      sfx('click');
      startVisit(d.visit);
    } else if (d.assign || d.rest) {
      const [rid, bid] = d.assign ? d.assign.split(':') : [d.rest!, null];
      sheetAct(bt, () => api.assign(rid, bid), (s) => {
        sfx('chip');
        const def = RESIDENT[rid as ResidentId];
        const at = bid ? s.buildings.find((v) => v.id === bid) : null;
        toast(at ? `${def.nick}${josa(def.nick, '이', '가')} ${BUILDING[at.type].name}에서 일해요 (${def.skill.replace('{n}', String(bonusOf(def.id, affLevel(residentOf(s, def.id)?.affinity ?? 0))))})` : `${def.nick}${josa(def.nick, '이', '가')} 쉬어요`, 2800);
        apply(s);
      });
    } else if (d.done) {
      const slot = Number(d.done);
      const q = state.requests.find((v) => v.slot === slot);
      sheetAct(bt, () => api.requestDone(slot), (r) => {
        sfx('villRequest');
        if (q?.resident) {
          toast(`${RESIDENT[q.resident].nick}: 고마워요! 엽전 ${num(q.coin)}닢 · 경험치 ${num(q.exp)}`, 2600);
          scene?.say(q.resident, '고마워요! ♥');
        }
        apply(r.state);
      });
    } else if (d.skip) {
      const slot = Number(d.skip);
      sheetAct(bt, () => api.requestSkip(slot), (s) => {
        sfx('click');
        apply(s);
      });
    } else if (d.daily) {
      const slot = Number(d.daily);
      sheetAct(bt, () => api.dailyClaim(slot), (s) => {
        sfx('win');
        toast(slot === 3 ? '오늘의 할 일을 모두 끝냈어요! 추가 보상을 받았어요' : '보상을 받았어요');
        apply(s);
      });
    } else if (d.expand !== undefined) {
      sheetAct(bt, () => api.expand(), (s) => {
        sfx('win');
        const size = LAND_SIZES[s.profile.landStage];
        toast(`땅이 ${size}×${size} 칸으로 넓어졌어요!`, 2600);
        openSheet(null);
        apply(s);
      });
    } else if (d.buycat !== undefined) {
      // 고양이 열기 (071 buy_character): 한 번 더 묻고 산다. 조건 · 시아코인은 서버가 다시 본다
      void ask('야옹이 데려오기', `시아코인 <b>${CAT_PRICE}개</b>로 <b>야옹이</b>(13번째 주민)를 마을에 데려와요.<br/>빈 주민 집이 있으면 바로 이사 오고, 주민 집을 한 채 더 지을 수 있어요`, `시아코인 ${CAT_PRICE}개 쓰기`).then(
        (yes) => yes && sheetAct(bt, () => api.buyCat(), (r) => {
          const res = r.result;
          if (res.ok || res.reason === 'owned') {
            sfx('win');
            toast(res.ok ? `야옹이를 데려왔어요! 남은 시아코인 ${num(res.siaCoins ?? 0)}개` : '이미 데려왔어요', 3000);
          } else {
            sfx('click');
            toast(
              res.reason === 'condition' ? `땅을 ${CAT_LAND_STAGE}단계까지 넓히면 열 수 있어요 · 지금 ${res.have ?? 0}단계`
              : res.reason === 'coin' ? `시아코인이 모자라요 (${num(res.siaCoins ?? 0)} / ${CAT_PRICE})`
              : res.reason === 'login' ? '로그인이 필요해요'
              : '열지 못했어요. 잠시 후 다시 시도해 주세요',
              2800,
            );
          }
          if (r.state) apply(r.state);
          else void api.load().then(apply).catch(() => undefined);
        }),
      );
    } else if (d.showcase !== undefined) {
      // 관리자만 (서버도 관리자가 아니면 'not admin' 으로 거절한다)
      void ask('전시 마을로 꾸미기', '마을을 <b>최종 모습</b>(모든 땅 · 모든 건물 최고 레벨 · 장식물 · 선물 · 기념물)으로 바꿔요.<br/>지금 마을의 건물 · 주민 · 부탁은 모두 사라지고 되돌릴 수 없어요', '꾸미기').then(
        (yes) => yes && sheetAct(bt, () => api.adminSetState(makeShowcase(api.now())), (s) => {
          sfx('win');
          toast('전시 마을로 꾸몄어요!', 2600);
          openSheet(null);
          apply(s);
        }),
      );
    } else if (d.feast !== undefined) {
      sheetAct(bt, () => api.feast(), (s) => {
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
        sfx(movingId ? 'chip' : 'villBuild');
        stopPlacing();
        apply(s);
        // 길은 이어서 놓는다 (더 놓을 수 있고 값이 있으면)
        if (!movingId && BUILDING[type].kind === 'road' && canHaveMore(s, type) && canPay(s.profile, payOf(s, buildCost(type)))) startPlacing(type, null);
      },
    ).finally(() => (ok.disabled = false));
  });

  // ───────────────────────── 메뉴 · 목표 ─────────────────────────

  $('#menu').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    // 구경 중 · 자리 고르는 중에는 메뉴가 숨어 있다
    if (!b || visiting || scene?.placing) return;
    sfx('click');
    if (b.dataset.m === 'build') openSheet({ kind: 'build', tab: 'main' });
    else if (b.dataset.m === 'residents') openSheet({ kind: 'residents' });
    else if (b.dataset.m === 'requests') openSheet({ kind: 'requests' });
    // 랭킹 버튼에 새 칭찬 배지가 떠 있으면 받은 칭찬 탭을 연다 (배지를 보고 눌렀는데 순위만 보이지 않게)
    else if (b.dataset.m === 'ranking') (!noteOff && praiseNotice(inbox) ? openPraises : openRanking)();
    else if (b.dataset.m === 'monuments') openMonuments();
    else toast('준비 중이에요');
  });

  /** [보상 받기]를 보내고 답을 기다리는 중 (연타 막기) */
  let goalBusy = false;
  $('#goal').addEventListener('click', () => {
    const g = goalStatus(state);
    if (!g || visiting || goalBusy) return;
    if (!g.done) {
      sfx('click');
      toast(`${goalText(g.def)} (${num(g.have)}/${num(g.def.n)})`);
      return;
    }
    goalBusy = true;
    $('#goal').classList.add('busy');
    void act(() => api.claimGoal(), (s) => {
      sfx('villRequest');
      toast('목표 달성! 보상을 받았어요');
      apply(s);
    }).finally(() => {
      goalBusy = false;
      $('#goal').classList.remove('busy');
    });
  });

  // ───────────────────────── 레벨업 ─────────────────────────

  function levelUp(from: number, to: number) {
    sfx('villLevel');
    const opened: string[] = [];
    for (const d of BUILDINGS) {
      if (isReward(d.id)) continue;
      const more = maxCount(d.id, to) - maxCount(d.id, from);
      if (more <= 0) continue;
      if (maxCount(d.id, from) === 0) opened.push(`<li><b>${d.kind === 'main' ? '새 건물' : d.kind === 'special' ? '특별 건물' : '새 장식'}</b> ${d.name}</li>`);
      else opened.push(`<li>${d.name} +${more}채</li>`);
    }
    const hallUp = HALL_NEED.findIndex((l) => l > from && l <= to);
    if (hallUp >= 0) opened.push(`<li>마을 회관 레벨 ${hallUp + 2}</li>`);
    for (const d of RESIDENTS) if (d.level > from && d.level <= to) opened.push(`<li><b>새 주민</b> ${d.nick} <small>(빈 주민 집이 있으면 이사 와요)</small></li>`);
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

  /** 지금 한국 시각 (서버 시각). 테스트 모드는 ?hour=21 로 정할 수 있다 */
  const hourParam = LOCAL_MODE ? new URLSearchParams(location.search).get('hour') : null;
  function hourNow(): number {
    return hourParam !== null && Number.isFinite(Number(hourParam)) ? Number(hourParam) : kstHour(api.now());
  }

  const hooks: SceneHooks = {
    state: () => viewState ?? state,
    now: () => api.now(),
    hour: hourNow,
    tapBuilding(id) {
      sfx('click');
      if (viewState) {
        // 구경 중: 보기만 한다
        const b = viewState.buildings.find((v) => v.id === id);
        if (b) toast(`${BUILDING[b.type].name}${upgradable(b.type) ? ` · 레벨 ${b.level}` : ''}`);
        return;
      }
      openSheet({ kind: 'building', id });
    },
    tapGround() {
      if (sheet) openSheet(null);
    },
    tapResident(id) {
      sfx('click');
      if (viewState) return scene?.say(id, RESIDENT[id].lines[Math.floor(Math.random() * RESIDENT[id].lines.length)]);
      // 부탁이 있으면 부탁을 보여 주고, 없으면 한마디
      if (state.requests.some((q) => q.state === 'open' && q.resident === id)) return openSheet({ kind: 'requests' });
      const d = RESIDENT[id];
      const at = workplace(state, id);
      const lines = at ? [...d.lines, `${BUILDING[at.type].name} 일, 잘되고 있어요!`] : d.lines;
      scene?.say(id, lines[Math.floor(Math.random() * lines.length)]);
    },
    harvest(id) {
      // 구경 중에는 거두지 않는다 (방울도 뜨지 않는다)
      if (visiting) return void scene?.harvested([id], {});
      const b = state.buildings.find((v) => v.id === id);
      const o = b ? lossOf(b, true) : null;
      if (o) planned.set(id, { res: o.res, n: o.have });
      batch.push(id);
      sfx('chip');
      if (gate !== 'none') return;
      if (o && o.lost > 0) {
        // 처음 넘치는 건물: 앞서 모은 것은 보내고, 이것부터는 손을 뗄 때 묻는다
        const before = batch.slice(0, -1);
        batch = before;
        flushHarvest();
        batch = [id];
        gate = 'ask';
        return;
      }
      // 손을 떼지 않고 오래 끌어도 0.6초마다 보낸다
      batchTimer ??= setTimeout(flushHarvest, 600);
    },
    harvestEnd() {
      if (gate === 'asking') return;
      if (gate === 'none') return flushHarvest();
      gate = 'asking';
      const ids = batch;
      const lost = batchLoss(ids);
      const names = [...new Set(ids.map((x) => planned.get(x)?.res).filter((r): r is ResId => !!r && CAPPED.includes(r)))].map((r) => RES_NAME[r]).join(' · ');
      void ask('창고가 가득해요', `${names} 창고가 가득해서 <b>${num(lost)}개</b>는 버려져요. 그래도 거둘까요?`, '그래도 거두기').then((yes) => {
        gate = 'none';
        if (yes) return flushHarvest();
        const back = batch;
        batch = [];
        for (const x of back) planned.delete(x);
        scene?.harvested(back, {});
      });
    },
    placeChanged(p) {
      $('#placeok').classList.toggle('off', !p.ok);
    },
    due: () => void (visiting ? null : reload()),
  };

  const size = () => ({ w: Math.max(120, fieldEl.clientWidth), h: Math.max(120, fieldEl.clientHeight) });
  const boot = () => {
    const { w, h } = size();
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: fieldEl,
      width: Math.round(w * DPR),
      height: Math.ceil(h * DPR), // 내림이면 아래에 1px 미만 틈이 남는다
      backgroundColor: '#5fa772',
      banner: false,
      audio: { noAudio: true },
      input: { keyboard: false, gamepad: false, activePointers: 3 },
      // 캔버스는 화면 크기 × 기기 픽셀 배율로 만들고 1/배율로 줄여 보여 준다 (휴대폰에서 선명하게)
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / DPR, autoRound: true },
      render: { antialias: true },
      scene: [],
    });
    const data: SceneData = { hooks, unit: (w * DPR) / VIEW_W, zodiacUrl: zodiacFull };
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
        game.scale.resize(Math.round(z.w * DPR), Math.ceil(z.h * DPR));
        scene?.setUnit((z.w * DPR) / VIEW_W);
      }, 150);
    });
    ro.observe(fieldEl);
  };
  const fonts = document.fonts?.load ? Promise.race([document.fonts.load('24px Jua'), new Promise((r) => setTimeout(r, 1200))]) : Promise.resolve();
  void fonts.then(boot, boot);

  // ───────────────────────── 주기적으로 ─────────────────────────

  if (LOCAL_MODE) window.__village = { state, api, scene: null, game: null };
  // 배경음: 낮 곡 / 밤 곡 (하늘 색과 같은 때에 바꾼다)
  const pickTrack = () => music.play(skyAt(hourNow()).phase === 'night' ? 'night' : 'day');
  pickTrack();
  setInterval(pickTrack, 30000);
  // 랭킹 창(로비 · 다른 게임)의 [구경]으로 들어왔으면 그 마을부터 보여 준다:  ?visit=<사용자 id>
  const wantVisit = new URLSearchParams(location.search).get('visit');
  if (wantVisit && wantVisit !== user.id) setTimeout(() => startVisit(wantVisit), 600);
  paintHud();
  // 받은 칭찬: 들어왔을 때 한 번, 그리고 화면으로 돌아왔을 때
  void loadInbox();
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
    void loadInbox();
  });
}
