# miifit: Wii Miis from Toad's Factory's Mii pictures

The Esports player pages stand the player's Mii on the globe (as the WFC Friend Roster does). Toad's
Factory only has a picture of each player's Mii, a Mii Studio render, so this fits a Wii Mii to
each picture. The results are compiled into the runtime as `runtime/src/esports_miis.inc` (in the
rankings patch), by picture file.

How it fits (all against Mii Studio's own renders, cached in `cache/renders`):

1. The shirt's colour (favourite colour), then the face shape, hairstyle (and its flip) and hair
   colour: every hair's pixels (rendered twice, in two hair colours) and every face's outline are
   matched to the picture's outline and its hair / skin regions. Then the skin colour.
2. The facial parts: each part's layer is cut from the skin (rendered on two skins), and moved,
   scaled and turned as its settings do (`calibration.json`, measured by `calibrate.py`), on the
   fitted bare face. Each part type gets its own placement search; glasses and moustaches are
   compared with leaving them out. Three passes, so parts fitted later (glasses) correct earlier
   ones (eyes).
3. The check with real renders (`refine.py`): the part model is close, not exact, so everything is
   settled again with Mii Studio's renders of the candidates against the picture: the height and
   weight (the shoulders), face shape, every hair (both ways), the colours; glasses and moustaches
   (every type and colour); the eyes, brows and mouth looked for all over a grid of placements
   (brows as locks of hair beside the face, brows behind glasses in the band over the frame; hidden
   placements left out), the best placements with every type, the best few of those settled one
   and two settings at a time (each type's best placement only, so one type can't crowd out the
   rest). Twice, as the parts find each other. Then every brow and nose type (and, behind glasses,
   eye type) moved into place from where the part is. A refit also starts from the last fit
   (`fits_old.json`) and keeps the closer.
   Brows may not lie over the eyes (`overlap.py`: every eye and brow shape rendered once, so a
   Mii's overlap is worked out without renders): a black brow over an eye's outline matches a
   brow-less picture, but in game it shows as a brow in the eye. An old fit that does it isn't kept.

Players whose Mii Retro WFC has (`rwfc.py`: Retro WFC's player API has the Mii data, by friend
code, for players on Toad's Factory with their friend codes) get that Mii exactly when it renders as
their picture.

Parts only 3DS / Switch Miis have (and custom pictures) get the closest Wii part. Gender isn't fitted (the
pictures don't show it).

Running it (Python 3 with numpy, Pillow, scipy, opencv-python-headless):

    python league_players.py          # Toad's Factory players who played in a league -> league_players.json
    python gsc_players.py             # of them, the Grand Star Cup's (the game's) -> gsc_players.json
    python fit_all.py 16 gsc_players.json   # fits their pictures (16 processes) -> fits.json (resumable)
    python rwfc.py                    # their own Miis from Retro WFC, where they match -> rwfc.json
    python export.py                  # -> sandbox-rankings/BuildWorkspace/runtime/src/esports_miis.inc
    python compare.py sheet.png a.png b.png   # debug: pictures beside their fits

Renders come from studio.mii.nintendo.com (about 20 a second per process at most) and are kept on disk, so a
run after the first mostly reuses them.
