/**
 * 놀아 주기 미니게임 (PRD 4장 4): 30초 동안 장난감으로 놀아 주고, 고양이가 잡은 수를 서버(nyang_play)에 보낸다.
 * 서버는 잡은 수를 15개 · 시작부터 2초에 하나까지만 센다 (CONST.play_catch_max · play_catch_sec) — 화면도 그 안에서만 센다.
 *   낚싯대: 깃털을 흔들어 신나게 한 뒤 멈추면 엉덩이를 실룩거리다 뛰어올라 덮친다 (그동안 깃털을 치우면 놓침)
 *   레이저: 빨간 점을 끌면 쫓아가고, 점이 멈추면 몸을 낮췄다 덮친다
 *   공: 방을 누르면 그쪽으로 던진다. 우다다 쫓아가 잡고, 가끔 물어 온다
 *   상자: 상자 속에서 고개를 내밀 때 톡 누르면 잡기
 */
import { CONST, PERSONALITY, TOYS, type ToyId } from '../data/balance';
import { errorText } from '../net/api';
import { boxFront, feather, yarnBall } from './props';
import { buzz, floatAt, josa, sfx, toast } from './common';
import { clamp, sleep, type CatView, type RoomCtx } from './ctx';
import type { Spot2 } from './cat';

const HELP: Record<ToyId, string> = {
  rod: '깃털을 흔들다가 멈춰 보세요',
  laser: '빨간 점을 끌어 보세요',
  ball: '방을 눌러 공을 던져요',
  box: '고개를 내밀 때 톡!',
};

