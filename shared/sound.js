// SIA WORLD 효과음 (시아탱크 · 시아맞고 · 시아카지노 · 시아레이스 · 시아배구 · 시아서바이벌 · 시아열두길 · 시아팡팡 등 공용).
//
// - 소리는 ZzFX 방식(코드로 파형을 만든다, MIT · Frank Force)으로 만든다. 외부 파일 없음.
// - shared/sounds/<이름>.ogg 또는 .mp3 파일을 넣으면 그 소리를 처음 낼 때 확인해서 파일로 바꿔 쓴다.
// - 켜기/끄기는 브라우저에 저장 (localStorage 'sia:sound'). 시아탱크의 예전 설정('siatank:mute')도 이어받는다.
// - 배경음(BGM) 파일 재생: playBgm(game, scene) — shared/audio/bgm/<게임>/main|boss.mp3, common/main|win|lose.mp3
//   (반복 재생, 볼륨 0.4, 장면이 바뀌면 페이드 아웃 → 페이드 인. 배경음 끄기('sia:bgm')만 따른다 — 효과음 끄기와는 따로.)
// - 배경음 켜기/끄기는 따로 저장 (localStorage 'sia:bgm'). 모든 게임이 playBgm 으로 위 폴더의 곡을 튼다
//   (예전처럼 게임이 코드로 곡을 만들거나 shared/sounds/bgm*.mp3 를 찾지 않는다).
// - 설정 창: openSoundSettings() — 시아레이스처럼 🎵 배경음 · 🔊 효과음을 따로 켜기/끄기. 모든 게임의 ⚙️ 버튼이 이 창을 연다.
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
  // 시아팡팡 (터뜨림은 콤보마다 rate 로 높아진다. 클리어·실패·최고 기록은 win · lose · newRecord 를 같이 쓴다)
  pangSwap: [0.35, 0.05, 520, 0, 0.02, 0.07, 1, 1.2, 12],
  pangNope: [0.4, 0, 240, 0, 0.03, 0.1, 1, 1.4, -4],
  pangPop: [0.5, 0.05, 700, 0, 0.02, 0.1, 1, 1.6, 0, 0, 350, 0.03],
  pangMake: [0.55, 0, 880, 0.01, 0.08, 0.22, 1, 1.4, 8, 0, 440, 0.05],
  pangBlast: [0.7, 0.05, 160, 0, 0.06, 0.3, 4, 2, -0.6, 0, 0, 0, 0, 1.4],
  pangOrb: [0.6, 0, 1047, 0.01, 0.2, 0.4, 0, 1.2, 0, 0, 262, 0.05, 0.05, 0, 20],
  pangIce: [0.45, 0.1, 2200, 0, 0.01, 0.08, 4, 1.4, -20, 0, 0, 0, 0, 0.8],
  pangBox: [0.6, 0.05, 140, 0, 0.02, 0.1, 4, 2, -1.2, 0, 0, 0, 0, 1.2],
  pangVine: [0.4, 0.05, 420, 0, 0.02, 0.08, 4, 1.6, -6, 0, 0, 0, 0, 1],
  pangBonus: [0.4, 0, 1320, 0, 0.02, 0.08, 1, 1.5, 0, 0, 660, 0.02],
  pangTap: [0.45, 0.05, 600, 0, 0.03, 0.12, 0, 1.2, 10],
  // 시아블록: 집기 · 놓기 · 못 놓음 · 줄 지우기(rate 로 줄 수만큼 높게) · 콤보 · 판 비우기 · 게임 끝
  blockPick: [0.35, 0.05, 640, 0, 0.01, 0.05, 1, 1.3, 12],
  blockPlace: [0.5, 0.05, 240, 0, 0.012, 0.07, 1, 1.8, -5, 0, 0, 0, 0, 0.6],
  blockNope: [0.4, 0, 210, 0, 0.03, 0.12, 1, 1.4, -5],
  blockClear: [0.55, 0.05, 660, 0, 0.03, 0.2, 1, 1.5, 0, 0, 330, 0.04],
  blockCombo: [0.6, 0, 523, 0.01, 0.1, 0.25, 1, 1.4, 6, 0, 262, 0.05],
  blockPerfect: [0.7, 0, 784, 0.02, 0.25, 0.5, 0, 1.3, 0, 0, 392, 0.08, 0.08, 0, 15],
  blockOver: [0.55, 0, 300, 0.02, 0.12, 0.5, 1, 1.2, -1.2],
};

