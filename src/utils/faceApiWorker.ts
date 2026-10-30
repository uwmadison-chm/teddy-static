// Runs face-api.js off the main thread. The first detection compiles
// TensorFlow.js's WebGL shaders, which can freeze the page for a second or
// more, so this loads the model and runs one detection on a blank picture as
// soon as it starts. See faceApi.ts for the page's side.

import * as faceapi from 'face-api.js';
import type * as FaceApi from 'face-api.js';
import faceModelManifest from "@/assets/facemodels/tiny_face_detector_model-weights_manifest.json";
import type {FaceApiReply, FaceApiRequest} from "@/utils/faceApi.ts";

const reply = (message: FaceApiReply) => self.postMessage(message);

function errorFields(error: unknown): {name: string, message: string, stack?: string} {
    const e = error as Error;
    return {name: String(e?.name ?? "Error"), message: String(e?.message ?? error), stack: e?.stack};
}

// face-api.js only knows browser pages and Node, so tell it what a worker has.
// Everything it gets here is a tensor, so it never needs images or video.
class Unavailable {}
faceapi.env.setEnv({
    Canvas: OffscreenCanvas as unknown as typeof HTMLCanvasElement,
    CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D as unknown as typeof CanvasRenderingContext2D,
    Image: Unavailable as typeof HTMLImageElement,
    ImageData,
    Video: Unavailable as typeof HTMLVideoElement,
    createCanvasElement: () => new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement,
    createImageElement: () => { throw new Error("No images in a worker"); },
    fetch: (url, init) => fetch(url, init),
    readFile: () => { throw new Error("No files in a worker"); },
});

let options: FaceApi.TinyFaceDetectorOptions;
let canvas: OffscreenCanvas | null = null;

async function load(weightsUrl: string, inputSize: number, scoreThreshold: number) {
    const weights = await fetch(weightsUrl).then(response => response.arrayBuffer());
    faceapi.nets.tinyFaceDetector.loadFromWeightMap(
        faceapi.tf.io.decodeWeights(weights, faceModelManifest[0].weights as FaceApi.tf.io.WeightsManifestEntry[]));
    await faceapi.tf.ready();
    options = new faceapi.TinyFaceDetectorOptions({inputSize, scoreThreshold});
    const blank = faceapi.tf.zeros([inputSize, inputSize, 3]) as FaceApi.tf.Tensor3D;
    try {
        await faceapi.detectSingleFace(blank, options).run();
    } finally {
        blank.dispose();
    }
}

async function detect(frame: ImageBitmap) {
    if (canvas == null || canvas.width != frame.width || canvas.height != frame.height) {
        canvas = new OffscreenCanvas(frame.width, frame.height);
    }
    const context = canvas.getContext("2d", {willReadFrequently: true});
    context.drawImage(frame, 0, 0);
    frame.close();
    const pixels = faceapi.tf.browser.fromPixels(context.getImageData(0, 0, canvas.width, canvas.height));
    try {
        const detection = await faceapi.detectSingleFace(pixels, options).run();
        if (detection == null) {
            return undefined;
        }
        const {x, y, width, height} = detection.box;
        return {score: detection.score, box: {x, y, width, height}};
    } finally {
        pixels.dispose();
    }
}

self.onmessage = async (event: MessageEvent<FaceApiRequest>) => {
    const request = event.data;
    try {
        if (request.type == "load") {
            await load(request.weightsUrl, request.inputSize, request.scoreThreshold);
            reply({type: "loaded", backend: faceapi.tf.getBackend()});
        } else {
            reply({type: "detected", id: request.id, face: await detect(request.frame)});
        }
    } catch (error) {
        reply({type: "failed", id: request.type == "detect" ? request.id : undefined, error: errorFields(error)});
    }
};
