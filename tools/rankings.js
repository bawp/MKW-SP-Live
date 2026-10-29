// MKW-SP Rankings fork: restore the vanilla Mario Kart Channel top-10 / champion-ghost flow inside
// MKW-SP's Rankings section (`node tools/convert.js <outDir> --rankings`). The runtime side
// (runtime/src/mkwlb_rankings.cpp) answers the game's ranking requests from mkwleaderboards.com.
//
// MKW-SP replaces RankingPage::handleTopTenDownload / handleGhostDownload with its own
// SPRanking*DownloadPage pages, which download names and times from the (offline) mkw-sp.com and
// never show them. Vanilla instead goes to
//   0xAE  top-10 download page  -> ServerMgr top-10 request -> pushes 0xAF
//   0xAF  RankingDetailPage     (the top-10 list: Mii, name, flag, time)
//   0xAC  ChannelStartTimeTrial (downloads the World / Continental Champion ghost, starts the race)
// The edits below put that flow back:
//   * the two RankingPage replacements are dropped (vanilla handlers run),
//   * section ServicePackRankings (181) loads 0xAE and 0xAF in place of the two SP download pages,
//   * the vanilla pages' "connected to WFC?" checks become true, so they request instead of
//     asking to connect,
//   * their "connecting" spinner (section page 0x50) is taken from page 0x4F, which the section
//     already loads. Both IDs are Pages::AutoEnding (one CreatePageById case), so the pages'
//     dynamic casts still pass,
//   * the section gets vanilla's look and pages: RankingBack (0xAA, the grid background) and
//     TopMenuOverlay (0xAB) replace MKW-SP's plain Obi (0x5E), the GhostManager (0xA7) is active as
//     in vanilla, and 0xAD (the champion's ghost data: Start This Race / Watch Replay) is loaded.
//     The runtime draws TopMenuOverlay only on the top-10 list and the ghost data page (the ranking
//     graph has its own bottom bar), and the overlay's bottom bar is MKW-SP's menu one: vanilla's
//     ranking variant doesn't reach the right edge in widescreen,
//   * the champion ghost goes through vanilla's flow: page 0xAC saves it into the license's
//     downloaded-ghost group (MKW-SP sizes it to 0 slots; the vanilla 32 are restored, and the save
//     stays in memory: no RKSYS write) and opens 0xAD. 0xAD's buttons lead to vanilla sections
//     MKW-SP repurposed, so they copy the champion (left by the runtime in CHAMPION_SLOT) into ghost
//     buffer 0, run MKW-SP's GhostManagerPage::setupTimeAttack() and change to its time trial /
//     ghost replay sections. MKW-SP's ghost loader (SaveManager::loadGhosts) also runs during those
//     section changes and would reload ghost 0 from the SD card: the runtime marks the time trial's
//     ghost 0 as the champion (GlobalContext::m_timeAttackGhostIndices[0] = 'MKLB'), and the loader
//     then copies the slot instead. Choosing ghosts in MKW-SP's own lists overwrites the mark.
const { decode } = require('./ppc.js');

// Block appended to the Kamek blob after the kill feed data block: u32 size, 0x1C spare, then the
// uncompressed champion RKG (0x2800), written by the runtime, then 0x100 bytes of scratch (the
// runtime builds a Text::Info there for the top-10 ghost title). Must match kChampionSlot /
// kTextInfo in runtime/src/mkwlb_rankings.cpp.
const CHAMPION_SLOT = 0x81962DA0, CHAMPION_SLOT_SIZE = 0x20 + 0x2800 + 0x100;

// Settings > Rankings. MKW-SP's settings sheets come from 9 categories (SP::ClientSettings
// categoryNames / categoryMessageIds, sized 9, and two "9 categories" loops in UI::SettingsPage).
// The fork adds a 10th, Rankings: both tables are rebuilt with it in a block after the champion
// slot (the five places that load them point there instead) and the loops count 10. The runtime
// (mkwlb_rankings.cpp) turns the Room setting slots 49-53 (which only served the offline mkw-sp.com
// rooms) into Rankings > My Times, Player Names, Category, Continental Region and Sub-Region (in
// that order, the page's) at boot, using the names and message IDs below. Texts are added to the Menu.bmg
// files by tools/rankings-ui.js.
const SETTINGS_BLOCK = CHAMPION_SLOT + CHAMPION_SLOT_SIZE, SETTINGS_BLOCK_SIZE = 0x200;

