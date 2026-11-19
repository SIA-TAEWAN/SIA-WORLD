import { HELL, ZODIAC_IDS, type RunMode, type ZodiacId } from '../data/balance';
import { BOSSES, BOSS_INDEX } from '../data/bosses';
import { CHARACTERS, CHARACTER_BY_ID } from '../data/characters';
import { MAPS } from '../data/maps';
import { WEAPONS, WEAPON_INDEX } from '../data/weapons';
import { characterPrice, endlessOpen, hellOpen } from '../game/progress';
import { startWeapon } from '../game/sim';
import { LOCAL_MODE } from '../net/api';
import { openWorldRanking, worldHome } from '../net/world';
import { artUrl, zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { esc, loadEngine, mmss, nav, openSettings, saveChar, screen, setProfile, state, toast, watchProfile } from './app';
import { icon } from './icons';
import { sfx } from './sfx';
import { whyText } from './upgrade';

/** 잠금을 적용한다: 프로필의 해금 목록에 없는 캐릭터·맵은 고를 수 없다 (해금은 서버가 판 결과를 보고 정한다) */
const LOCKS_ON = true;

const charLocked = (id: ZodiacId) => LOCKS_ON && !state.profile.unlockedCharacters.includes(id);
const mapLocked = (id: string) => LOCKS_ON && !state.profile.unlockedMaps.includes(id);
/** 무한 모드는 그 맵을 4분 모드로 클리어해야 열린다 (서버의 맵별 최고 기록 기준) */
const endlessLocked = (id: string) => LOCKS_ON && !endlessOpen(state.profile, id);
/** 헬 모드도 같은 조건: 그 맵을 4분 모드로 클리어해야 그 맵의 헬 모드가 열린다 */
const hellLocked = (id: string) => LOCKS_ON && !hellOpen(state.profile, id);
/** 이 맵에서 그 모드를 시작할 수 있나 */
const modeLocked = (mode: RunMode, id: string) => (mode === 'endless' ? endlessLocked(id) : mode === 'hell' ? hellLocked(id) : false);

// ───────────────────────── 메인 ─────────────────────────

export function showMain() {
  const others = ZODIAC_IDS.filter((c) => c !== state.char).sort(() => Math.random() - 0.5);
  let off: (() => void) | null = null;
  const coinsText = () => `🪙 ${state.profile.coins.toLocaleString()}`;
  const root = screen(
    `<div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="people" id="people"></span><span class="spacer"></span>
       <span class="coins-pill" id="mycoins" title="가진 엽전">${coinsText()}</span>
       <button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
     <h1 class="logo">시아서바이벌</h1>
     <p class="tagline">몰려오는 요괴를 4분만 버텨라!</p>
     <div class="hero">
       <div class="hero-floor"></div>
       <img class="hero-char me" src="${zodiacFullUrl(state.char)}" alt="" />
       <img class="hero-char e1" src="${zodiacFullUrl(others[0])}" alt="" />
       <img class="hero-char e2" src="${zodiacFullUrl(others[1])}" alt="" />
       ${['e-imp', 'e-wisp', 'e-club', 'e-fox'].map((n, i) => `<img class="hero-foe f${i + 1}" src="${artUrl(n)}" alt="" />`).join('')}
     </div>
     <div class="main-actions">
       <button class="btn primary big" id="go">출전 ▶</button>
       <div class="sub-actions">
         <button class="btn" id="upgrade">⚒️ 강화</button>
         <button class="btn" id="codex">📖 도감</button>
         <button class="btn" id="ranking">🏆 랭킹</button>
       </div>
     </div>
     <p class="soft foot">${esc(state.user.name)} 님 · 공격은 저절로, 움직이기만 하면 돼요</p>`,
    'main',
    'main',
    () => {
      off?.();
      offProfile();
    },
  );
  // 꾸밈용 요괴 그림을 받지 못하면 깨진 그림 표시가 보이지 않게 숨긴다 (error 는 위로 올라오지 않아 capture 로 듣는다)
  root.querySelector('.hero')!.addEventListener(
    'error',
    (e) => {
      const img = e.target as HTMLElement;
      if (img instanceof HTMLImageElement && img.classList.contains('hero-foe')) img.style.visibility = 'hidden';
    },
    true,
  );
  // 판 저장 답이 메인에 온 뒤에 도착하면 엽전을 새로 적는다
  const offProfile = watchProfile(() => (root.querySelector('#mycoins')!.textContent = coinsText()));
  root.querySelector('#go')!.addEventListener('click', () => {
    sfx('click');
    nav.select();
  });
  root.querySelector('#settings')!.addEventListener('click', () => openSettings());
  root.querySelector('#upgrade')!.addEventListener('click', () => {
    sfx('click');
    nav.upgrade();
  });
  root.querySelector('#codex')!.addEventListener('click', () => {
    sfx('click');
    nav.codex();
  });
  // 랭킹: SIA WORLD 공용 랭킹 창을 시아서바이벌 탭(맵별 생존 시간)으로 연다
  root.querySelector('#ranking')!.addEventListener('click', async () => {
    sfx('click');
    if (LOCAL_MODE) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
    if (!(await openWorldRanking(state.user.id, 'survival'))) toast('랭킹을 불러오지 못했어요');
  });
  // 지금 들어와 있는 사람 수 (다른 게임과 같은 "지금 N/30명")
  const lobby = state.lobby;
  const people = root.querySelector('#people') as HTMLElement;
  const paintPeople = () => {
    people.textContent = lobby && lobby.status === 'ok' && lobby.count > 0 ? `지금 ${lobby.count}/${lobby.max}명` : '';
  };
  paintPeople();
  off = lobby?.onChange(paintPeople) ?? null;
  void loadEngine();
}

// ───────────────────────── 출전 준비 1: 캐릭터 고르기 ─────────────────────────

export function showCharSelect() {
  let pick: ZodiacId = charLocked(state.char) ? 'rat' : state.char;
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>캐릭터 고르기</h2><span class="spacer"></span></div>
     <div class="card info" id="info"></div>
     <div class="card"><div class="chars" id="chars">${CHARACTERS.map(
       (c) => `<button class="char" data-c="${c.id}"><img src="${zodiacFaceUrl(c.id)}" alt="" /><span>${c.nick}</span><b class="lock hidden">🔒</b></button>`,
     ).join('')}</div></div>
     <div class="grow"></div>
     <p class="who-coins">🪙 <b id="mycoins"></b></p>
     <button class="btn primary big" id="next">맵 고르기 ▶</button>`,
    'select',
    'main',
    () => off(),
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
          <li><em>${icon('w', start.id)}</em><span><b>시작 무기 · ${esc(start.name)}</b><small>${esc(start.desc)}</small></span></li>
          <li><em>✨</em><span><b>고유 특성</b><small>${esc(c.trait.text)}</small></span></li>
          <li><em>${locked ? '🔒' : '🔓'}</em><span><b>해금</b><small>${esc(c.unlock.text)}</small></span></li>
        </ul>
        ${own.id !== start.id ? `<p class="soft note">${esc(own.name)}(${esc(own.desc)})은 아직 준비 중이라, 지금은 ${esc(start.name)}으로 시작해요</p>` : ''}
      </div>`;
    // 잠긴 캐릭터: 조건으로 푸는 것은 조건을 보여 주고, 엽전으로 푸는 것은 바로 살 수 있다
    const price = characterPrice(pick);
    root.querySelector('#mycoins')!.textContent = `${state.profile.coins.toLocaleString()}닢`;
    root.querySelectorAll<HTMLElement>('.char').forEach((b) => {
      const l = charLocked(b.dataset.c as ZodiacId);
      b.classList.toggle('locked', l);
      b.querySelector('.lock')?.classList.toggle('hidden', !l);
    });
    next.disabled = locked && (price === null || state.profile.coins < price);
    next.textContent = !locked ? '맵 고르기 ▶' : price !== null ? `🪙 ${price.toLocaleString()}닢으로 풀기` : `🔒 ${c.unlock.text}`;
  };
  paint();
  // 판 저장 답이 늦게 오면 엽전·해금 표시를 새로 그린다
  const off = watchProfile(paint);
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
  let busy = false;
  next.addEventListener('click', async () => {
    if (charLocked(pick)) {
      // 엽전으로 푼다 (원숭이·닭·개)
      if (characterPrice(pick) === null || busy || !state.api) return;
      busy = true;
      try {
        setProfile(await state.api.unlockCharacter(pick));
        sfx('newRecord');
        toast(`${CHARACTER_BY_ID[pick].nick}와(과) 함께할 수 있어요!`);
      } catch (e) {
        sfx('toggle');
        toast(whyText(e));
      }
      busy = false;
      if (root.isConnected) paint();
      return;
    }
    sfx('click');
    saveChar(pick);
    nav.maps();
  });
}

