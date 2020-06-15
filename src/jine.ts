

// == Core == //

// (in order of ownership; lower is bound to higher)
export { Database } from './database';
export { Connection, ConnectionActual, ConnectionBroker } from './connection';
export { Transaction } from './transaction';
export { Store, StoreActual, StoreBroker } from './store';
export { Index, IndexActual, IndexBroker } from './index';

export { Storable, NativelyStorable} from './storable';
export { Indexable, NativelyIndexable} from './indexable';

export { Encodable } from './codec-registry';


// == Top-level == //

import { Database } from './database';

/**
 * Create and initialize a [[Database]]
 */
export async function newJine<$$>(name: string): Promise<Database<$$>> {
  const db = new Database<$$>(name);
  await db.init();
  return db;
}