// The MKW-SP Channel's notification bar: vanilla's Mario Kart Channel message bar (button/ctrl/
// NotifyButton.brctr, variant Notify, in Channel.szs) as the page's fifth child, never selectable, its
// GO capsule hidden; the runtime cycles notifications through it (message `message`: a string argument)
// with the bar's own Visible animations. Block after the settings block: the control's names, the
// MessageInfo the runtime passes (UI::MessageInfo, strings[0] at +0x9C) and the UTF-16 text it points to.
const NOTIFY = {
  block: SETTINGS_BLOCK + SETTINGS_BLOCK_SIZE, size: 0x400,
  control: 0x00, controlName: 'NotifyButton',
  variant: 0x10, variantName: 'Notify',
  info: 0x20,                     // 0xC4 bytes
  panes: 0x100,                   // pane names the runtime writes ("capsul_null", "text", ...)
  text: 0x140, textSize: 0x200,   // UTF-16BE, NUL-terminated
  // 0x340-0x3F8: Settings > Rankings > My Times (RANKINGS_SETTINGS.extra, block 'notify')
  myTimesFlag: 0x3FC,             // u32: 1 = A was pressed on My Times (MY_TIMES_HOOK; the runtime clears it)
  message: 0x2F25,                // "{arg string|0}" (tools/rankings-ui.js)
  child: 4,
};
function notifyBlock() {
  const b = Buffer.alloc(NOTIFY.size);
  b.write(NOTIFY.controlName + '\0', NOTIFY.control, 'latin1');
  b.write(NOTIFY.variantName + '\0', NOTIFY.variant, 'latin1');
  for (const t of RANKINGS_SETTINGS.extra) {   // settings kept here (as settingsBlock() writes the others)
    if (t.block !== 'notify') continue;
    const ta = t.at;
    b.write(t.name + '\0', ta.name, 'latin1');
    let str = ta.valueStrings;
    t.values.forEach((v, k) => {
      b.writeUInt32BE(v.length, ta.valueNames + 8 * k);
      b.writeUInt32BE(NOTIFY.block + str, ta.valueNames + 8 * k + 4);
      b.write(v + '\0', str, 'latin1'); str += v.length + 1;
      b.writeUInt32BE(t.msg.values[k], ta.valueMessages + 4 * k);
      b.writeUInt32BE(t.msg.explanations[k], ta.explanations + 4 * k);
    });
    if (str > NOTIFY.myTimesFlag) throw new Error('rankings: notification block overflow');
  }
  return b;
}
const RANKINGS_SETTINGS = {
  magic: 0x524B5331,            // 'RKS1' at +0x1FC
  category: 9, categoryName: 'Rankings',
  name: 'ContinentalRegion', values: ['Americas', 'Europe', 'Asia', 'Oceania'], defaultValue: 3,
  msg: { category: 0x2F10, title: 0x2F11, values: [0x2F12, 0x2F13, 0x2F14, 0x2F15], explanations: [0x2F16, 0x2F17, 0x2F18, 0x2F19] },
  text: {
    category: 'Rankings', title: 'Continental Region',
    explanations: [
      'Continental rankings show players from North and South America.',
      'Continental rankings show players from Europe and Africa.',
      'Continental rankings show players from Asia and the Middle East.',
      'Continental rankings show players from Australia and New Zealand.',
    ],
  },
  // block layout
  at: { categoryNames: 0x000, categoryMessageIds: 0x050, categoryString: 0x080, name: 0x090, valueNames: 0x0B0, valueMessages: 0x0D0, explanations: 0x0E0, valueStrings: 0x0F0, magic: 0x1FC },
  // Further Rankings settings, each in a Room setting slot (those only served the offline
  // mkw-sp.com rooms): Category = which of the site's boards the rankings show (slot 51, RoomClass),
  // Player Names = the site's player names or the ghosts' own Mii names (slot 50, RoomCourseSelection).
  extra: [{
    name: 'TimeCategory', values: ['No Shortcut', 'Unrestricted'], defaultValue: 0,
    msg: { title: 0x2F1A, values: [0x2F1B, 0x2F1C], explanations: [0x2F1D, 0x2F1E] },
    text: {
      title: 'Category',
      explanations: [
        'Rankings show No Shortcut times.',
        'Rankings show Unrestricted times (shortcuts allowed).',
      ],
    },
    at: { name: 0x110, valueNames: 0x120, valueMessages: 0x130, explanations: 0x138, valueStrings: 0x140 },
  }, {
    name: 'PlayerNames', values: ['Player Name', 'Ghost Mii'], defaultValue: 0,
    msg: { title: 0x2F1F, values: [0x2F20, 0x2F21], explanations: [0x2F22, 0x2F23] },
    text: {
      title: 'Player Names',
      explanations: [
        'Rankings show the names players use on mkwleaderboards.com.',
        'Rankings show the Mii names saved in the players\' ghosts.',
      ],
    },
    at: { name: 0x160, valueNames: 0x170, valueMessages: 0x180, explanations: 0x188, valueStrings: 0x190 },
  }, {
    // Settings > Rankings > My Times: shows whether an mkwleaderboards.com account is linked (the runtime
    // keeps the value); A on it opens the My Times page (MY_TIMES_HOOK). Its data is in the
    // notification block (`block: 'notify'`, offsets from NOTIFY.block), the settings block is full.
    name: 'MyTimes', values: ['Not linked', 'Linked'], defaultValue: 0, block: 'notify',
    msg: { title: 0x2F26, values: [0x2F27, 0x2F28], explanations: [0x2F29, 0x2F2A] },
    text: {
      title: 'My Times',
      explanations: [
        'Press A to log in to your mkwleaderboards.com account.',
        'Press A to see your mkwleaderboards.com account and import your times.',
      ],
    },
    at: { name: 0x340, valueNames: 0x350, valueMessages: 0x360, explanations: 0x368, valueStrings: 0x370 },
  }, {
    // Settings > Rankings > Sub-Region (slot 53, RoomCodeHigh): one of mkwleaderboards.com's
    // sub-regions in place of the Continental Region (its texts then read "Regional"). The runtime
    // writes its names (block 'runtime'); only its texts are here.
    name: 'SubRegion', values: ['Off', 'USA', 'Japan', 'Germany', 'France', 'Canada', 'Spain', 'Italy', 'UK & Ireland', 'Germany & Austria', 'Nordic', 'Benelux', 'Latin America', 'Iberian'], defaultValue: 0, block: 'runtime',
    msg: { title: 0x2F2B, values: [0x2F2C, 0x2F2D, 0x2F2E, 0x2F2F, 0x2F30, 0x2F31, 0x2F32, 0x2F33, 0x2F34, 0x2F35, 0x2F36, 0x2F37, 0x2F38, 0x2F39], explanations: [0x2F3A, 0x2F3B, 0x2F3C, 0x2F3D, 0x2F3E, 0x2F3F, 0x2F40, 0x2F41, 0x2F42, 0x2F43, 0x2F44, 0x2F45, 0x2F46, 0x2F47] },
    text: {
      title: 'Sub-Region',
      explanations: [
        'Regional rankings show the Continental Region.',
        'Regional rankings show players from the USA.',
        'Regional rankings show players from Japan.',
        'Regional rankings show players from Germany.',
        'Regional rankings show players from France.',
        'Regional rankings show players from Canada.',
        'Regional rankings show players from Spain.',
        'Regional rankings show players from Italy.',
        'Regional rankings show players from the UK and Ireland.',
        'Regional rankings show players from Germany and Austria.',
        'Regional rankings show players from the Nordic countries.',
        'Regional rankings show players from Belgium, the Netherlands and Luxembourg.',
        'Regional rankings show players from Latin America.',
        'Regional rankings show players from Spain and Portugal.',
      ],
    },
  }],
};
const CATEGORY_TABLES = { names: 0x80800df0, messageIds: 0x80802188, count: 9 };
const CATEGORY_REFS = [   // lis / addi loading the tables (each lis has no other user)
  { lis: 0x8079783c, lo: 0x80797858, table: 'categoryNames', what: 'SaveManager::saveSPSave' },
  { lis: 0x807e898c, lo: 0x807e89a8, table: 'categoryNames', what: 'ClientSettings::set' },
  { lis: 0x807e8ad8, lo: 0x807e8ae0, table: 'categoryNames', what: 'ClientSettings::set (section names)' },
  { lis: 0x807afc78, lo: 0x807afc84, table: 'categoryMessageIds', what: 'SettingsPage::onCategoryValueChange' },
  { lis: 0x807aff30, lo: 0x807aff38, table: 'categoryMessageIds', what: 'SettingsPage::onCategoryValueChange (one-sheet title)' },
];
const CATEGORY_COUNT_EDITS = [
  { at: 0x807afa8c, was: 0x28080009, now: 0x2808000a, what: 'SettingsPage::getSheetCount' },
  { at: 0x807afb80, was: 0x28070009, now: 0x2807000a, what: 'SettingsPage::getCategoryInfo' },
];

