"""训练手写小写字母识别模型（EMNIST letters，26 类，大小写合并），导出给浏览器里的纯 JS 推理用。

用法：
  tools/handwriting/.venv/bin/python -I tools/handwriting/train.py <EMNIST 数据目录> <输出目录>

输出：
  <输出目录>/letters.json        张量布局（名称、形状、偏移）
  <输出目录>/letters.bin         float32 小端权重（BatchNorm 已折叠进卷积）
  <输出目录>/letters-sample.json 若干测试样本及其 logits，供 JS 推理做一致性测试
"""
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

CLASSES = 'abcdefghijklmnopqrstuvwxyz'
SEED = 7


def load_images(path):
    with gzip.open(path) as f:
        b = f.read()
    n = int.from_bytes(b[4:8], 'big')
    # EMNIST 原始图是转置存储的，转回正常方向
    return np.frombuffer(b, np.uint8, offset=16).reshape(n, 28, 28).transpose(0, 2, 1).copy()


def load_labels(path):
    with gzip.open(path) as f:
        b = f.read()
    return np.frombuffer(b, np.uint8, offset=8).astype(np.int64) - 1  # 1..26 → 0..25


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv2d(1, 16, 3, padding=1, bias=False); self.b1 = nn.BatchNorm2d(16)
        self.c2 = nn.Conv2d(16, 32, 3, padding=1, bias=False); self.b2 = nn.BatchNorm2d(32)
        self.c3 = nn.Conv2d(32, 64, 3, padding=1, bias=False); self.b3 = nn.BatchNorm2d(64)
        self.f1 = nn.Linear(64 * 3 * 3, 128)
        self.f2 = nn.Linear(128, 26)
        self.drop = nn.Dropout(0.3)

    def forward(self, x):
        x = F.max_pool2d(F.relu(self.b1(self.c1(x))), 2)  # 16x14x14
        x = F.max_pool2d(F.relu(self.b2(self.c2(x))), 2)  # 32x7x7
        x = F.max_pool2d(F.relu(self.b3(self.c3(x))), 2)  # 64x3x3
        x = self.drop(F.relu(self.f1(x.flatten(1))))
        return self.f2(x)


def augment(x):
    """随机仿射 + 笔画粗细变化，模拟孩子在 iPad 上写的字。x: [N,1,28,28]，值域 0..1。"""
    n, dev = x.shape[0], x.device
    rot = (torch.rand(n, device=dev) * 2 - 1) * math.radians(12)
    shear = (torch.rand(n, device=dev) * 2 - 1) * 0.2
    scale = 0.85 + torch.rand(n, device=dev) * 0.3          # 整体大小
    aspect = 1 + (torch.rand(n, device=dev) * 2 - 1) * 0.12  # 宽高比
    tx, ty = [(torch.rand(n, device=dev) * 2 - 1) * 0.1 for _ in range(2)]
    cos, sin = torch.cos(rot), torch.sin(rot)
    sx, sy = 1 / (scale * aspect), aspect / scale
    theta = torch.stack([
        torch.stack([cos * sx, (-sin + shear) * sx, tx], 1),
        torch.stack([sin * sy, cos * sy, ty], 1),
    ], 1)
    grid = F.affine_grid(theta, x.shape, align_corners=False)
    x = F.grid_sample(x, grid, align_corners=False, padding_mode='zeros')

    r = torch.rand(n, 1, 1, 1, device=dev)
    thick = 0.5 * x + 0.5 * F.max_pool2d(x, 3, 1, 1)
    thin = 0.5 * x - 0.5 * F.max_pool2d(-x, 3, 1, 1)
    x = torch.where(r < 0.3, thick, torch.where(r < 0.5, thin, x))
    peak = x.amax((2, 3), keepdim=True).clamp_min(1e-3)
    return (x / peak).clamp(0, 1)


def fold_bn(conv, bn):
    s = bn.weight / torch.sqrt(bn.running_var + bn.eps)
    return conv.weight * s[:, None, None, None], bn.bias - bn.running_mean * s


