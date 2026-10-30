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
    // TensorFlow.js's backend in the worker: "webgl", or "cpu" where a worker
    // can't use WebGL (Safari before 17), which is slower but still keeps
    // detection off the page.
    backend: string;
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
// detection out of the way. face-api.js pulls in all of TensorFlow.js, about
// half the app's JS, and the first detection compiles its WebGL shaders, which
// would freeze the page for a second or more; the worker keeps both off it.
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
                loaded = true;
                resolve({
                    backend: message.backend,
                    detect: async (video) => {
                        if (failed != null) {
                            throw failed;
                        }
                        // No picture yet, so no face in it.
                        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth == 0) {
                            return undefined;
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

let loading: Promise<FaceDetection> | null = null;

// Resolves with the face detector once its model is loaded and warmed up.
// Safe to call repeatedly; a failed load is retried on the next call.
export function loadFaceApi(): Promise<FaceDetection> {
    loading ??= (async () => {
        performance.mark("face-api-load-start");
        const detection = await loadInWorker();
        performance.measure("face-api-load", "face-api-load-start");
        console.log(`Loaded Face Detector Model (${detection.backend})`);
        return detection;
    })().catch(error => {
        loading = null;
        throw error;
    });
    return loading;
}
