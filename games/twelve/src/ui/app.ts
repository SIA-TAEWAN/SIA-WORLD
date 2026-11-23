import Phaser from 'phaser';
import { heroFaceUrl } from '../assets';
import { EXIT_KILL_RATIO } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { expNeed, playerStats } from '../data/growth';
import { HEROES, STAT_KEYS, STAT_NAME, heroOf, isHero, type HeroId } from '../data/heroes';
import { MAPS, mapOf, mapsOf, nextMap, type MapDef } from '../data/maps';
import { MAPS_PER_REGION, MODE_NAME, REGIONS, REGION_TABLE, mapLevel, regionOf } from '../data/regions';
import { WEAPONS, WEAPON_KINDS, type WeaponKind } from '../data/weapons';
import {
  START_POTIONS,
  applyReport,
  continueMap,
  emptyProfile,
  heroesOf,
  joinText,
  loadoutOf,
  mapOpen,
  recommended,
  regionOpen,
  regionReady,
  regionStarCount,
  starsOfMap,
  whyText,
  type FinishResult,
  type RunReport,
  type TwelveProfile,
} from '../game/progress';
import { STAR_CHEST, STAR_NO_DEATH, STAR_TIME, createRun, type RunState } from '../game/sim';
import { ApiError, type TwelveApi } from '../net/api';
import { DEV_ALL, DEV_GOD, DEV_HERO, DEV_LEVEL, DEV_MAP, DEV_WEAPON, LOCAL_MODE } from '../net/local';
import { loadSound, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { GameScene, H, W } from '../scenes/GameScene';
import { GROUND } from '../scenes/art';
import { COLOR, css } from '../theme';
import { createControls, type Controls } from './controls';

/**
 * 메인 → 십이지 지도 → 지형(쉼터 + 맵 8개) → 맵(전투) → 결과 (PRD '화면 구성').
 * 기록은 net/api.ts 로만 바뀐다 (지금은 기기 저장, 5단계에서 서버).
 */

let api!: TwelveApi;
let profile: TwelveProfile = emptyProfile();
/** 개발 옵션(?map= · lv= · god= · all= · hero= · weapon=)으로 하는 판은 기록하지 않는다 */
const DEV_PLAY = DEV_ALL || DEV_GOD || DEV_LEVEL > 0 || !!DEV_HERO || !!DEV_WEAPON || !!DEV_MAP;

let sound: SoundModule | null = null;
void loadSound()
  .then((m) => (sound = m))
  .catch(() => null);
const play = (name: string, opts?: { volume?: number; rate?: number }) => sound?.play(name, opts);

// ---------- 설정 (기기마다) ----------

interface Settings {
  vibrate: boolean;
  lefty: boolean;
  numbers: boolean;
}
const SETTINGS_KEY = 'siatwelve:settings';
const RUN_KEY = 'siatwelve:inrun';
const settings: Settings = { vibrate: true, lefty: false, numbers: true };
function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    for (const k of ['vibrate', 'lefty', 'numbers'] as const) if (typeof v[k] === 'boolean') settings[k] = v[k];
  } catch {
    /* 기본값 */
  }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 이번만 */
  }
}
const mark = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 무시 */
  }
};

// ---------- 공통 ----------

const app = () => document.getElementById('app')!;

function screen(html: string, bg = ''): HTMLElement {
  closeGame();
  const root = app();
  root.innerHTML = `<div class="screen ${bg}">${html}</div>`;
  return root.firstElementChild as HTMLElement;
}

export function toast(text: string, ms = 2200) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.getElementById('stage')!.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function overlay(html: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = html;
  app().appendChild(box);
  return box;
}

const on = (root: ParentNode, sel: string, fn: (el: HTMLElement) => void) =>
  root.querySelectorAll<HTMLElement>(sel).forEach((el) =>
    el.addEventListener('click', () => {
      play('click');
      fn(el);
    }),
  );

