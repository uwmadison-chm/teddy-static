import weightsUrl from "@/assets/blazeface/blazeface.bin?url";
import wasmUrl from "@/assets/blazeface/blazeface-simd.wasm?url";

// Faces fainter than this aren't reported at all. Fainter guesses than the
// FaceDetector's FACE_SCORE still say where a face probably is, for the tips.
const GUESS_SCORE = 0.2;

export interface Box {x: number, y: number, width: number, height: number}

export interface Face {
    score: number;
    box: Box;
}

export interface FaceDetection {
    // How the worker runs BlazeFace: "wasm-simd", or "js" where the browser
    // has no WebAssembly SIMD (Safari before 16.4), which gives the same
    // answers more slowly.
    backend: string;
    detect: (video: HTMLVideoElement) => Promise<Face | undefined>;
}

// Messages between the page and faceModelWorker.ts.
export type FaceModelRequest =
    | {type: "load", weightsUrl: string, wasmUrl: string, scoreThreshold: number}
    | {type: "detect", id: number, frame: ImageBitmap};
export type FaceModelReply =
    | {type: "loaded", backend: string}
    | {type: "detected", id: number, face: Face | undefined}
    | {type: "failed", id?: number, error: {name: string, message: string, stack?: string}};

function toError(fields: {name: string, message: string, stack?: string}): Error {
    const error = new Error(fields.message);
    error.name = fields.name;
    error.stack = fields.stack;
    return error;
}

// Loads the face detector in a worker, which also gets the first (slower)
// detection out of the way. Each check takes some milliseconds of CPU, which
// the worker keeps off the page.
function loadInWorker(): Promise<FaceDetection> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./faceModelWorker.ts", import.meta.url), {type: "module"});
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
        worker.onmessage = (event: MessageEvent<FaceModelReply>) => {
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
                            worker.postMessage({type: "detect", id, frame} satisfies FaceModelRequest, [frame]);
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
            weightsUrl: new URL(weightsUrl, document.baseURI).href,
            wasmUrl: new URL(wasmUrl, document.baseURI).href,
            scoreThreshold: GUESS_SCORE,
        } satisfies FaceModelRequest);
    });
}

let loading: Promise<FaceDetection> | null = null;

// Resolves with the face detector once its model is loaded and warmed up.
// Safe to call repeatedly; a failed load is retried on the next call.
export function loadFaceModel(): Promise<FaceDetection> {
    loading ??= (async () => {
        performance.mark("face-model-load-start");
        const detection = await loadInWorker();
        performance.measure("face-model-load", "face-model-load-start");
        console.log(`Loaded Face Detector Model (${detection.backend})`);
        return detection;
    })().catch(error => {
        loading = null;
        throw error;
    });
    return loading;
}
