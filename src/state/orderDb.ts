import type { Order } from '../order';

/** 订单持久化:IndexedDB,容量足够存砖表与掩码;store 只持有摘要 */
const DB_NAME = 'brickforge';
const STORE = 'orders';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export const orderDb = {
  async put(order: Order): Promise<void> {
    await tx('readwrite', (s) => s.put(order));
  },
  async get(id: string): Promise<Order | undefined> {
    return tx('readonly', (s) => s.get(id));
  },
  async getAll(): Promise<Order[]> {
    const all = await tx('readonly', (s) => s.getAll() as IDBRequest<Order[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async delete(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  }
};
