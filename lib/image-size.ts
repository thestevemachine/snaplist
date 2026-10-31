import type { ImageSize } from "./front-measurements";

// Read encoded header sizes only. No decoding, network, image library or model
// call. Browser analysis derivatives are already orientation-normalized.
// Reject EXIF-rotated JPEGs instead of mixing encoded and displayed axes.
export function imageSize(data: string): ImageSize | undefined {
  try {
    const b = Buffer.from(
      data.includes(",") ? data.split(",")[1] : data,
      "base64",
    );
    let width = 0,
      height = 0;
    if (
      b.length >= 24 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      b.toString("ascii", 12, 16) === "IHDR"
    ) {
      width = b.readUInt32BE(16);
      height = b.readUInt32BE(20);
    } else if (b.length >= 12 && b[0] === 255 && b[1] === 216) {
      let p = 2;
      while (p + 4 <= b.length) {
        if (b[p++] !== 255) return;
        while (b[p] === 255) p++;
        const marker = b[p++];
        if (marker === 218 || marker === 217) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const length = b.readUInt16BE(p);
        if (length < 2 || p + length > b.length) return;
        if (
          marker === 225 &&
          b.toString("ascii", p + 2, p + 8) === "Exif\0\0"
        ) {
          const start = p + 8,
            end = p + length;
          const le = b.toString("ascii", start, start + 2) === "II";
          const u16 = (i: number) => {
            if (i < start || i + 2 > end) throw Error();
            return le ? b.readUInt16LE(i) : b.readUInt16BE(i);
          };
          const u32 = (i: number) => {
            if (i < start || i + 4 > end) throw Error();
            return le ? b.readUInt32LE(i) : b.readUInt32BE(i);
          };
          if (
            (!le && b.toString("ascii", start, start + 2) !== "MM") ||
            u16(start + 2) !== 42
          )
            return;
          const dir = start + u32(start + 4),
            count = u16(dir);
          if (count > 256 || dir + 2 + count * 12 > end) return;
          for (let i = 0; i < count; i++) {
            const entry = dir + 2 + i * 12;
            if (
              u16(entry) === 274 &&
              (u16(entry + 2) !== 3 ||
                u32(entry + 4) !== 1 ||
                u16(entry + 8) !== 1)
            )
              return;
          }
        }
        if (
          [
            192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
          ].includes(marker)
        ) {
          if (length < 8) return;
          height = b.readUInt16BE(p + 3);
          width = b.readUInt16BE(p + 5);
        }
        p += length;
      }
    } else if (
      b.length >= 30 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP"
    ) {
      const kind = b.toString("ascii", 12, 16);
      if (kind === "VP8X") {
        // Orientation metadata/animation is deliberately not interpreted.
        if (b[20] & (8 | 2)) return;
        width = 1 + b.readUIntLE(24, 3);
        height = 1 + b.readUIntLE(27, 3);
      } else if (
        kind === "VP8 " &&
        b.subarray(23, 26).equals(Buffer.from([157, 1, 42]))
      ) {
        width = b.readUInt16LE(26) & 16383;
        height = b.readUInt16LE(28) & 16383;
      } else if (kind === "VP8L" && b[20] === 47) {
        const bits = b.readUInt32LE(21);
        width = 1 + (bits & 16383);
        height = 1 + ((bits >>> 14) & 16383);
      }
    }
    if (
      width > 0 &&
      height > 0 &&
      width <= 20000 &&
      height <= 20000 &&
      width * height <= 100_000_000
    )
      return { width, height };
  } catch {
    /* Malformed image: measurements unavailable, analysis still works. */
  }
}
