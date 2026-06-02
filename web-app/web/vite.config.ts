/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + WS to the local server so the browser can use
// same-origin relative URLs in both dev and production.
const SERVER_ORIGIN = 'http://localhost:8787';
const WS_ORIGIN = 'ws://localhost:8787';

export default defineConfig({
  plugins: [react()],
  // The shared contract ships as CommonJS (`module.exports = {...}`). Pre-bundle
  // it so Vite/Rollup can resolve its named runtime exports (WS_PATH, S2C, ...).
  optimizeDeps: {
    include: ['@open-cluely/contract']
  },
  server: {
    proxy: {
      '/api': { target: SERVER_ORIGIN, changeOrigin: true },
      '/ws': { target: WS_ORIGIN, ws: true, changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    commonjsOptions: {
      // Match the contract by its real resolved path (a junction points the
      // package outside node_modules) so its CJS exports get transformed.
      include: [/packages[\\/]contract/, /node_modules/],
      transformMixedEsModules: true
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false
  }
});
