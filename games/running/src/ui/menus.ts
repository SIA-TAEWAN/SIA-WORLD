import { CHAR_IDS, ZODIAC_IDS, ZODIAC_NICK, type ZodiacId } from '../game/constants';
import { formatTime, tierOfPlace } from '../game/ranking';
import { DAILY_GAME, dailyLabel, dailyMs, isDailyDay, localDailyDay } from '../game/daily';
import { LOCAL_MODE } from '../net/api';
import { SoloSession } from '../net/solo';
import { loadRankIcons, openWorldRanking, worldDailyRanking, worldDailyTodayStrict, worldHome, type DailyRanking } from '../net/world';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { UNLOCK_LABEL, isCharOpen, onUnlockChange, refreshProgress } from '../game/unlock';
import { pressUnlock, unlockButtonHtml } from './unlockBtn';
import { esc, loadEngine, nav, openSettings, saveChar, screen, state, toast } from './app';
import { sfx } from './sfx';

const ART = `${import.meta.env.BASE_URL}art/`;
const NO_DAY = '오늘 날짜를 받지 못했어요';

/** 랭킹 창 (SIA WORLD 공용, 시아레이스 탭부터) */
export async function showRanking() {
  sfx('click');
  if (LOCAL_MODE) return toast('테스트 모드에서는 랭킹을 볼 수 없어요');
  if (!(await openWorldRanking(state.user.id, 'race'))) toast('랭킹을 불러오지 못했어요');
}

/** 최고 기록 한 줄: "29.34초 (해)". 아이콘은 내 역대 순위의 등급 (1위 해 · 2위 달 · 3위 별 · 그 밖과 순위 없음은 구름) */
async function bestHtml(ms: number | null, place: number | null): Promise<string> {
  if (ms === null) return '<span class="soft">아직 기록이 없어요</span>';
  let icon = '';
  try {
    icon = (await loadRankIcons()).tierSvg(tierOfPlace(place), 22);
  } catch {
    /* 아이콘 없이 */
  }
  return `<span class="best-v"><b>${formatTime(ms)}</b>초 ${icon}</span>`;
}

/** 서버 날짜 받기 (테스트 모드는 기기 시계). 못 받으면 null */
async function fetchToday(): Promise<string | null> {
  if (LOCAL_MODE) return localDailyDay();
  const d = await worldDailyTodayStrict();
  return isDailyDay(d) ? d : null;
}

// ───────────────────────── 첫 화면: 오늘의 도전 ─────────────────────────

