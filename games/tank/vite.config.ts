import { defineConfig } from 'vite';

// GitHub Pages: https://<owner>.github.io/sia-tank/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/sia-tank/',
  build: { chunkSizeWarningLimit: 2000 },
});
