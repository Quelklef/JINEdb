
import { Row } from './row';
import { Storable } from './storable';
import { mapError } from './errors';
import { some, Dict } from './util';
import { Connection } from './connection';
import { TransactionMode } from './transaction';
import { StorableRegistry } from './storable';
import { Selection, Cursor } from './query';
import { StoreStructure, IndexStructure } from './structure';
import { Index, IndexActual, IndexBroker } from './index';
import { Indexable, IndexableRegistry, NativelyIndexable } from './indexable';

export { StorableRegistry } from './storable';
export { IndexableRegistry } from './indexable';


/**
 * A collection of stored items.
 *
 * A store is a collection of items saved and managed by Jine.
 * Jine can natively handle storing some types (see [[NativelyStorable]]), but not all types.
 * Custom types must be registered. See [[Storable]].
 *
 * @typeparam Item The type of objects contained in this store.
 */
export interface Store<Item extends Storable> {

  /**
   * Store name.
   * Unique per-[[Database]].
   */
  name: string;

  /**
   * Store [[Index]]es.
   */
  indexes: Dict<Index<Item, Indexable>>;

  /**
   * An alias for [[Store.indexes]].
   *
   * The type is `unknown` because the type should be given by the user-defined `$$` type.
   *
   * See {@page Example}.
   */
  by: unknown;

  /**
   * Add an item to the store.
   */
  add(item: Item): Promise<void>;

  /**
   * Remove all items from the store.
   */
  clear(): Promise<void>;

  /**
   * @return The number of items in the store
   */
  count(): Promise<number>;

  /**
   * @returns An array with all items in the store.
   */
  array(): Promise<Array<Item>>;

  /**
   * Begin a query with all the items in the store
   * @returns The query executor.
   */
  all(): Selection<Item, never>;

  _transact<T>(mode: TransactionMode, callback: (store: StoreActual<Item>) => Promise<T>): Promise<T>;

}

/**
 * A [[Store]] bound to a transaction.
 *
 * A [[StoreActual]] is bound to a particular transaction.
 * Compare this to an [[StoreBroker]], which creates a new transaction on each operation.
 */
export class StoreActual<Item extends Storable> implements Store<Item> {

  /** @inheritdoc */
  name: string;
  /** @inheritdoc */
  indexes: Dict<IndexActual<Item, Indexable>>;
  /** @inheritdoc */
  by: unknown;

  _idb_store: IDBObjectStore;
  _substructures: Dict<IndexStructure<Item>>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    idb_store: IDBObjectStore;
    structure: StoreStructure;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.idb_store.name;

    this._idb_store = args.idb_store;
    this._substructures = args.structure.indexes;
    this._storables = args.storables;
    this._indexables = args.indexables;

    this.indexes = {};
    for (const index_name of Object.keys(this._substructures)) {
      this.indexes[index_name] = new IndexActual({
        idb_index: this._idb_store.index(index_name),
        name: index_name,
        structure: some(this._substructures[index_name]),
        sibling_structures: this._substructures,
        storables: this._storables,
        indexables: this._indexables,
      });
    }

