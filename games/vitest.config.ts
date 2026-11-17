import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 규칙 엔진(supabase/functions/_shared/*.test.ts) 단위 테스트
export default defineConfig({
  test: {
    dir: fileURLToPath(new URL('../supabase/functions/_shared', import.meta.url)),
    include: ['**/*.test.ts'],
  },
  server: { fs: { allow: ['..'] } },
});
