// Listens to the camera stream's microphone and says, every 32 ms, how loud it
// was and how sure TinyVadCNN is that someone was speaking.
//
// It reads the same stream the recordings come from, so it never asks for the
// microphone a second time, and it never stops the stream's tracks.

import weightsUrl from "@/assets/vad/tinyvad.bin?url";
import {TinyVad} from "./tinyVad.ts";
import {HOP, MelStreamer} from "./melStreamer.ts";
import {Resampler} from "./resampler.ts";

export type Hop = {
    // The chance, 0 to 1, that the last half second holds speech.
    speech: number;
    // This 32 ms's level, in dB below full scale (0 is as loud as it gets).
    db: number;
};

let loading: Promise<TinyVad> | null = null;

// Loads the model once. A failed load is tried again next time.
export function loadVad(): Promise<TinyVad> {
    loading ??= fetch(weightsUrl)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`The voice detector's weights didn't load: HTTP ${response.status}`);
            }
            return response.arrayBuffer();
        })
        .then((weights) => new TinyVad(weights))
        .catch((error) => {
            loading = null;
            throw error;
        });
    return loading;
}

// Copies the microphone's samples out of the audio thread in batches.
const TAP_SOURCE = `
class TeddyMicTap extends AudioWorkletProcessor {
    constructor() {
        super();
        this.batch = new Float32Array(2048);
        this.filled = 0;
    }
    process(inputs) {
        const samples = inputs[0] && inputs[0][0];
        if (samples) {
            for (let i = 0; i < samples.length; i++) {
                this.batch[this.filled++] = samples[i];
                if (this.filled == this.batch.length) {
                    this.port.postMessage(this.batch);
                    this.batch = new Float32Array(this.batch.length);
                    this.filled = 0;
                }
            }
        }
        return true;
    }
}
registerProcessor("teddy-mic-tap", TeddyMicTap);
`;

// Starts listening, and keeps on until `signal` fires. Resolves once it's
// listening; rejects if the model won't load or the browser can't give us the
// audio. If the browser holds the audio back (some do until the page has been
// tapped), it just won't call onHop.
export async function listen(stream: MediaStream, onHop: (hop: Hop) => void, signal: AbortSignal): Promise<{sampleRate: number}> {
    const vad = await loadVad();
    const track = stream.getAudioTracks()[0];
    if (track == null) {
        throw new Error("The camera stream has no microphone");
    }
    const context = new AudioContext();
    const close = () => {
        context.close().catch(() => {});
    };
    signal.addEventListener("abort", close, {once: true});
    try {
        const moduleUrl = URL.createObjectURL(new Blob([TAP_SOURCE], {type: "text/javascript"}));
        try {
            await context.audioWorklet.addModule(moduleUrl);
        } finally {
            URL.revokeObjectURL(moduleUrl);
        }
        if (signal.aborted) {
            return {sampleRate: context.sampleRate};
        }
        // Only the microphone's track, so closing this never touches the video.
        const source = context.createMediaStreamSource(new MediaStream([track]));
        const tap = new AudioWorkletNode(context, "teddy-mic-tap", {numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit"});
        // Some browsers only run a node that leads to the speakers; this one
        // sends them silence.
        const mute = context.createGain();
        mute.gain.value = 0;
        source.connect(tap).connect(mute).connect(context.destination);

        const resampler = new Resampler(context.sampleRate);
        const mel = new MelStreamer();
        const block = new Float32Array(HOP);
        let filled = 0;
        tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
            if (signal.aborted) {
                return;
            }
            resampler.push(event.data, (sample) => {
                block[filled++] = sample;
                if (filled < HOP) {
                    return;
                }
                filled = 0;
                let squares = 0;
                for (const s of block) {
                    squares += s * s;
                }
                const db = 10 * Math.log10(Math.max(squares / HOP, 1e-12));
                mel.push(block);
                onHop({speech: vad.predict(mel.window()), db});
            });
        };
        context.resume().catch(() => {});
        return {sampleRate: context.sampleRate};
    } catch (error) {
        signal.removeEventListener("abort", close);
        close();
        throw error;
    }
}
