import Phaser from 'phaser';
import { artUrl, zodiacFaceUrl } from '../assets';
import { REGIONS, REGION_NAMES, groundOf } from '../data/regions';
import {
  emptyProfile,
  heroesOf,
  loadProfile,
  partyOf,
  regionOpen,
  regionStars,
  regionStarsOf,
  saveProfile,
  stageOpen,
  totalStars,
  type FingerProfile,
} from '../game/progress';
import { DEV_ALL, LOCAL_MODE } from '../net/local';
import { loadSound, openWorldRanking, worldHome, type SoundModule, type WorldUser } from '../net/world';
import { GameScene, H, W } from '../scenes/GameScene';
import {
  BOSSES,
  BOSS_IDS,
  ENEMIES,
  HEROES,
  HERO_IDS,
  STAGES,
  buildConfig,
  chiefDef,
  createRun,
  resultOf,
  stageOf,
  stagesOf,
  type HeroId,
  type RunResult,
  type RunState,
  type StageDef,
} from '../sim';

/**
 * 판 밖 화면 (돌격대 app.ts 방식, HTML): 메인 → 십이지 지도 → 스테이지 목록 → 파티 고르기 → 판 → 결과.
 * 1~3단계는 기록을 이 기기에만 저장한다 (서버 저장 · 엽전 지갑 · 레벨 · 강화는 4단계).
 */

let me: WorldUser | null = null;
let profile: FingerProfile = emptyProfile();
const userKey = () => me?.userId ?? 'local';

let sound: SoundModule | null = null;
void loadSound()
  .then((m) => (sound = m))
  .catch(() => null);
const play = (name: string, opts?: { volume?: number; rate?: number }) => sound?.play(name, opts);

const app = () => document.getElementById('app')!;

function screen(html: string, bg = ''): HTMLElement {
  const root = app();
  root.innerHTML = `<div class="screen ${bg}">${html}</div>`;
  const el = root.firstElementChild as HTMLElement;
  soundButton(el);
  return el;
}

export function toast(text: string, ms = 2200) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.getElementById('stage')!.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

const starsHtml = (n: number) => `<span class="stars">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('')}</span>`;
const starPill = () => `<span class="coins-pill star-pill">★ ${totalStars(profile)}</span>`;
const typeName = (id: HeroId) => (HEROES[id].type === 'pierce' ? '관통형' : '반사형');
const typeTag = (id: HeroId) => `<em class="tag ${HEROES[id].type}">${typeName(id)}</em>`;

function soundButton(root: HTMLElement) {
  const b = document.createElement('button');
  b.className = 'icon-btn sound-btn';
  const paint = () => (b.textContent = sound?.isMuted() ? '🔇' : '🔊');
  paint();
  b.addEventListener('click', () => {
    sound?.setMuted(!sound.isMuted());
    paint();
    play('click');
  });
  root.appendChild(b);
}

/** 처음 한 번: 기록을 불러온다 */
export function boot(user: WorldUser | null) {
  me = user;
  profile = loadProfile(userKey());
  if (DEV_ALL) {
    // 개발용 ?local=1&all=1: 모든 스테이지·대원을 연 상태로 본다 (저장하지 않음)
    profile = { ...profile, stages: Object.fromEntries(STAGES.map((s) => [s.id, 3])) };
    for (let r = 1; r <= REGIONS; r++) profile.stages[`${r}-5`] = 3;
  }
}

function save() {
  if (!DEV_ALL) saveProfile(userKey(), profile);
}

// ---------- 메인 ----------

