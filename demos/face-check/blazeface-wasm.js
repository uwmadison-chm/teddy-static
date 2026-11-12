// BlazeFace on WebAssembly SIMD: the same layers as blazeface.js, run by the
// kernels in blazeface-simd.c. Tensors live in the module's memory with each
// pixel's channels padded to a multiple of 4.

import {INPUT_SIZE, HEADS, decodeFaces, decodeWeights, fillInput, padBefore, tensorShapes} from "./blazeface.js";

const pad4 = (c) => Math.ceil(c / 4) * 4;

export class BlazeFaceWasm {
    // wasmBytes: blazeface-simd.wasm. Throws where WebAssembly SIMD isn't supported.
    constructor(layers, weightsF16, wasmBytes) {
        const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {});
        const k = this.k = instance.exports;
        const w = decodeWeights(weightsF16);
        const shapes = this.shapes = tensorShapes(layers);
        const stride = (id) => id === 0 ? 4 : pad4(shapes[id][2]);

        // Lay out memory: weights rearranged for the kernels, then tensors.
        let top = Math.ceil(k.__heap_base.value / 16) * 16;
        const plan = [];
        const blocks = [];
        const alloc = (floats) => { const at = top; top += Math.ceil(floats * 4 / 16) * 16; return at; };
        const weights = (arr) => { const at = alloc(arr.length); blocks.push([at, arr]); return at; };
        const tensors = {};
        for (const id in shapes) { const [h, ww] = shapes[id]; tensors[id] = alloc(h * ww * stride(id)); }
        for (const L of layers) {
            const [op, src, dst] = L, si = stride(src), so = stride(dst);
            if (op === "conv" || op === "dw") {
                const [, , , ks, cin, cout, st, wo, bo] = L;
                const bias = new Float32Array(so); bias.set(w.subarray(bo, bo + cout));
                let wt;
                if (op === "dw") {  // [3][3][c] -> [9][so]
                    wt = new Float32Array(9 * so);
                    for (let t = 0; t < 9; t++) for (let c = 0; c < cin; c++) wt[t * so + c] = w[wo + t * cin + c];
                } else if (ks === 1) {  // [cout][cin] -> [cin][so]
                    wt = new Float32Array(cin * so);
                    for (let o = 0; o < cout; o++) for (let c = 0; c < cin; c++) wt[c * so + o] = w[wo + o * cin + c];
                } else {  // [cout][k][k][cin] -> [k][k][4][so]
                    wt = new Float32Array(ks * ks * 4 * so);
                    for (let o = 0; o < cout; o++) for (let t = 0; t < ks * ks; t++) for (let c = 0; c < cin; c++) wt[(t * 4 + c) * so + o] = w[wo + (o * ks * ks + t) * cin + c];
                }
                plan.push({op: op === "dw" ? "dw" : ks === 1 ? "conv1x1" : "conv", src, dst, k: ks, cin, si, so, stride: st, w: weights(wt), b: weights(bias)});
            } else if (op === "add") {
                plan.push({op, src, dst, src2: L[3], so});
            } else {
                plan.push({op, src, dst, si, so});
            }
        }
        // Fold each ReLU into the add before it, where nothing else reads the sum.
        const reads = {};
        for (const p of plan) { reads[p.src] = (reads[p.src] ?? 0) + 1; if (p.src2 != null) reads[p.src2] = (reads[p.src2] ?? 0) + 1; }
        this.plan = [];
        for (let i = 0; i < plan.length; i++) {
            const p = plan[i], next = plan[i + 1];
            if (p.op === "add" && next?.op === "relu" && next.src === p.dst && reads[p.dst] === 1) {
                this.plan.push({...p, op: "addrelu", dst: next.dst}); i++;
            } else this.plan.push(p);
        }

        const pages = Math.ceil((top - k.memory.buffer.byteLength) / 65536);
        if (pages > 0) k.memory.grow(pages);
        const mem = new Float32Array(k.memory.buffer);
        for (const [at, arr] of blocks) mem.set(arr, at / 4);
        this.mem = mem;
        this.tensors = tensors;
        this.stride = stride;
        this.input = mem.subarray(tensors[0] / 4, tensors[0] / 4 + INPUT_SIZE * INPUT_SIZE * 4);
    }

    get backend() { return "WASM SIMD"; }

    setPixels(rgba) { fillInput(this.input, rgba, 4); }

    run() {
        const {k, plan, tensors: T, shapes} = this;
        for (const p of plan) {
            const [ih, iw] = shapes[p.src], [oh, ow] = shapes[p.dst];
            if (p.op === "conv1x1") k.conv1x1(T[p.src], T[p.dst], ih * iw, p.cin, p.si, p.so, p.w, p.b);
            else if (p.op === "dw") k.depthwise(T[p.src], T[p.dst], ih, iw, p.so, oh, ow, p.stride, padBefore(ih, 3, p.stride), padBefore(iw, 3, p.stride), p.w, p.b);
            else if (p.op === "conv") k.conv(T[p.src], T[p.dst], ih, iw, oh, ow, p.so, p.k, p.stride, padBefore(ih, p.k, p.stride), padBefore(iw, p.k, p.stride), p.w, p.b);
            else if (p.op === "add" || p.op === "addrelu") k.add_relu(T[p.src], T[p.src2], T[p.dst], oh * ow * p.so, p.op === "addrelu" ? 1 : 0);
            else if (p.op === "relu") k.add_relu(T[p.src], 0, T[p.dst], oh * ow * p.so, 1);
            else if (p.op === "pool") k.maxpool(T[p.src], T[p.dst], ih, iw, p.si);
            else if (p.op === "padc") k.pad_channels(T[p.src], T[p.dst], ih * iw, p.si, p.so);
        }
        // Copy the heads out, dropping the padding.
        const out = (ids, per) => {
            const result = new Float32Array(896 * per);
            let j = 0;
            for (const id of ids) {
                const [h, w, c] = shapes[id], s = this.stride(id), base = T[id] / 4;
                for (let p = 0; p < h * w; p++) for (let ch = 0; ch < c; ch++) result[j++] = this.mem[base + p * s + ch];
            }
            return result;
        };
        return {scores: out(HEADS.scores, 1), boxes: out(HEADS.boxes, 16)};
    }

    detect(minScore = 0.5, iouThreshold = 0.3) { return decodeFaces(this.run(), minScore, iouThreshold); }
}
