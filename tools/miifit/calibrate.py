"""Measures where each part's position, scale and rotation settings put it (calibration.json)."""
import json

import library as L
import studio

PROBE = {'eye': dict(eyeType=2), 'brow': dict(browType=6), 'nose': dict(noseType=1), 'mouth': dict(mouthType=23),
         'glasses': {}, 'mustache': {}, 'mole': {}}


def main(only=()):
    try:
        out = json.load(open('calibration.json'))
    except OSError:
        out = {}
    for part, (yname, xname, sname, rname, _) in L.PARTS.items():
        if only and part not in only:
            continue
        side = 'l' if part in L.PAIRED else None
        table = {}
        for name in (yname, xname, sname, rname):
            if not name:
                continue
            lo = studio.MINIMUM.get(name, 0)
            values = []
            for v in range(lo, studio.RANGES[name] + 1):
                _, a = L.part_layer(part, **PROBE[part], **{name: v})
                values.append(L.moments(a, side))
            table[name] = values
            print(part, name, [None if m is None else (round(m['x']), round(m['y']), round(m['size'], 1), round(m['angle'], 2)) for m in values], flush=True)
        out[part] = table
    json.dump(out, open('calibration.json', 'w'), indent=1)


if __name__ == '__main__':
    import sys
    main(sys.argv[1:])
