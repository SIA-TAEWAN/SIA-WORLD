// Freesound 에서 효과음 후보를 찾아 받는다 (CC0 · 짧은 소리만).
//
//   node scripts/sound-find.mjs deal flip slap chip    ← 이 소리들만
//   node scripts/sound-find.mjs                        ← scripts/sound-search.json 에 있는 소리 전부
//   node scripts/sound-find.mjs deal --n 8             ← 후보 개수 (기본 5)
//
// - API 키: 저장소 최상위 .env.local 의 FREESOUND_API_KEY (git 에 올리지 않는다).
// - 받는 것은 미리듣기 MP3(약 128kbps). 원본 WAV 는 OAuth 가 필요해서 받지 않는다.
// - 후보는 shared/sounds/_candidates/<이름>/1.mp3 … 에 들어가고 (git 에 안 올라감),
//   지금 쓰는 ZzFX 소리도 current.wav 로 같이 만들어서 _candidates/index.html 에서 비교해 들을 수 있다.
// - 고르기: node scripts/sound-pick.mjs <이름> <번호>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOUNDS_DIR = path.join(ROOT, 'shared', 'sounds');
const CAND_DIR = path.join(SOUNDS_DIR, '_candidates');
const API = 'https://freesound.org/apiv2';

function readKey() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) fail('.env.local 이 없어요. 최상위 폴더에 FREESOUND_API_KEY=키 를 넣어 주세요.');
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*FREESOUND_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  fail('.env.local 에 FREESOUND_API_KEY=키 줄이 없어요.');
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function search(key, query, maxSec, size) {
  const params = new URLSearchParams({
    query,
    filter: `license:"Creative Commons 0" duration:[0.05 TO ${maxSec}]`,
    sort: 'rating_desc',
    fields: 'id,name,username,license,duration,previews,url,avg_rating,num_downloads',
    page_size: String(size),
  });
  const headers = { Authorization: `Token ${key}` };
  // 새 주소(search/)가 안 되면 예전 주소(search/text/)로
  for (const ep of ['search/', 'search/text/']) {
    const res = await fetch(`${API}/${ep}?${params}`, { headers });
    if (res.status === 401 || res.status === 403) fail('API 키가 맞지 않아요. .env.local 의 FREESOUND_API_KEY 를 확인해 주세요.');
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`검색 실패 ${res.status}: ${await res.text()}`);
    return (await res.json()).results ?? [];
  }
  throw new Error('검색 주소를 찾지 못했어요');
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`받기 실패 ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** 지금 쓰는 ZzFX 소리를 WAV 로 (비교용) */
function writeWav(file, samples, rate = 44100) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s || 0)) * 32767 | 0, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** _candidates/index.html: 소리별로 지금 소리 · 후보를 들어보고 고르기 명령을 복사 */
export function writeIndex() {
  if (!fs.existsSync(CAND_DIR)) return;
  const names = fs.readdirSync(CAND_DIR).filter((n) => fs.existsSync(path.join(CAND_DIR, n, 'meta.json'))).sort();
  const sections = names.map((name) => {
    const meta = JSON.parse(fs.readFileSync(path.join(CAND_DIR, name, 'meta.json'), 'utf8'));
    const chosen = ['mp3', 'ogg'].find((e) => fs.existsSync(path.join(SOUNDS_DIR, `${name}.${e}`)));
    const now = chosen
      ? `<div class="row now"><b>지금 (파일)</b><audio controls preload="none" src="../${name}.${chosen}"></audio><code>node scripts/sound-pick.mjs ${name} off</code><span>← ZzFX 로 되돌리기</span></div>`
      : '';
    const zz = fs.existsSync(path.join(CAND_DIR, name, 'current.wav'))
      ? `<div class="row"><b>ZzFX</b><audio controls preload="none" src="${name}/current.wav"></audio><span>지금 코드로 만드는 소리</span></div>`
      : '';
    const rows = meta.items.map((it) => `<div class="row"><b>${it.n}</b><audio controls preload="none" src="${name}/${it.n}.mp3"></audio>
      <code>node scripts/sound-pick.mjs ${name} ${it.n}</code>
      <span>${esc(it.name)} · ${esc(it.username)} · ${it.duration.toFixed(2)}초 · <a href="${esc(it.url)}" target="_blank">Freesound</a></span></div>`).join('\n');
    return `<section><h2>${name} <small>${esc(meta.queries.join(' / '))}</small></h2>${now}${zz}${rows}</section>`;
  });
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>효과음 후보</title>
<style>body{font-family:system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;background:#fdf6ec;color:#2a1a10}
h1{font-size:22px}h2{font-size:18px;margin:28px 0 8px}h2 small{font-weight:400;color:#8a7060;font-size:13px}
section{background:#fff;border:2px solid #2a1a10;border-radius:12px;padding:8px 16px 14px}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 0;border-top:1px solid #eee}
.row b{width:70px}.row.now{background:#fff3d6}audio{height:32px}
code{background:#2a1a10;color:#fff;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:13px}code.ok{background:#2e8b57}
span{font-size:12px;color:#6b5546}</style>
<h1>효과음 후보 <small style="font-size:13px;font-weight:400">· 명령어를 누르면 복사돼요. SIA-WORLD 폴더의 터미널에 붙여 넣어 실행하세요.</small></h1>
${sections.join('\n') || '<p>후보가 없어요. node scripts/sound-find.mjs 를 먼저 실행하세요.</p>'}
<script>document.querySelectorAll('code').forEach(c=>c.onclick=()=>{navigator.clipboard.writeText(c.textContent);c.classList.add('ok');setTimeout(()=>c.classList.remove('ok'),800)})</script></html>`;
  fs.writeFileSync(path.join(CAND_DIR, 'index.html'), html);
}

