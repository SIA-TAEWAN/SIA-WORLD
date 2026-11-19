import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 규칙 엔진(supabase/functions/_shared/*.test.ts) 단위 테스트
export default defineConfig({
  test: {
    dir: fileURLToPath(new URL('../supabase/functions/_shared', import.meta.url)),
    include: ['**/*.test.ts'],
    // 무작위 수백 판 테스트는 CI 기계에서 5초를 넘길 수 있다
    testTimeout: 180_000,
  },
  server: { fs: { allow: ['..'] } },
});
