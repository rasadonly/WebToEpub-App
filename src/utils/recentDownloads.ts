export interface SavedDownload {
  id: string;
  title: string;
  author: string;
  size: number;
  createdAt: number;
  blob?: Blob;
  downloadUrl?: string;
}

const DB_NAME = 'linkToEpubDownloads';
const STORE_NAME = 'downloads';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/** Save a downloaded/generated EPUB locally in browser IndexedDB (retained for 7 days) */
export async function saveRecentDownload(entry: Omit<SavedDownload, 'createdAt'>): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const data: SavedDownload = {
      ...entry,
      createdAt: Date.now(),
    };
    store.put(data);

    // Keep up to 20 recent books for up to 7 days
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result as SavedDownload[]).sort((a, b) => b.createdAt - a.createdAt);
      const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
      const now = Date.now();
      for (let i = 0; i < all.length; i++) {
        if (i >= 20 || now - all[i].createdAt > SEVEN_DAYS) {
          store.delete(all[i].id);
        }
      }
    };
  } catch {
    /* fallback silently if IndexedDB is disabled */
  }
}

/** Load all recent local downloads saved in IndexedDB */
export async function getRecentDownloads(): Promise<SavedDownload[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as SavedDownload[]) || [];
        resolve(all.sort((a, b) => b.createdAt - a.createdAt));
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
