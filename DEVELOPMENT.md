# MKW-SP on WiiCompiled

A port of MKW-SP (Mario Kart Wii Service Pack, the "0.1.12 (Test)" build in `mkw-sp-3-29/test/boot.dol`)
to the WiiCompiled static recompiler, PAL (RMCP01) only.

**Status:** boots to the MKW-SP title screen; menus and a Coconut Mall time trial work (driven with
simulated input). All of MKW-SP's initialisation runs: SD storage, settings, log file, decompressor,
channel installer and its UI section system. VS races, battle, ghosts, ghost saving and settings
pages have not been tested yet.

## Run the test build

`out/MKW-SP/MKW-SP.exe` is a portable build (`portable.txt` + `UserData/`). It uses **copies**, so your
real Dolphin/WiiCompiled data is never touched:

| What | Where |
|---|---|
| NAND | `out/nand/` (copy of `Dolphin Emulator/Wii`, plus MKW-SP's `contents.arc` in `title/00010001/53505350/data/`) |
| SD card | `out/MKW-SP/UserData/WiiSD.raw` (copy of Dolphin's `Load/WiiSD.raw`) |
| Game files | your existing `CT-MKWII/Recomp/Install/GameAssets/DATA` (read-only) |
| Logs | `out/MKW-SP/UserData/Logs/` (MKW-SP's own log lines appear as `[OSReport]`) |

## How it works

WiiCompiled can only translate Pulsar mods (`Code.pul` = Kamek binaries). MKW-SP is not Pulsar: it is
an absolutely-linked payload loaded by its own loader into a relocated memory layout (StaticR moved
to 0x80399F2C, payload at 0x8076F000), which applies its patch table at runtime. The port has three parts:

### 1. Converter: MKW-SP payload → Kamek `Code.pul` (`tools/convert.js`)
* Extracts the PAL payload from `boot.dol` → `contents.arc` → `bin/loader.bin.lzma` (offset 0x58C0, 0x153D74 bytes)
  and uses MKW-SP's own symbol map (`bin/payloadP.SMAP`).
* **Address map** MKW-SP layout → vanilla: DOL unchanged, REL code/data +0x1763B4, REL bss +0x2566A0
  (checked: 2803/2805 calls from the payload land exactly on WiiCompiled's known function starts).
* **Relocation recovery** (`tools/analyze.js`): register dataflow over the payload's code finds every
  `lis`/low-half pair. Payload addresses become Kamek `Addr16Ha/Lo`. REL addresses are rewritten
  to vanilla. Calls into the game become `Rel24`. Data pointers become `Addr32`. The payload is placed so it
  is congruent with its link address mod 64 KiB, so a missed low half can never be wrong.
* **Hook trampolines** that share a register with game code are fixed in both directions:
  a trampoline `lis` consumed by game code after the hook, and a game `lis` consumed by the
  trampoline (e.g. `lwz r3,s_raceConfig@l(r30)` in the Lakitu hook).
* **`bl`-entered hooks that leave with `b`** (42 of them) are rewritten as `b`-entered hooks with
  explicit branches back to hook+4. The translator treats a `bl` hook as a call, so a jump back into
  the hooked function would otherwise run the rest of it twice (this was the time-trial Lakitu crash).
* **Patch table** (555 entries) → Kamek `Write`/`Branch` commands. Words written into game code are
  always treated as instructions, even when they look like payload pointers (0x80770044 is
  `lwz r3,0x44(r23)`, not an address). "Call the original" thunks are
  filled from the relocated vanilla image (`tools/vanilla.js`).
* **Translator compatibility**: clang-style relative jump tables → absolute (32), `bso` NaN tests →
  `bne` (9), `bl` to noreturn functions → `b` (888), 884 vtable/function-pointer targets registered as
  entries through the Kamek ctor range (cleared by the payload entry after the 8 real constructors run).
* **Hardware-only code stubbed**: page tables, BATs, SDR1/real mode, memory protection, stack canaries
  (which patch game code at runtime), OS clock/RTC over EXI, USB, SI keyboard, MKW-SP's own VI console.
* **Patches dropped** (each documented in `tools/convert.js`): MKW-SP's REL loader and `Rel::Run`
  (WiiCompiled loads StaticR on the vanilla path), its heap resizes and larger exception console
  (StaticR is translated for 0x805102E0, so the vanilla heap layout must be kept), and its replacements
  of functions WiiCompiled implements natively (`OSCreateThread`, `OSPanic`, `OSReport`, `AsyncDisplay::endRender`).
  MKW-SP's contents.arc index is taken from the MEM2 arena instead of MEM1 for the same reason.

`build/MKW-SP/convert-report.txt` lists every edit the last conversion made.

### 2. WiiCompiled runtime changes (`patches/0001-wiicompiled-runtime-mkwsp.patch`)
* **Early mod install**: mod memory initializers run before the first guest instruction (MKW-SP hooks
  `OSInit`, `RkSystem::initialize`, …). The REL bytes they patch are recorded and re-applied after the game
  loads and links StaticR, and the executable-write guard stays off until then.
* **`/dev/sdio/slot0`**: new SD slot device (`hle/storage/sdio.cpp`), backed by `WiiSD.raw`
  (searched in `UserData/`, then `<nand_root>/../Load/`, i.e. Dolphin's layout). MKW-SP needs writable
  FAT storage. Without it, it waits forever for an SD card.
* Startup splash dismissed after the REL prolog (MKW-SP skips the strap screen); window title "MKW-SP".

### 3. Build (`patches/0002-recomp-yml-mkwsp-profile.patch`, `tools/*.sh`, `tools/*.ps1`)
Uses a copy of the installed WiiCompiled BuildWorkspace in `sandbox/` (your install is untouched) with
an `mkw-sp` translator profile.

```
tools/translate-mod.sh --base        # convert + translate base and mod (bash)
tools/translate-mod.sh               # convert + translate mod only (when the hooked set is unchanged)
.\tools\BuildMkwSp.ps1 -Workspace .\sandbox\BuildWorkspace -OutputDirectory .\out\MKW-SP-build   # PowerShell
.\tools\capture.ps1 -At 15,30        # run out\MKW-SP and save window captures
```
Run the PowerShell steps from PowerShell itself, not from Git Bash: the two see different spellings of
this folder's path, and mixing them forces a full native rebuild.

## Shareable build kit
`.\tools\make-kit.ps1` writes `Desktop\MKW-SP Live Kit`, a folder other people can build the
Rankings fork from (`kit/README.txt`). It holds no Nintendo code or data and nothing from this PC's
saves: the fork's converter tools, the four runtime patches, MKW-SP's loader and symbol map, and the
fork's `contents.arc`. Its `build.ps1` (started by `Build MKW-SP Live.bat`) needs the recipient's
own WiiCompiled 0.9.2 install and Node.js. It copies their BuildWorkspace, applies the patches with
`kit/apply-patch.js` (no git), converts, translates and compiles there, and sets up a portable
`MKW-SP Live` folder: `Config.toml` pointing at their game files, a managed NAND with MKW-SP's
channel data, and a blank SD card (`kit/make-sd.js`). The converter reads the WiiCompiled install from
`MKWSP_WIICOMPILED_INSTALL` (default `%APPDATA%\CT-MKWII\Recomp\Install`).

## Kill feed
A Valorant-style feed in the top-right corner of races, below the timer and lap counter:
`attacker [item silhouette] victim`, teal for you and your team, red for everyone else, with a yellow
outline on your own hits. Toggle it in **Settings > Race > Kill Feed** (default Enable; saved as
`KillFeed` under `[Race]` in MKW-SP's settings.ini).

* **Runtime** (`patches/0003-kill-feed.patch`, `runtime/src/kill_feed.cpp`): the game counts item hits
  for its license statistics through small leaf functions called right where a hit lands. These are
  reimplemented natively (`PPC_NATIVE_OVERRIDE`, same register effects), and the return address plus
  the caller's registers identify attacker, victim and item: `0x807A2234` (item objects in
  `CheckItemCollision`: shells, bananas, fake boxes, bombs, blue shells) and
  `IncrementItemsHitCount` (star, Mega and Bullet bumps in `CheckKartCollision`). Every hit is its own
  row, so one bomb that catches three racers gives three rows. Lightning, POW, blooper and thunder
  cloud hits are deliberately left out. In single player against CPUs only hits involving you are
  shown (no CPU-on-CPU rows). Names come from RaceConfig (Mii names, character names for
  CPUs). The flat white silhouettes are cut from the alpha of the game's own item icons in `Scene/UI/Race.szs`, and the text
  uses Windows' Bahnschrift (falls back to Segoe UI Bold or Arial Bold).
* **Setting**: MKW-SP's 67-entry settings table is fixed at build time, so the runtime repurposes
  the `RoomCodeLow` slot (only used by the offline mkw-sp.com friend rooms) at boot and clones
  VanillaMode's Disable/Enable values into it. Its name and message IDs live in a 32-byte block that
  `tools/convert.js` appends to the Kamek blob (`0x81962D80`, constants in `tools/killfeed.js`).
* **Texts**: `node tools/killfeed-messages.js` adds the three messages (English for every language) to
  each `message/Menu.bmg` in `contents.arc`, for `build/nand` and `out/nand`. The first run keeps the
  original as `contents.arc.orig`.

Set `MKWSP_KILLFEED_PREVIEW=1` before launching to show sample rows on any screen (layout checks
without a race). Hit sites the feed does not classify are logged once as `[killfeed] unclassified ...`.

Rebuild after changing any of it: `tools/translate-mod.sh --base` (new native overrides change the
translated set), then `BuildMkwSp.ps1`.

## Rankings fork (mkwleaderboards.com)
`out/MKW-SP-Rankings/` is a second build of the port whose **Rankings** channel (Worldwide and
Regional time-trial rankings) shows the leaderboards of [mkwleaderboards.com](https://mkwleaderboards.com/).
The regular build in `out/MKW-SP/` is unchanged. The fork has its own sandbox (`sandbox-rankings/`),
converter output (`build/MKW-SP-Rankings/`), NAND copy (`out/nand-rankings/`) and `UserData/`.

What it does in game:
* **Top 10** (Worldwide or Regional, any of the 32 courses): the vanilla Mario Kart Channel top-10
  screen with each player's Mii, name, national flag and time, in the order the site lists them
  (each player's best run). The Rankings use vanilla's grid background (RankingBack) instead of
  MKW-SP's plain white bars.
* **Top 10 ghosts**: in a Top 10, Up / Down highlights a player (Up past 1st goes back to Back)
  and A opens that player's ghost data page, titled "<course> Worldwide / Continental Top 10",
  with **Challenge this Ghost Data** and **Watch Replay** as for the champion. Downloading a
  top-10 ghost leaves the champion card alone.
* **Switching rankings**: press **Up** on the course name to cycle Friend → Continental →
  Worldwide. Vanilla only lets the Wii Remote pointer reach that selector; the fork maps it to Up.
* **World / Continental Champion ghost**: select the champion and press A to download the #1
  run's ghost and open the vanilla ghost data page (course, time, Mii, flag, character, vehicle).
  **Challenge this Ghost Data** starts a 150cc time trial against it, **Watch Replay** plays it.
  If the #1 run has no downloadable ghost, the next fastest player in the top 10 who has one is
  used. You race with the character and vehicle you last chose in Time Trials; if none is set yet
  (Rankings opened first after boot), you get the champion's combo. The champion card on the graph
  shows the last champion downloaded for that course (from its Top 10 or champion ghost). It is
  kept in `UserData/Cache/mkwleaderboards/champions.bin`, so it survives restarts.
* **Rankings after a time trial**: the menu after finishing a time trial has vanilla's Rankings
  button again (before Quit; MKW-SP had replaced it with Change Ghost Data). It asks vanilla's
  "Check Rankings?" question and Yes opens the Rankings.
* **Settings > Rankings > Category** (No Shortcut / Unrestricted, default No Shortcut) picks which
  times every ranking shows. The site keeps each run on one board (No Shortcut, Alternate where a
  track has one, Unrestricted for the rest), so Unrestricted shows all of a track's boards
  together, each player's best run of any of them. Each
  board keeps its own champions (`champions-unrestricted*.bin` for Unrestricted).
* **Settings > Rankings > Player Names** (Player Name / Ghost Mii, default Player Name):
  the names players use on the site, or the Mii names saved in their ghosts. Players without a
  downloadable ghost always show the site's name. A champion card keeps the name it was downloaded
  with until that course's Top 10 or champion is opened again.
* **Settings > Rankings > Continental Region** (Americas / Europe / Asia / Oceania, default
  Oceania) picks which continent the Continental rankings show. Runs are grouped by the player's
  country on the site: Americas, Europe (with Africa), Asia (East and South-East Asia, India, the
  Middle East) and Oceania (Australia and New Zealand only). Players without a country appear only
  in Worldwide. The Continental graph turns the globe to the region's default place, the game's
  own per-area places: the USA, Germany, Japan and Australia. Each region keeps its own Continental
  champions (`UserData/Cache/mkwleaderboards/champions-<region>.bin`).
* **Ranking graph timeline**: `RankingGraphControlTimeAttack` builds its axis from a per-course
  record (WC24's, else defaults shipped with the game, years out of date). `0x8061A650(axis, record,
  world)` is replaced: on the Continental / Worldwide graphs the slow / fast ends (axis +8 / +12)
  come from the course's board (record - width/25 to the board's median time, at least record +
  10 s), the 100-bucket crowd histogram (+192) from the board's players, and the Top 10 button item
  (kind 6, time at +388) gets the 10th place time. Boards are fetched on a worker for all 32
  courses the first time a graph opens; until then it is vanilla's.
  The crowd (`RankingItemStranger`, Mii from RFL's middle database in `Enable` 0x8061907C, replaced)
  is up to 260 of the board's players in the span (the Top 10, then the rest evenly by rank), their Miis from their ghosts
  (the ghost cache; each Mii once), as many strangers as Miis (at most the game's 200 / 140). Before
  the axis sorts its items (0x80619F5C, replaced) the strangers, in time order, take the players'
  times (+388) and x (0x8061A32C). Crowds are fetched 32 ghosts at a time for every course after
  the boards, and kept in `UserData/Cache/mkwleaderboards/crowds` (refreshed after a day); the spans
  in `.../spans` (used at once on the next boot, the boards fetched again in the background).
* **Settings > Rankings > My Times** (setting 50): A on the row (a converter hook on
  `SettingsPage::onSettingControlFront`) opens an ImGui page with an in-game keyboard: log in
  (`POST /login`; only the verified profile is kept, `UserData/mkwleaderboards_account.txt`) and
  import. The import takes the profile's best approved run per course on both boards (No Shortcut,
  Unrestricted) and keeps its ghost twice: `UserData/mkwleaderboards_pbs/<nonsc|unrestricted>/PBnn.RKG`
  (the one of the board Settings > Rankings > Category picks is your
  time: `RKSYS::LicenseMgr::GetLdbEntry(CourseId)` 0x80548E30 is replaced, its best record answers
  the PB when faster, so the graph's own card shows it; type 1 = your licence's PB ghost is sent
  through the champion pages as My Ghost Data) and `UserData/mkwleaderboards_import/` (moved onto
  the SD card at the next start, before sdio opens WiiSD.raw: a small FAT32 writer puts them in
  `/mkw-sp/ghosts/mkwlb`, as MKW-SP lists ghosts only at boot).

How it works:
* **Converter** (`node tools/convert.js --rankings`, code in `tools/rankings.js`): MKW-SP's own
  rankings pages only fetched names and times from the offline mkw-sp.com and never displayed them.
  The fork drops MKW-SP's `RankingPage::handleTopTenDownload` / `handleGhostDownload` replacements,
  so the vanilla pages run again (0xAE top-10 download, 0xAF top-10 list, 0xAC champion ghost
  download). It also loads 0xAE/0xAF in the Rankings section in place of the two SP download
  pages. The pages' "connected to WFC?" checks become true, and their connecting spinner (section
  page 0x50, both loaded and pushed by ID) is taken from page 0x4F, which is the same class. A hook
  at the end of `RankingGraph::OnInit` gives the course name's unused Up handler to the area
  selector. The section also gets vanilla's pages and layers: RankingBack (0xAA) and
  TopMenuOverlay (0xAB) replace MKW-SP's Obi (0x5E), the GhostManager (0xA7) is active, and the
  ghost data page (0xAD) is loaded (stubs after `Section::addPages` / `addActivePages`). For the
  champion, MKW-SP's 0-slot downloaded-ghost group gets vanilla's 32 slots back, so page 0xAC keeps
  the ghost there (in memory only: the RKSYS save is skipped) and opens 0xAD. 0xAD's buttons lead
  to sections MKW-SP repurposed, so hooks run MKW-SP's `GhostManagerPage::setupTimeAttack()` and
  change to sections it keeps instead: Start This Race goes to 0x4F
  (`SingleChannelLeaderboardChallenge`, vanilla's twin of 0x4E), whose character, vehicle and drift
  select set your combo before MKW-SP's drift page starts the time trial (Back on character select
  returns to the Rankings), and Watch Replay to the ghost replay section. MKW-SP's drift page
  goes on to the time trial without vanilla's ghost race setup, and the character select on the
  way resets the race's players, so a hook there (0x807f8648) runs `setupTimeAttack(true, false)`
  again first: player 2 is the champion's ghost. MKW-SP's ghost loader takes ghost 0
  from the champion slot (a block after the Kamek blob) when the time trial's first ghost index is
  marked `MKLB`; picking ghosts in MKW-SP's own lists overwrites that mark.
  The overlay's bottom bar is loaded from `bg/MenuObiBottom` (as on MKW-SP's own menus) instead of
  vanilla's `ranking/RankingObiBottom`, whose white base stops short of the right edge in
  widescreen and leaves its checker over the background. `ServerMgr` normally merges two records
  it keeps per course (the downloaded champion and your own uploaded run) into each top 10; the
  site's list already has the champion, so both merges are skipped (otherwise the champion
  appeared twice once downloaded).
  After a time trial, `AfterTaRaceMenuPage` gets a 7-button table (MKW-SP's six plus vanilla's
  Rankings, ID 8) and CheckRankings' Yes changes to section 181 instead of vanilla's 0x7D.
* **UI data** (`tools/rankings-ui.js`, run by `MKWSP_VARIANT=rankings tools/translate-mod.sh` on
  every fork build): MKW-SP's after-time-trial layout
  (`button/ctrl/AfterMenuTimeAttack.brctr` in `Scene/UI/RaceSP.arc`) only places six buttons, so the
  script rebuilds it with seven (vanilla's `ButtonRanking`, message 0x3F7, before Quit, all spread
  over vanilla's +175..-175 span) inside `out/nand-rankings`'s `contents.arc`. It keeps the file it
  started from as `contents.arc.pre-rankings`, is safe to re-run and leaves the file alone when
  it is already up to date.
* **Runtime** (`patches/0004-mkwleaderboards-rankings.patch`, `runtime/src/mkwlb_rankings.cpp`):
  the vanilla pages go through `ServerMgr` to a small ranking client that used to query Nintendo's
  NintendoRacingService. Its setup, top-10 request, ghost request and per-frame pump
  (0x806773C8, 0x806776B0, 0x80677758, 0x80677240) are reimplemented natively. They read
  `https://mkwleaderboards.com/api` over WinHTTP: the track's categories, then all approved runs.
  Miis come from the runs' ghost files (chadsoft or the site), renamed to the site's player name,
  with a plain default Mii when a run has no ghost. The game's own code then checks the Miis,
  stores the champion in the license and builds the ghost, exactly as it did with Nintendo's data.
  For the champion the runtime also decompresses the ghost into the champion slot, sets the time
  trial's ghost count to 1 and marks ghost 0 as the champion.
  It also answers `SCGetSimpleAddressData` (0x801B2074) from the loaded SYSCONF: the runtime never
  builds SC's item table, so the game couldn't read the console's country and always used Europe.
  The runtime's `Page::Draw` (0x8060235C) skips TopMenuOverlay (0xAB) while neither the top-10
  list (0xAF) nor the ghost data page (0xAD) is on screen: the ranking graph has its own bottom
  bar, and in widescreen the two bars would show at once.
* **Top-10 ghosts** (runtime): the top-10 list's rows are plain layout controls, so the list's
  empty per-frame hook (`RankingDetailPage` vtable +0x48, 0x8060B1FC) is replaced natively: it
  reads player 1's menu buttons, plays each row's `MyData` / `OtherData` look as a cursor, takes
  focus off Back while a row is chosen, and on A fills in the ghost request as the champion card
  does (type, course, licence; the row's Mii for page 0xAC) and closes the list. The top-10
  download page's next page (0x8060C50C) then answers 0xAC instead of the graph, the ghost
  request downloads that rank's run, and the ghost data page gets the top-10 title (a
  `Text::Info` built in the scratch after the champion slot). Page 0xAC still stores whatever it
  downloads as the course's champion, so the champion archive puts the real champions back.
* **Rankings settings** (converter + runtime): MKW-SP's settings sheets come from 9 categories
  (`SP::ClientSettings` `categoryNames` / `categoryMessageIds`, and two "9 categories" loops in
  `UI::SettingsPage`). The converter writes 10-entry tables (the 9 plus Rankings) into a block after
  the champion slot (0x819656C0), points the five places that load them there and makes the loops
  count 10. At boot (next to the kill feed's install) the runtime turns the Room setting slots
  49-53 (`RoomRaceCount`, `RoomCourseSelection`, `RoomClass`, `RoomVehicles`, `RoomCodeHigh`, only
  used by the offline mkw-sp.com rooms) into Rankings > My Times (`MyTimes` in settings.ini),
  Player Names (`PlayerNames`), Category (`TimeCategory`), Continental Region (`ContinentalRegion`)
  and Sub-Region (`SubRegion`): the page lists a category's settings in slot order, and settings.ini
  keeps values by name. Names and message IDs come from that block (Sub-Region's from the runtime);
  the texts (0x2F10-0x2F47) are added to every `Menu.bmg` by `tools/rankings-ui.js`. The converter's
  My Times hook (A on the row) checks slot 49. The Room settings page loses those entries, which only
  applied to mkw-sp.com rooms. Top-10 and champion
  requests take their region from the setting, and `RKSYS::Mgr::GetLongitude` / `GetLatitude`
  (0x8054A9E0 / 0x8054AA08) return the region's default place (the game's per-area table at
  0x80245DA8) while the Continental graph is shown.
* **Champion archive** (runtime, `Page::Draw` override): the game keeps each course's World /
  Continental champion (time and Mii) in the save data after the licenses (32 courses x 2 x 80
  bytes), which MKW-SP doesn't save. The runtime writes that block to `champions.bin` whenever it
  changes in the Rankings and puts the saved records back once per boot when the MKW-SP Channel
  (section 180) or the Rankings (181) open.
* **Sub-Region** (runtime + texts): Settings > Rankings > Sub-Region (slot 53, RoomCodeHigh,
  turned into it at boot like the other Rankings settings; Off or one of mkwleaderboards.com's 13
  sub-regions, `kSubregions`, with their countries as the site's sub-region boards show them). Its
  names (setting and value names, message IDs) are written by the runtime to 0x819F0000, in the
  Kamek overlay past the fork's blob; its texts (0x2F2B-0x2F47) are in `rankings.js` (`block:
  'runtime'`) and added by `rankings-ui.js`. A sub-region replaces the Continental Region in
  everything Continental: region bytes 0x21... (`RankingAreaByte`) for the Top 10, champion ghosts,
  graphs (timelines / crowds cached per region byte), notifications, and its own champion archive
  (`champions-sub-<name>.bin`). The Continental graph's globe turns to the sub-region's middle
  (`RksysPlace`, `kSubregions` latitude / longitude) at the Friend Rankings' closer zoom: the
  graph asks `GlobeMgr::SetPosition` (0x80750808) for mode 5, and `GlobeToSubregion` (each frame,
  from `Page::Draw`) asks again for mode 6 at the same place; USA, Canada and Latin America
  (`close` false) keep the Continental zoom. While one is
  picked, `BMGHolder::GetMsgId` (0x805F8C88, native) answers the Continental rankings texts (6002,
  6006, 6020, 6054, 6058, 6252, 6256, 6260) with "Regional" twins (0x2F48-0x2F4F) that
  `rankings-ui.js` makes from each Menu.bmg's own text (Continental -> Regional).
* **Notification bar recency** (runtime): items from the last 24 hours (a run's `date_set`; a
  result's `last_update_at` from `/api/matches/<id>`) play SE_UI_RANK_ENTER_FAMOUS (41) as they
  come up, only while the bar is on screen, and get a pulsing yellow badge on the box's top-right
  corner (ImGui, at the text's alpha). The badge moves with the bar as menu transitions slide it in
  and out: the bar's `text` pane's global position against where it rests (learnt while the page is
  active and the bar still; the badge waits for that on the first entrance), hidden while the pane
  isn't laid out (an empty global matrix or no global alpha, as a page is built behind a black screen).
* **Notification bar** (converter + channel data + runtime): vanilla's Mario Kart Channel message bar
  (`button/ctrl/NotifyButton.brctr`, variant Notify, layout `common_w101_earth_message_go_menu`, in
  Channel.szs) as the MKW-SP Channel page's fifth child: the converter makes `onInit` count 5 children
  and its Esports stub also allocates a `PushButton`, inserts it as child 4 and loads it with player
  flags 0 (never selectable, no handler). Its names, a `UI::MessageInfo` and a UTF-16 text buffer are in
  a block after the settings block (`NOTIFY` in rankings.js, 0x819658C0). The runtime, from
  `Page::draw` of the page: places it at y 120 (above the buttons; `UIControl` base position +0x08,
  then `UIControl::PositionFromBasePosition`), hides the GO capsule (`SetPaneVisibility`), centres and
  widens the text boxes (pane x / width), and every 5 s fades the `text` pane's alpha out, sets the
  next notification (message 0x2F25, `{arg string|0}` as MKW-SP's own, strings[0] at +0x9C) and fades
  it in. A `PushButton` loads only the button animation groups, so the bar's own Visible group isn't
  there; `UIAnimator::GetAnimationGroupById` doesn't bounds-check, so it isn't used. Notifications,
  fetched every 15 minutes on a worker thread: runs approved on mkwleaderboards.com in the last 7 days
  (`/api/leaderboards?set_after=`) on the board Settings > Rankings > Category picks that are in their
  track's Worldwide or Continental (the chosen region) Top 10, ranked as the in-game Top 10s
  ("New WW #3: name 1:55.935 on CM", the region's place only for times outside the Worldwide Top 10;
  the community track abbreviations), and the current season's latest 5 GSC Division 1 results
  (mkw-stats `/api/matches`), mixed (a time, a result, ...). A change of Settings > Rankings (Times,
  Continental Region) drops them and loads them again. The bar is hidden with the
  channel's buttons while the Esports menu is up. The channel is called the Mario Kart Channel:
  `rankings-ui.js` points its name (0x28BC) at the game's "Mario Kart Channel" (0x1388) in each
  Menu.bmg.
* **Esports menu** (converter + layout + runtime): the MKW-SP Channel page
  (`UI::ServicePackChannelPage`, page 0x103) gets a fourth child. The converter makes `onInit` count
  4 children (0x807ae41c) and hooks it after the Back button (0x807ae4f8): a stub allocates a
  `PushButton`, inserts it as child 3, loads it from `ServicePackChannelButton` with an `Esports`
  variant, and gives it a copy of the Rankings button's handler whose function (a fork entry) sets a
  flag in the settings block (+0x1F8) to 1 and calls `Page::startReplace` after the button's press,
  as a menu change does. `tools/rankings-ui.js` adds that variant below Rankings in
  `Scene/UI/ChannelSP.arc` (Rankings y=35, Esports y=-35) and the text "Esports" (0x2F24).
  With the game's Channel.szs at hand, `rankings-ui.js` instead makes `ServicePackChannelButton.brctr`
  from vanilla's `button/ctrl/ChannelMenu.brctr` (the Mario Kart Channel's menu buttons, layout
  `common_w095_mariokart_channel_top_menu`): its Ranking variant as Rankings (the "10" medal icon)
  and its TrialEvent variant (Tournament, the checkered-flag icon) as Esports, with MKW-SP's texts
  and positions; both layouts and the icons are in Channel.szs, which the section loads. Being made
  from the disc, it isn't in the kit's contents.arc (`--no-vanilla`); the kit's build.ps1 makes it
  from the recipient's disc when `xz` is available. The
  runtime's `Page::GetNextPage` (0x805BB278) answers the channel page itself, so it comes back
  through the game's own transition as the Esports menu: Rankings / Esports hidden (`UIControl`
  +0x80), the title bar set to "Esports" (`CtrlMenuPageTitleText::SetMessage`). The menu has vanilla's
  Competitions bars: the section also loads page 0xBB (a TopMenuOverlay, which loads
  `bg/EventObiTop` / `EventObiBottom` for that page id) as its first layer, and `Page::draw` draws
  either it or the menu bars (Obi, 0x5E), the Competitions ones from the swap to the menu until the
  channel page is back. The menu sits between those bars (layout units 70-400; the button hints and
  the data credit in the bottom bar's dip on the right, at 404). `tools/obi-hd/gen.js` makes 8x
  versions of the Competitions bar textures for a texture pack (`node tools/obi-hd/gen.js <dir of
  the extracted Channel.szs bg/timg> <out dir>`): it rebuilds each bar's cross-section (white, grey
  ramp, gold tube, shadow) with its hard edges kept hard, sweeps it along the curve pieces' measured
  centre line, and adds back the upsampled difference to the original; save the PNGs under their
  Dolphin names (`tex1_<w>x<h>_<hash>_5.png`). The channel buttons' icons (Channel.szs
  `button/timg/tt_mariokart_channel_top_menu_image_ranking` / `_event`, 220x56) are 8x (1760x448),
  made with Real-ESRGAN (realesrgan-ncnn-vulkan, model realesrgan-x4plus-anime) in
  `tools/channel-icons-hd/`: colour and alpha mask (the checkered fade) upscaled 4x separately
  (`combine.js`); the Esports icon's colour with the original's detail added back (the difference to
  the original, upsampled; `detail.js` variant a), as that model flattens its laurel; then both, and
  the mask, 4x once more and halved (`pass3.js`). The globe's textures (contents/globe.arc
  earth.brres.LZ and Scene/Model/Earth.szs: 1024x1024 CMPR region tiles) get BC1 DDS replacements
  from `tools/globe-bc1/gen.js` (`node tools/globe-bc1/gen.js <game files dir> <pack dir>/Globe`):
  aurora decodes a CMPR texture to RGBA8 on the CPU the first time it is drawn, so the Rankings'
  first switch to the Continental view (the globe zooming into its region tiles) hitched; CMPR is
  BC1 in another block / byte / index order, so the conversion is lossless and the GPU takes it as
  it is. The page's bars and
  Back button as they are. Between the bars the standings are drawn with ImGui in the look of the
  channel's top 10 list (rows, cursor frame, grid), using the game's own menu font
  (`kart_kanji_font.brfnt`), controller icons (`tt_kart_extension_font.brfnt`) and D-pad icon
  (`fm_handle_juji.tpl` in `Race.szs`), read from the disc at run time and drawn from their sheets.
  Each sheet is looked up in `UserData/texture_replacements` by its Dolphin name (XXH64 of the
  texture data, as the game's own textures are), so with the HD pack the menu's text uses the
  pack's 4x sheets like the rest of the game; BC7 / BC1 / BC3 sheets go straight to aurora's WebGPU
  device (`aurora::webgpu::g_device`, when it has BC support). To keep the channel smooth, the font
  is loaded on a below-normal-priority thread about 2 seconds after the channel opens (at once if
  Esports is pressed first), `Channel.szs` is decompressed once, and the sheets go up one per frame;
  Toad's Factory seasons, being finished, are never fetched again after loading. `Page::CheckActions` (0x80601C64) gives the page's input to the menu meanwhile:
  Up / Down move the cursor over the teams (for a team page later; with the top 10's select sound),
  B plays the Back sound and replaces the page with the channel again. Data: the Grand Star Cup's
  Season 15, Division 1 from `https://mkw-stats.web.app/api/standings` (all teams, dropped ones
  dimmed): rank, logo, name, tag, P, W, T, L, BP, PF, PA (4:3 leaves PF / PA out), +/- and points.
  Playoffs: the standings' `playoff_qualification` (seeds, team count) and `playoffs.series` (stage,
  status, winner) decide the top places once a series is played: the playoff teams are ordered by
  the stage they went out at (final winner 1st, final loser 2nd, semifinal losers next), then by
  seed; the rest keep their table rank. A red line marks the playoff cut (after the 3rd row in
  Division 1), and once the final is played the top three get the extension font's gold / silver /
  bronze cups (U+F06A-F06C), on the table and in the team pages' history.
  Seasons 1-14 come from Toad's Factory (league 15, each season's Division 1:
  `/api/division/<id>/standing`, kept in `UserData/Cache/esports/toads_div_<id>.json` for good): the
  table (wins, draws, losses, points; bonus = points - 3 per win - 2 per draw; points for / against
  from the regular season's matches), each team's roster with its players' GP averages, the matches
  and the playoffs (stage 2 semifinals, stage 3 the final, as games won; Season 12 has none there).
  Teams and players there are tied to mkw-stats' by `kEsTeamBridge` / `kEsPlayerBridge`, made by
  `tools/gsc-bridge/` (friend codes, else the same name or alternative name on a team both list;
  `review.md` lists the rest to bridge by hand), so team pages show the whole history, player pages
  list their Toad's Factory seasons (team matches, no player scores there) and those rosters' Miis
  are exact. Team histories compare names and tags by letters and digits ("Lovers Posture" =
  "Lover's Posture"), the exact one winning when a season has more than one.
  Seasons are a list (`kEsSeasons`: Seasons 15 and 16, opening on the newest); Left / Right switch
  between them, with the ranking pages' arrow (`tt_yajirushi_type1.tpl`) either side of the name.
  A on a team opens its page the same way the menu opens (the page replaced by itself; flag 4 / 5,
  B: 6): the team's logo, name and tag, its GSC history and career, and the season's roster with
  races and GP average (points per race x 4). An org can enter a season more than once (Jx. Kt★ and
  Jx: F5 are both team 75), so a team is its season entry (`team_season_entry_id`): its history is
  that entry plus the org's other seasons under the same name or tag (from `/api/teams/<id>/overview`
  appearances, each with that season / division's final place and record (a Toad's Factory playoff
  series settled by forfeit, a score not marked played, counts too; a standings row with more
  matches than the team was scheduled, like Season 6's XI at 8-1-2 of 10, takes its record from the
  matches); a season whose final
  isn't played yet is left out), its career (matches, win
  rate, average +/-) is summed from those standings rows, and its roster
  (`/api/teams/<id>/roster?season=..&role=runner|bagger`, the whole org's) keeps only the players the
  division's standings `leaderboard` lists under that entry. For the season being played (Season 16,
  `mkcTournament` 762) the roster also lists everyone registered on MK Central
  (`https://mkcentral.com/api/tournaments/762/registrations`, the squad with the team's tag, compared
  loosely) with a status: Active (has played this season or is in the projected lineup), Inactive
  (the rest), or as set in `kEsStatusOverrides` (Idle by hand); `kEsMkcAliases` maps registered names
  to the roster's (Vitality's Luke is LukeGER). A registered player known only by name gets, when their page opens,
  the Toad's Factory profile their Mii was found under (and its mkw-stats player, if bridged), so
  their earlier seasons show. Y hides / shows the Inactive players: the menu's option
  bit (0x100: GameCube X / Z, Classic X / ZR / -, Wii Remote -) or, on a GameCube controller, Y itself
  (0x0800 in the raw buttons the UI state keeps at +6; Y has no menu bit). The game's icon fonts have
  no Y, so its hint draws a grey button like theirs.
  Players' flags: Extended Regions' flags (every code 1-254: `ExtendedRegions/flags/<code>.tpl` in
  contents.arc, CMPR 60x40, see Extended Regions below) over the game's own (Globe.szs
  `globe/timg/<group>_<country>_<name>.tpl`, C4 / C8 / C14X2 with a palette), decoded onto sheets as
  glyphs U+E100 + Wii country code, beside the names on the roster and the player page. The country
  is the `country_id` of the Toad's Factory profile the Mii comes from (Toad's Factory numbers
  countries as the Wii does, Extended Regions' codes included). Roles come from the GP average:
  under 12.00 Bagger, 12.00 or more Runner, none without a GP average. Players' Miis come from Toad's Factory
  (`http://toadsfactory.mkw.gg`): its player list (`/api/player`, kept a day in
  `UserData/Cache/esports/toads_players.json`) is matched by name (each part of "A / B" names), and
  by friend code (`/api/player/<id>`) when several players share a name, else the single most active
  of those who played in a league there (`played_in_league`, `status`). Players who go by another
  name there (its alternative names aren't in the list) are linked by id in `kEsToadsPlayers`
  (mkw-stats player id -> Toad's Factory player id, e.g. jamie -> Berry); the 512x512 picture
  (`/resources/mii/<file>`) is cached in `UserData/Cache/esports/miis/` and drawn at 128x128. Players
  it has no Mii for get the game's default Mii (`tt_mii_matuoka_64x64.tpl`). Before the name match,
  a player is looked for among the members of the team's Toad's Factory clan (`/api/clan/<id>`, its
  squads included), which settles common names. Teams' clans are found in `/api/clan` (kept a day)
  by name, letters and digits only, the tag deciding between clans of the same name; a team whose
  mkw-stats logo is missing or its placeholder gets the clan's logo (`/resources/clans/<file>`).
  A on a roster row opens the player's page the same way (flag 7 / 8, B: 9 back to the team's):
  their Mii, name, role and friend code, the team they are shown for, their GSC career
  (`/api/players/<id>/overview`: matches, races, GP average, average place, podium rate, race wins,
  best GP, best match, match record; `match_set=all`, playoffs included), the teams they played for
  by season (logos from those seasons' standings) and one season's matches (Left / Right: season,
  Up / Down: scroll): every match of each team they played for that season
  (`/api/matches?season=..&division=..&team=<tag>&match_set=all`) they played in, from each match's
  details (`/api/matches/<id>`: team and player scores; kept in `UserData/Cache/esports/matches/`
  once the season's final is played), the regular season then the playoffs. A projected player is
  looked for by name in the team's rosters of other seasons, then among every division's players
  (the standings' leaderboards, when a single player has the name: Fox from Lazarus to Vitality);
  one who hasn't played in the league gets their Mii and team.
  The player's page also stands their Mii on the globe at their country, as the WFC Friend Roster
  does (`Pages::Globe` 0x805E50B4): the Mii goes into the menus' Mii group (GlobalContext +0x238,
  slot 0, `MiiGroup::LoadMii`), `GlobeMgr::SetMii` (0x807509A0) takes it, `SetPosition` in mode 1
  turns the globe to the country's middle (Toad's Factory's `country_code`, `kEsCountryPlaces`) and
  `DisplayMii` (0x807509B4) brings it up once `IsMiiEnabled`; leaving the page calls `ResetGlobeMii`
  (0x807509D0) and `SetPosition` with the globe's mode from before. Toad's Factory only has pictures
  of the Miis (Mii Studio renders), so `tools/miifit` fits a Wii Mii to each Grand Star Cup player's picture
  (`runtime/src/esports_miis.inc`, generated, by picture file; see `tools/miifit/README.md`), or
  uses the player's own Mii from Retro WFC (its player API's `miiData`, by friend code) where it
  renders as the picture. Over the Mii's feet, as the Friend Roster has it: the team tag and name
  with the flag, the country under them, in outlined white text (`EsGlobeMiiCountry`, while the Mii
  stands there); the season's matches are listed right of the middle (`kEsPlateHalf`), clear of
  the Mii.
  Teams that haven't played yet that season show their projected lineup (`kEsProjected`, by season
  entry, with a Toad's Factory id where a name isn't enough) in place of the roster.
  Team logos (WebP, decoded with WIC) are cached in `UserData/Cache/esports/logos/`.
* **Esports sections** (runtime): L / R (GameCube triggers, raw PAD bits 0x40 / 0x20) switch the
  Esports menu between Standings, Schedule and Players. Schedule: mkw-stats' played matches
  (`/api/matches?...&match_set=all`, newest first) or Toad's Factory's, then the regular season's
  remaining meetings (each pair `conference_config.same_conference_matches` times) as Upcoming; A
  on a played match loads `/api/matches/<id>` and shows both teams side by side, each player's
  points per GP (4 races) and total. Players: the standings' `leaderboard` (runner / bagger GP
  averages, GPs played, eligibility) or Toad's Factory's rosters, with Miis (`EsMiiTexture`).
  Eligibility ("(not eligible)", dimmed) only counts once the season is over (its playoffs
  decided): until then every player is shown as eligible. Players with fewer than 3 GPs in the
  role shown (runner / bagger) are left out (`kEsMinAverageGps`); Toad's Factory's seasons have no
  GP counts, so theirs all show. Finished seasons' Runners leave out GP averages under 8
  (`kEsMinRunnerAverage`): baggers whose Toad's Factory roster role isn't set to bagger.
* **Menu top bar seam** (runtime): `obi_top.brlyt` (and its option / present variants) builds the
  top bar from `obi_base_l` and, as its children at 0.7 scale, the curve and the right part. The left
  part ends 0.12-0.26 layout units short of the curve: invisible on the Wii, a pixel-wide line
  through the bar once MKW-SP stretches it to 16:9 at PC resolutions. The runtime's
  `nw4r::lyt::Pane::Pane` (0x80078980, reimplemented as the game's) makes `obi_base_l` 0.5 wider
  when it is that 269/272 x 133 piece; the curve is drawn over the extra width.
* **Settings**: `UserData/mkwleaderboards.toml` (created on first use). `category` = `default` (the
  board the site opens, No Shortcut on every track today), `nonsc`, `shortcut` or `unrestricted`
  (only used when Settings > Rankings > Category could not be installed);
  `cache_minutes` = how long a track's board is kept before it is downloaded again. Ghost files are
  cached in `UserData/Cache/mkwleaderboards/ghosts/`. Log lines start with `[mkwlb]`.
* **Errors** show as in-game error codes: 60001 = the site could not be reached, 60002 = no ghost to
  download, 60003 = unexpected data, 60004 = not supported (Friend rankings, competitions).

Build:
```
MKWSP_VARIANT=rankings tools/translate-mod.sh --base     # bash
.\tools\BuildMkwSp.ps1 -Workspace .\sandbox-rankings\BuildWorkspace -OutputDirectory .\out\MKW-SP-Rankings-build   # PowerShell
```
then copy `out/MKW-SP-Rankings-build/*` over `out/MKW-SP-Rankings/` (keep its `UserData/` and `portable.txt`).

## HD textures
`out/MKW-SP/UserData/texture_replacements/` holds a copy of the Dolphin RMCE01 HD texture pack, and
`texture_replacements = true` is set in `Config.toml`. WiiCompiled matches Dolphin-format names
(`tex1_WxH_hash_fmt.dds`) by the same XXH64 content hash, so the pack covers the race HUD (items,
countdown). Keep this folder at a short path: Windows' 260-character limit makes the indexer find
nothing (and logs fail) when the folder lives somewhere deep.

One texture of the pack is switched off: `UI/WFC/tex1_64x64_a99247c066554264_3.dds` (renamed to
`.dds.disabled`). It replaces `emboss_lighting` in `Scene/Model/Earth.szs`, the sphere-map lighting
lookup of the Mario Kart Channel globe. The original fills the square and never goes below ~35%
brightness; the pack's version is a smaller, off-centre disc on black, so every globe normal that
falls outside it reads black and half the globe turns dark. The 64x64 original is a smooth gradient,
so nothing is lost without the replacement.

## Extended Regions
`assets/extended-regions/` is the Extended Regions v1.2 mod: flags (`tpls/001.tpl` ... `254.tpl`,
one per Wii country code, CMPR 60x40), the four layouts that show a flag with their flag panes named
by country code (`national_flag`, `chara_flag_machine_picture_common`, `common_w075_ghost_data`,
`common_w086_earth_mii_name`; the game picks a pane with `"%03d"`, so no code changes are needed) and
the country names (Wiimm BMG text, messages 0x15E0 + code). `node tools/extended-regions.js
[contents.arc ...]` puts it in MKW-SP's own archives, which the game reads in place of the disc's
files: each layout into the `<Scene>SP.arc` of the scenes that have it (Channel: button, control,
globe, ranking; Globe: globe; MenuOther: control; MenuSingle: control, where MKW-SP already had an
older copy of its ghost-list layout; Title: button) with the 254 flags in that folder's `timg/`, the
names into every `message/Menu.bmg` in its language (F / Q take FQ, S / M take SM, N takes E), and
the flags once more as plain files under `ExtendedRegions/flags/` for the runtime's Esports flags.
Without arguments it patches `out/nand-rankings` (`contents.arc` and `contents.arc.pre-rankings`,
which `rankings-ui.js` starts from); re-running changes nothing. `make-kit.ps1` runs it on the kit's
`contents.arc`, so the kit carries it.

## After moving this folder
The native build cache stores absolute paths. Before rebuilding from a new location, delete
`sandbox/BuildWorkspace/native-build` (the next build is a full ~5 minute rebuild).

## Known limitations
* Verified: boot, title, menus, a solo time trial. Everything else is untested.
* MKW-SP features that rewrite game code at runtime cannot work in a static recompiler (e.g. its mirror-mode
  model patches, pigtail fixes, stack canaries). They need converting to static patches case by case.
* MKW-SP's online services (mkw-sp.com) are offline. No USB storage.
* Debug output from MKW-SP's own screen console goes to the runtime log instead.
