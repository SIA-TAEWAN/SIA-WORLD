import { DAILY_GAME, OBSTACLE_ICON, OBSTACLE_NAME, dailyLabel, dailyMs, dailyRoomKey, dailyTrack, dailyTrackSeed, isDailyDay, localDailyDay } from '../game/daily';
import { formatTime } from '../game/ranking';
import { LOCAL_MODE } from '../net/api';
import { RaceRoom } from '../net/room';
import { worldDailyRanking, worldDailyToday, type DailyRanking } from '../net/world';
import { zodiacFaceUrl } from '../assets';
import { esc, leaveRoom, loadEngine, nav, openSettings, screen, setRoomInUrl, state, toast } from './app';
import { sfx } from './sfx';

/**
 * 오늘의 도전 화면: 오늘의 트랙(날짜로 만든 방해물 배치) 설명, 오늘 순위(상위 + 내 순위), '도전' 버튼.
 * 날짜는 서버(한국 시간)에서 받고, 못 받으면 기기 시계로 (테스트 모드는 늘 기기 시계, 서버 기록 없음).
 */
export async function showDaily() {
  // 다른 방에 있었으면 나온다 (결과 화면의 '다시 도전' 등)
  if (state.room) leaveRoom();
  state.daily = null;
  setRoomInUrl(null);
  let day = localDailyDay();
  /** 서버 날짜를 받았는가 (받기 전에는 '도전'을 막는다: 날짜가 다르면 다른 트랙이 된다) */
  let ready = LOCAL_MODE;
  let alive = true;
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>오늘의 도전</h2><button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
    <div class="card daily-info"><h3>📅 오늘의 트랙 <span class="tag" id="day"></span></h3>
      <p class="daily-desc">오늘은 모두 <b>같은 트랙</b>을 달려요. AI 3명과 달려 <b>가장 빠른 완주 기록</b>으로 오늘 순위를 매겨요. 몇 번이든 다시 도전할 수 있어요.</p>
      <div class="daily-track" id="track" aria-label="오늘의 방해물 순서"></div></div>
    <div class="card daily-rank"><h3>오늘 순위 <span class="soft" id="total"></span></h3>
      <div class="daily-rows" id="rows"><p class="empty">불러오는 중…</p></div>
      <div class="daily-mine" id="mine"></div></div>
    <button class="btn primary big" id="start" disabled>도전 ▶</button>`,
    'daily',
    'lobby',
    () => {
      alive = false;
    },
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;

  const paintTrack = () => {
    $('#day').textContent = dailyLabel(day);
    // 캐릭터 → 방해물 순서 → 결승선 (DESIGN.md: 어느 화면이든 캐릭터가 보이게)
    $('#track').innerHTML =
      `<img src="${zodiacFaceUrl(state.char)}" alt="" />` +
      dailyTrack(day)
        .map((o) => `<i title="${OBSTACLE_NAME[o.kind]} ${Math.round(o.x)}m">${OBSTACLE_ICON[o.kind]}</i>`)
        .join('') +
      '<i title="결승선 150m">🏁</i>';
    $<HTMLButtonElement>('#start').disabled = !ready;
  };

  const paintRank = (r: DailyRanking | null) => {
    if (!alive) return;
    const rows = $('#rows');
    if (LOCAL_MODE) {
      rows.innerHTML = '<p class="empty">테스트 모드에서는 순위가 남지 않아요</p>';
      return;
    }
    if (!r) {
      // 조용히: 순위 없이도 달릴 수 있다
      rows.innerHTML = '<p class="empty">순위를 불러오지 못했어요</p>';
      return;
    }
    $('#total').textContent = r.total > 0 ? `${r.total}명` : '';
    rows.innerHTML = r.top.length
      ? r.top
          .map((t) => {
            const ms = dailyMs(t);
            const place = Number(t.place) || 0;
            return `<div class="drow ${t.me ? 'me' : ''} ${place === 1 ? 'p1' : ''}"><span class="pl">${place}</span><span class="nm">${esc(t.nickname ?? '')}</span><span class="tm">${ms === null ? '-' : `${formatTime(ms)}초`}</span></div>`;
          })
          .join('')
      : '<p class="empty">아직 기록이 없어요. 첫 기록을 세워 보세요!</p>';
    const mine = r.mine;
    const ms = dailyMs(mine);
    $('#mine').innerHTML =
      mine && ms !== null
        ? `<span>내 기록 <b>${Number(mine.place) || '-'}위</b></span><span><b>${formatTime(ms)}</b>초 <span class="soft">· ${Number(mine.plays) || 1}번 도전</span></span>`
        : '<span class="soft">아직 내 기록이 없어요</span>';
  };

  paintTrack();
  $('#back').addEventListener('click', () => {
    sfx('click');
    nav.lobby();
  });
  $('#settings').addEventListener('click', openSettings);
  $('#start').addEventListener('click', () => {
    if (!ready) return;
    sfx('click');
    void startDaily(day);
  });
  void loadEngine();

  if (LOCAL_MODE) {
    paintRank(null);
    return;
  }
  // 서버 날짜 → 트랙을 다시 그리고 순위를 읽는다
  const today = await worldDailyToday();
  if (!alive) return;
  if (isDailyDay(today)) day = today;
  ready = true;
  paintTrack();
  paintRank(await worldDailyRanking(DAILY_GAME, day));
}

/** 오늘의 트랙으로 혼자(+AI 3명) 달린다: 전용 방을 만들어 바로 레디 → 서버에서 GO 시각을 받아 출발 */
async function startDaily(day: string) {
  const api = state.api;
  if (!api) return nav.lobby();
  if (state.room) leaveRoom();
  let cancelled = false;
  const seed = dailyTrackSeed(day);
  const root = screen(
    `<div class="connecting"><div class="spinner"></div><p>오늘의 트랙을 준비하는 중…</p><button class="btn small" id="cancel">취소</button></div>`,
    'center',
    'lobby',
    () => {
      cancelled = true;
    },
  );
  const room = new RaceRoom(api, dailyRoomKey(), state.user, state.char);
  room.fixedSeed = seed;
  root.querySelector('#cancel')!.addEventListener('click', () => {
    sfx('click');
    cancelled = true;
    if (state.room === room) leaveRoom();
    else void room.leave();
    nav.daily();
  });
  try {
    await room.join();
  } catch {
    void room.leave();
    if (!cancelled) {
      toast('준비하지 못했어요. 잠시 후 다시 시도해 주세요', 3000);
      nav.daily();
    }
    return;
  }
  if (cancelled) return void room.leave();
  // 방 목록(대기실 채널)에는 올리지 않는다: 혼자 달리는 방
  state.room = room;
  state.daily = { day, seed };
  room.onStart((s) => {
    if (state.room !== room) return;
    void loadEngine().then(() => state.room === room && nav.race(s));
  });
  room.setReady(true);
}