export function showLobby() {
  let alive = true;
  // 내 캐릭터 + 무작위 3명이 달리는 그림
  const others = ZODIAC_IDS.filter((c) => c !== state.char).sort(() => Math.random() - 0.5).slice(0, 3);
  const cast = [others[0], others[1], state.char, others[2]];
  const day0 = state.today ?? localDailyDay();
  const root = screen(
    `<div class="bar"><a class="back" href="${worldHome()}">← SIA WORLD</a><span class="spacer"></span><span class="me">${esc(state.user.name)}</span>
      <button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
    <h1 class="logo">시아레이스</h1>
    <div class="hero"><div class="hero-bg" style="background-image:url('${ART}stands.png')"></div><div class="ground" style="background-image:url('${ART}track.png')"></div>
      ${cast.map((c, i) => `<img class="runner" src="${zodiacFullUrl(c)}" alt="" style="left:${48.3 + (i - 1.5) * 21}%;" />`).join('')}
    </div>
    <div class="card today">
      <h3 class="today-h">📅 <span id="day">${dailyLabel(day0)}</span> 오늘의 도전</h3>
      <div class="today-top" id="top"><span class="soft">불러오는 중…</span></div>
      <div class="today-mine" id="mine"></div>
    </div>
    <button class="btn primary big" id="run">달리기 ▶</button>
    <div class="sub-actions"><button class="btn" id="rank">🏆 랭킹</button><button class="btn" id="howto">❓ 방법</button></div>
    <div class="best-line"><span>🏅 내 최고 기록</span><span id="best"><span class="soft">불러오는 중…</span></span></div>`,
    'lobby',
    'lobby',
    () => {
      alive = false;
    },
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  $('#settings').addEventListener('click', openSettings);
  $('#rank').addEventListener('click', () => void showRanking());
  $('#howto').addEventListener('click', showHowTo);
  $('#run').addEventListener('click', () => {
    sfx('click');
    nav.pick();
  });

  // 오늘 1위 · 내 오늘 기록 (daily_ranking)
  const paintToday = (r: DailyRanking | null, note?: string) => {
    if (!alive) return;
    const top = $('#top');
    const mine = $('#mine');
    if (note) {
      top.innerHTML = `<span class="soft">${note}</span>`;
      mine.innerHTML = '';
      return;
    }
    if (!r) {
      top.innerHTML = '<span class="soft">순위를 불러오지 못했어요</span>';
      mine.innerHTML = '';
      return;
    }
    const first = r.top.find((t) => Number(t.place) === 1) ?? r.top[0];
    const ms1 = dailyMs(first);
    // 1위의 캐릭터는 지금 detail 에 없다 (detail = { ms }): 얼굴 대신 기본 표시(왕관).
    // 3단계(1위 고스트)에서 detail 에 캐릭터가 실리면 여기서 zodiacFaceUrl 로 얼굴을 그린다.
    top.innerHTML =
      first && ms1 !== null
        ? `<span class="crown" aria-hidden="true">👑</span><span class="t1">오늘 1위<b class="nm">${esc(first.nickname ?? '')}</b></span><span class="tm">${formatTime(ms1)}<small>초</small></span>`
        : '<span class="soft first-empty">아직 1위가 없어요. 첫 기록을 세워 보세요!</span>';
    const msMine = dailyMs(r.mine);
    mine.innerHTML =
      r.mine && msMine !== null
        ? `<img src="${zodiacFaceUrl(state.char)}" alt="" /><span>내 기록 <b>${formatTime(msMine)}</b>초</span><span class="pl"><b>${Number(r.mine.place) || '-'}</b>위${r.total > 0 ? `<small> / ${Number(r.total)}명</small>` : ''}</span>`
        : `<img src="${zodiacFaceUrl(state.char)}" alt="" /><span class="soft">아직 안 달렸어요</span>`;
  };

  if (LOCAL_MODE) paintToday(null, '테스트 모드에서는 순위가 남지 않아요');
  else
    void fetchToday().then(async (day) => {
      if (!alive) return;
      if (!day) return paintToday(null, NO_DAY);
      state.today = day;
      $('#day').textContent = dailyLabel(day);
      paintToday(await worldDailyRanking(DAILY_GAME, day));
    });

  // 내 최고 기록 + 역대 순위 등급 (1단계)
  const paintBest = async () => {
    const el = root.querySelector('#best');
    if (!el) return;
    const html = await bestHtml(state.best, state.place);
    if (el.isConnected) el.innerHTML = html;
  };
  if (state.best !== null) void paintBest();
  const api = state.api;
  const uid = state.user.id;
  if (api)
    void Promise.all([api.myBest(), api.places([uid]).catch(() => ({}) as Record<string, number>)]).then(([ms, places]) => {
      state.best = ms;
      state.place = ms === null ? null : (places[uid] ?? null);
      void paintBest();
    });
  void loadEngine();
}

function showHowTo() {
  sfx('click');
  const dim = document.createElement('div');
  dim.className = 'dim';
  dim.innerHTML = `<div class="dialog"><h3>❓ 달리는 방법</h3>
    <div class="row"><span>📅 하루 한 트랙! 오늘은 모두 <b style="font-weight:normal;color:var(--accent)">같은 트랙</b>을 달리고, 가장 빠른 기록으로 오늘 순위를 매겨요</span></div>
    <div class="row"><span>🏁 '준비' 뒤 <b style="font-weight:normal;color:var(--accent)">GO!</b>가 뜨면 버튼을 눌러 출발</span></div>
    <div class="row"><span>⚠️ GO 전에 누르면 실격</span></div>
    <div class="row"><span>🦘 <b style="font-weight:normal;color:var(--accent)">점프</b> 버튼: 2.5m를 뛰어요 (스페이스·↑)</span></div>
    <div class="row"><span>🛷 <b style="font-weight:normal;color:var(--accent)">슬라이딩</b> 버튼: 몸을 낮춰 미끄러져요 (↓·S)</span></div>
    <div class="row"><span>🚧 허들·바나나·통나무는 뛰어넘기</span></div>
    <div class="row"><span>🚩 높이 걸린 막대는 슬라이딩으로만 지나가요 (점프하면 부딪혀요)</span></div>
    <div class="row"><span>🟤 진흙은 느려져요 · ⚡ 발판은 밟으면 빨라져요</span></div>
    <div class="row"><span>🏅 최고 기록 1위 해 · 2위 달 · 3위 별</span></div>
    <div class="actions"><button class="btn primary" data-close>알겠어요</button></div></div>`;
  dim.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === dim || el.closest('[data-close]')) dim.remove();
  });
  document.getElementById('stage')!.append(dim);
}

// ───────────────────────── 캐릭터 고르기 ─────────────────────────

