// BlazeFace's layers as WebAssembly SIMD kernels, for blazeface-wasm.js.
// Build (clang 16 or later):
//
//   clang --target=wasm32 -O3 -msimd128 -nostdlib -fno-builtin \
//     -Wl,--no-entry -Wl,--export-dynamic -Wl,--export=__heap_base -Wl,--growable-table \
//     -o demos/face-check/blazeface-simd.wasm demos/face-check/blazeface-simd.c
//
// Tensors are height x width x channels, like blazeface.js, except that each
// pixel's channels are padded with zeros to a multiple of 4 (its "stride"),
// so every kernel works four channels at a time.

#include <wasm_simd128.h>

#define EXPORT __attribute__((visibility("default")))

typedef float f32;

static inline v128_t mad(v128_t acc, v128_t a, v128_t b) { return wasm_f32x4_add(acc, wasm_f32x4_mul(a, b)); }

// 1x1 convolution. w is [cin][so], b is [so]; so (the output stride) is a
// multiple of 4 and n (pixels) a multiple of 4. Works on four pixels at a
// time, eight or four outputs at a time.
EXPORT void conv1x1(const f32 *x, f32 *y, int n, int cin, int si, int so, const f32 *w, const f32 *b) {
    for (int p = 0; p < n; p += 4) {
        const f32 *x0 = x + p * si, *x1 = x0 + si, *x2 = x1 + si, *x3 = x2 + si;
        f32 *y0 = y + p * so, *y1 = y0 + so, *y2 = y1 + so, *y3 = y2 + so;
        int o = 0;
        for (; o + 8 <= so; o += 8) {
            v128_t ba = wasm_v128_load(b + o), bb = wasm_v128_load(b + o + 4);
            v128_t a0 = ba, a1 = ba, a2 = ba, a3 = ba, c0 = bb, c1 = bb, c2 = bb, c3 = bb;
            const f32 *wc = w + o;
            for (int c = 0; c < cin; c++, wc += so) {
                v128_t wa = wasm_v128_load(wc), wb = wasm_v128_load(wc + 4);
                v128_t i0 = wasm_f32x4_splat(x0[c]), i1 = wasm_f32x4_splat(x1[c]);
                v128_t i2 = wasm_f32x4_splat(x2[c]), i3 = wasm_f32x4_splat(x3[c]);
                a0 = mad(a0, i0, wa); a1 = mad(a1, i1, wa); a2 = mad(a2, i2, wa); a3 = mad(a3, i3, wa);
                c0 = mad(c0, i0, wb); c1 = mad(c1, i1, wb); c2 = mad(c2, i2, wb); c3 = mad(c3, i3, wb);
            }
            wasm_v128_store(y0 + o, a0); wasm_v128_store(y1 + o, a1); wasm_v128_store(y2 + o, a2); wasm_v128_store(y3 + o, a3);
            wasm_v128_store(y0 + o + 4, c0); wasm_v128_store(y1 + o + 4, c1); wasm_v128_store(y2 + o + 4, c2); wasm_v128_store(y3 + o + 4, c3);
        }
        for (; o < so; o += 4) {
            v128_t ba = wasm_v128_load(b + o);
            v128_t a0 = ba, a1 = ba, a2 = ba, a3 = ba;
            const f32 *wc = w + o;
            for (int c = 0; c < cin; c++, wc += so) {
                v128_t wa = wasm_v128_load(wc);
                a0 = mad(a0, wasm_f32x4_splat(x0[c]), wa); a1 = mad(a1, wasm_f32x4_splat(x1[c]), wa);
                a2 = mad(a2, wasm_f32x4_splat(x2[c]), wa); a3 = mad(a3, wasm_f32x4_splat(x3[c]), wa);
            }
            wasm_v128_store(y0 + o, a0); wasm_v128_store(y1 + o, a1); wasm_v128_store(y2 + o, a2); wasm_v128_store(y3 + o, a3);
        }
    }
}

