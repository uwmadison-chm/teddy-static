import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from "path";
import teddyStudy from './vite-plugin-study.ts'
import teddyCompress from './vite-plugin-compress.ts'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    }
  },
  plugins: [
    react(),
    teddyStudy(),
    teddyCompress(),
  ],
  // Relative base so the build works from any subdirectory
  base: './',
  assetsInclude: ['src/assets/**/*.shard'],
  server: {
    port: 9000,
  },
})
