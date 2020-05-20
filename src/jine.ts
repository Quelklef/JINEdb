
// Core re-exports
export { Store } from './store';
export { Index } from './index';
export { Database } from './database';

// Migration re-exports
export { addStore, removeStore, addIndex, removeIndex } from './migration';

// --

import { Database } from './database';
import { setUpShorthand } from './shorthand';
import { MigrationSpec } from './migration';

export type Jine<$$> = Database<$$> & $$;

export async function newJine<$$>(name: string, migrations: Array<MigrationSpec>): Promise<Jine<$$>> {
  const db = await Database.new<$$>(name, migrations);
  const jine = setUpShorthand(db, db._idb_db);
  return jine;
}
