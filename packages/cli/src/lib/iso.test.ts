import { describe, expect, it } from "vitest";
import { buildIso, type IsoFile } from "./iso.js";

const SECTOR = 2048;

// --- Test helpers: a minimal ISO 9660 parser, just enough to walk the
// directory records we produce so tests can assert the bytes we emitted really
// are addressable at the offsets claimed in the directory records.

function readSector(iso: Buffer, sector: number): Buffer {
  return iso.subarray(sector * SECTOR, (sector + 1) * SECTOR);
}

function readVolumeDescriptor(iso: Buffer, sector: number): { type: number, id: string } {
  const buf = readSector(iso, sector);
  return { type: buf[0], id: buf.toString("ascii", 1, 6) };
}

type DirRecord = {
  lenDr: number,
  extentSector: number,
  dataLength: number,
  isDir: boolean,
  fileId: Buffer,
};

function parseDirRecords(sector: Buffer): DirRecord[] {
  const records: DirRecord[] = [];
  let offset = 0;
  while (offset < sector.length) {
    const lenDr = sector[offset];
    if (lenDr === 0) break;
    const extentSector = sector.readUInt32LE(offset + 2);
    const dataLength = sector.readUInt32LE(offset + 10);
    const flags = sector[offset + 25];
    const lenFi = sector[offset + 32];
    const fileId = sector.subarray(offset + 33, offset + 33 + lenFi);
    records.push({
      lenDr,
      extentSector,
      dataLength,
      isDir: (flags & 0x02) !== 0,
      fileId: Buffer.from(fileId),
    });
    offset += lenDr;
  }
  return records;
}

// Follow PVD → root dir → pull file bytes by ISO-9660 name ("NAME.EXT;1").
function readIsoFile(iso: Buffer, isoName: string): Buffer | null {
  const pvd = readSector(iso, 16);
  const rootSector = pvd.readUInt32LE(156 + 2);
  const rootRecords = parseDirRecords(readSector(iso, rootSector));
  const match = rootRecords.find((r) => r.fileId.toString("ascii") === isoName);
  if (!match) return null;
  const start = match.extentSector * SECTOR;
  return iso.subarray(start, start + match.dataLength);
}

// Same, but follow the Joliet SVD (so names are UCS-2 BE).
function readJolietFile(iso: Buffer, name: string): Buffer | null {
  const svd = readSector(iso, 17);
  if (svd[0] !== 2) return null;
  const rootSector = svd.readUInt32LE(156 + 2);
  const rootRecords = parseDirRecords(readSector(iso, rootSector));
  const expected = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) expected.writeUInt16BE(name.charCodeAt(i), i * 2);
  const match = rootRecords.find((r) => r.fileId.equals(expected));
  if (!match) return null;
  const start = match.extentSector * SECTOR;
  return iso.subarray(start, start + match.dataLength);
}

function sampleFile(name: string, size: number, byte = 0x41): IsoFile {
  return { name, data: Buffer.alloc(size, byte) };
}

describe("buildIso — structural invariants", () => {
  it("emits the ISO 9660 standard identifiers at sectors 16, 17, 18", () => {
    const iso = buildIso("STACKCFG", [{ name: "a.txt", data: Buffer.from("hi") }]);
    expect(readVolumeDescriptor(iso, 16)).toEqual({ type: 1, id: "CD001" });
    expect(readVolumeDescriptor(iso, 17)).toEqual({ type: 2, id: "CD001" });
    expect(readVolumeDescriptor(iso, 18)).toEqual({ type: 0xff, id: "CD001" });
  });

  it("stores the volume identifier verbatim in the PVD for blkid discovery", () => {
    const iso = buildIso("STACKCFG", [{ name: "a.txt", data: Buffer.from("x") }]);
    const pvd = readSector(iso, 16);
    expect(pvd.toString("ascii", 40, 40 + 8)).toBe("STACKCFG");
  });

  it("stores the volume identifier in the Joliet SVD as UCS-2 BE", () => {
    const iso = buildIso("STACKCFG", [{ name: "a.txt", data: Buffer.from("x") }]);
    const svd = readSector(iso, 17);
    const ucs = svd.subarray(40, 40 + 16);
    let decoded = "";
    for (let i = 0; i < ucs.length; i += 2) decoded += String.fromCharCode(ucs.readUInt16BE(i));
    expect(decoded).toBe("STACKCFG");
  });

  it("sets the Joliet escape sequence %/E", () => {
    const iso = buildIso("STACKCFG", [{ name: "a.txt", data: Buffer.from("x") }]);
    const svd = readSector(iso, 17);
    expect(svd[88]).toBe(0x25);
    expect(svd[89]).toBe(0x2f);
    expect(svd[90]).toBe(0x45);
  });

  it("declares a volume space size equal to the emitted sector count", () => {
    const iso = buildIso("STACKCFG", [{ name: "a.txt", data: Buffer.from("hello world") }]);
    const pvd = readSector(iso, 16);
    const declared = pvd.readUInt32LE(80);
    expect(iso.length).toBe(declared * SECTOR);
  });
});

