"""The league players' real Wii Miis, from Retro WFC (its player API has the Mii data, by friend code):
each of a player's friend codes on Toad's Factory is looked up, its Mii rendered by Mii Studio and
compared with the player's picture. A Mii that renders as the picture is the player's Mii exactly,
and is used instead of a fitted one: rwfc.json, by picture file. Lookups are kept in cache/rwfc."""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import studio

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache', 'rwfc')
OUT = os.path.join(HERE, 'rwfc.json')
SAME = 12.0   # mean colour difference under which a render is the picture (re-encoding, scaling)


def lookup(fc):
    path = os.path.join(CACHE, fc + '.json')
    if os.path.exists(path):
        return json.load(open(path, encoding='utf-8'))
    url = 'https://rwfc.net/api/leaderboard/player/' + fc
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (miifit)'})
            d = json.loads(urllib.request.urlopen(req, timeout=30).read())
            d = {'miiData': d.get('miiData')}
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                d = {'miiData': None}
                break
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    else:
        return None
    os.makedirs(CACHE, exist_ok=True)
    json.dump(d, open(path, 'w', encoding='utf-8'))
    time.sleep(0.3)
    return d


def difference(t, r):
    a = (t[..., 3] > 127) | (r[..., 3] > 127)
    return float(np.abs(t[..., :3].astype(np.float32) - r[..., :3]).sum(-1)[a].mean())


def player(p):
    prof = json.load(open(os.path.join(HERE, 'cache', 'players', f"{p['id']}.json"), encoding='utf-8'))
    path = os.path.join(HERE, 'cache', 'pictures', p['mii'])
    try:
        t = studio.load_target(path)
    except Exception:
        return p['mii'], None
    best = None
    for c in prof.get('fcs') or []:
        d = lookup(c['fc'])
        if not d or not d['miiData']:
            continue
        data = base64.b64decode(d['miiData'])
        try:
            m = studio.from_char_data(data)
        except ValueError:
            continue
        err = difference(t, studio.render(m))
        if best is None or err < best['error']:
            best = {'fc': c['fc'], 'data': data.hex(), 'error': round(err, 1)}
    return p['mii'], best


def main():
    players = json.load(open(os.path.join(HERE, 'league_players.json'), encoding='utf-8'))
    out = {}
    with ThreadPoolExecutor(int(sys.argv[1]) if len(sys.argv) > 1 else 3) as ex:
        for n, (file, best) in enumerate(ex.map(player, players), 1):
            if best:
                out[file] = best
            if n % 100 == 0:
                print(n, len(out), sum(b['error'] < SAME for b in out.values()), flush=True)
    json.dump(out, open(OUT, 'w'), indent=0)
    print(len(out), 'with a Retro WFC Mii,', sum(b['error'] < SAME for b in out.values()), 'the same as the picture')


if __name__ == '__main__':
    main()
