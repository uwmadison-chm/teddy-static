// Runs the face detector, BlazeFace short range, off the page: on WebAssembly
// SIMD where the browser has it, or plain JS where it doesn't (Safari before
// 16.4), which gives the same answers more slowly. See faceModel.ts for the
// page's side.

import {BlazeFace, INPUT_SIZE, type BlazeFaceModel} from "@/utils/blazeface/blazeface.ts";
import {BlazeFaceWasm, wasmSimdSupported} from "@/utils/blazeface/blazefaceWasm.ts";
import layers from "@/utils/blazeface/layers.json";
import type {Face, FaceModelReply, FaceModelRequest} from "@/utils/faceModel.ts";

const reply = (message: FaceModelReply) => self.postMessage(message);

function errorFields(error: unknown): {name: string, message: string, stack?: string} {
    const e = error as Error;
    return {name: String(e?.name ?? "Error"), message: String(e?.message ?? error), stack: e?.stack};
}

let model: BlazeFaceModel;
let scoreThreshold = 0.5;
const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
const context = canvas.getContext("2d", {willReadFrequently: true});

async function load(weightsUrl: string, wasmUrl: string, threshold: number) {
    const [weights, wasm] = await Promise.all([
        fetch(weightsUrl).then(response => response.arrayBuffer()),
        fetch(wasmUrl).then(response => response.arrayBuffer()).catch(() => null),
    ]);
    model = wasm != null && wasmSimdSupported(wasm) ? new BlazeFaceWasm(layers, weights, wasm) : new BlazeFace(layers, weights);
    scoreThreshold = threshold;
    // Warm up, so the first real check isn't slow.
    model.run();
}

// The most likely face in the frame, in the frame's pixels. The whole frame
// goes in, letterboxed to the model's square, as MediaPipe does it.
function detect(frame: ImageBitmap): Face | undefined {
    const scale = INPUT_SIZE / Math.max(frame.width, frame.height);
    const dw = frame.width * scale, dh = frame.height * scale, dx = (INPUT_SIZE - dw) / 2, dy = (INPUT_SIZE - dh) / 2;
    context.fillStyle = "#000";
    context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    context.drawImage(frame, dx, dy, dw, dh);
    frame.close();
    model.setPixels(context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data);
    const best = model.detect(scoreThreshold)[0];
    if (best == null) {
        return undefined;
    }
    const b = best.box;
    return {
        score: best.score,
        box: {x: (b.x * INPUT_SIZE - dx) / scale, y: (b.y * INPUT_SIZE - dy) / scale, width: b.width * INPUT_SIZE / scale, height: b.height * INPUT_SIZE / scale},
    };
}

self.onmessage = async (event: MessageEvent<FaceModelRequest>) => {
    const request = event.data;
    try {
        if (request.type == "load") {
            await load(request.weightsUrl, request.wasmUrl, request.scoreThreshold);
            reply({type: "loaded", backend: model.backend == "WASM SIMD" ? "wasm-simd" : "js"});
        } else {
            reply({type: "detected", id: request.id, face: detect(request.frame)});
        }
    } catch (error) {
        reply({type: "failed", id: request.type == "detect" ? request.id : undefined, error: errorFields(error)});
    }
};