const errText = (e: unknown) => whyText(e instanceof ApiError ? e.message : '');
const coinsPill = () => `<span class="coins-pill">🪙 ${profile.coins.toLocaleString()}</span>`;
const levelPill = () => `<span class="coins-pill lv-pill">Lv ${profile.level}</span>`;
const STAR_LABEL: [number, string][] = [[STAR_TIME, '시간 안에'], [STAR_NO_DEATH, '안 쓰러지고'], [STAR_CHEST, '숨은 상자']];
const starsHtml = (bits: number) => `<span class="stars">${STAR_LABEL.map(([b]) => `<i class="${bits & b ? 'on' : ''}">★</i>`).join('')}</span>`;
const face = (id: HeroId) => (heroOf(id).hidden ? `<span class="face emoji">${heroOf(id).unique.icon}</span>` : `<img class="face" src="${heroFaceUrl(id)}" alt="${heroOf(id).name}" />`);
const time = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** 개발 옵션을 입힌 프로필 (저장되지 않는다) */
function view(p: TwelveProfile): TwelveProfile {
  if (!DEV_PLAY) return p;
  const v: TwelveProfile = { ...p, maps: { normal: { ...p.maps.normal }, hard: { ...p.maps.hard } } };
  if (DEV_LEVEL) v.level = DEV_LEVEL;
  if (DEV_ALL) for (const m of MAPS) v.maps.normal[m.id] ??= { stars: 0, clears: 1, best: 0 };
  if (isHero(DEV_HERO)) v.hero = DEV_HERO;
  if ((WEAPON_KINDS as readonly string[]).includes(DEV_WEAPON)) v.weapon = DEV_WEAPON as WeaponKind;
  return v;
}

/** 처음 한 번: 기록을 불러온다 */
export async function boot(a: TwelveApi, _user: WorldUser | null) {
  api = a;
  loadSettings();
  profile = view(await api.loadProfile());
  if (!heroesOf(profile).includes(profile.hero) && !DEV_PLAY) profile.hero = heroesOf(profile)[0];
}

/** 처음 화면: 개발용 ?map= 이면 바로 그 맵, 아니면 메인 */
export function showFirst() {
  const m = mapOf(DEV_MAP);
  if (m) return void startMap(m, 0);
  showMain();
  // 맵 도중에 앱을 닫았다: 중간 저장이 없으므로 쓰러진 것과 같다 (PRD '죽으면')
  let left: string | null = null;
  try {
    left = localStorage.getItem(RUN_KEY);
  } catch {
    /* 무시 */
  }
  if (left && mapOf(left)) {
    mark(RUN_KEY, null);
    toast(`${left} ${mapOf(left)!.name}: 도중에 나가서 그 맵을 다시 시작해요`, 3200);
  }
}

// ---------- 메인 ----------

export function showMain() {
  const hero = heroOf(profile.hero);
  const next = continueMap(profile);
  const nm = next ? mapOf(next) : null;
  const need = expNeed(profile.level);
  const root = screen(`
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><div class="spacer"></div><div class="pills">${levelPill()}${coinsPill()}</div></div>
    <div class="title"><h1>시아열두길</h1><p>열두 지형의 요괴를 베고 열쇠를 모아라!</p></div>
    <div class="card me">
      ${face(hero.id)}
      <div class="me-info"><b>${hero.name} <small>${hero.animal} · ${WEAPONS[profile.weapon].icon} ${WEAPONS[profile.weapon].name}</small></b>
        <div class="lv"><i style="width:${need ? Math.min(100, (profile.exp / need) * 100) : 100}%"></i></div>
        <span class="soft">Lv ${profile.level}${need ? ` · 경험치 ${profile.exp.toLocaleString()} / ${need.toLocaleString()}` : ' (최고 레벨)'} · ${MODE_NAME[profile.mode]} 모드</span></div>
    </div>
    <div class="menu-btns">
      <button class="btn primary big" id="go">▶ 이어하기${nm ? ` <small>${nm.id} ${nm.name}</small>` : ''}</button>
      <button class="btn big" id="world">🗺️ 십이지 지도</button>
      <div class="row2"><button class="btn" id="heroes">🐾 대원</button><button class="btn soon" data-soon="가방은 장비가 생기면 열려요">🎒 가방</button></div>
      <div class="row2"><button class="btn soon" data-soon="끝없는 탑은 준비 중이에요">🗼 끝없는 탑</button><button class="btn soon" data-soon="랭킹은 준비 중이에요">🏆 랭킹</button></div>
      <button class="btn" id="settings">⚙️ 설정</button>
    </div>
    <div class="grow"></div>
    ${LOCAL_MODE ? `<p class="soft center light">테스트 모드: 기록은 이 기기에만 저장돼요${DEV_PLAY ? ' (개발 옵션으로 하는 판은 저장하지 않아요)' : ''}</p>` : ''}`);
  on(root, '#go', () => (nm ? showRegion(nm.region) : showWorld()));
  on(root, '#world', showWorld);
  on(root, '#heroes', () => showHeroes(showMain));
  on(root, '#settings', showSettings);
  on(root, '[data-soon]', (el) => toast(el.dataset.soon!));
}

