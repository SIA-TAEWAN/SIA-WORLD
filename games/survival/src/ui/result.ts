import { HELL, RUN_SEC } from '../data/balance';
import { LIMITS, endlessCoinCap, endlessOpen, isEndless, isHell } from '../game/progress';
import { CHARACTER_BY_ID } from '../data/characters';
import { MAPS, MAP_INDEX } from '../data/maps';
import { PASSIVES, PASSIVE_INDEX } from '../data/passives';
import { damageShares, type RunBuild } from '../game/build';
import { LOCAL_MODE } from '../net/api';
import { loadRankGap, type RankGap } from '../net/rank';
import { loadDailyRank } from '../net/daily';
import { dailyScore, dailyWhen } from '../game/daily';
import { startDaily } from './daily';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { icon } from './icons';
import { esc, mmss, nav, screen, state, type GameResult } from './app';
import { sfx } from './sfx';

/** 빌드 요약: 든 무기(레벨·진화)·패시브 아이콘 + 무기별 피해 비율 막대 (많이 준 순) */
function buildHtml(b: RunBuild | undefined): string {
  if (!b || (b.weapons.length === 0 && b.passives.length === 0)) return '';
  const chip = (ic: string, lv: number, name: string, evo = false) =>
    `<span class="own ${evo ? 'evo' : ''}" title="${esc(name)}"><em>${ic}</em><i>${evo ? '★' : lv}</i></span>`;
  const shares = damageShares(b);
  const weapons = shares.length ? [...b.weapons].map((w) => shares.find((s) => s.id === w.id)!).filter(Boolean) : [];
  const passives = b.passives.filter((p) => PASSIVE_INDEX[p.id] !== undefined);
  const bars = shares.some((s) => s.dmg > 0)
    ? `<ul class="dmg-bars">${shares
        .map(
          (s) =>
            `<li class="${s.evolved ? 'evo' : ''}"><em>${icon('w', s.id)}</em><span class="nm">${esc(s.name)}</span>` +
            `<span class="bar"><i style="width:${s.bar}%"></i></span><b>${s.pct}%</b></li>`,
        )
        .join('')}</ul>`
    : '';
  return `<section class="build" aria-label="이번 판 빌드">
       <h3>이번 판 빌드</h3>
       <div class="build-own">
         ${weapons.map((w) => chip(icon('w', w.id), w.lv, w.evolved ? `${w.name} (진화)` : `${w.name} Lv ${w.lv}`, w.evolved)).join('')}
         ${passives.length ? '<span class="sep"></span>' : ''}
         ${passives.map((p) => chip(icon('p', p.id), p.lv, `${PASSIVES[PASSIVE_INDEX[p.id]].name} Lv ${p.lv}`)).join('')}
       </div>
       ${bars}
     </section>`;
}

/** 내 위 한 명과의 차이 한 줄 */
function gapHtml(g: RankGap): string {
  if (g.kind === 'first') return '🏆 이 맵에서 내 최고 기록이 <b>1등</b>이에요!';
  // 내가 상위 목록(100명) 밖이면 바로 위 사람을 모른다: 목록의 마지막 사람(100등)까지의 차이로 적는다
  const head = `🏆 내 최고 기록 ${g.place.toLocaleString()}등 · ${g.out ? `${g.above.toLocaleString()}등 ` : ''}<b>${esc(g.name)}</b>님`;
  if (g.kind === 'time') return `${head}까지 <b>${g.amount >= 60 ? mmss(g.amount) : `${g.amount}초`}</b> 차이`;
  if (g.kind === 'kills') return `${head}까지 처치 <b>${g.amount.toLocaleString()}</b> 차이`;
  if (g.kind === 'clear') return `${head}과 시간이 같아요 · 클리어하면 넘어서요`;
  return `${head}과 같은 기록이에요`;
}

