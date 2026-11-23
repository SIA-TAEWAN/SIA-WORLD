import { BOARD_H, BOARD_W, ROAD_W, SLOT_SIZE, SQUAD_SIZE, type CharId } from '../data/balance';
import { BOSSES, BOSS_INDEX } from '../data/bosses';
import { EXTRAS, ROSTER, towerOf } from '../data/characters';
import { upgradeMods } from '../data/growth';
import { ENDLESS_BOSS_EVERY, ENDLESS_ID } from '../data/endless';
import { ENEMIES, ENEMY_INDEX } from '../data/enemies';
import { REGIONS, regionOf } from '../data/regions';
import { stageEnemies, stageOf, stagesOf, type StageDef } from '../data/stages';
import { buildRoute, cellX, cellY } from '../game/path';
import { charLevel, clearedCount, endlessOpen, startLivesOf, regionCleared, regionOpen, regionStars, stageOpen, totalStars } from '../game/progress';
import { LOCAL_MODE } from '../net/api';
import { openWorldRanking, worldHome } from '../net/world';
import { artUrl, zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { bindUnlock, esc, josa, loadEngine, lockHint, unlockLabel, nav, saveSquad, screen, soundButton, starsHtml, state, toast, watchProfile } from './app';
import { sfx } from './sfx';

const zodiacNick = (id: CharId) => ROSTER.find((r) => r.id === id)?.nick ?? '';

/** 지역이 잠긴 까닭 (열려 있으면 빈 글자) */
function regionLockText(no: number): string {
  if (regionOpen(state.profile, no)) return '';
  const def = REGIONS[no - 1];
  const prev = REGIONS[no - 2];
  const need: string[] = [];
  if (!regionCleared(state.profile, no - 1)) need.push(`${prev.name} 보스 클리어`);
  if (totalStars(state.profile) < def.stars) need.push(`별 ${def.stars}개 (지금 ${totalStars(state.profile)}개)`);
  return need.join(' + ');
}

// ───────────────────────── 메인 ─────────────────────────

export function showMain() {
  const pills = () => `<span class="coins-pill" title="가진 엽전">🪙 ${state.profile.coins.toLocaleString()}</span><span class="coins-pill star" title="모은 별">⭐ ${totalStars(state.profile)}</span>`;
  const root = screen(
    `<div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span><span id="pills" class="pills">${pills()}</span></div>
     <h1 class="logo">시아디펜스</h1>
     <p class="tagline">길목을 지켜 마을로 가는 요괴를 막아라!</p>
     <div class="hero">
       <img class="hero-art" src="${artUrl('main')}" alt="" />
       <div class="hero-road"></div>
       <img class="hero-char c1" src="${zodiacFullUrl('tiger')}" alt="" />
       <img class="hero-char c2" src="${zodiacFullUrl('rabbit')}" alt="" />
       <img class="hero-char c3" src="${zodiacFullUrl('rat')}" alt="" />
       ${['e-imp', 'e-wisp', 'e-imp', 'b-bigDokkaebi'].map((n, i) => `<img class="hero-foe f${i + 1}" src="${artUrl(n)}" alt="" />`).join('')}
       <span class="hero-gate">마을</span>
     </div>
     <div class="main-actions">
       <button class="btn primary big" id="go">출전 ▶</button>
       <div class="sub-actions">
         <button class="btn" id="chars">🐭 캐릭터</button>
         <button class="btn" id="codex">📖 도감</button>
         <button class="btn" id="ranking">🏆 랭킹</button>
       </div>
     </div>
     <p class="soft foot">${esc(state.user.name)} 님 · 스테이지 ${clearedCount(state.profile)}개 클리어</p>`,
    'main',
    () => off(),
  );
  // 꾸밈용 그림을 받지 못하면 깨진 그림 표시가 보이지 않게 숨긴다 (error 는 위로 올라오지 않아 capture 로 듣는다)
  // 메인 그림을 받으면 그 그림만 보여 주고, 못 받으면 아래의 코드 그림(길 위의 캐릭터와 요괴)을 그대로 쓴다
  const heroArt = root.querySelector('.hero-art') as HTMLImageElement;
  const artOn = () => heroArt.naturalWidth > 0 && root.querySelector('.hero')!.classList.add('has-art');
  heroArt.addEventListener('load', artOn);
  artOn();
  root.querySelector('.hero')!.addEventListener('error', (e) => e.target instanceof HTMLImageElement && (e.target.style.visibility = 'hidden'), true);
  const off = watchProfile(() => (root.querySelector('#pills')!.innerHTML = pills()));
  root.querySelector('#go')!.addEventListener('click', () => {
    sfx('click');
    nav.regions();
  });
  root.querySelector('#chars')!.addEventListener('click', () => {
    sfx('click');
    nav.chars();
  });
  root.querySelector('#codex')!.addEventListener('click', () => {
    sfx('click');
    nav.codex();
  });
  // 랭킹: SIA WORLD 공용 랭킹 창을 시아디펜스 탭(스테이지 / 끝없는 모드)으로 연다
  root.querySelector('#ranking')!.addEventListener('click', async () => {
    sfx('click');
    if (LOCAL_MODE) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
    if (!(await openWorldRanking(state.user.id))) toast('랭킹을 불러오지 못했어요');
  });
  root.append(soundButton());
  void loadEngine();
}

// ───────────────────────── 지역 지도: 십이지 12지역 + 끝없는 고개 입구 ─────────────────────────

/** 지역 지도. 화면에 있는 동안 진행 상황이 바뀌면(뒤에서 보류분이 올라감 등) 다시 그린다 */
export function showRegions() {
  drawRegions(null);
}

/** keepScroll: 다시 그릴 때 이전 스크롤 위치 (null = 처음 들어옴 → 마지막으로 본 지역이 보이게) */
function drawRegions(keepScroll: number | null) {
  const card = (r: (typeof REGIONS)[number]) => {
    const list = stagesOf(r.no);
    const ready = list.length > 0;
    const open = ready && regionOpen(state.profile, r.no);
    const lock = !ready ? '준비 중' : open ? '' : `🔒 ${regionLockText(r.no)}`;
    return `<button class="region bg-${r.bg} ${open ? '' : 'closed'} ${r.no % 2 ? 'left' : 'right'}" data-r="${r.no}">
      <span class="region-face"><img src="${zodiacFaceUrl(r.zodiac)}" alt="" /><i>${r.no}</i></span>
      <span class="region-tx"><b>${esc(r.name)}</b><small>${esc(r.feature)}</small><small>보스: ${esc(r.boss)}</small></span>
      <span class="region-side">${open ? `<em>⭐ ${regionStars(state.profile, r.no)}/${list.length * 3}</em>` : `<i>${esc(lock)}</i>`}</span>
    </button>`;
  };
  const endless = endlessOpen(state.profile);
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>지역 지도</h2><span class="spacer"></span></div>
     <div class="regions" id="regions">
       <img class="map-art" src="${artUrl('map')}" alt="" onerror="this.remove()" />
       ${REGIONS.map(card).join('')}
       <button class="region endless ${endless ? '' : 'closed'}" id="endless">
         <span class="region-face"><em>♾️</em></span>
         <span class="region-tx"><b>끝없는 고개</b><small>30초 웨이브가 끝없이 이어져요. 어디까지 버틸까요?</small></span>
         <span class="region-side">${endless ? `<em>🏔️ ${state.profile.endless ? `최고 웨이브 ${state.profile.endless.wave}` : '도전!'}</em>` : '<i>🔒 쥐의 들판 클리어</i>'}</span>
       </button>
     </div>`,
    'select',
    () => off(),
  );
  const off = watchProfile(() => drawRegions(root.scrollTop));
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
  root.querySelector('#regions')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.region') as HTMLElement | null;
    if (!b) return;
    if (b.id === 'endless') {
      if (!endless) {
        sfx('toggle');
        return toast('🔒 쥐의 들판을 클리어하면 열려요');
      }
      sfx('click');
      return nav.prepare(ENDLESS_ID);
    }
    const no = Number(b.dataset.r);
    const r = REGIONS[no - 1];
    if (!stagesOf(no).length) {
      sfx('toggle');
      return toast(`${josa(r.name, '은', '는')} 아직 준비 중이에요`);
    }
    if (!regionOpen(state.profile, no)) {
      sfx('toggle');
      return toast(`🔒 ${regionLockText(no)}`, 2800);
    }
    sfx('click');
    nav.stages(no);
  });
  // 처음 들어오면 마지막으로 본 지역이 보이게, 다시 그릴 때는 보던 자리 그대로
  if (keepScroll === null) root.querySelector(`.region[data-r="${state.region}"]`)?.scrollIntoView({ block: 'center' });
  else root.scrollTop = keepScroll;
  void loadEngine();
}

// ───────────────────────── 스테이지 고르기: 그 지역의 지도 위에 스테이지 5개 ─────────────────────────

/** 지도 위 스테이지 자리 (% — 아래에서 위로 올라가는 굽잇길) */
const NODE_POS: [number, number][] = [[20, 84], [70, 70], [28, 50], [72, 33], [40, 16]];

/** 스테이지 고르기. 화면에 있는 동안 진행 상황이 바뀌면 보던 자리 그대로 다시 그린다 */
export function showStages(regionNo: number, keepScroll = 0) {
  const region = regionOf(regionNo) ?? REGIONS[0];
  state.region = region.no;
  const list = stagesOf(region.no);
  const node = (st: StageDef, i: number) => {
    const [x, y] = NODE_POS[i] ?? [50, 50];
    const open = stageOpen(state.profile, st);
    const stars = state.profile.stages[st.id] ?? 0;
    const boss = st.boss ? BOSSES[BOSS_INDEX[st.boss.id]] : null;
    return `<button class="node ${open ? '' : 'closed'} ${boss ? 'boss' : ''} ${open && !stars ? 'now' : ''}" data-s="${st.id}" style="left:${x}%;top:${y}%">
      <span class="node-dot">${boss ? `<img src="${artUrl(`b-${boss.id}`)}" alt="" />` : open ? st.no : '🔒'}</span>
      <span class="node-name">${esc(st.id)} ${esc(st.name)}</span>
      ${open ? starsHtml(stars) : ''}
    </button>`;
  };
  const road = NODE_POS.slice(0, Math.max(2, list.length)).map(([x, y]) => `${x},${y}`).join(' ');
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>${esc(region.name)}</h2><span class="spacer"></span></div>
     <p class="tagline small">${esc(region.feature)} · ⭐ ${regionStars(state.profile, region.no)}/${list.length * 3}</p>
     <div class="rmap bg-${region.bg}" id="rmap">
       <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
         <polyline class="rmap-edge" points="${road}" /><polyline class="rmap-road" points="${road}" />
       </svg>
       <img class="rmap-guide" src="${zodiacFullUrl(region.zodiac)}" alt="" />
       <span class="rmap-gate">마을</span>
       ${list.map(node).join('')}
     </div>
     <p class="soft foot">스테이지를 누르면 출전 준비로 가요</p>`,
    'select',
    () => off(),
  );
  const off = watchProfile(() => showStages(region.no, root.scrollTop));
  root.scrollTop = keepScroll;
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.regions();
  });
  root.querySelector('#rmap')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.node') as HTMLElement | null;
    if (!b) return;
    const st = stageOf(b.dataset.s ?? '');
    if (!st) return;
    if (!stageOpen(state.profile, st)) {
      sfx('toggle');
      return toast(`🔒 ${st.region}-${st.no - 1} 스테이지를 클리어하면 열려요`);
    }
    sfx('click');
    nav.prepare(st.id);
  });
  void loadEngine();
}

