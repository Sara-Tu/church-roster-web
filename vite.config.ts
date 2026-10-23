import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

// base 要與 GitHub repo 名稱一致，Pages 才找得到 asset
export default defineConfig({
  base: '/church-roster-web/',
  plugins: [react(), tailwindcss()],
  // src/version.ts 的唯一來源；測試與建置共用同一份 define
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