// Esports menu. The MKW-SP Channel page (UI::ServicePackChannelPage: title, Rankings, Back) gets a
// fourth child: an Esports button made at the end of onInit (operator new, then PushButton's ctor,
// insertChild, load with the Rankings button's layout and an "Esports" variant that
// tools/rankings-ui.js adds to button/ctrl/ServicePackChannelButton.brctr). Its handler is a copy of
// the Rankings button's (vtable, page, member function, adjustment) whose function sets ESPORTS.flag
// to 1 and ends the page as a menu change does (Page::startReplace, after the button's press). The
// runtime (mkwlb_rankings.cpp) then brings the same page back as the Esports menu: Page::GetNextPage
// answers the page itself, with Rankings / Esports hidden and the title "Esports", and the standings
// are drawn between the page's bars until B replaces it with the channel again.
const ESPORTS = {
  flag: SETTINGS_BLOCK + 0x1F8,              // u32: 0 channel, 1 opening, 2 Esports menu, 3 closing (runtime)
  variant: SETTINGS_BLOCK + 0x1B0,           // "Esports"
  control: SETTINGS_BLOCK + 0x1B8,           // "ServicePackChannelButton" (the Rankings button's layout)
  message: 0x2F24, text: 'Esports',          // the button's text and the menu's title
  childCount: { at: 0x807ae41c, was: 0x38800003, now: 0x38800005 },   // Page::initChildren(3 -> 5): Esports, notification bar
  site: { at: 0x807ae4f8, expect: 0x7f63db78 },                       // mr r3,r27 after the Back button's handler
};
const GAME = {
  new: 0x80229DCC, insertChild: 0x8060246C, pushButtonLoad: 0x805BD518, setFrontHandler: 0x805BDAC8,
  buttonDelay: 0x805BDF88,      // PushButton::getDelay (f1)
  startReplace: 0x80602488,     // Page::startReplace(anim, delay)
};
const PUSH_BUTTON_SIZE = 0x254;

// Fork functions reached through a pointer (not a direct branch): convert.js lists them among the
// function-entry hints so the translator knows them, and resolves { entryHa / entryLo: name }.
const FORK_ENTRIES = [{
  name: 'esportsButtonFront', what: 'Esports button: open the Esports menu',
  // (r3 = page, r4 = button)
  code: [
    0x9421fff0, 0x7c0802a6, 0x90010014, 0x93e1000c,   // stwu r1,-16(r1); mflr r0; stw r0,20(r1); stw r31,12(r1)
    0x7c7f1b78,                                       // mr   r31,r3
    { w: 0x3cc00000, ha: ESPORTS.flag },              // lis  r6,flag@ha
    0x38000001,                                       // li   r0,1
    { w: 0x90060000, lo: ESPORTS.flag },              // stw  r0,flag@l(r6)
    0x7c832378,                                       // mr   r3,r4
    { w: 0x48000001, rel24: GAME.buttonDelay },       // bl   PushButton::getDelay
    0x7fe3fb78, 0x38800000,                           // mr r3,r31; li r4,0 (Anim::Next)
    { w: 0x48000001, rel24: GAME.startReplace },      // bl   Page::startReplace
    0x80010014, 0x83e1000c, 0x7c0803a6, 0x38210010,   // lwz r0,20(r1); lwz r31,12(r1); mtlr r0; addi r1,r1,16
    0x4e800020,                                       // blr
  ],
}];

