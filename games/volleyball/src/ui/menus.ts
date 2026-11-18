import { WIN_SCORE, ZODIAC_IDS, ZODIAC_NICK, type ZodiacId } from '../game/constants';
import type { MatchSetup } from '../match/game';
import { VolleyRoom, newRoomCode, type StartMsg } from '../net/room';
import { SEATS, cleanTitle } from '../net/seats';
import { LOCAL_MODE } from '../net/api';
import { openWorldRanking, worldHome } from '../net/world';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { esc, leaveRoom, loadEngine, nav, openSettings, roomLink, saveChar, screen, setRoomInUrl, stage, state, toast } from './app';
import { sfx } from './sfx';

/** 테스트 모드에서 배경을 고른다 (?local=1&bg=0~2). 평소에는 경기마다 무작위 */
const bgParam = new URLSearchParams(location.search).get('bg');
const testBg = LOCAL_MODE && bgParam !== null && /^[0-2]$/.test(bgParam) ? Number(bgParam) : null;

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
    bg: testBg ?? Math.floor(Math.random() * 3),
  };
}

/** 온라인 대전 설정: 시작 알림에 담긴 값 그대로 (두 기기가 같은 시드·배경·시작 시각을 쓴다) */
export function onlineSetup(s: StartMsg, myId: string): MatchSetup {
  const f = (i: 0 | 1) => ({ id: s.players[i].id, name: s.players[i].name, char: ZODIAC_IDS.includes(s.players[i].char) ? s.players[i].char : 'tiger', ai: false });
  return {
    mode: 'online',
    fighters: [f(0), f(1)],
    mySide: s.players[1].id === myId ? 1 : 0,
    seed: s.seed >>> 0,
    bg: Math.abs(Math.floor(s.bg)) % 3,
    matchNo: s.matchNo,
    startAt: s.startAt,
  };
}

/** 랭킹 창 (SIA WORLD 공용, 시아배구 탭부터) */
export async function showRanking() {
  sfx('click');
  if (LOCAL_MODE) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
  if (!(await openWorldRanking(state.user.id, 'volley'))) toast('랭킹을 불러오지 못했어요');
}

// ───────────────────────── 로비 ─────────────────────────

export function showLobby() {
  setRoomInUrl(null);
  const lobby = state.lobby;
  let off: (() => void) | null = null;
  const others = ZODIAC_IDS.filter((c) => c !== state.char).sort(() => Math.random() - 0.5);
  const root = screen(
    `<div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span><span class="me">${esc(state.user.name)}</span>
      <button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
    <h1 class="logo">시아배구</h1>
    <p class="tagline">십이지신 1:1 배구 · ${WIN_SCORE}점 먼저 얻으면 승리</p>
    <div class="hero"><div class="hero-floor"></div><div class="hero-net"></div><div class="hero-ball"></div>
      <img class="hero-char l" src="${zodiacFullUrl(state.char)}" alt="" /><img class="hero-char r" src="${zodiacFullUrl(others[0])}" alt="" />
    </div>
    <div class="main-actions two"><button class="btn primary big" id="create">방 만들기 ▶</button><button class="btn big" id="ai">AI 대전</button></div>
    <div class="card rooms-card"><h3>방 목록 <span class="soft" id="rooms-n"></span></h3><div class="rooms" id="rooms"><p class="empty">불러오는 중…</p></div></div>
    <div class="sub-actions"><button class="btn" id="rank">🏆 랭킹</button><button class="btn" id="howto">❓ 방법</button></div>`,
    'lobby',
    'lobby',
    () => off?.(),
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  $('#settings').addEventListener('click', () => openSettings());
  $('#ai').addEventListener('click', () => {
    sfx('click');
    nav.select();
  });
  $('#create').addEventListener('click', showCreate);
  $('#rank').addEventListener('click', () => void showRanking());
  $('#howto').addEventListener('click', showHowTo);

  // 방 목록: 대기 중이면서 1/2인 방만 눌러 들어간다 (대기실 채널에서 실시간으로 받는다)
  let lastRooms = '';
  const paintRooms = () => {
    const box = root.querySelector('#rooms');
    if (!box || !lobby) return;
    const rooms = lobby.rooms;
    const key = `${lobby.status}|${JSON.stringify(rooms)}`;
    if (key === lastRooms) return;
    lastRooms = key;
    $('#rooms-n').textContent = rooms.length ? `${rooms.length}개` : '';
    if (!rooms.length) {
      box.innerHTML =
        lobby.status === 'error'
          ? '<p class="empty">방 목록을 불러오지 못했어요<br/><button class="btn small" id="rooms-retry">다시 시도</button></p>'
          : lobby.status === 'connecting'
            ? '<p class="empty">불러오는 중…</p>'
            : '<p class="empty">열린 방이 없어요. 방을 만들어 보세요!</p>';
      return;
    }
    box.innerHTML = rooms
      .map((r) => {
        const st = r.busy ? '<span class="tag busy">경기중</span>' : '<span class="tag wait">대기중</span>';
        return `<button class="room-row ${r.busy ? 'playing' : ''} ${r.open ? '' : 'full'}" data-code="${esc(r.code)}">
          <img class="av" src="${zodiacFaceUrl(r.hostChar)}" alt="" />
          <span class="rn">${esc(r.title)}<small>방장 ${esc(r.host)} · 👥 ${r.count}/${SEATS}</small></span>${st}<span class="go">${r.open ? '들어가기 ▶' : ''}</span></button>`;
      })
      .join('');
  };
  $('#rooms').addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.closest('#rooms-retry')) {
      sfx('click');
      void lobby?.join();
      return;
    }
    const row = el.closest('.room-row') as HTMLElement | null;
    if (!row) return;
    if (row.classList.contains('playing')) return toast('경기 중인 방이에요');
    if (row.classList.contains('full')) return toast('방이 가득 찼어요');
    sfx('click');
    nav.room(row.dataset.code!);
  });
  if (lobby) {
    off = lobby.onChange(paintRooms);
    void lobby.join();
    paintRooms();
  } else $('#rooms').innerHTML = '<p class="empty">방 목록을 불러오지 못했어요</p>';
  void loadEngine();
}

