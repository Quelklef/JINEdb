
import { Jine, Connection } from '../src/jine';

async function deleteDatabase(db_name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(db_name);
    req.onsuccess = _event => resolve();
    req.onerror = _event => reject(req.error);
    req.onblocked = _event => reject(req.error);
  });
}

export async function reset(): Promise<void> {
  const db_info = await (indexedDB as any).databases();
  const db_names: Array<string> = db_info.map((info: any) => info.name);
  await Promise.all(db_names.map(name => deleteDatabase(name)));
}

