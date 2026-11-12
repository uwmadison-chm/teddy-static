import type { Plugin } from 'vite'

// Rive only asks for its WASM once Teddy first mounts, after index.js has
// downloaded and run. A preload hint lets the browser fetch it alongside
// index.js instead. Rive loads it with fetch(url, {credentials: "same-origin"}),
// which a crossorigin preload matches, so the browser reuses the response.
export default function teddyPreloadRive(): Plugin {
    return {
        name: 'teddy-preload-rive',
        apply: 'build',
        transformIndexHtml: {
            order: 'post',
            handler(_html, ctx) {
                const wasm = Object.values(ctx.bundle ?? {}).find(f =>
                    f.type === 'asset' && f.originalFileNames.some(n => n.endsWith('canvas-lite/rive.wasm')))
                if (!wasm) {
                    this.warn('rive.wasm not found in bundle; skipping preload')
                    return
                }
                return [{
                    tag: 'link',
                    attrs: {rel: 'preload', href: `./${wasm.fileName}`, as: 'fetch', type: 'application/wasm', crossorigin: true},
                    injectTo: 'head',
                }]
            },
        },
    }
}
