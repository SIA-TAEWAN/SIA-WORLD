import { ZODIAC_IDS, type ZodiacId } from '../data/balance';
import { BOSSES, BOSS_INDEX } from '../data/bosses';
import { CHARACTERS, CHARACTER_BY_ID } from '../data/characters';
import { MAPS } from '../data/maps';
import { WEAPONS, WEAPON_INDEX } from '../data/weapons';
import { startWeapon } from '../game/sim';
import { worldHome } from '../net/world';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { esc, loadEngine, nav, openSettings, saveChar, screen, state, toast } from './app';
import { sfx } from './sfx';

/**
 * 잠금을 적용할까. 엽전·해금·저장은 4단계에서 만들므로 지금은 12종을 모두 고를 수 있다.
 * (잠금 표시 자리와 해금 조건 글은 이미 화면에 있다. 4단계에서 true 로 바꾸고 저장된 해금 목록을 쓴다)
 */
const LOCKS_ON = false;

const charLocked = (id: ZodiacId) => LOCKS_ON && !state.profile.unlockedCharacters.includes(id);
const mapLocked = (id: string) => LOCKS_ON && !state.profile.unlockedMaps.includes(id);

// ───────────────────────── 메인 ─────────────────────────

export function showMain() {
  const others = ZODIAC_IDS.filter((c) => c !== state.char).sort(() => Math.random() - 0.5);
  const root = screen(
    `<div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span>
       <span class="coins-pill" title="가진 엽전">🪙 ${state.profile.coins.toLocaleString()}</span>
       <button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
     <h1 class="logo">시아서바이벌</h1>
     <p class="tagline">몰려오는 요괴를 10분만 버텨라!</p>
     <div class="hero">
       <div class="hero-floor"></div>
       <img class="hero-char me" src="${zodiacFullUrl(state.char)}" alt="" />
       <img class="hero-char e1" src="${zodiacFullUrl(others[0])}" alt="" />
       <img class="hero-char e2" src="${zodiacFullUrl(others[1])}" alt="" />
       <i class="hero-imp i1"></i><i class="hero-imp i2"></i><i class="hero-imp i3"></i>
     </div>
     <div class="main-actions">
       <button class="btn primary big" id="go">출전 ▶</button>
       <div class="sub-actions">
         <button class="btn soon" id="upgrade">⚒️ 강화</button>
         <button class="btn soon" id="codex">📖 도감</button>
         <button class="btn soon" id="ranking">🏆 랭킹</button>
       </div>
     </div>
     <p class="soft foot">${esc(state.user.name)} 님 · 공격은 저절로, 움직이기만 하면 돼요</p>`,
    'main',
    'main',
  );
  root.querySelector('#go')!.addEventListener('click', () => {
    sfx('click');
    nav.select();
  });
  root.querySelector('#settings')!.addEventListener('click', () => openSettings());
  // 강화·도감·랭킹은 다음 단계에서 만든다 (지금은 자리만)
  for (const [id, name] of [['upgrade', '강화'], ['codex', '도감'], ['ranking', '랭킹']] as const) {
    root.querySelector(`#${id}`)!.addEventListener('click', () => {
      sfx('toggle');
      toast(`${name}는 아직 준비 중이에요`);
    });
  }
  void loadEngine();
}

// ───────────────────────── 출전 준비 1: 캐릭터 고르기 ─────────────────────────

