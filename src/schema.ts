
import { Dict } from './util';
import { Codec } from './codec';

import * as err from './errors';

// Precisely, the schema contains the information that is controlled
// by migrations

export class IndexSchema<Item, Trait> {
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

  codec: Codec;

  constructor(args: {
    name: string;
    unique: boolean;
    explode: boolean;
    trait_path_or_getter: string | ((item: Item) => Trait);
    codec: Codec;
  }) {
    this.name = args.name;
    this.unique = args.unique;
    this.explode = args.explode;
    this.codec = args.codec;
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

export class StoreSchema<Item> {
  name: string;
  private indexes: Dict<IndexSchema<Item, unknown>>;

  codec: Codec;

  constructor(args: {
    name: string;
    indexes: Dict<IndexSchema<Item, unknown>>;
    codec: Codec;
  }) {
    this.name = args.name;
    this.indexes = args.indexes;
    this.codec = args.codec;
  }

  index(index_name: string): IndexSchema<Item, unknown> {
    const got = this.indexes[index_name];
    if (got === undefined)
      throw new err.JineNoSuchIndexError(`No index named '${index_name}' (schema not found).`);
    return got;
  }

  get index_names(): Array<string> {
    return Object.keys(this.indexes);
  }

  addIndex(index_name: string, index_schema: IndexSchema<Item, unknown>): void {
    this.indexes[index_name] = index_schema;
  }

  removeIndex(index_name: string): void {
    delete this.indexes[index_name];
  }
}

export class DatabaseSchema {
  name: string;
  private stores: Dict<StoreSchema<unknown>>;
  codec: Codec;

  constructor(args: {
    name: string;
    stores: Dict<StoreSchema<unknown>>;
    codec: Codec;
  }) {
    this.name = args.name;
    this.stores = args.stores;
    this.codec = args.codec;
  }

  store(store_name: string): StoreSchema<unknown> {
    const got = this.stores[store_name];
    if (got === undefined)
      throw new err.JineNoSuchStoreError(`No store named '${store_name}' (schema not found).`);
    return got;
  }

  get store_names(): Array<string> {
    return Object.keys(this.stores);
  }

  addStore<Item>(store_name: string, store_schema: StoreSchema<Item>): void {
    this.stores[store_name] = store_schema as StoreSchema<unknown>;
  }

  removeStore(store_name: string): void {
    delete this.stores[store_name];
  }
}
