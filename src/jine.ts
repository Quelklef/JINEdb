
import { Database } from './database';
import { Transaction } from './transaction';
import { setUpShorthand } from './shorthand';
import { MigrationSpec, Migrations } from './migration';

export type Jine<$$> = Database<$$> & $$;

export async function newJine<$$>(name: string, migrations: Array<MigrationSpec>) {
  const db = await Database.new<$$>(name, migrations);
  const jine = setUpShorthand(db, db._idb_db);
  return jine;
}
