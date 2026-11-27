// 후보 중 하나를 골라 실제 효과음으로 쓴다.
//
//   node scripts/sound-pick.mjs deal 2     ← _candidates/deal/2.mp3 → shared/sounds/deal.mp3
//   node scripts/sound-pick.mjs deal off   ← 파일을 지우고 다시 ZzFX 소리로
//
// - ffmpeg 가 있으면 앞쪽 무음을 잘라서 넣는다 (누르자마자 소리가 나도록). 없으면 그대로 복사.
// - 출처는 shared/sounds/CREDITS.md 에 적는다 (CC0 라 필수는 아니지만 관리용).
// - shared/sound.js 는 shared/sounds/<이름>.mp3 가 있으면 자동으로 그 파일을 쓴다 (코드 수정 없음).
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeIndex } from './sound-find.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOUNDS_DIR = path.join(ROOT, 'shared', 'sounds');
const CAND_DIR = path.join(SOUNDS_DIR, '_candidates');
const CREDITS = path.join(SOUNDS_DIR, 'CREDITS.md');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function setCredit(name, line) {
  const head = '# 효과음 출처\n\nshared/sounds/<이름>.mp3 파일의 출처 (scripts/sound-pick.mjs 가 적는다).\n\n';
  let lines = fs.existsSync(CREDITS)
    ? fs.readFileSync(CREDITS, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('- '))
    : [];
  lines = lines.filter((l) => !l.startsWith(`- ${name}:`));
  if (line) lines.push(line);
  lines.sort();
  fs.writeFileSync(CREDITS, head + lines.join('\n') + '\n');
}

function hasFfmpeg() {
  try {
    cp.execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const [name, choice] = process.argv.slice(2);
if (!name || !choice) fail('사용법: node scripts/sound-pick.mjs <이름> <번호|off>');
const out = path.join(SOUNDS_DIR, `${name}.mp3`);

if (choice === 'off') {
  for (const e of ['mp3', 'ogg']) fs.rmSync(path.join(SOUNDS_DIR, `${name}.${e}`), { force: true });
  setCredit(name, null);
  writeIndex();
  console.log(`✔ ${name}: 파일을 지웠어요. 다시 ZzFX 소리가 나요.`);
  process.exit(0);
}

const metaFile = path.join(CAND_DIR, name, 'meta.json');
if (!fs.existsSync(metaFile)) fail(`${name} 후보가 없어요. 먼저 node scripts/sound-find.mjs ${name}`);
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const it = meta.items.find((x) => String(x.n) === String(choice));
if (!it) fail(`${name} 후보에 ${choice}번이 없어요 (1~${meta.items.length}).`);
const src = path.join(CAND_DIR, name, `${it.n}.mp3`);

fs.mkdirSync(SOUNDS_DIR, { recursive: true });
fs.rmSync(path.join(SOUNDS_DIR, `${name}.ogg`), { force: true }); // ogg 가 있으면 그게 먼저 쓰이므로
let trimmed = false;
if (hasFfmpeg()) {
  try {
    cp.execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src,
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB', '-ac', '1', '-b:a', '96k', out], { stdio: 'ignore' });
    trimmed = fs.existsSync(out) && fs.statSync(out).size > 0;
  } catch {
    /* 아래에서 그대로 복사 */
  }
}
if (!trimmed) {
  fs.copyFileSync(src, out);
  console.log('  (ffmpeg 로 다듬지 못해서 그대로 복사했어요)');
}
setCredit(name, `- ${name}: "${it.name}" by ${it.username} — ${it.url} (CC0)`);
writeIndex();
console.log(`✔ ${name} ← ${it.n}번 "${it.name}" (${it.username})\n  shared/sounds/${name}.mp3 에 넣었어요. 게임을 새로고침하면 바로 바뀌어요.`);
