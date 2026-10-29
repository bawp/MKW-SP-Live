"""Facial parts: each part's layer (library.part_layer) moved, scaled and turned as its settings do
(calibration.json), composited on the fitted face, and searched for the settings that match."""
import functools
import json
import os

import cv2
import numpy as np

import library as L
import studio

HERE = os.path.dirname(os.path.abspath(__file__))
CAL = json.load(open(os.path.join(HERE, 'calibration.json')))

#           type param, types, colour param, colour reference (type search), Y, X, scale, rotate
SPEC = {
    'eye':      ('eyeType', range(48), 'eyeColor', 0, 'eyeY', 'eyeX', 'eyeScale', 'eyeRotate'),
    'brow':     ('browType', range(24), 'browColor', None, 'browY', 'browX', 'browScale', 'browRotate'),
    'nose':     ('noseType', range(12), None, None, 'noseY', None, 'noseScale', None),
    'mouth':    ('mouthType', range(24), 'mouthColor', 0, 'mouthY', None, 'mouthScale', None),
    'glasses':  ('glassesType', range(1, 9), 'glassesColor', 0, 'glassesY', None, 'glassesScale', None),
    'mustache': ('mustacheType', range(1, 4), 'beardColor', None, 'mustacheY', None, 'mustacheScale', None),
    'mole':     ('moleOn', range(1, 2), None, None, 'moleY', 'moleX', 'moleScale', None),
}
NONE = {'glasses': 0, 'mustache': 0, 'mole': 0}   # the "left out" value of optional parts
ORDER = ['nose', 'mouth', 'mustache', 'mole', 'eye', 'brow', 'glasses']   # compositing order (glasses on top)


def table(part, name):
    lo = studio.MINIMUM.get(name, 0)
    return {lo + i: m for i, m in enumerate(CAL[part][name]) if m is not None}


@functools.lru_cache(None)
def pivots(part):
    """the points the probe's scale and rotation turn about (left instance)"""
    _, _, _, _, yname, xname, sname, rname = SPEC[part]
    d = studio.DEFAULT
    out = {}
    st = table(part, sname)
    c0 = np.array([st[d[sname]]['x'], st[d[sname]]['y']])
    qs = []
    for s, m in st.items():
        k = m['size'] / st[d[sname]]['size']
        if abs(1 - k) > 0.05:
            qs.append((np.array([m['x'], m['y']]) - k * c0) / (1 - k))
    out['scale'] = np.median(qs, axis=0) if qs else c0
    if rname:
        rt = table(part, rname)
        c0 = np.array([rt[d[rname]]['x'], rt[d[rname]]['y']])
        ps = []
        for r, m in rt.items():
            th = m['angle'] - rt[d[rname]]['angle']
            if abs(th) > 0.1:
                R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
                ps.append(np.linalg.solve(np.eye(2) - R, np.array([m['x'], m['y']]) - R @ c0))
        out['rotate'] = np.median(ps, axis=0) if ps else c0
    return out


def transform(part, m, side):
    """2x3 affine from the part's default placement to m's (side 'l' / 'r' / None)"""
    _, _, _, _, yname, xname, sname, rname = SPEC[part]
    d = studio.DEFAULT
    pv = pivots(part)
    k = table(part, sname)[m[sname]]['size'] / table(part, sname)[d[sname]]['size']
    th = 0.0
    if rname:
        rt = table(part, rname)
        th = rt[m[rname]]['angle'] - rt[d[rname]]['angle']
    yt = table(part, yname)
    dx, dy = 0.0, yt[m[yname]]['y'] - yt[d[yname]]['y']
    if xname:
        xt = table(part, xname)
        dx = xt[m[xname]]['x'] - xt[d[xname]]['x']
        dy += xt[m[xname]]['y'] - xt[d[xname]]['y']
    q, p = pv['scale'].copy(), pv.get('rotate', pv['scale']).copy()
    if side == 'r':   # the mirror image
        q[0], p[0] = 512 - q[0], 512 - p[0]
        th, dx = -th, -dx
    R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
    # x -> R (q + k (x - q) - p) + p + (dx, dy)
    A = R * k
    t = R @ (q - k * q - p) + p + np.array([dx, dy])
    return np.hstack([A, t[:, None]]).astype(np.float32)


