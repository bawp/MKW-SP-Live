// Writes a blank 128 MiB FAT32 SD card image (no partition table, the layout Dolphin uses for
// WiiSD.raw). MKW-SP keeps its settings, ghosts and saves on it.
//
//   node make-sd.js <out.raw>
const fs = require('fs');

const SECTOR = 512, TOTAL = 0x40000, RESERVED = 32, FATS = 2, FAT_SECTORS = 0x7F0, ROOT_CLUSTER = 2;
const DATA_START = RESERVED + FATS * FAT_SECTORS;
const CLUSTERS = TOTAL - DATA_START;

const out = process.argv[2];
if (!out) throw new Error('usage: node make-sd.js <out.raw>');
if (fs.existsSync(out)) throw new Error(out + ' already exists');

const boot = Buffer.alloc(SECTOR);
boot.set([0xEB, 0x58, 0x90], 0);
boot.write('MSWIN4.1', 3, 'latin1');
boot.writeUInt16LE(SECTOR, 0x0B);
boot[0x0D] = 1;                                  // sectors per cluster
boot.writeUInt16LE(RESERVED, 0x0E);
boot[0x10] = FATS;
boot[0x15] = 0xF8;                               // fixed disk
boot.writeUInt16LE(63, 0x18);                    // sectors per track
boot.writeUInt16LE(255, 0x1A);                   // heads
boot.writeUInt32LE(TOTAL, 0x20);
boot.writeUInt32LE(FAT_SECTORS, 0x24);
boot.writeUInt32LE(ROOT_CLUSTER, 0x2C);
boot.writeUInt16LE(1, 0x30);                     // FSInfo sector
boot.writeUInt16LE(6, 0x32);                     // backup boot sector
boot[0x40] = 0x80;
boot[0x42] = 0x29;
boot.writeUInt32LE((Date.now() / 1000) >>> 0, 0x43);   // volume serial
boot.write('MKWSP      ', 0x47, 'latin1');
boot.write('FAT32   ', 0x52, 'latin1');
boot.writeUInt16LE(0xAA55, 0x1FE);

const info = Buffer.alloc(SECTOR);
info.writeUInt32LE(0x41615252, 0);
info.writeUInt32LE(0x61417272, 0x1E4);
info.writeUInt32LE(CLUSTERS - 1, 0x1E8);         // free clusters (the root directory uses one)
info.writeUInt32LE(ROOT_CLUSTER + 1, 0x1EC);     // next free
info.writeUInt32LE(0xAA550000, 0x1FC);

const fat = Buffer.alloc(12);
fat.writeUInt32LE(0x0FFFFFF8, 0);
fat.writeUInt32LE(0x0FFFFFFF, 4);
fat.writeUInt32LE(0x0FFFFFFF, 8);                // root directory: one cluster

const fd = fs.openSync(out, 'w');
try {
  fs.ftruncateSync(fd, TOTAL * SECTOR);
  const at = (buf, sector) => fs.writeSync(fd, buf, 0, buf.length, sector * SECTOR);
  at(boot, 0); at(info, 1); at(boot, 6); at(info, 7);
  for (let k = 0; k < FATS; k++) at(fat, RESERVED + k * FAT_SECTORS);
} finally {
  fs.closeSync(fd);
}
console.log('blank SD card written:', out);