/** 방 만들기: 방 이름을 적는다 (비워 두면 '○○의 방') */
function showCreate() {
  sfx('click');
  const dim = document.createElement('div');
  dim.className = 'dim';
  dim.innerHTML = `<div class="dialog"><h3>방 만들기</h3>
    <input class="field" id="room-title" maxlength="16" placeholder="${esc(state.user.name)}의 방" autocomplete="off" />
    <p class="soft" style="text-align:center;margin:8px 0 0">방 이름을 비워 두면 '${esc(state.user.name)}의 방'이 돼요</p>
    <div class="actions"><button class="btn" data-close>취소</button><button class="btn primary" data-ok>만들기 ▶</button></div></div>`;
  const go = () => {
    const title = cleanTitle((dim.querySelector('#room-title') as HTMLInputElement).value);
    sfx('click');
    dim.remove();
    nav.room(newRoomCode(), title);
  };
  dim.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-ok]')) go();
    else if (el === dim || el.closest('[data-close]')) dim.remove();
  });
  dim.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  stage.append(dim);
  (dim.querySelector('#room-title') as HTMLInputElement).focus();
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
    <div class="row"><span>👥 방을 만들고 링크를 보내면 친구와 1:1로 겨뤄요</span></div>
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

// ───────────────────────── 게임방 ─────────────────────────

/** 방에 들어간다 (없으면 만들어진다: 방은 실시간 채널이라 코드만 같으면 같은 방) */
export async function enterRoom(code: string, title = '') {
  const api = state.api;
  if (!api) return nav.lobby();
  if (state.room && state.room.key !== code) leaveRoom();
  setRoomInUrl(code);
  if (!state.room) {
    screen('<div class="connecting"><div class="spinner"></div><p>방에 들어가는 중…</p></div>', 'center', 'lobby');
    const room = new VolleyRoom(api, code, state.user, state.char, title);
    try {
      await room.join();
    } catch {
      void room.leave();
      toast('방에 들어가지 못했어요. 잠시 후 다시 시도해 주세요', 3000);
      return nav.lobby();
    }
    state.room = room;
    // 대기실 방 목록에 이 방을 알린다 (사람 수는 각자 올린 정보를 세어 만든다). 자리가 없으면 알리지 않는다
    const tell = () => {
      if (state.room !== room) return;
      state.lobby?.setRoom(room.isFull() ? null : { code, title: room.myTitle, at: room.joinedAt, char: room.char, busy: room.current !== null });
    };
    room.onChange(tell);
    tell();
    // 경기 시작 알림을 받으면 경기 화면으로 (게임방에서든 결과 화면에서든)
    room.onStart((s) => {
      if (state.room !== room) return;
      void loadEngine().then(() => state.room === room && room.current?.matchNo === s.matchNo && nav.match(onlineSetup(s, state.user.id)));
    });
  }
  showWaiting();
}

