"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import {
  applyCameraZoom,
  exposure,
  frameRotation,
  openCameraStream,
  readCameraZoom,
} from "@/lib/camera";

export function CameraCapture({
  remaining,
  disabled,
  onCapture,
  onFinishArticle,
  onClose,
  draftProgress,
  articleLabel = "Brille",
}: {
  articleLabel?: string;
  remaining: number;
  disabled: boolean;
  onCapture: (file: File) => Promise<string | undefined>;
  onFinishArticle: (photoIds: string[]) => boolean;
  onClose: () => void;
  draftProgress?: { ready: number; total: number };
}) {
  const video = useRef<HTMLVideoElement>(null);
  const currentStream = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const capturing = useRef(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(false);
  const [ready, setReady] = useState(false);
  const [orientation, setOrientation] = useState<{
    rotation: number;
    landscape: boolean;
    previewWidth: number;
    previewHeight: number;
  }>();
  const frame = useRef<HTMLDivElement>(null);

  function updateOrientation() {
    const element = video.current;
    if (!element?.videoWidth) return;
    const rotation = frameRotation(element);
    const width = frame.current?.clientWidth ?? 0;
    const height = frame.current?.clientHeight ?? 0;
    const landscape =
      fullscreen && width && height
        ? width >= height
        : rotation
          ? element.videoHeight >= element.videoWidth
          : element.videoWidth >= element.videoHeight;
    const scale = Math.min((rotation ? height : width) / element.videoWidth, (rotation ? width : height) / element.videoHeight);
    const previewWidth = element.videoWidth * scale;
    const previewHeight = element.videoHeight * scale;
    setOrientation((old) =>
      old?.rotation === rotation && old.landscape === landscape && old.previewWidth === previewWidth && old.previewHeight === previewHeight
        ? old
        : { rotation, landscape, previewWidth, previewHeight },
    );
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const articlePhotos = useRef<string[]>([]);
  const [articleCount, setArticleCount] = useState(0);

  function finishArticle() {
    if (capturing.current || !articlePhotos.current.length) return;
    if (!onFinishArticle(articlePhotos.current)) {
      setError(`Für diesen Artikel sind keine neuen Fotos mehr verfügbar.`);
      return;
    }
    articlePhotos.current = [];
    setArticleCount(0);
    setError("");
  }

  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cameraZoom, setCameraZoom] = useState(1);
  const [settledZoom, setSettledZoom] = useState(1);
  const [supportsZoom, setSupportsZoom] = useState(false);
  const zoomWork = useRef(Promise.resolve());
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const crop = Math.max(1, zoom / cameraZoom);
  const adjusting = supportsZoom && settledZoom !== zoom;

  function distance() {
    const [a, b] = fingers.current.values();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  function moveFinger(event: PointerEvent) {
    if (
      !fingers.current.has(event.pointerId) ||
      !pinch.current ||
      capturing.current
    )
      return;
    fingers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const value = (pinch.current.zoom * distance()) / pinch.current.distance;
    setZoom(Math.max(1, Math.min(3, Math.round(value * 10) / 10)));
  }

  function releaseFinger(event: PointerEvent) {
    if (fingers.current.delete(event.pointerId)) pinch.current = null;
  }

  useEffect(() => {
    if (!fullscreen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!stream || !supportsZoom) return;
    const track = stream.getVideoTracks()[0];
    let current = true;
    const timer = window.setTimeout(() => {
      zoomWork.current = zoomWork.current
        .then(async () => {
          if (!current) return;
          const actual = await applyCameraZoom(track, zoom);
          if (current) {
            setCameraZoom(actual);
            setSettledZoom(zoom);
          }
        })
        .catch(() => {
          if (current) setSettledZoom(zoom);
        });
    }, 60);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [stream, supportsZoom, zoom]);

  function stop() {
    setFullscreen(false);
    fingers.current.clear();
    pinch.current = null;
    request.current++;
    currentStream.current?.getTracks().forEach((track) => track.stop());
    currentStream.current = null;
    setStream(null);
    setOpening(false);
    setReady(false);
    setOrientation(undefined);
  }
  useEffect(() => {
    const pause = () => {
      if (document.hidden) stop();
    };
    const leave = () => stop();
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("pagehide", leave);
    return () => {
      request.current++;
      currentStream.current?.getTracks().forEach((track) => track.stop());
      currentStream.current = null;
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("pagehide", leave);
    };
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element || !stream) return;
    element.srcObject = stream;
    void element.play().catch(() => {
      setError(
        "Kameravorschau konnte nicht starten. Kamera schließen und erneut öffnen.",
      );
    });
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (!stream) return;
    const observer = new ResizeObserver(updateOrientation);
    if (frame.current) observer.observe(frame.current);
    const media = window.matchMedia("(orientation: landscape)");
    media.addEventListener("change", updateOrientation);
    const screenOrientation = screen.orientation;
    screenOrientation?.addEventListener("change", updateOrientation);
    window.addEventListener("orientationchange", updateOrientation);
    updateOrientation();
    return () => {
      observer.disconnect();
      media.removeEventListener("change", updateOrientation);
      screenOrientation?.removeEventListener("change", updateOrientation);
      window.removeEventListener("orientationchange", updateOrientation);
    };
  }, [stream, fullscreen]);

  async function start(openFullscreen = false) {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Direkte Kameraaufnahme ist hier nicht verfügbar. Bitte SNAPLIST in Safari öffnen oder Fotos auswählen.",
      );
      return;
    }
    const id = ++request.current;
    setOpening(true);
    try {
      const next = await openCameraStream();
      if (id !== request.current || document.hidden) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = next.getVideoTracks()[0];
      const range = (
        track.getCapabilities?.() as
          { zoom?: { min: number; max: number } } | undefined
      )?.zoom;
      setSupportsZoom(Boolean(range && range.max > range.min));
      setZoom(1);
      setSettledZoom(1);
      setCameraZoom(readCameraZoom(track));
      currentStream.current = next;
      setStream(next);
      setFullscreen(openFullscreen);
    } catch (cause) {
      if (id !== request.current) return;
      const name = cause instanceof DOMException ? cause.name : "";
      setError(
        name === "NotAllowedError"
          ? "Kamerazugriff nicht erlaubt. Erlaube die Kamera für diese Website in Safari oder nutze Fotos auswählen."
          : "Kamera nicht verfügbar. Schließe andere Kamera-Apps und versuche es erneut oder wähle vorhandene Fotos.",
      );
    } finally {
      if (id === request.current) setOpening(false);
    }
  }
  async function capture() {
    const element = video.current;
    if (
      capturing.current ||
      disabled ||
      adjusting ||
      remaining < 1 ||
      !ready ||
      !element?.videoWidth ||
      !stream
    )
      return;
    capturing.current = true;
    setBusy(true);
    setError("");
    try {
      const rotation = frameRotation(element);
      const aspect = rotation ? element.videoHeight / element.videoWidth : element.videoWidth / element.videoHeight;
      const blob = await exposure(
        element,
        stream,
        crop,
        rotation,
        aspect,
      );
      const file = new File([blob], `snaplist-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      const photoId = await onCapture(file);
      if (!photoId) throw Error();
      articlePhotos.current.push(photoId);
      setArticleCount(articlePhotos.current.length);
      setSaved((value) => value + 1);
    } catch {
      setError(
        "Foto konnte nicht gespeichert werden. Bitte erneut auslösen oder vorhandene Fotos auswählen.",
      );
    } finally {
      capturing.current = false;
      setBusy(false);
    }
  }
  const shutterLabel = busy ? "Foto wird gespeichert…" : "Foto aufnehmen";
  const shutter = (
    <button
      className="btn camera-shutter"
      type="button"
      aria-label={shutterLabel}
      disabled={!ready || adjusting || busy || disabled || remaining < 1}
      onClick={() => void capture()}
    >
      <span>{shutterLabel}</span>
    </button>
  );
  return (
    <section className="camera-capture" aria-label="Serienaufnahme">
      {!stream && !opening && (
        <div className="camera-entry">
          <button
            className="btn btn-ghost"
            type="button"
            disabled={disabled || remaining < 1}
            onClick={() => void start()}
          >
            Kamera öffnen · mehrere Fotos aufnehmen
          </button>
          <button
            className="btn"
            type="button"
            disabled={disabled || remaining < 1}
            onClick={() => void start(true)}
          >
            Kamera im Vollbild öffnen
          </button>
        </div>
      )}
      {opening && <p role="status">Kamera wird geöffnet…</p>}
      {stream && (
        <div
          className={
            fullscreen
              ? "camera-viewfinder camera-fullscreen"
              : "camera-viewfinder"
          }
        >
          <div
            className="camera-preview"
            onPointerDown={(event) => {
              if (event.pointerType !== "touch" || fingers.current.size >= 2)
                return;
              fingers.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
              });
              const initial = distance();
              if (initial > 0) pinch.current = { distance: initial, zoom };
            }}
            onPointerMove={moveFinger}
            onPointerUp={releaseFinger}
            onPointerCancel={releaseFinger}
          >
            <div ref={frame} className="camera-frame">
              {orientation && (
                <span className="camera-orientation" role="status">
                  {orientation.landscape ? "Querformat" : "Hochformat"}
                </span>
              )}
              <video
                ref={video}
                autoPlay
                muted
                playsInline
                aria-label="Live-Kamerabild"
                onResize={updateOrientation}
                onCanPlay={() => {
                  setReady(true);
                  updateOrientation();
                }}
                className={
                  orientation?.rotation ? "camera-video-rotated" : undefined
                }
                style={
                  fullscreen
                    ? {
                        width: orientation?.previewWidth || undefined,
                        height: orientation?.previewHeight || undefined,
                        objectFit: "contain",
                        transform: `rotate(${orientation?.rotation ?? 0}deg) scale(${crop})`,
                        clipPath: `inset(${(1 - 1 / crop) * 50}%)`,
                      }
                    : {
                        transform: `scale(${crop})`,
                        clipPath: `inset(${(1 - 1 / crop) * 50}%)`,
                      }
                }
              />
              {fullscreen && shutter}
            </div>
          </div>
          <div className="camera-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setFullscreen(!fullscreen)}
            >
              {fullscreen ? "Vollbild verlassen" : "Vollbild"}
            </button>
            <label className="camera-zoom">
              {crop > 1.01
                ? "Digitalzoom"
                : cameraZoom > 1
                  ? "Kamerazoom"
                  : "Zoom"}{" "}
              · {zoom.toFixed(1)}×
              <input
                aria-label="Kamera-Zoom"
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                disabled={busy}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                stop();
                onClose();
              }}
            >
              Fertig · Kamera schließen
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy || disabled || !articleCount}
              onClick={finishArticle}
            >
              {articleLabel} fertig → nächste
            </button>
            {!fullscreen && shutter}
            {draftProgress && (
              <p role="status">
                {draftProgress.ready} von {draftProgress.total} Entwürfen fertig
              </p>
            )}
            <p aria-live="polite">
              {saved} Fotos aufgenommen ·{" "}
              {remaining > 0
                ? "Weitere Fotos direkt aufnehmen."
                : "Maximale Fotoanzahl erreicht."}
            </p>
            {error && <p role="alert">{error}</p>}
          </div>
        </div>
      )}
      {!stream && error && <p role="alert">{error}</p>}
    </section>
  );
}