@functools.lru_cache(None)
def type_layer(part, t, colour):
    """the part's layer at its default placement, as crops: [(side, x0, y0, premult, alpha)]"""
    tname, _, cname, *_ = SPEC[part]
    changes = {tname: t}
    if cname is not None and colour is not None:
        changes[cname] = colour
    pm, a = L.part_layer(part, **changes)
    sides = ('l', 'r') if part in L.PAIRED else (None,)
    out = []
    for side in sides:
        aa = a.copy()
        if side == 'l':
            aa[:, 256:] = 0
        elif side == 'r':
            aa[:, :256] = 0
        ys, xs = np.where(aa > 0.01)
        if len(ys) == 0:
            continue
        y0, y1, x0, x1 = max(ys.min() - 3, 0), min(ys.max() + 4, 512), max(xs.min() - 3, 0), min(xs.max() + 4, 512)
        out.append((side, x0, y0, np.ascontiguousarray(pm[y0:y1, x0:x1] * (aa[y0:y1, x0:x1] > 0)[..., None]),
                    np.ascontiguousarray(aa[y0:y1, x0:x1])))
    return out


def place(part, m, colour):
    """the part as m sets it: [(x0, y0, premult, alpha)] crops of the 512x512 picture"""
    tname = SPEC[part][0]
    out = []
    for side, x0, y0, pm, a in type_layer(part, m[tname], colour):
        M = transform(part, m, side)
        h, w = a.shape
        corners = np.array([[x0, y0, 1], [x0 + w, y0, 1], [x0, y0 + h, 1], [x0 + w, y0 + h, 1]], np.float32) @ M.T
        bx0, by0 = np.floor(corners.min(0)).astype(int) - 1
        bx1, by1 = np.ceil(corners.max(0)).astype(int) + 1
        bx0, by0, bx1, by1 = max(bx0, 0), max(by0, 0), min(bx1, 512), min(by1, 512)
        if bx1 <= bx0 or by1 <= by0:
            continue
        # crop -> destination box: shift both frames
        Mc = M.copy()
        Mc[:, 2] += M[:, :2] @ np.array([x0, y0], np.float32) - np.array([bx0, by0], np.float32)
        size = (bx1 - bx0, by1 - by0)
        wa = cv2.warpAffine(a, Mc, size, flags=cv2.INTER_LINEAR, borderValue=0)
        wp = cv2.warpAffine(pm, Mc, size, flags=cv2.INTER_LINEAR, borderValue=0)
        out.append((bx0, by0, wp, wa))
    return out


def composite(canvas, crops):
    for x0, y0, pm, a in crops:
        h, w = a.shape
        c = canvas[y0:y0 + h, x0:x0 + w]
        c *= (1 - a)[..., None]
        c += pm


class Scene:
    """the fitted face (background) with every part placed; error against the target"""

    def __init__(self, target_rgb, weight, m):
        self.t = target_rgb
        self.w = weight
        self.m = m
        self.base = L.background(m['faceType'], m['skin']).copy()
        self.colours = {}
        self.ranks = {}

    def colour(self, part):
        cname = SPEC[part][2]
        return self.m[cname] if cname else None

    def present(self, part):
        return part not in NONE or self.m[SPEC[part][0]] != NONE[part]

    def canvas_without(self, part):
        c = self.base.copy()
        for p in ORDER:
            if p != part and self.present(p):
                composite(c, place(p, self.m, self.colour(p)))
        return c

    def error(self, canvas, box=None):
        if box is None:
            box = (0, 0, 512, 512)
        x0, y0, x1, y1 = box
        d = np.abs(canvas[y0:y1, x0:x1] - self.t[y0:y1, x0:x1]).sum(-1)
        return float((np.minimum(d, 255.0) * self.w[y0:y1, x0:x1]).sum())


WINDOWS = {   # where each part can be (x0, y0, x1, y1)
    'eye': (90, 150, 422, 340), 'brow': (90, 140, 422, 320), 'nose': (180, 220, 332, 410),
    'mouth': (140, 230, 372, 430), 'glasses': (40, 140, 472, 400), 'mustache': (140, 250, 372, 440),
    'mole': (130, 150, 382, 390),
}


