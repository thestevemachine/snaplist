import sharp from "sharp";
import { MAX_BYTES } from "./policy";

export async function cleanJpeg(data: string) {
  if (
    data.length > Math.ceil(MAX_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new Error("Invalid JPEG payload");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > MAX_BYTES || bytes[0] !== 255 || bytes[1] !== 216)
    throw new Error("Invalid JPEG payload");
  const image = sharp(bytes, {
    limitInputPixels: 6_000_000,
    failOn: "warning",
  });
  const meta = await image.metadata();
  if (
    meta.format !== "jpeg" ||
    !meta.width ||
    !meta.height ||
    Math.max(meta.width, meta.height) > 2400
  )
    throw new Error("Invalid JPEG dimensions");
  for (const quality of [92, 84, 76]) {
    const clean = await image
      .clone()
      .rotate()
      .jpeg({ quality, chromaSubsampling: "4:4:4" })
      .toBuffer();
    if (clean.length <= MAX_BYTES) return clean;
  }
  throw new Error("JPEG too large");
}

export async function analysisJpeg(bytes: Buffer) {
  const pipeline = sharp(bytes, { limitInputPixels: 6_000_000 }).resize(
    1600,
    1600,
    {
      fit: "inside",
      withoutEnlargement: true,
    },
  );
  const result = await pipeline.clone().jpeg({ quality: 86 }).toBuffer();
  return result.length <= 650_000
    ? result
    : pipeline.jpeg({ quality: 76 }).toBuffer();
}
