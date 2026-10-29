"""Fits a Wii Mii to a Toad's Factory picture (a Mii Studio render): see README in this folder."""
import numpy as np

import library as L
import parts
import refine
import studio

S = 4   # the hair stage works at 128x128


def down(a, s=S):
    h, w = a.shape[:2]
    return a.reshape(h // s, s, w // s, s, *a.shape[2:]).mean((1, 3))


def nearest(colour, table):
    return int(np.argmin(np.linalg.norm(table - colour, axis=1)))


class Target:
    def __init__(self, rgba):
        self.rgba = rgba
        self.rgb = rgba[..., :3].astype(np.float32)
        self.alpha = rgba[..., 3].astype(np.float32) / 255.0
        self.small_rgb = down(self.rgb)
        self.small_alpha = down(self.alpha)


def fit_colours_body(t, m):
    body = L.body_mask() > 0
    m['favColor'] = nearest(np.median(t.rgb[body & (t.alpha > 0.9)], axis=0), L.shirt_colours())


def fit_hair(t, m, top=12):
    """face shape, hair style, flip, hair colour, skin"""
    cap = 80.0
    faces = [down(L.face(f)) for f in range(8)]
    body = down(L.body_mask()) > 0.5
    ta, tc = t.small_alpha, t.small_rgb
    results = []
    for h in range(72):
        for flip in (0, 1):
            if h == L.BALD and flip:
                continue
            hm = down(L.hair(h, flip)[0])
            hair_px = (hm > 0.5) & (ta > 0.5)
            hair_col = np.median(tc[hair_px], axis=0) if hair_px.sum() > 5 else None
            for f in range(8):
                pred = np.maximum(faces[f], hm)
                sil = np.abs(pred - ta).sum() * 255.0
                skin_px = (faces[f] > 0.9) & (hm < 0.1) & ~body & (ta > 0.5)
                skin_col = np.median(tc[skin_px], axis=0)
                err = np.minimum(np.linalg.norm(tc[skin_px] - skin_col, axis=1), cap).sum()
                if hair_col is not None:
                    err += np.minimum(np.linalg.norm(tc[hair_px] - hair_col, axis=1), cap).sum()
                results.append((sil + err, f, h, flip, hair_col, skin_col))
    results.sort(key=lambda r: r[0])
    best = results[0]
    m['faceType'], m['hairType'], m['hairFlip'] = best[1], best[2], best[3]
    if best[4] is not None:
        m['hairColor'] = nearest(best[4], L.hair_colours())
    m['browColor'] = m['hairColor']
    m['beardColor'] = m['hairColor']
    return results[:top]


def fit_skin(t, m):
    """the skin whose colour most of the bare face is close to"""
    hm = L.hair(m['hairType'], m['hairFlip'])[0]
    region = (L.face(m['faceType']) > 0.9) & (hm < 0.1) & ~(L.body_mask() > 0) & (t.alpha > 0.9)
    px = t.rgb[region]
    refs = L.skin_colours()
    counts = [(np.linalg.norm(px - c, axis=1) < 28).sum() for c in refs]
    m['skin'] = int(np.argmax(counts))


def fit(rgba, real=True, start=None):
    t = Target(rgba)
    m = dict(studio.DEFAULT)
    fit_colours_body(t, m)
    hairs = fit_hair(t, m)
    fit_skin(t, m)
    hm = L.hair(m['hairType'], m['hairFlip'])[0]
    weight = ((t.alpha > 0.5) & (hm < 0.3)).astype(np.float32)
    scene = parts.fit_parts(t.rgb, weight, m)
    if real:
        e = refine.refine(rgba, m, hairs, scene.ranks)
        if start:   # again from an earlier fit: the closer of the two
            s = dict(studio.DEFAULT, **start)
            if refine.refine(rgba, s, hairs, scene.ranks) < e:
                m = s
    return m
