const DB_NAME = "video-flow-ext";
const DB_VERSION = 2;
const FRAMES_STORE = "frames";
const CLIPS_STORE = "editClips";
const CLIPS_META_KEY = "meta";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(FRAMES_STORE)) {
        db.createObjectStore(FRAMES_STORE);
      }
      if (!db.objectStoreNames.contains(CLIPS_STORE)) {
        db.createObjectStore(CLIPS_STORE);
      }
    };
  });
}

/**
 * @typedef {{ id: string, name: string, order: number, selected: boolean, mimeType: string, duration?: number, buffer: ArrayBuffer }} StoredEditClip
 */

export async function clearEditClips() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readwrite");
    tx.objectStore(CLIPS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** @param {StoredEditClip[]} clips */
export async function saveEditClips(clips) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readwrite");
    const store = tx.objectStore(CLIPS_STORE);
    store.clear();
    for (const clip of clips) {
      store.put(clip, clip.id);
    }
    store.put(
      {
        count: clips.length,
        updatedAt: Date.now(),
      },
      CLIPS_META_KEY
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** @returns {Promise<StoredEditClip[]>} */
export async function loadEditClips() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readonly");
    const store = tx.objectStore(CLIPS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result ?? []).filter((c) => c?.id && c.id !== CLIPS_META_KEY);
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getEditClipsMeta() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readonly");
    const req = tx.objectStore(CLIPS_STORE).get(CLIPS_META_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
