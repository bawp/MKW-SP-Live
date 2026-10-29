"""Debug: fits the pictures given and writes a sheet of target / fit pairs."""
import sys

import numpy as np
from PIL import Image

import fit
import studio


def flat(rgba):
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    return (rgba[..., :3] * a + 255 * (1 - a)).astype(np.uint8)


def main(out, paths):
    cells = []
    for p in paths:
        t = studio.load_target(p)
        m = fit.fit(t)
        r = studio.render(m)
        print(p, {k: m[k] for k in ('faceType', 'skin', 'hairType', 'hairFlip', 'hairColor', 'favColor')}, flush=True)
        for a in (t, r):
            cells.append(np.asarray(Image.fromarray(flat(a)[64:480, 48:464]).resize((160, 160))))
    cols = 8
    rows = (len(cells) + cols - 1) // cols
    sheet = np.full((rows * 160, cols * 160, 3), 255, np.uint8)
    for i, c in enumerate(cells):
        y, x = divmod(i, cols)
        sheet[y * 160:(y + 1) * 160, x * 160:(x + 1) * 160] = c
    Image.fromarray(sheet).save(out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
