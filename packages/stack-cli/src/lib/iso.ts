// Minimal ISO 9660 + Joliet writer used to package the runtime config blob
// that the emulator VM mounts at boot via /dev/disk/by-label/STACKCFG.
//
// Replaces the host-side dependency on hdiutil/mkisofs/genisoimage. Only the
// subset of ECMA-119 needed for a single-level root directory of small UTF-8
// text files is implemented: PVD + Joliet SVD + path tables + root dir + file
// data. Names are emitted in both ISO 9660 ("BASE.ENV;1") and Joliet
// (lower-case UCS-2) form so Linux mounts the Joliet view by default and the
// guest's `source /mnt/stack-runtime/runtime.env` works unchanged.

import { writeFileSync } from "fs";

const SECTOR = 2048;

function bothEndian32(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(n, 0);
  b.writeUInt32BE(n, 4);
  return b;
}

function bothEndian16(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt16LE(n, 0);
  b.writeUInt16BE(n, 2);
  return b;
}

function padString(s: string, len: number, fill = " "): Buffer {
  const buf = Buffer.alloc(len, fill.charCodeAt(0));
  buf.write(s.slice(0, len), 0, "ascii");
  return buf;
}

function ucs2BE(s: string): Buffer {
  const buf = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    buf.writeUInt16BE(s.charCodeAt(i), i * 2);
  }
  return buf;
}

function padUcs2BE(s: string, byteLen: number): Buffer {
  const buf = Buffer.alloc(byteLen);
  const wholeChars = Math.floor(byteLen / 2);
  for (let i = 0; i < wholeChars; i++) {
    buf.writeUInt16BE(i < s.length ? s.charCodeAt(i) : 0x0020, i * 2);
  }
  // Odd-length fields (e.g. 37-byte Copyright/Abstract/Bibliographic IDs) get
  // a trailing space byte; spec allows either NUL or 0x20 padding.
  if (byteLen % 2 === 1) {
    buf[byteLen - 1] = 0x20;
  }
  return buf;
}

function dirRecordingDate(d: Date): Buffer {
  const buf = Buffer.alloc(7);
  buf[0] = d.getUTCFullYear() - 1900;
  buf[1] = d.getUTCMonth() + 1;
  buf[2] = d.getUTCDate();
  buf[3] = d.getUTCHours();
  buf[4] = d.getUTCMinutes();
  buf[5] = d.getUTCSeconds();
  buf[6] = 0;
  return buf;
}

function volumeDate(d: Date): Buffer {
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  const s =
    pad(d.getUTCFullYear(), 4) +
    pad(d.getUTCMonth() + 1, 2) +
    pad(d.getUTCDate(), 2) +
    pad(d.getUTCHours(), 2) +
    pad(d.getUTCMinutes(), 2) +
    pad(d.getUTCSeconds(), 2) +
    "00";
  const buf = Buffer.alloc(17);
  buf.write(s, 0, 16, "ascii");
  buf[16] = 0;
  return buf;
}

const UNUSED_VOLUME_DATE = (() => {
  const buf = Buffer.alloc(17, "0".charCodeAt(0));
  buf[16] = 0;
  return buf;
})();

// Encodes an ISO 9660 file identifier ("FILENAME.EXT;1"). Caller must pass an
// already-uppercased 8.3 name without the version suffix.
function isoFileIdentifier(name: string): Buffer {
  const upper = name.toUpperCase();
  return Buffer.from(`${upper};1`, "ascii");
}

