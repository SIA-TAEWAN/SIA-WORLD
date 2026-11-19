import type { ZodiacId } from '../data/balance';
import { ROSTER, towerOf } from '../data/characters';
import { CHAR_MAX_LV, LEVEL_DMG, PERKS, UPGRADES, levelCost, upgradeCost } from '../data/growth';
import { REGIONS } from '../data/regions';
import { charLevel, upgradeLevel } from '../game/progress';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { esc, josa, nav, screen, setProfile, state, toast, watchProfile, whyText } from './app';
import { sfx } from './sfx';

/**
 * [캐릭터] 화면 (PRD 7장 판 밖 성장): 엽전으로 캐릭터 영구 레벨업(최대 12) · 공통 강화 5종.
 * 비용과 결과는 서버가 정한다 (여기서는 같은 표로 미리 보여 줄 뿐이다).
 */
export function showChars() {
  let tab: 'chars' | 'common' = 'chars';
  let pick: ZodiacId = state.profile.unlocked[0] ?? 'rat';
  let busy = false;
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>캐릭터</h2><span class="spacer"></span></div>
     <div class="roster-top"><div class="seg wide" id="tabs"><button data-t="chars">캐릭터 레벨업</button><button data-t="common">공통 강화</button></div>
       <span class="coins-pill" id="mycoins"></span></div>
     <div class="scroll" id="body"></div>`,
    'select prepare roster',
    () => off(),
  );
  const body = root.querySelector('#body') as HTMLElement;
  const pips = (n: number, max: number) => `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;

  const paintChars = () => {
    const p = state.profile;
    const r = ROSTER.find((x) => x.id === pick)!;
    const def = towerOf(pick);
    const open = p.unlocked.includes(pick);
    const lv = charLevel(p, pick);
    const cost = levelCost(lv);
    const perks = PERKS.map((k) => `<li class="${lv >= k.lv ? 'on' : ''}"><b>Lv ${k.lv}</b>${esc(k.text)}</li>`).join('');
    body.innerHTML = `<div class="card info">
        <div class="info-stage"><img src="${zodiacFullUrl(pick)}" alt="" class="${open ? '' : 'dimmed'}" /></div>
        <div class="info-text">
          <h3>${esc(r.nick)} <small>${esc(r.name)} · ${esc(r.role)}</small></h3>
          ${
            open
              ? `<p class="lv-line"><b>Lv ${lv}</b>${pips(lv, CHAR_MAX_LV)}</p>
                 <p class="soft">${def?.kind === 'bank' ? '버는 기운' : '공격력'} +${Math.round(LEVEL_DMG * (lv - 1) * 100)}%${cost !== null ? ` → <b>+${Math.round(LEVEL_DMG * lv * 100)}%</b>` : ''}</p>
                 <ul class="perks">${perks}</ul>
                 ${def ? `<p class="soft">${esc(def.desc)}<br/>3단계: ${esc(def.special)}</p>` : '<p class="soft">아직 준비 중인 캐릭터예요</p>'}
                 <button class="btn primary" id="up" ${cost === null ? 'disabled' : ''}>${cost === null ? '최대 레벨' : `레벨업 🪙 ${cost.toLocaleString()}`}</button>`
              : `<p class="soft">🔒 ${r.unlockRegion}지역 ${esc(josa(REGIONS[r.unlockRegion - 1]?.name ?? '', '을', '를'))} 클리어하면 함께할 수 있어요</p>`
          }
        </div>
      </div>
      <div class="card"><div class="chars" id="chars">${ROSTER.map((c) => {
        const o = p.unlocked.includes(c.id);
        return `<button class="char ${c.id === pick ? 'sel' : ''} ${o ? '' : 'locked'}" data-c="${c.id}"><img src="${zodiacFaceUrl(c.id)}" alt="" /><span>${c.nick}</span>${o ? `<b class="lvb">Lv ${charLevel(p, c.id)}</b>` : '<b class="lock">🔒</b>'}</button>`;
      }).join('')}</div></div>`;
    const up = body.querySelector('#up') as HTMLButtonElement | null;
    if (up && cost !== null) up.classList.toggle('poor', p.coins < cost);
  };
  const paintCommon = () => {
    const p = state.profile;
    body.innerHTML = `<div class="card up-list">${UPGRADES.map((u) => {
      const lv = upgradeLevel(p, u.id);
      const cost = upgradeCost(u.id, lv);
      return `<div class="up-row"><em>${u.icon}</em>
        <span class="up-tx"><b>${esc(u.name)} <small>${esc(u.text)} (레벨마다)</small></b>${pips(lv, u.max)}</span>
        ${cost === null ? '<span class="up-max">최대</span>' : `<button class="btn small ${p.coins >= cost ? 'primary' : ''}" data-u="${u.id}">🪙 ${cost.toLocaleString()}</button>`}
      </div>`;
    }).join('')}</div>
    <p class="soft foot">공통 강화는 모든 판에 적용돼요</p>`;
  };
  const paint = () => {
    root.querySelector('#mycoins')!.textContent = `🪙 ${state.profile.coins.toLocaleString()}`;
    root.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.t === tab));
    if (tab === 'chars') paintChars();
    else paintCommon();
  };
  paint();
  const off = watchProfile(paint);
  /** 서버에 한 번 다녀오는 일 (그동안 다시 누르지 못한다) */
  const act = async (fn: () => Promise<typeof state.profile>, okSound: string) => {
    if (busy || !state.api) return;
    busy = true;
    try {
      setProfile(await fn());
      sfx(okSound);
    } catch (e) {
      sfx('toggle');
      toast(whyText(e));
    }
    busy = false;
  };
  root.querySelector('#tabs')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!b) return;
    sfx('toggle');
    tab = b.dataset.t === 'common' ? 'common' : 'chars';
    paint();
  });
  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const ch = t.closest('.char') as HTMLElement | null;
    if (ch) {
      sfx('toggle');
      pick = ch.dataset.c as ZodiacId;
      return paint();
    }
    if (t.closest('#up')) return void act(() => state.api!.levelUp(pick), 'survLevel');
    const u = t.closest('[data-u]') as HTMLElement | null;
    if (u) void act(() => state.api!.buyUpgrade(u.dataset.u!), 'survLevel');
  });
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
}
