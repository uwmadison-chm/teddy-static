// BlazeFace short range (MediaPipe's blaze_face_short_range.tflite), as a
// plain-JS forward pass with no TensorFlow.js. LAYERS and the float16 weights
// come from scripts/export-blazeface-weights.py; this file only knows how to run them.
//
// Each layer is [op, src, dst, ...]: tensors are numbered, 0 is the 128x128x3
// input, and every tensor is height x width x channels, row-major.
//   conv/dw: k, cin, cout, stride, weight offset, bias offset. "SAME" padding
//            for k > 1, as TensorFlow does it; conv weights are [cout][k][k][cin],
//            depthwise weights [k][k][c].
//   add: src2. relu. pool: 2x2 max, stride 2. padc: extra zero channels.

export const INPUT_SIZE = 128;
const KEYPOINTS = ["right eye", "left eye", "nose tip", "mouth", "right ear", "left ear"];
export {KEYPOINTS};

function halfToFloat(h) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * f * 2 ** -24;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * (1 + f / 1024) * 2 ** (e - 15);
}

export class BlazeFace {
    constructor(layers, weightsF16) {
        const half = new Uint16Array(weightsF16);
        this.w = new Float32Array(half.length);
        for (let i = 0; i < half.length; i++) this.w[i] = halfToFloat(half[i]);
        this.layers = layers;
        this.patch = new Float32Array(5 * 5 * 3);
        // Work out every tensor's shape once, and keep its buffer between runs.
        const shapes = {0: [INPUT_SIZE, INPUT_SIZE, 3]};
        for (const [op, src, dst, a, , cout, stride] of layers) {
            const [h, w, c] = shapes[src];
            if (op === "conv" || op === "dw") shapes[dst] = [Math.ceil(h / stride), Math.ceil(w / stride), cout];
            else if (op === "pool") shapes[dst] = [Math.ceil(h / 2), Math.ceil(w / 2), c];
            else if (op === "padc") shapes[dst] = [h, w, c + a];
            else shapes[dst] = [h, w, c];
        }
        this.shapes = shapes;
        this.t = {};
        for (const id in shapes) this.t[id] = new Float32Array(shapes[id][0] * shapes[id][1] * shapes[id][2]);
        this.anchors = makeAnchors();
    }

    // The input tensor: fill it with RGB scaled to -1..1.
    get input() { return this.t[0]; }

    // Runs the network on this.input. Returns the raw scores (896) and
    // regressors (896 x 16), in the model's anchor order.
    run() {
        const {t, shapes, w} = this;
        for (const L of this.layers) {
            const [op, src, dst] = L;
            const x = t[src], y = t[dst], [ih, iw, ic] = shapes[src], [oh, ow, oc] = shapes[dst];
            if (op === "conv") {
                const [, , , k, cin, cout, stride, wo, bo] = L;
                if (k === 1) conv1x1(x, y, ih * iw, cin, cout, w, wo, bo);
                else conv(x, y, ih, iw, cin, oh, ow, cout, k, stride, w, wo, bo, this.patch);
            } else if (op === "dw") {
                const [, , , k, c, , stride, wo, bo] = L;
                depthwise(x, y, ih, iw, c, oh, ow, k, stride, w, wo, bo);
            } else if (op === "add") {
                const z = t[L[3]];
                for (let i = 0; i < y.length; i++) y[i] = x[i] + z[i];
            } else if (op === "relu") {
                for (let i = 0; i < y.length; i++) y[i] = x[i] > 0 ? x[i] : 0;
            } else if (op === "pool") {
                for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) for (let c = 0; c < ic; c++) {
                    let m = -Infinity;
                    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
                        const yy = oy * 2 + dy, xx = ox * 2 + dx;
                        if (yy < ih && xx < iw) m = Math.max(m, x[(yy * iw + xx) * ic + c]);
                    }
                    y[(oy * ow + ox) * oc + c] = m;
                }
            } else if (op === "padc") {
                y.fill(0);
                for (let p = 0; p < ih * iw; p++) for (let c = 0; c < ic; c++) y[p * oc + c] = x[p * ic + c];
            }
        }
        // Heads: 16x16 with 2 anchors a cell, then 8x8 with 6.
        const scores = new Float32Array(896), boxes = new Float32Array(896 * 16);
        scores.set(t[81], 0); scores.set(t[82], 512);
        boxes.set(t[83], 0); boxes.set(t[84], 512 * 16);
        return {scores, boxes};
    }

    // Faces in the input, as MediaPipe's face detector post-processes them:
    // sigmoid scores, boxes and keypoints decoded against the anchors, then
    // weighted non-max suppression. Coordinates are 0..1 of the input square.
    detect(minScore = 0.5, iouThreshold = 0.3) {
        const {scores, boxes} = this.run();
        const found = [];
        for (let i = 0; i < 896; i++) {
            const score = 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, scores[i]))));
            if (score < minScore) continue;
            const [ax, ay] = this.anchors[i], r = boxes.subarray(i * 16, i * 16 + 16), s = INPUT_SIZE;
            const cx = r[0] / s + ax, cy = r[1] / s + ay, bw = r[2] / s, bh = r[3] / s;
            const keypoints = [];
            for (let k = 0; k < 6; k++) keypoints.push({x: r[4 + 2 * k] / s + ax, y: r[5 + 2 * k] / s + ay});
            found.push({score, box: {x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh}, keypoints});
        }
        return weightedNms(found, iouThreshold);
    }
}

