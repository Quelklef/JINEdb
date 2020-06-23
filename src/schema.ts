
import { Dict } from './util';
import { Storable, StorableRegistry } from './storable';
import { Indexable, IndexableRegistry } from './indexable';

import * as err from './errors';

// Precisely, the schema contains the information that is controlled
// by migrations

export class IndexSchema<Item extends Storable = Storable, Trait extends Indexable = Indexable> {
  name: string;
  unique: boolean;
  explode: boolean;

  trait_path_or_getter: string | ((item: Item) => Trait);

  // path - string
  // derived - function
  get kind(): 'path' | 'derived' {
    return typeof this.trait_path_or_getter === 'string' ? 'path' : 'derived';
  }

  get path(): string {
    if (this.kind !== 'path')
      throw Error('Cannot get .path on non-path index');
    return this.trait_path_or_getter as string;
  }

  get getter(): (item: Item) => Trait {
    if (this.kind !== 'derived')
      throw Error('Cannot get .getter on non-derived index');
    return this.trait_path_or_getter as ((item: Item) => Trait);
  }
  
  storables: StorableRegistry;
  indexables: IndexableRegistry;

  constructor(args: {
    name: string;
    unique: boolean;
    explode: boolean;
    trait_path_or_getter: string | ((item: Item) => Trait);
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this.unique = args.unique;
    this.explode = args.explode;
    this.storables = args.storables;
    this.indexables = args.indexables;
    this.trait_path_or_getter = args.trait_path_or_getter;
  }

  calc_trait(item: Item): Trait {
    if (this.kind === 'path') {
      return (item as any)[this.path];
    } else {
      return this.getter(item);
    }
  }
}

export class StoreSchema<Item extends Storable = Storable> {
  name: string;
  private indexes: Dict<IndexSchema<Item>>;

  storables: StorableRegistry;
  indexables: IndexableRegistry;

  constructor(args: {
    name: string;
    indexes: Dict<IndexSchema<Item>>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this.indexes = args.indexes;
    this.storables = args.storables;
    this.indexables = args.indexables;
  }

  index(index_name: string): IndexSchema<Item> {
    const got = this.indexes[index_name];
    if (got === undefined)
      throw new err.JineNoSuchIndexError(`No index '${index_name}' (schema not found).`);
    return got;
  }

  get index_names(): Array<string> {
    return Object.keys(this.indexes);
  }

  addIndex(index_name: string, index_schema: IndexSchema<Item>): void {
    this.indexes[index_name] = index_schema;
  }

  removeIndex(index_name: string): void {
    delete this.indexes[index_name];
  }
}

export class DatabaseSchema {
  name: string;
  private stores: Dict<StoreSchema>;
  
  storables: StorableRegistry;
  indexables: IndexableRegistry;

  constructor(args: {
    name: string;
    stores: Dict<StoreSchema>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this.stores = args.stores;
    this.storables = args.storables;
    this.indexables = args.indexables;
  }

  store(store_name: string): StoreSchema {
    const got = this.stores[store_name];
    if (got === undefined)
      throw new err.JineNoSuchStoreError(`No store '${store_name}' (schema not found).`);
    return got;
  }

  get store_names(): Array<string> {
    return Object.keys(this.stores);
  }

  addStore<Item extends Storable>(store_name: string, store_schema: StoreSchema<Item>): void {
    this.stores[store_name] = store_schema as StoreSchema;
  }

  removeStore(store_name: string): void {
    delete this.stores[store_name];
  }
}