describe("buildIso — file round-trip", () => {
  it("makes files readable by ISO 9660 name", () => {
    const iso = buildIso("STACKCFG", [
      { name: "runtime.env", data: Buffer.from("KEY=value\n") },
      { name: "base.env", data: Buffer.from("FOO=bar\n") },
    ]);
    expect(readIsoFile(iso, "RUNTIME.ENV;1")?.toString()).toBe("KEY=value\n");
    expect(readIsoFile(iso, "BASE.ENV;1")?.toString()).toBe("FOO=bar\n");
  });

  it("makes files readable by Joliet (lowercase) name", () => {
    const iso = buildIso("STACKCFG", [
      { name: "runtime.env", data: Buffer.from("KEY=value\n") },
      { name: "base.env", data: Buffer.from("FOO=bar\n") },
    ]);
    expect(readJolietFile(iso, "runtime.env")?.toString()).toBe("KEY=value\n");
    expect(readJolietFile(iso, "base.env")?.toString()).toBe("FOO=bar\n");
  });

  it("preserves exact file contents byte-for-byte", () => {
    const content = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x41, 0x42, 0x43]);
    const iso = buildIso("STACKCFG", [{ name: "bin.dat", data: content }]);
    expect(readJolietFile(iso, "bin.dat")?.equals(content)).toBe(true);
  });

  it("handles files whose length is exactly one sector", () => {
    const content = Buffer.alloc(SECTOR, 0x37);
    const iso = buildIso("STACKCFG", [{ name: "one.bin", data: content }]);
    expect(readJolietFile(iso, "one.bin")?.equals(content)).toBe(true);
  });

  it("handles files that span multiple sectors", () => {
    const content = Buffer.alloc(SECTOR * 3 + 17, 0x55);
    const iso = buildIso("STACKCFG", [{ name: "big.bin", data: content }]);
    expect(readJolietFile(iso, "big.bin")?.equals(content)).toBe(true);
  });

  it("keeps files byte-exact at the claimed extent sector across multi-file layouts", () => {
    // Fingerprint each file so we can tell them apart even if extents shift.
    const files: IsoFile[] = [
      { name: "alpha.bin", data: Buffer.alloc(SECTOR + 5, 0xaa) },
      { name: "beta.bin", data: Buffer.alloc(SECTOR * 2, 0xbb) },
      { name: "gamma.bin", data: Buffer.alloc(42, 0xcc) },
    ];
    const iso = buildIso("STACKCFG", files);
    for (const f of files) {
      expect(readJolietFile(iso, f.name)?.equals(f.data)).toBe(true);
    }
  });
});