// 1x1 convolution, four pixels and two outputs at a time so most of the work
// stays in locals. Weights are [cout][cin]; pixel counts here are all
// multiples of 4 and output counts all even.
function conv1x1(x, y, n, cin, cout, w, wo, bo) {
    for (let p = 0; p < n; p += 4) {
        const x0 = p * cin, x1 = x0 + cin, x2 = x1 + cin, x3 = x2 + cin;
        for (let o = 0; o < cout; o += 2) {
            const wa = wo + o * cin, wb = wa + cin;
            let a0 = w[bo + o], a1 = a0, a2 = a0, a3 = a0;
            let b0 = w[bo + o + 1], b1 = b0, b2 = b0, b3 = b0;
            for (let c = 0; c < cin; c++) {
                const u = w[wa + c], v = w[wb + c];
                const i0 = x[x0 + c], i1 = x[x1 + c], i2 = x[x2 + c], i3 = x[x3 + c];
                a0 += i0 * u; a1 += i1 * u; a2 += i2 * u; a3 += i3 * u;
                b0 += i0 * v; b1 += i1 * v; b2 += i2 * v; b3 += i3 * v;
            }
            const y0 = p * cout + o;
            y[y0] = a0; y[y0 + 1] = b0;
            y[y0 + cout] = a1; y[y0 + cout + 1] = b1;
            y[y0 + 2 * cout] = a2; y[y0 + 2 * cout + 1] = b2;
            y[y0 + 3 * cout] = a3; y[y0 + 3 * cout + 1] = b3;
        }
    }
}

// TensorFlow's SAME padding: as much as needed, the extra pixel on the bottom/right.
const padBefore = (size, k, stride) => Math.floor(Math.max((Math.ceil(size / stride) - 1) * stride + k - size, 0) / 2);

// Full convolution (only the first layer, 5x5 over RGB): gathers each
// patch, zero-padded, then dots it with four filters at a time. Weights are
// [cout][k][k][cin]; cout is a multiple of 4.
function conv(x, y, ih, iw, cin, oh, ow, cout, k, stride, w, wo, bo, patch) {
    const pt = padBefore(ih, k, stride), pl = padBefore(iw, k, stride), n = k * k * cin;
    for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
        let j = 0;
        for (let ky = 0; ky < k; ky++) {
            const yy = oy * stride + ky - pt;
            for (let kx = 0; kx < k; kx++) {
                const xx = ox * stride + kx - pl, inside = yy >= 0 && yy < ih && xx >= 0 && xx < iw;
                const xi = (yy * iw + xx) * cin;
                for (let c = 0; c < cin; c++) patch[j++] = inside ? x[xi + c] : 0;
            }
        }
        const yi = (oy * ow + ox) * cout;
        for (let o = 0; o < cout; o += 4) {
            const w0 = wo + o * n, w1 = w0 + n, w2 = w1 + n, w3 = w2 + n;
            let a0 = w[bo + o], a1 = w[bo + o + 1], a2 = w[bo + o + 2], a3 = w[bo + o + 3];
            for (let i = 0; i < n; i++) {
                const v = patch[i];
                a0 += v * w[w0 + i]; a1 += v * w[w1 + i]; a2 += v * w[w2 + i]; a3 += v * w[w3 + i];
            }
            y[yi + o] = a0; y[yi + o + 1] = a1; y[yi + o + 2] = a2; y[yi + o + 3] = a3;
        }
    }
}

