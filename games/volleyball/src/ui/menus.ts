import { WIN_SCORE, ZODIAC_IDS, ZODIAC_NICK, type ZodiacId } from '../game/constants';
import type { MatchSetup } from '../match/game';
import { worldHome } from '../net/world';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { esc, loadEngine, nav, openSettings, saveChar, screen, stage, state, toast } from './app';
import { sfx } from './sfx';

/** AI 대전 설정: 내가 왼쪽, AI는 내 캐릭터를 뺀 것 중 무작위 */
export function aiSetup(myChar: ZodiacId): MatchSetup {
  const others = ZODIAC_IDS.filter((c) => c !== myChar);
  const aiChar = others[Math.floor(Math.random() * others.length)];
  return {
    mode: 'ai',
    fighters: [
      { name: state.user.name, char: myChar, ai: false },
      { name: `AI ${ZODIAC_NICK[aiChar]}`, char: aiChar, ai: true },
    ],
    mySide: 0,
    seed: Math.floor(Math.random() * 0xffffffff),
  };
}

// ───────────────────────── 로비 ─────────────────────────
// 3단계에서 방 목록·방 만들기가 들어갈 자리. 지금은 [AI 대전]만 살려 둔다.

export function showLobby() {
  const others = ZODIAC_IDS.filter((c) => c !== state.char).sort(() => Math.random() - 0.5);
  const root = screen(
    `<div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span><span class="me">${esc(state.user.name)}</span>
      <button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
    <h1 class="logo">시아배구</h1>
    <p class="tagline">십이지신 1:1 배구 · ${WIN_SCORE}점 먼저 얻으면 승리</p>
    <div class="hero"><div class="hero-floor"></div><div class="hero-net"></div><div class="hero-ball"></div>
      <img class="hero-char l" src="${zodiacFullUrl(state.char)}" alt="" /><img class="hero-char r" src="${zodiacFullUrl(others[0])}" alt="" />
    </div>
    <div class="main-actions"><button class="btn primary big" id="ai">AI 대전 ▶</button><button class="btn big" id="create" disabled>방 만들기 (준비 중)</button></div>
    <div class="card rooms-card"><h3>방 목록</h3><div class="rooms" id="rooms"><p class="empty">친구와 하는 온라인 대전은 준비 중이에요.<br/>지금은 AI와 연습해 보세요!</p></div></div>
    <div class="sub-actions"><button class="btn" id="rank">🏆 랭킹</button><button class="btn" id="howto">❓ 방법</button></div>`,
    'lobby',
    'lobby',
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  $('#settings').addEventListener('click', () => openSettings());
  $('#ai').addEventListener('click', () => {
    sfx('click');
    nav.select();
  });
  $('#rank').addEventListener('click', () => {
    sfx('click');
    toast('랭킹은 준비 중이에요');
  });
  $('#howto').addEventListener('click', showHowTo);
  void loadEngine();
}

function showHowTo() {
  sfx('click');
  const dim = document.createElement('div');
  dim.className = 'dim';
  const hl = (t: string) => `<b style="font-weight:normal;color:var(--accent)">${t}</b>`;
  dim.innerHTML = `<div class="dialog"><h3>❓ 하는 방법</h3>
    <div class="row"><span>🏐 공이 ${hl('내 쪽 바닥')}에 닿으면 상대가 1점</span></div>
    <div class="row"><span>🏆 ${hl(`${WIN_SCORE}점`)}을 먼저 얻으면 승리</span></div>
    <div class="row"><span>◀ ▶ 좌우 이동 (← → 또는 A·D)</span></div>
    <div class="row"><span>🦘 점프 (↑·W·스페이스) — 뛰면서 치면 더 세게 날아가요</span></div>
    <div class="row"><span>⚡ 랠리가 길어지면 10초마다 공이 빨라져요</span></div>
    <div class="actions"><button class="btn primary" data-close>알겠어요</button></div></div>`;
  dim.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === dim || el.closest('[data-close]')) dim.remove();
  });
  stage.append(dim);
}

// ───────────────────────── AI 대전: 캐릭터 고르기 ─────────────────────────

export function showCharSelect() {
  let char = state.char;
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 뒤로</button><h2>캐릭터 선택</h2><button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
    <div class="card pick"><div class="pick-stage"><img id="pick-img" src="" alt="" /></div>
      <div class="pick-name" id="pick-name"></div><div class="soft">겉모습만 달라요. 능력은 모두 같아요</div></div>
    <div class="card"><h3>십이지신 <span class="soft">누구로 할까요?</span></h3><div class="chars" id="chars"></div></div>
    <div class="grow"></div>
    <p class="status">내가 왼쪽 · AI가 오른쪽 · 연습 경기라 기록은 남지 않아요</p>
    <button class="btn primary big" id="start">경기 시작 ▶</button>`,
    'room',
    'lobby',
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const paint = () => {
    $<HTMLImageElement>('#pick-img').src = zodiacFullUrl(char);
    $('#pick-name').textContent = ZODIAC_NICK[char];
    $('#chars').innerHTML = ZODIAC_IDS.map(
      (c) => `<button class="char ${c === char ? 'sel' : ''}" data-c="${c}"><img src="${zodiacFaceUrl(c)}" alt="" /><span>${ZODIAC_NICK[c]}</span></button>`,
    ).join('');
  };
  paint();
  $('#chars').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.char') as HTMLElement | null;
    if (!b) return;
    sfx('click');
    char = b.dataset.c as ZodiacId;
    paint();
  });
  $('#back').addEventListener('click', () => {
    sfx('click');
    nav.lobby();
  });
  $('#settings').addEventListener('click', () => openSettings());
  $('#start').addEventListener('click', () => {
    sfx('toggle');
    saveChar(char);
    nav.match(aiSetup(char));
  });
  void loadEngine();
}