function showSettings() {
  const row = (k: string, name: string, value: boolean) => `<label class="set-row"><span>${name}</span><button class="btn small toggle ${value ? 'on' : ''}" data-k="${k}">${value ? '켬' : '끔'}</button></label>`;
  const box = overlay(`<div class="card pop">
    <h3>설정</h3>
    ${row('sound', '소리', !(sound?.isMuted() ?? false))}
    ${row('vibrate', '진동', settings.vibrate)}
    ${row('lefty', '왼손잡이 (조이스틱과 버튼 좌우 바꾸기)', settings.lefty)}
    ${row('numbers', '피해 숫자', settings.numbers)}
    <button class="btn primary" id="ok">닫기</button></div>`);
  on(box, '.toggle', (el) => {
    const k = el.dataset.k!;
    let v: boolean;
    if (k === 'sound') {
      v = sound?.isMuted() ?? false;
      sound?.setMuted(!v);
    } else {
      v = settings[k as keyof Settings] = !settings[k as keyof Settings];
      saveSettings();
    }
    el.classList.toggle('on', v);
    el.textContent = v ? '켬' : '끔';
  });
  on(box, '#ok', () => box.remove());
}

// ---------- 대원 · 무기 ----------

function showHeroes(back: () => void, region = 0) {
  const mine = heroesOf(profile);
  const rec = region ? recommended(region) : [];
  let pick: HeroId = profile.hero;
  let weapon: WeaponKind = profile.weapon;
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>대원</h2><div class="pills">${levelPill()}</div></div>
    <div class="card"><div class="heroes">${HEROES.filter((h) => !h.hidden || mine.includes(h.id))
      .map((h) => {
        const ok = mine.includes(h.id);
        return `<button class="hero-btn ${ok ? '' : 'locked'}" data-id="${h.id}">${face(h.id)}<b>${h.name}</b>${ok ? (rec.includes(h.id) ? '<em class="tag">추천</em>' : '') : `<em>🔒 ${h.join}지형</em>`}</button>`;
      })
      .join('')}</div></div>
    <div class="card" id="detail"></div>
    <div class="card"><h3>무기 <small>장비가 생기기 전까지는 종류만 골라요</small></h3><div class="weapons">${WEAPON_KINDS.map((k) => `<button class="btn small weapon" data-w="${k}">${WEAPONS[k].icon} ${WEAPONS[k].name}</button>`).join('')}</div><div id="wdetail"></div></div>
    <button class="btn primary big" id="save">이 대원으로</button>`);
  const paint = () => {
    const h = heroOf(pick);
    const ok = mine.includes(pick);
    const st = playerStats({ ...loadoutOf(profile), hero: pick, weapon }, region);
    root.querySelectorAll<HTMLElement>('.hero-btn').forEach((b) => b.classList.toggle('on', b.dataset.id === pick));
    root.querySelectorAll<HTMLElement>('.weapon').forEach((b) => b.classList.toggle('on', b.dataset.w === weapon));
    root.querySelector('#detail')!.innerHTML = `
      <h3>${h.name} <small>${h.animal} · 고향 ${h.home ? `${h.home}지형 ${regionOf(h.home).name}` : '없음'} · 잘 다루는 무기 ${WEAPONS[h.weapon].icon}${WEAPONS[h.weapon].name}</small></h3>
      <div class="stat-grid">${STAT_KEYS.map((k) => `<div class="stat"><span>${STAT_NAME[k]}</span><div class="lv"><i style="width:${Math.round(((h.stats[k] - 0.9) / 0.2) * 100)}%"></i></div><b>${k === 'crit' ? `${Math.round(st.crit * 100)}%` : Math.round(st[k])}</b></div>`).join('')}</div>
      <p class="skill-line"><span class="key">U</span> <b>${h.unique.icon} ${h.unique.name}</b> ${h.unique.desc} <small>마력 ${h.unique.mp} · ${h.unique.cd}초</small></p>
      ${st.home ? '<p class="soft">🏠 고향 지형: 공격·방어 +10%</p>' : ''}${st.affinity ? '<p class="soft">✨ 잘 다루는 무기: 공격 +5%</p>' : ''}
      ${ok ? '' : `<p class="soft">🔒 ${h.join}지형 보스를 처음 잡으면 합류해요</p>`}`;
    const wd = WEAPONS[weapon];
    root.querySelector('#wdetail')!.innerHTML = `<p class="soft">${wd.desc}</p>${wd.skills.map((sk, i) => `<p class="skill-line"><span class="key">${'KL'[i]}</span> <b>${sk.icon} ${sk.name}</b> ${sk.desc} <small>마력 ${sk.mp} · ${sk.cd}초</small></p>`).join('')}`;
    (root.querySelector('#save') as HTMLButtonElement).disabled = !ok;
  };
  paint();
  on(root, '#back', back);
  on(root, '.hero-btn', (el) => {
    pick = el.dataset.id as HeroId;
    paint();
  });
  on(root, '.weapon', (el) => {
    weapon = el.dataset.w as WeaponKind;
    paint();
  });
  on(root, '#save', async () => {
    try {
      profile = view(await api.setLoadout(pick, weapon));
      back();
    } catch (e) {
      toast(errText(e));
    }
  });
}

// ---------- 십이지 지도 · 지형 ----------

function showWorld() {
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>십이지 지도</h2><div class="pills">${levelPill()}</div></div>
    <div class="region-grid">${REGION_TABLE.map((r) => {
      const ready = regionReady(r.region);
      const open = ready && regionOpen(profile, r.region);
      const sub = !ready ? '준비 중' : open ? `★ ${regionStarCount(profile, r.region)}/${MAPS_PER_REGION * 3}` : `🔒 ${r.region - 1}지형 보스`;
      return `<button class="region bg-${r.ground} ${open ? '' : 'locked'}" data-r="${r.region}">
          ${face(r.home)}<b>${r.region}</b><span>${r.name}</span><em>${sub}</em>
        </button>`;
    }).join('')}</div>
    <button class="btn soon final" data-soon="열쇠 12개를 모으면 열려요 (준비 중)">🗝️ 최종보스 <small>열쇠 0 / ${REGIONS}</small></button>
    <p class="soft center light">지형 보스를 잡으면 다음 지형이 열리고 대원이 합류해요</p>`);
  on(root, '#back', showMain);
  on(root, '[data-soon]', (el) => toast(el.dataset.soon!));
  on(root, '.region', (el) => {
    const r = Number(el.dataset.r);
    if (!regionReady(r)) return toast(`${regionOf(r).name}은(는) 준비 중이에요`);
    if (!regionOpen(profile, r)) return toast(`${r - 1}지형 보스를 잡아야 열려요`);
    showRegion(r);
  });
}

