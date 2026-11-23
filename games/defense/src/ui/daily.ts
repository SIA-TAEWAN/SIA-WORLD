import { BOSSES, BOSS_INDEX } from '../data/bosses';
import { regionOf } from '../data/regions';
import { stageOf } from '../data/stages';
import { DAILY_GAME, dailyChallenge, dailyDetailText, localDailyDay, type DailyChallenge } from '../game/daily';
import { LOCAL_MODE } from '../net/api';
import { loadDaily, type DailyRanking } from '../net/world';
import { esc, loadEngine, nav, screen, toast } from './app';
import { stageThumb } from './menus';
import { sfx } from './sfx';

/**
 * 오늘의 고개 (오늘의 도전): 날짜로 정해진 스테이지 하나와 조건 하나를 모두가 똑같이 하고, 그날 기록만 따로 순위를 매긴다.
 * 날짜는 서버(한국 시간)에서 받고, 스테이지·조건·시드는 날짜 문자열에서 만든다 (game/daily.ts).
 * 기록이 서버로 가는 판이므로 날짜는 서버에서 받은 것만 쓴다 (dailyTodayStrict). 못 받으면 "오늘 날짜를 받지 못했어요" 로 시작을 막는다.
 * 테스트 모드(?local=1)는 서버 없이 조건만으로 플레이한다 (&day=2026-11-23 으로 다른 날을 볼 수 있다)
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const NO_DAY_TEXT = '오늘 날짜를 받지 못했어요';
export const DAY_CHANGED_TEXT = '날짜가 바뀌었어요. 오늘의 고개를 다시 불러올게요';

/** 'YYYY-MM-DD' → '11월 22일' (모양이 틀리면 그대로) */
export function dayLabel(day: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : day;
}

/**
 * 오늘의 날짜와 조건 (+ 순위를 읽을 공용 모듈).
 * 서버에서 날짜를 받지 못하면 ch 가 null 이다 (기기 시계로 대신하지 않는다: 틀린 날짜로 기록이 올라가지 않게).
 * 테스트 모드(?local=1)만 기기 시계를 쓴다
 */
export async function todayChallenge(): Promise<{ ch: DailyChallenge | null; mod: Awaited<ReturnType<typeof loadDaily>> }> {
  if (LOCAL_MODE) {
    const want = new URLSearchParams(location.search).get('day') ?? '';
    return { ch: dailyChallenge(DAY_RE.test(want) ? want : localDailyDay()), mod: null };
  }
  const mod = await loadDaily();
  let day: string | null = null;
  try {
    day = mod ? await mod.dailyTodayStrict() : null;
  } catch {
    day = null;
  }
  if (!day || !DAY_RE.test(day)) return { ch: null, mod };
  return { ch: dailyChallenge(day, mod?.dailySeed), mod };
}

/** 순위표 (상위 + 내 순위). 아무도 없으면 안내 한 줄 */
function rankingHtml(r: DailyRanking): string {
  if (!r.top.length) return '<p class="soft center">아직 아무도 도전하지 않았어요. 첫 기록을 남겨 보세요!</p>';
  const row = (place: number, name: string, score: number, detail: unknown, me: boolean) =>
    `<li class="${me ? 'me' : ''}"><i>${place}</i><b>${esc(name)}</b><span>${esc(dailyDetailText(detail, score))}</span></li>`;
  const inTop = r.top.some((t) => t.me);
  return `<ol class="drank">${r.top.map((t) => row(t.place, t.nickname, t.score, t.detail, t.me)).join('')}${
    r.mine && !inTop ? row(r.mine.place, '나', r.mine.score, r.mine.detail, true) : ''
  }</ol>`;
}

export function showDaily() {
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>오늘의 고개</h2><span class="spacer"></span></div>
     <div class="scroll">
       <div class="card" id="dcard"><p class="soft center">오늘의 고개를 살펴보는 중…</p></div>
       <div class="card hidden" id="drankCard"><h3>오늘 순위 <small id="dtotal"></small></h3><div id="drank"></div></div>
     </div>
     <button class="btn primary big" id="start" disabled>도전 준비 ▶</button>`,
    'select prepare daily',
  );
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
  const startBtn = root.querySelector('#start') as HTMLButtonElement;
  void (async () => {
    const { ch, mod } = await todayChallenge();
    if (!root.isConnected) return;
    if (!ch) {
      // 날짜를 받지 못했다: 시작을 막고, 같은 버튼으로 다시 받아 본다
      root.querySelector('#dcard')!.innerHTML = `<p class="soft center">${NO_DAY_TEXT}<br/>연결을 확인하고 다시 시도해 주세요</p>`;
      startBtn.textContent = '다시 시도';
      startBtn.disabled = false;
      startBtn.addEventListener('click', () => {
        sfx('click');
        nav.daily();
      });
      return;
    }
    const st = stageOf(ch.stage);
    if (!st) {
      root.querySelector('#dcard')!.innerHTML = '<p class="soft center">오늘의 고개를 불러오지 못했어요</p>';
      return;
    }
    const region = regionOf(st.region);
    const boss = st.boss ? BOSSES[BOSS_INDEX[st.boss.id]] : null;
    const card = root.querySelector('#dcard') as HTMLElement;
    card.className = `card prep-stage bg-${region?.bg ?? 'field'}`;
    card.innerHTML = `${stageThumb(st)}
      <div class="prep-tx">
        <p class="soft">${esc(ch.day)}${region ? ` · ${esc(region.name)}` : ''}</p>
        <h3>${esc(st.id)} ${esc(st.name)}</h3>
        <p><span class="tag">📅 ${esc(ch.title)}</span></p>
        <p>${esc(ch.desc)}</p>
        <p class="soft">30초 웨이브 6개 · 3분${boss ? ` · 2분에 보스 ${esc(boss.name)}` : ''}<br/>몇 번이든 도전할 수 있고, 가장 좋은 기록이 남아요</p>
      </div>`;
    startBtn.disabled = false;
    let checking = false;
    startBtn.addEventListener('click', () => {
      sfx('click');
      if (checking) return;
      checking = true;
      // 누를 때 날짜를 다시 받는다: 화면에 그린 날짜와 다르면(자정을 넘긴 화면) 새 날짜로 다시 그린다
      void todayChallenge().then(({ ch: now }) => {
        checking = false;
        if (!root.isConnected) return;
        if (!now) toast(NO_DAY_TEXT, 3200);
        else if (now.day !== ch.day) {
          toast(DAY_CHANGED_TEXT, 3200);
          nav.daily();
        } else nav.prepare(st.id, ch);
      });
    });
    void loadEngine();
    // 오늘 순위: 못 읽으면 칸을 그대로 숨겨 둔다
    const rankCard = root.querySelector('#drankCard') as HTMLElement;
    if (LOCAL_MODE) {
      rankCard.classList.remove('hidden');
      root.querySelector('#drank')!.innerHTML = '<p class="soft center">테스트 모드에서는 순위를 기록하지 않아요</p>';
      return;
    }
    const r = mod ? await mod.loadDailyRanking(DAILY_GAME, ch.day).catch(() => null) : null;
    if (!r || !Array.isArray(r.top) || !root.isConnected) return;
    rankCard.classList.remove('hidden');
    root.querySelector('#dtotal')!.textContent = r.total > 0 ? `${r.total}명 도전${r.mine ? ` · 나는 ${r.mine.place}위` : ''}` : '';
    root.querySelector('#drank')!.innerHTML = rankingHtml(r);
  })();
}
