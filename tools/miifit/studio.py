"""Wii Mii parameters, their Mii Studio rendering (cached on disk) and their RFLCharData encoding.

A Wii Mii is kept as a dict of the Wii's fields (RFLCharData names, Wii ranges). Mii Studio renders
it with the same 3D models and textures Toad's Factory's pictures were made with: its part numbers
for the Wii's parts are the Wii's own, its colours are the Switch's common colours.
"""
import hashlib
import io
import os
import threading
import time
import urllib.request

import numpy as np
from PIL import Image

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache', 'renders')

# The Wii Mii Channel's default male Mii.
DEFAULT = dict(
    gender=0, favColor=4, height=64, weight=64,
    faceType=0, skin=0, facialFeature=0,
    hairType=33, hairColor=1, hairFlip=0,
    browType=6, browRotate=6, browColor=1, browScale=4, browY=10, browX=2,
    eyeType=2, eyeRotate=4, eyeY=12, eyeColor=0, eyeScale=4, eyeX=2,
    noseType=1, noseScale=4, noseY=9,
    mouthType=23, mouthColor=0, mouthScale=4, mouthY=13,
    glassesType=0, glassesColor=0, glassesScale=4, glassesY=10,
    mustacheType=0, beardType=0, beardColor=0, mustacheScale=4, mustacheY=10,
    moleOn=0, moleScale=4, moleY=20, moleX=2,
)

# Wii ranges (inclusive).
RANGES = dict(
    favColor=11, height=127, weight=127, faceType=7, skin=5, facialFeature=11, hairType=71, hairColor=7, hairFlip=1,
    browType=23, browRotate=11, browColor=7, browScale=8, browY=18, browX=12,
    eyeType=47, eyeRotate=7, eyeY=18, eyeColor=5, eyeScale=7, eyeX=12,
    noseType=11, noseScale=8, noseY=18,
    mouthType=23, mouthColor=2, mouthScale=8, mouthY=18,
    glassesType=8, glassesColor=5, glassesScale=7, glassesY=20,
    mustacheType=3, beardType=3, beardColor=7, mustacheScale=8, mustacheY=16,
    moleOn=1, moleScale=8, moleY=30, moleX=16,
)
MINIMUM = dict(browY=3)

HAIR_COMMON = [8, 1, 2, 3, 4, 5, 6, 7]
EYE_COMMON = [8, 9, 10, 11, 12, 13]
MOUTH_COMMON = [19, 20, 21]
GLASSES_COMMON = [8, 14, 15, 16, 17, 18]
# The Wii's facial features as the 3DS / Switch makeup and wrinkles (FFL's conversion).
FEATURE_MAKEUP_WRINKLES = [(0, 0), (1, 0), (6, 0), (9, 0), (0, 5), (0, 2), (0, 3), (0, 7), (0, 8), (10, 0), (0, 9), (0, 11)]


def studio_data(m):
    makeup, wrinkles = FEATURE_MAKEUP_WRINKLES[m['facialFeature']]
    d = [
        HAIR_COMMON[m['beardColor']], m['beardType'], m.get('weight', 64), 3, EYE_COMMON[m['eyeColor']], m['eyeRotate'], m['eyeScale'],
        m['eyeType'], m['eyeX'], m['eyeY'], 3, HAIR_COMMON[m['browColor']], m['browRotate'], m['browScale'],
        m['browType'], m['browX'], m['browY'], m['skin'], makeup, m['faceType'], wrinkles, m['favColor'], m['gender'],
        GLASSES_COMMON[m['glassesColor']], m['glassesScale'], m['glassesType'], m['glassesY'], HAIR_COMMON[m['hairColor']],
        m['hairFlip'], m['hairType'], m.get('height', 64), m['moleScale'], m['moleOn'], m['moleX'], m['moleY'], 3,
        MOUTH_COMMON[m['mouthColor']], m['mouthScale'], m['mouthType'], m['mouthY'], m['mustacheScale'],
        m['mustacheType'], m['mustacheY'], m['noseScale'], m['noseType'], m['noseY'],
    ]
    return bytes(d)


def studio_hex(m):
    n = 0
    out = [n]
    for b in studio_data(m):
        n = (7 + (b ^ n)) & 0xFF
        out.append(n)
    return bytes(out).hex()


_lock = threading.Lock()
_last = [0.0]
MIN_INTERVAL = 0.05   # at most ~20 requests a second (per process)


def render(m, width=512, kind='face'):
    """The Mii's picture as Toad's Factory has them (transparent background), RGBA uint8 array."""
    code = studio_hex(m)
    key = hashlib.sha1(f'{code}-{width}-{kind}-rgba'.encode()).hexdigest()
    path = os.path.join(CACHE, key[:2], key + '.png')
    if os.path.exists(path):
        try:
            return np.asarray(Image.open(path).convert('RGBA'))
        except Exception:   # cut short (another process writing it): fetched again
            pass
    url = f'https://studio.mii.nintendo.com/miis/image.png?data={code}&type={kind}&width={width}'
    for attempt in range(6):
        with _lock:
            wait = _last[0] + MIN_INTERVAL - time.time()
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (miifit)'})
            data = urllib.request.urlopen(req, timeout=30).read()
            img = Image.open(io.BytesIO(data)).convert('RGBA')
            break
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    else:
        raise RuntimeError('render failed: ' + url)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    part = f'{path}.{os.getpid()}.{threading.get_ident()}.tmp'
    img.save(part, format='PNG')
    os.replace(part, path)   # whole, for the processes reading it
    return np.asarray(img)


