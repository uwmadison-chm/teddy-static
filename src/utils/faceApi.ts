import type * as FaceApi from 'face-api.js';
import faceModelManifest from "@/assets/facemodels/tiny_face_detector_model-weights_manifest.json";
import faceModelWeightsUrl from "@/assets/facemodels/tiny_face_detector_model-shard1.shard?url";

// face-api.js pulls in all of TensorFlow.js, about half the app's JS, and only
// the calibration screen onward needs it. Load it in its own chunk instead of
// in the main bundle.
let loading: Promise<typeof FaceApi> | null = null;

// Resolves with face-api once the face detector model is loaded. Safe to call
// repeatedly; a failed load is retried on the next call.
export function loadFaceApi(): Promise<typeof FaceApi> {
    loading ??= Promise.all([
        import('face-api.js'),
        // Loaded from the bundle's hashed URL instead of with loadFromUri, which
        // finds the weights file by its unhashed name in the manifest.
        fetch(faceModelWeightsUrl).then(response => response.arrayBuffer()),
    ]).then(([faceapi, weights]) => {
        faceapi.nets.tinyFaceDetector.loadFromWeightMap(
            faceapi.tf.io.decodeWeights(weights, faceModelManifest[0].weights as FaceApi.tf.io.WeightsManifestEntry[]));
        console.log("Loaded Face Detector Model");
        return faceapi;
    }).catch(error => {
        loading = null;
        throw error;
    });
    return loading;
}