function showRegion(region: number) {
  const r = regionOf(region);
  const boss = BOSSES[r.boss];
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 지도</button><h2>${region}. ${r.name}</h2><div class="pills">${coinsPill()}</div></div>
    <div class="card rest">
      <h3>🏕️ 쉼터 <small>${r.envText}</small></h3>
      <div class="rest-row">
        <button class="btn small" id="heroes">${face(profile.hero)} 대원 바꾸기</button>
        <button class="btn small soon" data-soon="상점은 준비 중이에요">🛒 상점</button>
        <button class="btn small soon" data-soon="대장간은 준비 중이에요">⚒️ 대장간</button>
      </div>
      <p class="soft rec">추천 대원 ${recommended(region).map((h) => `${face(h)} ${heroOf(h).name}`).join(' ')}</p>
    </div>
    <div class="stage-list">${mapsOf(region)
      .map((m) => {
        const open = mapOpen(profile, m.id);
        const lv = mapLevel(m.region, m.no, profile.mode);
        const low = profile.level < lv;
        return `<button class="btn stage-row ${m.boss ? 'boss' : ''} ${open ? '' : 'locked'}" data-id="${m.id}">
          <b>${m.id}</b><span>${m.boss ? `👹 ${boss.name}` : m.name}<small class="${low && open ? 'warn' : ''}">권장 Lv ${lv}${low && open ? ' ⚠️' : ''} · ⏱ ${time(m.par)}</small></span>
          ${open ? starsHtml(starsOfMap(profile, m.id)) : '<span>🔒</span>'}
        </button>`;
      })
      .join('')}</div>
    <p class="soft center light">★ 시간 안에 · 안 쓰러지고 · 숨은 상자 — 따로따로 모아도 돼요<br/>${joinText(region)}</p>`,
    `bg-${r.ground}`,
  );
  on(root, '#back', showWorld);
  on(root, '#heroes', () => showHeroes(() => showRegion(region), region));
  on(root, '[data-soon]', (el) => toast(el.dataset.soon!));
  on(root, '.stage-row', (el) => {
    const m = mapOf(el.dataset.id!)!;
    if (!mapOpen(profile, m.id)) return toast('앞 맵을 깨야 열려요');
    void startMap(m, 0);
  });
}

// ---------- 맵 (전투) ----------

let game: Phaser.Game | null = null;
let controls: Controls | null = null;
let busy = false;

function closeGame() {
  controls?.destroy();
  controls = null;
  game?.destroy(true);
  game = null;
}

/** deaths = 이 맵에서 이번 도전 동안 쓰러진 횟수 ('다시 도전'으로 이어 올 때 늘어난다 → '안 쓰러지고' 별) */
async function startMap(map: MapDef, deaths: number) {
  if (busy) return;
  busy = true;
  let runId = '';
  try {
    if (!DEV_PLAY) runId = await api.start(map.id, profile.mode, profile.hero, profile.weapon);
    // 숫자 그림(피해 숫자)을 그리기 전에 글꼴이 있어야 한다
    await Promise.race([document.fonts.load("34px 'Jua'"), new Promise((ok) => setTimeout(ok, 1500))]).catch(() => null);
  } catch (e) {
    busy = false;
    toast(errText(e));
    if (!app().querySelector('.screen')) showMain();
    return;
  }
  busy = false;
  closeGame();
  const mode = profile.mode;
  const run = createRun(map, mode, loadoutOf(profile), { seed: (Math.random() * 0xffffffff) >>> 0, potions: START_POTIONS, god: DEV_GOD });
  if (!DEV_PLAY) mark(RUN_KEY, map.id);
  // 개발용: 콘솔에서 판 상태를 들여다보거나 고칠 수 있게 (테스트 모드에서만)
  if (LOCAL_MODE) (window as unknown as { __twelve?: RunState }).__twelve = run;
  const region = regionOf(map.region);
  const bossDef = map.boss ? BOSSES[region.boss] : null;
  const need = Math.ceil(run.total * EXIT_KILL_RATIO);
  const root = app();
  root.innerHTML = `
    <div id="game"></div>
    <div class="hud">
      <button class="icon-btn" id="pause">⏸</button>
      <div class="hud-bars">
        <div class="hud-name">${face(run.hero.id)}<b>Lv ${run.loadout.level}</b><span>${map.id} ${map.name}</span></div>
        <div class="gauge hp"><i id="hp"></i><em id="hpT"></em></div>
        <div class="gauge mp"><i id="mp"></i></div>
        <div class="gauge exp"><i id="exp"></i></div>
      </div>
      <div class="hud-side"><span class="hud-pill" id="time"></span><span class="hud-pill" id="kills"></span></div>
      <canvas id="mini" width="64" height="144"></canvas>
    </div>
    ${bossDef ? `<div class="boss-bar hidden" id="boss"><b>👹 ${bossDef.name}</b><div class="gauge"><i id="bossHp"></i></div></div>` : ''}
    <div class="note hidden" id="note"></div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const pause = () => {
    // 판이 끝난 뒤에는 멈추지 않는다 (그만하기가 클리어를 덮어쓰지 않게)
    if (scene.paused || sent || run.phase !== 'play') return;
    scene.paused = true;
    const box = overlay(`<div class="card pop"><h3>일시정지</h3>
      <button class="btn primary big" id="resume">계속하기</button>
      <button class="btn" id="quit">그만하기</button>
      <p class="soft center">그만하면 쓰러진 것과 같아요: 이 맵에서 얻은 엽전은 잃고 경험치는 남아요</p></div>`);
    on(box, '#resume', () => {
      scene.paused = false;
      box.remove();
    });
    on(box, '#quit', async () => {
      box.remove();
      if (sent || run.phase !== 'play') return void (scene.paused = false);
      run.phase = 'dead';
      await finish(run);
      showRegion(map.region);
    });
  };
  const ctl = createControls(root, run, { lefty: settings.lefty, onPause: pause });
  controls = ctl;
  on(root, '#pause', pause);

  let sent = false;
  const finish = async (s: RunState): Promise<FinishResult | null> => {
    if (sent) return null;
    sent = true;
    mark(RUN_KEY, null);
    const report: RunReport = {
      run: runId,
      map: map.id,
      mode,
      hero: s.hero.id,
      weapon: s.weapon.kind,
      time: Math.floor(s.t),
      cleared: s.phase === 'clear',
      kills: { ...s.kills },
      elites: s.eliteKills,
      boss: s.bossDead,
      chest: s.chest,
      deaths,
    };
    // 개발 판: 같은 규칙으로 계산만 하고 저장하지 않는다
    if (DEV_PLAY) return applyReport(structuredClone(profile), report);
    try {
      const r = await api.finish(report);
      if (!r) return null;
      profile = view(r.profile);
      return r.result;
    } catch (e) {
      toast(errText(e));
      return null;
    }
  };

  // HUD: 값이 바뀔 때만 DOM 을 건드린다
  const shown = new Map<string, string>();
  const set = (key: string, value: string, apply: (v: string) => void) => {
    if (shown.get(key) === value) return;
    shown.set(key, value);
    apply(value);
  };
  const hp = $('hp');
  const hpT = $('hpT');
  const mp = $('mp');
  const exp = $('exp');
  const timeEl = $('time');
  const kills = $('kills');
  const note = $('note');
  const bossBox = bossDef ? $('boss') : null;
  const bossHp = bossDef ? $('bossHp') : null;
  const mini = $<HTMLCanvasElement>('mini').getContext('2d')!;
  const look = GROUND[region.ground];
  const needExp = expNeed(profile.level);
  let noteT = 0;
  let frame = 0;
  const drawMini = (s: RunState) => {
    // 대원 둘레 36줄만 보여 준다 (한 칸 4px)
    const top = Math.max(0, Math.min(s.rows - 36, Math.floor(s.p.y / 60) - 22));
    mini.fillStyle = css(look.floor);
    mini.fillRect(0, 0, 64, 144);
    for (let y = 0; y < 36 && top + y < s.rows; y++) {
      for (let x = 0; x < 16; x++) {
        const t = s.grid[(top + y) * 16 + x];
        if (!t) continue;
        mini.fillStyle = css(t === 1 ? COLOR.outline : look.slow);
        mini.fillRect(x * 4, y * 4, 4, 4);
      }
    }
    const dot = (wx: number, wy: number, col: number, r: number) => {
      const y = (wy / 60 - top) * 4;
      if (y < -2 || y > 146) return;
      mini.fillStyle = css(col);
      mini.beginPath();
      mini.arc((wx / 60) * 4, y, r, 0, Math.PI * 2);
      mini.fill();
    };
    for (const e of s.enemies) if (!e.dead) dot(e.x, e.y, COLOR.pink, e.bossDef ? 4 : e.elite ? 3 : 2);
    dot(s.exitX, s.exitY, s.exitOpen ? COLOR.primary : COLOR.white, 4);
    dot(s.p.x, s.p.y, COLOR.teamA, 3.5);
  };

  const scene = new GameScene();
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: $('game'),
    width: W,
    height: H,
    backgroundColor: look.wall,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { keyboard: false, mouse: false, touch: false },
    scene: [],
    banner: false,
  });
  game.scene.add('game', scene, true, {
    run,
    hooks: {
      input: () => ctl.input,
      consume: () => ctl.consume(),
      sound: play,
      numbers: () => settings.numbers,
      hurt: () => {
        if (settings.vibrate) navigator.vibrate?.(30);
      },
      note: (text: string) => {
        note.textContent = text;
        note.classList.remove('hidden');
        noteT = performance.now() + 1800;
      },
      onFrame: (s: RunState) => {
        ctl.update(s);
        const p = s.p;
        set('hp', String(Math.round((p.hp / s.stats.hp) * 100)), (v) => (hp.style.width = `${v}%`));
        set('hpT', `${Math.ceil(p.hp)} / ${s.stats.hp}`, (v) => (hpT.textContent = v));
        set('mp', String(Math.round((p.mp / s.stats.mp) * 100)), (v) => (mp.style.width = `${v}%`));
        set('exp', String(needExp ? Math.min(100, Math.round(((profile.exp + s.exp) / needExp) * 100)) : 100), (v) => (exp.style.width = `${v}%`));
        const left = s.map.par - s.t;
        set('time', left >= 0 ? `⏱ ${time(left)}` : `⏱ +${time(-left)}`, (v) => {
          timeEl.textContent = v;
          timeEl.classList.toggle('late', left < 0);
        });
        set('kills', s.map.boss ? (s.bossDead ? '🚪 출구로!' : '👹 보스') : s.exitOpen ? '🚪 출구로!' : `👹 ${s.killed}/${need}`, (v) => (kills.textContent = v));
        if (bossBox && bossHp && s.boss) {
          set('bossOn', String(s.boss.awake && !s.boss.dead), (v) => bossBox.classList.toggle('hidden', v !== 'true'));
          set('bossHp', String(Math.round((s.boss.hp / s.boss.maxHp) * 100)), (v) => (bossHp.style.width = `${v}%`));
        }
        if (noteT && performance.now() > noteT) {
          noteT = 0;
          note.classList.add('hidden');
        }
        if (frame++ % 12 === 0) drawMini(s);
      },
      onEnd: async (s: RunState) => {
        const result = await finish(s);
        showResult(s, result, deaths);
      },
    },
  });
}

