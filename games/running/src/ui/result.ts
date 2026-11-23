import { formatTime, tierOfPlace, type RankedEntry } from '../game/ranking';
import { LOCAL_MODE } from '../net/api';
import { LOCKED_MSG } from '../game/unlock';
import { loadRankIcons, worldDailyRanking } from '../net/world';
import { DAILY_GAME, dailyLabel, dailyMs } from '../game/daily';
import { ghostDiffText } from '../game/ghost';
import { reactionLine, saveBestReaction } from '../game/reaction';
import type { RaceGame } from '../race/game';
import { zodiacFaceUrl } from '../assets';
import { esc, nav, screen, state, toast } from './app';
import { showRanking } from './menus';
import { sfx } from './sfx';

/** 결과 화면: 오늘 내 순위(크게), 1~4등, 기록, 개인 최고 기록 갱신 여부, '다시 도전'(바로 다음 판) · '나가기' */
export function showResult(race: RaceGame, results: RankedEntry[]) {
  const me = race.mySlot;
  const mine = results.find((r) => r.slot === me);
  const raced = mine !== undefined;
  // 배지: 이번 판에 내가 한 일 (무결점 완주·부스트 싹쓸이·오뚝이). 실격한 판에는 없다
  const badges = raced && mine.status !== 'foul' ? race.badges(mine.status === 'finish') : [];
  // 고스트와 비교: "1위보다 0.42초 빨랐어요! 🎉" / "1위까지 0.42초" (내 1위 기록의 고스트면 '내 1위 기록')
  const gh = race.ghost;
  const ghostWho = gh ? (gh.me ? '내 1위 기록' : `${gh.dayPlace}위`) : '';
  // 이겼는지도 화면에 보이는 0.01초 기록끼리 (문구가 '똑같아요'인데 이긴 색이 되지 않게)
  const beatGhost = !!gh && mine?.status === 'finish' && Math.floor(mine.timeMs! / 10) < Math.floor(gh.ghost.ms / 10);
  const ghostLine =
    gh && mine?.status === 'finish'
      ? `<p class="ghost-diff ${beatGhost ? 'win' : ''}">👻 ${esc(ghostDiffText(mine.timeMs!, gh.ghost.ms, ghostWho, formatTime))}</p>`
      : '';
  // 출발 반응: 실격한 판에는 없다. 최고 반응(기기 저장, 운으로 본 0.10초 미만은 빼고)을 갱신했으면 '⚡ 반응 신기록'
  const react = raced && mine.status !== 'foul' ? race.reaction() : null;
  const reactBest = react ? saveBestReaction(state.user.id, react) : false;
  const reactHtml = react
    ? `<p class="react-line g-${react.grade.toLowerCase()}">${esc(reactionLine(react))}${reactBest ? ' <span class="react-rec">⚡ 반응 신기록</span>' : ''}</p>`
    : '';
  const root = screen(
    `<div class="result-card">
      <h2>🏁 경기 결과</h2>
      <div class="daily-line" id="daily-line"><span class="tag">오늘의 도전</span><div id="daily-place"></div><div class="week-up" id="week-up" hidden></div></div>
      <p class="mine" id="mine">${
        !mine
          ? ''
          : mine.status === 'finish'
              ? `내 기록 <b>${formatTime(mine.timeMs!)}</b>초 <span id="rec"></span>`
              : mine.status === 'foul'
                ? '실격! GO가 뜬 뒤에 눌러요'
                : `미완주 (${Math.floor(mine.x)}m)`
      }</p>
      ${reactHtml}
      ${ghostLine}
      ${
        badges.length
          ? `<ul class="badges" aria-label="이번 판 배지">${badges.map((b, i) => `<li class="badge" role="button" tabindex="0" data-desc="${esc(`${b.label}: ${b.desc}`)}" title="${esc(b.desc)}" style="animation-delay:${500 + i * 160}ms"><i aria-hidden="true">${b.icon}</i>${esc(b.label)}</li>`).join('')}</ul>`
          : ''
      }
      <div class="rows">${results
        .map((r, i) => {
          const p = race.roster[r.slot];
          const isMe = r.slot === me;
          const isGhost = p.role === 'ghost' && !!gh;
          const tm =
            r.status === 'finish'
              ? `<span class="tm">${formatTime(r.timeMs!)}초</span>`
              : r.status === 'foul'
                ? '<span class="tm foul">실격</span>'
                : `<span class="tm dnf">미완주 ${Math.floor(r.x)}m</span>`;
          return `<div class="rrow p${r.place} ${isMe ? 'me' : ''} ${isGhost ? 'ghost' : ''}" data-id="${esc(p.id ?? '')}" style="animation-delay:${200 + i * 260}ms"><span class="pl">${r.place}</span>
            <img class="av" src="${zodiacFaceUrl(p.char)}" alt="" /><span class="body"><span class="top"><span class="nm">${esc(isGhost ? gh!.nickname : p.name)}</span>${tm}</span>${
              isGhost ? `<small>👻 ${gh!.me ? '내 1위 기록' : `오늘 ${gh!.dayPlace}위`} 고스트</small>` : ''
            }</span>${
              isMe ? `<span class="tier" data-uid="${esc(p.id ?? '')}"></span>` : isGhost ? `<span class="tier" data-place="${gh!.place ?? 0}"></span>` : ''
            }</div>`;
        })
        .join('')}</div>
      <div class="actions"><button class="btn" id="exit">나가기</button><button class="btn primary" id="again">다시 도전 ▶</button></div>
      <div class="sub"><button class="btn small" id="rank">🏆 랭킹</button></div>
    </div><div class="cheer" id="cheer"></div>`,
    'result',
    'result',
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

  // 순위 발표 소리 (한 줄씩)
  results.forEach((_, i) => sfx('rankShow', { delay: 200 + i * 260, rate: 1.3 - i * 0.1 }));

  // 등급 아이콘 (해·달·별·구름): 내 줄에만, 내 역대 최고 기록 순위로 (1위 해 · 2위 달 · 3위 별 · 그 밖과 순위 없음은 구름).
  // AI 줄에는 없다. 이번 판으로 순위가 바뀌었을 수 있으니 내 기록이 서버에 올라간 뒤(race_submit) 다시 읽는다. 못 읽으면 구름
  // 고스트 줄: 그 사람의 역대 최고 기록 순위 (race_ghost_top 이 준 place) 그대로
  const paintTiers = async () => {
    const icons = await loadRankIcons();
    root.querySelectorAll<HTMLElement>('.tier[data-place]').forEach((el) => (el.innerHTML = icons.tierSvg(tierOfPlace(Number(el.dataset.place) || null), 26)));
    const els = [...root.querySelectorAll<HTMLElement>('.tier[data-uid]')];
    if (!els.length) return;
    await race.record?.catch(() => null);
    const places = (await state.api?.places(els.map((el) => el.dataset.uid ?? '')).catch(() => null)) ?? {};
    const myId = state.user.id;
    if (me >= 0 && race.roster[me]?.id === myId) state.place = places[myId] ?? null;
    els.forEach((el) => (el.innerHTML = icons.tierSvg(tierOfPlace(places[el.dataset.uid ?? '']), 26)));
  };
  void paintTiers().catch(() => undefined);

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
  {
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
          place.innerHTML = `<div class="dp-big">${when} <b>${Number(r.mine.place) || '-'}</b>위</div><div class="soft">${past ? '그날' : '오늘'} 내 최고 ${formatTime(ms)}초 · ${Number(r.total) || 1}명 중</div>`;
          // 고스트(다른 사람)를 이기고 서버 그날 순위가 1위가 됐으면: 👑 오늘의 1위!
          if (beatGhost && !gh!.me && !past && Number(r.mine.place) === 1) crownCut(root);
        })
        .catch(hide);
    }
  }

  // 이번 주 순위: 판 전(경기 화면이 읽어 둔 것)과 오늘 기록이 들어간 뒤를 비교해 오르면 '이번 주 12위 ↑'. 못 읽으면 조용히 숨김
  if (!LOCAL_MODE && raced && mine.status === 'finish' && race.dailySaved && race.weekBefore && state.api) {
    const api = state.api;
    const before = race.weekBefore;
    void race.dailySaved
      .then(async (day) => {
        if (!day) return;
        const [b, a] = await Promise.all([before, api.weeklyPlace()]);
        if (b === undefined || a === undefined || a === null || (b !== null && a >= b)) return;
        const el = root.querySelector<HTMLElement>('#week-up');
        if (!el) return;
        el.innerHTML = `📈 이번 주 <b>${a}</b>위 ↑`;
        el.hidden = false;
      })
      .catch(() => undefined);
  }

  $('#again').addEventListener('click', () => {
    sfx('click');
    // 캐릭터를 다시 고르지 않고 바로 다음 판. 1위가 바뀌었을 수 있으니 고스트는 새로 읽는다
    state.ghostLoad = null;
    state.ghostAfter = race.ghostSaved;
    nav.run();
  });
  $('#exit').addEventListener('click', () => {
    sfx('click');
    state.ghostAfter = race.ghostSaved;
    nav.lobby();
  });
  $('#rank').addEventListener('click', () => void showRanking());
}

/** 👑 오늘의 1위! (고스트를 이기고 서버 그날 순위 1위를 확인한 뒤) */
function crownCut(root: HTMLElement) {
  // 제목 자리를 바꾼다 (낮은 화면에서도 카드 높이가 늘지 않게)
  const h2 = root.querySelector('.result-card h2');
  if (!h2 || h2.classList.contains('crown-cut')) return;
  h2.classList.add('crown-cut');
  h2.innerHTML = '<span aria-hidden="true">👑</span> 오늘의 1위!';
  sfx('newRecord');
  confetti(root.querySelector('#cheer') as HTMLElement);
  toast('👑 오늘의 1위가 되었어요! 다음 판부터 내 고스트가 달려요', 3200);
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
