type ZoomConstraint = MediaTrackConstraints & {
  zoom?: boolean | { exact: number };
};

export async function openCameraStream() {
  const devices = navigator.mediaDevices;
  const video: MediaTrackConstraints = {
    facingMode: { ideal: "environment" },
    width: { ideal: 2560 },
    height: { ideal: 1920 },
  };
  if ((devices.getSupportedConstraints() as { zoom?: boolean }).zoom) {
    try {
      return await devices.getUserMedia({
        audio: false,
        video: { ...video, zoom: true } as ZoomConstraint,
      });
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        ![
          "NotAllowedError",
          "OverconstrainedError",
          "NotSupportedError",
        ].includes(error.name)
      )
        throw error;
    }
  }
  return devices.getUserMedia({ audio: false, video });
}

export function readCameraZoom(track: MediaStreamTrack) {
  const zoom = (track.getSettings() as MediaTrackSettings & { zoom?: number })
    .zoom;
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0
    ? zoom
    : 1;
}

export async function applyCameraZoom(
  track: MediaStreamTrack,
  requested: number,
) {
  const range = (
    track.getCapabilities?.() as
      { zoom?: { min: number; max: number; step?: number } } | undefined
  )?.zoom;
  if (
    !range ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.max <= range.min
  )
    return readCameraZoom(track);
  const step = range.step ?? 0;
  const bounded = Math.min(range.max, Math.max(range.min, requested));
  const target =
    step > 0
      ? Math.min(
          range.max,
          range.min + Math.round((bounded - range.min) / step) * step,
        )
      : bounded;
  if (Math.abs(readCameraZoom(track) - target) < 0.001)
    return readCameraZoom(track);
  try {
    await track.applyConstraints({
      ...track.getConstraints(),
      zoom: { exact: target },
    } as ZoomConstraint);
  } catch {
    // Some browsers grant camera access without granting control of its zoom.
  }
  return readCameraZoom(track);
}

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
