import { EMOTE_SHOW_MS } from '../game/emote';
import { formatTime, tierOf, type RankedEntry } from '../game/ranking';
import { seriesKey, standings } from '../game/series';
import { LOCAL_MODE } from '../net/api';
import { LOCKED_MSG } from '../game/unlock';
import { loadRankIcons, worldDailyRanking } from '../net/world';
import { DAILY_GAME, dailyLabel, dailyMs } from '../game/daily';
import type { RaceGame } from '../race/game';
import { zodiacFaceUrl } from '../assets';
import { esc, leaveRoom, nav, screen, state, toast } from './app';
import { emoteBarHtml, wireEmoteBar } from './emote';
import { showRanking } from './menus';
import { sfx } from './sfx';

/** 결과 화면: 1~4등, 기록, 연속전 누적 점수, 개인 최고 기록 갱신 여부, 짧은 말, '한 판 더' · '나가기' */
export function showResult(race: RaceGame, results: RankedEntry[]) {
  const me = race.mySlot;
  const mine = results.find((r) => r.slot === me);
  const raced = mine && !race.taken[me];
  // 오늘의 도전: 혼자 달리는 전용 방이라 연속전 점수·짧은 말은 보이지 않는다
  const daily = state.daily;
  const room = daily ? null : state.room;
  let offRoom: (() => void) | null = null;
  let offEmote: (() => void) | null = null;
  // 배지: 이번 판에 내가 한 일 (무결점 완주·칼출발·부스트 싹쓸이 …). 실격·AI가 이어 달린 판에는 없다
  const badges = raced && mine.status !== 'foul' ? race.badges(mine.status === 'finish') : [];
  const root = screen(
    `<div class="result-card">
      <h2>🏁 경기 결과 <span class="tag hidden" id="gp-n"></span></h2>
      <p class="mine" id="mine">${
        !mine
          ? ''
          : !raced
            ? '<span class="soft">연결이 끊겨 AI가 이어 달렸어요</span>'
            : mine.status === 'finish'
              ? `내 기록 <b>${formatTime(mine.timeMs!)}</b>초 <span id="rec"></span>`
              : mine.status === 'foul'
                ? '실격! GO가 뜬 뒤에 눌러요'
                : `미완주 (${Math.floor(mine.x)}m)`
      }</p>
      ${
        badges.length
          ? `<ul class="badges" aria-label="이번 판 배지">${badges.map((b, i) => `<li class="badge" role="button" tabindex="0" data-desc="${esc(`${b.label}: ${b.desc}`)}" title="${esc(b.desc)}" style="animation-delay:${500 + i * 160}ms"><i aria-hidden="true">${b.icon}</i>${esc(b.label)}</li>`).join('')}</ul>`
          : ''
      }
      ${daily ? '<p class="daily-line" id="daily-line"><span class="tag">오늘의 도전</span> <span id="daily-place"></span></p>' : ''}
      <div class="rows">${results
        .map((r, i) => {
          const p = race.roster[r.slot];
          const isMe = r.slot === me;
          const tm =
            r.status === 'finish'
              ? `<span class="tm">${formatTime(r.timeMs!)}초</span>`
              : r.status === 'foul'
                ? '<span class="tm foul">실격</span>'
                : `<span class="tm dnf">미완주 ${Math.floor(r.x)}m</span>`;
          // 이름 아래 작은 글: AI가 이어 달렸는지 + 연속전 점수 (paintGp 가 채운다)
          const sub = `<small data-k="${esc(seriesKey(p))}" data-pre="${p.id && race.taken[r.slot] ? 'AI가 이어 달림' : ''}"></small>`;
          return `<div class="rrow p${r.place} ${isMe ? 'me' : ''}" data-id="${esc(p.id ?? '')}" style="animation-delay:${200 + i * 260}ms"><span class="pl">${r.place}</span>
            <img class="av" src="${zodiacFaceUrl(p.char)}" alt="" /><span class="body"><span class="top"><span class="nm">${esc(p.name)}</span>${tm}</span>${sub}</span>${
              r.status === 'finish' ? `<span class="tier" data-ms="${r.timeMs}"></span>` : ''
            }</div>`;
        })
        .join('')}</div>
      ${room && me >= 0 ? emoteBarHtml(false) : ''}
      <div class="actions"><button class="btn" id="exit">나가기</button><button class="btn primary" id="again">${daily ? '다시 도전 ▶' : '한 판 더 ▶'}</button></div>
      <div class="sub"><button class="btn small" id="rank">🏆 랭킹</button></div>
    </div><div class="cheer" id="cheer"></div>`,
    'result',
    'result',
    () => {
      offRoom?.();
      offEmote?.();
    },
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;

  // 배지를 누르면 무엇을 해서 받았는지 알려 준다 (터치 기기에서는 title 이 보이지 않는다)
  root.querySelectorAll<HTMLElement>('.badge[data-desc]').forEach((el) => {
    const say = () => toast(el.dataset.desc ?? '');
    el.addEventListener('click', say);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        say();
      }
    });
  });

  // 연속전 점수: 이번 판에 얻은 점수와 누적 점수·순위 (방장이 보낸 점수판이 늦게 오면 다시 그린다)
  const paintGp = () => {
    const series = room?.series;
    // 지금 자리에 있는 사람·AI 와 이번 판을 달린 줄만 골라 그 안에서 순위를 매긴다 (예전에 나간 사람 줄은 세지 않는다)
    const table = series && room ? standings(series, [...room.seats().map(seriesKey), ...race.roster.map(seriesKey)]) : [];
    // 이번 판이 점수판에 들어가 있을 때만 '+점수'를 보인다
    const fresh = !!series && series.done[series.done.length - 1] === race.key;
    root.querySelectorAll<HTMLElement>('.rrow small[data-k]').forEach((el) => {
      const st = table.find((t) => t.k === el.dataset.k);
      const parts = [el.dataset.pre ?? ''];
      if (st) parts.push(`누적 ${st.pts}점 · ${st.rank}위${fresh ? ` (+${st.add})` : ''}`);
      el.textContent = parts.filter(Boolean).join(' · ');
      el.classList.toggle('hidden', !el.textContent);
    });
    const tag = $('#gp-n');
    tag.classList.toggle('hidden', !series || series.n < 1);
    if (series) tag.textContent = `연속전 ${series.n}판째`;
  };
  paintGp();
  if (room) {
    offRoom = room.onChange(paintGp);
    // 짧은 말: 보낸 사람 줄 옆에 2.5초
    offEmote = wireEmoteBar(root, room, (id, text) => {
      const row = [...root.querySelectorAll<HTMLElement>('.rrow')].find((el) => el.dataset.id === id);
      if (!row) return;
      row.querySelector('.emo-pop')?.remove();
      const pop = document.createElement('span');
      pop.className = 'emo-pop';
      pop.textContent = text;
      row.append(pop);
      setTimeout(() => pop.remove(), EMOTE_SHOW_MS);
    });
  }

  // 순위 발표 소리 (한 줄씩)
  results.forEach((_, i) => sfx('rankShow', { delay: 200 + i * 260, rate: 1.3 - i * 0.1 }));

  // 등급 아이콘 (해·달·별·구름)
  void loadRankIcons().then(
    (m) => root.querySelectorAll<HTMLElement>('.tier').forEach((el) => (el.innerHTML = m.tierSvg(tierOf(Number(el.dataset.ms)), 26))),
    () => undefined,
  );

  // 개인 최고 기록 갱신 여부 (서버에 올린 결과)
  if (raced && mine.status === 'finish' && race.record) {
    void race.record.then((rec) => {
      state.best = rec.bestMs;
      const el = root.querySelector('#rec');
      if (!el) return;
      if (rec.improved) {
        el.innerHTML = '<span class="newrec">🎉 개인 최고 기록!</span>';
        sfx('newRecord', { delay: 900 });
        confetti($('#cheer'));
      } else el.innerHTML = `<span class="soft">최고 ${formatTime(rec.bestMs)}초</span>`;
      if (!rec.saved && !LOCAL_MODE) el.insertAdjacentHTML('beforeend', `<br/><span class="soft">${rec.locked ? LOCKED_MSG : '서버에 기록을 올리지 못했어요'}</span>`);
    });
  }

  // 오늘의 도전: 그날 기록에 넣은 뒤 오늘 순위를 보인다 (못 넣었거나 못 읽으면 줄을 숨긴다)
  if (daily) {
    const line = $('#daily-line');
    const place = $('#daily-place');
    const hide = () => line.classList.add('hidden');
    if (!raced || mine.status !== 'finish') place.innerHTML = '<span class="soft">완주해야 오늘 기록이 남아요</span>';
    else if (LOCAL_MODE) place.innerHTML = '<span class="soft">테스트 모드에서는 순위가 남지 않아요</span>';
    else if (!race.dailySaved) hide();
    else {
      place.innerHTML = '<span class="soft">순위를 확인하는 중…</span>';
      void race.dailySaved
        .then(async (day) => {
          if (!day) {
            // 통신 실패(다시 해 봐도 안 됨)거나 서버가 받지 않았다
            place.innerHTML = '<span class="soft">오늘 기록을 올리지 못했어요</span>';
            return;
          }
          const r = await worldDailyRanking(DAILY_GAME, day);
          const ms = dailyMs(r?.mine);
          if (!r || !r.mine || ms === null) return hide();
          // 기록된 날이 서버의 오늘이 아니면(자정을 넘겨 도착) '오늘' 대신 날짜로
          const past = r.today !== day;
          const when = past ? dailyLabel(day) : '오늘';
          place.innerHTML = `${when} <b>${Number(r.mine.place) || '-'}위</b> <span class="soft">· ${past ? '그날' : '오늘'} 최고 ${formatTime(ms)}초 · ${Number(r.total) || 1}명 중</span>`;
        })
        .catch(hide);
    }
  }

  $('#again').addEventListener('click', () => {
    sfx('click');
    if (daily) {
      leaveRoom();
      nav.daily();
    } else if (state.room) nav.waiting();
    else nav.lobby();
  });
  $('#exit').addEventListener('click', () => {
    sfx('click');
    leaveRoom();
    nav.lobby();
  });
  $('#rank').addEventListener('click', () => void showRanking());
}

/** 색종이 (DESIGN.md: 승리 = 별·색종이) */
function confetti(box: HTMLElement) {
  const cols = ['var(--primary)', 'var(--pink)', 'var(--team-a)', 'var(--win)', 'var(--white)'];
  for (let i = 0; i < 36; i++) {
    const el = document.createElement('i');
    el.style.left = `${Math.random() * 100}%`;
    el.style.background = cols[i % cols.length];
    el.style.animationDelay = `${0.9 + Math.random() * 0.8}s`;
    el.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
    box.append(el);
  }
}
