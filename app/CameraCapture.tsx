"use client";
import { useEffect, useRef, useState } from "react";

export function CameraCapture({ remaining, disabled, onCapture }: {
  remaining: number;
  disabled: boolean;
  onCapture: (file: File) => Promise<boolean>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const currentStream = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const capturing = useRef(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);

  function stop() {
    request.current++;
    currentStream.current?.getTracks().forEach(track => track.stop());
    currentStream.current = null;
    setStream(null);
    setOpening(false);
    setReady(false);
  }
  useEffect(() => {
    const pause = () => { if (document.hidden) stop(); };
    const leave = () => stop();
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("pagehide", leave);
    return () => {
      request.current++;
      currentStream.current?.getTracks().forEach(track => track.stop());
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
      setError("Kameravorschau konnte nicht starten. Kamera schließen und erneut öffnen.");
    });
    return () => { element.srcObject = null; };
  }, [stream]);

  async function start() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Direkte Kameraaufnahme ist hier nicht verfügbar. Bitte SNAPLIST in Safari öffnen oder Fotos auswählen.");
      return;
    }
    const id = ++request.current;
    setOpening(true);
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
      });
      if (id !== request.current || document.hidden) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      currentStream.current = next;
      setStream(next);
    } catch (cause) {
      if (id !== request.current) return;
      const name = cause instanceof DOMException ? cause.name : "";
      setError(name === "NotAllowedError"
        ? "Kamerazugriff nicht erlaubt. Erlaube die Kamera für diese Website in Safari oder nutze Fotos auswählen."
        : "Kamera nicht verfügbar. Schließe andere Kamera-Apps und versuche es erneut oder wähle vorhandene Fotos.");
    } finally {
      if (id === request.current) setOpening(false);
    }
  }
  async function capture() {
    const element = video.current;
    if (capturing.current || disabled || remaining < 1 || !ready || !element?.videoWidth || !stream) return;
    capturing.current = true;
    setBusy(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw Error();
      context.drawImage(element, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error()), "image/jpeg", .94));
      const file = new File([blob], `snaplist-${Date.now()}.jpg`, { type: "image/jpeg" });
      if (!await onCapture(file)) throw Error();
      setSaved(value => value + 1);
    } catch {
      setError("Foto konnte nicht gespeichert werden. Bitte erneut auslösen oder vorhandene Fotos auswählen.");
    } finally {
      capturing.current = false;
      setBusy(false);
    }
  }
  return <section className="camera-capture" aria-label="Serienaufnahme">
    {!stream && !opening && <button className="btn btn-ghost" type="button" disabled={disabled || remaining < 1} onClick={() => void start()}>Kamera öffnen · mehrere Fotos aufnehmen</button>}
    {opening && <p role="status">Kamera wird geöffnet…</p>}
    {(stream || opening) && <>
      <video ref={video} autoPlay muted playsInline aria-label="Live-Kamerabild" onCanPlay={() => setReady(true)} />
      <div className="camera-actions">
        <button className="btn" type="button" disabled={!ready || busy || disabled || remaining < 1} onClick={() => void capture()}>{busy ? "Foto wird gespeichert…" : "Foto aufnehmen"}</button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={stop}>Fertig · Kamera schließen</button>
      </div>
      <p aria-live="polite">{saved} Fotos aufgenommen · {remaining > 0 ? "Weitere Fotos direkt aufnehmen." : "Maximale Fotoanzahl erreicht."}</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
