import type * as FaceApi from 'face-api.js';
import faceModelManifest from "@/assets/facemodels/tiny_face_detector_model-weights_manifest.json";
import faceModelWeightsUrl from "@/assets/facemodels/tiny_face_detector_model-shard1.shard?url";

// The detector looks at the camera's picture at this size, in pixels.
const INPUT_SIZE = 224;
// Faces fainter than this aren't reported at all. Fainter guesses than the
// FaceDetector's FACE_SCORE still say where a face probably is, for the tips.
const GUESS_SCORE = 0.2;

export interface Box {x: number, y: number, width: number, height: number}

export interface Face {
    score: number;
    box: Box;
}

export interface FaceDetection {
    // Where detection runs: in a worker, or on the page itself when a worker
    // can't use WebGL there (older Safari, for one).
    where: "worker" | "page";
    // TensorFlow.js's backend, normally "webgl".
    backend: string;
    // Whether the first detection will freeze the page while TensorFlow.js
    // compiles its shaders. warmUp() gets that over with.
    needsWarmUp: boolean;
    warmUp: () => Promise<void>;
    detect: (video: HTMLVideoElement) => Promise<Face | undefined>;
}

// Messages between the page and faceApiWorker.ts.
export type FaceApiRequest =
    | {type: "load", weightsUrl: string, inputSize: number, scoreThreshold: number}
    | {type: "detect", id: number, frame: ImageBitmap};
export type FaceApiReply =
    | {type: "loaded", backend: string}
    | {type: "detected", id: number, face: Face | undefined}
    | {type: "failed", id?: number, error: {name: string, message: string, stack?: string}};

function toError(fields: {name: string, message: string, stack?: string}): Error {
    const error = new Error(fields.message);
    error.name = fields.name;
    error.stack = fields.stack;
    return error;
}

// Loads face-api.js and the model in a worker, which also gets the slow first
// detection out of the way. Rejects if the worker can't run it, or would have
// to without WebGL, which is too slow to be worth it.
function loadInWorker(): Promise<FaceDetection> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./faceApiWorker.ts", import.meta.url), {type: "module"});
        const waiting = new Map<number, {resolve: (face: Face | undefined) => void, reject: (error: Error) => void}>();
        let nextId = 0;
        let loaded = false;
        let failed: Error | null = null;
        const fail = (error: Error) => {
            failed = error;
            worker.terminate();
            waiting.forEach(check => check.reject(error));
            waiting.clear();
            if (!loaded) {
                reject(error);
            }
        };
        worker.onerror = (event) => {
            event.preventDefault();
            fail(new Error(`The face detector's worker failed: ${event.message || "no reason given"}`));
        };
        worker.onmessage = (event: MessageEvent<FaceApiReply>) => {
            const message = event.data;
            if (message.type == "loaded") {
                if (message.backend != "webgl") {
                    fail(new Error(`The face detector's worker has no WebGL (backend ${message.backend})`));
                    return;
                }
                loaded = true;
                resolve({
                    where: "worker",
                    backend: message.backend,
                    needsWarmUp: false,
                    warmUp: () => Promise.resolve(),
                    detect: async (video) => {
                        if (failed != null) {
                            throw failed;
                        }
                        const frame = await createImageBitmap(video);
                        const id = nextId++;
                        return new Promise((resolve, reject) => {
                            waiting.set(id, {resolve, reject});
                            worker.postMessage({type: "detect", id, frame} satisfies FaceApiRequest, [frame]);
                        });
                    },
                });
            } else if (message.type == "failed" && message.id == null) {
                fail(toError(message.error));
            } else {
                const check = waiting.get(message.id);
                waiting.delete(message.id);
                if (message.type == "detected") {
                    check?.resolve(message.face);
                } else {
                    check?.reject(toError(message.error));
                }
            }
        };
        worker.postMessage({
            type: "load",
            weightsUrl: new URL(faceModelWeightsUrl, document.baseURI).href,
            inputSize: INPUT_SIZE,
            scoreThreshold: GUESS_SCORE,
        } satisfies FaceApiRequest);
    });
}

// face-api.js pulls in all of TensorFlow.js, about half the app's JS, so on
// the page it gets its own chunk too.
async function loadOnPage(): Promise<FaceDetection> {
    const [faceapi, weights] = await Promise.all([
        import('face-api.js'),
        // Loaded from the bundle's hashed URL instead of with loadFromUri, which
        // finds the weights file by its unhashed name in the manifest.
        fetch(faceModelWeightsUrl).then(response => response.arrayBuffer()),
    ]);
    faceapi.nets.tinyFaceDetector.loadFromWeightMap(
        faceapi.tf.io.decodeWeights(weights, faceModelManifest[0].weights as FaceApi.tf.io.WeightsManifestEntry[]));
    await faceapi.tf.ready();
    const options = new faceapi.TinyFaceDetectorOptions({inputSize: INPUT_SIZE, scoreThreshold: GUESS_SCORE});
    let warming: Promise<void> | null = null;
    const detection: FaceDetection = {
        where: "page",
        backend: faceapi.tf.getBackend(),
        needsWarmUp: true,
        warmUp: () => warming ??= (async () => {
            const blank = faceapi.tf.zeros([INPUT_SIZE, INPUT_SIZE, 3]) as FaceApi.tf.Tensor3D;
            try {
                await faceapi.detectSingleFace(blank, options).run();
            } finally {
                blank.dispose();
            }
            detection.needsWarmUp = false;
        })(),
        detect: async (video) => {
            const found = await faceapi.detectSingleFace(video, options).run();
            if (found == null) {
                return undefined;
            }
            const {x, y, width, height} = found.box;
            return {score: found.score, box: {x, y, width, height}};
        },
    };
    return detection;
}

let loading: Promise<FaceDetection> | null = null;

// Resolves with the face detector once its model is loaded: in a worker if
// possible, otherwise on the page. Safe to call repeatedly; a failed load is
// retried on the next call.
export function loadFaceApi(): Promise<FaceDetection> {
    loading ??= (async () => {
        performance.mark("face-api-load-start");
        let detection: FaceDetection;
        try {
            detection = await loadInWorker();
        } catch (error) {
            console.warn("Running the face detector on the page instead of in a worker:", error);
            detection = await loadOnPage();
        }
        performance.measure("face-api-load", "face-api-load-start");
        console.log(`Loaded Face Detector Model (${detection.where}, ${detection.backend})`);
        return detection;
    })().catch(error => {
        loading = null;
        throw error;
    });
    return loading;
}
