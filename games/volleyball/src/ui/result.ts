import type { MatchResult, RecordOutcome } from '../match/game';
import { zodiacFaceUrl } from '../assets';
import { esc, leaveRoom, nav, screen, state } from './app';
import { aiSetup } from './menus';
import { sfx } from './sfx';
import { outcomeText } from '../net/aiRecord';

/**
 * 결과 화면: 승/패, 점수, [다시하기] · [로비로].
 * - AI전은 'AI 대전'으로 표시하고 전적 반영 결과를 한 줄로 알린다. 다시하기를 누르면 바로 새 경기.
 * - 온라인: 두 사람 모두 다시하기를 누르면 같은 방에서 바로 재경기. 상대가 나가면 남은 사람은 그 방의 대기 상태로.
 */
export function showResult(result: MatchResult) {
  const { setup, score, winner, reason, leaver } = result;
  const me = setup.mySide;
  /** 내가 나간(끊긴) 경기: 남은 사람이 AI와 마무리한다 → 나는 패배 */
  const iLeft = reason === 'leave' && leaver === me;
  /** 상대가 나가서 AI와 마무리한 경기 */
  const vsAi = reason === 'leave' && leaver !== undefined && leaver !== me;
  const won = !iLeft && winner === me;
  const online = setup.mode === 'online';
  const room = online ? state.room : null;
  let off: (() => void) | null = null;
  const row = (s: 0 | 1) => {
    const f = setup.fighters[s];
    const ai = reason === 'leave' && leaver === s && !iLeft;
    const w = iLeft ? s !== me : s === winner;
    return `<div class="vs-side s${s} ${w ? 'win' : ''}"><img class="av" src="${zodiacFaceUrl(f.char)}" alt="" />
      <span class="nm">${ai ? '<i class="ai-tag">AI</i>' : ''}${esc(f.name)}</span><span class="wl">${w ? '승' : '패'}</span></div>`;
  };
  const note = !online
    ? ''
    : iLeft
      ? '연결이 끊겨 AI가 대신했어요 · 이 경기는 패배로 기록돼요'
      : vsAi
        ? '상대가 나가서 AI와 마무리했어요'
        : '';
  const root = screen(
    `<div class="result-card ${won ? 'won' : 'lost'}">
      <h2>🏐 경기 결과</h2>
      ${online ? '' : '<p class="kind"><span class="tag">AI 대전</span></p>'}
      <p class="verdict">${won ? '승리!' : '패배…'}</p>
      <div class="vs">${row(0)}<div class="vs-score"><b>${score[0]}</b><i>:</i><b>${score[1]}</b></div>${row(1)}</div>
      <p class="soft note" id="note">${note}</p>
      <p class="soft note" id="rec">${online || result.aiRecord ? '기록을 올리는 중…' : ''}</p>
      <p class="again-st" id="again-st"></p>
      <div class="actions"><button class="btn" id="exit">로비로</button><button class="btn primary" id="again">다시하기 ▶</button></div>
    </div><div class="cheer" id="cheer"></div>`,
    'result',
    'result',
    () => off?.(),
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  sfx(won ? 'win' : 'lose', { delay: 150 });
  if (won) confetti($('#cheer'));

  if (!online) {
    // AI 대전: 전적 +1 · 시아코인 / 하루 한도 / 기록 실패
    const line = $('#rec');
    void result.aiRecord?.then((o) => {
      if (line.isConnected) line.textContent = outcomeText(o);
    });
    $('#again').addEventListener('click', () => {
      sfx('click');
      // AI 대전: 같은 캐릭터로 바로 다시 (상대는 새로 뽑는다)
      nav.match(aiSetup(setup.fighters[me].char));
    });
    $('#exit').addEventListener('click', () => {
      sfx('click');
      nav.lobby();
    });
    return;
  }

  // 내 전적 한 줄 (서버에 결과를 올린 뒤)
  const rec = $('#rec');
  const total = (w?: number, l?: number) => (w === undefined || l === undefined ? '' : `내 전적 <b>${w}승 ${l}패</b>`);
  void (result.record ?? Promise.resolve<RecordOutcome>({ state: 'none' })).then((o) => {
    if (!rec.isConnected) return;
    if (o.state === 'saved') rec.innerHTML = total(o.wins, o.losses) || '기록했어요';
    else if (o.state === 'void') rec.innerHTML = `두 기기의 결과가 달라 기록되지 않았어요${total(o.wins, o.losses) ? ` · ${total(o.wins, o.losses)}` : ''}`;
    else if (o.state === 'failed') rec.textContent = '기록을 올리지 못했어요';
    else if (o.state === 'left') rec.textContent = '';
    else if (o.state === 'limit') rec.textContent = '오늘 이 상대와는 30판을 채워서 기록되지 않아요';
    else rec.textContent = '테스트 모드라 기록되지 않아요';
  });

  // ---------- 온라인: 다시하기 = 이 방에서 레디. 둘 다 누르면 방장이 바로 시작을 알린다 ----------
  const btn = $<HTMLButtonElement>('#again');
  const st = $('#again-st');
  const paint = () => {
    if (!room || state.room !== room) {
      st.textContent = '';
      btn.textContent = '로비로 ▶';
      return;
    }
    const opp = room.opponent();
    if (reason === 'leave') {
      // AI와 마무리한(또는 내가 끊겼던) 경기: 바로 재경기할 상대가 없다 → 다시하기 대신 게임방으로
      st.textContent = '';
      btn.textContent = '게임방으로 ▶';
      btn.classList.add('primary');
      return;
    }
    if (!opp) {
      // 상대가 나갔다: 남은 사람은 이 방에서 다음 상대를 기다릴 수 있다
      st.textContent = '상대가 방에서 나갔어요';
      st.className = 'again-st';
      btn.textContent = '게임방으로 ▶';
      btn.classList.add('primary');
      return;
    }
    btn.textContent = room.ready ? '다시하기 취소' : '다시하기 ▶';
    btn.classList.toggle('primary', !room.ready);
    st.className = `again-st ${opp.ready ? 'on' : ''}`;
    st.textContent = opp.ready
      ? room.ready
        ? '곧 시작해요!'
        : `${opp.name} 님이 다시하기를 눌렀어요!`
      : room.ready
        ? `${opp.name} 님을 기다리는 중…`
        : '둘 다 다시하기를 누르면 바로 시작해요';
  };
  if (room) off = room.onChange(paint);
  paint();
  btn.addEventListener('click', () => {
    if (!room || state.room !== room) {
      sfx('click');
      return nav.lobby();
    }
    if (reason === 'leave' || !room.opponent()) {
      sfx('click');
      if (room.ready) room.setReady(false);
      return nav.waiting();
    }
    sfx(room.ready ? 'click' : 'toggle');
    room.setReady(!room.ready);
  });
  $('#exit').addEventListener('click', () => {
    sfx('click');
    leaveRoom();
    nav.lobby();
  });
}

/** 색종이 (DESIGN.md: 승리 = 별·색종이) */
function confetti(box: HTMLElement) {
  const cols = ['var(--primary)', 'var(--pink)', 'var(--team-a)', 'var(--win)', 'var(--white)'];
  for (let i = 0; i < 36; i++) {
    const el = document.createElement('i');
    el.style.left = `${Math.random() * 100}%`;
    el.style.background = cols[i % cols.length];
    el.style.animationDelay = `${0.2 + Math.random() * 0.8}s`;
    el.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
    box.append(el);
  }
}