export function showMain() {
  const root = screen(`
    <div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><div class="spacer"></div><div class="pills">${starPill()}</div></div>
    <div class="title"><h1>시아핑거</h1><p>당겼다 놓아 튕겨서 요괴를 부숴라!</p></div>
    <div class="card">
      <h3>파티 <small>쏘는 순서</small></h3>
      <div class="party-mini">${partyOf(profile)
        .map((id, i) => `<span><img src="${zodiacFaceUrl(id)}" alt="" /><b>${i + 1}</b>${HEROES[id].name}</span>`)
        .join('')}</div>
    </div>
    <div class="menu-btns">
      <button class="btn primary big" id="go">⚔️ 모험 떠나기</button>
      <div class="row2">
        <button class="btn" id="heroes">🐭 대원</button>
        <button class="btn soon" id="up">💪 강화 🔒</button>
      </div>
      <div class="row2">
        <button class="btn soon" id="tower">🏯 끝없는 탑 🔒</button>
        <button class="btn" id="rank">🏆 랭킹</button>
      </div>
      <button class="btn" id="help">❓ 하는 법</button>
    </div>
    <div class="grow"></div>
    ${LOCAL_MODE ? '<p class="soft center light">테스트 모드: 기록은 이 기기에만 저장돼요</p>' : '<p class="soft center light">지금은 기록이 이 기기에만 저장돼요 (서버 저장은 준비 중)</p>'}`);
  const on = (sel: string, fn: () => void) =>
    root.querySelector(sel)!.addEventListener('click', () => {
      play('click');
      fn();
    });
  on('#go', showRegions);
  on('#heroes', showHeroes);
  on('#up', () => toast('강화는 준비 중이에요'));
  on('#tower', () => toast('끝없는 탑은 준비 중이에요'));
  on('#help', showHelp);
  root.querySelector('#rank')!.addEventListener('click', async () => {
    play('click');
    if (LOCAL_MODE || !me) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
    if (!(await openWorldRanking(me.userId))) toast('랭킹을 불러오지 못했어요');
  });
}

function showHelp() {
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop help">
    <h3>하는 법</h3>
    <ul>
      <li>화면 <b>아무 곳이나 누른 채 당기면</b> 반대쪽으로 점선이 보여요. 놓으면 대원이 날아가요. 많이 당길수록 세게 날아가요.</li>
      <li>당기다가 <b>처음 누른 자리로 돌아와 놓으면</b> 취소돼요.</li>
      <li><b class="blue">반사형</b>은 요괴에서 튕겨 나오고, <b>관통형</b>은 요괴를 뚫고 지나가요.</li>
      <li>날아가다 <b>가만히 있는 아군을 스치면</b> 그 아군이 우정 콤보를 쏴요.</li>
      <li>요괴 머리 위 숫자가 0이 되면 공격해요. <b class="red">빨간 원</b>은 다음에 공격이 떨어질 곳이에요.</li>
      <li>필살기 게이지가 차면 그 대원 차례에 <b>필살기 버튼</b>(PC는 스페이스)을 누르고 쏘세요.</li>
      <li>보스는 <b>노란 점(등 뒤)</b>을 맞히면 피해가 3배예요. 날아가는 동안 화면을 누르고 있으면 2배속.</li>
    </ul>
    <button class="btn primary" id="ok">알겠어요</button></div>`;
  app().appendChild(box);
  box.querySelector('#ok')!.addEventListener('click', () => {
    play('click');
    box.remove();
  });
}

// ---------- 대원 ----------

function heroCard(id: HeroId, open: boolean) {
  const d = HEROES[id];
  return `<div class="card hero-row ${open ? '' : 'locked'}">
      <img src="${zodiacFaceUrl(id)}" alt="" class="ball ${d.type}" />
      <div class="hero-info"><b>${d.name} ${typeTag(id)} <span class="soft">Lv 1</span></b>
        <span>우정 콤보: ${d.comboName}</span>
        <span>필살기: ${d.specialName} <span class="soft">(${d.charge}턴)</span></span>
        ${open ? '' : `<span class="soft">🔒 ${d.unlockRegion}지역 보스를 깨면 합류</span>`}</div>
    </div>`;
}

function showHeroes() {
  const open = heroesOf(profile);
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>대원</h2><div class="spacer"></div></div>
    <div class="up-list">${HERO_IDS.map((id) => heroCard(id, open.includes(id))).join('')}</div>
    <p class="soft center light">레벨 올리기는 준비 중이에요</p>`);
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showMain();
  });
}

// ---------- 지역 지도 · 스테이지 ----------

