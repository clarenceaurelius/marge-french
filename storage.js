let connection;
function database() {
  if (!connection) connection = new Promise((resolve,reject) => {
    const request = indexedDB.open('marge-french-v1',1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Browser storage is blocked'));
  });
  return connection;
}
export async function read(key) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const request = db.transaction('data').objectStore('data').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function write(key, value) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const transaction = db.transaction('data','readwrite');
    transaction.objectStore('data').put(value,key);
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
