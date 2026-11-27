import { CHAR_IDS, WIN_SCORE, ZODIAC_IDS, ZODIAC_NICK, isCharId, type ZodiacId } from '../game/constants';
import type { MatchSetup } from '../match/game';
import { VolleyRoom, newRoomCode, type StartMsg } from '../net/room';
import { SEATS, cleanTitle } from '../net/seats';
import { LOCAL_MODE } from '../net/api';
import { pendingStore, settlePending } from '../net/record';
import { openWorldRanking, worldHome } from '../net/world';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { esc, leaveRoom, loadEngine, nav, openSettings, roomLink, saveChar, screen, setRoomInUrl, stage, state, toast } from './app';
import { sfx } from './sfx';
import { clearH2h, fillH2h } from './h2h';
import { UNLOCK_LABEL, isCharOpen, onUnlockChange, refreshProgress } from '../game/unlock';
import { pressUnlock, unlockButtonHtml, type UnlockHooks } from './unlockBtn';

/**
 * 캐릭터 고르기 칸 (AI 대전 고르기·게임방 같이 씀). 안 연 고양이는 그림을 보여 주되 자물쇠 (누르면 아래 '시아코인 100개로 열기' 를 누른 것처럼).
 * 남이 고른 캐릭터(상대 자리)는 잠금과 상관없이 그대로 보인다 — 여기는 내가 고르는 칸만.
 */
function charButtons(selected: ZodiacId): string {
  return CHAR_IDS.map((c) => {
    const lock = c !== selected && !isCharOpen(c);
    return `<button class="char ${c === selected ? 'sel' : ''} ${lock ? 'locked' : ''}" data-c="${c}" ${lock ? `title="${UNLOCK_LABEL}" aria-label="${ZODIAC_NICK[c]} (잠김 · ${UNLOCK_LABEL})"` : ''}><img src="${zodiacFaceUrl(c)}" alt="" /><span>${ZODIAC_NICK[c]}</span>${lock ? '<i class="lock" aria-hidden="true">🔒</i>' : ''}</button>`;
  }).join('');
}
/** 잠긴 고양이 아래 '시아코인 100개로 열기' 버튼 (모두 열렸으면 빈 글) */
function lockNote(): string {
  return unlockButtonHtml(CHAR_IDS.filter((c) => !isCharOpen(c)).map((c) => ZODIAC_NICK[c]));
}
/** #lock-note 의 열기 버튼을 잇는다. opened: 열렸을 때 고양이를 골라 둔다 */
function wireUnlock(root: HTMLElement, opened: () => void): UnlockHooks {
  const note = root.querySelector('#lock-note') as HTMLElement;
  const hooks: UnlockHooks = {
    repaint: () => {
      if (note.isConnected) note.innerHTML = lockNote();
    },
    toast: (m) => toast(m, 2600),
    opened,
  };
  note.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-unlock]')) return;
    sfx('click');
    void pressUnlock(hooks);
  });
  return hooks;
}
/** 고를 수 있으면 true. 잠겼으면 열기 버튼을 누른 것처럼 (확인 글로 바뀐다) 하고 false */
function pickable(c: ZodiacId, hooks: UnlockHooks): boolean {
  if (isCharOpen(c)) return true;
  sfx('click');
  void pressUnlock(hooks);
  return false;
}

/** 테스트 모드에서 배경을 고른다 (?local=1&bg=0~2). 평소에는 경기마다 무작위 */
const bgParam = new URLSearchParams(location.search).get('bg');
const testBg = LOCAL_MODE && bgParam !== null && /^[0-2]$/.test(bgParam) ? Number(bgParam) : null;

