/**
 * 시아카드배틀 화면 (HTML 메뉴 + Phaser 전투).
 * 처음 → 영웅 고르기 → 지도 ↔ 칸(전투·보상·상점·쉼터·보물·이야기) → 막 보스 → 결과.
 * 판 상태는 규칙 코드(apply)만 바꾼다. 칸에 들어갈 때마다(전투 밖의 입력마다) 기기에 자동 저장 — 전투 중에 끄면 그 전투 처음부터.
 */
import Phaser from 'phaser';
import {
  FINAL_ELITES,
  HEROES,
  MIN_DECK,
  RULES_VERSION,
  apply,
  canChoose,
  canUpgrade,
  cardDef,
  choices,
  enemyDef,
  enterTestBattle,
  eventDef,
  finalOpen,
  genMap,
  heroDef,
  newRun,
  potionDef,
  regionDef,
  relicDef,
  removePrice,
  restHeal,
  restUpgrades,
  upgradable,
  type DeckCard,
  type Input,
  type NodeType,
  type RunState,
} from '../game/rules';
import { DEV_ACT, DEV_ELITES, DEV_ENDING, DEV_FOES, DEV_GOLD, DEV_HERO, DEV_KIND, DEV_RELICS, DEV_RESET, DEV_SEED, LOCAL_MODE } from '../net/local';
import { loadSound, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { BattleScene, H, W, type BattleHooks } from '../scenes/BattleScene';
import { MAP_NODE_FRAME, artState, artUrl, hasArt } from '../art';
import { artImg, cardHtml, potionHtml, potionIcon, relicHtml, relicIcon } from './cards';
import { shrinkOverflow } from './fit';

interface Ctx {
  user: WorldUser | null;
  sound: SoundModule | null;
  run: RunState | null;
  game: Phaser.Game | null;
}
const ctx: Ctx = { user: null, sound: null, run: null, game: null };

const app = () => document.getElementById('app')!;
const gameEl = () => document.getElementById('game')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const sfx = (name: string) => {
  try {
    ctx.sound?.play(name);
  } catch {
    /* 소리는 없어도 된다 */
  }
};
const worldRoot = () => new URL('../../', document.baseURI);
const heroImg = (id: string) => new URL(`shared/images/zodiac/full/${id}.png`, worldRoot()).href;
const heroFace = (id: string) => new URL(`shared/images/zodiac/face/${id}.png`, worldRoot()).href;

export function toast(text: string, ms = 1800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.getElementById('stage')!.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- 저장 (localStorage 는 막혀 있을 수 있어 늘 try/catch) ----------

const SAVE_KEY = LOCAL_MODE ? 'siacard:local:run' : 'siacard:run';
function saveRun() {
  try {
    const r = ctx.run;
    if (!r || r.practice || r.phase === 'dead' || r.phase === 'won') localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(r));
  } catch {
    /* 저장 못 해도 판은 이어진다 */
  }
}
function loadRun(): RunState | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return null;
    const r = JSON.parse(s) as RunState;
    // 규칙이 바뀐 판(RULES_VERSION)은 이어 할 수 없다 — 같은 입력이 다른 결과가 된다
    return r && r.v === 1 && r.rules === RULES_VERSION && Array.isArray(r.log) ? r : null;
  } catch {
    return null;
  }
}
function clearRun() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* 무시 */
  }
}

/** 입력 하나 — 받아들여지면 저장 (전투 중 입력은 저장하지 않음: 전투에 들어간 순간이 저장점) */
function send(i: Input) {
  const run = ctx.run;
  if (!run) return null;
  const r = apply(run, i);
  if (r.ok && (i.t === 'go' || run.phase !== 'battle')) saveRun();
  return r;
}

// ---------- 시작 ----------

export function boot(user: WorldUser | null) {
  ctx.user = user;
  if (DEV_RESET) clearRun();
  void loadSound()
    .then((m) => (ctx.sound = m))
    .catch(() => null);
}

export function showFirst() {
  if (LOCAL_MODE && DEV_FOES.length) return startPractice(DEV_FOES, DEV_KIND);
  if (LOCAL_MODE && DEV_ENDING) {
    ctx.run = newRun({ seed: DEV_SEED ?? 1, hero: DEV_HERO ?? 'tiger' });
    Object.assign(ctx.run, { phase: 'won', ending: DEV_ENDING, act: DEV_ENDING === 'true' ? 4 : 3 });
    ctx.run.stats = { floors: 37, elites: DEV_ENDING === 'true' ? 4 : 1, bosses: DEV_ENDING === 'true' ? 4 : 3, battles: 20 };
    ctx.run.map = genMap(1, ctx.run.act);
    return showResult();
  }
  showTitle();
}

function stopGame() {
  if (ctx.game) {
    ctx.game.destroy(true);
    ctx.game = null;
  }
  gameEl().classList.add('hidden');
}

