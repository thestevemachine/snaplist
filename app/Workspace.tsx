"use client";
import {measureLocal} from "@/lib/cv-client";
import {cvCandidate} from "@/lib/cv-queue";
import {cvKey,keepCvMeasurement} from "@/lib/cv-measurement";
import {frontMeasurementFields} from "@/lib/front-measurement-fields";
import {workspaceStorageKey} from "@/lib/workspace-scope";
import {assignPhotoSkus} from "@/lib/sku-photo-markers";
import {publicationSpecifics} from "@/lib/publication-specifics";
import {UploadQuote} from "./UploadQuote";
import {AccountSettings} from "./AccountSettings";
import { materialTitleIssues } from "@/lib/eyewear-inscriptions";
import { withSunglassesWidth } from "@/lib/front-measurements";
import { DEFAULT_AI_MODEL } from "@/lib/ai-defaults";
import { AiUsageSummary } from "./AiUsageSummary";
import { analysisImages } from "@/lib/analysis-images";
import type { AiUsage } from "@/lib/ai-usage";
import { usageTotals } from "@/lib/ai-costs";
import { withPublicationIdentity } from "@/lib/publication-identity";
import { migrateContentGroup } from "@/lib/listing-content-rules";
import { CATEGORY_FIELDS_VERSION } from "@/lib/ebay/category-fields";
import { applyBatchSkus } from "@/lib/batch-sku";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isGlasses, GLASSES_RULES_VERSION } from "@/lib/glasses-rules";
import { isSunglasses } from "@/lib/category-selection";
import { runBatch, type QueueProgress } from "@/lib/batch-queue";
import {
  loadDraft,
  saveDraft,
  savePhoto,
  loadPhoto,
  lightPhoto,
  clearDraft,
} from "@/lib/draft-store";
import { processFiles } from "@/lib/intake";
import { draftIssues } from "@/lib/client-review";
import { apiPost } from "@/lib/api-client";
import { getAnalysisModel, getSortModel } from "@/lib/model-preferences";
import { resizeImage } from "@/lib/resize";
import { chunkImagesForUpload } from "@/lib/uploadBatches";
import { ShopSettings } from "./ShopSettings";
import { loadAccountOptions } from "@/lib/account-options-client";
import {
  applyShopListing,
  applyShopGroup,
  readShopPreferences,
  validPolicyDefaults,
} from "@/lib/shop-preferences";
import { EbayConnect } from "./EbayConnect";
import { ModelSelector } from "./ModelSelector";
import { ReviewBoard } from "./ReviewBoard";
import {detectWhiteSeparator, splitAtSeparators, splitForAi} from "@/lib/photo-separators";
import { CameraCapture } from "./CameraCapture";
import { CloudBatch } from "./CloudBatch";
import { ListingsView } from "./ListingsView";
import type {
  AnalyzeResponse,
  CompsSummary,
  ItemGroup,
  ListingResult,
  Photo,
  SortResponse,
} from "@/lib/types";

