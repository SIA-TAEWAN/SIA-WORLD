// SIA WORLD 효과음 (시아탱크 · 시아맞고 · 시아카지노 · 시아레이스 · 시아배구 · 시아서바이벌 · 시아열두길 공용).
//
// - 소리는 ZzFX 방식(코드로 파형을 만든다, MIT · Frank Force)으로 만든다. 외부 파일 없음.
// - shared/sounds/<이름>.ogg 또는 .mp3 파일을 넣으면 그 소리를 처음 낼 때 확인해서 파일로 바꿔 쓴다.
// - 켜기/끄기는 브라우저에 저장 (localStorage 'sia:sound'). 시아탱크의 예전 설정('siatank:mute')도 이어받는다.
// - 배경음 켜기/끄기는 따로 저장 (localStorage 'sia:bgm'). 곡 자체는 각 게임이 만든다 (시아레이스: games/running/src/ui/music.ts,
//   shared/sounds/bgmLobby|bgmRace|bgmResult.ogg|.mp3 를 넣으면 그 파일로 바뀐다).
// - 브라우저 정책: 첫 클릭·터치·키 입력 전에는 소리를 내지 않는다 (그때 오디오를 깨운다).
// - 같은 소리가 겹치지 않게 이름마다 최소 간격, 동시에 나는 소리 수 제한.

const SAMPLE_RATE = 44100;
const MASTER = 0.32;

/**
 * 소리 목록: ZzFX 매개변수
 * [볼륨, 무작위, 주파수, 어택, 서스테인, 릴리스, 파형(0 사인·1 삼각·2 톱니·3 탄젠트·4 잡음 섞인 사인), 파형 곡선,
 *  슬라이드, 슬라이드 변화, 음 점프, 점프 시각, 반복, 잡음, 변조, 비트 크러시, 딜레이, 서스테인 볼륨, 디케이, 트레몰로]
 * 분위기: 캐주얼하고 귀엽고 밝게 (짧고 통통 튀는 소리 위주)
 */
