

// == Core == //

// (in order of ownership; lower is bound to higher)
export { Database } from './database';
export { Connection, BoundConnection, AutonomousConnection } from './connection';
export { Transaction } from './transaction';
export { Store, BoundStore, AutonomousStore } from './store';
export { Index, BoundIndex, AutonomousIndex } from './index';

export { Storable, NativelyStorable} from './storable';
export { Indexable, NativelyIndexable} from './indexable';


// == Top-level == //

import { Database } from './database';

/**
 * Top-level helper type
 */
export type Jine<$$> = Database<$$>;

/**
 * Create a new database and run migrations on it.
 */
export async function newJine<$$>(name: string): Promise<Jine<$$>> {
  const db = new Database<$$>(name);
  await db.init();
  return db;
}

