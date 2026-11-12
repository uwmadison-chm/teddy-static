// BlazeFace on WebGL2, for the bench only: the same layers as
// src/utils/blazeface/blazeface.ts, each one a fragment
// shader pass. A tensor is a float texture W*G texels wide and H tall, where
// G = ceil(channels / 4): texel (x*G + g, y) holds channels 4g..4g+3, padded
// with zeros. Needs WebGL2 with EXT_color_buffer_float; works on an
// OffscreenCanvas in a worker.

import {INPUT_SIZE, HEADS, decodeFaces, decodeWeights, padBefore, tensorShapes} from "../../src/utils/blazeface/blazeface.ts";

const groups = (c) => Math.ceil(c / 4);

const VERTEX = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const HEADER = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D X; uniform sampler2D Y; uniform sampler2D W;
uniform ivec2 inSize; uniform int gi; uniform int go; uniform int stride; uniform ivec2 padTL; uniform int flag;
out vec4 result;
vec4 at(sampler2D t, int x, int y, int g, int G) { return texelFetch(t, ivec2(x * G + g, y), 0); }
`;

// Every shader knows its output pixel (ox, oy) and channel group g.
const MAIN = `void main() { ivec2 c = ivec2(gl_FragCoord.xy); int ox = c.x / go, g = c.x - ox * go, oy = c.y; result = run(ox, oy, g); }`;

const SHADERS = {
    // W: (gi, o) = weights for input group gi of output o; (gi, o) at gi = Gi is the bias.
    conv1x1: `vec4 run(int ox, int oy, int g) {
        vec4 r;
        for (int k = 0; k < 4; k++) {
            int o = g * 4 + k;
            float s = texelFetch(W, ivec2(gi, o), 0).x;
            for (int i = 0; i < gi; i++) s += dot(at(X, ox, oy, i, gi), texelFetch(W, ivec2(i, o), 0));
            r[k] = s;
        }
        return r; }`,
    // W: (tap, g), tap 9 is the bias.
    dw: `vec4 run(int ox, int oy, int g) {
        vec4 s = texelFetch(W, ivec2(9, g), 0);
        for (int ky = 0; ky < 3; ky++) {
            int y = oy * stride + ky - padTL.y;
            if (y < 0 || y >= inSize.y) continue;
            for (int kx = 0; kx < 3; kx++) {
                int x = ox * stride + kx - padTL.x;
                if (x < 0 || x >= inSize.x) continue;
                s += at(X, x, y, g, gi) * texelFetch(W, ivec2(ky * 3 + kx, g), 0);
            }
        }
        return s; }`,
    // The first layer, on the RGBA8 input: W (tap, o) = RGB weights, tap 25 the bias. flag: ReLU after.
    conv: `vec4 run(int ox, int oy, int g) {
        vec4 r;
        for (int k = 0; k < 4; k++) {
            int o = g * 4 + k;
            float s = texelFetch(W, ivec2(25, o), 0).x;
            for (int ky = 0; ky < 5; ky++) {
                int y = oy * stride + ky - padTL.y;
                if (y < 0 || y >= inSize.y) continue;
                for (int kx = 0; kx < 5; kx++) {
                    int x = ox * stride + kx - padTL.x;
                    if (x < 0 || x >= inSize.x) continue;
                    vec3 v = texelFetch(X, ivec2(x, y), 0).rgb * 2.0 - 1.0;
                    s += dot(v, texelFetch(W, ivec2(ky * 5 + kx, o), 0).rgb);
                }
            }
            r[k] = s;
        }
        return flag == 1 ? max(r, 0.0) : r; }`,
    // flag: 1 adds Y, 2 applies a ReLU, 3 both.
    add: `vec4 run(int ox, int oy, int g) {
        vec4 v = at(X, ox, oy, g, gi);
        if ((flag & 1) != 0) v += at(Y, ox, oy, g, gi);
        return (flag & 2) != 0 ? max(v, 0.0) : v; }`,
    pool: `vec4 run(int ox, int oy, int g) {
        return max(max(at(X, ox * 2, oy * 2, g, gi), at(X, ox * 2 + 1, oy * 2, g, gi)),
                   max(at(X, ox * 2, oy * 2 + 1, g, gi), at(X, ox * 2 + 1, oy * 2 + 1, g, gi))); }`,
    padc: `vec4 run(int ox, int oy, int g) { return g < gi ? at(X, ox, oy, g, gi) : vec4(0.0); }`,
};

export class BlazeFaceGL {
    // canvas: an OffscreenCanvas or <canvas> to own the context. Throws where
    // WebGL2 or float render targets aren't available.
    constructor(layers, weightsF16, canvas = new OffscreenCanvas(1, 1)) {
        const gl = this.gl = canvas.getContext("webgl2", {antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "high-performance"});
        if (!gl) throw new Error("WebGL2 isn't available");
        if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("This GPU can't render to float textures");
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        this.renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "WebGL2";
        const w = decodeWeights(weightsF16);
        const shapes = this.shapes = tensorShapes(layers);

        this.programs = {};
        for (const [name, body] of Object.entries(SHADERS)) this.programs[name] = this.program(HEADER + body + MAIN);
        gl.bindVertexArray(gl.createVertexArray());

        const texture = (width, height, internal, format, type, data) => {
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
            return t;
        };
        const floatTexture = (width, height, data = null) => texture(width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT, data);

        // Tensors, each with a framebuffer to render into. The input is RGBA8.
        this.t = {};
        for (const id in shapes) {
            const [h, ww, c] = shapes[id];
            const tex = id === "0" ? texture(INPUT_SIZE, INPUT_SIZE, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null) : floatTexture(ww * groups(c), h);
            let fb = null;
            if (id !== "0") {
                fb = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Can't render to float textures here");
            }
            this.t[id] = {tex, fb, w: ww * groups(c), h};
        }

        // Passes, with their weights as textures.
        const plan = [];
        for (const L of layers) {
            const [op, src, dst] = L;
            const [ih, iw, ic] = shapes[src], [, , oc] = shapes[dst], Gi = groups(ic), Go = groups(oc);
            const p = {src, dst, gi: Gi, go: Go, inSize: [iw, ih], stride: 1, padTL: [0, 0], flag: 0};
            if (op === "conv" || op === "dw") {
                const [, , , k, cin, cout, st, wo, bo] = L;
                p.stride = st; p.padTL = [padBefore(iw, k, st), padBefore(ih, k, st)];
                let width, height, data;
                if (op === "dw") {
                    p.program = "dw"; width = 10; height = Go; data = new Float32Array(width * height * 4);
                    for (let c = 0; c < cin; c++) {
                        const g = c >> 2, lane = c & 3;
                        for (let t = 0; t < 9; t++) data[(g * width + t) * 4 + lane] = w[wo + t * cin + c];
                        data[(g * width + 9) * 4 + lane] = w[bo + c];
                    }
                } else if (k === 1) {
                    p.program = "conv1x1"; width = Gi + 1; height = Go * 4; data = new Float32Array(width * height * 4);
                    for (let o = 0; o < cout; o++) {
                        for (let c = 0; c < cin; c++) data[(o * width + (c >> 2)) * 4 + (c & 3)] = w[wo + o * cin + c];
                        data[(o * width + Gi) * 4] = w[bo + o];
                    }
                } else {
                    if (k !== 5 || cin !== 3 || src !== 0) throw new Error("Only the first layer can be a full convolution");
                    p.program = "conv"; width = 26; height = Go * 4; data = new Float32Array(width * height * 4);
                    for (let o = 0; o < cout; o++) {
                        for (let t = 0; t < 25; t++) for (let c = 0; c < 3; c++) data[(o * width + t) * 4 + c] = w[wo + (o * 25 + t) * 3 + c];
                        data[(o * width + 25) * 4] = w[bo + o];
                    }
                }
                p.W = floatTexture(width, height, data);
            } else if (op === "add") { p.program = "add"; p.src2 = L[3]; p.flag = 1; }
            else if (op === "relu") { p.program = "add"; p.flag = 2; }
            else p.program = op;
            plan.push(p);
        }
        // Fold each ReLU into the pass before it, where nothing else reads that pass's output.
        const reads = {};
        for (const p of plan) { reads[p.src] = (reads[p.src] ?? 0) + 1; if (p.src2 != null) reads[p.src2] = (reads[p.src2] ?? 0) + 1; }
        this.plan = [];
        for (let i = 0; i < plan.length; i++) {
            const p = plan[i], next = plan[i + 1];
            const foldable = (p.program === "add" && p.flag === 1) || p.program === "conv";
            if (foldable && next?.program === "add" && next.flag === 2 && next.src === p.dst && reads[p.dst] === 1) {
                this.plan.push({...p, dst: next.dst, flag: p.program === "conv" ? 1 : 3}); i++;
            } else this.plan.push(p);
        }
        this.read = {};
        for (const id of [...HEADS.scores, ...HEADS.boxes]) this.read[id] = new Float32Array(this.t[id].w * this.t[id].h * 4);
    }

    program(source) {
        const gl = this.gl, shader = (type, src) => {
            const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("Shader didn't compile: " + gl.getShaderInfoLog(s));
            return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, shader(gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(p, shader(gl.FRAGMENT_SHADER, source));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("Shader didn't link: " + gl.getProgramInfoLog(p));
        const u = {};
        for (const name of ["X", "Y", "W", "inSize", "gi", "go", "stride", "padTL", "flag"]) u[name] = gl.getUniformLocation(p, name);
        return {p, u};
    }

    get backend() { return "WebGL2 · " + this.renderer; }

    // RGBA bytes, 128 x 128.
    setPixels(rgba) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.t[0].tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, INPUT_SIZE, INPUT_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    }

    run() {
        const gl = this.gl;
        for (const p of this.plan) {
            const {p: prog, u} = this.programs[p.program], out = this.t[p.dst];
            gl.useProgram(prog);
            gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
            gl.viewport(0, 0, out.w, out.h);
            const bind = (unit, tex, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };
            bind(0, this.t[p.src].tex, u.X);
            if (p.src2 != null) bind(1, this.t[p.src2].tex, u.Y);
            if (p.W) bind(2, p.W, u.W);
            gl.uniform2i(u.inSize, ...p.inSize); gl.uniform1i(u.gi, p.gi); gl.uniform1i(u.go, p.go);
            gl.uniform1i(u.stride, p.stride); gl.uniform2i(u.padTL, ...p.padTL); gl.uniform1i(u.flag, p.flag);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        // Read the heads back, dropping the padding.
        const out = (ids, per) => {
            const result = new Float32Array(896 * per);
            let j = 0;
            for (const id of ids) {
                const t = this.t[id], buf = this.read[id], [h, w, c] = this.shapes[id], G = groups(c);
                gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
                gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, buf);
                for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < c; ch++) result[j++] = buf[(y * t.w + x * G + (ch >> 2)) * 4 + (ch & 3)];
            }
            return result;
        };
        return {scores: out(HEADS.scores, 1), boxes: out(HEADS.boxes, 16)};
    }

    detect(minScore = 0.5, iouThreshold = 0.3) { return decodeFaces(this.run(), minScore, iouThreshold); }
}
