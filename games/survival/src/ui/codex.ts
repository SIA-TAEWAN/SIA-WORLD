import { BOSSES } from '../data/bosses';
import { CHARACTERS } from '../data/characters';
import { ENEMIES } from '../data/enemies';
import { MAPS, MAP_INDEX } from '../data/maps';
import { PASSIVES } from '../data/passives';
import { WEAPONS } from '../data/weapons';
import { codexCount, evolutionHints } from '../game/progress';
import { artUrl, zodiacFaceUrl } from '../assets';
import { esc, mmss, nav, screen, state } from './app';
import { icon } from './icons';
import { sfx } from './sfx';

/** 요괴·보스 그림: 게임 화면과 같은 그림 (public/art/e-<id>.png · b-<id>.png, ASSETS.md) */
const foe = (name: string) => `<img class="foe" src="${artUrl(name)}" alt="" loading="lazy" />`;

type Tab = 'enemy' | 'gear' | 'char';

/**
 * 도감 (PRD 8장): 만난 요괴·보스, 얻은 무기·패시브·진화 무기, 해금한 캐릭터.
 * 못 만난 항목은 그림자로만 보이고 이름·설명은 가려진다. 진화 조합은 아는 만큼만 보여 준다.
 */
export function showCodex() {
  const p = state.profile;
  const cx = p.codex;
  let tab: Tab = 'enemy';
  const count = codexCount(p);
  const root = screen(
    `<div class="bar"><button class="back" id="back">← 돌아가기</button><h2>도감</h2><span class="spacer"></span></div>
     <p class="tagline small">모은 것 ${count.have} / ${count.all}</p>
     <div class="seg wide" id="tabs">
       <button data-t="enemy">👹 요괴·보스</button><button data-t="gear">⚔️ 무기·패시브</button><button data-t="char">🐾 캐릭터</button>
     </div>
     <div class="card cx-body" id="body"></div>`,
    'codex',
    'main',
  );
  const body = root.querySelector('#body') as HTMLElement;
  // 요괴·보스 그림을 받지 못하면 깨진 그림 표시 대신 물음표 아이콘을 둔다 (error 는 위로 올라오지 않아 capture 로 듣는다)
  body.addEventListener(
    'error',
    (e) => {
      const img = e.target as HTMLElement;
      if (!(img instanceof HTMLImageElement) || !img.classList.contains('foe')) return;
      const em = document.createElement('em');
      em.innerHTML = icon('x', 'unknown');
      img.replaceWith(em);
    },
    true,
  );
  /** 한 칸: 아는 것은 그림·이름·설명, 모르는 것은 그림자와 ??? */
  const cell = (known: boolean, art: string, name: string, desc: string, tag = '') =>
    `<div class="cx ${known ? '' : 'unknown'}"><span class="cx-art">${art}</span>
      <span class="cx-tx"><b>${known ? esc(name) : '???'}${known && tag ? ` <i class="tag">${esc(tag)}</i>` : ''}</b><small>${known ? esc(desc) : '아직 만나지 못했어요'}</small></span></div>`;

  const paint = () => {
    root.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.t === tab));
    if (tab === 'enemy') {
      const enemies = ENEMIES.map((e) => cell(cx.enemies.includes(e.id), foe(`e-${e.id}`), e.name, e.desc));
      const bosses = MAPS.map((m) => {
        const list = BOSSES.filter((b) => b.map === m.id).map((b, i) =>
          cell(cx.bosses.includes(b.id), foe(`b-${b.id}`), b.name, b.desc, i === 2 ? '최종 보스' : mmss(m.bosses[i].at)),
        );
        return `<h4>${esc(m.name)}</h4>${list.join('')}`;
      });
      body.innerHTML = `<h3>요괴 ${cx.enemies.length}/${ENEMIES.length}</h3>${enemies.join('')}<h3>보스 ${cx.bosses.length}/${BOSSES.length}</h3>${bosses.join('')}`;
    } else if (tab === 'gear') {
      const weapons = WEAPONS.filter((w) => !w.evolved).map((w) => cell(cx.weapons.includes(w.id), `<em>${icon('w', w.id)}</em>`, w.name, w.desc));
      const passives = PASSIVES.map((x) => cell(cx.passives.includes(x.id), `<em>${icon('p', x.id)}</em>`, x.name, `${x.text} (레벨마다)`));
      // 진화 조합 힌트: 아는 재료만 보이고 나머지는 ? 로 가린다
      const evo = evolutionHints(cx).map((h) => {
        const part = (known: boolean, ic: string, name: string) => `<span class="evo-part ${known ? '' : 'unknown'}"><em>${known ? ic : icon('x', 'unknown')}</em>${known ? esc(name) : '?'}</span>`;
        return `<div class="evo">${part(h.weaponKnown, icon('w', h.weapon.id), `${h.weapon.name} Lv5`)}<b>+</b>${part(h.passiveKnown, icon('p', h.passive.id), h.passive.name)}<b>→</b>${part(h.resultKnown, icon('w', h.result.id), h.result.name)}</div>`;
      });
      const have = (list: { id: string }[], known: string[]) => list.filter((x) => known.includes(x.id)).length;
      body.innerHTML = `<h3>무기 ${have(WEAPONS.filter((w) => !w.evolved), cx.weapons)}/${WEAPONS.filter((w) => !w.evolved).length}</h3>${weapons.join('')}
        <h3>패시브 ${cx.passives.length}/${PASSIVES.length}</h3>${passives.join('')}
        <h3>진화 ${have(WEAPONS.filter((w) => w.evolved), cx.weapons)}/${WEAPONS.filter((w) => w.evolved).length}</h3>
        <p class="soft">무기를 5레벨까지 올리고 짝 패시브를 가진 채로 보스의 보물상자를 열면 진화해요</p>${evo.join('')}`;
    } else {
      const chars = CHARACTERS.map((c) => {
        const known = p.unlockedCharacters.includes(c.id);
        const w = WEAPONS.find((x) => x.id === c.weapon)!;
        return `<div class="cx ${known ? '' : 'unknown'}"><span class="cx-art"><img src="${zodiacFaceUrl(c.id)}" alt="" /></span>
          <span class="cx-tx"><b>${esc(c.nick)} <i class="soft">${esc(c.name)}</i></b>
          <small>${known ? `${esc(w.name)} · ${esc(c.trait.text)}` : `🔒 ${esc(c.unlock.text)}`}</small></span></div>`;
      });
      const maps = MAPS.map((m) => cell(p.unlockedMaps.includes(m.id), `<i class="blob m-${m.id}"></i>`, m.name, `${m.desc} · ${m.level} · 엽전 ×${m.coinMul}`));
      body.innerHTML = `<h3>캐릭터 ${p.unlockedCharacters.length}/${CHARACTERS.length}</h3>${chars.join('')}<h3>맵 ${p.unlockedMaps.filter((m) => MAP_INDEX[m] !== undefined).length}/${MAPS.length}</h3>${maps.join('')}`;
    }
    body.scrollTop = 0;
  };
  paint();
  root.querySelector('#tabs')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!b) return;
    sfx('toggle');
    tab = b.dataset.t as Tab;
    paint();
  });
  root.querySelector('#back')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
}
