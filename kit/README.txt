MKW-SP Live - build kit
=======================

MKW-SP (Mario Kart Wii Service Pack) running natively on Windows through WiiCompiled, with the
Mario Kart Channel's Worldwide / Continental time trial rankings brought back using
https://mkwleaderboards.com.

This kit contains NO Nintendo game code or disc files. It builds the game on your own PC from your
own WiiCompiled install and your own copy of Mario Kart Wii, exactly like WiiCompiled does. It comes
with a custom-made HD texture pack.


What you need
-------------
1. Windows 10 or 11 (64-bit).
2. WiiCompiled 0.9.2, installed with your own Mario Kart Wii disc (PAL / European version,
   RMCP01). The kit uses that install's game files and build tools and does not change it.
3. Node.js 18 or newer (the "LTS" download from https://nodejs.org).
4. About 5 GB of free disk space and some patience: the first build takes a while (often
   20-60 minutes, depending on your PC).
5. An internet connection while playing, for the rankings.


How to build
------------
1. Put this folder somewhere with enough space (not inside a OneDrive-synced folder if you can
   avoid it).
2. Optional, the HD texture pack: download the HD texture zips from the same GitHub release and
   unzip them into this folder's "files" folder (giving files\texture_replacements). Without them
   the game uses its own textures.
3. Double-click "Build MKW-SP Live.bat" and wait for "Done".
4. Start the game: "MKW-SP Live\MKW-SP.exe".

If WiiCompiled is installed somewhere other than the default location, run from PowerShell:
   powershell -ExecutionPolicy Bypass -File files\build.ps1 -InstallDir "D:\path\to\Install"

Building again (for example after updating the kit) keeps your saves and settings.
If a step fails, its log is in work\logs.


First launch
------------
1. Controls: press F10 to open WiiCompiled's settings, choose "Controller settings" and give Port 1
   a controller, or tick "Keyboard and mouse" (its default keys are listed there and can be
   changed). Press F10 again to go back to the game.
2. Create a licence. There is no Mii Channel here, so the game offers its guest Miis. To use your
   own Miis, copy RFL_DB.dat from a Wii / Dolphin NAND (shared2\menu\FaceLib\RFL_DB.dat) into
   "MKW-SP Live\UserData\NAND\shared2\menu\FaceLib\" before starting the game.
3. Optional: pick your rankings region in Settings > Rankings (Licence Settings on the main menu >
   Settings, then the category arrows at the top). The default is Oceania.

Everything starts fresh. Your saves, MKW-SP settings, ghosts and downloaded rankings are kept in
"MKW-SP Live\UserData" (the NAND folder and the SD card image WiiSD.raw). The first Top 10 of
each course takes a little longer while its ghosts download.


Features
--------
* Mario Kart Channel > Rankings: real Worldwide and Continental Top 10s for all 32 courses from
  mkwleaderboards.com, with each player's Mii, flag and controller.
* World / Continental Champion ghosts: open the ghost data page, then race it (pick your character,
  vehicle and drift type first, as on the Wii) or watch it.
* Top 10 ghosts: in a Top 10, use Up / Down to pick a player and press A to race or watch their ghost.
* Rankings button after a time trial (before Quit).
* The ranking graph's timeline follows today's times: from just ahead of the record to the
  board's median time, with the Top 10 button at the 10th place time. The crowd is up to 200 of
  the board's real players, the Top 10 included (their Miis from their ghosts), each at their own
  time, spread like the real players. Timelines and crowds download in the background the first
  time a graph opens and are kept on disk, so later launches open accurate at once.
* Settings > Rankings > My Times: log in to your mkwleaderboards.com account with the in-game
  keyboard (your password is only sent to the site, never saved) and import your times. Your best
  approved run of each course, on both boards (No Shortcut and Unrestricted), then shows as your
  time on the ranking graph for the board Settings > Rankings > Category picks, A on it opens it as
  My Ghost Data, and after restarting the game the ghosts are in Time Trials (on the SD card in
  /mkw-sp/ghosts/mkwlb: PBnn = No Shortcut, UNnn = Unrestricted; a backup of the card,
  WiiSD.raw.bak, is made the first time).
* Settings > Rankings, in this order:
    - My Times (above).
    - Player Names: the names on mkwleaderboards.com, or the Mii names saved in the ghosts.
    - Category: No Shortcut or Unrestricted (every time on the track).
    - Continental Region: Americas, Europe, Asia or Oceania (also turns the globe).
    - Sub-Region: Off, or one of mkwleaderboards.com's sub-regions (USA, Japan, Germany, France,
      Canada, Spain, Italy, UK & Ireland, Germany & Austria, Nordic, Benelux, Latin America,
      Iberian). A sub-region takes the Continental rankings' place: its Top 10s and champions,
      and the texts read "Regional" (Regional Ranking, Regional Top 10, Regional Champion); the
      globe turns to the sub-region, zoomed in as close as Friend Rankings (USA, Canada and
      Latin America at the Continental zoom).