// 3x3 depthwise convolution. Weights are [3][3][c].
function depthwise(x, y, ih, iw, ch, oh, ow, k, stride, w, wo, bo) {
    const pt = padBefore(ih, k, stride), pl = padBefore(iw, k, stride);
    const row = iw * ch;
    for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
        const yi = (oy * ow + ox) * ch, iy = oy * stride - pt, ix = ox * stride - pl;
        if (iy >= 0 && ix >= 0 && iy + 2 < ih && ix + 2 < iw) {
            // All nine taps inside the picture: no bounds checks.
            const r0 = (iy * iw + ix) * ch, r1 = r0 + row, r2 = r1 + row;
            for (let c = 0; c < ch; c++) {
                const q = wo + c;
                y[yi + c] = w[bo + c]
                    + x[r0 + c] * w[q] + x[r0 + ch + c] * w[q + ch] + x[r0 + 2 * ch + c] * w[q + 2 * ch]
                    + x[r1 + c] * w[q + 3 * ch] + x[r1 + ch + c] * w[q + 4 * ch] + x[r1 + 2 * ch + c] * w[q + 5 * ch]
                    + x[r2 + c] * w[q + 6 * ch] + x[r2 + ch + c] * w[q + 7 * ch] + x[r2 + 2 * ch + c] * w[q + 8 * ch];
            }
            continue;
        }
        for (let c = 0; c < ch; c++) y[yi + c] = w[bo + c];
        for (let ky = 0; ky < 3; ky++) {
            const yy = iy + ky;
            if (yy < 0 || yy >= ih) continue;
            for (let kx = 0; kx < 3; kx++) {
                const xx = ix + kx;
                if (xx < 0 || xx >= iw) continue;
                const xi = (yy * iw + xx) * ch, wi = wo + (ky * 3 + kx) * ch;
                for (let c = 0; c < ch; c++) y[yi + c] += x[xi + c] * w[wi + c];
            }
        }
    }
}

// MediaPipe's SSD anchors for this model: strides 8, 16, 16, 16 on a 128
// input, two anchors a layer, centred on each cell. Layers with the same
// stride share a grid, so that's 16x16x2 then 8x8x6.
function makeAnchors() {
    const anchors = [];
    for (const [grid, perCell] of [[16, 2], [8, 6]]) {
        for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) for (let a = 0; a < perCell; a++) {
            anchors.push([(x + 0.5) / grid, (y + 0.5) / grid]);
        }
    }
    return anchors;
}

function iou(a, b) {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
    const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
}

// MediaPipe's WEIGHTED non-max suppression: overlapping detections are
// averaged, weighted by score, and keep the best one's score.
function weightedNms(dets, threshold) {
    const left = [...dets].sort((a, b) => b.score - a.score), out = [];
    while (left.length) {
        const best = left[0], group = [], rest = [];
        for (const d of left) (iou(best.box, d.box) > threshold ? group : rest).push(d);
        left.length = 0; left.push(...rest);
        let total = 0, x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        const kps = best.keypoints.map(() => ({x: 0, y: 0}));
        for (const d of group) {
            total += d.score;
            x0 += d.box.x * d.score; y0 += d.box.y * d.score;
            x1 += (d.box.x + d.box.width) * d.score; y1 += (d.box.y + d.box.height) * d.score;
            d.keypoints.forEach((k, i) => { kps[i].x += k.x * d.score; kps[i].y += k.y * d.score; });
        }
        x0 /= total; y0 /= total; x1 /= total; y1 /= total;
        out.push({score: best.score, box: {x: x0, y: y0, width: x1 - x0, height: y1 - y0}, keypoints: kps.map(k => ({x: k.x / total, y: k.y / total}))});
    }
    return out;
}
