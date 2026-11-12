# BlazeFace short range

The face check's detector: MediaPipe's BlazeFace short range model, from [blaze_face_short_range.tflite](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite). Licensed under the Apache License 2.0 by Google; see its [model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf).

- `blazeface.bin`: the model's weights as float16, made by `scripts/export-blazeface-weights.py` with `src/utils/blazeface/layers.json`.
- `blazeface-simd.wasm`: the WebAssembly SIMD kernels, built from `src/utils/blazeface/blazeface-simd.c` (the command is at the top of that file).