/** 이름별 최소 간격(ms): 칩 여러 개 → 짧은 간격으로 한 번씩 */
const MIN_GAP = { chip: 60, deal: 60, tick: 120, spinTick: 45, flip: 60, click: 40, step: 130, jump: 60, land: 60, slide: 60, volleyHit: 50, volleyWall: 50, volleyNet: 50, survShot: 80, survSlash: 80, survPop: 80, survHurt: 150, twelveSlash: 80, twelveBow: 80, twelveMagic: 80, twelveHurt: 150, pangSwap: 60, pangPop: 70, pangIce: 60, pangBox: 60, pangVine: 60, pangBonus: 70, pangTap: 80, blockPick: 50, blockPlace: 50, blockNope: 80, blockClear: 60 };
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
  bgmKick(); // 배경음: 첫 입력(사용자 동작) 안에서 재생을 시작해야 휴대폰이 허락한다
  // 오디오가 실제로 깨어날 때까지 입력마다 다시 시도 (휴대폰은 touchend/click에서만 깨어나는 경우가 있다)
  // 배경음을 틀어야 하는데 아직 안 틀었으면 감시를 남긴다: 나중에(로그인 뒤 등) 사용자 동작 밖에서 부른 play() 는 아이폰이 거절한다
  if (a && a.state === 'running' && bgmSettled()) for (const ev of UNLOCK_EVENTS) removeEventListener(ev, unlock, true);
}
/** 입력 감시를 (다시) 붙인다 — 같은 함수라 여러 번 붙여도 한 번만 걸린다 */
function armUnlock() {
  if (typeof addEventListener === 'function') for (const ev of UNLOCK_EVENTS) addEventListener(ev, unlock, true);
}
armUnlock();
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
  bgmApply();
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
  bgmApply();
}
/** 배경음 켜기/끄기가 바뀌면 cb(on) → 해제 함수 */
export function onBgmChange(cb) {
  bgmListeners.add(cb);
  return () => bgmListeners.delete(cb);
}
/**
 * shared/sounds/<이름>.ogg|.mp3 파일이 있으면 그 주소, 없으면 null.
 * 이름과 달리 지금은 배경음에 쓰지 않는다 (배경음은 playBgm · shared/audio/bgm/).
 * 시아마을 전용 효과음을 파일로 바꿔 끼울 때만 쓴다 (games/village/src/ui/vsound.ts). 예전 탭이 부를 수 있어 이름은 그대로 둔다.
 */
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

// ───────────────────────── 배경음(BGM) 파일 재생 ─────────────────────────
// 오디오 요소는 하나만 쓴다: 휴대폰(특히 아이폰)은 사용자 입력 안에서 한 번 재생한 요소만 나중에 마음대로 재생할 수 있어서,
// 첫 터치 때 깨운 요소를 계속 다시 쓴다. 곡 바꾸기 = 페이드 아웃 → 주소 바꾸기 → 페이드 인.
// 소리 크기는 AudioContext 의 GainNode 로 조절한다 (아이폰은 audio.volume 을 바꿀 수 없다). AudioContext 가 없으면 volume.
export const BGM_VOLUME = 0.4;
const BGM_FADE_OUT = 600;
const BGM_FADE_IN = 900;
const BGM_ONCE = new Set(['win', 'lose']); // 한 번만 (끝나면 조용히)
const bgmBase = () => new URL('audio/bgm/', import.meta.url).href;
let bgmEl = null;
let bgmGain = null; // GainNode (없으면 el.volume)
let bgmWant = null; // { game, scene, tries: [주소…], i }
let bgmNow = null; // 지금 요소에 걸린 주소
let bgmBusy = null; // 진행 중인 바꾸기 (Promise)
let bgmLevel = 0; // 지금 크기 (0~1, BGM_VOLUME 곱하기 전)
let bgmRamp = 0;
let bgmRampTo = -1; // 지금 진행 중인 페이드의 목표 (-1 = 없음)
let bgmRampOwner = 0; // bgmRampTo 를 건 페이드의 번호

