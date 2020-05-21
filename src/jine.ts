
// Core re-exports
// (in order of ownership; lower is bound to higher)
export { Database } from './database';
export { Connection, BoundConnection, AutonomousConnection } from './connection';
export { Store, BoundStore, AutonomousStore } from './store';
export { Index, BoundIndex, AutonomousIndex } from './index';

// Migration re-exports
export { addStore, removeStore, addIndex, removeIndex } from './migration';

// --

import { some } from './util';
import { Database } from './database';
import { MigrationSpec } from './migration';
import { AutonomousIndex } from './index';
import { AutonomousStore } from './store';
import { AutonomousConnection } from './connection';

export type Jine<$$> = Database<$$> & $$;

export async function newJine<$$>(name: string, migrations: Array<MigrationSpec>): Promise<Jine<$$>> {
  const db = await Database.new<$$>(name, migrations);
  const jine = await setUpShorthand(db);
  return jine;
}


async function setUpShorthand<$$>(db: Database<$$>): Promise<Jine<$$>> {

  const conn = new AutonomousConnection(db.schema);

  for (const store_name of db.schema.store_names) {
    const store_schema = some(db.schema.store_schemas[store_name]);
    const store = new AutonomousStore(store_schema, conn);
    (db as any)['$' + store_name] = store;

    for (const index_name of store_schema.index_names) {
      const index_schema = some(store_schema.index_schemas[index_name]);
      const index = new AutonomousIndex(index_schema, store);
      (store as any)['$' + index_name] = index;
    }
  }

  return db as Jine<$$>;

}
