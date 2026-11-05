export interface LocalPhoto {
  id: string;
  thumb: Blob;
  blob: Blob;
  captureMs: number;
}
export interface Article {
  id: string;
  batch: string;
  revision: number;
  sku: string;
  ids: string[];
  uploaded: string[];
  parent?: string;
  sealed?: boolean;
  submitted?: boolean;
}
export interface Journal {
  session: string;
  current: Article;
  closed: Article[];
  history?: { id: string; createdAt: number }[];
  createdAt?: number;
}
export const newArticle = (): Article => ({
  id: crypto.randomUUID(),
  batch: crypto.randomUUID(),
  revision: 1,
  sku: "",
  ids: [],
  uploaded: [],
});
export const newJournal = (): Journal => ({
  session: crypto.randomUUID(),
  current: newArticle(),
  closed: [],
  createdAt: Date.now(),
});

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("snaplist-live-foto", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("journal");
      r.result.createObjectStore("photos");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function read<T>(
  store: "journal" | "photos",
  key: string,
): Promise<T | undefined> {
  const conn = await db();
  try {
    return await new Promise((resolve, reject) => {
      const r = conn.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    conn.close();
  }
}

export async function persist(
  journal: Journal,
  photo?: LocalPhoto,
  remove?: string,
) {
  const conn = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = conn.transaction(["journal", "photos"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
      try {
        if (photo) tx.objectStore("photos").put(photo, photo.id);
        if (remove) tx.objectStore("photos").delete(remove);
        tx.objectStore("journal").put(journal, journal.session);
        tx.objectStore("journal").put(journal, "current");
      } catch (e) {
        tx.abort();
        reject(e);
      }
    });
  } finally {
    conn.close();
  }
}