export function showWaiting() {
  const room = state.room;
  if (!room) return nav.lobby();
  let off: (() => void) | null = null;
  const root = screen(
    `<div class="bar"><button class="back" id="leave">← 나가기</button><h2>게임방</h2><button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
    <div class="card invite"><div class="code"><b id="room-name"></b><div class="soft">방 목록에서 들어오거나, 링크를 보내면 바로 들어와요</div></div><button class="btn small" id="invite">🔗 링크 복사</button></div>
    <div class="card"><div class="duo" id="duo"></div></div>
    <div class="card"><h3>캐릭터 <span class="soft">능력은 모두 같아요 · 같은 캐릭터도 돼요</span></h3><div class="chars" id="chars"></div></div>
    <div class="grow"></div>
    <p class="status" id="status"></p>
    <button class="btn primary big" id="ready">레디 ▶</button>`,
    'room',
    'lobby',
    () => off?.(),
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;

  const paint = () => {
    if (state.room !== room) return;
    if (room.isFull()) {
      // 세 번째로 들어왔다: 자리가 없다
      toast('방이 가득 찼어요', 2600);
      leaveRoom();
      return nav.lobby();
    }
    const ps = room.players();
    const host = ps[0]?.id;
    $('#room-name').textContent = room.title();
    const seat = (i: number) => {
      const p = ps[i];
      const cls = `seat s${i} ${p?.id === state.user.id ? 'me' : ''} ${p ? '' : 'empty'}`;
      if (!p) return `<div class="${cls}"><div class="av blank">?</div><div class="nm">비어있음</div><div class="st">${i === 0 ? '왼쪽' : '오른쪽'}</div></div>`;
      const st = p.ready ? '<div class="st on">레디!</div>' : '<div class="st">준비 중</div>';
      return `<div class="${cls}">${p.id === host ? '<span class="host" title="방장">👑</span>' : ''}
        <img class="av" src="${zodiacFaceUrl(ZODIAC_IDS.includes(p.char) ? p.char : 'tiger')}" alt="" /><div class="nm">${esc(p.name)}</div>${st}</div>`;
    };
    $('#duo').innerHTML = `${seat(0)}<div class="vs-mark">VS</div>${seat(1)}`;
    $('#chars').innerHTML = ZODIAC_IDS.map(
      (c) => `<button class="char ${c === room.char ? 'sel' : ''}" data-c="${c}"><img src="${zodiacFaceUrl(c)}" alt="" /><span>${ZODIAC_NICK[c]}</span></button>`,
    ).join('');
    const busy = room.current !== null;
    const alone = ps.length < SEATS;
    const btn = $<HTMLButtonElement>('#ready');
    btn.disabled = busy;
    btn.textContent = room.ready ? '레디 취소' : '레디 ▶';
    btn.classList.toggle('primary', !room.ready);
    $('#status').textContent = busy
      ? '경기가 진행 중이에요. 끝나면 할 수 있어요'
      : alone
        ? room.ready
          ? '상대가 들어오면 바로 시작해요'
          : '상대를 기다리는 중이에요. 링크를 보내 보세요'
        : room.ready
          ? '상대의 레디를 기다려요…'
          : '둘 다 레디하면 3초 뒤에 시작해요';
  };
  off = room.onChange(paint);
  paint();
  if (state.room !== room) return;

  $('#chars').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.char') as HTMLElement | null;
    if (!b) return;
    if (room.ready) return toast('레디를 풀고 바꿔 주세요');
    sfx('click');
    room.setChar(b.dataset.c as ZodiacId);
    saveChar(room.char);
  });
  $('#ready').addEventListener('click', () => {
    sfx(room.ready ? 'click' : 'toggle');
    saveChar(room.char);
    room.setReady(!room.ready);
  });
  $('#settings').addEventListener('click', () => openSettings());
  $('#leave').addEventListener('click', () => {
    sfx('click');
    leaveRoom();
    nav.lobby();
  });
  $('#invite').addEventListener('click', async () => {
    sfx('click');
    const url = roomLink(room.key);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: '시아배구', text: '같이 배구해요! 🏐', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('방 링크를 복사했어요');
    } catch {
      toast('링크를 복사하지 못했어요. 주소창의 주소를 보내 주세요', 3000);
    }
  });
  void loadEngine();
}