describe("buildIso — edge cases", () => {
  it("handles empty files without misaligning subsequent file extents", () => {
    // Regression: `padToSector(Buffer.alloc(0))` used to return a 0-byte
    // buffer, but the layout reserved 1 sector for the empty file — the next
    // file was then read from the empty file's reserved slot.
    const files: IsoFile[] = [
      { name: "empty.txt", data: Buffer.alloc(0) },
      { name: "after.txt", data: Buffer.from("marker\n") },
    ];
    const iso = buildIso("STACKCFG", files);
    expect(readJolietFile(iso, "empty.txt")?.length).toBe(0);
    expect(readJolietFile(iso, "after.txt")?.toString()).toBe("marker\n");
    // And: the declared volume space size must cover every emitted byte.
    const pvd = readSector(iso, 16);
    expect(iso.length).toBe(pvd.readUInt32LE(80) * SECTOR);
  });

  it("writes the exact file length in the directory record (not padded to sector)", () => {
    const content = Buffer.from("abc");
    const iso = buildIso("STACKCFG", [{ name: "tiny.txt", data: content }]);
    const svd = readSector(iso, 17);
    const rootSector = svd.readUInt32LE(156 + 2);
    const records = parseDirRecords(readSector(iso, rootSector));
    const file = records.find((r) => !r.isDir);
    expect(file?.dataLength).toBe(3);
  });

  it("places the root directory records for . and .. pointing at the root extent", () => {
    const iso = buildIso("STACKCFG", [{ name: "x.txt", data: Buffer.from("1") }]);
    const svd = readSector(iso, 17);
    const rootSector = svd.readUInt32LE(156 + 2);
    const records = parseDirRecords(readSector(iso, rootSector));
    expect(records.length).toBeGreaterThanOrEqual(2);
    expect(records[0].fileId.equals(Buffer.from([0x00]))).toBe(true);
    expect(records[1].fileId.equals(Buffer.from([0x01]))).toBe(true);
    expect(records[0].isDir).toBe(true);
    expect(records[0].extentSector).toBe(rootSector);
    expect(records[1].extentSector).toBe(rootSector);
  });

  it("truncates volume identifiers longer than 32 bytes rather than corrupting the PVD", () => {
    const longId = "A".repeat(64);
    const iso = buildIso(longId, [{ name: "x.txt", data: Buffer.from("1") }]);
    const pvd = readSector(iso, 16);
    expect(pvd.toString("ascii", 40, 40 + 32)).toBe("A".repeat(32));
    // Sector 17 should still be the Joliet SVD, not clobbered.
    expect(pvd[881]).toBe(1);
    expect(readVolumeDescriptor(iso, 17).type).toBe(2);
  });

  it("rejects an input set whose root directory record overflows one sector", () => {
    // Each Joliet dir record for an N-char name is 33 + 2N + (2N even ? 1 : 0)
    // ≈ 2N + 34 bytes. A sector is 2048. Thirty 30-char names → ~1860 bytes
    // plus "." + ".." (68) → fits. Eighty of them → well over a sector.
    const many: IsoFile[] = Array.from({ length: 80 }, (_, i) => ({
      name: `file-${String(i).padStart(3, "0")}-padding-padding.bin`,
      data: Buffer.from("x"),
    }));
    expect(() => buildIso("STACKCFG", many)).toThrow(/Root directory exceeds/);
  });

  it("produces a sector-aligned buffer regardless of file sizes", () => {
    for (const size of [0, 1, SECTOR - 1, SECTOR, SECTOR + 1, SECTOR * 5 - 1]) {
      const iso = buildIso("STACKCFG", [sampleFile("a.bin", size)]);
      expect(iso.length % SECTOR).toBe(0);
    }
  });
});

describe("buildIso — multiple file sector layout", () => {
  it("assigns non-overlapping extents to all files", () => {
    const files: IsoFile[] = [
      sampleFile("a.bin", 10, 0x01),
      sampleFile("b.bin", SECTOR, 0x02),
      sampleFile("c.bin", SECTOR * 2 + 500, 0x03),
      sampleFile("d.bin", 1, 0x04),
    ];
    const iso = buildIso("STACKCFG", files);
    const svd = readSector(iso, 17);
    const rootSector = svd.readUInt32LE(156 + 2);
    const records = parseDirRecords(readSector(iso, rootSector)).filter((r) => !r.isDir);

    // Extents must be strictly ordered and non-overlapping.
    const sorted = [...records].sort((a, b) => a.extentSector - b.extentSector);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const prevEndSector = prev.extentSector + Math.max(1, Math.ceil(prev.dataLength / SECTOR));
      expect(sorted[i].extentSector).toBeGreaterThanOrEqual(prevEndSector);
    }
  });
});