/** 결과 화면: 생존 시간 · 처치 수 · 도달 레벨 · 얻은 엽전 · 새 기록 · 새로 해금된 것 → [다시하기] [강화하러 가기] [메인으로] */
export function showResult(r: GameResult) {
  const map = MAPS[MAP_INDEX[r.map] ?? 0];
  const char = CHARACTER_BY_ID[r.setup.char];
  const endless = isEndless(r);
  const hell = isHell(r);
  // 무한 모드에는 클리어가 없다: 생존 시간 · 처치 수 · 새 기록만 보여 준다
  const title = r.cleared ? (hell ? '헬 클리어!' : '클리어!') : r.quit ? '그만뒀어요' : '게임 오버';
  /** 오늘의 도전 판이면 그 날짜 */
  const daily = r.setup.daily;
  const modeTag = daily ? ' <span class="tag daily">📅 오늘의 도전</span>' : endless ? ' <span class="tag endless">♾️ 무한 모드</span>' : hell ? ' <span class="tag hell">🔥 헬 모드</span>' : '';
  const capped = endless && r.coins >= endlessCoinCap(r.map);
  const root = screen(
    `<div class="result-card ${r.cleared ? 'won' : 'lost'}${hell ? ' hell' : ''}">
       ${hell ? '<div class="embers" id="embers"></div>' : ''}
       <h2>${esc(map.name)} · ${esc(char.nick)}${modeTag}</h2>
       <div class="verdict">${title}</div>
       <img class="result-char" src="${zodiacFullUrl(r.setup.char)}" alt="" />
       <ul class="stats">
         <li><span>⏱️ 생존 시간 <i class="tag new hidden" id="record">새 기록!</i></span><b>${mmss(r.time)}${endless ? '' : `<small> / ${mmss(RUN_SEC)}</small>`}</b></li>
         <li><span>💀 처치 수</span><b>${r.kills.toLocaleString()}</b></li>
         <li><span>⭐ 도달 레벨</span><b>Lv ${r.level}</b></li>
         <li><span>🪙 얻은 엽전${capped ? ' <i class="tag cap">최대</i>' : ''}${hell ? ` <i class="tag x2">×${HELL.coin}</i>` : ''}</span><b class="coin" id="coins">${r.coins.toLocaleString()}닢</b></li>
       </ul>
       <p class="rank-gap hidden" id="gap"></p>
       <div class="unlocks" id="unlocks"></div>
       ${buildHtml(r.build)}
       <p class="soft note" id="note">결과를 저장하는 중…</p>
     </div>
     <div class="actions">
       <button class="btn" id="home">메인으로</button>
       ${daily ? '<button class="btn" id="dailyRank">📅 오늘 순위</button>' : '<button class="btn" id="upgrade">⚒️ 강화하러 가기</button>'}
     </div>
     <button class="btn primary big" id="again">다시하기 ▶</button>
     ${r.cleared ? '<div class="cheer" id="cheer"></div>' : ''}`,
    'result',
    // 클리어 = 승리 곡, 게임 오버 = 패배 곡 (판이 끝날 때 이미 튼 곡이 이어진다). 스스로 그만두면 메인 곡
    r.cleared ? 'win' : r.quit ? 'main' : 'lose',
  );
  // 헬 판: 결과 카드 아래쪽에서 불씨가 올라온다
  const embers = root.querySelector('#embers');
  if (embers) {
    for (let i = 0; i < 14; i++) {
      const e = document.createElement('i');
      e.style.left = `${4 + Math.random() * 92}%`;
      e.style.animationDelay = `${-Math.random() * 4}s`;
      e.style.animationDuration = `${2.6 + Math.random() * 2.4}s`;
      embers.append(e);
    }
  }
  if (r.cleared) {
    // 색종이 (DESIGN.md 8장: 승리 = 별·색종이)
    const cheer = root.querySelector('#cheer')!;
    const colors = ['var(--primary)', 'var(--pink)', 'var(--team-a)', 'var(--win)', 'var(--white)'];
    for (let i = 0; i < 36; i++) {
      const c = document.createElement('i');
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${Math.random() * 1.2}s`;
      cheer.append(c);
    }
  }
  // 서버가 정한 결과가 오면 채운다: 받은 엽전 · 새 기록 · 새로 해금된 것
  const note = root.querySelector('#note') as HTMLElement;
  void r.saved.then((s) => {
    if (!root.isConnected) return;
    // 같은 맵·모드 랭킹에서 내 바로 위 사람과의 차이 (저장이 끝난 뒤의 랭킹으로. 못 읽으면 조용히 숨긴다. 테스트 모드에는 랭킹이 없다)
    if (daily) {
      // 오늘의 도전: 맵별 랭킹 대신 오늘 순위에서 내 자리 (저장이 끝난 뒤의 순위로. 못 읽으면 조용히 숨긴다)
      const el = root.querySelector('#gap') as HTMLElement;
      if (LOCAL_MODE) {
        el.innerHTML = `📅 오늘의 점수 <b>${dailyScore(r).toLocaleString()}</b> · 테스트 모드에는 순위가 없어요`;
        el.classList.remove('hidden');
      } else if (typeof s === 'object') {
        const day = s.daily?.day ?? daily;
        const improved = s.daily?.improved === true;
        void loadDailyRank(day).then((rk) => {
          if (!rk?.mine || !root.isConnected) return;
          const place = `<b>${rk.mine.place.toLocaleString()}위</b> <small>(${rk.total.toLocaleString()}명 도전)</small>`;
          // 기록된 날이 서버의 오늘이 아니면 (자정을 넘겨 끝낸 판) '오늘' 대신 그 날짜로 적는다
          const when = esc(dailyWhen(rk.day, rk.today));
          const best = rk.day === rk.today ? '오늘' : '그날';
          el.innerHTML = improved ? `📅 ${when} ${place}${s.daily?.first ? '' : ` · ${best} 내 최고 기록!`}` : `📅 ${when} 내 최고 기록은 ${place}`;
          el.classList.remove('hidden');
        });
      }
    } else if (!LOCAL_MODE && s !== 'rejected') {
      void loadRankGap(r.map, state.user.id, r.mode ?? 'normal').then((g) => {
        const el = root.querySelector('#gap');
        if (!g || !el || !root.isConnected) return;
        el.innerHTML = gapHtml(g);
        el.classList.remove('hidden');
      });
    }
    if (s === 'unrecorded') note.textContent = '서버에 연결하지 못한 판이라 기록되지 않았어요';
    else if (s === 'pending') note.textContent = '결과를 올리지 못했어요. 다음에 들어올 때 다시 보낼게요';
    else if (s === 'rejected') note.textContent = '이 판의 결과는 받아들여지지 않았어요';
    else {
      root.querySelector('#coins')!.textContent = `+${s.coins.toLocaleString()}닢`;
      note.textContent = !s.valid
        ? '기록이 정상 범위를 벗어나 랭킹에는 오르지 않아요'
        : r.time < LIMITS.count_min_time
          ? daily
            ? s.daily || LOCAL_MODE
              ? `${LIMITS.count_min_time}초를 버티지 못해 엽전은 받지 못했어요 (오늘 순위에는 들어가요)`
              : `${LIMITS.count_min_time}초를 버티지 못해 엽전도 못 받고 오늘 순위에도 들어가지 않았어요`
            : `${LIMITS.count_min_time}초를 버티지 못한 판이라 기록과 엽전에 들어가지 않았어요`
          : s.lowKills
          ? '요괴를 너무 적게 잡은 판이라 기록과 엽전에 들어가지 않았어요'
          : daily
          ? s.daily || LOCAL_MODE
            ? '오늘의 도전 기록은 오늘 순위에만 남아요. 몇 번이든 다시 도전할 수 있어요'
            : '너무 늦게 올라간 판이라 오늘 순위에는 들어가지 않았어요'
          : capped
          ? `무한 모드는 한 판에 ${endlessCoinCap(r.map).toLocaleString()}닢까지 받아요`
          : hell
            ? `헬 모드는 엽전을 ${HELL.coin}배로 받아요`
            : '엽전으로 메인의 [강화]에서 더 강해질 수 있어요';
      if (s.newRecord) {
        root.querySelector('#record')!.classList.remove('hidden');
        sfx('newRecord');
      }
      const lines = [
        ...s.unlockedCharacters.map((c) => `<p><img src="${zodiacFaceUrl(c)}" alt="" />🔓 <b>${esc(CHARACTER_BY_ID[c].nick)}</b> 해금!</p>`),
        ...s.unlockedMaps.map((m) => `<p>🗺️ 새 맵 <b>${esc(MAPS[MAP_INDEX[m] ?? 0].name)}</b> 해금!</p>`),
      ];
      // 이 맵을 4분 모드로 처음 클리어했다: 헬 모드와 무한 모드가 열렸다 (프로필은 저장 답으로 이미 새 값이다)
      if (r.cleared && !endless && !hell && !r.endlessWasOpen && endlessOpen(state.profile, r.map)) {
        lines.push(`<p class="hell-open">🔥 <b>${esc(map.name)}</b>의 헬 모드가 열렸어요!</p>`);
        lines.push(`<p>♾️ <b>${esc(map.name)}</b>의 무한 모드가 열렸어요!</p>`);
      }
      root.querySelector('#unlocks')!.innerHTML = lines.join('');
    }
  });
  root.querySelector('#again')!.addEventListener('click', () => {
    sfx('click');
    // 같은 캐릭터·맵·모드로 새 판 (개발용 설정도 그대로, 시드만 새로)
    // 오늘의 도전은 같은 조건(시드도 같다)으로. 자정이 지났으면 새 날의 도전 화면으로 간다
    if (daily) return void startDaily(daily);
    nav.game({ ...r.setup, seed: undefined });
  });
  root.querySelector('#upgrade')?.addEventListener('click', () => {
    sfx('click');
    nav.upgrade();
  });
  root.querySelector('#dailyRank')?.addEventListener('click', () => {
    sfx('click');
    nav.daily();
  });
  root.querySelector('#home')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
}