// Payload instructions replaced by a branch to `code`; the replaced instruction runs after it and the
// trampoline branches back to at+4.
const PAYLOAD_SITE_HOOKS = [{
  at: ESPORTS.site.at, expect: ESPORTS.site.expect, what: 'ServicePackChannelPage::onInit: Esports button',
  // r31 = page, r28 = "button"; r25 is saved here
  code: [
    0x9421ffe0, 0x7c0802a6, 0x90010024, 0x93210014,   // stwu r1,-32(r1); mflr r0; stw r0,36(r1); stw r25,20(r1)
    0x38600000 | (PUSH_BUTTON_SIZE + 0x10),             // li   r3,button + handler
    { w: 0x48000001, rel24: GAME.new },                 // bl   operator new
    0x7c791b78,                                         // mr   r25,r3
    { w: 0x48000001, pay: 'UI::PushButton::{base ctor}()' },
    0x7fe3fb78, 0x38800003, 0x7f25cb78, 0x38c00000,     // mr r3,r31; li r4,3; mr r5,r25; li r6,0
    { w: 0x48000001, rel24: GAME.insertChild },         // bl   Page::insertChild(page, 3, button, 0)
    0x7f23cb78, 0x7f84e378,                             // mr r3,r25; mr r4,r28 ("button")
    { w: 0x3ca00000, ha: ESPORTS.control }, { w: 0x38a50000, lo: ESPORTS.control },
    { w: 0x3cc00000, ha: ESPORTS.variant }, { w: 0x38c60000, lo: ESPORTS.variant },
    0x38e00001, 0x39000000, 0x39200000,                 // li r7,1; li r8,0; li r9,0
    { w: 0x48000001, rel24: GAME.pushButtonLoad },      // bl   PushButton::load
    0x38990000 | PUSH_BUTTON_SIZE,                      // addi r4,r25,handler
    0x801f08a4, 0x90040000, 0x801f08a8, 0x90040004,     // copy the Rankings handler: vtable, page
    { w: 0x3ca00000, entryHa: 'esportsButtonFront' }, { w: 0x38a50000, entryLo: 'esportsButtonFront' },
    0x90a40008,                                         // stw  r5,8(r4)   member function
    0x801f08b0, 0x9004000c,                             // adjustment
    0x7f23cb78, 0x38a00000,                             // mr r3,r25; li r5,0
    { w: 0x48000001, rel24: GAME.setFrontHandler },     // bl   PushButton::setFrontHandler
    // The notification bar: a PushButton no player can select (flags 0), no handler.
    0x38600000 | PUSH_BUTTON_SIZE,                      // li   r3,button
    { w: 0x48000001, rel24: GAME.new },                 // bl   operator new
    0x7c791b78,                                         // mr   r25,r3
    { w: 0x48000001, pay: 'UI::PushButton::{base ctor}()' },
    0x7fe3fb78, 0x38800000 | NOTIFY.child, 0x7f25cb78, 0x38c00000,   // mr r3,r31; li r4,4; mr r5,r25; li r6,0
    { w: 0x48000001, rel24: GAME.insertChild },         // bl   Page::insertChild(page, 4, bar, 0)
    0x7f23cb78, 0x7f84e378,                             // mr r3,r25; mr r4,r28 ("button")
    { w: 0x3ca00000, ha: NOTIFY.block + NOTIFY.control }, { w: 0x38a50000, lo: NOTIFY.block + NOTIFY.control },
    { w: 0x3cc00000, ha: NOTIFY.block + NOTIFY.variant }, { w: 0x38c60000, lo: NOTIFY.block + NOTIFY.variant },
    0x38e00000, 0x39000000, 0x39200000,                 // li r7,0 (no player); li r8,0; li r9,0
    { w: 0x48000001, rel24: GAME.pushButtonLoad },      // bl   PushButton::load
    0x83210014, 0x80010024, 0x7c0803a6, 0x38210020,     // lwz r25,20(r1); lwz r0,36(r1); mtlr r0; addi r1,r1,32
  ],
}, {
  // MKW-SP's SettingsPage::onSettingControlFront (A on a setting row: on to the next row). On the My
  // Times row (setting 49, UpDownControl id = setting << 16 | row, at +0x20C) it raises the My Times
  // flag instead and returns: the runtime opens the My Times page (login, import).
  at: 0x807af510, expect: 0x9421ffe8, what: 'SettingsPage: A on Settings > Rankings > My Times opens the My Times page',
  code: [
    0xa004020c,                                         // lhz  r0,0x20C(r4)   setting index
    0x2c000031,                                         // cmpwi r0,49 (kMyTimesSettingSlot)
    0x40820014,                                         // bne  original
    { w: 0x3d800000, ha: NOTIFY.block + NOTIFY.myTimesFlag },   // lis r12,flag@ha
    0x39600001,                                         // li   r11,1
    { w: 0x916c0000, lo: NOTIFY.block + NOTIFY.myTimesFlag },   // stw r11,flag@l(r12)
    0x4e800020,                                         // blr
  ],
}, {
  // MKW-SP's DriftSelectPage::onButtonFront: in the challenge sections (0x4F / 0x50) it changes to the
  // time trial (mr r5,r31; mr r3,r27; li r4,0x1F; b requestChangeSection) without vanilla's ghost race
  // setup, and the character select on the way has reset the race's players (the ghost is gone).
  // Set the time trial up again first, with the combo just chosen: player 2 the champion's ghost.
  at: 0x807f8648, expect: 0x7fe5fb78, what: 'DriftSelectPage: the champion challenge sets up the ghost race',
  code: [
    0x9421fff0, 0x7c0802a6, 0x90010014,                 // stwu r1,-16(r1); mflr r0; stw r0,20(r1)
    0x38600001, 0x38800000,                             // li r3,1 (race); li r4,0 (not from a replay)
    { w: 0x48000001, pay: 'UI::GhostManagerPage::setupTimeAttack(bool, bool)' },
    0x80010014, 0x7c0803a6, 0x38210010,                 // lwz r0,20(r1); mtlr r0; addi r1,r1,16
  ],
}];