function screen(html: string, cls = '') {
  stopGame();
  app().innerHTML = `<div class="screen ${cls}">${html}</div>`;
  app().querySelector('.screen')!.scrollTop = 0;
  requestAnimationFrame(() => shrinkOverflow(app()));
  return app().querySelector<HTMLElement>('.screen')!;
}

function on(root: ParentNode, sel: string, fn: (el: HTMLElement) => void) {
  root.querySelectorAll<HTMLElement>(sel).forEach((el) =>
    el.addEventListener('click', () => {
      sfx('click');
      fn(el);
    }),
  );
}

function showTitle() {
  const saved = loadRun();
  const s = screen(`
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span><span class="nick">${esc(ctx.user?.nickname ?? '테스트 대원')}</span></div>
    <div class="title"><h1>시아카드배틀</h1><p>십이지 영웅으로 카드 덱을 키우며 요괴를 물리쳐요</p></div>
    <div class="title-art"><img src="${heroImg('tiger')}" alt="" onerror="this.remove()"></div>
    <div class="btns">
      ${saved ? `<button class="btn primary big" id="cont">이어하기 <small>${saved.act === 4 ? '숨은 4막' : `${saved.act}막 ${Math.max(0, saved.row + 1)}칸`} · ${esc(heroDef(saved.hero).name)}</small></button>` : ''}
      <button class="btn ${saved ? '' : 'primary big'}" id="new">새 판 ▶</button>
      <div class="row2">
        <button class="btn" disabled>오늘의 도전 <small>준비 중</small></button>
        <button class="btn" disabled>끝없는 모드 <small>준비 중</small></button>
      </div>
      <div class="row2">
        <button class="btn" disabled>도감 <small>준비 중</small></button>
        <button class="btn" disabled>랭킹 <small>준비 중</small></button>
      </div>
      ${LOCAL_MODE ? '<button class="btn small" id="practice">개발: 연습 전투</button>' : ''}
    </div>
  `);
  on(s, '#cont', () => {
    ctx.run = loadRun();
    if (ctx.run) showRun();
  });
  on(s, '#new', () => {
    if (saved && !confirm('진행 중인 판이 사라져요. 새로 시작할까요?')) return;
    showHeroes();
  });
  on(s, '#practice', () => showPracticeMenu());
}

function showPracticeMenu() {
  const sets: [string, string[], 'battle' | 'elite' | 'boss'][] = [
    ['대나무숲: 여우 한 마리', ['fox'], 'battle'],
    ['대나무숲: 스라소니 + 도토리', ['lynx', 'acorn'], 'battle'],
    ['들판: 불수레 + 꼬마 도깨비', ['firecart', 'imp'], 'battle'],
    ['궁궐: 수문병 + 원혼', ['guard', 'spirit'], 'battle'],
    ['저승: 해골 + 불폭탄', ['skeleton', 'bomber'], 'battle'],
    ['정예: 천년 여우', ['foxElite'], 'elite'],
    ...(['gumiho', 'jangsanbeom', 'centipede', 'bigDokkaebi', 'bulgasal', 'gangcheori', 'guardCaptain', 'dueoksini', 'imugi', 'reaper', 'yagwanggwi', 'yeomra', 'final'] as const).map(
      (id) => [`보스 ${enemyDef(id).name}`, [id], 'boss'] as [string, string[], 'boss'],
    ),
  ];
  const s = screen(`<div class="bar"><button class="back" id="back">← 처음</button><h2>연습 전투</h2><span class="back-space"></span></div>
    <div class="btns">${sets.map(([label], i) => `<button class="btn small" data-set="${i}">${label}</button>`).join('')}</div>`);
  on(s, '#back', () => showTitle());
  on(s, '[data-set]', (el) => {
    const [, foes, kind] = sets[Number(el.dataset.set)];
    startPractice(foes, kind);
  });
}

function startPractice(foes: string[], kind: 'battle' | 'elite' | 'boss') {
  for (const f of foes) enemyDef(f);
  const run = newRun({ seed: DEV_SEED ?? Date.now() >>> 0, hero: DEV_HERO ?? 'tiger' });
  run.relics.push(...DEV_RELICS);
  enterTestBattle(run, foes, kind);
  ctx.run = run;
  showRun();
}

// ---------- 영웅 고르기 ----------

/** 이 기기에서 고를 수 있는 영웅 (고양이는 해금 — 5단계, 지금은 테스트 모드에서만) */
const canPickHero = (id: string) => {
  const h = heroDef(id);
  return h.ready && (!h.locked || LOCAL_MODE);
};

