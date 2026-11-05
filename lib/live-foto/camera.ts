import { MAX_BYTES } from "./policy";
import { resizeImage } from "@/lib/resize";

type Still = new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> };
export async function exposure(
  video: HTMLVideoElement,
  stream: MediaStream,
  zoom = 1,
) {
  const Capture = (window as Window & { ImageCapture?: Still }).ImageCapture;
  if (Capture && zoom === 1) {
    try {
      return await new Capture(stream.getVideoTracks()[0]).takePhoto();
    } catch {
      /* Some camera drivers expose the API but reject still capture. */
    }
  }
  if (!video.videoWidth || !video.videoHeight)
    throw new Error("Kamera ist noch nicht bereit.");
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth / zoom);
  canvas.height = Math.round(video.videoHeight / zoom);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Videobild konnte nicht gelesen werden.");
  ctx.drawImage(
    video,
    (video.videoWidth - canvas.width) / 2,
    (video.videoHeight - canvas.height) / 2,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Aufnahme fehlgeschlagen.")),
      "image/jpeg",
      0.97,
    ),
  );
}

export function jpeg(encoded: string) {
  return new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], {
    type: "image/jpeg",
  });
}

export async function convert(blob: Blob) {
  if (blob.size > 30_000_000) throw new Error("Die Ausgangsdatei ist zu groß.");
  const result = await resizeImage(
    new File([blob], "aufnahme", { type: blob.type }),
  );
  const full = jpeg(result.uploadData);
  const bounded = full.size <= MAX_BYTES ? full : jpeg(result.data);
  return { blob: bounded, thumb: jpeg(result.previewUrl.split(",")[1]) };
}
export function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