// The block's contents. readPay reads the original payload, toModule maps a payload address to
// where it is loaded.
function settingsBlock(readPay, toModule) {
  const S = RANKINGS_SETTINGS, at = S.at, b = Buffer.alloc(SETTINGS_BLOCK_SIZE);
  const T = CATEGORY_TABLES;
  for (let k = 0; k < T.count; k++) {
    b.writeUInt32BE(readPay(T.names + 8 * k), at.categoryNames + 8 * k);
    b.writeUInt32BE(toModule(readPay(T.names + 8 * k + 4)), at.categoryNames + 8 * k + 4);
    b.writeUInt32BE(readPay(T.messageIds + 4 * k), at.categoryMessageIds + 4 * k);
  }
  b.writeUInt32BE(S.categoryName.length, at.categoryNames + 8 * S.category);
  b.writeUInt32BE(SETTINGS_BLOCK + at.categoryString, at.categoryNames + 8 * S.category + 4);
  b.writeUInt32BE(S.msg.category, at.categoryMessageIds + 4 * S.category);
  b.write(S.categoryName + '\0', at.categoryString, 'latin1');
  b.write(S.name + '\0', at.name, 'latin1');
  let str = at.valueStrings;
  S.values.forEach((v, k) => {
    b.writeUInt32BE(v.length, at.valueNames + 8 * k);
    b.writeUInt32BE(SETTINGS_BLOCK + str, at.valueNames + 8 * k + 4);
    b.write(v + '\0', str, 'latin1'); str += v.length + 1;
    b.writeUInt32BE(S.msg.values[k], at.valueMessages + 4 * k);
    b.writeUInt32BE(S.msg.explanations[k], at.explanations + 4 * k);
  });
  for (const t of S.extra) {
    if (t.block) continue;   // notifyBlock(), or the runtime's
    const ta = t.at;
    if (str > ta.name) throw new Error('rankings: settings block overflow');
    b.write(t.name + '\0', ta.name, 'latin1');
    str = ta.valueStrings;
    t.values.forEach((v, k) => {
      b.writeUInt32BE(v.length, ta.valueNames + 8 * k);
      b.writeUInt32BE(SETTINGS_BLOCK + str, ta.valueNames + 8 * k + 4);
      b.write(v + '\0', str, 'latin1'); str += v.length + 1;
      b.writeUInt32BE(t.msg.values[k], ta.valueMessages + 4 * k);
      b.writeUInt32BE(t.msg.explanations[k], ta.explanations + 4 * k);
    });
  }
  if (str > ESPORTS.variant - SETTINGS_BLOCK) throw new Error('rankings: settings block overflow');
  b.write('Esports\0', ESPORTS.variant - SETTINGS_BLOCK, 'latin1');
  b.write('ServicePackChannelButton\0', ESPORTS.control - SETTINGS_BLOCK, 'latin1');
  if (ESPORTS.control - SETTINGS_BLOCK + 25 > ESPORTS.flag - SETTINGS_BLOCK) throw new Error('rankings: settings block overflow');
  b.writeUInt32BE(S.magic, at.magic);
  return b;
}

const DROP = [
  ['UI::RankingPage::handleTopTenDownload(float)', 'rankings fork: vanilla top-10 download (page 0xAE)'],
  ['UI::RankingPage::handleGhostDownload(float, unsigned int, unsigned int, int)', 'rankings fork: vanilla champion ghost download (page 0xAC)'],
  ['GhostGroup_ct+0x62', 'rankings fork: vanilla 32 downloaded-ghost slots (page 0xAC keeps the champion there for 0xAD)'],
];

// UI::Section::addPages builds its {section, page} table with immediate stores; the last two
// entries are {ServicePackRankings, SPRankingGhostDownload/SPRankingTopTenDownload}.
const PAGE_EDITS = [
  { at: 0x807f455c, was: 0x38800104, now: 0x388000ae, what: 'li r4,0xAE (top-10 download page)' },
  { at: 0x807f45b4, was: 0x38a00105, now: 0x38a000af, what: 'li r5,0xAF (RankingDetailPage)' },
];
const PAGE_STORES = [{ at: 0x807f4624, w: 0x90810408 }, { at: 0x807f4628, w: 0x90a10410 }];
// UI::Section::addActivePages: the {ServicePackRankings, Obi} entry's section is stored from r9 (181);
// storing r3 (168, no section has that id) there instead drops the entry. Vanilla's layers are added
// by the addActivePages stub below.
const OBI_SECTION_STORE = { at: 0x807f4824, was: 0x91210074, now: 0x90610074, r3From: 0x807f47ac };

const CAN_EXCHANGE_FRIEND_DATA = 0x80656d9c;   // RKNet::Controller::CanExchangeFriendData
const DOWNLOAD_SLOTS_FULL = 0x805e1820;         // GhostManager: every downloaded-ghost slot in use?
const REQUEST_SAVE_GHOST = { at: 0x805e1958, target: 0x80621484 };   // in GhostManager::SaveDownloadedGhost
const NOP = 0x60000000;
// The obi loader for Pages::Menu-style pages (TopMenuOverlay 0xAB is one) picks the bottom bar by page
// ID; for 0xAB it loads ranking/RankingObiBottom, whose white base stops short of the right edge on
// this port's widescreen canvas, leaving the checker over the background. Take the branch for 0x5E /
// 0xCC instead (bg/MenuObiBottom, the bar MKW-SP's own menus use).
// ServerMgr builds the top-10 list from the download plus two records it keeps per course (the
// downloaded champion, and the player's own uploaded run), inserting each one unless an identical
// 84-byte row is already there. The site's top 10 already holds the champion, and the kept record's
// region / flag bytes never match the downloaded row's, so the champion showed up twice. Skip both
// insertions (beq -> b over each block).
const TOP_TEN_MERGES = [
  { at: 0x806699a4, was: 0x418200a8, now: 0x480000a8, load: 0x80038b04, what: 'champion record' },
  { at: 0x80669a60, was: 0x418200a8, now: 0x480000a8, load: 0x80038b58, what: 'own record' },
];
// The Rankings button opens vanilla's CheckRankings prompt (page 0x2B); its Yes button changes to
// vanilla's Rankings section (0x7D). MKW-SP's Rankings section (181) is the one the fork restores,
// so go there instead (the section's sound ID and the section change).
const CHECK_RANKINGS_YES = [
  { at: 0x8085b5a4, was: 0x3860007d, now: 0x386000b5, what: 'sound ID' },
  { at: 0x8085b5d0, was: 0x3880007d, now: 0x388000b5, what: 'section change' },
];
const OVERLAY_OBI_BOTTOM = { at: 0x8084ec94, was: 0x41820034, now: 0x41820010, cmp: 0x8084ec90 };
const LI_R3_1 = 0x38600001, LI_R3_0 = 0x38600000;
// Vanilla code ranges of the three pages (constructor of the page to the next page's code).
const RANGES = [
  [0x8060bd28, 0x8060d294, 'page 0xAE'],
  [0x8060dc20, 0x80610d68, 'page 0xAC'],
];

