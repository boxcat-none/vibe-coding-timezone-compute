import { defineConfig } from 'vite';

export default defineConfig({
  // 使用相對路徑，方便部署到 GitHub Pages 等子路徑
  base: './',
  // 讓同網路的手機、平板可以連進來測試
  server: { host: true },
  build: {
    rollupOptions: {
      output: {
        // three.js 獨立成一個檔案，方便瀏覽器快取
        manualChunks: { three: ['three'] },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
