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

export function frameRotation(video: HTMLVideoElement) {
  if (!navigator.maxTouchPoints || !video.videoWidth || !video.videoHeight)
    return 0;
  const landscape = window.matchMedia("(orientation: landscape)").matches;
  if (landscape === video.videoWidth >= video.videoHeight) return 0;
  // Older iPhones expose the rotation direction through window.orientation.
  const angle = screen.orientation?.angle || Number(window.orientation) || 0;
  // Screen angles are counterclockwise, while CSS and canvas are clockwise.
  return angle === 270 || angle === -90 ? 90 : -90;
}

type Still = new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> };
export async function exposure(
  video: HTMLVideoElement,
  stream: MediaStream,
  zoom = 1,
  rotation = 0,
  aspect?: number,
) {
  const Capture = (window as Window & { ImageCapture?: Still }).ImageCapture;
  if (
    Capture &&
    zoom === 1 &&
    !rotation &&
    !aspect &&
    !navigator.maxTouchPoints
  ) {
    try {
      return await new Capture(stream.getVideoTracks()[0]).takePhoto();
    } catch {
      /* Some camera drivers expose the API but reject still capture. */
    }
  }
  if (!video.videoWidth || !video.videoHeight)
    throw new Error("Kamera ist noch nicht bereit.");
  const canvas = document.createElement("canvas");
  const { videoWidth, videoHeight } = video;
  const width = rotation ? videoHeight : videoWidth;
  const height = rotation ? videoWidth : videoHeight;
  const ratio = aspect && aspect > 0 ? aspect : width / height;
  canvas.width = Math.max(
    1,
    Math.round(Math.min(width, height * ratio) / zoom),
  );
  canvas.height = Math.max(
    1,
    Math.round(Math.min(height, width / ratio) / zoom),
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Videobild konnte nicht gelesen werden.");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(video, -videoWidth / 2, -videoHeight / 2);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Aufnahme fehlgeschlagen.")),
      "image/jpeg",
      0.97,
    ),
  );
}