class Probe:
    """errors of one part's placements against the rest of the scene: only the pixels the part
    covers change, against the error map of the scene without it"""

    def __init__(self, scene, part):
        self.scene, self.part = scene, part
        base = scene.canvas_without(part)
        self.base = base
        self.e0 = np.minimum(np.abs(base - scene.t).sum(-1), 255.0) * scene.w
        x0, y0, x1, y1 = WINDOWS[part]
        self.total = float(self.e0[y0:y1, x0:x1].sum())

    def error(self, m, colour):
        x0, y0, x1, y1 = WINDOWS[self.part]
        e = self.total
        t, w, base = self.scene.t, self.scene.w, self.base
        for cx, cy, pm, a in place(self.part, m, colour):
            h, wd = a.shape
            # the crop's part inside the window
            ax0, ay0 = max(cx, x0), max(cy, y0)
            ax1, ay1 = min(cx + wd, x1), min(cy + h, y1)
            if ax1 <= ax0 or ay1 <= ay0:
                continue
            sl = (slice(ay0, ay1), slice(ax0, ax1))
            cs = (slice(ay0 - cy, ay1 - cy), slice(ax0 - cx, ax1 - cx))
            comp = base[sl] * (1 - a[cs])[..., None] + pm[cs]
            new = np.minimum(np.abs(comp - t[sl]).sum(-1), 255.0) * w[sl]
            e += float(new.sum() - self.e0[sl].sum())
        return e


PLACEMENT = {n for spec in SPEC.values() for n in spec[4:] if n}


def rng(name):
    return range(studio.MINIMUM.get(name, 0), studio.RANGES[name] + 1)


def placements(part, name):
    """the values of a placement setting that keep the whole part on the face (calibrated: moved
    to the face's edge, the part is cut and the layers no longer show what the game draws)"""
    tb = table(part, name)
    values = sorted(tb)
    if name != SPEC[part][6]:   # not its scale: the size must stay as it is at the default
        ref = tb[studio.DEFAULT[name]]['size']
        values = [v for v in values if abs(tb[v]['size'] / ref - 1) < 0.05]
    if name == 'mustacheY':   # a moustache above the nose only ever stands in for something else
        values = [v for v in values if v >= 5]
    return values


PRIOR = 400.0   # the cost of each step a placement setting moves from the default (about 2 pixels'
               # worth of full error): when a part is hidden (sunglasses) it stays where Miis have it


def sweep(probe, m, name, values, colour_of):
    best = None
    prior = PRIOR if name in PLACEMENT else 0.0
    for v in values:
        old = m[name]
        m[name] = v
        e = probe.error(m, colour_of(m)) + prior * abs(v - studio.DEFAULT[name])
        m[name] = old
        if best is None or e < best[0]:
            best = (e, v)
    m[name] = best[1]
    return best[0]


def fit_part(scene, part):
    tname, types, cname, cref, yname, xname, sname, rname = SPEC[part]
    m = scene.m
    probe = Probe(scene, part)
    geometry = [n for n in (yname, xname, sname, rname) if n]
    own = lambda mm: mm[cname] if cname else None
    # eyes and mouth are compared with a reference colour (black irises, the first lip colour)
    # until their type is settled; glasses and moustaches try every colour with every type
    ref = (lambda mm: cref) if cref is not None and part not in NONE else own
    colours = list(rng(cname)) if part in NONE and cname else [None]
    best = None
    start = dict(m)
    names = [tname] + ([cname] if cname else []) + geometry
    ranked = []   # each type's (and colour's) best, for refine.py to check with real renders
    for t in types:
        for c in colours:
            trial = dict(start)
            trial[tname] = t
            if c is not None:
                trial[cname] = c
            e = None
            for n in geometry:
                e = sweep(probe, trial, n, placements(part, n), ref)
            ranked.append((e, {n: trial[n] for n in names}))
            if best is None or e < best[0]:
                best = (e, trial)
    if part in NONE:
        ranked.append((probe.total - 3000, {tname: NONE[part]}))
    scene.ranks[part] = sorted(ranked, key=lambda r: r[0])
    trial = best[1]
    for _ in range(2):
        for n in geometry:
            e = sweep(probe, trial, n, placements(part, n), ref)
    if cname and part not in NONE:
        e = sweep(probe, trial, cname, rng(cname), own)
        e = sweep(probe, trial, tname, types, own)
        for n in geometry:
            e = sweep(probe, trial, n, placements(part, n), own)
    if part in NONE and e > probe.total - 3000:   # not worth having
        m[tname] = NONE[part]
        return probe.total
    m.update(trial)
    return e


def fit_parts(target_rgb, weight, m, rounds=3):
    scene = Scene(target_rgb, weight, m)
    for _ in range(rounds):
        for part in ['eye', 'brow', 'nose', 'mouth', 'glasses', 'mustache', 'mole']:
            fit_part(scene, part)
    return scene
