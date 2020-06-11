
import { some, Dict } from './util';
import { StoreBroker } from './store';
import { IndexStructure } from './structure';
import { TransactionMode } from './transaction';
import { Storable, StorableRegistry } from './storable';
import { Indexable, IndexableRegistry } from './indexable';
import { Query, Selection, SelectionUnique } from './query';

/**
 * An index on an object store.
 *
 * An index is a way of organizing stored items to be queried later.
 * You set up an index to keep track of particular attributes of your
 * items (such as a `.id` property). The attribute that you track is known
 * as the *trait*. You can then query indexes to find items based on
 * their traits.
 *
 * @typeparam Item The type of the item stored on the [[Store]] that this indexes is connected to.
 * @typeparam Trait The type of the traits being indexed by.
 */
export interface Index<Item extends Storable, Trait extends Indexable> {

  /**
   * Name of the index.
   * Index names are unique for a particular store.
   */
  name: string;

  /**
   * Indexes come in two flavors: path indexes and derived indexes.
   *
   * With a *path index*, items are indexed on existing properties.
   * For example, if we're storing array objects, we may index by `.length`.
  * The path is stored in [[Index.trait_path]].
   *
   * With a *derived index*, items are indexed on calculated values.
   * For example, storing an array object, we may want to index by whether or not the array has a duplicate value.
   * Then we would index by the function `(item: Array) => item.length !== new Set(item).size` (or a more efficient alternative).
   * This function is stored in [[Index.trait_getter]].
   */
  kind: 'path' | 'derived';

  /**
   * If `this.kind === 'path'`, return the trait path.
   */
  trait_path?: string;

  /**
   * If `this.kind === 'derived'`, return the trait computing function.
   */
  trait_getter?: (item: Item) => Trait;

  /**
   * Are the values in this index required to be unique?
   */
  unique: boolean;

  /**
   * If `explode` is `true`, then items' values for this index are expected to be arrays.
   * Each value in an array will be added to the index, instead of the array being added as a whole.
   *
   * For instance, say we're storing `type User = { id: number, liked_post_ids: Array<number> }` objects.
   * We may have an index called `liked` which is intended to organize users by what posts they've liked.
   * If the index is *not* exploding, then the user `{ id: 1, liked_post_ids: [1, 2, 3] }` will match
   * a query for `[1, 2, 3]` but not a query for `1`, for `2`, or for `3`.
   * But if the index *is* exploding, then this same user will match a query
   * for each of `1`, `2`, and `3`, but not a query for `[1, 2, 3]`.
   */
  explode: boolean;

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

  // TODO: perhaps all selection methods should become just .select
  /**
   * Select a single item by trait.
   * Usable on unique indexes only.
   */
  one(trait: Trait): SelectionUnique<Item, Trait>;

  /**
   * Select several items by a range of traits.
   */
  range(query: Query<Trait>): Selection<Item, Trait>;

  _transact<T>(mode: TransactionMode, callback: (index: IndexActual<Item, Trait>) => Promise<T>): Promise<T>;

}


/**
 * An [[Index]] bound to a transaction.
 *
 * An [[IndexActual]] is bound to a particular transaction.
 * Compare this to an [[IndexBroker]], which creates a new transaction on each operation.
 */
export class IndexActual<Item extends Storable, Trait extends Indexable> implements Index<Item, Trait> {

  /** @inheritdoc */
  name: string;
  /** @inheritdoc */
  unique: boolean;
  /** @inheritdoc */
  explode: boolean;

  /** @inheritdoc */
  kind: 'path' | 'derived';
  /** @inheritdoc */
  trait_path?: string;
  /** @inheritdoc */
  trait_getter?: (item: Item) => Trait;

  _sibling_structures: Dict<IndexStructure<Item>>;
  _idb_index: IDBIndex;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    idb_index: IDBIndex;
    name: string;
    structure: IndexStructure<Item, Trait>;
    // vvv The value of sibling_structures should include the structure for this index as well
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

  /** @inheritdoc */
  one(trait: Trait): SelectionUnique<Item, Trait> {
    return new SelectionUnique({
      source: this,
      query: { equals: trait },
      index_structures: this._sibling_structures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritdoc */
  range(query: Query<Trait>): Selection<Item, Trait> {
    return new Selection({
      source: this,
      query: query,
      index_structures: this._sibling_structures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritdoc */
  async get(trait: Trait): Promise<Item> {
    return await this.one(trait).get();
  }

  /** @inheritdoc */
  async find(trait: Trait): Promise<Array<Item>> {
    return await this.range({ equals: trait }).array();
  }

  async _transact<T>(mode: TransactionMode, callback: (index: IndexActual<Item, Trait>) => Promise<T>): Promise<T> {
    return await callback(this);
  }

}

/**
 * An [[Index]] that is not bound to a particular transaction.
 *
 * An [[IndexBroker]] will create a new transaction on each operation.
 * Compare this to an [[IndexAcutal]], which is bound to a particular operation.
 *
 * Indexes accessed from [[Database.$]] and [[Connection.$]] will be [[IndexBroker]]s,
 * whereas indexes on [[Transaction.$]] are [[IndexActual]] objects.
 */
export class IndexBroker<Item extends Storable, Trait extends Indexable> implements Index<Item, Trait> {

  /** @inheritdoc */
  name: string;
  /** @inheritdoc */
  unique: boolean;
  /** @inheritdoc */
  explode: boolean;

  /** @inheritdoc */
  kind: 'path' | 'derived';
  /** @inheritdoc */
  trait_path?: string;
  /** @inheritdoc */
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

  /** @inheritdoc */
  one(trait: Trait): SelectionUnique<Item, Trait> {
    return new SelectionUnique({
      source: this,
      index_structures: this._parent._substructures,
      query: { equals: trait },
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritdoc */
  range(query: Query<Trait>): Selection<Item, Trait> {
    return new Selection({
      source: this,
      query: query,
      index_structures: this._parent._substructures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /** @inheritdoc */
  async get(trait: Trait): Promise<Item> {
    return await this.one(trait).get();
  }

  /** @inheritdoc */
  async find(trait: Trait): Promise<Array<Item>> {
    return await this.range({ equals: trait }).array();
  }

}
