"""The fit checked with real Mii Studio renders: the part model (parts.py) is close but not exact
(face shapes, eye types and rotations come out wrong), so its best candidates are rendered and
compared with the picture, each part type with its own placement (a type compared at another type's
placement loses to it), then every placement is moved a step or two at a time while the real render
gets closer."""
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import library as L
import overlap
import studio

TYPES = ThreadPoolExecutor(8)   # candidate types placed side by side (their renders go to L.POOL)


def flat(rgba):
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    return rgba[..., :3].astype(np.float32) * a + 255.0 * (1 - a)


def clear(m):
    """the brows not hidden in the eyes (overlap.py): Mii Studio draws eyes over brows, so brows
    hidden in the eyes look right in its pictures, but the game draws them on top"""
    return overlap.clear(m)


HIDDEN = 1000.0   # what a model with brows in its eyes costs: never chosen


class Real:
    def __init__(self, target):
        self.t = flat(target)
        self.n = float((target[..., 3] > 127).sum())
        self.cache = {}

    def errors(self, models):
        todo = list({studio.studio_hex(m): m for m in models if studio.studio_hex(m) not in self.cache}.values())
        for m, r in zip(todo, L.render_all(todo)):
            self.cache[studio.studio_hex(m)] = float(np.abs(flat(r) - self.t).sum()) / self.n
        return [self.cache[studio.studio_hex(m)] + (0 if clear(m) else HIDDEN) for m in models]


def best_of(real, m, candidates):
    """m becomes the best of candidates (dicts of changes) if it beats m as it is"""
    models = [m] + [dict(m, **c) for c in candidates]
    es = real.errors(models)
    i = int(np.argmin(es))
    m.update(models[i])
    return i > 0


def values(name, lo=None, hi=None):
    lo = max(studio.MINIMUM.get(name, 0), lo if lo is not None else -99)
    hi = min(studio.RANGES[name], hi if hi is not None else 99)
    return range(lo, hi + 1)


def whole(name):
    return [{name: v} for v in values(name)]


GEOMETRY = {
    'eye': ['eyeRotate', 'eyeY', 'eyeScale', 'eyeX'],
    'brow': ['browRotate', 'browY', 'browScale', 'browX'],
    'mouth': ['mouthY', 'mouthScale'],
    'nose': ['noseY', 'noseScale'],
    'glasses': ['glassesY', 'glassesScale'],
    'mustache': ['mustacheY', 'mustacheScale'],
    'mole': ['moleY', 'moleX', 'moleScale'],
}
TYPE = {'eye': 'eyeType', 'brow': 'browType', 'mouth': 'mouthType', 'nose': 'noseType'}
SHOWN = {'glasses': ('glassesType', 0), 'mustache': ('mustacheType', 0), 'mole': ('moleOn', 0)}


def step(real, m, name, reach=1):
    """moves one setting while the render gets closer: reach steps either way, then further"""
    changed = False
    v = m[name]
    while True:
        cands = [{name: x} for x in values(name, v - reach, v + reach) if x != v]
        if not best_of(real, m, cands):
            return changed
        changed = True
        if abs(m[name] - v) < reach:
            return changed
        v = m[name]


def settle(real, m, part, passes=1, reach=1):
    for _ in range(passes):
        if not any([step(real, m, name, reach) for name in GEOMETRY[part]]):
            break
    return m


def pairs(real, m, part, rounds=4):
    """two of the part's settings moved together (a bigger eye further in: neither step pays alone)"""
    names = GEOMETRY[part]
    for _ in range(rounds):
        cands = []
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                for da in (-1, 0, 1):
                    for db in (-1, 0, 1):
                        va, vb = m[a] + da, m[b] + db
                        if (da or db) and va in values(a) and vb in values(b):
                            cands.append({a: va, b: vb})
        if not best_of(real, m, cands):
            break
    return m


OPTIONAL_MARGIN = 0.3   # what an optional part (mole, moustache, glasses) must gain to stay


def model_types(ranks, part, n):
    out = []
    for _, c in ranks.get(part, []):
        if TYPE[part] in c and c[TYPE[part]] not in out:
            out.append(c[TYPE[part]])
    return out[:n]


