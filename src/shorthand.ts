
import { some } from './util';
import { Jine } from './jine';
import { Store } from './store';
import { Index } from './index';

export function setUpShorthand<$$>(jine: Jine<$$>, idb_db: IDBDatabase): Jine<$$> & $$ {

  // TODO: a schema.store_names would be nice...
  for (const store_name of Object.keys(jine.schema.store_schemas)) {
    const store_schema = some(jine.schema.store_schemas[store_name]);
    const store = Store.autonomous(store_schema, idb_db);
    (jine as any)['$' + store_name] = store;

    for (const index_name of Object.keys(store_schema.index_schemas)) {
      const index_schema = some(store_schema.index_schemas[index_name]);
      const index = Index.autonomous(index_schema, idb_db);
      (store as any)['$' + index_name] = index;
    }
  }

  return jine as Jine<$$> & $$;

}
