import { ZODIAC_IDS, ZODIAC_NICK, type ZodiacId } from '../game/constants';
import { formatTime, tierOf } from '../game/ranking';
import { LOCAL_MODE } from '../net/api';
import { RaceRoom, cleanRoomCode, newRoomCode, validRoomCode } from '../net/room';
import { hostOf } from '../net/seats';
import { loadRankIcons, openWorldRanking, worldHome } from '../net/world';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { esc, loadEngine, nav, openSettings, roomLink, saveChar, screen, setRoomInUrl, state, toast } from './app';
import { sfx } from './sfx';

const ART = `${import.meta.env.BASE_URL}art/`;

/** 랭킹 창 (SIA WORLD 공용, 시아레이스 탭부터) */
export async function showRanking() {
  sfx('click');
  if (LOCAL_MODE) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
  if (!(await openWorldRanking(state.user.id, 'race'))) toast('랭킹을 불러오지 못했어요');
}

/** 최고 기록 한 줄: "20.34초 (해)" */
async function bestHtml(ms: number | null): Promise<string> {
  if (ms === null) return '<span class="soft">아직 기록이 없어요</span>';
  let icon = '';
  try {
    icon = (await loadRankIcons()).tierSvg(tierOf(ms), 26);
  } catch {
    /* 아이콘 없이 */
  }
  return `<span><b>${formatTime(ms)}</b>초 ${icon}</span>`;
}

// ───────────────────────── 로비 ─────────────────────────

export function showLobby() {
  setRoomInUrl(null);
  // 내 캐릭터 + 무작위 3명이 달리는 그림
  const others = ZODIAC_IDS.filter((c) => c !== state.char).sort(() => Math.random() - 0.5).slice(0, 3);
  const cast = [others[0], others[1], state.char, others[2]];
  const root = screen(
    `<div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span><span class="me">${esc(state.user.name)}</span>
      <button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
    <h1 class="logo">시아레이스</h1>
    <p class="tagline">십이지신 100m 달리기 · 최대 4명</p>
    <div class="hero"><div class="hero-bg" style="background-image:url('${ART}stands.png')"></div><div class="ground" style="background-image:url('${ART}track.png')"></div>
      ${cast.map((c, i) => `<img class="runner" src="${zodiacFullUrl(c)}" alt="" style="left:${8 + i * 22}%;" />`).join('')}
    </div>
    <div class="card best"><span>🏅 내 최고 기록</span><span id="best"><span class="soft">불러오는 중…</span></span></div>
    <div class="main-actions">
      <button class="btn primary big" id="create">방 만들기 ▶</button>
      <div class="join-row"><input id="code" maxlength="24" placeholder="방 코드" autocomplete="off" autocapitalize="off" spellcheck="false" /><button class="btn" id="join">들어가기</button></div>
    </div>
    <div class="sub-actions"><button class="btn" id="rank">🏆 랭킹</button><button class="btn" id="howto">❓ 방법</button></div>`,
    'lobby',
    'lobby',
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  $('#settings').addEventListener('click', openSettings);
  $('#rank').addEventListener('click', () => void showRanking());
  $('#howto').addEventListener('click', showHowTo);
  $('#create').addEventListener('click', () => {
    sfx('click');
    nav.room(newRoomCode());
  });
  const join = () => {
    const code = cleanRoomCode($<HTMLInputElement>('#code').value);
    if (!validRoomCode(code)) return toast('방 코드는 영문·숫자 4자 이상이에요');
    sfx('click');
    nav.room(code);
  };
  $('#join').addEventListener('click', join);
  $('#code').addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && join());

  const paintBest = async () => {
    const el = root.querySelector('#best');
    if (el) el.innerHTML = await bestHtml(state.best);
  };
  if (state.best !== null) void paintBest();
  void state.api?.myBest().then((ms) => {
    state.best = ms;
    void paintBest();
  });
  void loadEngine();
}

function showHowTo() {
  sfx('click');
  const dim = document.createElement('div');
  dim.className = 'dim';
  dim.innerHTML = `<div class="dialog"><h3>❓ 달리는 방법</h3>
    <div class="row"><span>🏁 '준비' 뒤 <b style="font-weight:normal;color:var(--accent)">GO!</b>가 뜨면 버튼을 눌러 출발</span></div>
    <div class="row"><span>⚠️ GO 전에 누르면 실격</span></div>
    <div class="row"><span>🦘 달리는 중에 누르면 점프 (3m)</span></div>
    <div class="row"><span>🚧 허들·바나나·통나무는 뛰어넘기</span></div>
    <div class="row"><span>🟤 진흙은 느려져요 · ⚡ 발판은 밟으면 빨라져요</span></div>
    <div class="actions"><button class="btn primary" data-close>알겠어요</button></div></div>`;
  dim.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === dim || el.closest('[data-close]')) dim.remove();
  });
  document.getElementById('stage')!.append(dim);
}

// ───────────────────────── 대기실 ─────────────────────────