/** AI 대전 설정: 내가 왼쪽, AI는 내 캐릭터를 뺀 십이지 중 무작위 (추가 캐릭터는 고르지 않는다) */
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
  const f = (i: 0 | 1) => ({ id: s.players[i].id, name: s.players[i].name, char: isCharId(s.players[i].char) ? s.players[i].char : 'tiger', ai: false });
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
    <div class="card rooms-card"><h3>방 목록 <span class="soft" id="rooms-n"></span><span class="people" id="people"></span></h3><div class="rooms" id="rooms"><p class="empty">불러오는 중…</p></div></div>
    <div class="sub-actions"><button class="btn" id="rank">🏆 랭킹</button><button class="btn" id="howto">❓ 방법</button></div>`,
    'lobby',
    'main',
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
    // 지금 시아배구에 들어와 있는 사람 수 (방에 있는 사람 포함)
    const people = lobby.status === 'ok' && lobby.count > 0 ? `지금 ${Math.min(lobby.count, lobby.max)}/${lobby.max}명` : '';
    if ($('#people').textContent !== people) $('#people').textContent = people;
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
  // 지난번에 확정하지 못하고 떠난 경기(내 보고만 올라간 경기)를 확정한다
  if (state.api && !LOCAL_MODE) void settlePending(state.api, pendingStore(state.user.id)).catch(() => 0);
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
    <div class="card"><h3>캐릭터 <span class="soft">누구로 할까요?</span></h3><div class="chars" id="chars"></div><div class="lock-note" id="lock-note"></div></div>
    <div class="grow"></div>
    <p class="status">내가 왼쪽 · AI가 오른쪽 · 전적과 시아코인에 반영돼요 (하루 30판) · 도중에 나가면 패배로 기록돼요</p>
    <button class="btn primary big" id="start">경기 시작 ▶</button>`,
    'room',
    'main',
    () => offUnlock(),
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const paint = () => {
    $<HTMLImageElement>('#pick-img').src = zodiacFullUrl(char);
    $('#pick-name').textContent = ZODIAC_NICK[char];
    $('#chars').innerHTML = charButtons(char);
    $('#lock-note').innerHTML = lockNote();
  };
  // 열면 고양이를 골라 둔다. 다른 기기에서 열고 돌아와도(화면이 다시 보일 때 다시 불러온다) 자물쇠를 푼다
  const unlockHooks = wireUnlock(root, () => {
    char = 'cat';
    paint();
  });
  const offUnlock = onUnlockChange(paint);
  paint();
  // 잠긴 동안 구매 조건 진행을 다시 읽는다 (판을 하고 돌아오면 숫자가 늘어 있다)
  void refreshProgress();
  $('#chars').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.char') as HTMLElement | null;
    if (!b) return;
    const c = b.dataset.c as ZodiacId;
    if (!pickable(c, unlockHooks)) return;
    sfx('click');
    char = c;
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
    screen('<div class="connecting"><div class="spinner"></div><p>방에 들어가는 중…</p></div>', 'center', 'main');
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
      void loadEngine().then(
        () => state.room === room && room.current?.matchNo === s.matchNo && nav.match(onlineSetup(s, state.user.id)),
        () => toast('경기 화면을 불러오지 못했어요. 새로 고침해 주세요', 3200),
      );
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
    <div class="card"><div class="duo" id="duo"></div><p class="h2h" id="h2h"></p></div>
    <div class="card"><h3>캐릭터 <span class="soft">능력은 모두 같아요 · 같은 캐릭터도 돼요</span></h3><div class="chars" id="chars"></div><div class="lock-note" id="lock-note"></div></div>
    <div class="grow"></div>
    <p class="status" id="status"></p>
    <button class="btn primary big" id="ready">레디 ▶</button>`,
    'room',
    'main',
    () => {
      off?.();
      offUnlock();
    },
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  /** 맞대결 전적을 읽어 둔 상대 */
  let h2hFor = '';

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
        <img class="av" src="${zodiacFaceUrl(isCharId(p.char) ? p.char : 'tiger')}" alt="" /><div class="nm">${esc(p.name)}</div>${st}</div>`;
    };
    $('#duo').innerHTML = `${seat(0)}<div class="vs-mark">VS</div>${seat(1)}`;
    // 맞대결 전적: 상대가 바뀔 때만 다시 읽는다 (못 읽으면 줄이 보이지 않는다)
    const opp = ps.find((p) => p.id !== state.user.id);
    if ((opp?.id ?? '') !== h2hFor) {
      h2hFor = opp?.id ?? '';
      const line = $('#h2h');
      clearH2h(line);
      if (opp) void fillH2h(line, opp, true, () => state.room === room && h2hFor === opp.id);
    }
    $('#chars').innerHTML = charButtons(room.char);
    $('#lock-note').innerHTML = lockNote();
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
  const unlockHooks = wireUnlock(root, () => {
    if (state.room !== room || room.ready) return;
    room.setChar('cat');
    saveChar(room.char);
  });
  const offUnlock = onUnlockChange(paint);
  paint();
  // 잠긴 동안 구매 조건 진행을 다시 읽는다 (판을 하고 돌아오면 숫자가 늘어 있다)
  void refreshProgress();
  if (state.room !== room) return;

  $('#chars').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.char') as HTMLElement | null;
    if (!b) return;
    if (room.ready) return toast('레디를 풀고 바꿔 주세요');
    const c = b.dataset.c as ZodiacId;
    if (!pickable(c, unlockHooks)) return;
    sfx('click');
    room.setChar(c);
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
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: '시아배구', text: '같이 배구해요! 🏐', url });
        return;
      } catch (e) {
        // 공유 창을 닫았으면(AbortError) 아무것도 안 한다. 다른 오류(권한·지원 안 함)면 아래 복사로
        if ((e as { name?: unknown } | null)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('방 링크를 복사했어요');
    } catch {
      toast('링크를 복사하지 못했어요. 주소창의 주소를 보내 주세요', 3000);
    }
  });
  void loadEngine();
}
