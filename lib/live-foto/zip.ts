// Store already-compressed JPEGs without recompressing them.
const table = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
export async function photoZip(entries: { name: string; blob: Blob }[]) {
  if (!entries.length || entries.length > 300)
    throw new Error("Bitte höchstens 300 Fotos pro Export wählen.");
  const body: BlobPart[] = [],
    directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    let crc = -1;
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    const file = new Uint8Array(30 + name.length),
      central = new Uint8Array(46 + name.length);
    const f = new DataView(file.buffer),
      c = new DataView(central.buffer);
    f.setUint32(0, 0x04034b50, true);
    c.setUint32(0, 0x02014b50, true);
    f.setUint16(4, 20, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    f.setUint16(6, 0x800, true);
    c.setUint16(8, 0x800, true);
    f.setUint16(12, 33, true);
    c.setUint16(14, 33, true);
    f.setUint32(14, ~crc, true);
    c.setUint32(16, ~crc, true);
    f.setUint32(18, bytes.length, true);
    f.setUint32(22, bytes.length, true);
    c.setUint32(20, bytes.length, true);
    c.setUint32(24, bytes.length, true);
    f.setUint16(26, name.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    file.set(name, 30);
    central.set(name, 46);
    body.push(file, entry.blob);
    directory.push(central);
    offset += file.length + bytes.length;
  }
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(
    12,
    directory.reduce((n, p) => n + p.length, 0),
    true,
  );
  e.setUint32(16, offset, true);
  return new Blob([...body, ...directory, end], { type: "application/zip" });
}
