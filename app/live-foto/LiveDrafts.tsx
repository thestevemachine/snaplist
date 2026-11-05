"use client";
import { useEffect, useRef, useState } from "react";
import { liveRequest, type DraftRow } from "@/lib/live-foto/client";
import { resizeImage } from "@/lib/resize";
import type { CompsSummary, ItemGroup, Photo } from "@/lib/types";

const KEY = "snaplist-live-linked-session";
type Result = {
  draft: DraftRow;
  prepared: Pick<ItemGroup, "listing" | "preparation">;
  usage: ItemGroup["usage"];
  comps?: CompsSummary;
};
export function LiveDrafts({
  groups,
  enabled,
  onImport,
}: {
  groups: ItemGroup[];
  enabled: boolean;
  onImport: (group: ItemGroup, photos: Photo[]) => Promise<void>;
}) {
  const latestImport = useRef(onImport);
  latestImport.current = onImport;
  const [session, setSession] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const value =
      new URLSearchParams(location.search).get("liveSession") ??
      localStorage.getItem(KEY);
    if (value) {
      setSession(value);
      setShow(true);
    }
  }, []);
  useEffect(() => {
    if (!session || !enabled || !show) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let next = 5000;
      try {
        const data = await liveRequest<{ drafts: DraftRow[] }>({
          action: "list",
          session,
        });
        if (active) setRows(data.drafts);
      } catch (e) {
        next = 15000;
        if (active) setMessage((e as Error).message);
      }
      if (active) timer = setTimeout(poll, next);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [session, enabled, show]);

  async function pair() {
    setBusy(true);
    setMessage("");
    try {
      const result = await liveRequest<{ session: string }>({
        action: "pair",
        code: code.trim(),
      });
      setRows([]);
      setSession(result.session);
      setCode("");
      try {
        localStorage.setItem(KEY, result.session);
      } catch {
        /* current page can still use the cookie */
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importDraft(row: DraftRow) {
    setBusy(true);
    setMessage("");
    try {
      const fields = { session, batch: row.batch };
      const result = await liveRequest<Result>({ ...fields, action: "result" });
      const photos: Photo[] = [];
      for (const photo of result.draft.photoIds) {
        const blob = await liveRequest<Blob>(
          { ...fields, action: "image", photo },
          true,
        );
        const variant = await resizeImage(
          new File([blob], `${photo}.jpg`, { type: "image/jpeg" }),
        );
        // Keep the verified JPEG as the publication source, including for close-ups.
        const id = `${row.batch}-${photo}`;
        const reader = new FileReader();
        const uploadData = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        photos.push({
          id,
          mediaType: "image/jpeg",
          data: variant.data,
          previewUrl: variant.previewUrl,
          uploadData,
        });
      }
      // Download may take a while. Reject a result superseded during transfer.
      await liveRequest<Result>({ ...fields, action: "result" });
      const photoIds = photos.map((p) => p.id);
      await latestImport.current(
        {
          id: result.draft.id,
          name: "Brille",
          sku: result.draft.sku,
          photoIds,
          status: "done",
          listing: result.prepared.listing,
          preparation: result.prepared.preparation,
          usage: result.usage,
          evidencePhotoIds: photoIds,
          comps: result.comps,
          compsStatus: result.comps?.ok ? "ready" : "unavailable",
        },
        photos,
      );
      setMessage("Entwurf wurde in Snaplist gespeichert.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section lang="de">
      <button
        type="button"
        className="btn btn-ghost"
        aria-expanded={show}
        onClick={() => setShow(!show)}
      >
        Live-Foto-Entwürfe
      </button>
      {show && (
        <>
          <p>
            Öffne die Sitzung am Handy und erstelle einen Kopplungscode, um
            Entwürfe hier zu übernehmen.
          </p>
          <label>
            Kopplungscode{" "}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
            />
          </label>{" "}
          <button
            type="button"
            onClick={() => void pair()}
            disabled={!enabled || busy || !code.trim()}
          >
            Sitzung koppeln
          </button>
          {message && <p role="status">{message}</p>}
          {session && !rows.length && (
            <p>Für diese Sitzung sind noch keine Entwürfe sichtbar.</p>
          )}
          <ul>
            {rows.map((row) => {
              const imported = groups.some((g) => g.id === row.id);
              return (
                <li key={row.batch}>
                  {row.sku} · Revision {row.revision} ·{" "}
                  {(
                    {
                      queued: "KI wartet",
                      running: "KI arbeitet",
                      succeeded: "Entwurf bereit",
                      failed: "KI fehlgeschlagen",
                    } as Record<string, string>
                  )[row.status] ?? row.status}{" "}
                  {imported ? (
                    <span>
                      Schon in Snaplist · bestehender Entwurf bleibt erhalten
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={!enabled || busy || row.status !== "succeeded"}
                      onClick={() => void importDraft(row)}
                    >
                      Entwurf übernehmen
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