function applyPayload({ r32, w32, log }) {
  for (const e of PAGE_EDITS) {
    if (r32(e.at) !== e.was) throw new Error('rankings: addPages layout changed at 0x' + e.at.toString(16));
    w32(e.at, e.now);
    log('rankings: addPages', e.what);
  }
  for (const s of PAGE_STORES) if (r32(s.at) !== s.w) throw new Error('rankings: addPages store layout changed');
  // Between each li and its store the code is only addi/li and stw rS,d(r1), none naming that register.
  PAGE_EDITS.forEach((e, k) => {
    const reg = (e.now >>> 21) & 31;
    for (let a = e.at + 4; a < PAGE_STORES[k].at; a += 4) {
      const w = r32(a), op = w >>> 26, rS = (w >>> 21) & 31, rA = (w >>> 16) & 31;
      const ok = (op === 14 || (op === 36 && rA === 1)) && rS !== reg && rA !== reg;
      if (!ok) throw new Error('rankings: unexpected instruction in addPages at 0x' + a.toString(16));
    }
  });
  const cc = ESPORTS.childCount;
  if (r32(cc.at) !== cc.was) throw new Error('rankings: ServicePackChannelPage::onInit changed');
  w32(cc.at, cc.now);
  log('rankings: MKW-SP Channel page has 5 children (Esports button, notification bar)');
  for (const e of CATEGORY_COUNT_EDITS) {
    if (r32(e.at) !== e.was) throw new Error('rankings: settings category loop changed at 0x' + e.at.toString(16));
    w32(e.at, e.now);
    log('rankings:', e.what, 'counts 10 settings categories');
  }
  const o = OBI_SECTION_STORE;
  if (r32(o.at) !== o.was || r32(o.r3From) !== 0x386000a8) throw new Error('rankings: addActivePages layout changed');
  for (let a = o.r3From + 4; a < o.at; a += 4) {
    const w = r32(a), op = w >>> 26;
    if (!(op === 14 || op === 36) || (op === 14 && ((w >>> 21) & 31) === 3)) throw new Error('rankings: r3 changes in addActivePages at 0x' + a.toString(16));
  }
  w32(o.at, o.now);
  log('rankings: addActivePages drops {ServicePackRankings, Obi}');
}

// Kamek Write32 commands on vanilla game code.
function gameWrites(V, log) {
  const out = [];
  for (const [lo, hi, name] of RANGES) {
    for (let a = lo; a < hi; a += 4) {
      const w = V.read32(a), d = decode(w, a);
      if (d.kind === 'b' && d.lk && d.target === CAN_EXCHANGE_FRIEND_DATA) {
        out.push({ abs: a, w: LI_R3_1 });
        log('rankings:', name, 'CanExchangeFriendData call at', '0x' + a.toString(16), '-> li r3,1');
      }
      if (d.kind === 'b' && d.lk && d.target === DOWNLOAD_SLOTS_FULL) {
        out.push({ abs: a, w: LI_R3_0, slots: true });
        log('rankings:', name, 'downloaded-ghost slots check at', '0x' + a.toString(16), '-> li r3,0');
      }
      // lwz rX,328(r3) right after lwz r3,0(r3): currentSection->page(0x50) -> page(0x4F)
      if (((w & 0xfc1fffff) >>> 0) === 0x80030148 && (V.read32(a - 4) >>> 0) === 0x80630000) {
        out.push({ abs: a, w: ((w & 0xffff0000) | 0x144) >>> 0 });
        log('rankings:', name, 'spinner page 0x50 -> 0x4F at', '0x' + a.toString(16));
      }
      // li r4,0x50 feeding Page::AddPageLayer (vtable +0x24): push page 0x4F instead
      if ((w >>> 0) === 0x38800050 && (V.read32(a + 8) >>> 0) === 0x818c0024) {
        out.push({ abs: a, w: 0x3880004f, push: true });
        log('rankings:', name, 'spinner push 0x50 -> 0x4F at', '0x' + a.toString(16));
      }
    }
  }
  const sg = decode(V.read32(REQUEST_SAVE_GHOST.at), REQUEST_SAVE_GHOST.at);
  if (!(sg.kind === 'b' && sg.lk && sg.target === REQUEST_SAVE_GHOST.target)) throw new Error('rankings: SaveDownloadedGhost layout changed');
  log('rankings: downloaded champion ghost stays in memory (no RKSYS save) at', '0x' + REQUEST_SAVE_GHOST.at.toString(16));
  const calls = out.filter(o => o.w === LI_R3_1).length, pushes = out.filter(o => o.push).length;
  const slots = out.filter(o => o.slots).length, spinners = out.length - calls - pushes - slots;
  if (calls !== 6 || spinners !== 12 || pushes !== 4 || slots !== 3)
    throw new Error(`rankings: expected 6 WFC checks, 12 spinner loads, 4 spinner pushes and 3 slot checks, found ${calls}, ${spinners}, ${pushes} and ${slots}`);
  out.push({ abs: REQUEST_SAVE_GHOST.at, w: NOP });
  for (const m of TOP_TEN_MERGES) {
    if (V.read32(m.at) !== m.was || V.read32(m.at - 8) !== m.load) throw new Error('rankings: top-10 merge layout changed at 0x' + m.at.toString(16));
    out.push({ abs: m.at, w: m.now });
    log('rankings: top-10 list skips the kept', m.what, 'at', '0x' + m.at.toString(16));
  }
  for (const c of CHECK_RANKINGS_YES) {
    if (V.read32(c.at) !== c.was) throw new Error('rankings: CheckRankings handler changed at 0x' + c.at.toString(16));
    out.push({ abs: c.at, w: c.now });
    log('rankings: CheckRankings Yes -> ServicePackRankings,', c.what, 'at', '0x' + c.at.toString(16));
  }
  const ob = OVERLAY_OBI_BOTTOM;
  if (V.read32(ob.at) !== ob.was || V.read32(ob.cmp) !== 0x2c0000ab || V.read32(ob.at + 0x10) !== 0x3cc0808b)
    throw new Error('rankings: obi bottom loader layout changed');
  out.push({ abs: ob.at, w: ob.now });
  log('rankings: TopMenuOverlay bottom bar -> bg/MenuObiBottom at', '0x' + ob.at.toString(16));
  return out;
}