/** 방에 들어간다 (없으면 만들어진다: 방은 실시간 채널이라 코드만 같으면 같은 방) */
export async function enterRoom(code: string) {
  const api = state.api;
  if (!api) return nav.lobby();
  if (state.room && state.room.key !== code) {
    await state.room.leave();
    state.room = null;
  }
  setRoomInUrl(code);
  if (!state.room) {
    screen('<div class="connecting"><div class="spinner"></div><p>방에 들어가는 중…</p></div>', 'center', 'lobby');
    const room = new RaceRoom(api, code, state.user, state.char);
    try {
      await room.join();
    } catch {
      void room.leave();
      toast('방에 들어가지 못했어요. 잠시 후 다시 시도해 주세요', 3000);
      return nav.lobby();
    }
    state.room = room;
    // 경기 시작 알림을 받으면 (출전 명단에 내가 있으면) 경기 화면으로
    room.onStart((s) => {
      if (state.room !== room) return;
      if (s.roster.some((r) => r.id === state.user.id)) void loadEngine().then(() => state.room === room && nav.race(s));
    });
  }
  showWaiting();
}

export function showWaiting() {
  const room = state.room;
  if (!room) return nav.lobby();
  let off: (() => void) | null = null;
  const root = screen(
    `<div class="bar"><button class="back" id="leave">← 나가기</button><h2>대기실</h2><button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
    <div class="card invite"><div class="code">방 코드 <b>${esc(room.key)}</b><div class="soft">링크를 보내면 친구가 바로 들어와요</div></div><button class="btn small" id="invite">🔗 초대</button></div>
    <div class="card"><h3>출전 선수 <span class="soft">빈 자리는 AI가 달려요</span></h3><div class="seats" id="seats"></div></div>
    <div class="card"><h3>캐릭터 <span class="soft">능력은 모두 같아요</span></h3><div class="chars" id="chars"></div></div>
    <div class="grow"></div>
    <p class="status" id="status"></p>
    <button class="btn primary big" id="ready">레디 ▶</button>`,
    'room',
    'lobby',
    () => off?.(),
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;

  const paint = () => {
    const seats = room.seats();
    const host = hostOf(room.members);
    $('#seats').innerHTML = seats
      .map((s) => {
        const me = s.id === state.user.id;
        const st = s.id === null ? '<div class="st">AI</div>' : s.ready ? '<div class="st on">레디!</div>' : '<div class="st">준비 중</div>';
        return `<div class="seat ${me ? 'me' : ''} ${s.id === null ? 'ai' : ''}">${s.id && s.id === host ? '<span class="host" title="방장">👑</span>' : ''}
          <img class="av" src="${zodiacFaceUrl(s.char)}" alt="" /><div class="nm">${esc(s.name)}</div>${st}</div>`;
      })
      .join('');
    $('#chars').innerHTML = ZODIAC_IDS.map((c) => {
      const sel = c === room.char;
      const taken = !sel && room.isTaken(c);
      return `<button class="char ${sel ? 'sel' : ''} ${taken ? 'taken' : ''}" data-c="${c}" ${taken ? 'disabled' : ''}><img src="${zodiacFaceUrl(c)}" alt="" /><span>${ZODIAC_NICK[c]}</span></button>`;
    }).join('');
    const busy = room.current !== null;
    const full = room.isFull();
    const humans = seats.filter((s) => s.id !== null).length;
    const btn = $<HTMLButtonElement>('#ready');
    btn.disabled = full || busy;
    btn.textContent = room.ready ? '레디 취소' : '레디 ▶';
    btn.classList.toggle('primary', !room.ready);
    $('#status').textContent = full
      ? '자리가 없어요 (4명까지). 자리가 나면 달릴 수 있어요'
      : busy
        ? '경기가 진행 중이에요. 끝나면 같이 달려요'
        : room.ready
          ? '다른 선수의 레디를 기다려요…'
          : humans > 1
            ? '모두 레디하면 출발해요'
            : '레디하면 AI 3명과 바로 출발해요';
  };
  off = room.onChange(paint);
  paint();

  $('#chars').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.char') as HTMLElement | null;
    if (!b || b.hasAttribute('disabled') || room.ready) {
      if (b && room.ready) toast('레디를 풀고 바꿔 주세요');
      return;
    }
    const c = b.dataset.c as ZodiacId;
    sfx('click');
    room.setChar(c);
    saveChar(room.char);
  });
  $('#ready').addEventListener('click', () => {
    sfx(room.ready ? 'click' : 'toggle');
    saveChar(room.char);
    room.setReady(!room.ready);
  });
  $('#settings').addEventListener('click', openSettings);
  $('#leave').addEventListener('click', () => {
    sfx('click');
    void room.leave();
    state.room = null;
    nav.lobby();
  });
  $('#invite').addEventListener('click', async () => {
    sfx('click');
    const url = roomLink(room.key);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: '시아레이스', text: '같이 달려요! 🏁', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('초대 링크를 복사했어요');
    } catch {
      toast(`방 코드: ${room.key}`);
    }
  });
  void loadEngine();
}
