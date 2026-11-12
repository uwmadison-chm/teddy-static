# Writes TinyVadCNN's weights from Moonshine's ONNX export into the flat
# float32 file that src/utils/vad/tinyVad.ts reads.
#
#   pip install onnx numpy
#   python scripts/export-vad-weights.py path/to/tinyvad_cnn_speech_mel.onnx
#
# The model comes from https://github.com/moonshine-ai/moonshine, micro/models
# (MIT License; see src/assets/vad/LICENSE-moonshine.txt). The file holds each
# Conv's weight then bias, in graph order, then the classifier's weight and
# bias, little-endian. tinyVad.ts lists the same layers in the same order and
# checks the total length, so a model with a different shape fails to load
# instead of running wrong.

import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper

model = onnx.load(sys.argv[1])
inits = {i.name: numpy_helper.to_array(i) for i in model.graph.initializer}
parts = []
for node in model.graph.node:
    if node.op_type in ("Conv", "Gemm"):
        weight, bias = (inits[name] for name in node.input[1:3])
        print(node.op_type, weight.shape, bias.shape)
        parts += [weight.ravel(), bias.ravel()]
weights = np.concatenate(parts).astype("<f4")
out = Path(__file__).resolve().parent.parent / "src/assets/vad/tinyvad.bin"
out.write_bytes(weights.tobytes())
print(f"{weights.size} floats -> {out}")