/** 장면 → 차례로 찾아볼 파일들 (없으면 다음 것): 보스 → 그 게임 main → 로비 곡 */
function bgmTries(game, scene) {
  const f = (g, n) => `${bgmBase()}${g}/${n}.mp3`;
  if (BGM_ONCE.has(scene)) return [f('common', scene)];
  if (!game || game === 'common' || game === 'lobby') return [f('common', 'main')];
  const list = scene === 'boss' ? [f(game, 'boss'), f(game, 'main')] : [f(game, 'main')];
  list.push(f('common', 'main'));
  return list;
}
function bgmAllowed() {
  return bgmOn && unlocked && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
}
function bgmElement() {
  if (bgmEl) return bgmEl;
  if (typeof Audio === 'undefined') return null;
  const el = new Audio();
  el.preload = 'auto';
  el.setAttribute('playsinline', '');
  el.addEventListener('error', () => {
    // 파일이 없거나 못 읽음 → 다음 후보
    if (!bgmWant || el.getAttribute('src') !== bgmNow) return;
    bgmWant.i++;
    bgmNow = null;
    bgmApply();
  });
  bgmEl = el;
  const a = audio();
  if (a && a.createMediaElementSource) {
    try {
      bgmGain = a.createGain();
      bgmGain.gain.value = 0;
      a.createMediaElementSource(el).connect(bgmGain).connect(a.destination);
    } catch {
      bgmGain = null;
    }
  }
  setLevel(0);
  return el;
}
function setLevel(v) {
  bgmLevel = Math.max(0, Math.min(1, v));
  const out = bgmLevel * BGM_VOLUME;
  if (bgmGain) bgmGain.gain.value = out;
  else if (bgmEl) bgmEl.volume = out;
}
/** 지금 크기에서 to 까지 ms 동안 */
function fadeTo(to, ms) {
  const id = ++bgmRamp;
  bgmRampTo = to;
  bgmRampOwner = id;
  const from = bgmLevel;
  const t0 = performance.now();
  return new Promise((done) => {
    const step = () => {
      if (id !== bgmRamp) {
        // 끊김: 새 페이드가 목표를 다시 걸지 않았으면 (숨김 등) 목표를 지운다 → 돌아왔을 때 다시 튼다
        if (bgmRampOwner === id) bgmRampTo = -1;
        return done(false);
      }
      const k = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1;
      setLevel(from + (to - from) * k);
      if (k >= 1) {
        bgmRampTo = -1;
        return done(true);
      }
      setTimeout(step, 30); // requestAnimationFrame 은 가려진 탭에서 멈춘다
    };
    step();
  });
}
/** 배경음 쪽에서 더 입력을 기다릴 일이 없는지 (원하지 않음 · 이미 재생 중 · 한 번만 트는 곡이 끝남) */
function bgmSettled() {
  if (!bgmWant || !bgmOn) return true;
  const url = bgmWant.tries[bgmWant.i];
  if (!url) return true;
  return !!bgmEl && bgmNow === url && (!bgmEl.paused || bgmEl.ended);
}
/** play() 가 거절되면(사용자 동작 밖) 다음 입력 때 다시 시도하도록 감시를 붙인다 */
function bgmRefused() {
  if (bgmWant && bgmOn) armUnlock();
}
/** 첫 입력 안에서: 요소를 만들고 바로 재생을 시작한다 (휴대폰 허락) */
function bgmKick() {
  if (!bgmWant || !bgmOn || bgmBusy) return; // 곡 바꾸는 중이면 그쪽이 튼다
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const el = bgmElement();
  if (!el) return;
  const url = bgmWant.tries[bgmWant.i];
  if (!url) return;
  if (bgmNow !== url) {
    bgmNow = url;
    el.src = url;
    el.loop = !BGM_ONCE.has(bgmWant.scene);
  } else if (el.ended) return; // 한 번만 트는 곡이 이미 끝남
  if (el.paused) el.play().then(() => fadeTo(1, BGM_FADE_IN)).catch(bgmRefused);
}
/** 지금 원하는 곡·설정에 맞춘다 */
function bgmApply() {
  if (bgmBusy) return void bgmBusy.then(() => bgmApply());
  const el = bgmEl;
  if (!bgmAllowed() || !bgmWant || !bgmWant.tries[bgmWant.i]) {
    // 가려진 탭은 바로 멈춘다 (가려진 탭의 타이머는 느려서 페이드가 길게 늘어진다)
    if (el && !el.paused && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      bgmRamp++;
      bgmRampTo = -1; // 끊은 페이드의 목표를 지운다 (안 지우면 돌아왔을 때 '커지는 중'으로 보여 다시 틀지 않는다)
      setLevel(0);
      el.pause();
      return;
    }
    if (el && !el.paused) bgmBusy = fadeTo(0, BGM_FADE_OUT).then((ok) => { if (ok) el.pause(); bgmBusy = null; });
    return;
  }
  const url = bgmWant.tries[bgmWant.i];
  const target = bgmElement();
  if (!target) return;
  if (bgmNow === url) {
    // 같은 곡: 멈춰 있었으면 이어서 (한 번만 트는 곡이 이미 끝났으면 다시 틀지 않는다)
    if (target.paused && !target.ended && bgmRampTo !== 1) target.play().then(() => fadeTo(1, BGM_FADE_IN)).catch(bgmRefused);
    // 이미 커지는 중이면 그대로 둔다 (매 프레임 불러도 페이드가 처음부터 다시 시작되지 않게)
    else if (!target.paused && bgmLevel < 1 && bgmRampTo !== 1) void fadeTo(1, BGM_FADE_IN);
    return;
  }
  bgmBusy = (async () => {
    if (!target.paused && bgmNow) await fadeTo(0, BGM_FADE_OUT);
    if (!bgmWant || bgmWant.tries[bgmWant.i] !== url || !bgmAllowed()) return; // 그 사이 바뀜 → 다시 맞춘다
    bgmNow = url;
    setLevel(0);
    target.src = url;
    target.loop = !BGM_ONCE.has(bgmWant.scene);
    try {
      await target.play();
      void fadeTo(1, BGM_FADE_IN);
    } catch {
      bgmRefused(); // 재생 거절(사용자 동작 밖) → 다음 입력 때 bgmKick
    }
  })().finally(() => {
    bgmBusy = null;
  });
  void bgmBusy.then(() => {
    if (bgmWant && bgmAllowed() && bgmNow !== bgmWant.tries[bgmWant.i]) bgmApply();
  });
}