export async function playGame(ctx: RoomCtx, v: CatView, toy: ToyId): Promise<void> {
  const a = v.actor;
  const room = ctx.room;
  ctx.setBusy(true);
  v.scene = 'play';
  try {
    ctx.apply(await ctx.api.playStart(v.slot, toy));
  } catch (e) {
    toast(errorText(e));
    v.scene = null;
    ctx.setBusy(false);
    return;
  }
  const cat = ctx.cat(v.slot);
  const liked = PERSONALITY[cat.personality].toy === toy;
  const sick = ctx.levels(v.slot).sick;
  sfx('nyangMeow', { rate: 1.3 });
  if (sick) a.say('에취… (시큰둥)', 1800);
  else a.say(liked ? '좋아하는 거다옹!' : '놀자옹!', 1600);

  // 화면 위에 놀이 층 (누르기를 모두 받는다) · 남은 시간 · 잡은 수
  const layer = document.createElement('div');
  layer.className = 'play-layer';
  layer.innerHTML = `<svg class="play-svg" aria-hidden="true"><path class="rod-line"/></svg>
    <div class="play-hud"><div class="ptime"><i></i></div><b class="pcount">🐾 0</b><button class="btn small pend" type="button">그만</button></div>
    <div class="phelp">${HELP[toy]}</div>`;
  room.append(layer);
  room.classList.add('playing');
  const trayEl = ctx.tray(`<div class="play-tray"><span class="ptoy">${TOYS[toy].icon}</span><span>${TOYS[toy].name}${liked ? ' <em>♥ 좋아해요</em>' : ''}</span></div>`);
  void trayEl;
  const countEl = layer.querySelector<HTMLElement>('.pcount')!;
  const timeEl = layer.querySelector<HTMLElement>('.ptime i')!;
  const line = layer.querySelector<SVGPathElement>('.rod-line')!;
  const help = layer.querySelector<HTMLElement>('.phelp')!;
  let ended = false;
  layer.querySelector('.pend')!.addEventListener('click', () => (ended = true));

  let catches = 0;
  const t0 = performance.now();
  const W = ctx.W();
  const H = ctx.H();
  const rr = () => room.getBoundingClientRect();
  const floorTop = ctx.toScreen({ x: 0, y: 0 }).y;
  const catSpot = () => ctx.toScreen(a.pos);
  /** 잡기 (서버 상한 안에서만 센다) */
  const caught = (x: number, y: number) => {
    const maxNow = Math.min(CONST.play_catch_max, Math.floor((performance.now() - t0) / 1000 / CONST.play_catch_sec));
    if (catches >= maxNow) return false;
    catches++;
    countEl.textContent = `🐾 ${catches}`;
    countEl.classList.remove('bump');
    void countEl.offsetWidth;
    countEl.classList.add('bump');
    floatAt(room, x, y - 20, '♥', 'float heart');
    sfx('nyangCatch');
    buzz([15, 30, 15]);
    if (catches === 1) ctx.saw(v, toy === 'box' ? 'box' : 'hunt');
    return true;
  };
  // 신이 났다가 아플 때는 느릿느릿
  const slow = sick ? 1.6 : 1;

  // 손가락
  let ptr: { x: number; y: number } | null = null;
  let tapAt: { x: number; y: number } | null = null;
  layer.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.pend')) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    const r = rr();
    ptr = { x: e.clientX - r.left, y: e.clientY - r.top };
    tapAt = { ...ptr };
    help.classList.add('fade');
  });
  layer.addEventListener('pointermove', (e) => {
    if (!ptr) return;
    const r = rr();
    ptr = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  const up = () => (ptr = null);
  layer.addEventListener('pointerup', up);
  layer.addEventListener('pointercancel', up);

  // 장난감 그림
  const toyEl = document.createElement('div');
  toyEl.className = `play-toy toy-${toy}`;
  toyEl.innerHTML = toy === 'rod' ? feather : toy === 'ball' ? yarnBall : toy === 'box' ? boxFront : '<i></i>';
  room.append(toyEl);
  const placeToy = (x: number, y: number, z = 4400) => {
    toyEl.style.transform = `translate(${x}px, ${y}px)`;
    toyEl.style.zIndex = String(z);
  };

  // 고양이 동작 상태
  type Phase = 'watch' | 'crouch' | 'leap' | 'hold' | 'cool';
  let phase: Phase = 'watch';
  let phaseAt = performance.now();
  const setPhase = (p: Phase) => {
    phase = p;
    phaseAt = performance.now();
  };
  let leapFrom: Spot2 = a.pos;
  let leapTo: Spot2 = a.pos;
  let aim = { x: 0, y: 0 };
  a.act = { kind: 'hold', pose: 'sit' };

  // 장난감마다의 상태
  const F = { x: W * 0.62, y: H * 0.5 }; // 깃털 · 레이저 점 · 공 (방 px)
  let excite = 0;
  let lastF = { ...F };
  let still = 0;
  // 공
  let ball: 'rest' | 'fly' | 'carry' = 'rest';
  let flyFrom = { ...F };
  let flyTo = { ...F };
  let flyAt = 0;
  // 상자
  const BOXP: Spot2 = { x: 0.5, y: 0.72 };
  let peek = false;
  let peekNext = performance.now() + 1500;
  let peekEnd = 0;
  let tapCool = 0;
  if (toy === 'ball') {
    const s = ctx.toScreen({ x: 0.5, y: 0.95 });
    F.x = s.x;
    F.y = s.y;
  }
  if (toy === 'box') {
    ctx.props.box.el.classList.add('away');
    const b = ctx.toScreen(BOXP);
    const bw = W * 0.34;
    toyEl.style.width = `${bw}px`;
    toyEl.style.height = `${bw * 0.66}px`;
    placeToy(b.x - bw / 2, b.y - bw * 0.62, Math.round(b.y) + 3);
    ctx.walkTo(v, { x: BOXP.x, y: BOXP.y - 0.02 }, { kind: 'hold', pose: 'loaf' });
  }
  if (toy === 'laser') toyEl.classList.add('hidden');

  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

  await new Promise<void>((done) => {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const el = (now - t0) / 1000;
      timeEl.style.width = `${Math.max(0, 100 - (el / CONST.play_sec) * 100)}%`;
      if (el >= CONST.play_sec || ended) return done();
      const since = now - phaseAt;

      if (toy === 'rod' || toy === 'laser') {
        // 장난감이 손가락을 따라간다 (레이저는 바닥 위에만)
        if (ptr) {
          if (toy === 'laser') {
            toyEl.classList.remove('hidden');
            const r = rr();
            const fl = ctx.toFloor(ptr.x + r.left, ptr.y + r.top);
            const s = ctx.toScreen(fl);
            F.x = s.x;
            F.y = s.y;
          } else {
            F.x += (ptr.x - F.x) * Math.min(1, dt / 60);
            F.y += (clamp(ptr.y, 30, H - 20) - F.y) * Math.min(1, dt / 60);
          }
        }
        const moved = dist(F, lastF);
        lastF = { ...F };
        excite = clamp(excite + moved * 0.012 - dt * 0.0007, 0, 2);
        still = moved < 1.2 ? still + dt : 0;
        if (toy === 'rod') {
          const sway = ptr ? 0 : Math.sin(now / 300) * 4;
          placeToy(F.x - 12 + sway, F.y - 6);
          line.setAttribute('d', `M ${F.x + 60} -10 Q ${F.x + 30} ${F.y * 0.4} ${F.x + sway} ${F.y}`);
        } else placeToy(F.x - 9, F.y - 9);
        const target = ctx.toFloor(F.x + rr().left, toy === 'rod' ? Math.max(F.y, floorTop) + rr().top : F.y + rr().top);
        const tgtS = ctx.toScreen(target);
        const reach = toy === 'rod' ? F.y > floorTop - H * 0.24 : true;
        if (phase === 'watch') {
          const cs = catSpot();
          const far = Math.abs(cs.x - tgtS.x) > W * (toy === 'laser' ? 0.1 : 0.22) || Math.abs(cs.y - tgtS.y) > H * 0.14;
          if (far && (toy === 'laser' ? !toyEl.classList.contains('hidden') : excite > 0.3)) {
            const goal = toy === 'laser' ? target : { x: clamp(target.x + (cs.x < tgtS.x ? -0.14 : 0.14), 0.05, 0.95), y: target.y };
            if (a.act.kind !== 'walk' || dist(ctx.toScreen(a.act.to), ctx.toScreen(goal)) > 12)
              a.act = { kind: 'walk', to: goal, speed: (toy === 'laser' ? 400 : 230) / slow, then: { kind: 'hold', pose: 'sit' } };
          } else if (a.act.kind !== 'walk') {
            a.act = { kind: 'hold', pose: 'sit' };
            a.facing = tgtS.x >= cs.x ? 1 : -1;
          }
          const ready = toy === 'laser' ? !far && still > 220 / slow : excite > 0.9 && still > 260 / slow && reach && !far;
          if (ready && a.act.kind !== 'walk') {
            setPhase('crouch');
            a.act = { kind: 'hold', pose: 'pounce' };
            a.facing = tgtS.x >= cs.x ? 1 : -1;
            a.wiggle = true;
            aim = { ...F };
            leapFrom = { ...a.pos };
            leapTo = { x: clamp(target.x - 0.04 * a.facing, 0.03, 0.97), y: target.y };
            if (Math.random() < 0.3) a.say('…!', 600);
          }
        } else if (phase === 'crouch') {
          if (since > (toy === 'laser' ? 420 : 620) * slow) {
            a.wiggle = false;
            setPhase('leap');
            a.act = { kind: 'hold', pose: 'jump' };
            sfx('nyangSwish');
          }
        } else if (phase === 'leap') {
          const k = Math.min(1, since / (360 * slow));
          a.pos = { x: leapFrom.x + (leapTo.x - leapFrom.x) * k, y: leapFrom.y + (leapTo.y - leapFrom.y) * k };
          a.lift = Math.sin(Math.PI * k) * H * (toy === 'rod' ? 0.16 : 0.07);
          if (k >= 1) {
            a.lift = 0;
            const ok = dist(F, aim) < W * (toy === 'laser' ? 0.09 : 0.11) && caught(F.x, F.y);
            if (ok) {
              setPhase('hold');
              a.act = { kind: 'hold', pose: 'pounce' };
              excite = 0;
            } else {
              setPhase('cool');
              a.act = { kind: 'hold', pose: 'sit' };
              if (Math.random() < 0.5) a.say(Math.random() < 0.5 ? '앗' : '놓쳤다옹', 800);
            }
          }
        } else if (phase === 'hold') {
          // 잡은 장난감을 앞발로 꾹
          if (toy === 'rod' && !ptr) {
            const m = a.mouthPoint();
            F.x += (m.x - F.x) * 0.2;
            F.y += (m.y + 20 - F.y) * 0.2;
          }
          if (since > 750) {
            setPhase('cool');
            a.act = { kind: 'hold', pose: 'sit' };
          }
        } else if (phase === 'cool' && since > 450 * slow) setPhase('watch');
      } else if (toy === 'ball') {
        if (tapAt && ball === 'rest') {
          const r = rr();
          const fl = ctx.toFloor(tapAt.x + r.left, tapAt.y + r.top);
          flyFrom = { ...F };
          flyTo = ctx.toScreen(fl);
          flyAt = now;
          ball = 'fly';
          sfx('nyangSwish', { rate: 0.8 });
          setPhase('watch');
          a.act = { kind: 'hold', pose: 'sit' };
        }
        tapAt = null;
        if (ball === 'fly') {
          const k = Math.min(1, (now - flyAt) / 600);
          F.x = flyFrom.x + (flyTo.x - flyFrom.x) * k;
          F.y = flyFrom.y + (flyTo.y - flyFrom.y) * k - Math.sin(Math.PI * k) * H * 0.22;
          if (k >= 1) {
            ball = 'rest';
            sfx('nyangDrop', { rate: 1.6, volume: 0.6 });
            setPhase('cool');
          }
        }
        if (ball === 'carry') {
          const m = a.mouthPoint();
          F.x = m.x;
          F.y = m.y + 10;
        }
        placeToy(F.x - 14, F.y - 26, Math.round(F.y) + 2);
        toyEl.classList.toggle('spin', ball === 'fly');
        if (ball === 'rest' && phase === 'cool' && since > 250) {
          // 우다다 쫓아가기
          const fl = ctx.toFloor(F.x + rr().left, F.y + rr().top);
          const side = a.pos.x < fl.x ? -0.07 : 0.07;
          setPhase('crouch');
          a.act = { kind: 'walk', to: { x: clamp(fl.x + side, 0.03, 0.97), y: fl.y }, speed: 470 / slow, then: { kind: 'hold', pose: 'pounce' } };
        } else if (phase === 'crouch' && a.act.kind !== 'walk') {
          a.facing = F.x >= catSpot().x ? 1 : -1;
          setPhase('hold');
          caught(F.x, F.y);
        } else if (phase === 'hold' && since > 600) {
          if (Math.random() < 0.4) {
            // 물어 온다
            ball = 'carry';
            setPhase('leap');
            a.say('물어 왔다옹', 1200);
            a.act = { kind: 'walk', to: { x: 0.5, y: 0.9 }, speed: 260, then: { kind: 'hold', pose: 'sit' } };
          } else {
            F.x = clamp(F.x + (Math.random() - 0.5) * W * 0.2, 20, W - 20);
            setPhase('watch');
            a.act = { kind: 'hold', pose: 'sit' };
          }
        } else if (phase === 'leap' && a.act.kind !== 'walk') {
          ball = 'rest';
          const s = ctx.toScreen({ x: 0.5, y: 0.97 });
          F.x = s.x;
          F.y = s.y;
          setPhase('watch');
          a.act = { kind: 'hold', pose: 'sit' };
        }
      } else if (toy === 'box') {
        const inBox = a.act.kind !== 'walk';
        // 상자는 늘 고양이 앞에, 바닥은 고양이 발에 맞춘다 (가라앉은 몸이 상자 밑으로 보이지 않게)
        if (inBox) {
          const cs = catSpot();
          const bw = W * 0.34;
          placeToy(cs.x - bw / 2, cs.y - bw * 0.62, (Number(a.el.style.zIndex) || 0) + 5);
        } else toyEl.style.zIndex = String((Number(a.el.style.zIndex) || 0) + 5);
        const deep = 300 * a.screen().s;
        if (inBox) {
          if (!peek && now > peekNext) {
            peek = true;
            peekEnd = now + Math.max(600, 950 - catches * 25);
            a.act = { kind: 'hold', pose: Math.random() < 0.5 ? 'sit' : 'blink' };
            a.facing = Math.random() < 0.5 ? 1 : -1;
          } else if (peek && now > peekEnd) {
            peek = false;
            peekNext = now + 700 + Math.random() * 1300;
          }
          const want = peek ? deep * 0.38 : deep * 0.95;
          a.sink += (want - a.sink) * Math.min(1, dt / 70);
        }
        if (tapAt && now > tapCool) {
          const r = toyEl.getBoundingClientRect();
          const rx = rr();
          const hit = tapAt.x + rx.left > r.left - 30 && tapAt.x + rx.left < r.right + 30 && tapAt.y + rx.top > r.top - 160 && tapAt.y + rx.top < r.bottom;
          if (hit && peek && inBox) {
            const m = a.mouthPoint();
            if (caught(m.x, m.y - 30)) {
              a.say('냥!', 700);
              peek = false;
              peekNext = now + 900 + Math.random() * 900;
            }
          } else if (hit) {
            toyEl.classList.remove('bump');
            void toyEl.offsetWidth;
            toyEl.classList.add('bump');
            floatAt(room, tapAt.x, tapAt.y - 20, '쉿…', 'float love');
            tapCool = now + 500;
          }
        }
        tapAt = null;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  // 끝: 서버에 잡은 수
  a.wiggle = false;
  a.lift = 0;
  a.sink = 0;
  layer.remove();
  toyEl.remove();
  ctx.props.box.el.classList.remove('away');
  room.classList.remove('playing');
  ctx.tray(null);
  try {
    const r = await ctx.api.play(v.slot, catches);
    ctx.apply(r);
    ctx.rewards(r);
    const s = a.mouthPoint();
    if (r.catches > 0) {
      a.act = { kind: 'pose', pose: 'blink', until: performance.now() + 1500 };
      a.say(r.liked ? '최고로 재밌었다옹!' : '재밌었다옹!', 1800);
      floatAt(room, s.x, s.y - 60, `🐾 ${r.catches}마리 잡았어요`, 'float big');
      if (r.love > 0) setTimeout(() => floatAt(room, s.x, s.y - 20, `친밀도 +${r.love}`, 'float love'), 400);
      sfx('nyangHeart');
    } else {
      a.act = { kind: 'pose', pose: 'loaf', until: performance.now() + 1500 };
      a.say('다음엔 꼭 잡을게옹', 1800);
    }
    if (r.liked && r.catches > 0) setTimeout(() => toast(`${josa(ctx.cat(v.slot).name, '이', '가')} 좋아하는 장난감이라 더 신났어요!`), 600);
    else if (sick) setTimeout(() => toast('아파서 시큰둥해요. 감기부터 낫게 해 주세요'), 600);
  } catch (e) {
    toast(errorText(e));
  }
  await sleep(300);
  v.scene = null;
  ctx.setBusy(false);
}
