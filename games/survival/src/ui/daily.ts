import { RUN_SEC } from '../data/balance';
import { CHARACTER_BY_ID } from '../data/characters';
import { MAPS, MAP_INDEX } from '../data/maps';
import { WEAPONS } from '../data/weapons';
import { dayText, type DailyChallenge, type DailyRanking, type DailyRow } from '../game/daily';
import { startWeapon } from '../game/sim';
import { LOCAL_MODE } from '../net/api';
import { loadDailyChallenge, loadDailyRank } from '../net/daily';
import { zodiacFaceUrl } from '../assets';
import { esc, loadEngine, mmss, nav, screen, state, toast } from './app';
import { sfx } from './sfx';

/** 오늘의 조건으로 판을 시작한다 (판은 4분 모드로 돌고, 서버에는 오늘의 도전으로 알린다) */
function play(c: DailyChallenge) {
  nav.game({ char: c.char, map: c.map, mode: 'normal', seed: c.seed, upg: c.upg, daily: c.day });
}

/**
 * 오늘의 도전을 바로 시작한다 (결과 화면의 [다시하기]). 날짜를 다시 물어, 자정이 지났으면 새 날의 조건으로 간다.
 * prev: 방금 한 판의 날짜. 날짜가 바뀌었으면 조건이 달라졌으니 오늘의 도전 화면으로 보낸다 (그 판은 시작하지 않는다).
 * 날짜는 서버에서만 받는다 (net/daily.ts): 못 받았으면 시작하지 않는다
 */
export async function startDaily(prev?: string, still: () => boolean = () => true) {
  const c = await loadDailyChallenge();
  if (!still()) return;
  if (!c) return toast('오늘 날짜를 받지 못했어요. 잠시 뒤에 다시 해 주세요', 3000);
  if (prev && prev !== c.day) {
    toast('날짜가 바뀌었어요. 새 도전을 확인해 주세요', 3000);
    return showDaily();
  }
  play(c);
}

/** 순위 한 줄 */
function rowHtml(r: DailyRow | { place: number; nickname: string; time: number; kills: number; cleared: boolean; me: true }): string {
  const medal = r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : String(r.place);
  return `<li class="${r.me ? 'me' : ''}"><i>${medal}</i><span>${esc(r.nickname)}</span>${r.cleared ? '<em class="tag">클리어</em>' : ''}<b>${mmss(r.time)}</b><small>💀 ${r.kills.toLocaleString()}</small></li>`;
}

function rankHtml(rk: DailyRanking, myName: string): string {
  if (rk.top.length === 0) return '<p class="soft empty">아직 기록이 없어요. 첫 기록을 남겨 보세요!</p>';
  const inTop = rk.top.some((r) => r.me);
  // 내가 상위 목록 밖이면 맨 아래에 내 줄을 따로 붙인다
  const mine = !inTop && rk.mine ? `<li class="gap" aria-hidden="true">⋯</li>${rowHtml({ ...rk.mine, nickname: myName, me: true })}` : '';
  return `<ol class="daily-rows">${rk.top.map(rowHtml).join('')}${mine}</ol>`;
}

/** 오늘의 도전 화면: 오늘의 조건 · 오늘 순위(상위 + 내 순위) · [도전 ▶] */
export function showDaily() {
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>오늘의 도전</h2><span class="spacer"></span></div>
     <div class="card daily-cond" id="cond"><p class="soft">오늘의 도전을 불러오는 중…</p></div>
     <div class="card daily-rank hidden" id="rank"></div>
     <div class="grow"></div>
     <button class="btn primary big" id="go" disabled>도전 ▶</button>`,
    'daily',
    'main',
  );
  let now: DailyChallenge | null = null;
  let busy = false;
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
  const go = root.querySelector('#go') as HTMLButtonElement;
  go.addEventListener('click', async () => {
    if (!now || busy) return;
    busy = true;
    sfx('click');
    // 화면을 켜 둔 채 자정이 지났을 수 있다: 날짜를 다시 물어 바뀌었으면 새 조건을 보여 준다
    const c = await loadDailyChallenge();
    busy = false;
    if (!root.isConnected) return;
    if (!c) return toast('오늘 날짜를 받지 못했어요. 잠시 뒤에 다시 해 주세요', 3000);
    if (c.day !== now.day) {
      toast('날짜가 바뀌었어요. 새 도전을 확인해 주세요', 3000);
      return paint(c);
    }
    play(c);
  });

  function paint(c: DailyChallenge) {
    now = c;
    const map = MAPS[MAP_INDEX[c.map] ?? 0];
    const ch = CHARACTER_BY_ID[c.char];
    const weapon = WEAPONS[startWeapon(c.char)];
    root.querySelector('#cond')!.innerHTML = `<div class="daily-head">
         <img src="${zodiacFaceUrl(c.char)}" alt="" />
         <div><span class="tag">${esc(dayText(c.day))}</span>
           <h3>${esc(map.name)} · ${esc(ch.nick)}</h3>
           <p class="soft">${esc(map.level)} · 시작 무기 ${esc(weapon.name)} · 강화 ${c.upg}단계</p></div>
       </div>
       <ul class="daily-rules">
         <li>모두 같은 맵·캐릭터·요괴 순서 · 강화 ${c.upg}단계</li>
         <li>${mmss(RUN_SEC)}까지 오래 버틴 순 → 보스 처치 → 처치 수</li>
         <li>몇 번이든 도전! 가장 좋은 기록이 남아요</li>
       </ul>`;
    go.disabled = false;
    const box = root.querySelector('#rank') as HTMLElement;
    box.classList.add('hidden');
    // 테스트 모드에는 순위가 없다. 못 읽으면 조용히 숨긴다
    if (LOCAL_MODE) return;
    void loadDailyRank(c.day).then((rk) => {
      if (!rk || !root.isConnected || now?.day !== c.day) return;
      const head = rk.mine ? `내 순위 <b>${rk.mine.place.toLocaleString()}위</b> · ${rk.total.toLocaleString()}명 도전` : `${rk.total.toLocaleString()}명 도전`;
      box.innerHTML = `<h3>🏆 오늘 순위 <small>${rk.total > 0 ? head : ''}</small></h3>${rankHtml(rk, state.user.name)}`;
      box.classList.remove('hidden');
    });
  }

  void loadDailyChallenge().then((c) => {
    if (!root.isConnected) return;
    if (!c) {
      root.querySelector('#cond')!.innerHTML = '<p class="soft">오늘 날짜를 받지 못했어요.<br/>잠시 뒤에 다시 들어와 주세요</p>';
      return;
    }
    paint(c);
  });
  void loadEngine();
}
