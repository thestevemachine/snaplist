// Keep identical photo bytes and order for normal analyses and comparisons.
export function analysisImages(
  photos: { mediaType: string; data: string; uploadData?: string }[],
) {
  const images = photos.map((p) => ({ mediaType: p.mediaType, data: p.data }));
  const last = photos.at(-1);
  if (
    last?.uploadData &&
    images.slice(0, -1).reduce((n, p) => n + p.data.length, 0) +
      last.uploadData.length <
      4_000_000
  ) {
    images[images.length - 1] = {
      mediaType: "image/jpeg",
      data: last.uploadData,
    };
  }
  return images;
}
