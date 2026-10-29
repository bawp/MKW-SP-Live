"""How much of a Mii's brows its eyes cover. Mii Studio draws the eyes over the brows, so a brow
hidden in an eye is gone from its pictures, but the game draws brows over eyes and shows it.
Each eye (type, scale, rotation) and brow (type, scale, rotation) is rendered once where it starts
(cache/overlap.pkl): its pixels against a render without it. Moving a part moves its pixels, so a
Mii's overlap is its brow's pixels, moved to its place, under its eye's."""
import os
import pickle
import threading

import numpy as np

import library as L
import studio

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, 'cache', 'overlap.pkl')
DOWN = 2                  # masks kept at 256 pixels
COVERED = 0.4             # the share of a brow's pixels under an eye that hides it
BASE = dict(studio.DEFAULT, hairType=L.BALD, glassesType=0, mustacheType=0, beardType=0, moleOn=0)
NO_EYE = dict(eyeType=18, eyeScale=0)            # a dot in the eye's place: renders without eyes
NO_BROW = dict(browY=3, browScale=0)             # the eyes' renders without brows
_lock = threading.Lock()
_table = None


def _flat(r):
    a = r[..., 3:4].astype(np.float32) / 255.0
    return r[..., :3].astype(np.float32) * a + 255.0 * (1 - a)


def _mask(a, b):
    d = np.abs(_flat(a) - _flat(b)).sum(-1) > 40
    d = d.reshape(512 // DOWN, DOWN, 512 // DOWN, DOWN).any(axis=(1, 3))
    ys, xs = np.nonzero(d)
    if not len(ys):
        return (0, 0, np.zeros((0, 0), bool))
    return (ys.min(), xs.min(), d[ys.min():ys.max() + 1, xs.min():xs.max() + 1])


def _centre(mask):
    y0, x0, m = mask
    ys, xs = np.nonzero(m)
    return y0 + ys.mean(), x0 + xs.mean()


def _right(mask, mid):
    """the half of a mask right of the face's middle (the parts are mirrored)"""
    y0, x0, m = mask
    cut = max(0, int(mid) - x0)
    return (y0, x0 + cut, m[:, cut:])


def build():
    eyes = [(t, s, r) for t in studio_values('eyeType') for s in studio_values('eyeScale') for r in studio_values('eyeRotate')]
    brows = [(t, s, r) for t in studio_values('browType') for s in studio_values('browScale') for r in studio_values('browRotate')]
    eye_models = [dict(BASE, **NO_BROW, eyeType=t, eyeScale=s, eyeRotate=r) for t, s, r in eyes]
    brow_models = [dict(BASE, **NO_EYE, eyeY=18, browType=t, browScale=s, browRotate=r, browColor=c) for t, s, r in brows for c in (0, 4)]
    steps = [dict(BASE, **NO_BROW, eyeType=2, eyeScale=7, **p) for p in ({}, {'eyeY': 6}, {'eyeX': 8})] + \
            [dict(BASE, **NO_EYE, eyeY=18, browType=6, browScale=8, browColor=c, **p) for p in ({}, {'browY': 16}, {'browX': 8}) for c in (0, 4)]
    empty = L.render_all([dict(BASE, **NO_BROW, **NO_EYE)])[0]
    far = L.render_all([dict(BASE, **NO_BROW, **NO_EYE, eyeY=6), dict(BASE, **NO_BROW, **NO_EYE, eyeX=8)])
    er = L.render_all(eye_models)
    br = L.render_all(brow_models)
    sr = L.render_all(steps)
    mid = 256 / DOWN
    eye = {k: _right(_mask(r, empty), mid) for k, r in zip(eyes, er)}
    brow = {k: _right(_mask(br[2 * i], br[2 * i + 1]), mid) for i, k in enumerate(brows)}
    e0, ey, ex = [_centre(_right(_mask(r, e), mid)) for r, e in zip(sr[:3], [empty] + far)]
    b0, by, bx = [_centre(_right(_mask(sr[3 + 2 * i], sr[4 + 2 * i]), mid)) for i in range(3)]
    unit = dict(eyeY=(e0[0] - ey[0]) / 6, eyeX=(ex[1] - e0[1]) / 6, browY=(by[0] - b0[0]) / 6, browX=(bx[1] - b0[1]) / 6)
    return dict(eye=eye, brow=brow, unit=unit)


def studio_values(name):
    return range(studio.MINIMUM.get(name, 0), studio.RANGES[name] + 1)


def table():
    global _table
    with _lock:
        if _table is None:
            if os.path.exists(PATH):
                _table = pickle.load(open(PATH, 'rb'))
            else:
                _table = build()
                pickle.dump(_table, open(PATH + '.tmp', 'wb'))
                os.replace(PATH + '.tmp', PATH)
    return _table


def covered(m):
    """the share of the brow's pixels under the eye (the right ones; the left mirror them)"""
    t = table()
    u = t['unit']
    ey0, ex0, em = t['eye'][(m['eyeType'], m['eyeScale'], m['eyeRotate'])]
    by0, bx0, bm = t['brow'][(m['browType'], m['browScale'], m['browRotate'])]
    if not bm.size or not em.size:
        return 0.0
    # each moved from where it was rendered (eye 12, 2; brow 10, 2) to its place
    ey0 += round((m['eyeY'] - 12) * u['eyeY'])
    ex0 += round((m['eyeX'] - 2) * u['eyeX'])
    by0 += round((m['browY'] - 10) * u['browY'])
    bx0 += round((m['browX'] - 2) * u['browX'])
    y1, x1 = max(ey0, by0), max(ex0, bx0)
    y2, x2 = min(ey0 + em.shape[0], by0 + bm.shape[0]), min(ex0 + em.shape[1], bx0 + bm.shape[1])
    if y2 <= y1 or x2 <= x1:
        return 0.0
    both = em[y1 - ey0:y2 - ey0, x1 - ex0:x2 - ex0] & bm[y1 - by0:y2 - by0, x1 - bx0:x2 - bx0]
    return float(both.sum()) / float(bm.sum())


def clear(m):
    return covered(m) < COVERED


if __name__ == '__main__':
    t = table()
    print(len(t['eye']), 'eyes,', len(t['brow']), 'brows, pixels per step', {k: round(v, 2) for k, v in t['unit'].items()})
