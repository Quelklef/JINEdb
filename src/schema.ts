
import { W, M } from 'wrongish';

import { Dict } from './util';
import { JineError, JineNoSuchStoreError, JineNoSuchIndexError } from './errors';

// Precisely, the schema contains the information that is controlled
// by migrations

export class IndexSchema<Item, Trait> {
  name: string;
  unique: boolean;
  explode: boolean;

  traitPathOrGetter: string | ((item: Item) => Trait);

  // path - string
  // derived - function
  get kind(): 'path' | 'derived' {
    return typeof this.traitPathOrGetter === 'string' ? 'path' : 'derived';
  }

  get path(): string {
    if (this.kind !== 'path')
      throw new JineError('Cannot get .path on non-path index');
    return this.traitPathOrGetter as string;
  }

  get getter(): (item: Item) => Trait {
    if (this.kind !== 'derived')
      throw new JineError('Cannot get .getter on non-derived index');
    return this.traitPathOrGetter as ((item: Item) => Trait);
  }

  constructor(args: {
    name: string;
    unique: boolean;
    explode: boolean;
    traitPathOrGetter: string | ((item: Item) => Trait);
  }) {
    this.name = args.name;
    this.unique = args.unique;
    this.explode = args.explode;
    this.traitPathOrGetter = args.traitPathOrGetter;
  }

  calcTrait(item: Item): Trait {
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

  constructor(args: {
    name: string;
    indexes: Dict<IndexSchema<Item, unknown>>;
  }) {
    this.name = args.name;
    this.indexes = args.indexes;
  }

  index(indexName: string): IndexSchema<Item, unknown> {
    const got = this.indexes[indexName];
    if (got === undefined)
      throw new JineNoSuchIndexError({ indexName });
    return got;
  }

  get indexNames(): Set<string> {
    return new Set(Object.keys(this.indexes));
  }

  addIndex(indexName: string, indexSchema: IndexSchema<Item, unknown>): void {
    this.indexes[indexName] = indexSchema;
  }

  removeIndex(indexName: string): void {
    delete this.indexes[indexName];
  }
}

export class DatabaseSchema {
  name: string;
  private stores: Dict<StoreSchema<unknown>>;

  constructor(args: {
    name: string;
    stores: Dict<StoreSchema<unknown>>;
  }) {
    this.name = args.name;
    this.stores = args.stores;
  }

  store(storeName: string): StoreSchema<unknown> {
    const got = this.stores[storeName];
    if (got === undefined)
      throw new JineNoSuchStoreError({ storeName });
    return got;
  }

  get storeNames(): Set<string> {
    return new Set(Object.keys(this.stores));
  }

  get indexNames(): Set<[string, string]> {
    return this.storeNames[W.flatMap](storeName => M.a(this.stores[storeName]).indexNames[W.map](indexName => [storeName, indexName]));
  }

  addStore<Item>(storeName: string, storeSchema: StoreSchema<Item>): void {
    this.stores[storeName] = storeSchema as StoreSchema<unknown>;
  }

  removeStore(storeName: string): void {
    delete this.stores[storeName];
  }
}

