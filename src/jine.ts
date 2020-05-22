
// Core re-exports
// (in order of ownership; lower is bound to higher)
export { Database } from './database';
export { Connection, BoundConnection, AutonomousConnection } from './connection';
export { Store, BoundStore, AutonomousStore } from './store';
export { Index, BoundIndex, AutonomousIndex } from './index';

// Migration re-exports
export { addStore, removeStore, addIndex, removeIndex } from './migration';

// --

import { MigrationSpec } from './migration';
import { Database } from './database';

export type Jine<$$> = $$ & Database<$$>;

export async function newJine<$$>(name: string, migrations: Array<MigrationSpec>): Promise<Jine<$$>> {
  const db = await Database.new<$$>(name, migrations);
  return db.withShorthand();
}

