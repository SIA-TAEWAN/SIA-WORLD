import type { CharId } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { ROSTER, towerOf, type TowerLevel } from '../data/characters';
import { ENEMIES } from '../data/enemies';
import { REGIONS } from '../data/regions';
import { charLevel } from '../game/progress';
import { artUrl, zodiacFaceUrl } from '../assets';
import { esc, lockHint, nav, screen, state } from './app';
import { sfx } from './sfx';

/** 강화 단계 한 줄의 효과 (도감·게임 패널이 함께 쓴다) */
export function levelText(L: TowerLevel): string {
  if (L.income) return `웨이브마다 기운 +${L.income}${L.coin ? ` · 엽전 +${L.coin}` : ''}`;
  if (L.slow) return `사거리 ${Math.round(L.range)} · 이동 속도 ${Math.round(L.slow * 100)}%로${L.vuln ? ` · 받는 피해 +${Math.round(L.vuln * 100)}%` : ''}`;
  const parts = [`피해 ${Math.round(L.dmg * 10) / 10}${L.count && L.count > 1 ? `×${L.count}` : ''}`, `사거리 ${Math.round(L.range)}`, `간격 ${Math.round(L.every * 100) / 100}초`];
  if (L.stun) parts.push(`멈춤 ${L.stun}초`);
  if (L.splash) parts.push(`범위 ${L.splash}`);
  if (L.poison) parts.push(`독 초당 ${Math.round(L.poison)}`);
  if (L.burn) parts.push(`불 초당 ${Math.round(L.burn)}`);
  if (L.airMul) parts.push(`공중 ×${L.airMul}`);
  if (L.bossMul) parts.push(`보스 ×${L.bossMul}`);
  if (L.haste) parts.push(`주변 공격 속도 +${Math.round(L.haste * 100)}%`);
  if (L.detect) parts.push('은신 감지');
  return parts.join(' · ');
}

/**
 * 도감 (PRD 8장): 만난 요괴(특징, 잘 듣는 캐릭터) · 보스 · 해금한 캐릭터(역할, 강화 단계별 효과).
 * 못 만난 요괴·잠긴 캐릭터는 그림자로 보인다. 만난 요괴는 서버의 codex, 캐릭터는 해금 목록이 기준이다.
 */
export function showCodex() {
  let tab: 'foes' | 'bosses' | 'chars' = 'foes';
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>도감</h2><span class="spacer"></span></div>
     <div class="seg wide" id="tabs"><button data-t="foes">요괴</button><button data-t="bosses">보스</button><button data-t="chars">캐릭터</button></div>
     <div class="scroll cx-body" id="body"></div>`,
    'select prepare codex',
  );
  const body = root.querySelector('#body') as HTMLElement;
  const nick = (id: CharId) => ROSTER.find((r) => r.id === id)?.nick ?? '';
  const faces = (ids: CharId[]) => ids.map((z) => `<img src="${zodiacFaceUrl(z)}" alt="${esc(nick(z))}" title="${esc(nick(z))}" />`).join('');
  const paint = () => {
    root.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.t === tab));
    const p = state.profile;
    if (tab === 'foes') {
      const met = ENEMIES.filter((e) => p.codex.enemies.includes(e.id)).length;
      body.innerHTML =
        `<p class="soft cx-count">만난 요괴 ${met} / ${ENEMIES.length}</p>` +
        ENEMIES.map((e) =>
          p.codex.enemies.includes(e.id)
            ? `<div class="cx"><span class="cx-art"><img class="foe" src="${artUrl(`e-${e.id}`)}" alt="" /></span>
                <span class="cx-tx"><b>${esc(e.name)}</b><small>${esc(e.desc)}</small></span>
                <span class="weak"><small>잘 듣는</small>${faces(e.weak)}</span></div>`
            : `<div class="cx unknown"><span class="cx-art"><img class="foe" src="${artUrl(`e-${e.id}`)}" alt="" /></span><span class="cx-tx"><b>???</b><small>아직 만나지 못했어요</small></span></div>`,
        ).join('');
    } else if (tab === 'bosses') {
      const met = BOSSES.filter((b) => p.codex.bosses.includes(b.id)).length;
      body.innerHTML =
        `<p class="soft cx-count">만난 보스 ${met} / ${BOSSES.length}</p>` +
        BOSSES.map((b, i) =>
          p.codex.bosses.includes(b.id)
            ? `<div class="cx boss"><span class="cx-art"><img class="foe" src="${artUrl(`b-${b.id}`)}" alt="" /></span>
                <span class="cx-tx"><b>${esc(b.name)} <i>${i + 1}지역</i></b><small>${esc(b.desc)}</small></span></div>`
            : `<div class="cx unknown"><span class="cx-art"><img class="foe" src="${artUrl(`b-${b.id}`)}" alt="" /></span><span class="cx-tx"><b>???</b><small>${esc(REGIONS[i]?.name ?? '')}의 보스</small></span></div>`,
        ).join('');
    } else {
      body.innerHTML =
        `<p class="soft cx-count">함께하는 캐릭터 ${p.unlocked.length} / ${ROSTER.length}</p>` +
        ROSTER.map((r) => {
          const def = towerOf(r.id);
          if (!p.unlocked.includes(r.id) || !def) {
            return `<div class="cx unknown"><span class="cx-art"><img src="${zodiacFaceUrl(r.id)}" alt="" /></span>
              <span class="cx-tx"><b>???</b><small>🔒 ${esc(lockHint(r, '만나요'))}</small></span></div>`;
          }
          return `<div class="cx char"><span class="cx-art"><img src="${zodiacFaceUrl(r.id)}" alt="" /></span>
            <span class="cx-tx"><b>${esc(r.nick)} <i>${esc(r.name)} · ${esc(r.role)} · Lv ${charLevel(p, r.id)} · ✨${def.cost}</i></b><small>${esc(def.desc)}</small>
              <small class="lv">1단계 ${esc(levelText(def.levels[0]))}</small><small class="lv">2단계 ${esc(levelText(def.levels[1]))}</small>
              <small class="lv">3단계 ${esc(levelText(def.levels[2]))} — ${esc(def.special)}</small></span></div>`;
        }).join('');
    }
    body.scrollTop = 0;
  };
  paint();
  root.querySelector('#tabs')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!b) return;
    sfx('toggle');
    tab = (b.dataset.t as typeof tab) ?? 'foes';
    paint();
  });
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
}
