
import * as storable from './storable';
import * as indexable from './indexable';

type Storable = storable.Storable;
type Indexable = indexable.Indexable;

import { some, Codec } from './util';
import { Transaction } from './transaction';
import { StoreStructure } from './store';
import { IndexStructure } from './index';
import { DatabaseStructure, Database } from './database';

export interface AddIndexAlterationSpec<Item, Trait extends Indexable> {
  kind: 'add_index';
  name: string;
  to: string;
  unique: boolean;
  explode: boolean;
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
  decode: (x: Storable) => Item;
}

export interface RemoveStoreAlterationSpec {
  kind: 'remove_store';
  name: string;
}

export type StoreAlterationSpec = AddStoreAlterationSpec<any> | RemoveStoreAlterationSpec;
export type TraitAlterationSpec = AddIndexAlterationSpec<any, any> | RemoveIndexAlterationSpec;
export type AlterationSpec = StoreAlterationSpec | TraitAlterationSpec;

function parseStoreName(name: string): string {
  if (!name.startsWith('$'))
    throw Error("Store name must come after a '$'");
  return name.slice(1);
}

function parseIndexPath(path: string): [string, string] {
  const parts = path.split('.');
  const error_message = "Index path must be in format '$store_name.$index_name'";
  if (parts.length !== 2)
    throw Error(error_message);
  let [store_name, index_name] = parts;
  if (!store_name.startsWith('$') || !index_name.startsWith('$'))
    throw Error(error_message);
  store_name = store_name.slice(1);
  index_name = index_name.slice(1);
  return [store_name, index_name];
}

export function addStore<Item>($name: string, codec?: Partial<Codec<Item, Storable>>): AddStoreAlterationSpec<Item> {
  return {
    kind: 'add_store',
    name: parseStoreName($name),
    // Default codec is no codec, assume that the given type is storable
    encode: codec?.encode ?? ((item: Item) => item as any as Storable),
    decode: codec?.decode ?? ((encoded: Storable) => encoded as any as Item),
  };
}

export function removeStore($name: string): RemoveStoreAlterationSpec {
  return {
    kind: 'remove_store',
    name: parseStoreName($name),
  };
}

export function addIndex<Item, Trait extends Indexable>(
  index_path: string,
  trait: string | ((item: Item) => Trait),
  options?: { unique?: boolean; explode?: boolean },
): AddIndexAlterationSpec<Item, Trait> {
  const [store_name, index_name] = parseIndexPath(index_path);

  if (typeof trait === 'string') {
    // trait is a key path
    if (!trait.startsWith('.'))
      throw Error("Key path must start with '.'");
    trait = trait.slice(1);
  }

  return {
    kind: 'add_index',
    to: store_name,
    name: index_name,
    trait: trait,
    unique: options?.unique ?? false,
    explode: options?.explode ?? false,
  };
}

