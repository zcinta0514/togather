import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/**
 * Cloudflare Pages 用的构建配置：只构建前端。
 *
 * 后端（src/server）单独用 esbuild 打成 _worker.js，
 * 由 scripts/build-pages.mjs 负责。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    outDir: 'dist/pages',
    emptyOutDir: true,
  },
});
