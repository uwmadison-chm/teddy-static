import {SAMPLE_RATE} from "./melStreamer.ts";

// Turns the microphone's rate (usually 48 or 44.1 kHz) into 16 kHz: a
// low-pass filter at the source rate, so sounds above 8 kHz don't fold down
// into the bands the model listens to, then linear interpolation.
export class Resampler {
    private readonly taps: Float32Array;
    private readonly history: Float32Array;
    private readonly step: number;
    private filled = 0;
    // Where the next output sample falls, in source samples since `previous`.
    private position = 0;
    private previous = 0;

    constructor(sourceRate: number) {
        this.step = sourceRate / SAMPLE_RATE;
        // A windowed-sinc filter; 48 taps are plenty to tell voice from not.
        const n = 48;
        const cutoff = 0.45 * SAMPLE_RATE / sourceRate;
        this.taps = new Float32Array(n);
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const t = i - (n - 1) / 2;
            const sinc = t == 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
            const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (n - 1));
            this.taps[i] = sinc * window;
            sum += this.taps[i];
        }
        for (let i = 0; i < n; i++) {
            this.taps[i] /= sum;
        }
        this.history = new Float32Array(n);
    }

    // Feeds source samples; calls `out` with each 16 kHz sample.
    push(samples: Float32Array, out: (sample: number) => void): void {
        const n = this.taps.length;
        for (const sample of samples) {
            this.history[this.filled % n] = sample;
            this.filled++;
            let filtered = 0;
            for (let i = 0; i < n; i++) {
                filtered += this.taps[i] * this.history[(this.filled + i) % n];
            }
            while (this.position <= 1) {
                out(this.previous + (filtered - this.previous) * this.position);
                this.position += this.step;
            }
            this.position -= 1;
            this.previous = filtered;
        }
    }
}
