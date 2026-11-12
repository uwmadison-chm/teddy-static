// The log-mel features TinyVadCNN reads, built 32 ms at a time, the way
// Moonshine's MelStreamer (micro/feature-generation) builds them: each block
// of 512 samples at 16 kHz is Hann-windowed (blocks don't overlap), turned into
// a power spectrum, summed into 32 Slaney mel bands from 20 Hz to 8 kHz, and
// logged. The model sees the last 16 blocks, standardized to a mean of 0 and a
// spread of 1, so the input's loudness mostly doesn't matter.

import {N_MELS, WINDOW_FRAMES} from "./tinyVad.ts";

export const SAMPLE_RATE = 16000;
export const HOP = 512;
const N_FFT = 512;
const N_FREQ = N_FFT / 2 + 1;
const F_MIN = 20;
const F_MAX = 8000;
const EPS = 1e-6;
const LOG_EPS = Math.log(EPS);

// Slaney mel scale, as torchaudio and Moonshine compute it.
const F_SP = 200 / 3;
const MIN_LOG_HZ = 1000;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP;
const LOG_STEP = Math.log(6.4) / 27;

function hzToMel(hz: number): number {
    return hz >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP : hz / F_SP;
}

function melToHz(mel: number): number {
    return mel >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL)) : F_SP * mel;
}

// Rows of N_FREQ weights, one row per mel band, with Slaney's area
// normalization.
function melFilterbank(): Float32Array {
    const melMin = hzToMel(F_MIN);
    const melMax = hzToMel(F_MAX);
    const hz = Array.from({length: N_MELS + 2}, (_, i) => melToHz(melMin + (melMax - melMin) * i / (N_MELS + 1)));
    const fb = new Float32Array(N_MELS * N_FREQ);
    for (let m = 0; m < N_MELS; m++) {
        const [left, center, right] = [hz[m], hz[m + 1], hz[m + 2]];
        const norm = 2 / (right - left);
        for (let k = 0; k < N_FREQ; k++) {
            const f = SAMPLE_RATE * 0.5 * k / (N_FREQ - 1);
            if (f <= left || f >= right) continue;
            fb[m * N_FREQ + k] = norm * (f <= center ? (f - left) / (center - left) : (right - f) / (right - center));
        }
    }
    return fb;
}

// Periodic Hann window.
const WINDOW = Float32Array.from({length: N_FFT}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N_FFT));
const FILTERBANK = melFilterbank();

// In-place radix-2 FFT of N_FFT complex values.
const BIT_REVERSED = Uint16Array.from({length: N_FFT}, (_, i) => {
    let r = 0;
    for (let bit = 1, j = i; bit < N_FFT; bit <<= 1, j >>= 1) {
        r = (r << 1) | (j & 1);
    }
    return r;
});
const COS = Float64Array.from({length: N_FFT / 2}, (_, i) => Math.cos(-2 * Math.PI * i / N_FFT));
const SIN = Float64Array.from({length: N_FFT / 2}, (_, i) => Math.sin(-2 * Math.PI * i / N_FFT));

function fft(re: Float64Array, im: Float64Array): void {
    for (let i = 0; i < N_FFT; i++) {
        const j = BIT_REVERSED[i];
        if (j > i) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let size = 2; size <= N_FFT; size <<= 1) {
        const half = size / 2;
        const step = N_FFT / size;
        for (let start = 0; start < N_FFT; start += size) {
            for (let k = 0; k < half; k++) {
                const c = COS[k * step], s = SIN[k * step];
                const a = start + k, b = a + half;
                const tr = re[b] * c - im[b] * s;
                const ti = re[b] * s + im[b] * c;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }
}

export class MelStreamer {
    // The last WINDOW_FRAMES columns of N_MELS log-mel values, oldest first.
    private readonly columns: Float32Array[] = [];
    private readonly re = new Float64Array(N_FFT);
    private readonly im = new Float64Array(N_FFT);

    // Adds one block of HOP samples, -1 to 1, at SAMPLE_RATE.
    push(block: Float32Array): void {
        for (let i = 0; i < N_FFT; i++) {
            this.re[i] = block[i] * WINDOW[i];
            this.im[i] = 0;
        }
        fft(this.re, this.im);
        const column = new Float32Array(N_MELS);
        for (let m = 0; m < N_MELS; m++) {
            let sum = 0;
            for (let k = 0; k < N_FREQ; k++) {
                const w = FILTERBANK[m * N_FREQ + k];
                if (w != 0) {
                    sum += w * (this.re[k] * this.re[k] + this.im[k] * this.im[k]);
                }
            }
            column[m] = Math.log(sum + EPS);
        }
        this.columns.push(column);
        if (this.columns.length > WINDOW_FRAMES) {
            this.columns.shift();
        }
    }

    reset(): void {
        this.columns.length = 0;
    }

    // The model's input: N_MELS rows of WINDOW_FRAMES, standardized. Frames
    // from before the first push are silence.
    window(): Float32Array {
        const out = new Float32Array(N_MELS * WINDOW_FRAMES).fill(LOG_EPS);
        const missing = WINDOW_FRAMES - this.columns.length;
        this.columns.forEach((column, i) => {
            for (let m = 0; m < N_MELS; m++) {
                out[m * WINDOW_FRAMES + missing + i] = column[m];
            }
        });
        let sum = 0;
        for (const v of out) sum += v;
        const mean = sum / out.length;
        let squares = 0;
        for (const v of out) squares += (v - mean) * (v - mean);
        const spread = Math.max(1e-3, Math.sqrt(squares / (out.length - 1)));
        for (let i = 0; i < out.length; i++) {
            out[i] = (out[i] - mean) / spread;
        }
        return out;
    }
}
