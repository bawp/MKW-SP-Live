"""Renders shared by every fit (cached on disk by studio.render), and what is measured from them."""
import functools
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import studio

POOL = ThreadPoolExecutor(16)


def variant(**changes):
    m = dict(studio.DEFAULT)
    m.update(changes)
    return m


def render_all(models):
    return list(POOL.map(studio.render, models))


def f32(a):
    return a.astype(np.float32)


# ---- hair and face shape --------------------------------------------------------------------
# Hair is the same model on every face shape: a hair's pixels are where its render changes with
# the hair colour (grey against black); the face's outline comes from a render with the baldest
# hair.

BALD = 30   # found by smallest_hair()


@functools.lru_cache(None)
def hair(h, flip):
    """(mask float 512x512 of the hair's pixels, alpha of the whole render)"""
    a, b = render_all([variant(hairType=h, hairFlip=flip, hairColor=4, browColor=0),
                       variant(hairType=h, hairFlip=flip, hairColor=0, browColor=0)])
    diff = np.abs(f32(a[..., :3]) - f32(b[..., :3])).sum(-1)
    mask = np.clip((diff - 20.0) / 60.0, 0, 1) * (a[..., 3] / 255.0)
    return mask.astype(np.float32), (np.maximum(a[..., 3], b[..., 3]) / 255.0).astype(np.float32)


def smallest_hair():
    sizes = [(hair(h, 0)[0].sum(), h) for h in range(72)]
    return sorted(sizes)[:5]


@functools.lru_cache(None)
def face(f):
    """alpha of face shape f with the baldest hair (the head and body's outline)"""
    a = studio.render(variant(faceType=f, hairType=BALD, browColor=0))
    return (a[..., 3] / 255.0).astype(np.float32)


@functools.lru_cache(None)
def body_mask():
    """the shirt: where the favourite colour changes the picture"""
    a, b = render_all([variant(favColor=4), variant(favColor=0)])
    return (np.abs(f32(a[..., :3]) - f32(b[..., :3])).sum(-1) > 30).astype(np.float32)


@functools.lru_cache(None)
def shirt_colours():
    ims = render_all([variant(favColor=c) for c in range(12)])
    m = body_mask() > 0
    return np.array([np.median(f32(im[..., :3])[m], axis=0) for im in ims])


@functools.lru_cache(None)
def skin_colours():
    """the face's median colour per skin, over the cheeks (the face minus its features)"""
    ims = render_all([variant(skin=s) for s in range(6)])
    region = cheek_region()
    return np.array([np.median(f32(im[..., :3])[region], axis=0) for im in ims])


def cheek_region():
    r = np.zeros((512, 512), bool)
    r[300:345, 160:205] = True
    r[300:345, 307:352] = True
    return r


@functools.lru_cache(None)
def hair_colours():
    """the hair's median colour per hair colour (a hair with a large crown)"""
    mask = hair(33, 0)[0] > 0.9
    ims = render_all([variant(hairColor=c, browColor=0) for c in range(8)])
    return np.array([np.median(f32(im[..., :3])[mask], axis=0) for im in ims])


# ---- facial parts: layers separated from the skin --------------------------------------------
# Face textures (eyes, brows, mouth, nose lines, glasses, moustache, mole) don't change with the
# skin colour; the face under them does. Two renders on skins 0 and 5 give each pixel's coverage
# (alpha) and premultiplied colour, against the face without parts (background()).

def parts_base(**changes):
    m = variant(hairType=BALD, browColor=0)
    m.update(changes)
    return m


SPREAD = [   # the parts small and in different places: every face pixel is bare in most of them
    dict(eyeScale=0, browScale=0, noseScale=0, mouthScale=0, eyeY=0, browY=3, noseY=0, mouthY=0, eyeX=0, browX=0),
    dict(eyeScale=0, browScale=0, noseScale=0, mouthScale=0, eyeY=18, browY=18, noseY=18, mouthY=18, eyeX=12, browX=12),
    dict(eyeScale=0, browScale=0, noseScale=0, mouthScale=0, eyeY=9, browY=8, noseY=6, mouthY=6, eyeX=6, browX=0),
    dict(eyeScale=0, browScale=0, noseScale=0, mouthScale=0, eyeY=4, browY=14, noseY=12, mouthY=12, eyeX=3, browX=8),
    dict(eyeScale=0, browScale=0, noseScale=0, mouthScale=0, eyeY=14, browY=5, noseY=3, mouthY=16, eyeX=9, browX=4),
]


@functools.lru_cache(None)
def background(face_type, skin):
    """the face without its parts (float RGB), from renders with the parts small and spread"""
    ims = render_all([parts_base(faceType=face_type, skin=skin, **c) for c in SPREAD])
    return np.median(np.stack([f32(i[..., :3]) for i in ims]), axis=0)


