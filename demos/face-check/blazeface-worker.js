// Runs the BlazeFace port off the page. Speaks the same messages as the app's
// faceApiWorker.ts, so the bench treats both detectors alike:
//   {type: "load", layers, weights: ArrayBuffer, scoreThreshold}  -> {type: "loaded", backend}
//   {type: "detect", id, frame: ImageBitmap, crop}                -> {type: "detected", id, face, scores, ms}
// `crop` is "frame" (the whole picture, letterboxed, as MediaPipe does it) or
// "square" (only the middle square, which is what the participant sees).
// A face's box and keypoints are in the frame's pixels.

import {BlazeFace, INPUT_SIZE} from "./blazeface.js";

let model = null;
let threshold = 0.5;
const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
const context = canvas.getContext("2d", {willReadFrequently: true});

function detect(frame, crop) {
    const t0 = performance.now();
    const fw = frame.width, fh = frame.height;
    // The part of the frame that goes in, and where it lands in the 128 square.
    let sx = 0, sy = 0, sw = fw, sh = fh;
    if (crop === "square") {
        const side = Math.min(fw, fh);
        sx = (fw - side) / 2; sy = (fh - side) / 2; sw = sh = side;
    }
    const scale = INPUT_SIZE / Math.max(sw, sh);
    const dw = sw * scale, dh = sh * scale, dx = (INPUT_SIZE - dw) / 2, dy = (INPUT_SIZE - dh) / 2;
    context.fillStyle = "#000";
    context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    context.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh);
    frame.close();
    const pixels = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data, input = model.input;
    for (let i = 0, j = 0; i < pixels.length; i += 4) {
        input[j++] = pixels[i] / 127.5 - 1;
        input[j++] = pixels[i + 1] / 127.5 - 1;
        input[j++] = pixels[i + 2] / 127.5 - 1;
    }
    const t1 = performance.now();
    const faces = model.detect(threshold);
    const t2 = performance.now();
    const toFrame = (x, y) => ({x: sx + (x * INPUT_SIZE - dx) / scale, y: sy + (y * INPUT_SIZE - dy) / scale});
    const mapped = faces.map(f => {
        const a = toFrame(f.box.x, f.box.y), b = toFrame(f.box.x + f.box.width, f.box.y + f.box.height);
        return {score: f.score, box: {x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y}, keypoints: f.keypoints.map(k => toFrame(k.x, k.y))};
    });
    return {face: mapped[0], scores: mapped.map(f => f.score), ms: {prep: t1 - t0, model: t2 - t1}};
}

self.onmessage = (event) => {
    const request = event.data;
    try {
        if (request.type === "load") {
            model = new BlazeFace(request.layers, request.weights);
            threshold = request.scoreThreshold;
            // Warm up, so the first real check isn't slow.
            model.run();
            self.postMessage({type: "loaded", backend: "plain JS"});
        } else {
            self.postMessage({type: "detected", id: request.id, ...detect(request.frame, request.crop)});
        }
    } catch (error) {
        self.postMessage({type: "failed", id: request.type === "detect" ? request.id : undefined, error: {name: String(error?.name ?? "Error"), message: String(error?.message ?? error), stack: error?.stack}});
    }
};