// ───────────────────────── 출전 준비 2: 맵 고르기 → 모드 고르기 (4분 모드 / 헬 모드 / 무한 모드) ─────────────────────────

export function showMapSelect() {
  let pick = MAPS.find((m) => m.id === state.map && m.ready && !mapLocked(m.id))?.id ?? MAPS[0].id;
  // 사용자가 고른 모드 (지난번 것부터). 그 모드가 잠긴 맵에서는 4분 모드로 보이지만, 고른 것은 잊지 않는다:
  // 잠긴 맵을 눌렀다가 열린 맵으로 돌아오면 다시 그 모드(무한·헬)다
  let wanted: RunMode = state.mode;
  /** 지금 고른 맵에서 실제로 시작할 모드 */
  let mode: RunMode = modeLocked(wanted, pick) ? 'normal' : wanted;
  let off = () => {};
  const card = (m: (typeof MAPS)[number], i: number) => {
    const open = m.ready && !mapLocked(m.id);
    const bosses = m.bosses.map((b) => BOSSES[BOSS_INDEX[b.id]]?.name ?? '').join(' · ');
    return `<button class="map m-${m.id} ${open ? '' : 'closed'}" data-m="${m.id}">
      <span class="map-no">${i + 1}</span>
      <span class="map-tx"><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><small class="boss">보스: ${esc(bosses)}</small></span>
      <span class="map-side"><span class="tag lv${i}">${esc(m.level)}</span><em data-mul="${m.coinMul}">엽전 ×${m.coinMul}</em>${open ? '' : `<i>${m.ready ? `🔒 ${esc(m.unlock)}` : '준비 중'}</i>`}</span>
    </button>`;
  };
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>맵 고르기</h2><span class="spacer"></span></div>
     <div class="maps" id="maps">${MAPS.map(card).join('')}</div>
     <div class="modes" id="modes" role="radiogroup" aria-label="모드 고르기"></div>
     <div class="grow"></div>
     <div class="who"><img src="${zodiacFaceUrl(state.char)}" alt="" /><span>${esc(CHARACTER_BY_ID[state.char].nick)} 출전!</span></div>
     <button class="btn primary big" id="start">시작 ▶</button>`,
    'select',
    'main',
    () => off(),
  );
  const modesEl = root.querySelector('#modes') as HTMLElement;
  const startBtn = root.querySelector('#start') as HTMLButtonElement;
  /** 모드 카드 셋 (4분 · 헬 · 무한): 고른 맵에 따라 헬·무한 모드가 잠겨 있으면 조건을 보여 준다 */
  const paintModes = () => {
    const locked = endlessLocked(pick);
    const hLocked = hellLocked(pick);
    mode = modeLocked(wanted, pick) ? 'normal' : wanted;
    const best = state.profile.endlessBest[pick];
    const hBest = state.profile.hellBest[pick];
    const name = MAPS.find((m) => m.id === pick)!.name;
    const lockNote = `🔒 ${esc(name)}을(를) 4분 모드로 클리어하면 열려요`;
    const endlessNote = locked ? lockNote : best ? `죽을 때까지 버텨요 · 내 최고 ${mmss(best.time)}` : '4분 뒤로도 죽을 때까지 버텨요';
    const hellNote = hLocked
      ? lockNote
      : hBest
        ? `엽전 ×${HELL.coin} · ${hBest.cleared ? '클리어!' : `내 최고 ${mmss(hBest.time)}`}`
        : `더 강한 요괴 · 보스 새 패턴 · 엽전 ×${HELL.coin}`;
    const cardOf = (m: RunMode, cls: string, title: string, note: string, closed: boolean) =>
      `<button class="mode ${cls} ${mode === m ? 'sel' : ''} ${closed ? 'closed' : ''}" data-mode="${m}" role="radio" aria-checked="${mode === m}"><b>${title}</b><small>${note}</small></button>`;
    modesEl.innerHTML =
      cardOf('normal', '', '⏱️ 4분 모드', '최종 보스를 잡으면 클리어', false) +
      cardOf('hell', 'hell', '🔥 헬 모드', hellNote, hLocked) +
      cardOf('endless', '', '♾️ 무한 모드', endlessNote, locked);
    startBtn.textContent = mode === 'endless' ? '무한 모드 시작 ▶' : mode === 'hell' ? '🔥 헬 모드 시작 ▶' : '시작 ▶';
    // 헬 모드를 골랐으면 화면도 헬 분위기로: 시작 버튼, 맵 카드의 엽전 배율(2배)
    root.classList.toggle('hell-pick', mode === 'hell');
    root.querySelectorAll<HTMLElement>('.map-side em').forEach((em) => {
      em.textContent = `엽전 ×${Number(em.dataset.mul) * (mode === 'hell' ? HELL.coin : 1)}`;
    });
  };
  const paint = () => {
    root.querySelectorAll<HTMLElement>('.map').forEach((b) => b.classList.toggle('sel', b.dataset.m === pick));
    paintModes();
  };
  paint();
  // 판 저장 답이 늦게 와서 새 맵이 풀리면(또는 무한 모드가 열리면) 목록을 새로 그린다
  off = watchProfile(() => {
    root.querySelector('#maps')!.innerHTML = MAPS.map(card).join('');
    paint();
  });
  modesEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.mode') as HTMLElement | null;
    if (!b) return;
    sfx('toggle');
    const want: RunMode = b.dataset.mode === 'endless' ? 'endless' : b.dataset.mode === 'hell' ? 'hell' : 'normal';
    if (modeLocked(want, pick)) return toast(`🔒 ${MAPS.find((m) => m.id === pick)!.name}을(를) 4분 모드로 클리어하면 ${want === 'hell' ? '헬 모드' : '무한 모드'}가 열려요`, 2800);
    wanted = want;
    state.mode = wanted;
    paintModes();
  });
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
    // 고른 모드를 기억한다 (잠긴 맵이라 4분 모드로 시작해도, 다음에 열린 맵을 고르면 그 모드부터)
    state.mode = wanted;
    nav.game({ char: state.char, map: pick, mode });
  });
  void loadEngine();
}