function showHeroes() {
  let pick = HEROES.find((h) => canPickHero(h.id))!.id;
  const draw = () => {
    const h = heroDef(pick);
    const c1 = cardDef(h.cards[0]);
    const c2 = cardDef(h.cards[1]);
    const ok = canPickHero(h.id);
    const s = screen(`
      <div class="bar"><button class="back" id="back">← 처음</button><h2>영웅 고르기</h2><span class="back-space"></span></div>
      <div class="hero-grid">
        ${HEROES.map(
          (x) => `<button class="hero-cell${x.id === pick ? ' sel' : ''}${canPickHero(x.id) ? '' : ' off'}" data-h="${x.id}">
            <img src="${heroFace(x.id)}" alt="" onerror="this.style.visibility='hidden'">
            <span>${esc(x.name)}</span>${x.locked && !LOCAL_MODE ? '<i class="lock">🔒</i>' : !x.ready ? '<i class="soon">준비 중</i>' : ''}
          </button>`,
        ).join('')}
      </div>
      <div class="card hero-info">
        <div class="hero-top">${artImg(`cut-${h.id}`, `<img src="${heroImg(h.id)}" alt="">`, 'hero-cut')}
          <div><b>${esc(h.name)}</b> <span class="soft">${h.animal} · 체력 ${h.hp}</span><p class="passive"><em>패시브</em> ${esc(h.passive)}</p></div></div>
        <div class="hero-cards">
          <div class="hc"><small>전용 1 · 시작 덱</small>${cardHtml(c1.id)}</div>
          <div class="hc"><small>전용 2 · 보상에서만</small>${cardHtml(c2.id)}</div>
        </div>
        <p class="soft center">시작 덱: 베기 5 · 막기 4 · ${esc(c1.name)} 1${h.locked ? ' · 고양이는 한 판을 깬 뒤 시아코인 100으로 열어요' : ''}</p>
      </div>
      ${
        ok
          ? '<button class="btn primary big" id="go">이 영웅으로 출발 ▶</button>'
          : `<button class="btn big" disabled>${h.locked ? '🔒 시아코인 100으로 열기 (준비 중)' : '준비 중'}</button>`
      }
    `);
    on(s, '#back', () => showTitle());
    on(s, '[data-h]', (el) => {
      pick = el.dataset.h!;
      draw();
    });
    on(s, '#go', () => {
      clearRun();
      ctx.run = newRun({ seed: DEV_SEED ?? (Math.floor(Math.random() * 2 ** 32) >>> 0), hero: pick });
      if (LOCAL_MODE) {
        for (const r of DEV_RELICS) if (relicDef(r)) ctx.run.relics.push(r);
        if (DEV_GOLD !== null) ctx.run.gold = DEV_GOLD;
        if (DEV_ELITES !== null) ctx.run.stats.elites = DEV_ELITES;
        if (DEV_ACT !== null && DEV_ACT > 1) {
          // 그 막의 처음부터 (막 보스까지 가려면 &act=3&elites=3 → 3막 → 숨은 4막)
          ctx.run.act = DEV_ACT;
          ctx.run.map = genMap(ctx.run.seed, DEV_ACT);
        }
      }
      saveRun();
      showRun();
    });
  };
  draw();
}

// ---------- 판 화면 고르기 ----------

function showRun() {
  const run = ctx.run!;
  switch (run.phase) {
    case 'map':
      return showMap();
    case 'battle':
      return showBattle();
    case 'reward':
      return showReward();
    case 'shop':
      return showShop();
    case 'rest':
      return showRest();
    case 'treasure':
      return showTreasure();
    case 'event':
      return showEvent();
    default:
      return showResult();
  }
}

/** 위 줄: 체력·엽전·물약·부적·덱 */
function runBar(title: string) {
  const run = ctx.run!;
  return `<div class="bar"><button class="back" id="home">← 처음</button><h2>${title}</h2><button class="icon-btn" id="deck" title="덱">🂠</button></div>
    <div class="run-pills">
      <span class="pill hp">❤ ${run.hp}/${run.maxHp}</span>
      <span class="pill gold">엽전 <b>${run.gold}</b></span>
      <span class="pill">덱 ${run.deck.length}</span>
      ${[0, 1, 2].map((i) => `<button class="pot${run.potions[i] ? '' : ' empty'}" data-pot="${i}">${run.potions[i] ? potionIcon(run.potions[i], 'pot-ic') : ''}</button>`).join('')}
    </div>
    ${run.relics.length ? `<div class="relic-row">${run.relics.map((id) => `<button class="relic-btn" data-relic="${id}">${relicIcon(id)}</button>`).join('')}</div>` : ''}`;
}

function bindBar(s: HTMLElement, redraw: () => void) {
  const run = ctx.run!;
  on(s, '#home', () => showTitle());
  on(s, '#deck', () => showDeck('내 덱', run.deck));
  on(s, '[data-relic]', (el) => {
    const r = relicDef(el.dataset.relic!);
    toast(`${r.name}: ${r.text}`, 2400);
  });
  on(s, '[data-pot]', (el) => {
    const i = Number(el.dataset.pot);
    const id = run.potions[i];
    if (!id) return;
    const p = potionDef(id);
    modal(`<h3>${p.name}</h3><p>${p.text}</p><p class="soft">물약은 전투 중에 써요.</p>
      <div class="row2"><button class="btn" data-close>닫기</button><button class="btn" id="drop">버리기</button></div>`, (m, close) => {
      on(m, '#drop', () => {
        send({ t: 'dropPotion', slot: i });
        close();
        redraw();
      });
    });
  });
}