def part_type(real, m, part, ranks, n_real=3, n_model=2):
    """the part's type: the best few by a real render where it is now and by the model, each
    placed on its own, the closest kept"""
    name = TYPE[part]
    starts = [{}]
    # from where Miis have it too: a part that went under another (eyes under sunglasses' frame)
    # never finds its way back one step at a time
    default = {g: studio.DEFAULT[g] for g in GEOMETRY[part]}
    if any(m[g] != v for g, v in default.items()):
        starts.append(default)
    trials = []
    for start in starts:
        cands = [dict(start, **{name: v}) for v in values(name)]
        es = real.errors([dict(m, **c) for c in cands])
        trials += [cands[i] for i in np.argsort(es)[:n_real]]
    for t in model_types(ranks, part, n_model):
        if not any(c == {name: t} for c in trials):
            trials.append({name: t})
    trials = list(TYPES.map(lambda c: settle(real, dict(m, **c), part), trials))
    best_of(real, m, [{k: tr[k] for k in [name] + GEOMETRY[part]} for tr in trials])


def body(real, m):
    """height and weight: the shoulders under the head (a grid, then finer steps)"""
    best_of(real, m, [{'height': h, 'weight': w} for h in range(0, 128, 16) for w in range(0, 128, 16)]
            + [{'height': h, 'weight': 127} for h in range(0, 128, 16)] + [{'height': 127, 'weight': 127}])
    for r in (8, 4, 2, 1):
        while best_of(real, m, [{'height': m['height'] + dh * r, 'weight': m['weight'] + dw * r}
                                for dh in (-1, 0, 1) for dw in (-1, 0, 1) if (dh or dw)
                                and 0 <= m['height'] + dh * r <= 127 and 0 <= m['weight'] + dw * r <= 127]):
            pass


GRID = {   # where a part is looked for all over (eyes under sunglasses, brows as strands of hair)
    'eye': {'eyeY': range(0, 19, 3), 'eyeX': range(0, 13, 3), 'eyeScale': (1, 4, 7)},
    'brow': {'browY': (3, 7, 11, 15, 18), 'browX': (0, 4, 8, 12), 'browRotate': (0, 4, 8, 11), 'browScale': (1, 4, 8)},
    'mouth': {'mouthY': range(0, 19, 3), 'mouthScale': (1, 4, 7)},
}
# the grid also with these looks, and with every type these colours (the hair's, black)
GRID_TYPES = {'brow': ((7, 'hair'), (6, 'dark'))}   # (type, colour) beside the part's own: a long lock
# in the hair's colour, the plain brow in black (behind glasses)
COLOUR = {'eye': None, 'brow': 'browColor', 'mouth': 'mouthColor'}
# brows behind glasses show only in a narrow band over the frame: finer there, plain dark brows
GLASSES_GRID = {'brow': {'browY': (3, 5, 7, 9, 11, 13), 'browX': (0, 2, 4, 6), 'browRotate': (2, 4, 6, 8), 'browScale': (3, 5, 7)}}
GLASSES_TYPES = {'brow': ((0, 'dark'), (6, 'dark'))}


def wide(real, m, part, places=3, keep=10, looks=True):
    """the part's type and placement looked for all over: a grid of placements at its type, the
    best few placements with every type, the best few of those settled (each on its own)"""
    name = TYPE[part]
    colour = COLOUR[part]
    grids = [(GRID[part], list(GRID_TYPES.get(part, ())) if looks else [])]
    if looks and m['glassesType'] and part in GLASSES_GRID:
        grids.append((GLASSES_GRID[part], list(GLASSES_TYPES[part])))
    names = list(GRID[part])
    base = real.errors([m])[0]
    shows = lambda e: abs(e - base) > 1e-4   # placements where the part is hidden change nothing: left
    starts = []                              # out, or they crowd out the ones where it shows a little
    for grid, kinds in grids:
        cands = [{}]
        for n in names:
            cands = [dict(c, **{n: v}) for c in cands for v in grid[n]]
        cands.append({n: m[n] for n in names})
        for look in [{}] + [{name: t, colour: m['hairColor'] if c == 'hair' else 0} for t, c in kinds]:
            # each look's best few (a faint brow behind glasses gains little, but some)
            group = [dict(c, **look) for c in cands]
            es = real.errors([dict(m, **c) for c in group])
            for i in [i for i in np.argsort(es) if shows(es[i])][:places]:
                if {n: group[i][n] for n in names} not in starts:
                    starts.append({n: group[i][n] for n in names})
    if {n: m[n] for n in names} not in starts:
        starts.append({n: m[n] for n in names})
    colours = [{}]
    if colour:
        others = set(values(colour)) if part == 'mouth' else {m['hairColor'], 0}
        colours += [{colour: c} for c in sorted(others - {m[colour]})]
    trials = [dict(st, **{name: t}, **c) for st in starts for t in values(name) for c in colours]
    es = real.errors([dict(m, **c) for c in trials])
    # each look's best start only (one type at its many starts crowded out the right one: bawp's
    # sleepy eyes behind dark lenses, 43, lost to 17 placed six ways)
    seen, best = set(), []
    for i in np.argsort(es):
        look = (trials[i][name], trials[i].get(colour) if colour else None)
        if shows(es[i]) and look not in seen:
            seen.add(look)
            best.append(trials[i])
    trials = best[:keep]
    trials = list(TYPES.map(lambda c: pairs(real, settle(real, dict(m, **c), part, 2), part), trials))
    best_of(real, m, [{k: tr[k] for k in [name] + GEOMETRY[part] + ([colour] if colour else [])} for tr in trials])