/**
 * 배경음 틀기. game = games/ 폴더 이름('pang', 'tank' …) 또는 'common'(로비).
 * scene = 'main'(기본) | 'boss'(보스·긴장) | 'win' | 'lose' (승리·패배는 common/ 의 곡을 한 번만).
 * 같은 곡이면 아무 일도 없다. 파일이 없으면 보스 → 그 게임 main → 로비 곡 차례로.
 * 배경음 끄기·첫 입력 전·가려진 탭에서는 조용히 기다렸다가 풀리면 튼다.
 */
export function playBgm(game, scene = 'main') {
  const g = game || 'common';
  if (bgmWant && bgmWant.game === g && bgmWant.scene === scene) {
    bgmApply();
    return;
  }
  bgmWant = { game: g, scene, tries: bgmTries(g, scene), i: 0 };
  bgmApply();
}
/** 배경음 끄기 (페이드 아웃) */
export function stopBgm() {
  bgmWant = null;
  bgmApply();
}
/** 지금 틀려는 배경음 { game, scene } 또는 null */
export const currentBgm = () => (bgmWant ? { game: bgmWant.game, scene: bgmWant.scene } : null);
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => bgmApply());
  if (typeof addEventListener === 'function') addEventListener('pagehide', () => bgmEl && bgmEl.pause());
}

// ───────────────────────── 소리 설정 창 (시아레이스와 같은 모양) ─────────────────────────
const SET_CSS = `
.sia-snd-dim{position:fixed;inset:0;z-index:2000;background:var(--dim,rgba(42,26,16,.55));display:grid;place-items:center;padding:16px;font-family:var(--font,inherit)}
.sia-snd-dlg{width:min(340px,100%);box-sizing:border-box;background:var(--panel,#fff8e8);color:var(--ink,#2a1a10);border:var(--line-big,4px) solid var(--outline,#2a1a10);border-radius:var(--radius-panel-big,28px);box-shadow:0 var(--depth-big,8px) 0 var(--outline,#2a1a10);padding:16px}
.sia-snd-dlg h3{margin:0 0 12px;font-weight:normal;font-size:22px;text-align:center}
.sia-snd-dlg .sia-snd-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 2px;font-size:17px;border-bottom:2px dashed var(--line-soft,#e2d3b5)}
.sia-snd-seg{display:flex;gap:6px}
.sia-snd-seg button{font:inherit;color:inherit;border:var(--line-thin,2px) solid var(--outline,#2a1a10);background:var(--white,#fff);border-radius:var(--radius-item,12px);padding:5px 14px;font-size:15px;cursor:pointer}
.sia-snd-seg button.sel{background:var(--primary,#ffd34d);box-shadow:0 3px 0 var(--outline,#2a1a10)}
.sia-snd-close{display:block;width:100%;margin-top:14px;font:inherit;font-size:var(--fs-button,18px);color:inherit;background:var(--primary,#ffd34d);border:var(--line,3px) solid var(--outline,#2a1a10);border-radius:var(--radius-button,16px);box-shadow:0 var(--depth-button,4px) 0 var(--outline,#2a1a10);padding:10px;cursor:pointer}
.sia-snd-close:active{transform:translateY(3px);box-shadow:0 1px 0 var(--outline,#2a1a10)}`;
function setCss() {
  if (document.getElementById('sia-snd-css')) return;
  const st = document.createElement('style');
  st.id = 'sia-snd-css';
  st.textContent = SET_CSS;
  document.head.append(st);
}
/** 설정 창이 열려 있는지 (게임이 Esc 등으로 일시정지를 풀 때 확인) */
export const isSoundSettingsOpen = () => typeof document !== 'undefined' && !!document.querySelector('.sia-snd-dim');
/**
 * ⚙️ 설정 창: 🎵 배경음 · 🔊 효과음을 따로 켜기/끄기 (시아레이스와 같은 모양, 모든 게임 공용).
 * onClose: 창을 닫을 때 (일시정지 화면으로 돌아가기 등). 이미 열려 있으면 그 창을 돌려준다.
 */