function modal(html: string, bind?: (m: HTMLElement, close: () => void) => void) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="card modal-box">${html}</div>`;
  document.getElementById('stage')!.appendChild(m);
  requestAnimationFrame(() => shrinkOverflow(m));
  const close = () => m.remove();
  m.addEventListener('click', (e) => {
    if (e.target === m) close();
  });
  m.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  bind?.(m, close);
  return close;
}

function showDeck(title: string, cards: DeckCard[]) {
  const sorted = [...cards].sort((a, b) => cardDef(a.id).kind.localeCompare(cardDef(b.id).kind) || a.id.localeCompare(b.id));
  modal(`<h3>${title} · ${cards.length}장</h3><div class="card-grid">${sorted.map((c) => cardHtml(c.id, c.up)).join('')}</div><button class="btn" data-close>닫기</button>`);
}

/** 덱에서 카드 고르기 (강화·없애기·복사) */
function pickCards(title: string, cards: DeckCard[], n: number, preview: 'up' | 'none', done: (uids: number[]) => void, cancel?: () => void) {
  const chosen: number[] = [];
  const close = modal(
    `<h3>${title}</h3><p class="soft center">${n > 1 ? `${n}장 고르세요` : '한 장 고르세요'}</p>
    <div class="card-grid">${cards.map((c) => `<div class="pick" data-uid="${c.uid}">${cardHtml(c.id, preview === 'up' ? true : c.up)}</div>`).join('')}</div>
    <div class="row2">${cancel ? '<button class="btn" id="cancel">그만두기</button>' : '<span></span>'}<button class="btn primary" id="ok" disabled>확인</button></div>`,
    (m, close) => {
      on(m, '[data-uid]', (el) => {
        const u = Number(el.dataset.uid);
        const k = chosen.indexOf(u);
        if (k >= 0) chosen.splice(k, 1);
        else {
          if (chosen.length >= n) chosen.shift();
          chosen.push(u);
        }
        m.querySelectorAll<HTMLElement>('[data-uid]').forEach((x) => x.classList.toggle('sel', chosen.includes(Number(x.dataset.uid))));
        (m.querySelector('#ok') as HTMLButtonElement).disabled = chosen.length !== n;
      });
      on(m, '#ok', () => {
        close();
        done([...chosen]);
      });
      on(m, '#cancel', () => {
        close();
        cancel?.();
      });
    },
  );
  return close;
}

// ---------- 지도 ----------

const NODE_ICON: Record<NodeType, string> = { battle: '⚔️', elite: '👹', shop: '🏮', rest: '🔥', treasure: '🎁', event: '❓', boss: '' };
/** 지도 칸 그림 (새 그림 map-nodes 시트의 그 칸 · 못 읽었으면 글자 그림) */
function nodeIcon(t: NodeType, cls = 'node-ic'): string {
  if (!artState.nodes || !(t in MAP_NODE_FRAME)) return NODE_ICON[t];
  return `<span class="${cls}" style="background-image:url('${artUrl('map-nodes')}');background-position:${MAP_NODE_FRAME[t] * 20}% 0"></span>`;
}
const NODE_NAME: Record<NodeType, string> = { battle: '전투', elite: '정예', shop: '상점', rest: '쉼터', treasure: '보물', event: '이야기', boss: '보스' };
const ROW_H = 76;

function showMap() {
  const run = ctx.run!;
  const m = run.map;
  if (regionDef(m.region).hidden) return showAbyss();
  if (run.row < 0 && run.act > 1) toast(`${run.act}막 · ${regionDef(m.region).name}`, 2200);
  const reg = regionDef(m.region);
  const can = new Set(choices(run));
  const total = m.rows.length;
  const height = total * ROW_H + 40;
  const yOf = (row: number) => height - 50 - row * ROW_H;
  const xOf = (x: number) => 12 + x * 76; // %
  const lines: string[] = [];
  m.rows.forEach((row, y) =>
    row.forEach((n) =>
      n.next.forEach((j) => {
        const to = m.rows[y + 1][j];
        const walked = run.path[y] === n.col && run.path[y + 1] === j;
        lines.push(`<line x1="${xOf(n.x)}" y1="${yOf(y)}" x2="${xOf(to.x)}" y2="${yOf(y + 1)}" class="${walked ? 'walked' : ''}"/>`);
      }),
    ),
  );
  const nodes = m.rows
    .map((row, y) =>
      row
        .map((n) => {
          const here = y === run.row && n.col === run.col;
          const passed = run.path[y] === n.col && y <= run.row;
          const next = y === run.row + 1 && can.has(n.col);
          const cls = ['node', `t-${n.type}`, here ? 'here' : '', passed ? 'passed' : '', next ? 'next' : '', y <= run.row && !passed ? 'gone' : ''].join(' ');
          if (n.type === 'boss')
            return `<button class="${cls} boss-node" style="left:${xOf(n.x)}%;top:${yOf(y)}px" data-col="${n.col}" data-row="${y}">${artImg(enemyDef(m.boss).art, '👺', 'boss-face')}<b>${esc(enemyDef(m.boss).name)}</b></button>`;
          return `<button class="${cls}" style="left:${xOf(n.x)}%;top:${yOf(y)}px" data-col="${n.col}" data-row="${y}" title="${NODE_NAME[n.type]}">${nodeIcon(n.type)}</button>`;
        })
        .join(''),
    )
    .join('');
  const s = screen(
    `${runBar(`${run.act}막 · ${esc(reg.name)}`)}
    <div class="map-wrap"><div class="map t-${reg.id}" style="height:${height}px${hasArt(reg.tile) ? `;--tile:url('${artUrl(reg.tile)}')` : ''}">
      <svg class="map-lines" viewBox="0 0 100 ${height}" preserveAspectRatio="none" style="height:${height}px">${lines.join('')}</svg>
      ${nodes}
    </div></div>
    <p class="map-legend">${(['battle', 'elite', 'shop', 'rest', 'treasure', 'event'] as NodeType[]).map((t) => `<span>${nodeIcon(t, 'node-ic small')} ${NODE_NAME[t]}</span>`).join('')}</p>`,
    'map-screen',
  );
  bindBar(s, showMap);
  on(s, '.node.next', (el) => {
    const r = send({ t: 'go', col: Number(el.dataset.col) });
    if (r?.ok) showRun();
  });
  on(s, '.node:not(.next)', (el) => {
    const row = Number(el.dataset.row);
    const n = m.rows[row][Number(el.dataset.col)];
    toast(n.type === 'boss' ? `막 보스: ${enemyDef(m.boss).name}` : NODE_NAME[n.type]);
  });
  // 지금 줄이 보이게
  const wrap = s.querySelector<HTMLElement>('.map-wrap')!;
  requestAnimationFrame(() => {
    wrap.scrollTop = Math.max(0, yOf(run.row + 1) - wrap.clientHeight * 0.6);
  });
}

/** 숨은 4막: 지도 대신 어둑시니 앞 (보스 한 칸) */
function showAbyss() {
  const run = ctx.run!;
  const s = screen(
    `${runBar('숨은 4막 · 어둠의 끝')}
    <div class="card scene-card">${artImg('ending-4', '', 'scene-art')}
      <p class="scene-say">정예 ${run.stats.elites}마리를 물리친 기운에 봉인이 흔들렸다! 땅이 갈라지고, 모든 어둠의 뿌리 <b>어둑시니</b>가 깨어났다.</p></div>
    <div class="card center abyss-boss">${artImg('b-final', '👺', 'boss-face big')}<p><b>어둑시니</b> · 체력 450</p>
      <p class="soft">내가 공격카드를 쓸 때마다 힘이 세지고, 체력이 줄면 점점 커져요. 보스와 한 번만 싸워요.</p></div>
    <div class="grow"></div>
    <button class="btn primary big" id="fight">맞서 싸우기 ▶</button>`,
    'abyss-screen',
  );
  bindBar(s, showAbyss);
  on(s, '#fight', () => {
    const r = send({ t: 'go', col: 0 });
    if (r?.ok) showRun();
  });
}

// ---------- 전투 ----------

function showBattle() {
  app().innerHTML = '';
  stopGame();
  gameEl().classList.remove('hidden');
  const hooks: BattleHooks = {
    run: () => ctx.run!,
    send: (i) => send(i),
    done: () => {
      if (ctx.run?.practice) return showResult();
      showRun();
    },
    heroUrl: ctx.run ? heroImg(ctx.run.hero) : null,
    sfx,
  };
  ctx.game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameEl(),
    width: W,
    height: H,
    backgroundColor: '#9fd6ff',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
    banner: false,
    input: { activePointers: 2 },
  });
  ctx.game.scene.add('battle', BattleScene, true, { hooks });
  if (LOCAL_MODE) {
    const w = window as unknown as { __cardGame?: Phaser.Game; __cardRun?: () => RunState | null; __cardFit?: () => string[] };
    w.__cardGame = ctx.game;
    // 카드 설명이 칸을 넘치는 카드 목록 (비어 있으면 통과)
    w.__cardFit = () => (ctx.game?.scene.getScene('battle') as BattleScene | null)?.fitReport() ?? ['전투 화면이 아님'];
    w.__cardRun = () => ctx.run;
  }
}

// ---------- 보상 ----------

function showReward() {
  const run = ctx.run!;
  const rw = run.reward!;
  const rows = rw.items
    .map((it, i) => {
      if (it.taken) return '';
      switch (it.k) {
        case 'gold':
          return `<button class="item btn-item" data-take="${i}"><span class="coin-dot has-art">${artImg('ic-coin', '엽')}</span><span class="item-main"><b>엽전 ${it.n}</b></span></button>`;
        case 'card':
          return `<button class="item btn-item" data-card="${i}"><span class="relic-dot card-dot has-art">${artImg('back', '🂠')}</span><span class="item-main"><b>${rw.boss ? '전설 카드' : '카드'} 고르기</b><small>${it.options.length}장 중 1장</small></span></button>`;
        case 'relic':
          return `<button class="btn-item" data-take="${i}">${relicHtml(it.id)}</button>`;
        case 'potion':
          return `<button class="btn-item" data-take="${i}">${potionHtml(it.id)}</button>`;
        case 'bossRelic':
          return `<button class="item btn-item" data-boss="${i}"><span class="relic-dot has-art">${artImg('ic-star', '✦')}</span><span class="item-main"><b>보스 부적 고르기</b><small>${it.options.length}개 중 1개</small></span></button>`;
      }
    })
    .join('');
  const s = screen(`${runBar(rw.boss ? '막 보스 승리!' : '승리!')}
    ${rw.boss ? `<div class="card center"><b>체력을 절반 회복했어요</b></div>` : ''}
    <div class="card"><h3>보상</h3><div class="btns">${rows || '<p class="soft center">다 받았어요</p>'}</div></div>
    <div class="grow"></div>
    <button class="btn primary big" id="leave">${rw.boss ? (run.act >= 3 ? (finalOpen(run) ? '봉인이 흔들린다… ▶' : '엔딩 보기 ▶') : `${run.act + 1}막으로 ▶`) : '지도로 ▶'}</button>`);
  bindBar(s, showReward);
  on(s, '[data-take]', (el) => {
    const r = send({ t: 'take', i: Number(el.dataset.take) });
    if (!r?.ok) toast('물약은 3개까지예요. 위에서 하나 버리고 받으세요');
    else sfx('coin');
    showReward();
  });
  on(s, '[data-card]', (el) => {
    const i = Number(el.dataset.card);
    const it = rw.items[i];
    if (it.k !== 'card') return;
    modal(
      `<h3>카드 한 장 고르기</h3><div class="card-grid choose">${it.options.map((c, k) => `<div class="pick" data-pick="${k}">${cardHtml(c.id, c.up)}</div>`).join('')}</div>
      <button class="btn" data-close>건너뛰기</button>`,
      (m, close) =>
        on(m, '[data-pick]', (p) => {
          send({ t: 'take', i, pick: Number(p.dataset.pick) });
          close();
          showReward();
        }),
    );
  });
  on(s, '[data-boss]', (el) => {
    const i = Number(el.dataset.boss);
    const it = rw.items[i];
    if (it.k !== 'bossRelic') return;
    modal(
      `<h3>보스 부적 한 개</h3><div class="btns">${it.options.map((id, k) => `<button class="btn-item" data-pick="${k}">${relicHtml(id)}</button>`).join('')}</div><button class="btn" data-close>나중에</button>`,
      (m, close) =>
        on(m, '[data-pick]', (p) => {
          send({ t: 'take', i, pick: Number(p.dataset.pick) });
          close();
          showReward();
        }),
    );
  });
  on(s, '#leave', () => {
    const left = rw.items.some((it) => !it.taken && it.k !== 'potion');
    if (left && !confirm('아직 받지 않은 보상이 있어요. 그냥 갈까요?')) return;
    send({ t: 'leave' });
    showRun();
  });
}

// ---------- 상점 ----------

function showShop() {
  const run = ctx.run!;
  const sh = run.shop!;
  const price = (p: number, sold?: boolean) => (sold ? '<em class="sold">팔림</em>' : `<b class="price${run.gold < p ? ' short' : ''}">${p}</b>`);
  const s = screen(`${runBar('상점')}
    <div class="card scene-card">${artImg('shop', '<span class="keeper-face">🏮</span>', 'scene-art')}<p class="scene-say">어서 오시오! 좋은 물건 많소.</p></div>
    <div class="card"><h3>카드</h3><div class="shop-cards">
      ${sh.cards.map((c, i) => `<button class="shop-card${c.sold ? ' sold' : ''}" data-buy="card" data-i="${i}" ${c.sold ? 'disabled' : ''}>${cardHtml(c.id, c.up)}${price(c.price, c.sold)}</button>`).join('')}
    </div></div>
    <div class="card"><h3>부적 · 물약</h3><div class="btns">
      ${sh.relics.map((r, i) => `<button class="btn-item shop-row" data-buy="relic" data-i="${i}" ${r.sold ? 'disabled' : ''}>${relicHtml(r.id)}${price(r.price, r.sold)}</button>`).join('')}
      ${sh.potions.map((p, i) => `<button class="btn-item shop-row" data-buy="potion" data-i="${i}" ${p.sold ? 'disabled' : ''}>${potionHtml(p.id)}${price(p.price, p.sold)}</button>`).join('')}
      <button class="item btn-item shop-row" id="remove" ${sh.removed || run.deck.length <= MIN_DECK ? 'disabled' : ''}><span class="relic-dot">✂</span><span class="item-main"><b>카드 없애기</b><small>덱에서 한 장 (덱 최소 ${MIN_DECK}장)</small></span>${price(removePrice(run), sh.removed)}</button>
    </div></div>
    <button class="btn primary big" id="leave">지도로 ▶</button>`);
  bindBar(s, showShop);
  on(s, '[data-buy]', (el) => {
    const kind = el.dataset.buy as 'card' | 'relic' | 'potion';
    const r = send({ t: 'buy', kind, i: Number(el.dataset.i) });
    if (r?.ok) sfx('coin');
    else toast(kind === 'potion' && run.potions.length >= 3 ? '물약은 3개까지예요' : '엽전이 모자라요');
    showShop();
  });
  on(s, '#remove', () => {
    if (run.gold < removePrice(run)) return toast('엽전이 모자라요');
    pickCards('없앨 카드', run.deck, 1, 'none', ([uid]) => {
      send({ t: 'remove', uid });
      showShop();
    }, () => null);
  });
  on(s, '#leave', () => {
    send({ t: 'leave' });
    showRun();
  });
}

// ---------- 쉼터 ----------

function showRest() {
  const run = ctx.run!;
  const rs = run.rest!;
  const healN = restHeal(run);
  const can = upgradable(run);
  const s = screen(`${runBar('쉼터')}
    <div class="card scene-card">${artImg('forge', '<span class="fire">🔥</span>', 'scene-art')}
      <p class="scene-say">모닥불 앞에서 잠시 쉬어 가요. 쉬거나, 대장간에서 카드를 강화해요.</p></div>
    ${
      rs.done
        ? '<div class="card center"><b>푹 쉬었어요!</b></div>'
        : `<div class="btns">
      <button class="btn big" id="heal" ${healN > 0 ? '' : 'disabled'}>쉬기 <small>체력 +${Math.min(healN, run.maxHp - run.hp)}${healN === 0 ? ' (여의주 조각: 회복 불가)' : ''}</small></button>
      <button class="btn big" id="up" ${can.length ? '' : 'disabled'}>카드 강화 <small>${restUpgrades(run)}장</small></button>
    </div>`
    }
    <div class="grow"></div>
    <button class="btn primary big" id="leave">지도로 ▶</button>`);
  bindBar(s, showRest);
  on(s, '#heal', () => {
    send({ t: 'heal' });
    sfx('win');
    showRest();
  });
  on(s, '#up', () => {
    const n = Math.min(restUpgrades(run), can.length);
    pickCards('강화할 카드 (강화 후 모습)', can, n, 'up', (uids) => {
      send({ t: 'upgrade', uids });
      showRest();
    }, () => null);
  });
  on(s, '#leave', () => {
    if (!rs.done && !confirm('쉬지 않고 떠날까요?')) return;
    send({ t: 'leave' });
    showRun();
  });
}

// ---------- 보물 ----------

function showTreasure() {
  const run = ctx.run!;
  const t = run.treasure!;
  const s = screen(`${runBar('보물')}
    <div class="card center treasure"><span class="chest${t.opened ? ' open' : ''}">${t.opened ? artImg('fx-pop', '✨', 'chest-art') : artImg('chest', '🎁', 'chest-art')}</span>
    ${t.opened ? (t.relic ? relicHtml(t.relic) : '<p>엽전 50이 들어 있었어요</p>') : '<p>낡은 상자가 있어요</p>'}</div>
    <div class="grow"></div>
    ${t.opened ? '<button class="btn primary big" id="leave">지도로 ▶</button>' : '<button class="btn primary big" id="open">상자 열기 ▶</button>'}`);
  bindBar(s, showTreasure);
  on(s, '#open', () => {
    send({ t: 'open' });
    sfx('coin');
    showTreasure();
  });
  on(s, '#leave', () => {
    send({ t: 'leave' });
    showRun();
  });
}

// ---------- 이야기 ----------

function showEvent() {
  const run = ctx.run!;
  const e = run.event!;
  const def = eventDef(e.id);
  const s = screen(`${runBar(esc(def.name))}
    <div class="card scene-card">${artImg(def.art, '', 'scene-art')}<img class="scene-hero" src="${heroImg(run.hero)}" alt="" onerror="this.remove()"><p class="scene-say">${esc(def.text)}</p></div>
    ${
      e.chosen < 0
        ? `<div class="btns">${def.choices
            .map((c, i) => `<button class="btn choice" data-ch="${i}" ${canChoose(run, c.ops, c.needGold) ? '' : 'disabled'}>${esc(c.label)}</button>`)
            .join('')}</div>`
        : `<div class="card center"><p>${esc(e.text ?? '그렇게 했다.')}</p>${e.gotRelic ? relicHtml(e.gotRelic) : ''}${e.gotCard ? cardHtml(e.gotCard) : ''}</div>
           <div class="grow"></div><button class="btn primary big" id="leave">지도로 ▶</button>`
    }`);
  bindBar(s, showEvent);
  on(s, '[data-ch]', (el) => {
    const r = send({ t: 'choose', i: Number(el.dataset.ch) });
    if (!r?.ok) return;
    if (ctx.run!.phase !== 'event') return showRun();
    needCards();
  });
  on(s, '#leave', () => {
    send({ t: 'leave' });
    showRun();
  });
  if (e.chosen >= 0 && e.need) needCards();
}

function needCards() {
  const run = ctx.run!;
  const need = run.event?.need;
  if (!need) return showEvent();
  const list = need.kind === 'upgrade' ? run.deck.filter((c) => canUpgrade(c.id, c.up)) : run.deck;
  const title = need.kind === 'upgrade' ? '강화할 카드' : need.kind === 'remove' ? '없앨 카드' : '복사할 카드';
  pickCards(title, list, 1, need.kind === 'upgrade' ? 'up' : 'none', ([uid]) => {
    send({ t: 'pickCard', uid });
    if (ctx.run!.event?.need) needCards();
    else showEvent();
  });
}

// ---------- 결과 ----------

/** 엔딩 장면 (그림 + 말) — 누르면 다음 장면, 마지막 장면 뒤에 결과 */
const ENDINGS: Record<'normal' | 'true', { art: string; title: string; text: string }[]> = {
  normal: [
    { art: 'ending-2', title: '3막 클리어!', text: '염라대왕까지 물리치고 십이지 친구들이 들판으로 돌아왔어요. 요괴들의 소란이 멎었어요.' },
    { art: 'ending-3', title: '그런데…', text: '봉인의 틈으로 아직 검은 연기가 새어 나와요. 더 많은 정예를 물리치면 숨은 무언가를 만날지도 몰라요.' },
  ],
  true: [
    { art: 'finale-1', title: '어둑시니를 물리쳤다!', text: '모든 어둠의 뿌리, 어둑시니가 빛 속으로 흩어졌어요.' },
    { art: 'finale-2', title: '다시 봉인!', text: '흔들리던 봉인에 마지막 열쇠가 채워지고, 문이 단단히 잠겼어요.' },
    { art: 'finale-4', title: '진짜 엔딩', text: '십이지 영웅들이 세상을 지켰어요. 오늘은 모두 함께 잔치예요!' },
  ],
};

function showResult(step = 0) {
  const run = ctx.run!;
  const win = run.phase === 'won';
  if (!run.practice) clearRun();
  const st = run.stats;
  const scenes = win && !run.practice && run.ending ? ENDINGS[run.ending] : [];
  if (step < scenes.length) {
    const sc = scenes[step];
    const last = step === scenes.length - 1;
    const s = screen(`<div class="grow"></div>
      <div class="card big-panel center ending ${run.ending === 'true' ? 'true-end' : ''}">
        ${artImg(sc.art, '', 'result-scene')}
        <h2 class="win">${sc.title}</h2>
        <p>${sc.text}</p>
        <p class="dots">${scenes.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</p>
        <button class="btn primary big" id="next">${last ? '결과 보기 ▶' : '다음 ▶'}</button>
      </div>
      <div class="grow"></div>`);
    if (step === 0) sfx('win');
    on(s, '#next', () => showResult(step + 1));
    return;
  }
  const title = run.practice ? (win ? '승리!' : '쓰러졌어요…') : win ? (run.ending === 'true' ? '진짜 엔딩!' : '3막 클리어!') : '쓰러졌어요…';
  const where = run.act === 4 ? '숨은 4막 어둑시니' : `${run.act}막 ${regionDef(run.map.region).name}`;
  const hint =
    win && run.ending === 'normal'
      ? `정예를 ${FINAL_ELITES}마리 이상 물리치고 3막을 깨면 숨은 4막이 열려요 (이번 판 정예 ${st.elites})`
      : win
        ? '숨은 최종보스까지 물리쳤어요!'
        : '처음부터 다시 도전해요';
  const s = screen(`<div class="grow"></div>
    <div class="card big-panel center">
      ${!win && !run.practice && run.act === 4 ? artImg('finale-1', '', 'result-scene') : ''}
      <img class="result-hero${win ? '' : ' down'}" src="${heroImg(run.hero)}" alt="" onerror="this.remove()">
      <h2 class="${win ? 'win' : 'lose'}">${title}</h2>
      ${run.practice ? `<p>남은 체력 ${run.hp} / ${run.maxHp}</p>` : `<p>${where} · ${st.floors}칸 · 정예 ${st.elites} · 보스 ${st.bosses}</p><p class="soft">${hint}</p>`}
      <button class="btn primary big" id="again">처음 화면 ▶</button>
    </div>
    <div class="grow"></div>`);
  on(s, '#again', () => {
    ctx.run = null;
    showTitle();
  });
}
