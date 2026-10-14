// Writes a .gz and a .br copy next to each built file that compresses well, so
// the web server can send those instead of compressing on every request (with
// nginx: gzip_static and brotli_static). Images, audio and video are already
// compressed, and reels are copied in by the study plugin, so neither gets one.

import {readFile, writeFile} from "node:fs/promises";
import {extname, join} from "node:path";
import {promisify} from "node:util";
import {brotliCompress, constants, gzip} from "node:zlib";
import type {Plugin, ResolvedConfig} from "vite";

const EXTENSIONS = new Set([".js", ".css", ".html", ".wasm", ".riv", ".json", ".svg", ".csv", ".shard"]);

// Below this, the savings don't matter.
const MIN_SIZE = 1024;

// A copy has to come out at most this fraction of the original's size.
const MAX_RATIO = 0.9;

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

const COMPRESSORS: [string, (data: Buffer) => Promise<Buffer>][] = [
    [".gz", data => gzipAsync(data, {level: 9})],
    [".br", data => brotliAsync(data, {params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    }})],
];

export default function teddyCompress(): Plugin {
    let viteConfig: ResolvedConfig;

    return {
        name: "teddy-compress",
        apply: "build",

        configResolved(resolved) {
            viteConfig = resolved;
        },

        async writeBundle(options, bundle) {
            const outDir = options.dir ?? viteConfig.build.outDir;
            const files = Object.keys(bundle).filter(file => EXTENSIONS.has(extname(file)));
            await Promise.all(files.map(async file => {
                const path = join(outDir, file);
                const data = await readFile(path);
                if (data.length < MIN_SIZE) {
                    return;
                }
                await Promise.all(COMPRESSORS.map(async ([suffix, compress]) => {
                    const compressed = await compress(data);
                    if (compressed.length <= data.length * MAX_RATIO) {
                        await writeFile(path + suffix, compressed);
                    }
                }));
            }));
        },
    };
}