export function showCharSelect() {
  let pick: ZodiacId = charLocked(state.char) ? 'rat' : state.char;
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>캐릭터 고르기</h2><span class="spacer"></span></div>
     <div class="card info" id="info"></div>
     <div class="card"><div class="chars" id="chars">${CHARACTERS.map(
       (c) => `<button class="char ${charLocked(c.id) ? 'locked' : ''}" data-c="${c.id}"><img src="${zodiacFaceUrl(c.id)}" alt="" /><span>${c.nick}</span>${charLocked(c.id) ? '<b class="lock">🔒</b>' : ''}</button>`,
     ).join('')}</div></div>
     <div class="grow"></div>
     <button class="btn primary big" id="next">맵 고르기 ▶</button>`,
    'select',
    'main',
  );
  const info = root.querySelector('#info') as HTMLElement;
  const next = root.querySelector('#next') as HTMLButtonElement;
  const paint = () => {
    const c = CHARACTER_BY_ID[pick];
    const own = WEAPONS[WEAPON_INDEX[c.weapon]];
    const start = WEAPONS[startWeapon(pick)];
    const locked = charLocked(pick);
    root.querySelectorAll<HTMLElement>('.char').forEach((b) => b.classList.toggle('sel', b.dataset.c === pick));
    info.innerHTML = `<div class="info-stage"><img src="${zodiacFullUrl(pick)}" alt="" /></div>
      <div class="info-text">
        <h3>${esc(c.nick)} <small>${esc(c.name)}</small></h3>
        <ul class="facts">
          <li><em>${start.icon}</em><span><b>시작 무기 · ${esc(start.name)}</b><small>${esc(start.desc)}</small></span></li>
          <li><em>✨</em><span><b>고유 특성</b><small>${esc(c.trait.text)}</small></span></li>
          <li><em>${locked ? '🔒' : '🔓'}</em><span><b>해금</b><small>${esc(c.unlock.text)}</small></span></li>
        </ul>
        ${own.id !== start.id ? `<p class="soft note">${esc(own.name)}(${esc(own.desc)})은 아직 준비 중이라, 지금은 ${esc(start.name)}으로 시작해요</p>` : ''}
      </div>`;
    next.disabled = locked;
    next.textContent = locked ? `🔒 ${c.unlock.text}` : '맵 고르기 ▶';
  };
  paint();
  root.querySelector('#chars')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.char') as HTMLElement | null;
    if (!b) return;
    sfx('toggle');
    pick = b.dataset.c as ZodiacId;
    paint();
  });
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
  next.addEventListener('click', () => {
    if (charLocked(pick)) return;
    sfx('click');
    saveChar(pick);
    nav.maps();
  });
}

// ───────────────────────── 출전 준비 2: 맵 고르기 ─────────────────────────

export function showMapSelect() {
  let pick = MAPS.find((m) => m.id === state.map && m.ready && !mapLocked(m.id))?.id ?? MAPS[0].id;
  const card = (m: (typeof MAPS)[number], i: number) => {
    const open = m.ready && !mapLocked(m.id);
    const bosses = m.bosses.map((b) => BOSSES[BOSS_INDEX[b.id]]?.name ?? '').join(' · ');
    return `<button class="map m-${m.id} ${open ? '' : 'closed'}" data-m="${m.id}">
      <span class="map-no">${i + 1}</span>
      <span class="map-tx"><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><small class="boss">보스: ${esc(bosses)}</small></span>
      <span class="map-side"><span class="tag lv${i}">${esc(m.level)}</span><em>엽전 ×${m.coinMul}</em>${open ? '' : `<i>${m.ready ? `🔒 ${esc(m.unlock)}` : '준비 중'}</i>`}</span>
    </button>`;
  };
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>맵 고르기</h2><span class="spacer"></span></div>
     <div class="maps" id="maps">${MAPS.map(card).join('')}</div>
     <div class="grow"></div>
     <div class="who"><img src="${zodiacFaceUrl(state.char)}" alt="" /><span>${esc(CHARACTER_BY_ID[state.char].nick)} 출전!</span></div>
     <button class="btn primary big" id="start">시작 ▶</button>`,
    'select',
    'main',
  );
  const paint = () => root.querySelectorAll<HTMLElement>('.map').forEach((b) => b.classList.toggle('sel', b.dataset.m === pick));
  paint();
  root.querySelector('#maps')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.map') as HTMLElement | null;
    if (!b) return;
    const m = MAPS.find((x) => x.id === b.dataset.m)!;
    if (!m.ready) {
      sfx('toggle');
      return toast(`${m.name}은(는) 아직 준비 중이에요`);
    }
    if (mapLocked(m.id)) {
      sfx('toggle');
      return toast(`🔒 ${m.unlock}`);
    }
    sfx('toggle');
    pick = m.id;
    paint();
  });
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.select();
  });
  root.querySelector('#start')!.addEventListener('click', () => {
    sfx('click');
    state.map = pick;
    nav.game({ char: state.char, map: pick });
  });
  void loadEngine();
}
