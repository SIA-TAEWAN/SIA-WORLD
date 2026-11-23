import { DAILY_GAME, OBSTACLE_ICON, OBSTACLE_NAME, dailyLabel, dailyMs, dailyRoomKey, dailyTrack, dailyTrackSeed, isDailyDay, localDailyDay } from '../game/daily';
import { formatTime } from '../game/ranking';
import { LOCAL_MODE } from '../net/api';
import { RaceRoom } from '../net/room';
import { worldDailyRanking, worldDailyTodayStrict, type DailyRanking } from '../net/world';
import { zodiacFaceUrl } from '../assets';
import { esc, leaveRoom, loadEngine, nav, openSettings, screen, setRoomInUrl, state, toast } from './app';
import { sfx } from './sfx';

/**
 * 오늘의 도전 화면: 오늘의 트랙(날짜로 만든 방해물 배치) 설명, 오늘 순위(상위 + 내 순위), '도전' 버튼.
 * 날짜는 서버(한국 시간)에서만 받는다: 못 받으면 '도전'을 막는다 (날짜가 틀리면 다른 트랙을 달려 기록이 어긋난다).
 * '도전'을 누를 때 날짜를 다시 받아, 화면에 그린 날짜와 다르면 새 날짜로 다시 그린다.
 * 테스트 모드(?local=1)는 늘 기기 시계, 서버 기록 없음.
 */
export async function showDaily() {
  // 다른 방에 있었으면 나온다 (결과 화면의 '다시 도전' 등)
  if (state.room) leaveRoom();
  state.daily = null;
  setRoomInUrl(null);
  let day = localDailyDay();
  /** 처음 날짜 받기가 끝났는가 (끝나기 전에는 '도전'을 막는다) */
  let ready = LOCAL_MODE;
  /** 화면의 날짜가 서버에서 받은 것인가 */
  let fromServer = false;
  /** 날짜를 다시 받는 중 ('도전'을 두 번 누르지 않게) */
  let checking = false;
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
      '<i title="결승선 146m">🏁</i>';
    $<HTMLButtonElement>('#start').disabled = !ready || checking;
  };
  const NO_DAY = '오늘 날짜를 받지 못했어요';

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
  /** 서버 날짜를 받아 화면을 맞춘다. 화면에 그린 날짜와 같으면(바로 시작해도 되면) true */
  const syncDay = async (): Promise<boolean> => {
    const today = await worldDailyTodayStrict();
    if (!alive) return false;
    if (!isDailyDay(today)) {
      toast(`${NO_DAY}. 잠시 후 다시 시도해 주세요`, 3000);
      if (!fromServer) $('#rows').innerHTML = `<p class="empty">${NO_DAY}</p>`;
      return false;
    }
    const same = fromServer && today === day;
    if (!same) {
      const changed = fromServer;
      day = today;
      fromServer = true;
      if (changed) toast('날짜가 바뀌었어요. 오늘의 트랙을 다시 불러왔어요', 3000);
      paintTrack();
      $('#rows').innerHTML = '<p class="empty">불러오는 중…</p>';
      $('#mine').innerHTML = '';
      $('#total').textContent = '';
      const forDay = day;
      void worldDailyRanking(DAILY_GAME, forDay).then((r) => forDay === day && paintRank(r));
    }
    return same;
  };
  $('#start').addEventListener('click', async () => {
    if (!ready || checking) return;
    sfx('click');
    if (LOCAL_MODE) return void startDaily(day);
    // 누를 때 날짜를 다시 받는다: 자정을 넘겼으면 새 트랙으로 다시 그리고, 이번에는 시작하지 않는다
    checking = true;
    paintTrack();
    const first = !fromServer;
    const same = await syncDay();
    if (!alive) return;
    checking = false;
    paintTrack();
    // 처음에 날짜를 못 받았다가 지금 받은 것이면 (날짜가 바뀐 것이 아니므로) 바로 시작한다
    if (same || (first && fromServer && day === localDailyDay())) void startDaily(day);
  });
  void loadEngine();

  if (LOCAL_MODE) {
    paintRank(null);
    return;
  }
  // 서버 날짜 → 트랙을 다시 그리고 순위를 읽는다 (못 받으면 안내만. '도전'을 누르면 다시 받는다)
  await syncDay();
  if (!alive) return;
  ready = true;
  paintTrack();
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