// Builds a single directory record. `idBytes` is the file identifier bytes
// (ASCII for ISO, UCS-2 BE for Joliet); `idForDot` overrides with a single
// 0x00 / 0x01 byte for "." / ".." entries.
function buildDirRecord(
  extentSector: number,
  dataLength: number,
  isDir: boolean,
  recDate: Buffer,
  idBytes: Buffer,
): Buffer {
  const lenFi = idBytes.length;
  const pad = lenFi % 2 === 0 ? 1 : 0;
  const lenDr = 33 + lenFi + pad;
  const buf = Buffer.alloc(lenDr);
  buf[0] = lenDr;
  buf[1] = 0;
  bothEndian32(extentSector).copy(buf, 2);
  bothEndian32(dataLength).copy(buf, 10);
  recDate.copy(buf, 18);
  buf[25] = isDir ? 0x02 : 0x00;
  buf[26] = 0;
  buf[27] = 0;
  bothEndian16(1).copy(buf, 28);
  buf[32] = lenFi;
  idBytes.copy(buf, 33);
  return buf;
}

function buildRootDirEntries(
  rootSector: number,
  rootSize: number,
  recDate: Buffer,
  files: { idBytes: Buffer, sector: number, size: number }[],
): Buffer {
  const records: Buffer[] = [];
  records.push(buildDirRecord(rootSector, rootSize, true, recDate, Buffer.from([0x00])));
  records.push(buildDirRecord(rootSector, rootSize, true, recDate, Buffer.from([0x01])));
  for (const f of files) {
    records.push(buildDirRecord(f.sector, f.size, false, recDate, f.idBytes));
  }

  // Records may not span sector boundaries; pack them with sector padding.
  const sectors: Buffer[] = [];
  let current = Buffer.alloc(0);
  for (const r of records) {
    if (current.length + r.length > SECTOR) {
      sectors.push(Buffer.concat([current, Buffer.alloc(SECTOR - current.length)]));
      current = Buffer.alloc(0);
    }
    current = Buffer.concat([current, r]);
  }
  if (current.length > 0) {
    sectors.push(Buffer.concat([current, Buffer.alloc(SECTOR - current.length)]));
  }
  return Buffer.concat(sectors);
}

// Single-entry path table for the root directory. Used for both L (LE) and M
// (BE) tables; pass writeUInt32LE/BE accordingly.
function buildPathTable(rootSector: number, byteOrder: "LE" | "BE"): Buffer {
  const buf = Buffer.alloc(10);
  buf[0] = 1; // LEN_DI
  buf[1] = 0; // EAR length
  if (byteOrder === "LE") {
    buf.writeUInt32LE(rootSector, 2);
    buf.writeUInt16LE(1, 6);
  } else {
    buf.writeUInt32BE(rootSector, 2);
    buf.writeUInt16BE(1, 6);
  }
  buf[8] = 0; // root identifier
  buf[9] = 0; // pad
  return buf;
}

function padToSector(buf: Buffer): Buffer {
  const rem = buf.length % SECTOR;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(SECTOR - rem)]);
}

