// Offline queue for reports, backed by IndexedDB.
//
// When submitReport() fails because of a network issue, the entire payload
// (media blob, optional audio blob, form fields, and a snapshot of the
// config values needed to retry) is persisted here. The queue is drained
// automatically when the browser goes back online and on the next app open.

const DB_NAME    = 'bug-reporter-queue';
const DB_VERSION = 1;
const STORE      = 'reports';

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return openDb().then(db => db.transaction(STORE, mode).objectStore(STORE));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

const _listeners = new Set();
function notifyChange() {
  _listeners.forEach(fn => { try { fn(); } catch {} });
}

/**
 * Classify an error thrown by submitReport() as a network/offline condition.
 * Only network errors should trigger queueing — validation or auth errors
 * are the user's problem to fix.
 */
export function isNetworkError(err) {
  if (!navigator.onLine) return true;
  if (!err) return false;
  // fetch() rejects with TypeError on network failures ("Failed to fetch").
  if (err.name === 'TypeError') return true;
  const msg = String(err.message || err);
  return /failed to fetch|networkerror|network error|load failed/i.test(msg);
}

export const Queue = {
  async enqueue(item) {
    const store = await tx('readwrite');
    const record = { ...item, createdAt: Date.now() };
    const id = await reqToPromise(store.add(record));
    notifyChange();
    return id;
  },

  async getAll() {
    const store = await tx('readonly');
    return reqToPromise(store.getAll());
  },

  async count() {
    const store = await tx('readonly');
    return reqToPromise(store.count());
  },

  async remove(id) {
    const store = await tx('readwrite');
    await reqToPromise(store.delete(id));
    notifyChange();
  },

  /**
   * Subscribe to queue mutations (add/remove). Returns an unsubscribe fn.
   */
  onChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};