// ───────────────────────── 출전 준비: 캐릭터 5종 고르기 + 이 스테이지의 요괴 미리 보기 ─────────────────────────

/** 스테이지의 길과 배치 칸을 작게 그린 그림 */
function stageThumb(st: StageDef): string {
  const routes = st.routes.map(buildRoute);
  const pts = (r: (typeof routes)[number]) => r.xs.map((x, i) => `${x},${r.ys[i]}`).join(' ');
  const half = SLOT_SIZE / 2;
  return `<svg class="thumb" viewBox="0 0 ${BOARD_W} ${BOARD_H}" aria-hidden="true">
    ${routes.filter((r) => !r.air).map((r) => `<polyline class="th-edge" points="${pts(r)}" stroke-width="${ROAD_W + 14}" />`).join('')}
    ${routes.filter((r) => !r.air).map((r) => `<polyline class="th-road" points="${pts(r)}" stroke-width="${ROAD_W}" />`).join('')}
    ${routes.filter((r) => r.air).map((r) => `<polyline class="th-air" points="${pts(r)}" />`).join('')}
    ${st.slots.map((c) => `<rect class="th-slot" x="${cellX(c[0]) - half}" y="${cellY(c[1]) - half}" width="${SLOT_SIZE}" height="${SLOT_SIZE}" rx="16" />`).join('')}
  </svg>`;
}

