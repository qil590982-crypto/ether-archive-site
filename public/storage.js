const DB_NAME = 'ether-archive-local';
const STORE_NAME = 'memories';
const DB_VERSION = 1;

function storageError(error) {
  const wrapped = new Error('本机保存失败');
  wrapped.name = error?.name || 'StorageError';
  wrapped.cause = error;
  return wrapped;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('order', 'order', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}

async function transact(mode, operation) {
  let db;
  try { db = await openDatabase(); }
  catch (error) { throw storageError(error); }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    try { result = operation(store); }
    catch (error) { db.close(); reject(storageError(error)); return; }
    tx.oncomplete = () => { db.close(); resolve(result?.result); };
    tx.onerror = tx.onabort = () => { const error = storageError(tx.error); db.close(); reject(error); };
  });
}

export async function getAllMemories() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result.sort((a, b) => a.order - b.order)); };
    request.onerror = () => { db.close(); reject(storageError(request.error)); };
  });
}

export function saveMemory(memory) { return transact('readwrite', store => store.put(memory)); }
export function removeMemory(id) { return transact('readwrite', store => store.delete(id)); }
export function clearMemories() { return transact('readwrite', store => store.clear()); }