function showRegions() {
  const ts = totalStars(profile);
  const root = screen(`
    <div class="bar"><button class="back" id="back">← 뒤로</button><h2>십이지 지도</h2><div class="pills">${starPill()}</div></div>
    <div class="region-grid">${Array.from({ length: REGIONS }, (_, i) => {
      const r = i + 1;
      const ready = stagesOf(r).length > 0;
      const open = ready && regionOpen(profile, r);
      const need = regionStars(r);
      const sub = !ready ? '준비 중' : open ? `★ ${regionStarsOf(profile, r)}/15` : ts < need ? `🔒 ★${need}` : `🔒 ${r - 1}-5`;
      return `<button class="region bg-${groundOf(r)} ${open ? '' : 'locked'}" data-r="${r}">
          <img src="${zodiacFaceUrl(HERO_IDS[r - 1])}" alt="" />
          <b>${r}</b><span>${REGION_NAMES[r - 1]}</span><em>${sub}</em>
        </button>`;
    }).join('')}</div>
    <p class="soft center light">앞 지역 보스를 깨고, 별을 모으면 다음 지역이 열려요</p>`);
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showMain();
  });
  root.querySelectorAll<HTMLButtonElement>('.region').forEach((b) =>
    b.addEventListener('click', () => {
      play('click');
      const r = Number(b.dataset.r);
      if (!stagesOf(r).length) return toast(`${REGION_NAMES[r - 1]}은 준비 중이에요`);
      if (!regionOpen(profile, r)) {
        const need = regionStars(r);
        return toast(totalStars(profile) < need ? `별 ${need}개가 있어야 열려요 (지금 ${totalStars(profile)}개)` : `${r - 1}-5 보스를 깨야 열려요`);
      }
      showStages(r);
    }),
  );
}

/** 스테이지에 나오는 요괴 그림 (중복 없이, 보스·대장 먼저) */
function foeArts(st: StageDef): string[] {
  const out: string[] = [];
  for (const w of [...st.waves].reverse())
    for (const f of w) {
      const art = f.k === 'boss' ? BOSSES[BOSS_IDS[(st.region - 1) % BOSS_IDS.length]].art : f.k === 'chief' ? chiefDef(st.region).art : ENEMIES[f.k].art;
      if (!out.includes(art)) out.push(art);
    }
  return out;
}

