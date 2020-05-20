
import { Database } from './database';
import { Storable } from './storable';
import { some } from './util';
import { DatabaseSchema, StoreSchema, IndexSchema } from './schema';
import { Transaction, newTransaction } from './transaction';
import { IndexableTrait } from './traits';

export interface AddIndexAlterationSpec<Item, Trait extends IndexableTrait> {
  kind: 'add_index';
  name: string;
  to: string;
  unique?: boolean;
  explode?: boolean;
  // Traits fall into one of two categories:
  // 'path traits', where the trait is an attribute of the item
  // 'derived traits', where the trait is given by a function
  trait: string | ((item: Item) => Trait);
}

export interface RemoveIndexAlterationSpec {
  kind: 'remove_index';
  from: string;
  name: string;
}

export interface AddStoreAlterationSpec<Item> {
  kind: 'add_store';
  name: string;
  encode: (x: Item) => Storable;
  decode: (x: Item) => Storable;
}

export interface RemoveStoreAlterationSpec {
  kind: 'remove_store';
  name: string;
}

export type StoreAlterationSpec = AddStoreAlterationSpec<any> | RemoveStoreAlterationSpec;
export type TraitAlterationSpec = AddIndexAlterationSpec<any, any> | RemoveIndexAlterationSpec;
export type AlterationSpec = StoreAlterationSpec | TraitAlterationSpec;

export function addStore<Item>(spec: Omit<AddStoreAlterationSpec<Item>, 'kind'>): AddStoreAlterationSpec<Item> {
  return { ...spec, kind: 'add_store' };
}

export function removeStore(spec: Omit<RemoveStoreAlterationSpec, 'kind'>): RemoveStoreAlterationSpec {
  return { ...spec, kind: 'remove_store' };
}

export function addIndex<Item, Trait extends IndexableTrait>(spec: Omit<AddIndexAlterationSpec<Item, Trait>, 'kind'>): AddIndexAlterationSpec<Item, Trait> {
  return { ...spec, kind: 'add_index' };
}

export function removeIndex(spec: Omit<RemoveIndexAlterationSpec, 'kind'>): RemoveIndexAlterationSpec {
  return { ...spec, kind: 'remove_index' };
}

export interface MigrationSpec {
  version: number;
  before?: () => Promise<void>;
  alterations: Array<AlterationSpec>;
  after?: () => Promise<void>;
}


export class Migration {

  readonly version: number;
  readonly before?: () => Promise<void>;
  readonly alteration_specs: Array<AlterationSpec>;
  readonly after?: () => Promise<void>;

  constructor(spec: MigrationSpec) {
    this.version = spec.version;
    this.before = spec.before;
    this.alteration_specs = spec.alterations;
    this.after = spec.after;
  }

  get needed_stores(): Array<string> {
    /* Given a migration, return which stores are to be modified by the db alterations in the migration. */
    return this.alteration_specs
      .filter(spec => ['add_store', 'remove_store'].includes(spec.kind))
      .map(spec => spec.name);
  }

  async run<$$>(db: Database<$$>): Promise<void> {
    /* Run a migration. This method MUST NOT be called within an
    existing upgradeneeded event. It will create and hanlde its own
    event. */

    if (this.before !== undefined) {
      await this.before();
    }

    const async_work: Array<(tx: Transaction<$$>) => Promise<void>> = [];

    // TODO: using an underscore method of another class is a code smell
    await db._openIdbDb(this.version, upgrade_event => {
      const idb_tx = (upgrade_event.target as any).transaction as IDBTransaction;

      const db_schema_so_far = db.migrations.calcSchema(db.schema.name, this.version);
      const upgrade_tx = newTransaction(idb_tx, db_schema_so_far);

      for (const alteration_spec of this.alteration_specs) {
        const work = this._applyAlteration(upgrade_tx, alteration_spec)
        if (work !== undefined) async_work.push(work);
      }
      upgrade_tx.commit();
    });

    // Do async work
    // Unfortunately, I think this has to be done in a different transaction.
    // It involves get/put work, which I don't believe is supported on versionchange transactions...
    await db.transact(this.needed_stores, 'readwrite', async tx => {
      for (const work of async_work) {
        await work(tx);
      }
    });

    if (this.after !== undefined) {
      await this.after();
    }

  }

