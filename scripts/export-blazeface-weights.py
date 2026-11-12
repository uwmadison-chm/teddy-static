# Converts MediaPipe's BlazeFace short range model into what
# demos/face-check/blazeface.js runs: a layer list (blazeface-layers.json) and
# its weights as float16 (blazeface.bin), which the model stores them as.
#
#   pip install tflite numpy
#   curl -O https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
#   python3 scripts/export-blazeface-weights.py blaze_face_short_range.tflite demos/face-check
#
# The model is Apache 2.0, from https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector
import json, sys
import numpy as np
import tflite

model_path, out_dir = sys.argv[1], sys.argv[2]
buf = open(model_path, 'rb').read()
m = tflite.Model.GetRootAsModel(buf, 0)
g = m.Subgraphs(0)
B = tflite.BuiltinOperator
SAME, VALID = tflite.Padding.SAME, tflite.Padding.VALID

def tensor(i):
    t = g.Tensors(i)
    dtype = {tflite.TensorType.FLOAT16: np.float16, tflite.TensorType.INT32: np.int32, tflite.TensorType.FLOAT32: np.float32}[t.Type()]
    return np.frombuffer(m.Buffers(t.Buffer()).DataAsNumpy().tobytes(), dtype=dtype).reshape(t.ShapeAsNumpy())

def options(op, cls):
    o = cls(); t = op.BuiltinOptions(); o.Init(t.Bytes, t.Pos); return o

# Tensors get small ids in the order they're made; 0 is the input.
ids = {int(g.InputsAsNumpy()[0]): 0}
def tid(i):
    return ids.setdefault(i, len(ids))

dequantized = {}  # float32 tensor -> its float16 constant
weights = []
offset = 0
def add_weights(a):
    global offset
    a = np.ascontiguousarray(a, dtype=np.float32).ravel()
    weights.append(a); at = offset; offset += a.size
    return at

layers = []
heads = {}
for k in range(g.OperatorsLength()):
    op = g.Operators(k)
    code = m.OperatorCodes(op.OpcodeIndex())
    bc = max(code.BuiltinCode(), code.DeprecatedBuiltinCode())
    ins = [int(i) for i in op.InputsAsNumpy()]
    out = int(op.OutputsAsNumpy()[0])
    name = g.Tensors(out).Name().decode()
    if bc == B.DEQUANTIZE:
        dequantized[out] = ins[0]
        continue
    if bc in (B.RESHAPE, B.CONCATENATION):
        continue  # The heads are read straight from the last convolutions.
    if bc in (B.CONV_2D, B.DEPTHWISE_CONV_2D):
        o = options(op, tflite.Conv2DOptions if bc == B.CONV_2D else tflite.DepthwiseConv2DOptions)
        w = tensor(dequantized[ins[1]]); b = tensor(dequantized[ins[2]])
        assert o.FusedActivationFunction() == 0 and o.StrideH() == o.StrideW() and o.DilationHFactor() == 1
        if bc == B.CONV_2D:  # [cout][k][k][cin]
            kind, ksize, cin, cout = 'conv', w.shape[1], w.shape[3], w.shape[0]
        else:  # [1][k][k][c]
            kind, ksize, cin, cout = 'dw', w.shape[1], w.shape[3], w.shape[3]
            assert ksize == 3
        assert (o.Padding() == SAME) or ksize == 1
        row = [kind, tid(ins[0]), tid(out), ksize, cin, cout, o.StrideH(), add_weights(w), add_weights(b)]
    elif bc == B.RELU:
        row = ['relu', tid(ins[0]), tid(out)]
    elif bc == B.ADD:
        assert options(op, tflite.AddOptions).FusedActivationFunction() == 0
        row = ['add', tid(ins[0]), tid(out), tid(ins[1])]
    elif bc == B.MAX_POOL_2D:
        o = options(op, tflite.Pool2DOptions)
        assert o.FilterHeight() == o.FilterWidth() == o.StrideH() == o.StrideW() == 2
        row = ['pool', tid(ins[0]), tid(out)]
    elif bc == B.PAD:
        p = tensor(ins[1]).tolist()
        assert p[:3] == [[0, 0]] * 3 and p[3][0] == 0
        row = ['padc', tid(ins[0]), tid(out), p[3][1]]
    else:
        raise SystemExit(f'Unexpected op {bc} at {name}')
    for head in ('classificator_8', 'classificator_16', 'regressor_8', 'regressor_16'):
        if name == head:
            heads[head] = row[2]
    layers.append(row)

# blazeface.js reads the heads from these tensor ids.
assert [heads[h] for h in ('classificator_8', 'classificator_16', 'regressor_8', 'regressor_16')] == [81, 82, 83, 84], heads
np.concatenate(weights).astype(np.float16).tofile(f'{out_dir}/blazeface.bin')
json.dump(layers, open(f'{out_dir}/blazeface-layers.json', 'w'), separators=(',', ':'))
print(f'{len(layers)} layers, {offset} weights')
