/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// GitHub Pages serves project sites from /<repo>/. The deploy workflow sets
// VITE_BASE to "/<repo>/"; local dev and root-domain deployments use "/".
const base = process.env.VITE_BASE ?? '/';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const catalogBase = process.env.VITE_CATALOG_BASE || env.VITE_CATALOG_BASE;
  let catalogOrigin = '';
  if (catalogBase) {
    const url = new URL(catalogBase);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('VITE_CATALOG_BASE must be a public HTTPS release URL without credentials or query parameters.');
    catalogOrigin = url.origin;
  }
  let outputDir = '';
  return {
  base,
  // A remote-catalog build must never copy rebuild inputs into the Pages site.
  publicDir: catalogBase && command === 'build' ? false : 'public',
  plugins: [preact(), {
    name: 'external-catalog-assets',
    configResolved(config) { outputDir = resolve(config.root, config.build.outDir); },
    transformIndexHtml(html) {
      if (!catalogOrigin) return html;
      return html.replace("connect-src 'self'", `connect-src 'self' ${catalogOrigin}`)
        .replace("img-src 'self'", `img-src 'self' ${catalogOrigin}`);
    },
    closeBundle() {
      if (command !== 'build' || !catalogBase || !existsSync('public')) return;
      for (const entry of readdirSync('public')) {
        if (entry !== 'catalog') cpSync(resolve('public', entry), resolve(outputDir, entry), { recursive: true });
      }
    },
  }],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
  };
});