  _applyAlteration<$$>(tx: Transaction<$$>, spec: AlterationSpec): ((tx: Transaction<$$>) => Promise<void>) | undefined {
    /*

    Apply part of a database alteration to the underlying idb database,
    and possibly return leftover work.

    This method MUST be called on a versionchange transaction.

    Alterations all require some synchronous work applied to the underling
    idb database; some also require some asynchronous work applied afterwards.

    A store addition or deletion, for instance, only requires synchronously
    creating or deleting an idb objectStore.

    A trait addition or deletion, however, is more complex. It first requires
    creating or deleting an idb index, and then it requires updating all existing
    objects in the database to either add or remove the trait. This second part
    is asynchronous.

    This function does two things:
      1. Performs the sychronous work of the alteration
      2. Returns a function which asynchronously performs the rest of the
         work on the DB, if there is any; otherwise, returns undefined.

    */

    switch(spec.kind) {

      case 'add_store': {
        const store_name = spec.name;
        const item_codec = { encode: spec.encode, decode: spec.decode };
        const schema = new StoreSchema<Storable>({
          name: store_name,
          item_codec: item_codec,
          index_schemas: {},
        });
        tx._addStore(store_name, schema);
        return undefined;
      }

      case 'remove_store': {
        const store_name = spec.name;
        tx._removeStore(store_name);
        return undefined;
      }

      case 'add_index': {
        const store_name = spec.to;
        const index_name = spec.name;
        const store = some(tx.stores[store_name]);
        return store._addIndex(new IndexSchema({
          name: index_name,
          unique: spec.unique ?? false,
          explode: spec.explode ?? false,
          item_codec: store.schema.item_codec,
          trait_path_or_getter: spec.trait,
          parent_store_name: store_name,
        }));
      }

      case 'remove_index': {
        const store_name = spec.from;
        const index_name = spec.name;
        const store = some(tx.stores[store_name]);
        return store._removeIndex(index_name);
      }

    }
  }

}

type TraitGetter<Item> = (x: Item) => IndexableTrait;

export class Migrations {

  readonly migrations: Array<Migration>;

  constructor(specs: Array<MigrationSpec>) {
    this.migrations = specs.map(spec => new Migration(spec));
  }

  get [Symbol.iterator](): Iterator<Migration> {
    return this.migrations[Symbol.iterator]();
  }

  async upgrade<$$>(db: Database<$$>, old_version: number): Promise<void> {
    /* Run all migrations with a version number greater than the current version. */
    const new_migrations = this.migrations
          .sort((m1, m2) => +m1.version - +m2.version)
          .filter(m => +m.version > old_version);

    for (const migration of new_migrations) {
      await migration.run(db);
    }
  }

  calcSchema(db_name: string, before_version?: number): DatabaseSchema {

    const db_schema: DatabaseSchema = {
      name: db_name,
      store_names: new Set(),
      store_schemas: {},
    };

    let migrations = this.migrations;
    migrations.sort((m1, m2) => m1.version - m2.version);
    if (before_version) migrations = migrations.filter(m => m.version < before_version);

    for (const migration of migrations) {
      for (const spec of migration.alteration_specs) {
        switch (spec.kind) {

          case 'add_store': {
            db_schema.store_names.add(spec.name);
            const item_codec = { encode: spec.encode, decode: spec.decode };
            db_schema.store_schemas[spec.name] = new StoreSchema({
              name: spec.name,
              item_codec: item_codec,
              index_schemas: {},
            });
            break;
          }

          case 'remove_store': {
            db_schema.store_names.delete(spec.name);
            delete db_schema.store_schemas[spec.name];
            break;
          }

          case 'add_index': {
            const store_schema = some(db_schema.store_schemas[spec.to]);
            store_schema.index_names.add(spec.name);
            store_schema.index_schemas[spec.name] = new IndexSchema({
              name: spec.name,
              unique: spec.unique ?? false,
              explode: spec.explode ?? false,
              item_codec: store_schema.item_codec,
              trait_path_or_getter: spec.trait,
              parent_store_name: store_schema.name,
            });
            break;
          }

          case 'remove_index': {
            const store_schema = some(db_schema.store_schemas[spec.from]);
            store_schema.index_names.delete(spec.name);
            delete store_schema.index_schemas[spec.name];
            break;
          }

        }
      }
    }

    return db_schema;

  }

}


