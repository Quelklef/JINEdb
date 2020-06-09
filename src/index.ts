
import { some } from './util';
import { IndexStructure } from './structure';
import { AutonomousStore } from './store';
import { TransactionMode } from './transaction';
import { Storable, StorableRegistry } from './storable';
import { Indexable, IndexableRegistry } from './indexable';
import { QuerySpec, QueryExecutor, UniqueQueryExecutor } from './query';

/**
 * Generic interface for indexes.
 *
 * An index is a way of organizing stored items to be queried later.
 *
 * Indexes keep track of so-called 'traits' of your items; you may then
 * query the index to find items with a particular trait or within a certain
 * range of traits.
 */
export interface Index<Item extends Storable, Trait extends Indexable> {

  /**
   * Name of the index. Index names are unique for a particular store.
   */
  name: string;

  unique: boolean;
  explode: boolean;

  kind: 'path' | 'derived';
  trait_path?: string;
  trait_getter?: (item: Item) => Trait;

  /**
   * Get an item by trait.
   * Usable on unique indexes only.
   * Throws if no item is found.
   * @returns The found item.
   */
  get(trait: Trait): Promise<Item>;

  /**
   * Find all items matching a given trait.
   * @returns The found items.
   */
  find(trait: Trait): Promise<Array<Item>>;

  /**
   * Select a single item by trait.
   * Usable on unique indexes only.
   */
  one(trait: Trait): UniqueQueryExecutor<Item, Trait>;

  /**
   * Select several items by a range of traits.
   */
  range(spec: QuerySpec<Trait>): QueryExecutor<Item, Trait>;

  _transact<T>(mode: TransactionMode, callback: (index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T>;

}

/**
 * An index that is bound to a particular transaction
 */
export class BoundIndex<Item extends Storable, Trait extends Indexable> implements Index<Item, Trait> {

  _structure: IndexStructure<Item, Trait>;

  name: string;
  unique: boolean;
  explode: boolean;

  kind: 'path' | 'derived';
  trait_path?: string;
  trait_getter?: (item: Item) => Trait;

  _idb_index: IDBIndex;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    idb_index: IDBIndex;
    name: string;
    structure: IndexStructure<Item, Trait>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this.unique = args.structure.unique;
    this.explode = args.structure.explode;

    if (typeof args.structure.trait_info === 'string') {
      this.kind = 'path';
      this.trait_path = args.structure.trait_info;
    } else {
      this.kind = 'derived';
      this.trait_getter = args.structure.trait_info;
    }

    this._idb_index = args.idb_index;
    this._structure = args.structure;
    this._storables = args.storables;
    this._indexables = args.indexables;
  }

  _get_trait(item: Item): Trait {
    if (this.kind === 'path') {
      return (item as any)[some(this.trait_path)];
    } else {
      return some(this.trait_getter)(item);
    }
  }

  /** @inheritDoc */
  one(trait: Trait): UniqueQueryExecutor<Item, Trait> {
    return new UniqueQueryExecutor({
      source: this,
      query_spec: { equals: trait },
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritDoc */
  range(query_spec: QuerySpec<Trait>): QueryExecutor<Item, Trait> {
    return new QueryExecutor({
      source: this,
      query_spec: query_spec,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritDoc */
  async get(trait: Trait): Promise<Item> {
    return await this.one(trait).get();
  }

  /** @inheritDoc */
  async find(trait: Trait): Promise<Array<Item>> {
    return await this.range({ equals: trait }).array();
  }

  async _transact<T>(mode: TransactionMode, callback: (index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T> {
    return await callback(this);
  }

}

/**
 * An index that will create its own transaction on each method call
 */
export class AutonomousIndex<Item extends Storable, Trait extends Indexable> implements Index<Item, Trait> {

  name: string;
  unique: boolean;
  explode: boolean;

  kind: 'path' | 'derived';
  trait_path?: string;
  trait_getter?: (item: Item) => Trait;

  _parent: AutonomousStore<Item>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    parent: AutonomousStore<Item>;
    name: string;
    structure: IndexStructure<Item, Trait>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this.unique = args.structure.unique;
    this.explode = args.structure.explode;

    this._parent = args.parent;
    this._storables = args.storables;
    this._indexables = args.indexables;

    if (typeof args.structure.trait_info === 'string') {
      this.kind = 'path';
      this.trait_path = args.structure.trait_info;
    } else {
      this.kind = 'derived';
      this.trait_getter = args.structure.trait_info;
    }
  }

  async _transact<T>(mode: TransactionMode, callback: (bound_index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T> {
    return this._parent._transact(mode, async bound_store => {
      const bound_index = some(bound_store.indexes[this.name]) as BoundIndex<Item, Trait>;
      return await callback(bound_index);
    });
  }

  /** @inheritDoc */
  one(trait: Trait): UniqueQueryExecutor<Item, Trait> {
    return new UniqueQueryExecutor({
      source: this,
      query_spec: { equals: trait },
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritDoc */
  range(query_spec: QuerySpec<Trait>): QueryExecutor<Item, Trait> {
    return new QueryExecutor({
      source: this,
      query_spec: query_spec,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritDoc */
  async get(trait: Trait): Promise<Item> {
    return await this.one(trait).get();
  }

  /** @inheritDoc */
  async find(trait: Trait): Promise<Array<Item>> {
    return await this.range({ equals: trait }).array();
  }

}