// Game-code hooks: convert.js branches from `at` to a trampoline running `code`, then the replaced
// instruction and a branch back to at+4 (or, with `replay: false`, a branch to `back`).
// A code entry is an instruction word, or { w, rel24: game address } (branch into the game),
// { w, pay: payload symbol } (branch into the payload), { w, ha / lo: module address } (high /
// low half of an address in the Kamek blob).
//
// RankingGraph (page 0xA8) only lets the Wii Remote pointer reach its Friend / Continental /
// Worldwide selector; with the D-pad, Down from the course name skips it. At the end of OnInit
// (r31 = page) the course selector's unused Up handler slot gets the area selector's right-arrow
// handler, and the area selector wraps around, so Up on the course name cycles the three rankings.
const COURSE_MANIP = 0x31C + 0x218, AREA_CONTROL = 0xD58, AREA_MANIP = AREA_CONTROL + 0x218;
const HOOKS = [{
  at: 0x80615ba4, expect: 0x387f031c,   // addi r3,r31,796 (after CtrlMenuInstructionText::Load)
  code: [
    0x801f0000 | (AREA_MANIP + 0x58),     // lwz r0,area.manipulator.rightHandler(r31)
    0x901f0000 | (COURSE_MANIP + 0x4C),   // stw r0,course.manipulator.upHandler(r31)
    0x38000001,                           // li  r0,1
    0x981f0000 | (AREA_CONTROL + 0x210),  // stb r0,area.wraps(r31)
  ],
  what: 'RankingGraph: Up on the course name cycles Friend / Continental / Worldwide',
}, {
  // Page 0xAD (champion ghost data). "Start This Race" changes to section 0x4E and "Watch Replay"
  // to 0x32; MKW-SP repurposed both (0x4E is its ghost list). Set up the time trial with MKW-SP's
  // setupTimeAttack() and change to sections it keeps instead: the race goes to 0x4F
  // (SingleChannelLeaderboardChallenge, vanilla's twin of 0x4E: character, vehicle and drift
  // select, whose drift page then starts the time trial 0x1F; MKW-SP's character select goes back
  // from it to ServicePackRankings), the replay to GhostReplay 0x34.
  at: 0x8060d7d8, expect: 0x3880004e, replay: false, back: 0x8060d7ec,
  code: [
    0x9421fff0,                           // stwu r1,-16(r1)
    0x7c0802a6,                           // mflr r0
    0x90010014,                           // stw  r0,20(r1)
    0x3c60809c,                           // lis  r3,0x809C
    0x8063d728,                           // lwz  r3,RaceConfig::s_instance@l(r3)
    0x806317fc,                           // lwz  r3,menuScenario.ghostBuffer(r3)
    { w: 0x3c800000, ha: CHAMPION_SLOT + 0x20 },   // lis  r4,champion@ha
    { w: 0x38840000, lo: CHAMPION_SLOT + 0x20 },   // addi r4,r4,champion@l
    0x38a02800,                           // li   r5,0x2800
    { w: 0x48000001, pay: 'memcpy' },     // bl   memcpy        (champion -> ghost buffer 0)
    0x38600001,                           // li   r3,1          (race)
    0x38800000,                           // li   r4,0          (not from a replay)
    { w: 0x48000001, pay: 'UI::GhostManagerPage::setupTimeAttack(bool, bool)' },
    0x38000000,                           // li   r0,0
    0x90010008,                           // stw  r0,8(r1)
    0xc0210008,                           // lfs  f1,8(r1)      (delay 0.0)
    0x7fe3fb78,                           // mr   r3,r31      (this page)
    0x3880004f,                           // li   r4,0x4f       (SectionId::SingleChannelLeaderboardChallenge)
    0x38a00000,                           // li   r5,0          (Anim::Next)
    { w: 0x48000001, rel24: 0x806024b0 }, // bl   Page::ChangeSectionBySceneChange
    0x80010014,                           // lwz  r0,20(r1)
    0x7c0803a6,                           // mtlr r0
    0x38210010,                           // addi r1,r1,16
  ],
  what: 'ChannelGhostSelected: Start This Race',
}, {
  at: 0x8060d9cc, expect: 0x38800032, replay: false, back: 0x8060d9e0,
  code: [
    0x9421fff0,                           // stwu r1,-16(r1)
    0x7c0802a6,                           // mflr r0
    0x90010014,                           // stw  r0,20(r1)
    0x3c60809c,                           // lis  r3,0x809C
    0x8063d728,                           // lwz  r3,RaceConfig::s_instance@l(r3)
    0x806317fc,                           // lwz  r3,menuScenario.ghostBuffer(r3)
    { w: 0x3c800000, ha: CHAMPION_SLOT + 0x20 },   // lis  r4,champion@ha
    { w: 0x38840000, lo: CHAMPION_SLOT + 0x20 },   // addi r4,r4,champion@l
    0x38a02800,                           // li   r5,0x2800
    { w: 0x48000001, pay: 'memcpy' },     // bl   memcpy        (champion -> ghost buffer 0)
    0x38600000,                           // li   r3,0          (replay)
    0x38800000,                           // li   r4,0          (not from a replay)
    { w: 0x48000001, pay: 'UI::GhostManagerPage::setupTimeAttack(bool, bool)' },
    0x38000000,                           // li   r0,0
    0x90010008,                           // stw  r0,8(r1)
    0xc0210008,                           // lfs  f1,8(r1)      (delay 0.0)
    0x7fc3f378,                           // mr   r3,r30      (this page)
    0x38800034,                           // li   r4,0x34       (SectionId::GhostReplay)
    0x38a00000,                           // li   r5,0          (Anim::Next)
    { w: 0x48000001, rel24: 0x806024b0 }, // bl   Page::ChangeSectionBySceneChange
    0x80010014,                           // lwz  r0,20(r1)
    0x7c0803a6,                           // mtlr r0
    0x38210010,                           // addi r1,r1,16
  ],
  what: 'ChannelGhostSelected: Watch Replay',
}];

