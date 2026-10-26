import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from "path";
import qualityCheckSettings from './vite-plugin-quality-check.ts'
import teddyCompress from './vite-plugin-compress.ts'

// The quality-check page: a build of its own, separate from any study. See the
// README's "Quality check" section.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    }
  },
  plugins: [
    react(),
    qualityCheckSettings(),
    teddyCompress(),
  ],
  base: './',
  build: {
    outDir: 'dist-quality-check',
    rollupOptions: {
      input: resolve(import.meta.dirname, "quality-check.html"),
    },
  },
  server: {
    port: 9001,
    open: '/quality-check.html',
  },
})