export const SOUNDS = {
  // 공통 UI
  click: [0.5, 0, 880, 0, 0.01, 0.03, 1, 1.5],
  toggle: [0.5, 0, 660, 0, 0.02, 0.05, 1, 1, 0, 0, 330, 0.03],
  coin: [0.6, 0, 1100, 0, 0.04, 0.22, 1, 1.4, 0, 0, 550, 0.05],
  turn: [0.5, 0, 784, 0.01, 0.05, 0.12, 1, 1.2, 0, 0, 262, 0.06],
  tick: [0.35, 0, 1500, 0, 0.005, 0.02, 1, 2],
  cutin: [0.6, 0, 440, 0.02, 0.1, 0.25, 1, 1.5, 12, 0, 220, 0.06],
  win: [0.7, 0, 523, 0.02, 0.18, 0.35, 1, 1.4, 0, 0, 262, 0.07, 0.07],
  lose: [0.55, 0, 330, 0.02, 0.1, 0.35, 1, 1.2, -1],
  // 카드
  deal: [0.45, 0.1, 1600, 0, 0.01, 0.06, 4, 0.6, -30, 0, 0, 0, 0, 1.4],
  flip: [0.45, 0.05, 900, 0.005, 0.01, 0.05, 1, 2, 60],
  slap: [0.9, 0.05, 200, 0, 0.02, 0.14, 4, 2.5, -1.7, 0, 0, 0, 0, 1.2],
  chip: [0.4, 0.08, 2400, 0, 0.01, 0.05, 1, 2.5, 0, 0, 900, 0.015],
  fold: [0.4, 0, 260, 0.01, 0.04, 0.12, 2, 1, -2],
  bust: [0.55, 0, 180, 0.01, 0.08, 0.3, 2, 1.5, -0.65],
  // 룰렛
  spinTick: [0.3, 0.05, 1900, 0, 0.004, 0.015, 1, 2],
  spinStop: [0.6, 0, 1047, 0.01, 0.06, 0.2, 1, 1.4, 0, 0, 523, 0.05],
  // 시아탱크
  tankFire: [0.8, 0.05, 150, 0, 0.04, 0.22, 4, 1.8, -0.8, 0, 0, 0, 0, 1.6],
  tankBoom: [1, 0.1, 80, 0, 0.12, 0.6, 4, 2.2, -0.15, 0, 0, 0, 0, 2.2],
  tankBigBoom: [1, 0.1, 60, 0.01, 0.25, 0.9, 4, 2.5, -0.07, 0, 0, 0, 0, 2.6],
  tankLaser: [0.5, 0, 1400, 0.01, 0.3, 0.3, 2, 1, -3.2],
  tankBuild: [0.5, 0, 220, 0.01, 0.08, 0.15, 1, 1, -1.3],
  tankHeal: [0.5, 0, 440, 0.02, 0.15, 0.2, 0, 1, 25],
  tankTurn: [0.5, 0, 523, 0.01, 0.06, 0.12, 1, 1.2, 0, 0, 262, 0.07],
  tankWin: [0.7, 0, 523, 0.02, 0.2, 0.4, 1, 1.4, 0, 0, 262, 0.08, 0.08],
  // 시아레이스
  raceReady: [0.5, 0, 440, 0.01, 0.1, 0.12, 1, 1.2],
  raceGo: [0.7, 0, 880, 0.01, 0.2, 0.28, 1, 1.4, 0, 0, 440, 0.08],
  raceFoul: [0.6, 0, 220, 0.01, 0.14, 0.3, 2, 1.2, -0.8],
  step: [0.3, 0.1, 190, 0, 0.01, 0.04, 4, 2, -2, 0, 0, 0, 0, 1.5],
  jump: [0.5, 0, 420, 0.01, 0.05, 0.12, 1, 1.4, 9],
  land: [0.4, 0.05, 150, 0, 0.02, 0.07, 4, 2, -1.5, 0, 0, 0, 0, 1],
  slide: [0.45, 0.05, 340, 0.01, 0.12, 0.2, 4, 2.6, -2.4, 0, 0, 0, 0, 1.8],
  mud: [0.5, 0.1, 120, 0.01, 0.05, 0.16, 4, 1.5, -0.6, 0, 0, 0, 0, 2.2],
  hurdleHit: [0.7, 0.05, 260, 0, 0.03, 0.18, 2, 1.6, -1.6, 0, 0, 0, 0, 0.8],
  slip: [0.5, 0, 700, 0.01, 0.08, 0.18, 1, 1, -7],
  logHit: [0.8, 0.05, 110, 0, 0.05, 0.25, 4, 2.2, -0.4, 0, 0, 0, 0, 1.6],
  boost: [0.5, 0, 523, 0.01, 0.1, 0.2, 1, 1.3, 14, 0, 262, 0.05],
  goal: [0.7, 0, 659, 0.02, 0.15, 0.3, 1, 1.4, 0, 0, 330, 0.07, 0.07],
  rankShow: [0.5, 0, 784, 0.01, 0.05, 0.14, 1, 1.3, 0, 0, 196, 0.05],
  newRecord: [0.7, 0, 523, 0.02, 0.22, 0.45, 1, 1.4, 0, 0, 392, 0.09, 0.09],
  // 시아배구 (점프·착지는 jump · land, 승패는 win · lose 를 같이 쓴다)
  volleyHit: [0.8, 0.05, 240, 0, 0.015, 0.1, 1, 2.2, -3.5, 0, 0, 0, 0, 0.5],
  volleyWall: [0.45, 0.05, 330, 0, 0.01, 0.06, 1, 1.6, -5],
  volleyNet: [0.5, 0.05, 150, 0, 0.02, 0.12, 2, 1.4, -1.2, 0, 0, 0, 0, 0.3],
  volleySpeed: [0.55, 0, 440, 0.01, 0.12, 0.22, 1, 1.3, 16, 0, 220, 0.06],
  volleyPoint: [0.7, 0, 587, 0.02, 0.14, 0.3, 1, 1.4, 0, 0, 294, 0.07, 0.07],
  volleyMiss: [0.5, 0, 294, 0.01, 0.1, 0.28, 1, 1.2, -1.4],
  volleyServe: [0.4, 0, 660, 0.01, 0.04, 0.1, 1, 1.5, 6],
  volleyCount: [0.5, 0, 523, 0.01, 0.08, 0.1, 1, 1.3],
  volleyGo: [0.7, 0, 1047, 0.01, 0.18, 0.28, 1, 1.4, 0, 0, 523, 0.08],
  // 시아서바이벌 (엽전은 coin, 구슬은 chip, 떡은 tankHeal, 부적·보스 폭발은 tankBoom, 클리어·게임 오버는 win · lose 를 같이 쓴다)
  survShot: [0.35, 0.05, 900, 0, 0.01, 0.05, 1, 1.5, -18],
  survSlash: [0.4, 0.05, 520, 0, 0.02, 0.08, 4, 2, -9, 0, 0, 0, 0, 1.2],
  survPop: [0.4, 0.05, 260, 0, 0.02, 0.1, 1, 1.6, -3],
  survHurt: [0.7, 0.05, 190, 0, 0.05, 0.16, 2, 1.4, -2.2, 0, 0, 0, 0, 0.6],
  survLevel: [0.6, 0, 659, 0.01, 0.12, 0.26, 1, 1.4, 0, 0, 330, 0.05, 0.05],
  survBossWarn: [0.7, 0, 196, 0.03, 0.3, 0.3, 2, 1.2, 0, 0, -40, 0.15, 0.15],
  survBossDown: [0.9, 0.05, 110, 0.01, 0.2, 0.6, 4, 2.2, -0.2, 0, 0, 0, 0, 1.8],
  survChest: [0.6, 0, 880, 0.01, 0.1, 0.3, 1, 1.5, 0, 0, 440, 0.06, 0.06],
  // 시아열두길 (베기 · 활 · 마법 · 피격 · 레어 드랍 · 레벨업. 나머지는 서바이벌·공통 소리를 같이 쓴다)
  twelveSlash: [0.45, 0.05, 760, 0, 0.015, 0.09, 4, 2.4, -14, 0, 0, 0, 0, 1.6],
  twelveBow: [0.45, 0.03, 330, 0, 0.01, 0.11, 1, 1.8, 22, 0, 0, 0, 0, 0.3],
  twelveMagic: [0.4, 0.03, 620, 0.01, 0.05, 0.16, 0, 1.2, 9, 0, 310, 0.04, 0, 0, 30],
  twelveHurt: [0.75, 0.05, 150, 0, 0.04, 0.2, 2, 1.6, -3, 0, 0, 0, 0, 0.9],
  twelveRare: [0.65, 0, 784, 0.01, 0.14, 0.45, 1, 1.6, 0, 0, 392, 0.07, 0.07],
  twelveLevel: [0.65, 0, 523, 0.02, 0.2, 0.4, 1, 1.5, 6, 0, 262, 0.08, 0.08],
};