* Mario Kart Channel > Esports: the Grand Star Cup's Division 1 standings (Seasons 1-14 from
  toadsfactory.mkw.gg, 15 on from mkw-stats.web.app), with team names, tags, logos and records. Up / Down = select a team,
  Left / Right = season, A = the team's page (roster with Miis, GSC history), A on a player =
  their page (career, teams, each season's matches with playoffs: Left / Right = season), B = back.
  Players are Baggers under a 12.00 GP average and Runners from 12.00 up.
  A player's page turns the globe to their country and stands their Mii on it, as the WFC Friend
  Roster does, with their team tag, name, flag and country at its feet; the season's matches are
  listed beside it. Toad's Factory only has pictures of the Miis, so each Grand Star Cup player's
  Wii Mii was rebuilt from their picture (as close as the Wii's parts allow: 3DS / Switch-only parts
  get the nearest Wii part), or is their own Mii from Retro WFC where it matches the picture;
  players without one keep the globe as it is.
  Season 16 team pages list every registered player (MK Central) as Active or Inactive; Y hides
  the Inactive ones. L / R switch between three sections:
    - Standings (above).
    - Schedule: every played match with its score (A = its results table: both teams' players,
      their points per GP and total), then the matches still to play as Upcoming.
    - Players: the season's GP averages with each player's Mii, best first; Y (or -) switches
      runners and baggers. Players who didn't play enough are marked "not eligible" only once
      the season is over. Players with fewer than 3 GPs in that role aren't listed (too few for
      an average). Past seasons' Runners lists leave out GP averages under 8 (baggers listed as
      runners in the old data).
* The MKW-SP Channel is called the Mario Kart Channel, and its notification bar (the Mario Kart
  Channel's message bar) cycles through new Top 10 times from the last 7 days (Worldwide and your
  region) and the latest Grand Star Cup results. Ones from the last 24 hours chime (the special
  ghost sound) as they come up and get a pulsing yellow badge on the bar's corner.
* Champion cards remember the last downloaded champions between launches.
* Settings > Race > Kill Feed.
* The MKW-SP Channel's Rankings and Esports buttons look like the Mario Kart Channel's (with their
  icons) when xz is installed (it comes with Git for Windows); otherwise they are MKW-SP's plain ones.
* HD texture pack (its own download: see "How to build"), installed in "MKW-SP Live\UserData\texture_replacements" (WiiCompiled's
  texture pack folder; the build turns on Config.toml's [video] texture_replacements): custom-made
  HD textures for characters, tracks, effects and menus, including the Rankings / Esports icons and
  the Esports menu's top and bottom bars at 8x, and globe textures modified so the Continental
  view no longer stutters the first time it zooms in.
  Textures you add to that folder yourself are kept when you build again.
* Extended Regions v1.2 built in: every country has its flag and name (the game has 64), on the
  Globe, in the Rankings, on ghost data and wherever else the game shows a flag, in every language.
  The Esports menus use the same flags (Scotland, Wales, ... included).

Notes:
* For smooth play without a Bluetooth Wii Remote, leave "Keep scanning for Wii Remotes" off in the
  F10 settings: each scan briefly stalls the game every 2 seconds.
* The Room settings page has fewer entries: three of them (only used by MKW-SP's online rooms,
  whose server is offline) hold the Rankings settings.
* Online play is not part of this build.


Credits and licences
--------------------
* MKW-SP by The MKW-SP Developers (MIT licence, see files\licenses).
* Rankings data from mkwleaderboards.com; ghosts from mkwleaderboards.com and chadsoft.co.uk.
* Extended Regions v1.2 (flags, layouts and country names) by its authors, included in the
  channel data (files\nand\contents.arc).
* WiiCompiled and its toolkit come from your own WiiCompiled install.
* Mario Kart Wii is (c) Nintendo. You need your own copy.
