import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "path";
import mkcert from 'vite-plugin-mkcert'

const hostname = 'https://localhost:8000';

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    }
  },
  plugins: [
    react(),
    tsconfigPaths(),
    mkcert({
      savePath: resolve(__dirname, "../certs/"),
      keyFileName: "key.pem",
      certFileName: "cert.pem",
    }),
  ],
  assetsInclude: ['src/assets/**'],
  server: {
    host: true,
    port: 9000,
    cors: true,
    proxy: {
      '/api': {target:hostname, secure: false, changeOrigin: true},
      '/static': {target:hostname, secure: false, changeOrigin: true},
      '/admin': {target:hostname, secure: false, changeOrigin: true},
      '/media': {target:hostname, secure: false, changeOrigin: true},
    },
  },
})