    this.by = this.indexes as Record<string, Index<Item, Indexable>>;
  }

  async _mapExistingRows(mapper: (row: Row) => Row): Promise<void> {
    const cursor = new Cursor({
      idb_source: this._idb_store,
      index_structures: this._substructures,
      query: 'everything',
      storables: this._storables,
      indexables: this._indexables,
    });
    for (await cursor.init(); cursor.active; await cursor.step()) {
      await cursor._replaceRow(mapper(cursor._currentRow()));
    }
  }

  /** @inheritdoc */
  async add(item: Item): Promise<void> {
    return new Promise((resolve, reject) => {
      // Don't include the id since it's autoincrement'd
      const row: Omit<Row, 'id'> = {
        payload: this._storables.encode(item),
        traits: this._calcTraits(item),
      };

      const req = this._idb_store.add(row);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  _calcTraits(item: Item): Dict<NativelyIndexable> {
    /* Calculate all indexed traits for an item */
    const traits: Dict<NativelyIndexable> = {};
    for (const index_name of Object.keys(this._substructures)) {
      const index_structure = some(this._substructures[index_name]);
      const trait = index_structure.calc_trait(item);
      const encoded = this._indexables.encode(trait, index_structure.explode);
      const trait_name = index_name;
      traits[trait_name] = encoded;
    }
    return traits;
  }

  /** @inheritdoc */
  async clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this._idb_store.clear();
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  /** @inheritdoc */
  async count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = this._idb_store.count();
      req.onsuccess = event => {
        const count = (event.target as any).result as number;
        resolve(count);
      };
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  /** @inheritdoc */
  array(): Promise<Array<Item>> {
    return new Promise((resolve, reject) => {
      const req = this._idb_store.getAll();
      req.onsuccess = (event) => {
        const rows = (event.target as any).result as Array<Row>;
        const items = rows.map(row => this._storables.decode(row.payload));
        resolve(items);
      };
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  all(): Selection<Item, never> {
    return new Selection({
      source: this,
      query: 'everything',
      index_structures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

  /**
   * Add an index to the store.
   *
   * Only possible in a `versionchange` transaction, which is given by [[Database.upgrade]].
   *
   * @param index_name The name to give the new index
   * @param trait The path or function that defines the indexed trait (see [[Index]])
   * @param options
   * - `unqiue`: enforces unique values for this trait; see [[Index.unique]].
   * - `explode`: see [[Index.explode]].
   */
  async addIndex<Trait extends Indexable>(
    index_name: string,
    trait: string | ((item: Item) => Trait),
    options?: { unique?: boolean; explode?: boolean },
  ): Promise<Index<Item, Trait>> {

    let trait_path_or_getter = trait;

    if (typeof trait_path_or_getter === 'string') {
      const trait_path = trait_path_or_getter;
      if (!trait_path.startsWith('.'))
        throw Error("Index path must start with '.'");
      trait_path_or_getter = trait_path.slice(1);
    }

    const unique = options?.unique ?? false;
    const explode = options?.explode ?? false;

    // create idb index
    const idb_tx = this._idb_store.transaction;
    const idb_store = idb_tx.objectStore(this.name);
    const idb_index = idb_store.createIndex(
      index_name,
      `traits.${index_name}`,
      {
        unique: unique,
        multiEntry: explode,
      },
    );

    const index_structure = new IndexStructure({
      name: index_name,
      trait_path_or_getter: trait_path_or_getter,
      unique: unique,
      explode: explode,
    });

    // update existing items if needed
    if (index_structure.kind === 'derived') {
      const trait_getter = some(index_structure.getter);
      await this.all()._replaceRows((row: Row) => {
        const item = this._storables.decode(row.payload);
        row.traits[index_name] = this._indexables.encode(trait_getter(item), explode);
        return row;
      });
    }

    const index = new IndexActual<Item, Trait>({
      idb_index: idb_index,
      name: index_name,
      structure: index_structure,
      sibling_structures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
    });

    this._substructures[index_name] = index_structure;
    this.indexes[index_name] = index;

    return index;

  }

  /**
   * Remove an index from the store
   *
   * Only possible in a `versionchange` transaction, which is given by [[Database.upgrade]].
   *
   * @param name The name of the index to remove.
   */
  async removeIndex(name: string): Promise<void> {

    // remove idb index
    this._idb_store.deleteIndex(name);

    // update existing rows if needed
    if (some(this.indexes[name]).kind === 'derived') {
      await this.all()._replaceRows((row: Row) => {
        delete row.traits[name];
        return row;
      });
    }

    // remove index from this object
    delete this._substructures[name];
    delete this.indexes[name];

  }

  async _transact<T>(mode: TransactionMode, callback: (store: StoreActual<Item>) => Promise<T>): Promise<T> {
    return await callback(this);
  }

}

/**
 * A [[Store]] that is not bound to a particular transaction.
 *
 * A [[StoreBroker]] will create a new transaction on each operation.
 * Compare this to an [[StoreBroker]], which is bound to a particular operation.
 *
 * Storees accessed from [[Database.$]] and [[Connection.$]] will be [[StoreBroker]]s,
 * whereas indexes on [[Transaction.$]] are [[StoreActual]] objects.
 */
export class StoreBroker<Item extends Storable> implements Store<Item> {

  /** @inheritdoc */
  name: string;
  /** @inheritdoc */
  indexes: Dict<IndexBroker<Item, Indexable>>;
  /** @inheritdoc */
  by: unknown;

  _conn: Connection;
  _substructures: Dict<IndexStructure>;
  _storables: StorableRegistry;
  _indexables: IndexableRegistry;

  constructor(args: {
    name: string;
    conn: Connection;
    structure: StoreStructure;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this._conn = args.conn;
    this._substructures = args.structure.indexes;
    this._storables = args.storables;
    this._indexables = args.indexables;

    this.indexes = {};
    for (const index_name of Object.keys(this._substructures)) {
      this.indexes[index_name] = new IndexBroker({
        parent: this,
        name: index_name,
        structure: some(this._substructures[index_name]),
        storables: this._storables,
        indexables: this._indexables,
      });
    }
    this.by = this.indexes as Record<string, Index<Item, Indexable>>;
  }

  async _transact<T>(mode: TransactionMode, callback: (bound_store: StoreActual<Item>) => Promise<T>): Promise<T> {
    return await this._conn._transact([this.name], mode, async tx => {
      const bound_store = some(tx.stores[this.name]) as any as StoreActual<Item>;
      return await callback(bound_store);
    });
  }

  /** @inheritdoc */
  async add(item: Item): Promise<void> {
    await this._transact('rw', async bound_store => await bound_store.add(item));
  }

  /** @inheritdoc */
  async clear(): Promise<void> {
    await this._transact('rw', async bound_store => await bound_store.clear());
  }

  /** @inheritdoc */
  async count(): Promise<number> {
    return await this._transact('r', async bound_store => await bound_store.count());
  }

  /** @inheritdoc */
  async array(): Promise<Array<Item>> {
    return await this._transact('r', async bound_store => await bound_store.array());
  }

  /** @inheritdoc */
  all(): Selection<Item, never> {
    return new Selection({
      source: this,
      query: 'everything',
      index_structures: this._substructures,
      storables: this._storables,
      indexables: this._indexables,
    });
  }

}
