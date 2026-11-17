import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** SIA WORLD 저장소 최상위 */
const WORLD = fileURLToPath(new URL('..', import.meta.url));
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** 개발 서버: /games/ 밖의 주소(/index.html, /shared/...)는 SIA WORLD 최상위 파일을 그대로 보낸다 (배포와 같은 모양) */
function siaWorldDev(): Plugin {
  return {
    name: 'sia-world-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        if (path.startsWith('/games/')) return next();
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

// 시아맞고 · 시아카지노(포커/블랙잭) 여러 페이지. 배포: _site/games/ 아래 (시아탱크는 따로 빌드)
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/games/' : './',
  plugins: [siaWorldDev()],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        matgo: here('matgo/index.html'),
        casino: here('casino/index.html'),
        poker: here('casino/poker/index.html'),
        holdem: here('casino/holdem/index.html'),
        roulette: here('casino/roulette/index.html'),
        blackjack: here('casino/blackjack/index.html'),
      },
    },
  },
}));