export function removeIndex(index_path: string): RemoveIndexAlterationSpec {
  const [store_name, index_name] = parseIndexPath(index_path);
  return {
    kind: 'remove_index',
    from: store_name,
    name: index_name,
  };
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

  get needed_store_names(): Array<string> {
    /* Given a migration, return which stores are to be modified by the db alterations in the migration. */
    return this.alteration_specs
      .filter(spec => ['add_store', 'remove_store'].includes(spec.kind))
      .map(spec => spec.name);
  }

  async run(db: Database): Promise<void> {
    /* Run a migration. This method MUST NOT be called within an
    existing upgradeneeded event. It will create and hanlde its own
    event. */

    if (this.before !== undefined) {
      await this.before();
    }

    const new_structure = db.migrations.calcStructure(db.structure.name, this.version);
    await db._versionChange(this.version, new_structure, tx => {
      for (const alteration_spec of this.alteration_specs) {
        this._stageOne(tx, alteration_spec)
      }
    });

    // This has to be done in a different transaction.
    // It involves get/put work, which I don't believe is supported on versionchange transactions...
    await db.connect(async conn => {
      await conn._transact(this.needed_store_names, 'rw', async tx => {
        for (const alteration_spec of this.alteration_specs) {
          await this._stageTwo(tx, alteration_spec)
        }
      });
    });

    if (this.after !== undefined) {
      await this.after();
    }

  }

  _stageOne(tx: Transaction, spec: AlterationSpec): void {
    switch(spec.kind) {

      case 'add_store': {
        const store_name = spec.name;
        tx._idb_db.createObjectStore(store_name, { keyPath: 'id', autoIncrement: true });
        break;
      }

      case 'remove_store': {
        const store_name = spec.name;
        tx._idb_db.deleteObjectStore(store_name);
        break;
      }

      case 'add_index': {
        const store_name = spec.to;
        const idb_store = tx._idb_tx.objectStore(store_name);
        const index_name = spec.name;
        idb_store.createIndex(
          index_name,
          `traits.${index_name}`,
          {
            unique: spec.unique,
            multiEntry: spec.explode,
          },
        );
        break;
      }

      case 'remove_index': {
        const store_name = spec.from;
        const index_name = spec.name;
        const idb_store = tx._idb_tx.objectStore(store_name);
        idb_store.deleteIndex(index_name);
        break;
      }

    }
  }

  async _stageTwo(tx: Transaction, spec: AlterationSpec): Promise<void> {
    switch(spec.kind) {

      case 'add_store':
      case 'remove_store':
        break;

      case 'add_index': {
        const is_path_index = typeof spec.trait === 'string';
        if (is_path_index) {
          return;
        } else {
          const store_name = spec.to;
          const index_name = spec.name;
          const store = some(tx.stores[store_name]);
          await store._mapExistingRows(row => {
            const item = store.structure.item_codec.decode(storable.decode(row.payload));
            const index = some(tx.stores[store_name]?.indexes[index_name]);
            const trait = index._get_trait(item);
            const encoded = indexable.encode(trait, index.structure.explode);
            row.traits[index_name] = encoded;
            row.payload = store.structure.item_codec.encode(storable.encode(item));
            return row;
          });
          return;
        }
      }

      case 'remove_index': {
        const store_name = spec.from;
        const index_name = spec.name;
        const index_spec = some(tx.structure.store_structures[store_name]?.index_structures[index_name]);
        if (index_spec.kind === 'path') {
          return;
        } else {
          const store = some(tx.stores[store_name]);
          await store._mapExistingRows(row => {
            delete row.traits[index_name];
            return row;
          });
          return;
        }
      }

    }
  }

}

type TraitGetter<Item> = (x: Item) => Indexable;

export class Migrations {

  readonly migrations: Array<Migration>;

  constructor(specs: Array<MigrationSpec>) {
    this.migrations = specs.map(spec => new Migration(spec));
  }

  get [Symbol.iterator](): Iterator<Migration> {
    return this.migrations[Symbol.iterator]();
  }

  async upgrade(db: Database, old_version: number): Promise<void> {
    /* Run all migrations with a version number greater than the current version. */
    const new_migrations = this.migrations
          .sort((m1, m2) => +m1.version - +m2.version)
          .filter(m => +m.version > old_version);

    for (const migration of new_migrations) {
      await migration.run(db);
    }
  }

  calcStructure(db_name: string, up_to_version?: number): DatabaseStructure {

    let migrations = this.migrations;
    migrations.sort((m1, m2) => m1.version - m2.version);
    if (up_to_version !== undefined) migrations = migrations.filter(m => m.version <= up_to_version);

    const db_structure: DatabaseStructure = {
      name: db_name,
      version: migrations.map(m => m.version).reduce((a, b) => Math.max(a, b), 0),
      store_names: new Set(),
      store_structures: {},
    };

    for (const migration of migrations) {
      for (const spec of migration.alteration_specs) {
        switch (spec.kind) {

          case 'add_store': {
            db_structure.store_names.add(spec.name);
            const item_codec = {
              encode: spec.encode,
              decode: spec.decode,
            };
            db_structure.store_structures[spec.name] = new StoreStructure({
              name: spec.name,
              item_codec: item_codec,
              index_structures: {},
            });
            break;
          }

          case 'remove_store': {
            db_structure.store_names.delete(spec.name);
            delete db_structure.store_structures[spec.name];
            break;
          }

          case 'add_index': {
            const store_structure = some(db_structure.store_structures[spec.to]);
            store_structure.index_names.add(spec.name);
            store_structure.index_structures[spec.name] = new IndexStructure({
              name: spec.name,
              unique: spec.unique,
              explode: spec.explode,
              item_codec: store_structure.item_codec,
              trait_path_or_getter: spec.trait,
              parent_store_name: store_structure.name,
            });
            break;
          }

          case 'remove_index': {
            const store_structure = some(db_structure.store_structures[spec.from]);
            store_structure.index_names.delete(spec.name);
            delete store_structure.index_structures[spec.name];
            break;
          }

        }
      }
    }

    return db_structure;

  }

}