/** 이름별 최소 간격(ms): 칩 여러 개 → 짧은 간격으로 한 번씩 */
const MIN_GAP = { chip: 60, deal: 60, tick: 120, spinTick: 45, flip: 60, click: 40, step: 130, jump: 60, land: 60, slide: 60, volleyHit: 50, volleyWall: 50, volleyNet: 50, survShot: 80, survSlash: 80, survPop: 80, survHurt: 150, twelveSlash: 80, twelveBow: 80, twelveMagic: 80, twelveHurt: 150 };
const DEFAULT_GAP = 90;
const MAX_VOICES = 6;

// ───────────────────────── ZzFX 파형 만들기 (MIT · Frank Force, 읽기 쉽게 다시 씀) ─────────────────────────
function buildSamples(volume = 1, randomness = 0.05, frequency = 220, attack = 0, sustain = 0, release = 0.1, shape = 0, shapeCurve = 1, slide = 0, deltaSlide = 0, pitchJump = 0, pitchJumpTime = 0, repeatTime = 0, noise = 0, modulation = 0, bitCrush = 0, delay = 0, sustainVolume = 1, decay = 0, tremolo = 0) {
  const PI2 = Math.PI * 2;
  let startSlide = (slide *= (500 * PI2) / SAMPLE_RATE / SAMPLE_RATE);
  let startFrequency = (frequency *= ((1 + randomness * 2 * Math.random() - randomness) * PI2) / SAMPLE_RATE);
  const b = [];
  let t = 0;
  let tm = 0;
  let i = 0;
  let j = 1;
  let r = 0;
  let c = 0;
  let s = 0;
  attack = attack * SAMPLE_RATE + 9;
  decay *= SAMPLE_RATE;
  sustain *= SAMPLE_RATE;
  release *= SAMPLE_RATE;
  delay *= SAMPLE_RATE;
  deltaSlide *= (500 * PI2) / SAMPLE_RATE ** 3;
  modulation *= PI2 / SAMPLE_RATE;
  pitchJump *= PI2 / SAMPLE_RATE;
  pitchJumpTime *= SAMPLE_RATE;
  repeatTime = (repeatTime * SAMPLE_RATE) | 0;
  const length = (attack + decay + sustain + release + delay) | 0;
  for (; i < length; b[i++] = s) {
    if (!(++c % ((bitCrush * 100) | 0))) {
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? Math.sin((t % PI2) ** 3)
              : Math.max(Math.min(Math.tan(t), 1), -1)
            : 1 - (((((2 * t) / PI2) % 2) + 2) % 2)
          : 1 - 4 * Math.abs(Math.round(t / PI2) - t / PI2)
        : Math.sin(t);
      s =
        (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
        Math.sign(s) *
        Math.abs(s) ** shapeCurve *
        volume *
        MASTER *
        (i < attack
          ? i / attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
            : i < attack + decay + sustain
              ? sustainVolume
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume
                : 0);
      s = delay ? s / 2 + (delay > i ? 0 : ((i < length - delay ? 1 : (length - i) / delay) * b[(i - delay) | 0]) / 2) : s;
    }
    const f = (frequency += slide += deltaSlide) * Math.cos(modulation * tm++);
    t += f - f * noise * (1 - ((((Math.sin(i) + 1) * 1e9) % 2) | 0));
    if (j && ++j > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      j = 0;
    }
    if (repeatTime && !(++r % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      j = j || 1;
    }
  }
  return b;
}

// ───────────────────────── 재생 ─────────────────────────
let ctx = null;
let unlocked = false;
let muted = readMuted();
const listeners = new Set();
const buffers = new Map(); // 이름 → AudioBuffer (ZzFX로 만든 것 또는 파일)
const fileChecked = new Map(); // 이름 → Promise (파일 확인 중/끝)
const lastAt = new Map();
let voices = 0;

function readMuted() {
  try {
    const v = localStorage.getItem('sia:sound');
    if (v === 'off') return true;
    if (v === 'on') return false;
    return localStorage.getItem('siatank:mute') === '1';
  } catch {
    return false;
  }
}

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** 첫 사용자 입력 때 오디오를 깨운다 (그 전에는 소리 없음) */
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click'];
function unlock() {
  unlocked = true;
  const a = audio();
  // 오디오가 실제로 깨어날 때까지 입력마다 다시 시도 (휴대폰은 touchend/click에서만 깨어나는 경우가 있다)
  if (a && a.state === 'running') for (const ev of UNLOCK_EVENTS) removeEventListener(ev, unlock, true);
}
if (typeof addEventListener === 'function') for (const ev of UNLOCK_EVENTS) addEventListener(ev, unlock, true);
// 홈 화면 앱(특히 아이폰)은 다른 앱에 다녀오면 오디오가 멈춘 채(interrupted/suspended) 남는다
// → 화면으로 돌아왔을 때 멈춰 있으면 다음 입력에서 다시 깨우도록 걸어 둔다
if (typeof document !== 'undefined' && typeof addEventListener === 'function') {
  const rearm = () => {
    if (document.visibilityState !== 'visible' || !ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    for (const ev of UNLOCK_EVENTS) addEventListener(ev, unlock, true);
  };
  document.addEventListener('visibilitychange', rearm);
  addEventListener('pageshow', rearm);
}

const soundsBase = () => new URL('sounds/', import.meta.url).href;

/** shared/sounds/<이름>.ogg|.mp3 가 있으면 그것을 쓴다 (한 번만 확인) */
function checkFile(name) {
  if (fileChecked.has(name)) return fileChecked.get(name);
  const p = (async () => {
    const a = audio();
    if (!a) return;
    for (const ext of ['ogg', 'mp3']) {
      try {
        const res = await fetch(`${soundsBase()}${name}.${ext}`, { cache: 'force-cache' });
        if (!res.ok) continue;
        const data = await res.arrayBuffer();
        buffers.set(name, await a.decodeAudioData(data));
        return;
      } catch {
        /* 다음 형식 */
      }
    }
  })();
  fileChecked.set(name, p);
  return p;
}

function zzfxBuffer(name) {
  if (buffers.has(name)) return buffers.get(name);
  const a = audio();
  const params = SOUNDS[name];
  if (!a || !params) return null;
  const samples = buildSamples(...params);
  const buf = a.createBuffer(1, samples.length, SAMPLE_RATE);
  buf.getChannelData(0).set(samples);
  buffers.set(name, buf);
  return buf;
}

/**
 * 소리 내기. opts.volume(0~1), opts.rate(재생 속도: 높낮이), opts.delay(ms 뒤에)
 * 소리를 껐거나 첫 입력 전이면 아무것도 하지 않는다.
 */
export function play(name, opts = {}) {
  if (opts.delay > 0) {
    setTimeout(() => play(name, { ...opts, delay: 0 }), opts.delay);
    return;
  }
  if (muted || !unlocked || !SOUNDS[name]) return;
  const now = performance.now();
  const gap = MIN_GAP[name] ?? DEFAULT_GAP;
  if (now - (lastAt.get(name) ?? -1e9) < gap) return;
  const a = audio();
  if (!a || a.state !== 'running') return;
  if (voices >= MAX_VOICES) return;
  lastAt.set(name, now);
  void checkFile(name);
  const buf = buffers.get(name) ?? zzfxBuffer(name);
  if (!buf) return;
  try {
    const src = a.createBufferSource();
    src.buffer = buf;
    if (opts.rate) src.playbackRate.value = opts.rate;
    const g = a.createGain();
    g.gain.value = opts.volume ?? 1;
    src.connect(g).connect(a.destination);
    src.onended = () => (voices = Math.max(0, voices - 1));
    src.start();
    voices++;
  } catch {
    /* 소리는 실패해도 게임은 계속 */
  }
}

/** 여러 번 (칩 여러 개처럼): 짧은 간격으로 count번, 최대 6번 */
export function playMany(name, count, gapMs = 80, opts = {}) {
  const n = Math.min(6, Math.max(1, count | 0));
  for (let i = 0; i < n; i++) play(name, { ...opts, delay: (opts.delay ?? 0) + i * gapMs, rate: (opts.rate ?? 1) * (1 + i * 0.04) });
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = !!m;
  try {
    localStorage.setItem('sia:sound', muted ? 'off' : 'on');
    localStorage.setItem('siatank:mute', muted ? '1' : '0');
  } catch {
    /* 저장 못 해도 이번에는 적용 */
  }
  listeners.forEach((f) => f(muted));
  if (!muted) play('toggle');
}
export const toggleMuted = () => (setMuted(!muted), muted);
/** 켜기/끄기가 바뀌면 cb(muted) → 해제 함수 */
export function onMuteChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ───────────────────────── 배경음 설정 (효과음과 따로 켜고 끈다) ─────────────────────────
let bgmOn = readBgm();
const bgmListeners = new Set();
function readBgm() {
  try {
    return localStorage.getItem('sia:bgm') !== 'off';
  } catch {
    return true;
  }
}
export const isBgmOn = () => bgmOn;
export function setBgmOn(on) {
  bgmOn = !!on;
  try {
    localStorage.setItem('sia:bgm', bgmOn ? 'on' : 'off');
  } catch {
    /* 저장 못 해도 이번에는 적용 */
  }
  bgmListeners.forEach((f) => f(bgmOn));
}
/** 배경음 켜기/끄기가 바뀌면 cb(on) → 해제 함수 */
export function onBgmChange(cb) {
  bgmListeners.add(cb);
  return () => bgmListeners.delete(cb);
}
/** 배경음 파일(shared/sounds/<이름>.ogg|.mp3)이 있으면 그 주소, 없으면 null */
export async function bgmFileUrl(name) {
  for (const ext of ['ogg', 'mp3']) {
    const url = `${soundsBase()}${name}.${ext}`;
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
      if (res.ok && /audio|octet/.test(res.headers.get('content-type') ?? 'audio')) return url;
    } catch {
      /* 다음 형식 */
    }
  }
  return null;
}

/** 오른쪽 아래 사운드 버튼 (DESIGN.md: 원형 흰 버튼) */
export function mountSoundButton(parent = document.body) {
  let b = document.getElementById('sia-sound-btn');
  if (b) return b;
  b = document.createElement('button');
  b.id = 'sia-sound-btn';
  b.type = 'button';
  const paint = () => {
    b.textContent = muted ? '🔇' : '🔊';
    b.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
    b.title = muted ? '소리 켜기' : '소리 끄기';
  };
  b.style.cssText =
    'position:fixed;right:calc(12px + env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom));z-index:90;width:44px;height:44px;border-radius:50%;' +
    'background:var(--white,#fff);border:3px solid var(--outline,#2a1a10);box-shadow:0 3px 0 var(--outline,#2a1a10);font-size:20px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0';
  b.addEventListener('click', () => toggleMuted());
  onMuteChange(paint);
  paint();
  parent.append(b);
  return b;
}

/** (점검용) 소리 파형 만들기 */
export const _buildSamples = (name) => buildSamples(...SOUNDS[name]);