def main():
    data, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(SEED); np.random.seed(SEED)
    dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')

    X = load_images(data / 'emnist-letters-train-images-idx3-ubyte.gz')
    y = load_labels(data / 'emnist-letters-train-labels-idx1-ubyte.gz')
    Xt = load_images(data / 'emnist-letters-test-images-idx3-ubyte.gz')
    yt = load_labels(data / 'emnist-letters-test-labels-idx1-ubyte.gz')
    perm = np.random.permutation(len(X))
    val_idx, tr_idx = perm[:8000], perm[8000:]

    to_t = lambda a: torch.from_numpy(a).float().div(255).unsqueeze(1).to(dev)
    Xtr, ytr = to_t(X[tr_idx]), torch.from_numpy(y[tr_idx]).to(dev)
    Xva, yva = to_t(X[val_idx]), torch.from_numpy(y[val_idx]).to(dev)
    Xte, yte = to_t(Xt), torch.from_numpy(yt).to(dev)

    model = Net().to(dev)
    epochs, bs = 15, 256
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    steps = epochs * math.ceil(len(Xtr) / bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=steps)

    def accuracy(Xs, ys):
        model.eval(); correct = 0
        with torch.no_grad():
            for i in range(0, len(Xs), 2048):
                correct += (model(Xs[i:i + 2048]).argmax(1) == ys[i:i + 2048]).sum().item()
        return correct / len(Xs)

    for ep in range(epochs):
        model.train()
        order = torch.randperm(len(Xtr), device=dev)
        total = 0.0
        for i in range(0, len(Xtr), bs):
            idx = order[i:i + bs]
            loss = F.cross_entropy(model(augment(Xtr[idx])), ytr[idx], label_smoothing=0.05)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            total += loss.item() * len(idx)
        print(f'epoch {ep + 1:2d}  loss {total / len(Xtr):.4f}  val {accuracy(Xva, yva):.4f}', flush=True)

    print(f'test accuracy {accuracy(Xte, yte):.4f}')
    model.eval()
    with torch.no_grad():
        pred = torch.cat([model(Xte[i:i + 2048]).argmax(1) for i in range(0, len(Xte), 2048)]).cpu().numpy()
    conf = np.zeros((26, 26), int)
    np.add.at(conf, (yt, pred), 1)
    np.fill_diagonal(conf, 0)
    top = np.dstack(np.unravel_index(np.argsort(-conf, axis=None)[:10], conf.shape))[0]
    print('top confusions (true→pred count):', ', '.join(f'{CLASSES[a]}→{CLASSES[b]} {conf[a, b]}' for a, b in top))

    # 导出：BatchNorm 折叠进卷积，按固定顺序写 float32
    model = model.cpu().eval()
    tensors = []
    for c, b in [(model.c1, model.b1), (model.c2, model.b2), (model.c3, model.b3)]:
        w, bias = fold_bn(c, b)
        tensors += [w, bias]
    tensors += [model.f1.weight, model.f1.bias, model.f2.weight, model.f2.bias]
    names = ['conv1.w', 'conv1.b', 'conv2.w', 'conv2.b', 'conv3.w', 'conv3.b', 'fc1.w', 'fc1.b', 'fc2.w', 'fc2.b']
    layout, blobs, offset = [], [], 0
    for name, t in zip(names, tensors):
        a = t.detach().numpy().astype('<f4').ravel()
        layout.append({'name': name, 'shape': list(t.shape), 'offset': offset})
        blobs.append(a); offset += a.size
    (out / 'letters.bin').write_bytes(np.concatenate(blobs).tobytes())
    (out / 'letters.json').write_text(json.dumps({'classes': CLASSES, 'size': 28, 'tensors': layout}, indent=1))

    # 一致性测试样本：输入保留 4 位小数，logits 用折叠后的权重在 CPU 上算
    pick = np.random.RandomState(SEED).choice(len(Xt), 8, replace=False)
    inputs = np.round(Xt[pick].astype(np.float32) / 255, 4)
    with torch.no_grad():
        logits = model(torch.from_numpy(inputs).unsqueeze(1)).numpy()
    sample = {'labels': [CLASSES[i] for i in yt[pick]],
              'inputs': [[round(float(v), 4) for v in im.ravel()] for im in inputs],
              'logits': [[round(float(v), 5) for v in row] for row in logits]}
    (out / 'letters-sample.json').write_text(json.dumps(sample))
    print('exported', offset, 'floats to', out)


if __name__ == '__main__':
    main()
