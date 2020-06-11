
import { some, Dict } from './util';
import { StoreBroker } from './store';
import { IndexStructure } from './structure';
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

  /**
   * Are the values in this index required to be unique?
   */
  unique: boolean;

  /**
   * If `explode` is `true`, then items' values for this index are expected to be arrays.
   * Each value in an array will be added to the index, instead of the array being added as a whole.
   */
  explode: boolean;

  /**
   * A path index is an index on an attribute of stored items.
   * A derived index is an index that tracks computed values on items.
   */
  kind: 'path' | 'derived';

  /**
   * If `this.kind === 'path'`, return the path.
   */
  trait_path?: string;

  /**
   * If `this.kind === 'derived'`, return the computing function.
   */
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

  _transact<T>(mode: TransactionMode, callback: (index: IndexActual<Item, Trait>) => Promise<T>): Promise<T>;

}


/**
 * An index that is bound to a particular transaction
 */
export class IndexActual<Item extends Storable, Trait extends Indexable> implements Index<Item, Trait> {


  name: string;
  unique: boolean;
  explode: boolean;

  kind: 'path' | 'derived';
  trait_path?: string;
  trait_getter?: (item: Item) => Trait;

  _sibling_structures: Dict<IndexStructure<Item>>;
  _idb_index: IDBIndex;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    idb_index: IDBIndex;
    name: string;
    structure: IndexStructure<Item, Trait>;
    // vvv Should include the structure for this as well
    sibling_structures: Dict<IndexStructure<Item>>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this.unique = args.structure.unique;
    this.explode = args.structure.explode;
    this.kind = args.structure.kind;
    this.trait_path = args.structure.path;
    this.trait_getter = args.structure.getter;

    this._idb_index = args.idb_index;
    this._sibling_structures = args.sibling_structures;
    this._storables = args.storables;
    this._indexables = args.indexables;
  }

  /** @inheritDoc */
  one(trait: Trait): UniqueQueryExecutor<Item, Trait> {
    return new UniqueQueryExecutor({
      source: this,
      query_spec: { equals: trait },
      index_structures: this._sibling_structures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritDoc */
  range(query_spec: QuerySpec<Trait>): QueryExecutor<Item, Trait> {
    return new QueryExecutor({
      source: this,
      query_spec: query_spec,
      index_structures: this._sibling_structures,
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

  async _transact<T>(mode: TransactionMode, callback: (index: IndexActual<Item, Trait>) => Promise<T>): Promise<T> {
    return await callback(this);
  }

}

/**
 * An index that will create its own transaction on each method call
 */
export class IndexBroker<Item extends Storable, Trait extends Indexable> implements Index<Item, Trait> {

  name: string;
  unique: boolean;
  explode: boolean;

  kind: 'path' | 'derived';
  trait_path?: string;
  trait_getter?: (item: Item) => Trait;

  _parent: StoreBroker<Item>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    parent: StoreBroker<Item>;
    name: string;
    structure: IndexStructure<Item, Trait>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this.unique = args.structure.unique;
    this.explode = args.structure.explode;
    this.kind = args.structure.kind;
    this.trait_path = args.structure.path;
    this.trait_getter = args.structure.getter;

    this._parent = args.parent;
    this._storables = args.storables;
    this._indexables = args.indexables;
  }

  async _transact<T>(mode: TransactionMode, callback: (bound_index: IndexActual<Item, Trait>) => Promise<T>): Promise<T> {
    return this._parent._transact(mode, async bound_store => {
      const bound_index = some(bound_store.indexes[this.name]) as IndexActual<Item, Trait>;
      return await callback(bound_index);
    });
  }

  /** @inheritDoc */
  one(trait: Trait): UniqueQueryExecutor<Item, Trait> {
    return new UniqueQueryExecutor({
      source: this,
      index_structures: this._parent._substructures,
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
      index_structures: this._parent._substructures,
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