function showResult(s: RunState, r: FinishResult | null, deaths: number) {
  const map = s.map;
  const win = s.phase === 'clear';
  play(win ? 'win' : 'lose');
  const next = win ? nextMap(map.id) : null;
  const nextOk = !!next && mapOpen(profile, next.id);
  const stars = r?.stars ?? 0;
  const box = overlay(`<div class="card pop result ${win ? 'win' : 'lose'}">
      <h2>${win ? '클리어!' : '쓰러졌어요'}</h2>
      ${
        win
          ? `<div class="big-stars">${starsHtml(stars)}</div>
             <div class="star-rows">${STAR_LABEL.map(([b, name]) => `<span class="${stars & b ? 'on' : ''}">${stars & b ? '★' : '☆'} ${name}${b === STAR_TIME ? ` (${time(s.t)} / ${time(map.par)})` : ''}</span>`).join('')}</div>`
          : `<p class="soft center">이 맵을 처음부터 다시 해요. 이 맵에서 얻은 엽전은 잃고, 경험치는 남아요</p>`
      }
      <div class="rows">
        <div><span>쓰러뜨린 요괴</span><b>${s.killed} / ${s.total}${s.bossDead ? ' + 보스' : ''}</b></div>
        ${r ? `<div><span>경험치</span><b>+${r.exp.toLocaleString()}${r.ups ? ` · 레벨 업! Lv ${r.level}` : ''}</b></div>` : ''}
        ${r && win ? `<div><span>엽전</span><b class="coin">+${r.coins.toLocaleString()}</b></div>` : ''}
        ${r?.siaCoin ? `<div><span>시아코인</span><b class="coin">+1</b></div>` : ''}
      </div>
      ${r?.joined ? `<div class="new-hero">${face(r.joined)} ${heroOf(r.joined).name}(${heroOf(r.joined).animal})가 합류했어요!</div>` : ''}
      ${DEV_PLAY ? '<p class="soft center">개발 옵션으로 한 판이라 저장하지 않았어요</p>' : r ? '' : '<p class="soft center">기록을 저장하지 못했어요</p>'}
      <div class="btns">
        ${nextOk ? `<button class="btn primary big" id="next">다음 맵 ▶</button>` : ''}
        <button class="btn ${nextOk ? '' : 'primary big'}" id="again">${win ? '다시 하기' : '다시 도전'}</button>
        <button class="btn" id="rest">쉼터로</button>
      </div></div>`);
  if (r?.ups) play('survLevel');
  on(box, '#next', () => void startMap(next!, 0));
  on(box, '#again', () => void startMap(map, win ? 0 : deaths + 1));
  on(box, '#rest', () => showRegion(map.region));
}