function showStages(region: number) {
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 지도</button><h2>${region}. ${REGION_NAMES[region - 1]}</h2><div class="pills">${starPill()}</div></div>
    <div class="stage-list">${stagesOf(region)
      .map((st) => {
        const open = stageOpen(profile, st.id);
        return `<button class="btn stage-row ${open ? '' : 'locked'} ${st.no === 5 ? 'boss' : ''}" data-id="${st.id}">
            <b>${st.id}</b>
            <span class="st-mid"><span>${open ? st.name : '🔒 앞 스테이지를 깨면 열려요'}</span>
              <span class="foes">${foeArts(st)
                .slice(0, 4)
                .map((a) => `<img src="${artUrl(a)}" alt="" />`)
                .join('')}<em class="tag ${st.tip}">${st.tip === 'pierce' ? '관통형' : '반사형'} 유리</em></span></span>
            ${starsHtml(profile.stages[st.id] ?? 0)}
          </button>`;
      })
      .join('')}</div>
    <div class="grow"></div>`,
    `bg-${groundOf(region)}`,
  );
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showRegions();
  });
  root.querySelectorAll<HTMLButtonElement>('.stage-row').forEach((b) =>
    b.addEventListener('click', () => {
      play('click');
      const st = stageOf(b.dataset.id!);
      if (!st) return;
      if (!stageOpen(profile, st.id)) return toast('앞 스테이지를 먼저 깨 주세요');
      showParty(st);
    }),
  );
}

// ---------- 파티 고르기 ----------

function showParty(st: StageDef) {
  const open = heroesOf(profile);
  let party = partyOf(profile);
  let focus: HeroId = party[0] ?? open[0];
  const root = screen(
    `<div class="bar"><button class="back" id="back">← ${st.id}</button><h2>파티 고르기</h2><div class="spacer"></div></div>
    <div class="card"><h3>쏘는 순서 <small>칸을 누르면 빠져요</small></h3><div class="party-slots" id="slots"></div></div>
    <div class="card"><h3>대원 <small>누르면 빈 칸에 들어가요</small></h3><div class="pick-grid" id="pick"></div><div id="info" class="hero-info pick-info"></div></div>
    <div class="grow"></div>
    <button class="btn primary big" id="start">⚔️ ${st.id} 출발!</button>`,
    `bg-${groundOf(st.region)}`,
  );
  const paint = () => {
    root.querySelector('#slots')!.innerHTML = [0, 1, 2, 3]
      .map((i) => {
        const id = party[i];
        return id
          ? `<button class="slot" data-i="${i}"><i>${i + 1}</i><img src="${zodiacFaceUrl(id)}" alt="" class="ball ${HEROES[id].type}" /><b>${HEROES[id].name}</b></button>`
          : `<button class="slot empty" data-i="${i}"><i>${i + 1}</i><span>빈 칸</span></button>`;
      })
      .join('');
    root.querySelector('#pick')!.innerHTML = HERO_IDS.map((id) => {
      const ok = open.includes(id);
      const at = party.indexOf(id);
      return `<button class="leader ${at >= 0 ? 'on' : ''} ${ok ? '' : 'locked'} ${id === focus ? 'focus' : ''}" data-id="${id}" ${ok ? '' : 'disabled'}>
          <img src="${zodiacFaceUrl(id)}" alt="${HEROES[id].name}" /><b>${HEROES[id].name}</b>${ok ? (at >= 0 ? `<em>${at + 1}번</em>` : '') : `<em>🔒 ${HEROES[id].unlockRegion}지역</em>`}
        </button>`;
    }).join('');
    const d = HEROES[focus];
    root.querySelector('#info')!.innerHTML = `<b>${d.name} ${typeTag(focus)}</b><span>우정 콤보: ${d.comboName}</span><span>필살기: ${d.specialName} <span class="soft">(${d.charge}턴)</span></span>`;
    (root.querySelector('#start') as HTMLButtonElement).disabled = party.length === 0;
    root.querySelectorAll<HTMLButtonElement>('.slot').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        if (!party[i]) return;
        play('click');
        party = party.filter((_, k) => k !== i);
        paint();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('#pick .leader').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.id as HeroId;
        play('click');
        focus = id;
        if (!party.includes(id)) {
          if (party.length >= 4) toast('4칸이 다 찼어요. 위 칸을 눌러 빼 주세요');
          else party = [...party, id];
        }
        paint();
      }),
    );
  };
  paint();
  root.querySelector('#back')!.addEventListener('click', () => {
    play('click');
    showStages(st.region);
  });
  root.querySelector('#start')!.addEventListener('click', () => {
    if (!party.length) return;
    play('click');
    profile.party = party;
    save();
    startGame(st.id, party);
  });
}

// ---------- 판 ----------

let game: Phaser.Game | null = null;

function closeGame() {
  game?.destroy(true);
  game = null;
}

export function startGame(stageId: string, party: HeroId[] = partyOf(profile)) {
  const st = stageOf(stageId);
  if (!st) return;
  const run = createRun(buildConfig({ stage: st.id, party }));
  const root = app();
  root.innerHTML = `
    <div id="game"></div>
    <div class="hud">
      <button class="icon-btn" id="pause">⏸</button>
      <div class="hud-mid"><b>${st.id} ${st.name}</b><span id="wave"></span></div>
      <span class="troop-pill" id="turns"></span>
    </div>
    <div class="hint" id="hint">화면을 누른 채 당겼다 놓으세요</div>`;
  const waveEl = root.querySelector<HTMLElement>('#wave')!;
  const turnsEl = root.querySelector<HTMLElement>('#turns')!;
  const scene = new GameScene();
  closeGame();
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: root.querySelector<HTMLElement>('#game')!,
    width: W,
    height: H,
    backgroundColor: '#7cc08a',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 3 },
    scene: [],
    banner: false,
  });
  let hinted = false;
  let ended = false;
  game.scene.add('game', scene, true, {
    run,
    ground: groundOf(st.region),
    hooks: {
      sound: play,
      onFrame: (s: RunState) => {
        waveEl.textContent = `웨이브 ${s.wave + 1}/${s.cfg.waves.length}`;
        turnsEl.textContent = `턴 ${s.turn}/${s.cfg.par}`;
        turnsEl.classList.toggle('over', s.turn > s.cfg.par);
        if (!hinted && s.phase !== 'aim') {
          hinted = true;
          root.querySelector('#hint')?.remove();
        }
      },
      onEnd: (s: RunState) => {
        if (ended) return;
        ended = true;
        showResult(s, st, party);
      },
    },
  });
  root.querySelector('#pause')!.addEventListener('click', () => {
    if (scene.paused || ended || run.phase === 'clear' || run.phase === 'fail') return;
    play('click');
    scene.paused = true;
    const box = document.createElement('div');
    box.className = 'overlay';
    box.innerHTML = `<div class="card pop"><h3>일시정지</h3>
      <button class="btn primary big" id="resume">계속하기</button>
      <button class="btn" id="quit">그만하기</button>
      <p class="soft center">그만하면 이번 판은 실패예요</p></div>`;
    root.appendChild(box);
    box.querySelector('#resume')!.addEventListener('click', () => {
      play('click');
      scene.paused = false;
      box.remove();
    });
    box.querySelector('#quit')!.addEventListener('click', () => {
      play('click');
      box.remove();
      if (ended || run.phase === 'clear' || run.phase === 'fail') {
        scene.paused = false;
        return;
      }
      ended = true;
      closeGame();
      showStages(st.region);
    });
  });
}

/** 결과를 기록에 반영하고 새로 합류한 대원을 돌려준다 */
function record(st: StageDef, r: RunResult): HeroId[] {
  if (!r.cleared || DEV_ALL) return [];
  const before = heroesOf(profile);
  profile.stages[st.id] = Math.max(profile.stages[st.id] ?? 0, r.stars);
  save();
  return heroesOf(profile).filter((id) => !before.includes(id));
}

function nextStageOf(st: StageDef): StageDef | null {
  const i = STAGES.findIndex((s) => s.id === st.id);
  return STAGES[i + 1] ?? null;
}

function showResult(s: RunState, st: StageDef, party: HeroId[]) {
  const r = resultOf(s);
  const joined = record(st, r);
  play(r.cleared ? 'win' : 'lose');
  const next = r.cleared ? nextStageOf(st) : null;
  const nextOk = !!next && stageOpen(profile, next.id);
  const [, inPar, noFall] = r.starFlags;
  const box = document.createElement('div');
  box.className = 'overlay';
  box.innerHTML = `<div class="card pop result ${r.cleared ? 'win' : 'lose'}">
      <h2>${r.cleared ? '클리어!' : '실패'}</h2>
      ${
        r.cleared
          ? `<div class="big-stars">${starsHtml(r.stars)}</div>
            <ul class="star-why"><li class="on">★ 클리어</li><li class="${inPar ? 'on' : ''}">★ ${st.par}턴 안에 클리어</li><li class="${noFall ? 'on' : ''}">★ 아무도 안 쓰러짐</li></ul>`
          : `<p class="soft center">웨이브 ${r.wave + 1}/${r.waves} 까지 갔어요${s.turn >= s.cfg.maxTurns ? ` (${s.cfg.maxTurns}턴을 다 썼어요)` : ''}</p>`
      }
      <div class="rows">
        <div><span>쓴 턴</span><b>${r.turns}</b></div>
        <div><span>쓰러뜨린 요괴</span><b>${r.kills}</b></div>
        <div><span>주운 엽전</span><b class="coin">🪙 ${r.coins}</b></div>
      </div>
      ${joined.length ? `<div class="new-leaders">${joined.map((id) => `<span><img src="${zodiacFaceUrl(id)}" alt="" />${HEROES[id].name}이(가) 합류했어요!</span>`).join('')}</div>` : ''}
      <p class="soft center">엽전 지갑과 대원 레벨은 다음 업데이트에서 열려요</p>
      <div class="btns">
        ${nextOk ? `<button class="btn primary big" id="next">다음 스테이지 ▶</button>` : ''}
        <button class="btn ${nextOk ? '' : 'primary big'}" id="again">다시하기</button>
        <button class="btn" id="menu">메뉴로</button>
      </div></div>`;
  app().appendChild(box);
  if (joined.length) play('newRecord');
  box.querySelector('#next')?.addEventListener('click', () => {
    play('click');
    closeGame();
    showParty(next!);
  });
  box.querySelector('#again')!.addEventListener('click', () => {
    play('click');
    closeGame();
    startGame(st.id, party);
  });
  box.querySelector('#menu')!.addEventListener('click', () => {
    play('click');
    closeGame();
    showStages(st.region);
  });
}
