import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SIA WORLD 저장소 최상위 (games/finger 에서 두 단계 위). import.meta.url 이 아니라 이 설정 파일이 있는 곳(process.cwd 가 아닌
 * vite 가 아는 패키지 폴더)에서 센다: vite 가 설정을 node_modules/.vite-temp 로 묶어 돌리면 import.meta.url 이 그쪽을 가리켜
 * /shared/*.js 를 못 찾고(소리·PWA 스크립트 404) 게임 HTML 을 대신 돌려주던 것.
 */
const worldOf = (root: string) => resolve(root, '../..');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/**
 * 개발 서버를 배포와 같은 모양으로: 시아핑거는 /games/finger/, 나머지 주소(/index.html, /shared/...)는
 * SIA WORLD 최상위 파일을 그대로 보낸다. 그래서 로그인 화면·공통 모듈이 개발 중에도 똑같이 동작한다.
 */
function siaWorldDev(): Plugin {
  return {
    name: 'sia-world-dev',
    apply: 'serve',
    configureServer(server) {
      const WORLD = worldOf(server.config.root);
      server.middlewares.use(async (req, res, next) => {
        const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        if (path.startsWith('/games/finger/')) return next();
        const file = resolve(WORLD, `.${path.endsWith('/') ? `${path}index.html` : path}`);
        if (!file.startsWith(resolve(WORLD) + sep)) return next();
        try {
          const body = await readFile(file);
          res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
          res.end(body);
        } catch {
          next();
        }
      });
    },
  };
}

// 배포: https://<owner>.github.io/SIA-WORLD/games/finger/ (상대 경로로 빌드해서 어느 주소에 올려도 동작)
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/games/finger/' : './',
  plugins: [siaWorldDev()],
  // 판 시뮬레이션은 supabase/functions/_shared/finger 에 있다 (서버와 같이 쓴다) → 저장소 최상위까지 읽게 한다
  server: { fs: { allow: [worldOf(fileURLToPath(new URL('.', import.meta.url))), worldOf(process.cwd())] } },
  build: { chunkSizeWarningLimit: 2000 },
}));
