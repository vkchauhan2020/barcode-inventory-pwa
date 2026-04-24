import type { InventoryRecord } from './types';

const DB_NAME = 'barcode-inventory-db';
const DB_VERSION = 1;
const STORE_NAME = 'records';

function openInventoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('scannedAt', 'scannedAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | void> {
  return openInventoryDb().then(
    (db) =>
      new Promise<T | void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = operation(store);

        transaction.oncomplete = () => {
          db.close();
          resolve(request?.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      }),
  );
}

export function getInventoryRecords(): Promise<InventoryRecord[]> {
  return runTransaction<InventoryRecord[]>('readonly', (store) => store.getAll()).then((records) =>
    (records ?? []).sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt)),
  );
}

export function addInventoryRecord(record: InventoryRecord): Promise<void> {
  return runTransaction('readwrite', (store) => {
    store.add(record);
  }).then(() => undefined);
}

export function deleteInventoryRecord(id: string): Promise<void> {
  return runTransaction('readwrite', (store) => {
    store.delete(id);
  }).then(() => undefined);
}

export function clearInventoryRecords(): Promise<void> {
  return runTransaction('readwrite', (store) => {
    store.clear();
  }).then(() => undefined);
}
