// TinyVadCNN, Moonshine's small voice activity detector, run in plain
// JavaScript. It takes a 32 x 16 log-mel window (about half a second of audio;
// see melStreamer.ts) and gives one number: how sure it is that someone is
// speaking in it.
//
// The model and its weights come from https://github.com/moonshine-ai/moonshine
// (micro/models, MIT License; see src/assets/vad/LICENSE-moonshine.txt).
// scripts/export-vad-weights.py writes the weights file from their ONNX export.
// The network is a small MobileNetV2: 3x3 and 1x1 convolutions with their batch
// norms already folded in, ReLU6, one residual add, an average pool and one
// output. That's few enough kinds of layer to write out here, which saves
// loading a whole neural network runtime for 20,000 numbers.

export const N_MELS = 32;
export const WINDOW_FRAMES = 16;

type Conv = {
    inChannels: number;
    outChannels: number;
    // 3 (padded by 1 on each side) or 1.
    kernel: 1 | 3;
    strideH: number;
    strideW: number;
    // Each output channel looks at inChannels / groups input channels.
    // inChannels groups makes it depthwise.
    groups: number;
    relu6: boolean;
};

function conv(inChannels: number, outChannels: number, kernel: 1 | 3, relu6: boolean,
              {strideH = 1, strideW = 1, groups = 1} = {}): Conv {
    return {inChannels, outChannels, kernel, strideH, strideW, groups, relu6};
}

// The model's layers, in the order the weights file holds them. Block 0's
// output is added to the stem's; the others have no shortcut.
const STEM = conv(1, 16, 3, true, {strideH: 2});
const BLOCK0 = [conv(16, 16, 3, true, {groups: 16}), conv(16, 16, 1, false)];
const BLOCKS = [
    [conv(16, 48, 1, true), conv(48, 48, 3, true, {strideH: 2, strideW: 2, groups: 48}), conv(48, 24, 1, false)],
    [conv(24, 72, 1, true), conv(72, 72, 3, true, {strideH: 2, strideW: 2, groups: 72}), conv(72, 32, 1, false)],
    [conv(32, 96, 1, true), conv(96, 96, 3, true, {groups: 96}), conv(96, 48, 1, false)],
];
const HEAD = conv(48, 64, 1, true);
const ALL_CONVS = [STEM, ...BLOCK0, ...BLOCKS.flat(), HEAD];

type Tensor = {data: Float32Array; c: number; h: number; w: number};
type ConvWeights = {spec: Conv; weight: Float32Array; bias: Float32Array};

function runConv({spec, weight, bias}: ConvWeights, x: Tensor): Tensor {
    const {kernel, strideH, strideW, groups, outChannels, relu6} = spec;
    const pad = kernel == 3 ? 1 : 0;
    const h = Math.floor((x.h + 2 * pad - kernel) / strideH) + 1;
    const w = Math.floor((x.w + 2 * pad - kernel) / strideW) + 1;
    const out = new Float32Array(outChannels * h * w);
    if (kernel == 1 && groups == 1 && strideH == 1 && strideW == 1) {
        // Most of the work: a matrix product, done row by row.
        const plane = h * w;
        for (let oc = 0; oc < outChannels; oc++) {
            const row = out.subarray(oc * plane, (oc + 1) * plane).fill(bias[oc]);
            for (let ic = 0; ic < x.c; ic++) {
                const k = weight[oc * x.c + ic];
                const input = ic * plane;
                for (let i = 0; i < plane; i++) {
                    row[i] += k * x.data[input + i];
                }
            }
            if (relu6) {
                for (let i = 0; i < plane; i++) {
                    row[i] = Math.min(6, Math.max(0, row[i]));
                }
            }
        }
        return {data: out, c: outChannels, h, w};
    }
    const inPerGroup = x.c / groups;
    const outPerGroup = outChannels / groups;
    const kk = kernel * kernel;
    for (let oc = 0; oc < outChannels; oc++) {
        const firstIn = Math.floor(oc / outPerGroup) * inPerGroup;
        const b = bias[oc];
        for (let oy = 0; oy < h; oy++) {
            for (let ox = 0; ox < w; ox++) {
                let sum = b;
                for (let i = 0; i < inPerGroup; i++) {
                    const plane = (firstIn + i) * x.h * x.w;
                    const wBase = (oc * inPerGroup + i) * kk;
                    for (let ky = 0; ky < kernel; ky++) {
                        const iy = oy * strideH + ky - pad;
                        if (iy < 0 || iy >= x.h) continue;
                        for (let kx = 0; kx < kernel; kx++) {
                            const ix = ox * strideW + kx - pad;
                            if (ix < 0 || ix >= x.w) continue;
                            sum += x.data[plane + iy * x.w + ix] * weight[wBase + ky * kernel + kx];
                        }
                    }
                }
                out[(oc * h + oy) * w + ox] = relu6 ? Math.min(6, Math.max(0, sum)) : sum;
            }
        }
    }
    return {data: out, c: outChannels, h, w};
}

export class TinyVad {
    private readonly convs: ConvWeights[];
    private readonly fcWeight: Float32Array;
    private readonly fcBias: number;

    // `weights` is the contents of tinyvad.bin.
    constructor(weights: ArrayBuffer) {
        const all = new Float32Array(weights);
        let at = 0;
        const take = (n: number) => {
            const part = all.subarray(at, at + n);
            at += n;
            return part;
        };
        this.convs = ALL_CONVS.map((spec) => ({
            spec,
            weight: take(spec.outChannels * (spec.inChannels / spec.groups) * spec.kernel * spec.kernel),
            bias: take(spec.outChannels),
        }));
        this.fcWeight = take(HEAD.outChannels);
        this.fcBias = take(1)[0];
        if (at != all.length || this.fcBias === undefined) {
            throw new Error(`The voice detector's weights have ${all.length} numbers, not ${at}`);
        }
    }

    // `features` is N_MELS rows of WINDOW_FRAMES, oldest frame first, as
    // MelStreamer.window() gives. Returns the chance, 0 to 1, that the window
    // holds speech.
    predict(features: Float32Array): number {
        return 1 / (1 + Math.exp(-this.logit(features)));
    }

    logit(features: Float32Array): number {
        const [stem, block0dw, block0pw, ...rest] = this.convs;
        let x = runConv(stem, {data: features, c: 1, h: N_MELS, w: WINDOW_FRAMES});
        const y = runConv(block0pw, runConv(block0dw, x));
        for (let i = 0; i < x.data.length; i++) {
            y.data[i] += x.data[i];
        }
        x = y;
        for (const layer of rest) {
            x = runConv(layer, x);
        }
        // Average each channel over the window, then the one output.
        const plane = x.h * x.w;
        let logit = this.fcBias;
        for (let c = 0; c < x.c; c++) {
            let sum = 0;
            for (let i = 0; i < plane; i++) {
                sum += x.data[c * plane + i];
            }
            logit += this.fcWeight[c] * sum / plane;
        }
        return logit;
    }
}