type Step = "upload" | "review" | "listings";
// Big batches are sorted in chunks of SORT_CHUNK photos per request — each
// chunk's thumbnail payload stays under Vercel's 4.5 MB body limit — then
// reviewed together; items crossing a chunk boundary may need manual merging.
const MAX_PHOTOS = 1000;
const SORT_CHUNK = 100;
const WRITE_CONCURRENCY = 3;
// eBay accepts at most 24 photos per listing. They ship to eBay in small
// batches (lib/uploadBatches.ts) before publish, so no single request ever
// nears Vercel's 4.5 MB body limit.
const MAX_PUBLISH_PHOTOS = 24;
// HTTP statuses worth waiting out and retrying: rate limits and transient
// platform errors.
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(performance.now() * 1000)}-${Math.random()}`;
}

// Parse a fetch response as JSON, but turn non-JSON error bodies (e.g. a 413
// "Request Entity Too Large" plain-text page) into a friendly message instead
// of a cryptic "Unexpected token" error. Callers pass a hint that fits their
// step — "sort fewer photos" advice on a posting error sent sellers down the
// wrong path.
async function readJson(
  res: Response,
  tooLargeHint = "Try again with fewer or smaller photos.",
): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413) {
      throw new Error(
        `That was too much photo data to send at once. ${tooLargeHint}`,
      );
    }
    throw new Error(
      text.trim().slice(0, 140) || `Request failed (${res.status}).`,
    );
  }
}

export default function Home() {
  function backToListing() {
    const id=publicationConfirmation?.id;
    setPublicationConfirmation(null);
    if(id) requestAnimationFrame(()=>{
      const toggle=document.getElementById(`expand-${id}`);
      if(toggle?.getAttribute("aria-expanded") === "false") toggle.click();
      toggle?.closest(".listing-card")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
  }
  const [publicationConfirmation, setPublicationConfirmation] =
    useState<ItemGroup | null>(null);
  const publicationDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (publicationConfirmation) publicationDialog.current?.showModal();
    else publicationDialog.current?.close();
  }, [publicationConfirmation]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [quoteRevision,setQuoteRevision]=useState(0);
  const [binPrefix, setBinPrefix] = useState("");
  const [step, setStep] = useState<Step>("upload");
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [orphanIds, setOrphanIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sortUsage, setSortUsage] = useState<AiUsage[]>([]);
  const [sorting, setSorting] = useState(false);
  const [sortProgress, setSortProgress] = useState<string | null>(null);
  // Where bin lettering starts — continues after SKUs already on eBay, so a
  // second batch from bin K31 gets K31-N… instead of colliding with K31-A.
  const [skuStart, setSkuStart] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ebayConnected, setEbayConnected] = useState(false);
  const [restored, setRestored] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Loading saved work…");
  const [readOnly, setReadOnly] = useState(false);
  const inFlight = useRef(new Set<string>());
  const queueBusy = useRef(false);
  const queuePause = useRef(false);
  const queueIds = useRef<string[]>([]);
  const [queue, setQueue] = useState<
    | (QueueProgress & {
        kind: "write" | "post";
        running: boolean;
        paused: boolean;
      })
    | null
  >(null);
  async function startQueue(
    ids: string[],
    kind: "write" | "post",
    worker: (id: string) => Promise<void>,
  ) {
    if (queueBusy.current || !ids.length) return;
    queueBusy.current = true;
    queueIds.current = ids;
    queuePause.current = false;
    try {
      await runBatch(ids, kind === "write" ? WRITE_CONCURRENCY : 2, worker, {
        paused: () => queuePause.current,
        progress: (p) =>
          setQueue({ ...p, kind, running: true, paused: queuePause.current }),
      });
    } finally {
      queueBusy.current = false;
      setQueue(
        (q) => q && { ...q, running: false, paused: queuePause.current },
      );
    }
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const [importProgress, setImportProgress] = useState("");

  const photoMap = useMemo(() => {
    const m = new Map<string, Photo>();
    photos.forEach((p) => m.set(p.id, p));
    return m;
  }, [photos]);
  const photoById = useCallback((id: string) => photoMap.get(id), [photoMap]);

  useEffect(() => {
    let active = true;
    let release: () => void = () => {};
    const restore = async () => {
      try {
        const d = await loadDraft(true);
        if (d && active) {
          setPhotos(d.photos);
          // Migrate before automatic preparation captures the listing snapshot.
          setGroups(d.groups.map(migrateContentGroup));
          setSortUsage(d.sortUsage ?? []);
          setOrphanIds(d.orphanIds);
          setBinPrefix(d.binPrefix);
          setSkuStart(d.skuStart);
          setStep(d.step);
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setSaveStatus(
            "Autosave unavailable — keep this tab open and export drafts.",
          );
        }
      } finally {
        if (active) setRestored(true);
      }
    };
    if (navigator.locks)
      void navigator.locks.request(
        workspaceStorageKey("listing-writer-workspace"),
        { ifAvailable: true },
        async (lock) => {
          if (!active) return;
          if (!lock) {
            setReadOnly(true);
            setRestored(true);
            return;
          }
          await restore();
          await new Promise<void>((resolve) => {
            release = resolve;
            if (!active) resolve();
          });
        },
      );
    else void restore();
    return () => {
      active = false;
      release();
    };
  }, []);
  // Mark changed work unsaved before paint; older save completions cannot clear it.
  useLayoutEffect(() => {
    if (!restored || readOnly) return;
    let current = true;
    setSaveStatus("Wird gespeichert…");
    const timer = setTimeout(() => {
      void saveDraft({
        version: 1,
        sortUsage,
        photos,
        groups,
        orphanIds,
        binPrefix,
        skuStart,
        step,
        updatedAt: Date.now(),
      })
        .then(() => {
          if (current) setSaveStatus("Auf diesem Gerät gespeichert");
        })
        .catch(() => {
          if (current)
            setSaveStatus(
              "Could not save — device storage may be full. Keep this tab open and export drafts.",
            );
        });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    sortUsage,
    restored,
    readOnly,
    photos,
    groups,
    orphanIds,
    binPrefix,
    skuStart,
    step,
  ]);

  // Latest groups, readable inside async workers without stale closures.
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  const cvMounted=useRef(false);
  useEffect(()=>{cvMounted.current=true;return ()=>{cvMounted.current=false}},[]);
  const cvRunning=useRef(false);
  const cvAttempts=useRef(new Set<string>());
  useEffect(()=>{
    if(!restored||readOnly||cvRunning.current)return;
    const group=groups.find(g=>{const c=cvCandidate(g);return c&&!cvAttempts.current.has(g.id+c.key)});
    if(!group)return;
    const candidate=cvCandidate(group)!;
    const account=workspaceStorageKey('cv');
    const snapshot=group.listing;
    cvAttempts.current.add(group.id+candidate.key);cvRunning.current=true;
    void measureLocal(group,candidate.photoId,photoMap.get(candidate.photoId)).then(measurement=>{
      if(!cvMounted.current||workspaceStorageKey('cv')!==account)return;
      setGroups(prev=>prev.map(current=>{
        if(current.id!==group.id||current.listing!==snapshot||!cvCandidate(current)||cvKey(current,current.listing!)!==candidate.key)return current;
        const listing={...current.listing!,frontMeasurement:measurement};
        return {...current,listing:{...listing,...frontMeasurementFields(listing,current.preparation?.aspects??[])}};
      }));
    }).catch(()=>{/* Measurement failure must never fail listing creation. */}).finally(()=>{
      cvRunning.current=false;
      if(cvMounted.current)setGroups(prev=>[...prev]);
    });
    // Completion checks the current draft and account before applying results.
  },[groups,restored,readOnly,photoMap]);

  useEffect(() => {
    if (!restored || readOnly) return;
    setGroups((prev) => {
      const next = prev.map(migrateContentGroup);
      return next.some((g, i) => g !== prev[i]) ? next : prev;
    });
  }, [restored, readOnly]);
  const automaticAttempts = useRef(new Set<string>());
  const automaticBusy = useRef(false);
  const [automaticPreparing, setAutomaticPreparing] = useState("");
  useEffect(() => {
    if (!restored || readOnly || !ebayConnected || automaticBusy.current)
      return;
    const g = groups.find(
      (g) =>
        g.listing &&
        isGlasses(g.listing) &&
        g.status === "done" &&
        g.postStatus !== "posted" &&
        g.postStatus !== "posting" &&
        !inFlight.current.has(g.id) &&
        !automaticAttempts.current.has(g.id) &&
        (!g.preparation ||
          (isSunglasses(g.listing) && !g.preparation.secondaryCategoryId) ||
          g.listing.glasses_rules_version !== GLASSES_RULES_VERSION ||
          g.listing.category_fields_version !== CATEGORY_FIELDS_VERSION),
    );
    if (!g?.listing) return;
    automaticAttempts.current.add(g.id);
    automaticBusy.current = true;
    setAutomaticPreparing(g.sku || g.name);
    const snapshot = g.listing;
    void (async () => {
      try {
        const response = await apiPost("/api/ebay/prepare", {
          listing: snapshot,
          enrich: false,
        });
        const result = await readJson(response);
        if (!result.ok)
          throw new Error(
            result.error || "Kategorie konnte nicht vorbereitet werden.",
          );
        setGroups((previous) =>
          previous.map((current) =>
            current.id !== g.id ||
            current.status !== "done" ||
            current.postStatus === "posted" ||
            current.postStatus === "posting"
              ? current
              : current.listing !== snapshot
                ? {
                    ...current,
                    preparationError:
                      "Deine Änderungen bleiben erhalten. Bitte die Kategorie in der Detailkarte erneut vorbereiten.",
                  }
                : {
                    ...current,
                    listing: result.listing,
                    preparation: result.preparation,
                    preparationError: undefined,
                    verificationMessage: undefined,
                  },
          ),
        );
      } catch (error) {
        setGroups((previous) =>
          previous.map((current) =>
            current.id === g.id &&
            current.listing === snapshot &&
            current.postStatus !== "posted" &&
            current.postStatus !== "posting"
              ? { ...current, preparationError: (error as Error).message }
              : current,
          ),
        );
      } finally {
        automaticBusy.current = false;
        setAutomaticPreparing("");
      }
    })();
  }, [groups, restored, readOnly, ebayConnected, automaticPreparing]);

  // Keep eBay connection status in sync (also after the connect bar updates).
  useEffect(() => {
    const check = () =>
      fetch("/api/ebay/status", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setEbayConnected(Boolean(d.connected)))
        .catch(() => setEbayConnected(false));
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    window.addEventListener("ebay-connection-changed", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ebay-connection-changed", onFocus);
    };
  }, []);

  // ── Upload ──────────────────────────────────────────────
  const addFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      if (!fileList || fileList.length === 0 || importing.current) return 0;
      setError(null);
      const files = Array.from(fileList)
        .filter((f) => f.type.startsWith("image/"))
        .sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
      if (files.length === 0) {
        setError("Those didn't look like photos. Use JPG, PNG, or WebP.");
        return 0;
      }
      importing.current = true;
      setQuoteRevision(n=>n+1);
      let processed = 0;
      setImportProgress(
        `Preparing 0 of ${Math.min(files.length, MAX_PHOTOS - photos.length)} photos…`,
      );
      try {
        const result = await processFiles(
          files,
          MAX_PHOTOS - photos.length,
          async (file) => {
            const resized = await resizeImage(file);
            const p = { id: newId(), ...resized, separator: await detectWhiteSeparator(resized.previewUrl) };
            await savePhoto(p);
            processed++;
            setImportProgress(`Prepared ${processed} photos…`);
            return lightPhoto(p);
          },
        );
        const resized = result.values;
        if (result.errors.length) setError(result.errors.join("; "));
        setPhotos((prev) => [...prev, ...resized].slice(0, MAX_PHOTOS));
        return resized.length;
      } catch (e) {
        setError((e as Error).message);
        return 0;
      } finally {
        importing.current = false;
        setImportProgress("");
      }
    },
    [photos.length],
  );

  const removePhoto = (id: string) =>
    setPhotos((prev) => prev.filter((p) => p.id !== id));

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles(e.dataTransfer.files);
  };

  // ── Sort ────────────────────────────────────────────────
  const sort = async () => {
    if (photos.length === 0) return;
    setSorting(true);
    setError(null);
    try {
      const separators=new Set<string>();
      const skuMarkers=new Map<string,string>();
      // Scan the entire sequence first; a divider at a request boundary must
      // still end the previous item. Never fall back silently after a failed scan.
      for(let offset=0;offset<photos.length;offset+=20) {
        const chunk=photos.slice(offset,offset+20);
        setSortProgress(`KI prüft Trennbilder: Foto ${offset+1}–${offset+chunk.length} von ${photos.length}…`);
        const detailed=await Promise.all(chunk.map(async photo=>{const saved=await loadPhoto(photo.id);return {photoId:photo.id,mediaType:photo.mediaType,data:saved?.data || photo.data || photo.previewUrl.split(",")[1]};}));
        for(const batch of chunkImagesForUpload(detailed,3_200_000,20)) {
        const response=await apiPost("/api/sort",{action:"detect-separators",sortModel:getSortModel() ?? DEFAULT_AI_MODEL,
          images:batch.map(({mediaType,data})=>({mediaType,data}))});
        const detected=await readJson(response,"Trennbilderkennung fehlgeschlagen. Bitte erneut starten.");
        setSortUsage(prev=>[...prev,...(detected.usage ?? [])]);
        if(!detected.ok || !Array.isArray(detected.separatorIndices) || detected.separatorIndices.some((i:unknown)=>typeof i!=="number" || !Number.isInteger(i) || i<0 || i>=batch.length))
          throw new Error(detected.error || "Trennbilderkennung unvollständig. Es wird nicht ungeprüft weiter sortiert.");
        detected.separatorIndices.forEach((index:number)=>separators.add(batch[index].photoId));
        for(const marker of detected.skuMarkers ?? []) {
          if(!Number.isInteger(marker.photoIndex) || marker.photoIndex<0 || marker.photoIndex>=batch.length || !/^\d{1,20}(?:[-/]\d{1,20}){0,3}$/.test(marker.sku) || !detected.separatorIndices.includes(marker.photoIndex)) throw Error("SKU-Foto nicht eindeutig erkannt. Bitte prüfen.");
          skuMarkers.set(batch[marker.photoIndex].photoId,marker.sku);
        }
        }
      }
      const parts=splitForAi(photos,separators);
      const ordered=photos.map(photo=>({...photo,separator:separators.has(photo.id),skuMarker:skuMarkers.get(photo.id)}));
      setPhotos(ordered);
      const segments=parts.map(ids=>ids.map(id=>ordered.find(p=>p.id===id)!));
      if(!segments.length) throw new Error("Nur Trennbilder vorhanden. Bitte auch Brillenfotos hinzufügen.");
      // SKU is entered once, after the listing is written. Draft identity uses g.id.
      // Sort in chunks so each request's thumbnail payload stays small.
      type RawGroup = { name: string; photoIds: string[] };
      const chunkResults: RawGroup[][] = [];
      const orphanIdsAll: string[] = [];
      for (const segment of segments) for (let off = 0; off < segment.length; off += SORT_CHUNK) {
        const chunk = segment.slice(off, off + SORT_CHUNK);
        if (photos.length > SORT_CHUNK) {
          setSortProgress(
            `Sorting photos ${off + 1}–${off + chunk.length} of ${photos.length}…`,
          );
        }
        const res = await apiPost("/api/sort", {
          // Use the small thumbnail for sorting to keep the payload small.
          images: chunk.map((p) => ({
            mediaType: p.mediaType,
            data: p.previewUrl.split(",")[1],
          })),
          sortModel: getSortModel() ?? DEFAULT_AI_MODEL,
        });
        const data = (await readJson(
          res,
          "Try sorting fewer photos per batch.",
        )) as SortResponse;
        setSortUsage((prev) => [...prev, ...(data.usage ?? [])]);
        if (!data.ok || !data.groups) {
          throw new Error(data.error || "Could not sort the photos.");
        }
        const idxToId = (i: number) => chunk[i]?.id;
        chunkResults.push(
          data.groups
            .map((g) => ({
              name: g.name,
              photoIds: g.photoIndices.map(idxToId).filter(Boolean) as string[],
            }))
            .filter((g) => g.photoIds.length > 0),
        );
        orphanIdsAll.push(
          ...((data.orphanIndices ?? [])
            .map(idxToId)
            .filter(Boolean) as string[]),
        );
      }

      // Cross-chunk identity requires review; never join physical items from one thumbnail.
      const merged: RawGroup[] = chunkResults.flat();
      const assigned = new Set<string>();
      merged.forEach((g) => g.photoIds.forEach((id) => assigned.add(id)));
      orphanIdsAll.forEach((id) => assigned.add(id));
      // Any photo the sorter never placed shouldn't vanish — surface it.
      const leftover = ordered
        .filter((p) => !p.separator && !assigned.has(p.id))
        .map((p) => p.id);

      const nextGroups: ItemGroup[] = merged.map((g, i) => ({
        id: newId(),
        sku: "",
        name: g.name,
        photoIds: [...g.photoIds].sort(
          (a, b) =>
            photos.findIndex((p) => p.id === a) -
            photos.findIndex((p) => p.id === b),
        ),
        status: "idle",
      }));
      setGroups(assignPhotoSkus(nextGroups,ordered));
      setOrphanIds([...orphanIdsAll, ...leftover]);
      setStep("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSorting(false);
      setSortProgress(null);
    }
  };

  // ── Review edits ────────────────────────────────────────
  const rename = (groupId: string, name: string) =>
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, name } : g)),
    );

  const renameSku = (groupId: string, sku: string) =>
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId &&
        !inFlight.current.has(g.id) &&
        g.postStatus !== "posting" &&
        g.postStatus !== "posted"
          ? {
              ...withPublicationIdentity(g),
              sku,
              verificationMessage: undefined,
            }
          : g,
      ),
    );

  const movePhoto = (photoId: string, toGroupId: string | "orphans") => {
    setGroups((prev) =>
      prev.map((g) => {
        const nextIds =
          g.id === toGroupId
            ? g.photoIds.includes(photoId)
              ? g.photoIds
              : [...g.photoIds, photoId]
            : g.photoIds.filter((id) => id !== photoId);
        // A gained/lost photo invalidates an already-written listing — reset
        // it so "Write all listings" knows to redo this one (and only this one).
        const changed = nextIds.length !== g.photoIds.length;
        return {
          ...g,
          photoIds: nextIds,
          ...(changed
            ? {
                status: "idle" as const,
                listing: undefined,
                analysisPhotoIds: undefined,
                preparation: undefined,
                comps: undefined,
                imageUrls: undefined,
                uploadedPhotoIds: undefined,
              }
            : {}),
        };
      }),
    );
    setOrphanIds((prev) => {
      const without = prev.filter((id) => id !== photoId);
      return toGroupId === "orphans" ? [...without, photoId] : without;
    });
  };

  // Reorder photos within a group. The array order is the eBay photo order
  // (index 0 = cover/gallery image), so this is all that's needed — `writeGroup`
  // and `postGroup` re-derive their image order from `photoIds` at call time.
  const reorderPhoto = (
    groupId: string,
    fromIndex: number,
    toIndex: number,
  ) => {
    if (fromIndex === toIndex) return;
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= g.photoIds.length ||
          toIndex >= g.photoIds.length
        ) {
          return g;
        }
        const next = [...g.photoIds];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return {
          ...g,
          photoIds: next,
          imageUrls: undefined,
          uploadedPhotoIds: undefined,
        };
      }),
    );
  };

  const deleteGroup = (groupId: string) =>
    setGroups((prev) => {
      const target = prev.find((g) => g.id === groupId);
      if (target && target.photoIds.length > 0) {
        setOrphanIds((o) => [...o, ...target.photoIds]);
      }
      return prev.filter((g) => g.id !== groupId);
    });

  const addGroup = () =>
    setGroups((prev) => [
      ...prev,
      {
        id: newId(),
        sku: "",
        name: `new-item-${prev.length + 1}`,
        photoIds: [],
        status: "idle",
      },
    ]);

  // ── Write listings ──────────────────────────────────────
  const writeGroup = useCallback(
    async (groupId: string, confirmed = false, hint = "") => {
      // Snapshot this group's photos from the latest state (no stale closure).
      let group = groupsRef.current.find((g) => g.id === groupId);
      if (
        !group ||
        group.cloudBatchId ||
        group.postStatus === "posted" ||
        group.postStatus === "posting" ||
        group.publicationAttemptSku ||
        inFlight.current.has(groupId)
      )
        return;
      if (
        !confirmed &&
        (group.listing || group.usage?.length) &&
        !window.confirm(
          "Kostenpflichtige Neuanalyse starten? Der aktuelle Entwurf wird ersetzt. Für einen Vergleich ohne Überschreiben bitte Modelle vergleichen verwenden.",
        )
      )
        return;
      const selectedModel = getAnalysisModel() ?? DEFAULT_AI_MODEL;
      inFlight.current.add(groupId);
      const selectedPhotos = (group.analysisPhotoIds ?? group.photoIds)
        .map((id) => photoMap.get(id))
        .filter((p): p is Photo => Boolean(p) && p!.analysisSelected !== false);
      const imgs = analysisImages(selectedPhotos);
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? {
                ...g,
                status: "writing",
                error: undefined,
                verificationMessage: undefined,
                preparationError: undefined,
              }
            : g,
        ),
      );
      try {
        const res = await apiPost("/api/analyze", {
          profile: "auto",
          images: imgs,
          analysisModel: selectedModel,
          hint: hint.trim().slice(0, 500),
        });
        const data = (await readJson(res)) as AnalyzeResponse;
        if (!data.ok || !data.listing) {
          setGroups((prev) =>
            prev.map((g) =>
              g.id === groupId
                ? { ...g, usage: [...(g.usage ?? []), ...(data.usage ?? [])] }
                : g,
            ),
          );
          throw new Error(data.error || "Could not write this listing.");
        }
        const shopOptions = await loadAccountOptions().catch(() => undefined);
        const shop = readShopPreferences(shopOptions?.sellerKey);
        const baseDescription = data.listing.description;
        data.listing = withSunglassesWidth(applyShopListing(data.listing, shop));
        const preservedCv=keepCvMeasurement(group.listing,data.listing,{...group,evidencePhotoIds:selectedPhotos.map(p=>p.id)});
        if(preservedCv)data.listing={...data.listing,frontMeasurement:preservedCv};
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? {
                  ...g,
                  status: "writing",
                  shopBaseDescription: baseDescription,
                  shipping: {
                    ...(shopOptions
                      ? validPolicyDefaults(shop, shopOptions)
                      : {}),
                    ...g.shipping,
                  },
                  listing: data.listing,
                  evidencePhotoIds: selectedPhotos.map((p) => p.id),
                  analysisModel: selectedModel,
                  usage: [...(g.usage ?? []), ...(data.usage ?? [])],
                  preparation: undefined,
                  comps: undefined,
                  compsStatus: "loading",
                }
              : g,
          ),
        );
        // Resolve final category/schema before review, never during publication.
        let researchListing = data.listing;
        try {
          const pr = await apiPost("/api/ebay/prepare", {
            listing: data.listing,
            analysisModel: selectedModel,
            images: imgs,
            enrich: true,
          });
          const pd = await readJson(pr);
          if (pd.ok) researchListing = pd.listing;
          setGroups((prev) =>
            prev.map((g) =>
              g.id === groupId
                ? pd.ok
                  ? {
                      ...g,
                      status: "done",
                      listing: pd.listing,
                      preparation: pd.preparation,
                      usage: [...(g.usage ?? []), ...(pd.usage ?? [])],
                    }
                  : {
                      ...g,
                      status: "done",
                      preparationError: pd.error,
                      usage: [...(g.usage ?? []), ...(pd.usage ?? [])],
                    }
                : g,
            ),
          );
        } catch (e) {
          setGroups((prev) =>
            prev.map((g) =>
              g.id === groupId
                ? {
                    ...g,
                    status: "done",
                    preparationError: (e as Error).message,
                  }
                : g,
            ),
          );
        }
        // Market price check — advisory and best-effort, so it runs in the
        // background and silently stays hidden if it can't answer.
        void (async () => {
          try {
            const res = await apiPost("/api/ebay/comps", {
              listing: researchListing,
            });
            const d = (await readJson(res)) as {
              ok?: boolean;
              comps?: CompsSummary;
            };
            if (d.ok && d.comps?.ok) {
              setGroups((prev) =>
                prev.map((g) =>
                  g.id === groupId && g.listing === researchListing
                    ? { ...g, comps: d.comps, compsStatus: "ready",
                        listing: d.comps?.recommendedPrice ? {...g.listing!, suggested_price: d.comps.recommendedPrice} : g.listing }
                    : g,
                ),
              );
            } else {
              setGroups((prev) =>
                prev.map((g) =>
                  g.id === groupId && g.listing === researchListing
                    ? { ...g, compsStatus: "unavailable" }
                    : g,
                ),
              );
            }
          } catch {
            setGroups((prev) =>
              prev.map((g) =>
                g.id === groupId && g.listing === researchListing
                  ? { ...g, compsStatus: "unavailable" }
                  : g,
              ),
            );
          }
        })();
      } catch (e) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, status: "error", error: (e as Error).message }
              : g,
          ),
        );
      } finally {
        inFlight.current.delete(groupId);
      }
    },
    [photoMap],
  );

  const reanalyzeAll = async () => {
    const ids = groupsRef.current
      .filter(
        (g) =>
          g.photoIds.length &&
          !g.cloudBatchId &&
          g.status !== "writing" &&
          g.postStatus !== "posted" &&
          g.postStatus !== "posting" &&
          !g.publicationAttemptSku,
      )
      .map((g) => g.id);
    if (
      !ids.length ||
      !window.confirm(
        `${ids.length} offene Brillen mit vorhandenen Fotos neu analysieren? Titel, Merkmale, Beschreibung und manuelle Änderungen daran werden ersetzt. SKU und Versandregeln bleiben erhalten. Es entstehen Analysekosten.`,
      )
    )
      return;
    await startQueue(ids, "write", (id) => writeGroup(id, true));
  };
  const writeAll = async () => {
    // Only write listings that don't exist yet. Re-running everything after a
    // trip back to the review step re-billed the AI for unchanged listings
    // (issue #30) — groups whose photos changed are reset to "idle" by
    // movePhoto, so they (and only they) get rewritten here.
    const usable = groups
      .filter(
        (g) =>
          g.photoIds.length > 0 &&
          !g.cloudBatchId &&
          (g.status === "idle" || g.status === "error"),
      )
      .map((g) => g.id);
    setStep("listings");
    if (usable.length === 0) return;
    if (
      groups.some(
        (g) => usable.includes(g.id) && (g.listing || g.usage?.length),
      ) &&
      !window.confirm(
        `${usable.length} Entwürfe kostenpflichtig analysieren? Bereits vorhandene Entwürfe können ersetzt werden. Erfolgreiche fertige Angebote werden übersprungen.`,
      )
    )
      return;
    await startQueue(usable, "write", (id) => writeGroup(id, true));
  };

  const editGroup = (id: string, patch: Partial<ItemGroup>) =>
    setGroups((prev) =>
      prev.map((g) =>
        g.id === id ? { ...g, verificationMessage: undefined, ...patch } : g,
      ),
    );
  const editListing = (groupId: string, patch: Partial<ListingResult>) =>
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId &&
        g.listing &&
        g.status !== "writing" &&
        g.postStatus !== "posted" &&
        g.postStatus !== "posting"
          ? {
              ...g,
              verificationMessage: undefined,
              listing: {
                ...g.listing,
                ...patch,
                ...(patch.title !== undefined && patch.title !== g.listing.title
                  ? { title_manually_edited: true }
                  : {}),
                ...(patch.size !== undefined
                  ? {
                      item_specifics: {
                        ...g.listing.item_specifics,
                        Size: patch.size,
                      },
                      evidence: {},
                    }
                  : {}),
              },
              comps: undefined,
              compsStatus: "stale",
            }
          : g,
      ),
    );

  const postGroup = useCallback(
    async (
      groupId: string,
      mode: "verify" | "publish" | "resolve" | "repair" = "publish",
      confirmedSnapshot?: string,
    ) => {
      const selectedGroup = groupsRef.current.find((g) => g.id === groupId);
      if (!selectedGroup) return;
      let group: ItemGroup = selectedGroup;
      if (
        !group ||
        !group.listing ||
        group.postStatus === "posted" ||
        inFlight.current.has(groupId)
      )
        return;
      if (mode === "resolve" || mode === "repair") {
        inFlight.current.add(groupId);
        const original = withPublicationIdentity(group);
        editGroup(groupId, { postStatus: "posting" });
        try {
          const res = await apiPost("/api/ebay/publication-status", {
            action: mode === "repair" ? "repair" : "inspect",
            sku: original.publicationAttemptSku || original.sku,
            publicationId: original.publicationId,
            draftId: original.id,
            conflictItemId: original.publicationConflict?.listingId,
            differentItem: mode === "repair",
          });
          const data = await readJson(res);
          if (!data.success)
            throw new Error(data.error || "Abgleich fehlgeschlagen.");
          let patch: Partial<ItemGroup> = {
            publicationId: original.publicationId,
            postStatus: undefined,
            postError: undefined,
          };
          if (mode === "repair") {
            patch = {
              ...patch,
              sku: data.sku,
              publicationId: data.publicationId,
              publicationAttemptSku: undefined,
              publicationConflict: undefined,
              publicationRepair: {
                previousId: original.publicationId!,
                previousSku: original.sku,
                conflictItemId: original.publicationConflict!.listingId,
                repairedAt: Date.now(),
              },
              verificationMessage: `Entwurf repariert und gespeichert. SKU: ${data.sku}. Fotos, Beschreibung, Merkmale und Preis bleiben erhalten. Noch nicht veröffentlicht.`,
            };
            if (data.listingId)
              patch = {
                ...patch,
                postStatus: "posted",
                listingId: data.listingId,
              };
          } else if (data.status === "published") {
            patch = {
              ...patch,
              postStatus: "posted",
              listingId: data.listingId,
              publicationConflict: undefined,
            };
          } else if (data.status === "conflict") {
            patch = {
              ...patch,
              publicationConflict: {
                listingId: data.listingId,
                sku: data.sku,
                title: data.title,
              },
              postStatus: "error",
              postError:
                "Diese SKU gehört bereits zu einem eBay-Angebot. Bitte die beiden Brillen vergleichen.",
            };
          } else if (data.status === "uncertain") {
            throw new Error(
              "Der alte Versuch ist nicht eindeutig geklärt. Bitte vorhandene eBay-Angebote prüfen; es wurde keine neue Kennung vergeben.",
            );
          } else {
            patch.verificationMessage =
              "Kein aktives Angebot mit dieser SKU gefunden. Die gespeicherte Veröffentlichungskennung bleibt erhalten.";
          }
          const nextGroups = groupsRef.current.map((g) =>
            g.id === groupId ? { ...g, ...patch } : g,
          );
          await saveDraft({
            version: 1,
            sortUsage,
            photos: [...photoMap.values()],
            groups: nextGroups,
            orphanIds,
            binPrefix,
            skuStart,
            step: "listings",
            updatedAt: Date.now(),
          });
          groupsRef.current = nextGroups;
          setGroups(nextGroups);
        } catch (error) {
          editGroup(groupId, {
            postStatus: "error",
            postError: (error as Error).message,
          });
        } finally {
          inFlight.current.delete(groupId);
        }
        return;
      }
      const issues = draftIssues(group);

      if (issues.length) {
        editGroup(groupId, {
          postStatus: "error",
          postError: issues.join("; "),
        });
        return;
      }
      if (mode === "publish" && confirmedSnapshot !== JSON.stringify(group)) {
        setPublicationConfirmation(group);
        return;
      }
      group = withPublicationIdentity(group);
      setPublicationConfirmation(null);
      inFlight.current.add(groupId);
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? {
                ...g,
                postStatus: "posting",
                postError: undefined,
                verificationMessage: undefined,
              }
            : g,
        ),
      );
      try {
        // A changed display SKU must not hide an earlier successful request.
        // Resolve the original SKU first; never rotate the publication identity.
        i…60565 tokens truncated…Pmlzr4YBe7uyE+Du4oVqTDXZSHGGGXRtTJEGSSePyQCMBglQ==",
      "license": "MIT",
      "dependencies": {
        "scheduler": "^0.27.0"
      },
      "peerDependencies": {
        "react": "^19.2.8"
      }
    },
    "node_modules/require-directory": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/require-directory/-/require-directory-2.1.1.tgz",
      "integrity": "sha512-fGxEI7+wsG9xrvdjsrlmL22OMTTiHRwAMroiEeMgq8gzoLC/PQr7RsRDSTLUg/bZAZtF+TVIkHc6/4RIKrui+Q==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/require-in-the-middle": {
      "version": "8.0.1",
      "resolved": "https://registry.npmjs.org/require-in-the-middle/-/require-in-the-middle-8.0.1.tgz",
      "integrity": "sha512-QT7FVMXfWOYFbeRBF6nu+I6tr2Tf3u0q8RIEjNob/heKY/nh7drD/k7eeMFmSQgnTtCzLDcCu/XEnpW2wk4xCQ==",
      "license": "MIT",
      "dependencies": {
        "debug": "^4.3.5",
        "module-details-from-path": "^1.0.3"
      },
      "engines": {
        "node": ">=9.3.0 || >=8.10.0 <9.0.0"
      }
    },
    "node_modules/resolve": {
      "version": "1.22.12",
      "resolved": "https://registry.npmjs.org/resolve/-/resolve-1.22.12.tgz",
      "integrity": "sha512-TyeJ1zif53BPfHootBGwPRYT1RUt6oGWsaQr8UyZW/eAm9bKoijtvruSDEmZHm92CwS9nj7/fWttqPCgzep8CA==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "is-core-module": "^2.16.1",
        "path-parse": "^1.0.7",
        "supports-preserve-symlinks-flag": "^1.0.0"
      },
      "bin": {
        "resolve": "bin/resolve"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/rimraf": {
      "version": "5.0.10",
      "resolved": "https://registry.npmjs.org/rimraf/-/rimraf-5.0.10.tgz",
      "integrity": "sha512-l0OE8wL34P4nJH/H2ffoaniAokM2qSmrtXHmlpvYr5AVVX8msAyW0l8NVJFDxlSK4u3Uh/f41cQheDVdnYijwQ==",
      "license": "ISC",
      "dependencies": {
        "glob": "^10.3.7"
      },
      "bin": {
        "rimraf": "dist/esm/bin.mjs"
      },
      "funding": {
        "url": "https://github.com/sponsors/isaacs"
      }
    },
    "node_modules/rolldown": {
      "version": "1.2.7",
      "resolved": "https://registry.npmjs.org/rolldown/-/rolldown-1.2.7.tgz",
      "integrity": "sha512-g0EtLvBjTUB7jhyV0S/TCup3v/XSVl45vUIGbOGU4QPiyjTenCe4mKuFvW9fEgYmS2Fo42AUssRmNuMziXdrig==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@oxc-project/types": "=0.148.0",
        "@rolldown/pluginutils": "^1.0.0"
      },
      "bin": {
        "rolldown": "bin/cli.mjs"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "optionalDependencies": {
        "@rolldown/binding-android-arm-eabi": "1.2.7",
        "@rolldown/binding-android-arm64": "1.2.7",
        "@rolldown/binding-darwin-arm64": "1.2.7",
        "@rolldown/binding-darwin-x64": "1.2.7",
        "@rolldown/binding-freebsd-x64": "1.2.7",
        "@rolldown/binding-linux-arm-gnueabihf": "1.2.7",
        "@rolldown/binding-linux-arm64-gnu": "1.2.7",
        "@rolldown/binding-linux-arm64-musl": "1.2.7",
        "@rolldown/binding-linux-ppc64-gnu": "1.2.7",
        "@rolldown/binding-linux-s390x-gnu": "1.2.7",
        "@rolldown/binding-linux-x64-gnu": "1.2.7",
        "@rolldown/binding-linux-x64-musl": "1.2.7",
        "@rolldown/binding-openharmony-arm64": "1.2.7",
        "@rolldown/binding-win32-arm64-msvc": "1.2.7",
        "@rolldown/binding-win32-x64-msvc": "1.2.7"
      }
    },
    "node_modules/scheduler": {
      "version": "0.27.0",
      "resolved": "https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz",
      "integrity": "sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q==",
      "license": "MIT"
    },
    "node_modules/semver": {
      "version": "7.8.5",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.8.5.tgz",
      "integrity": "sha512-Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==",
      "license": "ISC",
      "optional": true,
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/sharp": {
      "version": "0.35.4",
      "resolved": "https://registry.npmjs.org/sharp/-/sharp-0.35.4.tgz",
      "integrity": "sha512-n++8XWcj+jCOr2IOl7h8LbKnGBDY4aPbmprMONBNFdn0ImXqpGVv5zliDs0V9HbmbCQLpbuo2ej9rAoOQTvMDA==",
      "license": "Apache-2.0",
      "optional": true,
      "dependencies": {
        "@img/colour": "^1.1.0",
        "detect-libc": "^2.1.2",
        "semver": "^7.8.5"
      },
      "engines": {
        "node": ">=20.9.0"
      },
      "funding": {
        "url": "https://opencollective.com/libvips"
      },
      "optionalDependencies": {
        "@img/sharp-darwin-arm64": "0.35.4",
        "@img/sharp-darwin-x64": "0.35.4",
        "@img/sharp-freebsd-wasm32": "0.35.4",
        "@img/sharp-libvips-darwin-arm64": "1.3.3",
        "@img/sharp-libvips-darwin-x64": "1.3.3",
        "@img/sharp-libvips-linux-arm": "1.3.3",
        "@img/sharp-libvips-linux-arm64": "1.3.3",
        "@img/sharp-libvips-linux-ppc64": "1.3.3",
        "@img/sharp-libvips-linux-riscv64": "1.3.3",
        "@img/sharp-libvips-linux-s390x": "1.3.3",
        "@img/sharp-libvips-linux-x64": "1.3.3",
        "@img/sharp-libvips-linuxmusl-arm64": "1.3.3",
        "@img/sharp-libvips-linuxmusl-x64": "1.3.3",
        "@img/sharp-linux-arm": "0.35.4",
        "@img/sharp-linux-arm64": "0.35.4",
        "@img/sharp-linux-ppc64": "0.35.4",
        "@img/sharp-linux-riscv64": "0.35.4",
        "@img/sharp-linux-s390x": "0.35.4",
        "@img/sharp-linux-x64": "0.35.4",
        "@img/sharp-linuxmusl-arm64": "0.35.4",
        "@img/sharp-linuxmusl-x64": "0.35.4",
        "@img/sharp-webcontainers-wasm32": "0.35.4",
        "@img/sharp-win32-arm64": "0.35.4",
        "@img/sharp-win32-ia32": "0.35.4",
        "@img/sharp-win32-x64": "0.35.4"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        }
      }
    },
    "node_modules/shebang-command": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/shebang-command/-/shebang-command-2.0.0.tgz",
      "integrity": "sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==",
      "license": "MIT",
      "dependencies": {
        "shebang-regex": "^3.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/shebang-regex": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/shebang-regex/-/shebang-regex-3.0.0.tgz",
      "integrity": "sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==",
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/siginfo": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/siginfo/-/siginfo-2.0.0.tgz",
      "integrity": "sha512-ybx0WO1/8bSBLEWXZvEd7gMW3Sn3JFlW3TvX1nREbDLRNQNaeNN8WK0meBwPdAaOI7TtRRRJn/Es1zhrrCHu7g==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/signal-exit": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/signal-exit/-/signal-exit-4.1.0.tgz",
      "integrity": "sha512-bzyZ1e88w9O1iNJbKnOlvYTrWPDl46O1bG0D3XInv+9tkPrxrN8jUUTiFlDkkmKWgn1M6CfIA13SuGqOa9Korw==",
      "license": "ISC",
      "engines": {
        "node": ">=14"
      },
      "funding": {
        "url": "https://github.com/sponsors/isaacs"
      }
    },
    "node_modules/source-map-js": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/stackback": {
      "version": "0.0.2",
      "resolved": "https://registry.npmjs.org/stackback/-/stackback-0.0.2.tgz",
      "integrity": "sha512-1XMJE5fQo1jGH6Y/7ebnwPOBEkIEnT4QF32d5R1+VXdXveM0IBMJt8zfaxX1P3QhVwrYe+576+jkANtSS2mBbw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/standardwebhooks": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/standardwebhooks/-/standardwebhooks-1.1.1.tgz",
      "integrity": "sha512-bCbX9ZEyFkWPsRz7Bl3NuQUJohmwGSev/yhr7vhaGPlc4AfIrspIRa6cPTBuI1ItmrTDJ4d/S2hCsfe4+vQGnQ==",
      "license": "MIT",
      "dependencies": {
        "@stablelib/base64": "^1.0.0",
        "fast-sha256": "^1.3.0"
      }
    },
    "node_modules/std-env": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/std-env/-/std-env-4.2.0.tgz",
      "integrity": "sha512-oCUKSupKTHX53EyjDtuZQ64pjLJ6yYCtpmEw0goYxtjG9KpbRe8KAsl2tBUGU9DyMcJ0RwJ8GqJAFzMXcXW1Rw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/string-width": {
      "version": "5.1.2",
      "resolved": "https://registry.npmjs.org/string-width/-/string-width-5.1.2.tgz",
      "integrity": "sha512-HnLOCR3vjcY8beoNLtcjZ5/nxn2afmME6lhrDrebokqMap+XbeW8n9TXpPDOqdGK5qcI3oT0GKTW6wC7EMiVqA==",
      "license": "MIT",
      "dependencies": {
        "eastasianwidth": "^0.2.0",
        "emoji-regex": "^9.2.2",
        "strip-ansi": "^7.0.1"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/string-width-cjs": {
      "name": "string-width",
      "version": "4.2.3",
      "resolved": "https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz",
      "integrity": "sha512-wKyQRQpjJ0sIp62ErSZdGsjMJWsap5oRNihHhu6G7JVO/9jIB6UyevL+tXuOqrng8j/cxKTWyWUwvSTriiZz/g==",
      "license": "MIT",
      "dependencies": {
        "emoji-regex": "^8.0.0",
        "is-fullwidth-code-point": "^3.0.0",
        "strip-ansi": "^6.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/string-width-cjs/node_modules/ansi-regex": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/ansi-regex/-/ansi-regex-5.0.1.tgz",
      "integrity": "sha512-quJQXlTSUGL2LH9SUXo8VwsY4soanhgo6LNSm84E1LBcE8s3O0wpdiRzyR9z/ZZJMlMWv37qOOb9pdJlMUEKFQ==",
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/string-width-cjs/node_modules/emoji-regex": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/emoji-regex/-/emoji-regex-8.0.0.tgz",
      "integrity": "sha512-MSjYzcWNOA0ewAHpz0MxpYFvwg6yjy1NG3xteoqz644VCo/RPgnr1/GGt+ic3iJTzQ8Eu3TdM14SawnVUmGE6A==",
      "license": "MIT"
    },
    "node_modules/string-width-cjs/node_modules/strip-ansi": {
      "version": "6.0.1",
      "resolved": "https://registry.npmjs.org/strip-ansi/-/strip-ansi-6.0.1.tgz",
      "integrity": "sha512-Y38VPSHcqkFrCpFnQ9vuSXmquuv5oXOKpGeT6aGrr3o3Gc9AlVa6JBfUSOCnbxGGZF+/0ooI7KrPuUSztUdU5A==",
      "license": "MIT",
      "dependencies": {
        "ansi-regex": "^5.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/strip-ansi": {
      "version": "7.2.0",
      "resolved": "https://registry.npmjs.org/strip-ansi/-/strip-ansi-7.2.0.tgz",
      "integrity": "sha512-yDPMNjp4WyfYBkHnjIRLfca1i6KMyGCtsVgoKe/z1+6vukgaENdgGBZt+ZmKPc4gavvEZ5OgHfHdrazhgNyG7w==",
      "license": "MIT",
      "dependencies": {
        "ansi-regex": "^6.2.2"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/chalk/strip-ansi?sponsor=1"
      }
    },
    "node_modules/strip-ansi-cjs": {
      "name": "strip-ansi",
      "version": "6.0.1",
      "resolved": "https://registry.npmjs.org/strip-ansi/-/strip-ansi-6.0.1.tgz",
      "integrity": "sha512-Y38VPSHcqkFrCpFnQ9vuSXmquuv5oXOKpGeT6aGrr3o3Gc9AlVa6JBfUSOCnbxGGZF+/0ooI7KrPuUSztUdU5A==",
      "license": "MIT",
      "dependencies": {
        "ansi-regex": "^5.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/strip-ansi-cjs/node_modules/ansi-regex": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/ansi-regex/-/ansi-regex-5.0.1.tgz",
      "integrity": "sha512-quJQXlTSUGL2LH9SUXo8VwsY4soanhgo6LNSm84E1LBcE8s3O0wpdiRzyR9z/ZZJMlMWv37qOOb9pdJlMUEKFQ==",
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/strnum": {
      "version": "2.5.1",
      "resolved": "https://registry.npmjs.org/strnum/-/strnum-2.5.1.tgz",
      "integrity": "sha512-UM4nTLWzQiDBseVxUGxN0wJzIk0UU89Qi7pKXz9qISo+lhviJikTuikBsK/oFRlpvYHvSdz0TVoLyQ+sEpYwxA==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/NaturalIntelligence"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "anynum": "^1.0.1"
      }
    },
    "node_modules/styled-jsx": {
      "version": "5.1.6",
      "resolved": "https://registry.npmjs.org/styled-jsx/-/styled-jsx-5.1.6.tgz",
      "integrity": "sha512-qSVyDTeMotdvQYoHWLNGwRFJHC+i+ZvdBRYosOFgC+Wg1vx4frN2/RG/NA7SYqqvKNLf39P2LSRA2pu6n0XYZA==",
      "license": "MIT",
      "dependencies": {
        "client-only": "0.0.1"
      },
      "engines": {
        "node": ">= 12.0.0"
      },
      "peerDependencies": {
        "react": ">= 16.8.0 || 17.x.x || ^18.0.0-0 || ^19.0.0-0"
      },
      "peerDependenciesMeta": {
        "@babel/core": {
          "optional": true
        },
        "babel-plugin-macros": {
          "optional": true
        }
      }
    },
    "node_modules/supports-preserve-symlinks-flag": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/supports-preserve-symlinks-flag/-/supports-preserve-symlinks-flag-1.0.0.tgz",
      "integrity": "sha512-ot0WnXS9fgdkgIcePe6RHNk1WA8+muPa6cSjeR3V8K27q9BB1rTE3R1p7Hv0z1ZyAc8s6Vvv8DIyWf681MAt0w==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/systeminformation": {
      "version": "5.33.8",
      "resolved": "https://registry.npmjs.org/systeminformation/-/systeminformation-5.33.8.tgz",
      "integrity": "sha512-v4F6OGYGh7wDvV68YmjOmZwGixV9A/GQ7d2b84t0UF4CaOy9jipNWIJDkHqYDYiTPuiojqlwVQd0hfUKOUN7tQ==",
      "license": "MIT",
      "os": [
        "darwin",
        "linux",
        "win32",
        "freebsd",
        "openbsd",
        "netbsd",
        "sunos",
        "android"
      ],
      "bin": {
        "systeminformation": "lib/cli.js"
      },
      "engines": {
        "node": ">=10.0.0"
      },
      "funding": {
        "type": "Buy me a coffee",
        "url": "https://www.buymeacoffee.com/systeminfo"
      }
    },
    "node_modules/temporal-polyfill": {
      "version": "0.2.5",
      "resolved": "https://registry.npmjs.org/temporal-polyfill/-/temporal-polyfill-0.2.5.tgz",
      "integrity": "sha512-ye47xp8Cb0nDguAhrrDS1JT1SzwEV9e26sSsrWzVu+yPZ7LzceEcH0i2gci9jWfOfSCCgM3Qv5nOYShVUUFUXA==",
      "license": "MIT",
      "dependencies": {
        "temporal-spec": "^0.2.4"
      }
    },
    "node_modules/temporal-spec": {
      "version": "0.2.4",
      "resolved": "https://registry.npmjs.org/temporal-spec/-/temporal-spec-0.2.4.tgz",
      "integrity": "sha512-lDMFv4nKQrSjlkHKAlHVqKrBG4DyFfa9F74cmBZ3Iy3ed8yvWnlWSIdi4IKfSqwmazAohBNwiN64qGx4y5Q3IQ==",
      "license": "ISC"
    },
    "node_modules/tinybench": {
      "version": "2.9.0",
      "resolved": "https://registry.npmjs.org/tinybench/-/tinybench-2.9.0.tgz",
      "integrity": "sha512-0+DUvqWMValLmha6lr4kD8iAMK1HzV0/aKnCtWb9v9641TnP/MFb7Pc2bxoxQjTXAErryXVgUOfv2YqNllqGeg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/tinyexec": {
      "version": "1.3.1",
      "resolved": "https://registry.npmjs.org/tinyexec/-/tinyexec-1.3.1.tgz",
      "integrity": "sha512-GCvB3aoys96IuDFBMcTB46JOR6mdMtAToqwiW8JlWhsoh1mhHi/xn9ss/Dg7N555GiJyEt2qzoG/NHCwM6h1EA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/tinyglobby": {
      "version": "0.2.17",
      "resolved": "https://registry.npmjs.org/tinyglobby/-/tinyglobby-0.2.17.tgz",
      "integrity": "sha512-wXR/dYpcqKmfWpEdZjiKJOwCNFndD0DMnrW/cYjVGttEkBfVgcLFHoNrlj47mjOVic9yyNu65alsgF4NQyTa2g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fdir": "^6.5.0",
        "picomatch": "^4.0.4"
      },
      "engines": {
        "node": ">=12.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/SuperchupuDev"
      }
    },
    "node_modules/tinyrainbow": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/tinyrainbow/-/tinyrainbow-3.1.1.tgz",
      "integrity": "sha512-yau8yJdTt989Mm0Bd/236QnzEiPf2xLLTqUZRUJOo/3CB078LSwzei343DgtJVmfJKJE3TMINY1u42SQsP6mXw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=14.0.0"
      }
    },
    "node_modules/tr46": {
      "version": "0.0.3",
      "resolved": "https://registry.npmjs.org/tr46/-/tr46-0.0.3.tgz",
      "integrity": "sha512-N3WMsuqV66lT30CrXNbEjx4GEwlow3v6rr4mCcv6prnfwhS01rkgyFdjPNBYd9br7LpXV1+Emh01fHnq2Gdgrw==",
      "license": "MIT"
    },
    "node_modules/ts-algebra": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/ts-algebra/-/ts-algebra-2.0.0.tgz",
      "integrity": "sha512-FPAhNPFMrkwz76P7cdjdmiShwMynZYN6SgOujD1urY4oNm80Ou9oMdmbR45LotcKOXoy7wSmHkRFE6Mxbrhefw==",
      "license": "MIT"
    },
    "node_modules/tslib": {
      "version": "2.8.1",
      "resolved": "https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz",
      "integrity": "sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==",
      "license": "0BSD"
    },
    "node_modules/typescript": {
      "version": "5.9.3",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz",
      "integrity": "sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==",
      "devOptional": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=14.17"
      }
    },
    "node_modules/ulid": {
      "version": "2.4.0",
      "resolved": "https://registry.npmjs.org/ulid/-/ulid-2.4.0.tgz",
      "integrity": "sha512-fIRiVTJNcSRmXKPZtGzFQv9WRrZ3M9eoptl/teFJvjOzmpU+/K/JH6HZ8deBfb5vMEpicJcLn7JmvdknlMq7Zg==",
      "license": "MIT",
      "bin": {
        "ulid": "bin/cli.js"
      }
    },
    "node_modules/undici-types": {
      "version": "6.21.0",
      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-6.21.0.tgz",
      "integrity": "sha512-iwDZqg0QAGrg9Rav5H4n0M64c3mkR59cJ6wQp+7C4nI0gsmExaedaYLNO44eT4AtBBwjbTiGPMlt2Md0T9H9JQ==",
      "license": "MIT"
    },
    "node_modules/vite": {
      "version": "8.2.2",
      "resolved": "https://registry.npmjs.org/vite/-/vite-8.2.2.tgz",
      "integrity": "sha512-cFKLV/PRgAUlIRm5WjMjJ86jrftzpqcgH+Us+DS8mI3CDNiH30Whrz8uHL3+MOLPAgqbMBAqWdAHAphOAM+z/Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "lightningcss": "^1.33.0",
        "picomatch": "^4.0.5",
        "postcss": "^8.5.26",
        "rolldown": "~1.2.4",
        "tinyglobby": "^0.2.17"
      },
      "bin": {
        "vite": "bin/vite.js"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "funding": {
        "url": "https://github.com/vitejs/vite?sponsor=1"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.3"
      },
      "peerDependencies": {
        "@types/node": "^20.19.0 || >=22.12.0",
        "@vitejs/devtools": "^0.4.0 || ^0.5.0",
        "esbuild": "^0.27.0 || ^0.28.0",
        "jiti": ">=1.21.0",
        "less": "^4.0.0",
        "sass": "^1.70.0",
        "sass-embedded": "^1.70.0",
        "stylus": ">=0.54.8",
        "sugarss": "^5.0.0",
        "terser": "^5.16.0",
        "tsx": "^4.8.1",
        "yaml": "^2.4.2"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        },
        "@vitejs/devtools": {
          "optional": true
        },
        "esbuild": {
          "optional": true
        },
        "jiti": {
          "optional": true
        },
        "less": {
          "optional": true
        },
        "sass": {
          "optional": true
        },
        "sass-embedded": {
          "optional": true
        },
        "stylus": {
          "optional": true
        },
        "sugarss": {
          "optional": true
        },
        "terser": {
          "optional": true
        },
        "tsx": {
          "optional": true
        },
        "yaml": {
          "optional": true
        }
      }
    },
    "node_modules/vitest": {
      "version": "4.1.11",
      "resolved": "https://registry.npmjs.org/vitest/-/vitest-4.1.11.tgz",
      "integrity": "sha512-fhACrNXUidIbGSBr5FlbuBkO7VWC1ZyLl0DO4CU2DrQoAPxX84Ysxs+HeGQpii5lZWV1Q4gBZTTu49mF+A6Edw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@vitest/expect": "4.1.11",
        "@vitest/mocker": "4.1.11",
        "@vitest/pretty-format": "4.1.11",
        "@vitest/runner": "4.1.11",
        "@vitest/snapshot": "4.1.11",
        "@vitest/spy": "4.1.11",
        "@vitest/utils": "4.1.11",
        "es-module-lexer": "^2.0.0",
        "expect-type": "^1.3.0",
        "magic-string": "^0.30.21",
        "obug": "^2.1.1",
        "pathe": "^2.0.3",
        "picomatch": "^4.0.3",
        "std-env": "^4.0.0-rc.1",
        "tinybench": "^2.9.0",
        "tinyexec": "^1.0.2",
        "tinyglobby": "^0.2.15",
        "tinyrainbow": "^3.1.0",
        "vite": "^6.0.0 || ^7.0.0 || ^8.0.0",
        "why-is-node-running": "^2.3.0"
      },
      "bin": {
        "vitest": "vitest.mjs"
      },
      "engines": {
        "node": "^20.0.0 || ^22.0.0 || >=24.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      },
      "peerDependencies": {
        "@edge-runtime/vm": "*",
        "@opentelemetry/api": "^1.9.0",
        "@types/node": "^20.0.0 || ^22.0.0 || >=24.0.0",
        "@vitest/browser-playwright": "4.1.11",
        "@vitest/browser-preview": "4.1.11",
        "@vitest/browser-webdriverio": "4.1.11",
        "@vitest/coverage-istanbul": "4.1.11",
        "@vitest/coverage-v8": "4.1.11",
        "@vitest/ui": "4.1.11",
        "happy-dom": "*",
        "jsdom": "*",
        "vite": "^6.0.0 || ^7.0.0 || ^8.0.0"
      },
      "peerDependenciesMeta": {
        "@edge-runtime/vm": {
          "optional": true
        },
        "@opentelemetry/api": {
          "optional": true
        },
        "@types/node": {
          "optional": true
        },
        "@vitest/browser-playwright": {
          "optional": true
        },
        "@vitest/browser-preview": {
          "optional": true
        },
        "@vitest/browser-webdriverio": {
          "optional": true
        },
        "@vitest/coverage-istanbul": {
          "optional": true
        },
        "@vitest/coverage-v8": {
          "optional": true
        },
        "@vitest/ui": {
          "optional": true
        },
        "happy-dom": {
          "optional": true
        },
        "jsdom": {
          "optional": true
        },
        "vite": {
          "optional": false
        }
      }
    },
    "node_modules/web-streams-polyfill": {
      "version": "3.3.3",
      "resolved": "https://registry.npmjs.org/web-streams-polyfill/-/web-streams-polyfill-3.3.3.tgz",
      "integrity": "sha512-d2JWLCivmZYTSIoge9MsgFCZrt571BikcWGYkjC1khllbTeDlGqZ2D8vD8E/lJa8WGWbb7Plm8/XJYV7IJHZZw==",
      "license": "MIT",
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/webidl-conversions": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/webidl-conversions/-/webidl-conversions-3.0.1.tgz",
      "integrity": "sha512-2JAn3z8AR6rjK8Sm8orRC0h/bcl/DqL7tRPdGZ4I1CjdF+EaMLmYxBHyXuKL849eucPFhvBoxMsflfOb8kxaeQ==",
      "license": "BSD-2-Clause"
    },
    "node_modules/whatwg-url": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/whatwg-url/-/whatwg-url-5.0.0.tgz",
      "integrity": "sha512-saE57nupxk6v3HY35+jzBwYa0rKSy0XR8JSxZPwgLr7ys0IBzhGviA1/TUGJLmSVqs8pb9AnvICXEuOHLprYTw==",
      "license": "MIT",
      "dependencies": {
        "tr46": "~0.0.3",
        "webidl-conversions": "^3.0.0"
      }
    },
    "node_modules/which": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/which/-/which-2.0.2.tgz",
      "integrity": "sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==",
      "license": "ISC",
      "dependencies": {
        "isexe": "^2.0.0"
      },
      "bin": {
        "node-which": "bin/node-which"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/why-is-node-running": {
      "version": "2.3.0",
      "resolved": "https://registry.npmjs.org/why-is-node-running/-/why-is-node-running-2.3.0.tgz",
      "integrity": "sha512-hUrmaWBdVDcxvYqnyh09zunKzROWjbZTiNy8dBEjkS7ehEDQibXJ7XvlmtbwuTclUiIyN+CyXQD4Vmko8fNm8w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "siginfo": "^2.0.0",
        "stackback": "0.0.2"
      },
      "bin": {
        "why-is-node-running": "cli.js"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/wrap-ansi": {
      "version": "8.1.0",
      "resolved": "https://registry.npmjs.org/wrap-ansi/-/wrap-ansi-8.1.0.tgz",
      "integrity": "sha512-si7QWI6zUMq56bESFvagtmzMdGOtoxfR+Sez11Mobfc7tm+VkUckk9bW2UeffTGVUbOksxmSw0AA2gs8g71NCQ==",
      "license": "MIT",
      "dependencies": {
        "ansi-styles": "^6.1.0",
        "string-width": "^5.0.1",
        "strip-ansi": "^7.0.1"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/chalk/wrap-ansi?sponsor=1"
      }
    },
    "node_modules/wrap-ansi-cjs": {
      "name": "wrap-ansi",
      "version": "7.0.0",
      "resolved": "https://registry.npmjs.org/wrap-ansi/-/wrap-ansi-7.0.0.tgz",
      "integrity": "sha512-YVGIj2kamLSTxw6NsZjoBxfSwsn0ycdesmc4p+Q21c5zPuZ1pl+NfxVdxPtdHvmNVOQ6XSYG4AUtyt/Fi7D16Q==",
      "license": "MIT",
      "dependencies": {
        "ansi-styles": "^4.0.0",
        "string-width": "^4.1.0",
        "strip-ansi": "^6.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/chalk/wrap-ansi?sponsor=1"
      }
    },
    "node_modules/wrap-ansi-cjs/node_modules/ansi-regex": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/ansi-regex/-/ansi-regex-5.0.1.tgz",
      "integrity": "sha512-quJQXlTSUGL2LH9SUXo8VwsY4soanhgo6LNSm84E1LBcE8s3O0wpdiRzyR9z/ZZJMlMWv37qOOb9pdJlMUEKFQ==",
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/wrap-ansi-cjs/node_modules/ansi-styles": {
      "version": "4.3.0",
      "resolved": "https://registry.npmjs.org/ansi-styles/-/ansi-styles-4.3.0.tgz",
      "integrity": "sha512-zbB9rCJAT1rbjiVDb2hqKFHNYLxgtk8NURxZ3IZwD3F6NtxbXZQCnnSi1Lkx+IDohdPlFp222wVALIheZJQSEg==",
      "license": "MIT",
      "dependencies": {
        "color-convert": "^2.0.1"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/chalk/ansi-styles?sponsor=1"
      }
    },
    "node_modules/wrap-ansi-cjs/node_modules/emoji-regex": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/emoji-regex/-/emoji-regex-8.0.0.tgz",
      "integrity": "sha512-MSjYzcWNOA0ewAHpz0MxpYFvwg6yjy1NG3xteoqz644VCo/RPgnr1/GGt+ic3iJTzQ8Eu3TdM14SawnVUmGE6A==",
      "license": "MIT"
    },
    "node_modules/wrap-ansi-cjs/node_modules/string-width": {
      "version": "4.2.3",
      "resolved": "https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz",
      "integrity": "sha512-wKyQRQpjJ0sIp62ErSZdGsjMJWsap5oRNihHhu6G7JVO/9jIB6UyevL+tXuOqrng8j/cxKTWyWUwvSTriiZz/g==",
      "license": "MIT",
      "dependencies": {
        "emoji-regex": "^8.0.0",
        "is-fullwidth-code-point": "^3.0.0",
        "strip-ansi": "^6.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/wrap-ansi-cjs/node_modules/strip-ansi": {
      "version": "6.0.1",
      "resolved": "https://registry.npmjs.org/strip-ansi/-/strip-ansi-6.0.1.tgz",
      "integrity": "sha512-Y38VPSHcqkFrCpFnQ9vuSXmquuv5oXOKpGeT6aGrr3o3Gc9AlVa6JBfUSOCnbxGGZF+/0ooI7KrPuUSztUdU5A==",
      "license": "MIT",
      "dependencies": {
        "ansi-regex": "^5.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/xml-naming": {
      "version": "0.3.0",
      "resolved": "https://registry.npmjs.org/xml-naming/-/xml-naming-0.3.0.tgz",
      "integrity": "sha512-ghig2TBE/H11aOVgmahA3MhimvkBr6JIYknH/Dhdk10nXwdbIqBJsbfMxpvFPG8bAw77gN29aQWvKpmVoPlvPQ==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/NaturalIntelligence"
        }
      ],
      "license": "MIT",
      "engines": {
        "node": ">=16.0.0"
      }
    },
    "node_modules/xtend": {
      "version": "4.0.2",
      "resolved": "https://registry.npmjs.org/xtend/-/xtend-4.0.2.tgz",
      "integrity": "sha512-LKYU1iAXJXUgAXn9URjiu+MWhyUXHsvfp7mcuYm9dSUKK0/CjtrUwFAxD82/mCWbtLsGjFIad0wIsod4zrTAEQ==",
      "license": "MIT",
      "engines": {
        "node": ">=0.4"
      }
    },
    "node_modules/y18n": {
      "version": "5.0.8",
      "resolved": "https://registry.npmjs.org/y18n/-/y18n-5.0.8.tgz",
      "integrity": "sha512-0pfFzegeDWJHJIAmTLRP2DwHjdF5s7jo9tuztdQxAhINCdvS+3nGINqPd00AphqJR/0LhANUS6/+7SCb98YOfA==",
      "license": "ISC",
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/yaml": {
      "version": "2.9.0",
      "resolved": "https://registry.npmjs.org/yaml/-/yaml-2.9.0.tgz",
      "integrity": "sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==",
      "license": "ISC",
      "bin": {
        "yaml": "bin.mjs"
      },
      "engines": {
        "node": ">= 14.6"
      },
      "funding": {
        "url": "https://github.com/sponsors/eemeli"
      }
    },
    "node_modules/yargs": {
      "version": "17.7.3",
      "resolved": "https://registry.npmjs.org/yargs/-/yargs-17.7.3.tgz",
      "integrity": "sha512-GZtjxm/J/4TSxuL3FNYjCmLktBTnIw/rVmKSIyKeYAZpmJB2ig9VauCC5xsa82GNKVKDAqpOn3KVzNt0zmrU0g==",
      "license": "MIT",
      "dependencies": {
        "cliui": "^8.0.1",
        "escalade": "^3.1.1",
        "get-caller-file": "^2.0.5",
        "require-directory": "^2.1.1",
        "string-width": "^4.2.3",
        "y18n": "^5.0.5",
        "yargs-parser": "^21.1.1"
      },
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/yargs-parser": {
      "version": "21.1.1",
      "resolved": "https://registry.npmjs.org/yargs-parser/-/yargs-parser-21.1.1.tgz",
      "integrity": "sha512-tVpsJW7DdjecAiFpbIB1e3qxIQsE6NoPc5/eTdrbbIC4h0LVsWhnoa3g+m2HclBIujHzsxZ4VJVA+GUuc2/LBw==",
      "license": "ISC",
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/yargs/node_modules/ansi-regex": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/ansi-regex/-/ansi-regex-5.0.1.tgz",
      "integrity": "sha512-quJQXlTSUGL2LH9SUXo8VwsY4soanhgo6LNSm84E1LBcE8s3O0wpdiRzyR9z/ZZJMlMWv37qOOb9pdJlMUEKFQ==",
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/yargs/node_modules/emoji-regex": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/emoji-regex/-/emoji-regex-8.0.0.tgz",
      "integrity": "sha512-MSjYzcWNOA0ewAHpz0MxpYFvwg6yjy1NG3xteoqz644VCo/RPgnr1/GGt+ic3iJTzQ8Eu3TdM14SawnVUmGE6A==",
      "license": "MIT"
    },
    "node_modules/yargs/node_modules/string-width": {
      "version": "4.2.3",
      "resolved": "https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz",
      "integrity": "sha512-wKyQRQpjJ0sIp62ErSZdGsjMJWsap5oRNihHhu6G7JVO/9jIB6UyevL+tXuOqrng8j/cxKTWyWUwvSTriiZz/g==",
      "license": "MIT",
      "dependencies": {
        "emoji-regex": "^8.0.0",
        "is-fullwidth-code-point": "^3.0.0",
        "strip-ansi": "^6.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/yargs/node_modules/strip-ansi": {
      "version": "6.0.1",
      "resolved": "https://registry.npmjs.org/strip-ansi/-/strip-ansi-6.0.1.tgz",
      "integrity": "sha512-Y38VPSHcqkFrCpFnQ9vuSXmquuv5oXOKpGeT6aGrr3o3Gc9AlVa6JBfUSOCnbxGGZF+/0ooI7KrPuUSztUdU5A==",
      "license": "MIT",
      "dependencies": {
        "ansi-regex": "^5.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/zod": {
      "version": "4.5.4",
      "resolved": "https://registry.npmjs.org/zod/-/zod-4.5.4.tgz",
      "integrity": "sha512-sC95tT5iHHH9gtpj6A81kh+NEaRAUFN+qlUPDUbRfOMvNf5QCBqsb3WgvnpVtK5Y+4UfA6KqufotuTvMGiTlsA==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/colinhacks"
      }
    },
    "node_modules/@techstark/opencv-js": {
      "version": "4.12.0-release.1",
      "resolved": "https://registry.npmjs.org/@techstark/opencv-js/-/opencv-js-4.12.0-release.1.tgz",
      "integrity": "sha512-LtTaph9v/HqLPXEg3m1xs2h7QJh10pUpuDT0nj8g77lelWnTwwQrehtd+fXElLOdrkqc4Fea6Z/sJBvEJLYPfw==",
      "license": "Apache-2.0"
    }
  }
}