def every_type(real, m, part, keep=5):
    """every type moved into place from where the part is now, the best few settled: behind dark
    lenses a type only wins once placed (bawp's 43 at 0.05, never in wide()'s shortlist)"""
    name = TYPE[part]
    trials = [dict(m, **{name: v}) for v in values(name) if v != m[name]]
    trials = list(TYPES.map(lambda t: settle(real, t, part), trials))
    es = real.errors(trials)
    trials = [trials[i] for i in np.argsort(es)[:keep]]
    trials = list(TYPES.map(lambda t: pairs(real, settle(real, t, part, 3, 2), part), trials))
    best_of(real, m, [{k: tr[k] for k in [name] + GEOMETRY[part]} for tr in trials])


def optional(real, m, part, keep=3):
    """glasses or a moustache: every type with every colour, and none; the best few settled"""
    tname, none = SHOWN[part]
    cname = {'glasses': 'glassesColor', 'mustache': 'beardColor'}[part]
    cands = [{tname: t, cname: c} for t in values(tname) if t != none for c in values(cname)]
    es = real.errors([dict(m, **c) for c in cands])
    trials = [dict(m, **cands[i]) for i in np.argsort(es)[:keep]]
    trials = list(TYPES.map(lambda t: pairs(real, settle(real, t, part, 2), part), trials))
    best_of(real, m, [{k: tr[k] for k in [tname, cname] + GEOMETRY[part]} for tr in trials] + [{tname: none}])


def refine(target, m, hairs, ranks, top=6):
    real = Real(target)
    body(real, m)
    best_of(real, m, whole('faceType'))
    hs = []
    for r in hairs:
        if (r[2], r[3]) not in hs:
            hs.append((r[2], r[3]))
    # every hair (both ways): the model's silhouettes miss strands (a fringe's side locks)
    best_of(real, m, [{'hairType': h, 'hairFlip': f} for h in values('hairType') for f in (0, 1)])
    best_of(real, m, [{'hairColor': c, 'browColor': c, 'beardColor': c} for c in values('hairColor')])
    best_of(real, m, whole('skin'))
    best_of(real, m, whole('faceType'))
    best_of(real, m, [{'hairType': h, 'hairFlip': f} for h in values('hairType') for f in (0, 1)])
    body(real, m)
    optional(real, m, 'glasses')
    wide(real, m, 'eye')
    best_of(real, m, whole('eyeColor'))
    best_of(real, m, whole('browColor'))
    wide(real, m, 'brow')
    best_of(real, m, whole('browColor'))
    wide(real, m, 'mouth')
    best_of(real, m, whole('noseType'))
    settle(real, m, 'nose', 2)
    optional(real, m, 'mustache')
    best_of(real, m, whole('facialFeature'))
    best_of(real, m, whole('beardType'))
    # once more with everything in (the glasses, brows and eyes found each other)
    optional(real, m, 'glasses')
    wide(real, m, 'eye')
    wide(real, m, 'brow', looks=False)
    wide(real, m, 'mouth')
    if m['glassesType']:
        every_type(real, m, 'eye')
    best_of(real, m, whole('eyeColor'))
    for part in GEOMETRY:
        name, none = SHOWN.get(part, (None, None))
        if name and m[name] == none:
            continue
        settle(real, m, part, 1, 2 if part in ('eye', 'brow') else 1)
        pairs(real, m, part)
    # every brow and nose type in place (wrong brows; small noses lost to type 0 at scale 0)
    every_type(real, m, 'brow')
    every_type(real, m, 'nose')
    best_of(real, m, [{'mouthType': t} for t in values('mouthType')])
    body(real, m)
    # a part the others stood in for (a mole on an eye) is taken off unless it clearly pays
    for name, none in SHOWN.values():
        if m[name] != none:
            on, off = real.errors([m, dict(m, **{name: none})])
            if off < on + OPTIONAL_MARGIN:
                m[name] = none
    return real.errors([m])[0]
