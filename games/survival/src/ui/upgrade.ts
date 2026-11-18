import { UPGRADES, UPGRADE_TOTAL, upgradeSpent } from '../data/upgrades';
import { upgradeCount, upgradeOffer } from '../game/progress';
import { ApiError } from '../net/api';
import { esc, nav, screen, stage, state, toast } from './app';
import { icon } from './icons';
import { sfx } from './sfx';


/** 서버가 낸 까닭 → 쉬운 말 */
export function whyText(e: unknown): string {
  if (!(e instanceof ApiError)) return '서버에 연결하지 못했어요. 잠시 뒤에 다시 해 주세요';
  const m = e.message;
  if (m.includes('not enough coins')) return '엽전이 모자라요';
  if (m.includes('max level')) return '이미 끝까지 올렸어요';
  if (m.includes('already unlocked')) return '이미 풀린 캐릭터예요';
  if (m.includes('locked')) return '아직 잠겨 있어요';
  if (m.includes('need login')) return '로그인이 필요해요';
  return '지금은 할 수 없어요';
}

/** 영구 강화 화면 (PRD 7장): 엽전으로 9항목을 올린다. 모든 캐릭터에 공통으로 적용된다 */
export function showUpgrade() {
  let busy = false;
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>강화</h2><span class="coins-pill" id="coins"></span></div>
     <p class="tagline small" id="sum"></p>
     <div class="card up-list" id="list"></div>
     <div class="grow"></div>
     <button class="btn" id="reset">↩️ 강화 초기화 (엽전 모두 돌려받기)</button>`,
    'upgrade',
    'main',
  );
  const list = root.querySelector('#list') as HTMLElement;
  const paint = () => {
    const p = state.profile;
    root.querySelector('#coins')!.textContent = `🪙 ${p.coins.toLocaleString()}`;
    root.querySelector('#sum')!.textContent = `강화 ${upgradeCount(p.upgrades)} / ${UPGRADE_TOTAL} · 모든 캐릭터에 적용돼요`;
    list.innerHTML = UPGRADES.map((u) => {
      const o = upgradeOffer(p, u.id);
      const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < o.level ? 'on' : ''}"></i>`).join('');
      const btn =
        o.why === 'max level'
          ? '<span class="up-max">끝!</span>'
          : `<button class="btn small ${o.ok ? 'primary' : ''}" data-u="${u.id}" ${o.ok ? '' : 'disabled'}>🪙 ${o.cost.toLocaleString()}</button>`;
      return `<div class="up-row"><em>${icon('u', u.id)}</em>
        <span class="up-tx"><b>${esc(u.name)} <small>${esc(u.text)}</small></b><span class="pips">${pips}</span></span>${btn}</div>`;
    }).join('');
    (root.querySelector('#reset') as HTMLButtonElement).disabled = upgradeCount(p.upgrades) === 0;
  };
  paint();
  list.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('[data-u]') as HTMLElement | null;
    if (!b || busy || !state.api) return;
    busy = true;
    try {
      state.profile = await state.api.buyUpgrade(b.dataset.u!);
      sfx('coin');
    } catch (err) {
      sfx('toggle');
      toast(whyText(err));
    }
    busy = false;
    if (root.isConnected) paint();
  });
  root.querySelector('#reset')!.addEventListener('click', () => {
    sfx('click');
    const back = upgradeSpent(state.profile.upgrades);
    const dim = document.createElement('div');
    dim.className = 'dim';
    dim.innerHTML = `<div class="dialog"><h3>강화를 초기화할까요?</h3>
      <p class="soft" style="text-align:center;margin:0">강화가 모두 0이 되고, 쓴 엽전 ${back.toLocaleString()}닢을 모두 돌려받아요</p>
      <div class="actions"><button class="btn" data-no>그만두기</button><button class="btn primary" data-yes>초기화</button></div></div>`;
    dim.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-yes]') && state.api && !busy) {
        busy = true;
        try {
          state.profile = await state.api.resetUpgrades();
          sfx('coin');
          toast(`엽전 ${back.toLocaleString()}닢을 돌려받았어요`);
        } catch (err) {
          toast(whyText(err));
        }
        busy = false;
        dim.remove();
        if (root.isConnected) paint();
      } else if (t === dim || t.closest('[data-no]')) {
        sfx('click');
        dim.remove();
      }
    });
    stage.append(dim);
  });
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
}
