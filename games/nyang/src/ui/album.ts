/**
 * 5단계 앨범 · 행동 도감 (PRD 5 · 8장).
 * 사진은 그림을 저장하지 않는다 — 서버(nyang_album)에는 고양이 · 행동 · 자세 · 방향 · 털 색 · 시각만 있고, 여기서 다시 그린다:
 *   찍은 시각의 창밖 하늘(아침 · 낮 · 노을 · 밤) + 바닥 + 고양이 자세 그림(털 색 바꾸기 그대로) + 같이 찍힌 고양이.
 * 도감은 모든 고양이가 본 행동을 합쳐서 보여 주고, 못 본 것은 그림자(같은 자세를 까맣게)로.
 */
import { BEHAVIOR, BEHAVIORS, CONST, isColorId, kstHour, type ColorId, type PoseId } from '../data/balance';
import type { Photo } from '../game/rules';
import { errorText } from '../net/api';
import { POSE_IMAGE, catArt } from './catart';
import { buzz, esc, sfx, toast } from './common';
import type { RoomCtx } from './ctx';

const TOD = (t: number) => {
  const h = kstHour(t);
  return h >= 6 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night';
};
const when = (t: number) => {
  const d = new Date((t + 9 * 3600) * 1000);
  const h = d.getUTCHours();
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const asColor = (c: string): ColorId => (isColorId(c) ? c : 'white');
const asPose = (p: string): PoseId => (p in POSE_IMAGE ? (p as PoseId) : 'sit');

/** 그림을 다 만든 뒤 img 에 넣는다 (털 색 바꾸기는 비동기) */
function fillCats(root: HTMLElement) {
  for (const im of root.querySelectorAll<HTMLImageElement>('img[data-cat]')) {
    const [color, pose] = im.dataset.cat!.split(':');
    void catArt(asColor(color), POSE_IMAGE[asPose(pose)]).then((u) => (im.src = u), () => undefined);
  }
}

/** 사진 한 장 (다시 그리기) */
export function photoHtml(p: Photo, big = false): string {
  const cat = (color: string, pose: string, face: number, cls: string) =>
    `<img class="pcat ${cls}" data-cat="${esc(color)}:${esc(pose)}" alt="" draggable="false" style="--face:${face}">`;
  return `<div class="photo t-${TOD(p.at)} ${big ? 'big' : ''}" data-photo="${p.id}">
    <div class="pfloor"></div>
    ${p.mate ? cat(p.mate.color, p.mate.pose, -p.face, 'mate') : ''}
    ${cat(p.color, p.pose, p.face, p.mate ? 'main two' : 'main')}
    <div class="pcap"><b>${esc(BEHAVIOR[p.behavior]?.name ?? p.behavior)}</b><small>${esc(p.name)} · ${when(p.at)}</small></div></div>`;
}

export function openAlbum(ctx: RoomCtx, tab0: 'album' | 'book' = 'album') {
  if (document.querySelector('.album-dim')) return;
  let tab = tab0;
  let armed = 0;
  const dim = document.createElement('div');
  dim.className = 'dim sheet-dim album-dim';
  dim.innerHTML = `<div class="sheet panel album" role="dialog" aria-label="앨범">
    <div class="shop-head"><h3>📖 앨범 · 도감</h3><button class="btn iconbtn" type="button" data-close aria-label="닫기">✕</button></div>
    <div class="shop-tabs" role="tablist"><button type="button" data-tab="album">앨범</button><button type="button" data-tab="book">행동 도감</button></div>
    <div class="shop-body"></div></div>`;
  document.body.append(dim);
  sfx('click');
  const body = dim.querySelector<HTMLElement>('.shop-body')!;
  const close = () => dim.remove();

  function paint() {
    const s = ctx.state();
    for (const b of dim.querySelectorAll<HTMLElement>('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === tab);
    const n = s.album.length;
    const seen = new Map<string, ColorId>();
    for (const c of s.cats) for (const id of c.seen) if (!seen.has(id)) seen.set(id, c.color);
    dim.querySelector('[data-tab="album"]')!.textContent = `앨범 ${n}/${CONST.album_max}`;
    dim.querySelector('[data-tab="book"]')!.textContent = `행동 도감 ${[...seen.keys()].filter((k) => BEHAVIOR[k]).length}/${BEHAVIORS.length}`;
    if (tab === 'album') {
      body.innerHTML = n
        ? `<p class="likes">고양이를 누르고 [📷 사진] · 아래 띠의 📷 로 찍어요. ${CONST.album_max}장까지 (눌러서 크게 보기 · 지우기)</p>
           <div class="album-grid">${[...s.album].reverse().map((p) => photoHtml(p)).join('')}</div>`
        : '<p class="likes empty-note">아직 사진이 없어요.<br/>고양이가 귀여운 행동을 할 때 📷 를 눌러 찍어 보세요</p>';
    } else {
      const lv = Math.max(1, ...s.cats.map((c) => ctx.level(c.slot)));
      body.innerHTML = `<p class="likes">처음 본 행동이 모여요. 못 본 행동은 그림자로 보여요 (가구 · 친밀도 · 고양이 친구가 늘면 새 행동)</p>
        <div class="book-grid">${BEHAVIORS.map((b) => {
          const col = seen.get(b.id);
          const locked = !col && lv < b.level;
          return `<div class="bcell ${col ? 'on' : 'off'}"><div class="bimg"><img data-cat="${col ?? 'white'}:${b.pose}" alt="" draggable="false"></div>
            <b>${col ? esc(b.name) : '???'}</b><small>${col ? '' : locked ? `친밀도 ${b.level}단계` : '아직 못 봤어요'}</small></div>`;
        }).join('')}</div>`;
    }
    fillCats(body);
  }
  paint();

  function viewPhoto(id: number) {
    const p = ctx.state().album.find((x) => x.id === id);
    if (!p) return;
    const v = document.createElement('div');
    v.className = 'dim photo-dim';
    v.innerHTML = `<div class="photo-view">${photoHtml(p, true)}
      <div class="photo-btns"><button class="btn" type="button" data-del>🗑️ 지우기</button><button class="btn primary" type="button" data-close>닫기</button></div></div>`;
    document.body.append(v);
    fillCats(v);
    v.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      if (t === v || t.closest('[data-close]')) return v.remove();
      const d = t.closest<HTMLElement>('[data-del]');
      if (!d) return;
      if (armed !== id) {
        armed = id;
        d.textContent = '한 번 더 누르면 지워요';
        sfx('click');
        return;
      }
      try {
        ctx.apply(await ctx.api.deletePhoto(id));
        sfx('nyangDrop');
        buzz(10);
        toast('사진을 지웠어요');
        v.remove();
        paint();
      } catch (er) {
        toast(errorText(er));
      }
    });
  }

  dim.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === dim || t.closest('[data-close]')) return close();
    const tb = t.closest<HTMLElement>('[data-tab]');
    if (tb) {
      tab = tb.dataset.tab as 'album' | 'book';
      sfx('toggle');
      body.scrollTop = 0;
      return paint();
    }
    const ph = t.closest<HTMLElement>('[data-photo]');
    if (ph) viewPhoto(Number(ph.dataset.photo));
  });
}

/** 찰칵: 방에 하얀 번쩍임 + 작은 사진이 앨범 쪽으로 */
export function flash(room: HTMLElement) {
  const f = document.createElement('div');
  f.className = 'flash';
  room.append(f);
  setTimeout(() => f.remove(), 500);
}