export function showPrepare(stageId: string) {
  const st = stageOf(stageId);
  if (!st) return nav.regions();
  const isEndless = st.id === ENDLESS_ID;
  const bg = regionOf(st.region)?.bg ?? 'field';
  // 쓸 수 있는 캐릭터: 해금했고 계산까지 만들어진 것
  const unlocked = (id: CharId) => !!towerOf(id) && state.profile.unlocked.includes(id);
  // 지난번에 고른 캐릭터부터 (지금 쓸 수 있는 것만)
  let picked = new Set<CharId>(state.squad.filter(unlocked));
  let focus: CharId = [...picked][0] ?? 'rat';
  // 끝없는 모드에는 모든 요괴가 차례로 나온다
  const foes = isEndless ? ENEMIES : stageEnemies(st).map((id) => ENEMIES[ENEMY_INDEX[id]]).filter(Boolean);
  const boss = st.boss ? BOSSES[BOSS_INDEX[st.boss.id]] : null;
  const weakFaces = (ids: CharId[]) => ids.map((z) => `<img class="${unlocked(z) ? '' : 'dimmed'}" src="${zodiacFaceUrl(z)}" alt="${esc(zodiacNick(z))}" title="${esc(zodiacNick(z))}" />`).join('');
  const best = state.profile.stages[st.id] ?? 0;
  /** 눌러 본 요괴 (설명과 잘 듣는 캐릭터를 아래 한 줄에 보여 준다). 보스는 'boss' */
  let foeFocus: string = boss ? 'boss' : (foes[0]?.id ?? '');
  /** 출전 캐릭터 칸 (잠긴 캐릭터는 자물쇠. 고양이는 눌러 보면 아래 설명 칸에 [시아코인 100개로 열기]) */
  const charsHtml = () =>
    ROSTER.map(
      (c) => `<button class="char" data-c="${c.id}"><img src="${zodiacFaceUrl(c.id)}" alt="" /><span>${c.nick}</span>${unlocked(c.id) ? `<b class="lvb">Lv ${charLevel(state.profile, c.id)}</b>` : '<b class="lock">🔒</b>'}</button>`,
    ).join('');
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>출전 준비</h2><span class="spacer"></span></div>
     <div class="scroll">
     <div class="card prep-stage bg-${bg}">
       ${stageThumb(st)}
       <div class="prep-tx">
         <h3>${isEndless ? '♾️' : esc(st.id)} ${esc(st.name)}</h3>
         <p>${isEndless ? `<span class="tag role">${state.profile.endless ? `최고 웨이브 ${state.profile.endless.wave}` : '첫 도전'}</span>` : starsHtml(best)}</p>
         <p class="chips"><span>❤️ ${startLivesOf(st, state.profile.upgrades)}</span><span>✨ ${Math.floor(st.energy * upgradeMods(state.profile.upgrades).energy + 1e-6)}</span><span>배치 칸 ${st.slots.length}</span></p>
         <p class="soft">${isEndless ? `30초 웨이브가 끝없이 · ${ENDLESS_BOSS_EVERY}웨이브마다 보스` : `30초 웨이브 6개 · 3분${boss ? ' · 2분에 보스' : ''}`}</p>
       </div>
     </div>
     <div class="card foe-card">
       <h3>나오는 요괴 <small>눌러서 살펴봐요</small></h3>
       <div class="foe-row" id="foes">
         ${foes.map((f) => `<button class="foe-chip" data-f="${f.id}"><img src="${artUrl(`e-${f.id}`)}" alt="" /><span>${esc(f.name)}</span></button>`).join('')}
         ${boss ? `<button class="foe-chip boss" data-f="boss"><img src="${artUrl(`b-${boss.id}`)}" alt="" /><span>${esc(boss.name)}</span></button>` : ''}
       </div>
       <p class="char-info foe-info" id="foeInfo"></p>
     </div>
     <div class="card">
       <h3>출전 캐릭터 <small id="count"></small></h3>
       <div class="chars" id="chars">${charsHtml()}</div>
       <p class="char-info" id="info"></p>
     </div>
     </div>
     <button class="btn primary big" id="start">출전 ▶</button>`,
    'select prepare',
    () => off(),
  );
  const startBtn = root.querySelector('#start') as HTMLButtonElement;
  const paintFoe = () => {
    root.querySelectorAll<HTMLElement>('.foe-chip').forEach((b) => b.classList.toggle('sel', b.dataset.f === foeFocus));
    const f = foes.find((x) => x.id === foeFocus);
    root.querySelector('#foeInfo')!.innerHTML =
      foeFocus === 'boss' && boss
        ? `<b>${esc(boss.name)}</b> <i class="tag">보스</i><br/><small>${esc(boss.desc)} · 2분에 등장 · 지나가면 생명 ${boss.leak}</small>`
        : f
          ? `<b>${esc(f.name)}</b> <span class="weak"><small>잘 듣는</small>${weakFaces(f.weak)}</span><br/><small>${esc(f.desc)}</small>`
          : '';
  };
  paintFoe();
  root.querySelector('#foes')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.foe-chip') as HTMLElement | null;
    if (!b) return;
    sfx('toggle');
    foeFocus = b.dataset.f ?? '';
    paintFoe();
  });
  const paint = () => {
    root.querySelectorAll<HTMLElement>('.char').forEach((b) => {
      const id = b.dataset.c as CharId;
      b.classList.toggle('sel', picked.has(id));
      b.classList.toggle('locked', !unlocked(id));
      b.classList.toggle('focus', id === focus);
    });
    root.querySelector('#count')!.textContent = `${picked.size}/${SQUAD_SIZE}`;
    const r = ROSTER.find((x) => x.id === focus)!;
    const def = towerOf(focus);
    root.querySelector('#info')!.innerHTML = def
      ? `<b>${esc(def.nick)}</b> <span class="tag role">${esc(def.role)}</span> <em>✨${def.cost}</em> <small>Lv ${charLevel(state.profile, focus)}</small><br/><small>${esc(def.desc)} · 3단계: ${esc(def.special)}</small>${unlocked(focus) ? '' : EXTRAS.includes(focus) ? `<br/><button class="btn small primary unlock" id="unlock">${esc(unlockLabel(focus))}</button>` : `<br/><small>🔒 ${esc(lockHint(r))}</small>`}`
      : `<b>${esc(r.nick)}</b> <span class="tag role">${esc(r.role)}</span><br/><small>🔒 ${esc(lockHint(r))}</small>`;
    startBtn.disabled = picked.size === 0;
    const unlock = root.querySelector('#unlock') as HTMLButtonElement | null;
    // 열렸으면 고양이를 골라 둔다 (자리가 있으면)
    if (unlock) {
      const id = focus;
      bindUnlock(unlock, id, () => {
        if (unlocked(id) && !picked.has(id) && picked.size < SQUAD_SIZE) picked = new Set(ROSTER.map((r) => r.id).filter((x) => picked.has(x) || x === id));
        paint();
      });
    }
  };
  paint();
  root.querySelector('#chars')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.char') as HTMLElement | null;
    if (!b) return;
    const id = b.dataset.c as CharId;
    focus = id;
    sfx('toggle');
    if (unlocked(id)) {
      if (picked.has(id)) picked.delete(id);
      else if (picked.size >= SQUAD_SIZE) toast(`한 판에 ${SQUAD_SIZE}종까지 데려갈 수 있어요`);
      else picked.add(id);
      // 고른 순서가 아니라 명단 순서로 (띠 순서, 고양이는 맨 뒤 — 카드와 숫자키 1~5 의 순서)
      picked = new Set(ROSTER.map((r) => r.id).filter((x) => picked.has(x)));
    }
    paint();
  });
  // 고양이를 열면(여기서 샀거나, 다른 기기에서 사고 화면이 다시 보일 때 main.ts 가 다시 물었을 때) 바로 반영한다
  const off = watchProfile(() => {
    picked = new Set([...picked].filter(unlocked));
    root.querySelector('#chars')!.innerHTML = charsHtml();
    paint();
  });
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    if (isEndless) nav.regions();
    else nav.stages(st.region);
  });
  startBtn.addEventListener('click', () => {
    if (!picked.size) return;
    sfx('click');
    saveSquad([...picked]);
    nav.game({ stage: st.id, squad: [...picked], endless: isEndless });
  });
  void loadEngine();
}