// Build a Volume Descriptor (PVD or Joliet SVD). `joliet` switches volume-name
// fields to UCS-2 BE and sets the Joliet escape sequence.
function buildVolumeDescriptor(opts: {
  joliet: boolean,
  volumeId: string,
  volumeSpaceSize: number,
  pathTableSize: number,
  lPathSector: number,
  mPathSector: number,
  rootDirRecord: Buffer,
  date: Buffer,
}): Buffer {
  const buf = Buffer.alloc(SECTOR);
  buf[0] = opts.joliet ? 2 : 1;
  buf.write("CD001", 1, 5, "ascii");
  buf[6] = 1;
  buf[7] = 0;

  // System Identifier (32 bytes)
  if (opts.joliet) {
    padUcs2BE("", 32).copy(buf, 8);
  } else {
    padString("", 32).copy(buf, 8);
  }

  // Volume Identifier (32 bytes) — must be "STACKCFG" so udev exposes it as
  // /dev/disk/by-label/STACKCFG. blkid reads from PVD by default but Joliet
  // takes precedence when both are present.
  if (opts.joliet) {
    padUcs2BE(opts.volumeId, 32).copy(buf, 40);
  } else {
    padString(opts.volumeId, 32).copy(buf, 40);
  }

  bothEndian32(opts.volumeSpaceSize).copy(buf, 80);

  if (opts.joliet) {
    // Escape sequence for UCS-2 Level 3 ("%/E") at offset 88 (32 bytes).
    buf[88] = 0x25;
    buf[89] = 0x2f;
    buf[90] = 0x45;
  }

  bothEndian16(1).copy(buf, 120); // Volume Set Size
  bothEndian16(1).copy(buf, 124); // Volume Sequence Number
  bothEndian16(SECTOR).copy(buf, 128); // Logical Block Size
  bothEndian32(opts.pathTableSize).copy(buf, 132);
  buf.writeUInt32LE(opts.lPathSector, 140);
  buf.writeUInt32LE(0, 144); // optional L
  buf.writeUInt32BE(opts.mPathSector, 148);
  buf.writeUInt32BE(0, 152); // optional M

  opts.rootDirRecord.copy(buf, 156);

  const padFn = opts.joliet
    ? (s: string, n: number) => padUcs2BE(s, n)
    : (s: string, n: number) => padString(s, n);

  padFn("", 128).copy(buf, 190); // Volume Set Identifier
  padFn("", 128).copy(buf, 318); // Publisher Identifier
  padFn("", 128).copy(buf, 446); // Data Preparer Identifier
  padFn("", 128).copy(buf, 574); // Application Identifier
  padFn("", 37).copy(buf, 702); // Copyright File Identifier
  padFn("", 37).copy(buf, 739); // Abstract File Identifier
  padFn("", 37).copy(buf, 776); // Bibliographic File Identifier

  opts.date.copy(buf, 813); // Creation
  opts.date.copy(buf, 830); // Modification
  UNUSED_VOLUME_DATE.copy(buf, 847); // Expiration
  UNUSED_VOLUME_DATE.copy(buf, 864); // Effective

  buf[881] = 1; // File Structure Version
  return buf;
}

function buildVolumeDescriptorTerminator(): Buffer {
  const buf = Buffer.alloc(SECTOR);
  buf[0] = 0xff;
  buf.write("CD001", 1, 5, "ascii");
  buf[6] = 1;
  return buf;
}

// Builds the 34-byte root directory record that lives inside the volume
// descriptor (BP 157-190 of PVD/SVD). Identical layout to a regular directory
// record but identifier is the single byte 0x00.
function buildRootDirRecordInVD(rootSector: number, rootSize: number, recDate: Buffer): Buffer {
  return buildDirRecord(rootSector, rootSize, true, recDate, Buffer.from([0x00]));
}

export type IsoFile = { name: string, data: Buffer };