/** 짧은 화면: 마지막에 고른 캐릭터가 골라진 채, '출발 ▶' 한 번이면 시작 */
export function showPick() {
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>캐릭터</h2><button class="icon-btn" id="settings" aria-label="설정">⚙️</button></div>
    <div class="pick-hero"><img id="pick-img" alt="" /><div class="pick-name" id="pick-name"></div><div class="soft">능력은 모두 같아요 · AI 3명과 달려요</div></div>
    <div class="card"><div class="chars" id="chars"></div><div class="lock-note" id="lock-note"></div></div>
    <div class="grow"></div>
    <button class="btn primary big" id="go">출발 ▶</button>`,
    'pick',
    'lobby',
    () => offUnlock(),
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;

  const paintUnlock = (locked = CHAR_IDS.filter((c) => !isCharOpen(c))) => {
    $('#lock-note').innerHTML = unlockButtonHtml(locked.map((c) => ZODIAC_NICK[c]));
  };
  const paint = () => {
    if (!root.isConnected) return;
    if (!isCharOpen(state.char)) state.char = 'tiger';
    const locked = CHAR_IDS.filter((c) => !isCharOpen(c));
    $('#chars').innerHTML = CHAR_IDS.map((c) => {
      const sel = c === state.char;
      const lock = !sel && locked.includes(c);
      return `<button class="char ${sel ? 'sel' : ''} ${lock ? 'locked' : ''}" data-c="${c}" aria-pressed="${sel}" ${lock ? `title="${UNLOCK_LABEL}" aria-label="${ZODIAC_NICK[c]} (잠김 · ${UNLOCK_LABEL})"` : `aria-label="${ZODIAC_NICK[c]}"`}><img src="${zodiacFaceUrl(c)}" alt="" /><span>${ZODIAC_NICK[c]}</span>${lock ? '<i class="lock" aria-hidden="true">🔒</i>' : ''}</button>`;
    }).join('');
    $<HTMLImageElement>('#pick-img').src = zodiacFullUrl(state.char);
    $('#pick-name').textContent = ZODIAC_NICK[state.char];
    paintUnlock(locked);
  };
  // 잠긴 고양이 아래 '시아코인 100개로 열기' 버튼 (한 번 더 눌러야 산다)
  const unlockHooks = {
    repaint: () => root.isConnected && paintUnlock(),
    toast: (m: string) => toast(m, 2600),
    opened: () => {
      saveChar('cat');
      paint();
    },
  };
  $('#lock-note').addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-unlock]')) return;
    sfx('click');
    void pressUnlock(unlockHooks);
  });
  $('#chars').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.char') as HTMLElement | null;
    if (!b) return;
    const c = b.dataset.c as ZodiacId;
    sfx('click');
    if (!isCharOpen(c)) {
      void pressUnlock(unlockHooks); // 잠긴 칸을 누르면 아래 버튼을 누른 것처럼 (확인 글로 바뀐다)
      return;
    }
    saveChar(c);
    paint();
  });
  $('#back').addEventListener('click', () => {
    sfx('click');
    nav.lobby();
  });
  $('#settings').addEventListener('click', openSettings);
  $('#go').addEventListener('click', () => {
    sfx('toggle');
    saveChar(state.char);
    nav.run();
  });
  // 다른 기기에서 열고 돌아와도 자물쇠를 바로 푼다. 잠긴 동안 구매 조건 진행을 다시 읽는다
  const offUnlock = onUnlockChange(paint);
  paint();
  void refreshProgress();
  void loadEngine();
}

// ───────────────────────── 출발 ─────────────────────────

/**
 * 지금 고른 캐릭터로 오늘의 도전 한 판을 연다: 서버 날짜 → race_go(GO 시각) → 경기 화면.
 * 날짜는 서버(한국 시간)에서만 받는다: 못 받으면 막는다 (날짜가 틀리면 다른 트랙을 달려 기록이 어긋난다).
 */
export async function startRun() {
  const api = state.api;
  if (!api) return nav.lobby();
  let cancelled = false;
  const root = screen(
    `<div class="connecting"><div class="spinner"></div><p>오늘의 트랙을 준비하는 중…</p><button class="btn small" id="cancel">취소</button></div>`,
    'center',
    'lobby',
    () => {
      cancelled = true;
    },
  );
  root.querySelector('#cancel')!.addEventListener('click', () => {
    sfx('click');
    cancelled = true;
    nav.lobby();
  });
  const prev = state.today;
  const day = await fetchToday();
  if (cancelled) return;
  if (!day) {
    toast(`${NO_DAY}. 잠시 후 다시 시도해 주세요`, 3000);
    return nav.lobby();
  }
  if (prev && prev !== day) toast('날짜가 바뀌었어요. 새 오늘의 트랙으로 달려요', 3000);
  state.today = day;
  state.solo ??= new SoloSession(api, state.user);
  try {
    const start = await state.solo.start(state.char, day, () => cancelled);
    if (!start || cancelled) return;
    const m = await loadEngine();
    if (!cancelled) m.showRace(start);
  } catch (e) {
    console.warn('[시아레이스] 판을 열지 못했어요', e);
    if (!cancelled) {
      toast('준비하지 못했어요. 잠시 후 다시 시도해 주세요', 3000);
      nav.lobby();
    }
  }
}
