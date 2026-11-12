// Builds demos/face-check-bench.html, one file with everything inside: the
// app's face detector worker (src/utils/faceApiWorker.ts, so face-api.js and
// TensorFlow.js) and its model, and the BlazeFace port and its weights.
// Rebuild it when any of those or bench.html change:
//
//   node demos/face-check/build.mjs
//
// blazeface-simd.wasm is built from blazeface-simd.c; see that file.

import {build} from "rolldown";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const here = import.meta.dirname, root = path.resolve(here, "../..");

async function bundle(input, plugins = []) {
    const result = await build({
        input, cwd: root, write: false, logLevel: "warn", plugins,
        resolve: {alias: {"@": path.join(root, "src")}},
        output: {format: "iife", minify: true},
    });
    return result.output[0].code;
}

// Safe inside a <script>: no "</script" can end it early.
const literal = (value) => JSON.stringify(value).replaceAll("</", "<\\/");

const tinyWorker = await bundle(path.join(root, "src/utils/faceApiWorker.ts"));
const blazeWorker = await bundle(path.join(here, "blazeface-worker.js"));
const tinyWeights = path.join(root, "src/assets/facemodels/tiny_face_detector_model-shard1.shard");
const blazeWeights = path.join(here, "blazeface.bin");
const blazeLayers = fs.readFileSync(path.join(here, "blazeface-layers.json"), "utf8").trim();
const blazeWasm = path.join(here, "blazeface-simd.wasm");

// The worker carries all three BlazeFace backends; for the sizes, bundle a
// worker with only one.
async function blazeAlone(backend) {
    const modules = {js: ["BlazeFace", "blazeface.js"], wasm: ["BlazeFaceWasm", "blazeface-wasm.js"], webgl: ["BlazeFaceGL", "blazeface-gl.js"]};
    const [name, file] = modules[backend];
    const source = fs.readFileSync(path.join(here, "blazeface-worker.js"), "utf8")
        .replace(/^import \{BlazeFace(Wasm|GL)\}.*$/gm, "")
        .replace(/request\.backend === "wasm" \? [\s\S]*?: new BlazeFace\(request\.layers, request\.weights\);/, `new ${name}(request.layers, request.weights, request.wasm);`)
        .replace(`import {BlazeFace, INPUT_SIZE} from "./blazeface.js";`, `import {INPUT_SIZE} from "./blazeface.js";\nimport {${name}} from "./${file}";`);
    const id = path.join(here, "blazeface-worker-alone.js");
    return bundle(id, [{name: "alone", resolveId: (s) => s === id ? id : null, load: (s) => s === id ? source : null}]);
}

// What each detector costs to download: its minified worker (with the layer
// list and, for WASM, the module, for BlazeFace) and its weights, raw and gzipped.
const gz = (buf) => zlib.gzipSync(buf, {level: 9}).length;
const cost = (code, weights, extra = Buffer.alloc(0)) => {
    const c = Buffer.concat([Buffer.from(code), extra]), w = fs.readFileSync(weights);
    return {code: c.length, codeGz: gz(c), weights: w.length, weightsGz: gz(w)};
};
const bundleCost = {tiny: cost(tinyWorker, tinyWeights), blaze: {}};
for (const backend of ["js", "wasm", "webgl"]) {
    const wasm = backend === "wasm" ? fs.readFileSync(blazeWasm) : undefined;
    bundleCost.blaze[backend] = cost((await blazeAlone(backend)) + blazeLayers, blazeWeights, wasm);
}
console.log(bundleCost);

const inline = [
    `const BUNDLE_COST = ${JSON.stringify(bundleCost)};`,
    `const TINY_WORKER = ${literal(tinyWorker)};`,
    `const TINY_WEIGHTS = ${literal(fs.readFileSync(tinyWeights).toString("base64"))};`,
    `const BLAZE_WORKER = ${literal(blazeWorker)};`,
    `const BLAZE_WEIGHTS = ${literal(fs.readFileSync(blazeWeights).toString("base64"))};`,
    `const BLAZE_LAYERS = ${blazeLayers};`,
    `const BLAZE_WASM = ${literal(fs.readFileSync(blazeWasm).toString("base64"))};`,
].join("\n");

const template = fs.readFileSync(path.join(here, "bench.html"), "utf8");
const marker = "/* INLINE */";
if (!template.includes(marker)) throw new Error(`bench.html has no ${marker}`);
const out = path.join(root, "demos/face-check-bench.html");
fs.writeFileSync(out, template.replace(marker, () => inline));
console.log(`Wrote ${path.relative(root, out)}, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
