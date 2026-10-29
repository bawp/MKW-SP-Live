// Kill feed constants shared by convert.js (data block in Code.pul) and killfeed-messages.js
// (texts in contents.arc). The runtime side is sandbox/BuildWorkspace/runtime/src/kill_feed.cpp,
// which hardcodes DATA_ADDR and checks DATA_MAGIC before using the block.
module.exports = {
  DATA_MAGIC: 0x4B464431,       // 'KFD1'
  DATA_ADDR: 0x81962D80,        // where convert.js places the block (module base + aligned blob end)
  NAME: 'KillFeed',             // settings.ini key, [Race] section
  MSG_TITLE: 0x2F00,
  MSG_EXPL_DISABLE: 0x2F01,
  MSG_EXPL_ENABLE: 0x2F02,
  TEXT: {
    title: 'Kill Feed',
    disable: 'Hide the kill feed during races.',
    enable: 'Show item hits in the top-right corner.',
  },
};