def char_data(m, mii_id, system_id=0x4D4B4C42):
    """RFLCharData (0x4A bytes, big-endian), name and creator left empty."""
    b = bytearray(0x4A)

    def p16(at, v):
        b[at:at + 2] = int(v).to_bytes(2, 'big')

    def p32(at, v):
        b[at:at + 4] = int(v).to_bytes(4, 'big')

    p16(0x00, (m['gender'] << 14) | (1 << 10) | (1 << 5) | (m['favColor'] << 1))
    b[0x16] = m.get('height', 64)
    b[0x17] = m.get('weight', 64)
    p32(0x18, 0x80000000 | (mii_id & 0x1FFFFFFF))
    p32(0x1C, system_id)
    p16(0x20, (m['faceType'] << 13) | (m['skin'] << 10) | (m['facialFeature'] << 6))
    p16(0x22, (m['hairType'] << 9) | (m['hairColor'] << 6) | (m['hairFlip'] << 5))
    p32(0x24, (m['browType'] << 27) | (m['browRotate'] << 22) | (m['browColor'] << 13) | (m['browScale'] << 9)
        | (m['browY'] << 4) | m['browX'])
    p32(0x28, (m['eyeType'] << 26) | (m['eyeRotate'] << 21) | (m['eyeY'] << 16) | (m['eyeColor'] << 13)
        | (m['eyeScale'] << 9) | (m['eyeX'] << 5))
    p16(0x2C, (m['noseType'] << 12) | (m['noseScale'] << 8) | (m['noseY'] << 3))
    p16(0x2E, (m['mouthType'] << 11) | (m['mouthColor'] << 9) | (m['mouthScale'] << 5) | m['mouthY'])
    p16(0x30, (m['glassesType'] << 12) | (m['glassesColor'] << 9) | (m['glassesScale'] << 5) | m['glassesY'])
    p16(0x32, (m['mustacheType'] << 14) | (m['beardType'] << 12) | (m['beardColor'] << 9) | (m['mustacheScale'] << 5)
        | m['mustacheY'])
    p16(0x34, (m['moleOn'] << 15) | (m['moleScale'] << 11) | (m['moleY'] << 6) | (m['moleX'] << 1))
    return bytes(b)


def load_target(path):
    """A Toad's Factory picture as 512x512 RGBA."""
    img = Image.open(path).convert('RGBA')
    if img.size != (512, 512):
        img = img.resize((512, 512), Image.LANCZOS)
    return np.asarray(img)


def from_char_data(b):
    """A Wii Mii's fields from its RFLCharData (the inverse of char_data)."""
    def u16(at):
        return int.from_bytes(b[at:at + 2], 'big')

    def u32(at):
        return int.from_bytes(b[at:at + 4], 'big')

    v, f, h = u16(0x00), u16(0x20), u16(0x22)
    br, ey = u32(0x24), u32(0x28)
    no, mo, gl, mu, ml = u16(0x2C), u16(0x2E), u16(0x30), u16(0x32), u16(0x34)
    m = dict(
        gender=(v >> 14) & 1, favColor=(v >> 1) & 15, height=b[0x16], weight=b[0x17],
        faceType=f >> 13, skin=(f >> 10) & 7, facialFeature=(f >> 6) & 15,
        hairType=h >> 9, hairColor=(h >> 6) & 7, hairFlip=(h >> 5) & 1,
        browType=br >> 27, browRotate=(br >> 22) & 31, browColor=(br >> 13) & 7, browScale=(br >> 9) & 15,
        browY=(br >> 4) & 31, browX=br & 15,
        eyeType=ey >> 26, eyeRotate=(ey >> 21) & 31, eyeY=(ey >> 16) & 31, eyeColor=(ey >> 13) & 7,
        eyeScale=(ey >> 9) & 15, eyeX=(ey >> 5) & 15,
        noseType=no >> 12, noseScale=(no >> 8) & 15, noseY=(no >> 3) & 31,
        mouthType=mo >> 11, mouthColor=(mo >> 9) & 3, mouthScale=(mo >> 5) & 15, mouthY=mo & 31,
        glassesType=gl >> 12, glassesColor=(gl >> 9) & 7, glassesScale=(gl >> 5) & 15, glassesY=gl & 31,
        mustacheType=mu >> 14, beardType=(mu >> 12) & 3, beardColor=(mu >> 9) & 7, mustacheScale=(mu >> 5) & 15,
        mustacheY=mu & 31,
        moleOn=ml >> 15, moleScale=(ml >> 11) & 15, moleY=(ml >> 6) & 31, moleX=(ml >> 1) & 31,
    )
    if any(m[k] > r for k, r in RANGES.items()):
        raise ValueError('not a Wii Mii')
    return m