// Payload call sites redirected to a stub: the `bl` at `at` (to `target`) calls `code` instead.
// Section::addPages / addActivePages (r28 = section, r30 = section id) call the vanilla function
// first; for ServicePackRankings (181) the stubs then add vanilla's extra pages and layers.
// For ServicePackChannel (180) they add `channelPages` before the vanilla function's, so those
// layers sit under MKW-SP's (the Esports menu's Competitions bars, below the menu bars and the page).
const SP_RANKINGS = 181, SP_CHANNEL = 180;
const ESPORTS_OBI = 0xBB;   // TopMenuOverlay as vanilla's Competitions bars (bg/EventObiTop, EventObiBottom)
function sectionStub(original, add, pages, channelPages = []) {
  const code = [
    0x9421fff0, 0x7c0802a6, 0x90010014,          // stwu r1,-16(r1); mflr r0; stw r0,20(r1)
  ];
  if (channelPages.length) {
    code.push(0x2c1e0000 | SP_CHANNEL);          // cmpwi r30,180
    code.push(0x40820000 | ((channelPages.length * 3 + 1) * 4));   // bne  original
    for (const p of channelPages) code.push(0x7f83e378, 0x38800000 | p, { w: 0x48000001, pay: add });
    code.push(0x7f83e378, 0x7fc4f378);           // mr r3,r28; mr r4,r30 (the call's arguments again)
  }
  code.push(
    { w: 0x48000001, pay: original },            // bl   original
    0x2c1e0000 | SP_RANKINGS,                    // cmpwi r30,181
  );
  code.push(0x40820000 | ((pages.length * 3 + 1) * 4));   // bne  done
  for (const p of pages) code.push(0x7f83e378, 0x38800000 | p, { w: 0x48000001, pay: add });   // mr r3,r28; li r4,p; bl add
  code.push(0x80010014, 0x7c0803a6, 0x38210010, 0x4e800020);   // done: restore lr, return
  return code;
}
const CHAMPION_GHOST_MARK = 0x4D4B4C42;   // 'MKLB' in GlobalContext::m_timeAttackGhostIndices[0]
const PAYLOAD_HOOKS = [{
  // SaveManager::loadGhosts (r27 = menu scenario, r28 = global context) calls loadGhost(i).
  at: 0x807959ac, target: 'System::SaveManager::loadGhost(unsigned int)',
  code: [
    0x2c040000,                                  //  0 cmpwi r4,0
    0x4082004c,                                  //  1 bne   load
    0x801c0514,                                  //  2 lwz   r0,m_timeAttackGhostIndices[0](r28)
    0x3ca00000 | (CHAMPION_GHOST_MARK >>> 16),   //  3 lis   r5,'MK'
    0x60a50000 | (CHAMPION_GHOST_MARK & 0xffff), //  4 ori   r5,r5,'LB'
    0x7c002800,                                  //  5 cmpw  r0,r5
    0x40820038,                                  //  6 bne   load
    0x9421fff0,                                  //  7 stwu  r1,-16(r1)
    0x7c0802a6,                                  //  8 mflr  r0
    0x90010014,                                  //  9 stw   r0,20(r1)
    0x807b0bec,                                  // 10 lwz   r3,ghostBuffer(r27)
    { w: 0x3c800000, ha: CHAMPION_SLOT + 0x20 }, // 11 lis   r4,champion@ha
    { w: 0x38840000, lo: CHAMPION_SLOT + 0x20 }, // 12 addi  r4,r4,champion@l
    0x38a02800,                                  // 13 li    r5,0x2800
    { w: 0x48000001, pay: 'memcpy' },            // 14 bl    memcpy
    0x80010014,                                  // 15 lwz   r0,20(r1)
    0x7c0803a6,                                  // 16 mtlr  r0
    0x38210010,                                  // 17 addi  r1,r1,16
    0x38600001,                                  // 18 li    r3,1
    0x4e800020,                                  // 19 blr
    { w: 0x48000000, pay: 'System::SaveManager::loadGhost(unsigned int)' },   // 20 load: b loadGhost
  ],
  what: 'SaveManager::loadGhosts: ghost 0 marked as the champion comes from the champion slot',
}, {
  at: 0x807f4140, target: 'UI::Section::thunk_replaced_addPages(UI::SectionId)',
  code: sectionStub('UI::Section::thunk_replaced_addPages(UI::SectionId)', 'UI::Section::addPage(UI::PageId)', [0x4e, 0xaa, 0xab, 0xad], [ESPORTS_OBI]),
  what: 'ServicePackRankings also loads YesNoPopup, RankingBack, TopMenuOverlay and ChannelGhostSelected; ServicePackChannel the Competitions bars',
}, {
  at: 0x807f475c, target: 'UI::Section::thunk_replaced_addActivePages(UI::SectionId)',
  code: sectionStub('UI::Section::thunk_replaced_addActivePages(UI::SectionId)', 'UI::Section::addActivePage(UI::PageId)', [0xa7, 0xaa, 0xab], [ESPORTS_OBI]),
  what: 'ServicePackRankings layers: GhostManager, RankingBack, TopMenuOverlay (then Ranking); ServicePackChannel: the Competitions bars first',
}];

// The menu after a time trial: vanilla's is [Retry, Rankings (8), Change Course, Change Character,
// Watch Replay, Quit]; MKW-SP swapped Rankings for its Change Ghost Data (38). The fork keeps MKW-SP's
// buttons and adds Rankings back before Quit (vanilla's handler opens the course's rankings). The
// table is emitted with the fork code; getButtons() returns it (its blr becomes a branch to a stub,
// its lis/addi stay as they are for the relocator) and getButtonCount() returns 7.
const AFTER_TA_MENU = {
  count: { at: 0x807f7d64, was: 0x38600006, now: 0x38600007 },   // UI::AfterTaRaceMenuPage::getButtonCount
  ret: { at: 0x807f7d74, was: 0x4e800020 },                      // UI::AfterTaRaceMenuPage::getButtons: blr
  buttons: [3, 38, 5, 6, 4, 8, 1],
};

module.exports = {
  DROP, applyPayload, gameWrites, HOOKS, PAYLOAD_HOOKS, AFTER_TA_MENU, CHAMPION_SLOT, CHAMPION_SLOT_SIZE,
  SETTINGS_BLOCK, SETTINGS_BLOCK_SIZE, RANKINGS_SETTINGS, CATEGORY_REFS, settingsBlock,
  ESPORTS, FORK_ENTRIES, PAYLOAD_SITE_HOOKS, NOTIFY, notifyBlock,
};
