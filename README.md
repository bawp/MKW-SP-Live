# MKW-SP Live

MKW-SP (Mario Kart Wii Service Pack) running natively on Windows through
WiiCompiled, with the Mario Kart Channel brought back to life:

- **Rankings**: real Worldwide and Continental Top 10s for all 32 courses from
  [mkwleaderboards.com](https://mkwleaderboards.com), with each player's Mii, flag and controller,
  and their ghosts to race or watch. World and Continental Champion ghosts too.
- **My Times**: log in to your mkwleaderboards.com account in game (the password is only sent to the
  site, never saved) to see your own times on the ranking graph and race your ghosts.
- **Esports**: Grand Star Cup standings, schedules and players, with each player's Mii on the globe.
- **Kill feed** in races, **Extended Regions** (every country's flag and name), and an optional
  custom HD texture pack.

This repository holds **no Nintendo game code or disc files**. The game is built on your own PC from
your own WiiCompiled install and your own copy of Mario Kart Wii (PAL, RMCP01).

## Playing it

Download the latest kit from [Releases](../../releases) and follow its `README.txt`. In short:

1. Install WiiCompiled 0.9.2 with your own Mario Kart Wii disc (PAL / European) and
   [Node.js](https://nodejs.org) 18 or newer.
2. Unzip the kit. For HD textures, also unzip the texture pack zips into the kit's `files` folder.
3. Double-click `Build MKW-SP Live.bat` (the first build takes 20-60 minutes), then start
   `MKW-SP Live\MKW-SP.exe`.

## What's here

| Folder | What |
|---|---|
| `kit/` | The kit's build script, launcher, patch applier and SD card maker, and its README |
| `patches/` | The changes to WiiCompiled's runtime: MKW-SP support, kill feed, rankings and esports |
| `tools/` | The MKW-SP to Kamek converter, the Mario Kart Channel UI, texture tools, and `miifit` (fits Wii Miis to Mii Studio pictures) |
| `DEVELOPMENT.md` | How the port works, in detail |

## Credits

- MKW-SP by The MKW-SP Developers ([MIT licence](kit/licenses/MKW-SP-LICENSE.txt)).
- Rankings data and ghosts from mkwleaderboards.com and chadsoft.co.uk; esports data from
  mkw-stats.web.app and Toad's Factory; Miis also from Retro WFC.
- Extended Regions v1.2 by its authors.
- WiiCompiled and its toolkit come from your own WiiCompiled install.
- Mario Kart Wii is © Nintendo. You need your own copy.
