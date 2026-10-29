"""Fits every league player's Mii (league_players.json) and keeps the results in fits.json, by
picture file: pictures already fitted are skipped, so it can be stopped and run again."""
import json
import os
import sys
import time
import urllib.request

import refine
from concurrent.futures import ProcessPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
PICTURES = os.path.join(HERE, 'cache', 'pictures')
FITS = os.path.join(HERE, 'fits.json')
OLD = os.path.join(HERE, 'fits_old.json')


def picture(file):
    path = os.path.join(PICTURES, file)
    if not os.path.exists(path):
        os.makedirs(PICTURES, exist_ok=True)
        data = urllib.request.urlopen('http://toadsfactory.mkw.gg/resources/mii/' + file, timeout=30).read()
        open(path, 'wb').write(data)
    return path


def work(file, start=None):
    import numpy as np
    import fit
    import studio
    t = studio.load_target(picture(file))
    m = fit.fit(t, start=start)
    # how close it came: the mean colour difference over the Mii's pixels, rendered
    r = studio.render(m)
    a = (t[..., 3] > 127) | (r[..., 3] > 127)
    err = float(np.abs(t[..., :3].astype(np.float32) - r[..., :3]).sum(-1)[a].mean())
    return file, m, err


def main(workers=6):
    players = json.load(open(os.path.join(HERE, sys.argv[2] if len(sys.argv) > 2 else 'league_players.json'), encoding='utf-8'))
    fits = json.load(open(FITS)) if os.path.exists(FITS) else {}
    # again (fits_old.json: the fits from before, kept where they come out closer)
    old = json.load(open(OLD)) if os.path.exists(OLD) else {}
    files = sorted({p['mii'] for p in players} - set(fits))
    print(len(files), 'to fit,', len(fits), 'done', flush=True)
    started = time.time()
    with ProcessPoolExecutor(workers) as ex:
        futures = [ex.submit(work, f, old.get(f, {}).get('mii')) for f in files]
        for n, fut in enumerate(as_completed(futures), 1):
            try:
                file, m, err = fut.result()
            except Exception as e:
                print('failed:', e, flush=True)
                continue
            # the last fit was closer: kept (unless it hid brows in the eyes, which the game shows)
            if file in old and old[file]['error'] <= err and refine.clear(old[file]['mii']):
                fits[file] = old[file]
            else:
                fits[file] = {'mii': m, 'error': round(err, 1)}
            if n % 10 == 0 or n == len(files):
                json.dump(fits, open(FITS, 'w'), indent=0)
                print(f'{n}/{len(files)} {time.time() - started:.0f}s', flush=True)
    json.dump(fits, open(FITS, 'w'), indent=0)


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 6)