export function buildIso(volumeId: string, files: IsoFile[]): Buffer {
  const date = new Date();
  const recDate = dirRecordingDate(date);
  const volDateBuf = volumeDate(date);

  // Compute per-file directory record sizes for both views.
  const isoEntries = files.map((f) => ({
    file: f,
    idBytes: isoFileIdentifier(f.name),
  }));
  const jolietEntries = files.map((f) => ({
    file: f,
    idBytes: ucs2BE(f.name),
  }));

  // We need root sector + size before we know file sectors — but file sectors
  // depend only on the root dir size, which depends only on the file count.
  // Compute the root dir buffer twice if needed (sizes are stable since they
  // depend only on identifier bytes, not on file extents).
  const dirRecLen = (lenFi: number) => 33 + lenFi + (lenFi % 2 === 0 ? 1 : 0);
  const isoRootSize = 34 + 34 + isoEntries.reduce((acc, e) => acc + dirRecLen(e.idBytes.length), 0);
  const jolietRootSize = 34 + 34 + jolietEntries.reduce((acc, e) => acc + dirRecLen(e.idBytes.length), 0);
  if (isoRootSize > SECTOR || jolietRootSize > SECTOR) {
    throw new Error(`Root directory exceeds ${SECTOR} bytes; multi-sector root not supported.`);
  }

  // Sector layout.
  const sysAreaSectors = 16;
  const pvdSector = sysAreaSectors;
  const svdSector = pvdSector + 1;
  const termSector = svdSector + 1;
  const isoLPathSector = termSector + 1;
  const isoMPathSector = isoLPathSector + 1;
  const jolietLPathSector = isoMPathSector + 1;
  const jolietMPathSector = jolietLPathSector + 1;
  const isoRootSector = jolietMPathSector + 1;
  const jolietRootSector = isoRootSector + 1;
  let nextSector = jolietRootSector + 1;

  const fileLayout = files.map((f) => {
    const sector = nextSector;
    const sectors = Math.max(1, Math.ceil(f.data.length / SECTOR));
    nextSector += sectors;
    return { file: f, sector, size: f.data.length };
  });

  const totalSectors = nextSector;
  const pathTableSize = 10;

  const isoRootDirRecordVD = buildRootDirRecordInVD(isoRootSector, SECTOR, recDate);
  const jolietRootDirRecordVD = buildRootDirRecordInVD(jolietRootSector, SECTOR, recDate);

  const pvd = buildVolumeDescriptor({
    joliet: false,
    volumeId,
    volumeSpaceSize: totalSectors,
    pathTableSize,
    lPathSector: isoLPathSector,
    mPathSector: isoMPathSector,
    rootDirRecord: isoRootDirRecordVD,
    date: volDateBuf,
  });

  const svd = buildVolumeDescriptor({
    joliet: true,
    volumeId,
    volumeSpaceSize: totalSectors,
    pathTableSize,
    lPathSector: jolietLPathSector,
    mPathSector: jolietMPathSector,
    rootDirRecord: jolietRootDirRecordVD,
    date: volDateBuf,
  });

  const term = buildVolumeDescriptorTerminator();
  const isoLPath = padToSector(buildPathTable(isoRootSector, "LE"));
  const isoMPath = padToSector(buildPathTable(isoRootSector, "BE"));
  const jolietLPath = padToSector(buildPathTable(jolietRootSector, "LE"));
  const jolietMPath = padToSector(buildPathTable(jolietRootSector, "BE"));

  const isoRoot = buildRootDirEntries(
    isoRootSector,
    SECTOR,
    recDate,
    isoEntries.map((e, i) => ({
      idBytes: e.idBytes,
      sector: fileLayout[i].sector,
      size: fileLayout[i].size,
    })),
  );
  const jolietRoot = buildRootDirEntries(
    jolietRootSector,
    SECTOR,
    recDate,
    jolietEntries.map((e, i) => ({
      idBytes: e.idBytes,
      sector: fileLayout[i].sector,
      size: fileLayout[i].size,
    })),
  );

  // Each file must occupy the exact number of sectors the layout reserved for
  // it. An empty file reserves 1 sector (via Math.max(1, …)) but
  // padToSector(Buffer.alloc(0)) returns 0 bytes — that would desync every
  // subsequent file's extent. Explicitly pad to the reserved size instead.
  const fileBuffers = fileLayout.map((f) => {
    const reservedSectors = Math.max(1, Math.ceil(f.file.data.length / SECTOR));
    const reservedBytes = reservedSectors * SECTOR;
    if (f.file.data.length === reservedBytes) return f.file.data;
    const out = Buffer.alloc(reservedBytes);
    f.file.data.copy(out, 0);
    return out;
  });

  return Buffer.concat([
    Buffer.alloc(sysAreaSectors * SECTOR),
    pvd,
    svd,
    term,
    isoLPath,
    isoMPath,
    jolietLPath,
    jolietMPath,
    isoRoot,
    jolietRoot,
    ...fileBuffers,
  ]);
}

export function writeIso(path: string, volumeId: string, files: IsoFile[]): void {
  const buf = buildIso(volumeId, files);
  writeFileSync(path, buf);
}
