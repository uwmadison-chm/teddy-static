import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from "path";
import teddyStudy from './vite-plugin-study.ts'

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
  ],
  // Relative base so the build works from any subdirectory
  base: './',
  assetsInclude: ['src/assets/**'],
  server: {
    port: 9000,
  },
})