// 3x3 depthwise convolution with TensorFlow's SAME padding (pt, pl before).
// w is [9][s], b is [s]; s is the stride of both input and output.
EXPORT void depthwise(const f32 *x, f32 *y, int ih, int iw, int s, int oh, int ow, int stride, int pt, int pl, const f32 *w, const f32 *b) {
    for (int oy = 0; oy < oh; oy++) {
        for (int ox = 0; ox < ow; ox++) {
            int iy = oy * stride - pt, ix = ox * stride - pl;
            f32 *yp = y + (oy * ow + ox) * s;
            for (int c = 0; c < s; c += 4) {
                v128_t acc = wasm_v128_load(b + c);
                for (int ky = 0; ky < 3; ky++) {
                    int yy = iy + ky;
                    if (yy < 0 || yy >= ih) continue;
                    for (int kx = 0; kx < 3; kx++) {
                        int xx = ix + kx;
                        if (xx < 0 || xx >= iw) continue;
                        acc = mad(acc, wasm_v128_load(x + (yy * iw + xx) * s + c), wasm_v128_load(w + (ky * 3 + kx) * s + c));
                    }
                }
                wasm_v128_store(yp + c, acc);
            }
        }
    }
}

// Full k x k convolution for the first layer, whose input stride is 4 (RGB
// and a zero). w is [k][k][4][so], b is [so]; so is at most 128.
EXPORT void conv(const f32 *x, f32 *y, int ih, int iw, int oh, int ow, int so, int k, int stride, int pt, int pl, const f32 *w, const f32 *b) {
    v128_t acc[32];
    int groups = so / 4;
    for (int oy = 0; oy < oh; oy++) {
        for (int ox = 0; ox < ow; ox++) {
            for (int g = 0; g < groups; g++) acc[g] = wasm_v128_load(b + g * 4);
            for (int ky = 0; ky < k; ky++) {
                int yy = oy * stride + ky - pt;
                if (yy < 0 || yy >= ih) continue;
                for (int kx = 0; kx < k; kx++) {
                    int xx = ox * stride + kx - pl;
                    if (xx < 0 || xx >= iw) continue;
                    const f32 *xp = x + (yy * iw + xx) * 4;
                    const f32 *wp = w + (ky * k + kx) * 4 * so;
                    for (int c = 0; c < 3; c++, wp += so) {
                        v128_t v = wasm_f32x4_splat(xp[c]);
                        for (int g = 0; g < groups; g++) acc[g] = mad(acc[g], v, wasm_v128_load(wp + g * 4));
                    }
                }
            }
            f32 *yp = y + (oy * ow + ox) * so;
            for (int g = 0; g < groups; g++) wasm_v128_store(yp + g * 4, acc[g]);
        }
    }
}

// y = max(a + b, 0) over n floats (a multiple of 4); b may be null for a plain ReLU.
EXPORT void add_relu(const f32 *a, const f32 *b, f32 *y, int n, int relu) {
    v128_t zero = wasm_f32x4_splat(0);
    for (int i = 0; i < n; i += 4) {
        v128_t v = wasm_v128_load(a + i);
        if (b) v = wasm_f32x4_add(v, wasm_v128_load(b + i));
        if (relu) v = wasm_f32x4_max(v, zero);
        wasm_v128_store(y + i, v);
    }
}

// 2x2 max pool, stride 2, on even sizes.
EXPORT void maxpool(const f32 *x, f32 *y, int ih, int iw, int s) {
    int oh = ih / 2, ow = iw / 2;
    for (int oy = 0; oy < oh; oy++) {
        for (int ox = 0; ox < ow; ox++) {
            const f32 *p0 = x + ((oy * 2) * iw + ox * 2) * s, *p1 = p0 + s, *p2 = p0 + iw * s, *p3 = p2 + s;
            f32 *yp = y + (oy * ow + ox) * s;
            for (int c = 0; c < s; c += 4) {
                v128_t m = wasm_f32x4_max(wasm_f32x4_max(wasm_v128_load(p0 + c), wasm_v128_load(p1 + c)),
                                          wasm_f32x4_max(wasm_v128_load(p2 + c), wasm_v128_load(p3 + c)));
                wasm_v128_store(yp + c, m);
            }
        }
    }
}

// Widens each pixel from stride si to so, filling the new channels with zeros.
EXPORT void pad_channels(const f32 *x, f32 *y, int n, int si, int so) {
    v128_t zero = wasm_f32x4_splat(0);
    for (int p = 0; p < n; p++) {
        int c = 0;
        for (; c < si; c += 4) wasm_v128_store(y + p * so + c, wasm_v128_load(x + p * si + c));
        for (; c < so; c += 4) wasm_v128_store(y + p * so + c, zero);
    }
}