async function main() {
  const args = process.argv.slice(2);
  let count = 5;
  const ni = args.indexOf('--n');
  if (ni >= 0) { count = Math.max(1, Math.min(15, Number(args[ni + 1]) || 5)); args.splice(ni, 2); }

  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'sound-search.json'), 'utf8'));
  delete presets._설명;
  const names = args.length ? args : Object.keys(presets);
  const unknown = names.filter((n) => !presets[n]);
  if (unknown.length) fail(`scripts/sound-search.json 에 검색어가 없는 소리: ${unknown.join(', ')}\n  그 파일에 "이름": { "queries": ["검색어"], "maxSec": 1 } 을 추가해 주세요.`);

  const key = readKey();
  let zzfx = null;
  try {
    zzfx = await import(pathToFileURL(path.join(ROOT, 'shared', 'sound.js')).href);
  } catch {
    /* 비교용 ZzFX 소리는 없어도 된다 */
  }

  for (const name of names) {
    const { queries, maxSec = 2 } = presets[name];
    process.stdout.write(`• ${name} … `);
    const seen = new Set();
    const picked = [];
    for (const q of queries) {
      for (const r of await search(key, q, maxSec, count * 2)) {
        if (seen.has(r.id) || !r.previews?.['preview-hq-mp3']) continue;
        seen.add(r.id);
        picked.push(r);
      }
    }
    // 검색어마다 번갈아 섞지 않고, 평점 순 그대로 앞에서 count 개
    const items = picked.slice(0, count);
    const dir = path.join(CAND_DIR, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const meta = { name, queries, items: [] };
    for (const [i, r] of items.entries()) {
      const n = i + 1;
      await download(r.previews['preview-hq-mp3'], path.join(dir, `${n}.mp3`));
      meta.items.push({ n, id: r.id, name: r.name, username: r.username, url: r.url, license: r.license, duration: r.duration });
    }
    if (zzfx?._buildSamples && zzfx.SOUNDS?.[name]) writeWav(path.join(dir, 'current.wav'), zzfx._buildSamples(name));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    console.log(items.length ? `후보 ${items.length}개` : '찾은 소리가 없어요 (sound-search.json 의 검색어나 maxSec 를 바꿔 보세요)');
  }

  writeIndex();
  console.log(`\n✔ 들어보기: ${path.join(CAND_DIR, 'index.html')}  (파일 탐색기에서 더블클릭)`);
  console.log('  고르기:   node scripts/sound-pick.mjs <이름> <번호>\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => fail(e.message));