@functools.lru_cache(None)
def head_alpha(face_type):
    ims = render_all([parts_base(faceType=face_type, skin=0, **c) for c in SPREAD])
    return np.median(np.stack([f32(i[..., 3]) / 255.0 for i in ims]), axis=0)


def layer(**changes):
    """(premultiplied colour, alpha) of the face textures of parts_base(**changes)"""
    a, b = render_all([parts_base(skin=0, **changes), parts_base(skin=5, **changes)])
    g0, g5 = background(0, 0), background(0, 5)
    gd = g0 - g5
    d = f32(a[..., :3]) - f32(b[..., :3])
    denom = (gd * gd).sum(-1)
    alpha = 1.0 - np.where(denom > 400, (d * gd).sum(-1) / np.maximum(denom, 1e-6), 1.0)
    alpha = np.clip(alpha, 0, 1) * (a[..., 3] / 255.0)
    premult = np.clip(f32(a[..., :3]) - (1 - alpha)[..., None] * g0, 0, 255)
    # beyond the head (glasses' rims): the render's own transparency
    out = head_alpha(0) < 0.5
    alpha = np.where(out, a[..., 3] / 255.0, alpha)
    premult = np.where(out[..., None], f32(a[..., :3]) * alpha[..., None], premult)
    return premult.astype(np.float32), alpha.astype(np.float32)


# Each part on its own: the other parts small and out of its way, and the part's own layer minus
# the same render with the part moved far (everything else cancels).
PARTS = {
    #          Y param, X param, scale, rotate, others out of the way
    'eye':      ('eyeY', 'eyeX', 'eyeScale', 'eyeRotate', dict(browY=3, browScale=0, browX=12, noseY=18, noseScale=0, mouthY=18, mouthScale=0)),
    'brow':     ('browY', 'browX', 'browScale', 'browRotate', dict(eyeY=18, eyeScale=0, eyeX=12, noseY=18, noseScale=0, mouthY=18, mouthScale=0)),
    'nose':     ('noseY', None, 'noseScale', None, dict(eyeY=0, eyeScale=0, eyeX=12, browY=3, browScale=0, browX=12, mouthY=18, mouthScale=0)),
    'mouth':    ('mouthY', None, 'mouthScale', None, dict(eyeY=0, eyeScale=0, eyeX=12, browY=3, browScale=0, browX=12, noseY=0, noseScale=0)),
    'glasses':  ('glassesY', None, 'glassesScale', None, dict(glassesType=1, eyeScale=0, browScale=0, noseScale=0, mouthScale=0, noseY=18, mouthY=18)),
    'mustache': ('mustacheY', None, 'mustacheScale', None, dict(mustacheType=1, eyeY=0, eyeScale=0, browY=3, browScale=0, noseY=0, noseScale=0, mouthY=18, mouthScale=0)),
    'mole':     ('moleY', 'moleX', 'moleScale', None, dict(moleOn=1, eyeScale=0, browScale=0, noseScale=0, mouthScale=0)),
}
PAIRED = {'eye', 'brow'}


def far(part, y):
    lo = MINIMUM_Y.get(part, 0)
    hi = studio.RANGES[PARTS[part][0]]
    return hi if y - lo < (hi - lo) / 2 else lo


MINIMUM_Y = {'brow': 3}
OFF = {'glasses': dict(glassesType=0), 'mustache': dict(mustacheType=0), 'mole': dict(moleOn=0)}


def part_layer(part, **changes):
    """(premultiplied colour, alpha) of just this part, as parts_base + its isolation + changes"""
    yname, *_, others = PARTS[part]
    m = dict(others)
    m.update(changes)
    y = m.get(yname, studio.DEFAULT[yname])
    pm, a = layer(**m)
    if part in OFF:   # parts that can be left out: the same render without it
        m.update(OFF[part])
    else:
        m[yname] = far(part, y)
    pm2, a2 = layer(**m)
    keep = np.clip(a - a2, 0, 1)
    w = np.where(a > 1e-3, keep / np.maximum(a, 1e-3), 0)
    return (pm * w[..., None]).astype(np.float32), keep.astype(np.float32)


def moments(alpha, side=None):
    """centroid (x, y), sizes and angle of a part's alpha (side: 'l' or 'r' half for a pair)"""
    a = alpha.copy()
    if side == 'l':
        a[:, 256:] = 0
    elif side == 'r':
        a[:, :256] = 0
    total = a.sum()
    if total < 1:
        return None
    ys, xs = np.mgrid[0:512, 0:512]
    cx, cy = (a * xs).sum() / total, (a * ys).sum() / total
    cxx = (a * (xs - cx) ** 2).sum() / total
    cyy = (a * (ys - cy) ** 2).sum() / total
    cxy = (a * (xs - cx) * (ys - cy)).sum() / total
    angle = 0.5 * np.arctan2(2 * cxy, cxx - cyy)
    return dict(x=float(cx), y=float(cy), area=float(total), size=float((cxx * cyy - cxy * cxy) ** 0.25), angle=float(angle))