export function openSoundSettings(onClose) {
  const old = document.querySelector('.sia-snd-dim');
  if (old) {
    if (onClose) old._siaOnClose = onClose; // 마지막에 받은 것으로 바꿔 끼운다
    return old;
  }
  setCss();
  play('click');
  const dim = document.createElement('div');
  dim.className = 'sia-snd-dim';
  dim._siaOnClose = onClose;
  const seg = (k, on) =>
    `<div class="sia-snd-seg" data-k="${k}"><button type="button" data-v="1" class="${on ? 'sel' : ''}" aria-pressed="${on}">켜기</button><button type="button" data-v="0" class="${on ? '' : 'sel'}" aria-pressed="${!on}">끄기</button></div>`;
  const paint = () => {
    dim.innerHTML = `<div class="sia-snd-dlg" role="dialog" aria-modal="true" aria-label="설정">
      <h3>⚙️ 설정</h3>
      <div class="sia-snd-row"><span>🎵 배경음</span>${seg('bgm', bgmOn)}</div>
      <div class="sia-snd-row"><span>🔊 효과음</span>${seg('sfx', !muted)}</div>
      <button type="button" class="sia-snd-close" data-close>닫기</button>
    </div>`;
  };
  const close = () => {
    play('click');
    dim.remove();
    removeEventListener('keydown', onKey, true);
    dim._siaOnClose?.();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  paint();
  // 게임 화면(캔버스·조이스틱)에 입력이 새지 않게 여기서 막는다
  for (const t of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup']) dim.addEventListener(t, (e) => e.stopPropagation());
  dim.addEventListener('click', (e) => {
    e.stopPropagation();
    const el = e.target;
    if (el === dim || el.closest('[data-close]')) return close();
    const b = el.closest('.sia-snd-seg button');
    if (!b) return;
    const on = b.dataset.v === '1';
    if (b.parentElement.dataset.k === 'bgm') {
      if (on !== bgmOn) setBgmOn(on);
    } else if (on === muted) setMuted(!on);
    paint();
  });
  addEventListener('keydown', onKey, true);
  document.body.append(dim);
  dim.querySelector('[data-close]')?.focus({ preventScroll: true });
  return dim;
}

/** 오른쪽 아래 ⚙️ 설정 버튼 (DESIGN.md: 원형 흰 버튼). 누르면 소리 설정 창 */
export function mountSoundButton(parent = document.body) {
  let b = document.getElementById('sia-sound-btn');
  if (b) return b;
  b = document.createElement('button');
  b.id = 'sia-sound-btn';
  b.type = 'button';
  b.textContent = '⚙️';
  b.setAttribute('aria-label', '소리 설정');
  b.title = '소리 설정';
  b.style.cssText =
    'position:fixed;right:calc(12px + env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom));z-index:90;width:44px;height:44px;border-radius:50%;' +
    'background:var(--white,#fff);border:3px solid var(--outline,#2a1a10);box-shadow:0 3px 0 var(--outline,#2a1a10);font-size:20px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0';
  b.addEventListener('click', () => openSoundSettings());
  parent.append(b);
  return b;
}

/** (점검용) 소리 파형 만들기 */
export const _buildSamples = (name) => buildSamples(...SOUNDS[name]);
