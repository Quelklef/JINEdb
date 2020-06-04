
import { Row } from './row';
import { Storable } from './storable';
import { Connection } from './connection';
import { some, Dict } from './util';
import { TransactionMode } from './transaction';
import { StorableRegistry } from './storable';
import { QueryExecutor, Cursor } from './query';
import { Indexable, IndexableRegistry, NativelyIndexable } from './indexable';
import { IndexStructure, Index, BoundIndex, AutonomousIndex } from './index';

export { StorableRegistry } from './storable';
export { IndexableRegistry } from './indexable';


/**
 * The structure of an object store
 * @typeParam Item The type of objects contained in this store.
 */
export class StoreStructure<Item extends Storable> {

  /**
   * The name of the store
   */
  name: string;

  /**
   * The structure of the store's indexes
   */
  index_structures: Dict<string, IndexStructure<Item, Indexable>>;

  constructor(args: {
    name: string;
    index_structures: Dict<string, IndexStructure<Item, Indexable>>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.name = args.name;
    this.index_structures = args.index_structures;
    this.storables = args.storables;
    this.indexables = args.indexables;
  }

  /**
   * The names of the store's indexes.
   * Equivalent to `Object.keys(this.index_structures)`
   * @returns The store names
   */
  get index_names(): Set<string> {
    return new Set(Object.keys(this.index_structures));
  }

  storables: StorableRegistry;
  indexables: IndexableRegistry;

}

/**
 * Generic interface for Jine stores.
 *
 * A store is a collection of items saved and managed by Jine.
 * Jine can natively handle storing a large number of types, but not all.
 * Custom types must be registered. See [[Storable]].
 *
 * @typeParam Item The type of objects contained in this store.
 */
export interface Store<Item extends Storable> {

  /**
   * Store structure
   */
  readonly structure: StoreStructure<Item>;

  /**
   * Store indexes
   */
  readonly indexes: Dict<string, Index<Item, Indexable>>;

  /**
   * Add an item to the store.
   */
  add(item: Item): Promise<void>;

  /**
   * Remove all items from the store.
   */
  clear(): Promise<void>;

  /**
   * @returns The number of items in the store.
   */
  count(): Promise<number>;

  /**
   * @returns An array with all items in the store.
   */
  all(): Promise<Array<Item>>;

  qall(): QueryExecutor<Item, never>;

  _transact<T>(mode: TransactionMode, callback: (store: BoundStore<Item>) => Promise<T>): Promise<T>;

}

/**
 * A store that is bound to a particular transaction
 */
export class BoundStore<Item extends Storable> implements Store<Item> {

  /** @inheritDoc */
  readonly structure: StoreStructure<Item>;

  /** @inheritDoc */
  readonly indexes: Dict<string, BoundIndex<Item, Indexable>>;

  // user-facing dual to .indexes
  by: Dict<string, Index<Item, Indexable>>;

  readonly _idb_store: IDBObjectStore;

  constructor(
    structure: StoreStructure<Item>,
    idb_store: IDBObjectStore,
  ) {
    this.structure = structure;

    this._idb_store = idb_store;

    this.indexes = {};
    for (const index_name of structure.index_names) {
      const index_structure = some(structure.index_structures[index_name]);
      const idb_index = this._idb_store.index(index_name);
      this.indexes[index_name] = new BoundIndex(index_structure, idb_index);
    }

    this.by = this.indexes;
  }

  async _mapExistingRows(mapper: (row: Row) => Row): Promise<void> {
    const cursor = new Cursor({
      idb_source: this._idb_store,
      query_spec: { everything: true },
      storables: this.structure.storables,
      indexables: this.structure.indexables,
    });
    await cursor.init();
    while (cursor.active) {
      await cursor._replaceRow(mapper(cursor._currentRow()));
    }
  }

  /** @inheritDoc */
  async add(item: Item): Promise<void> {
    return new Promise((resolve, reject) => {
      // Don't include the id since it's autoincrement'd
      const row: Omit<Row, 'id'> = {
        payload: this.structure.storables.encode(item),
        traits: this._calcTraits(item),
      };

      const req = this._idb_store.add(row);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

  _calcTraits(item: Item): Dict<string, NativelyIndexable> {
    /* Calculate all indexed traits for an item */
    const traits: Dict<string, NativelyIndexable> = {};
    for (const index_name of this.structure.index_names) {
      const index = some(this.indexes[index_name]);
      const trait_name = index_name;
      const trait = index._get_trait(item);
      const encoded = this.structure.indexables.encode(trait, index.structure.explode);
      traits[trait_name] = encoded;
    }
    return traits;
  }

  /** @inheritDoc */
  async clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this._idb_store.clear();
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

  /** @inheritDoc */
  async count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = this._idb_store.count();
      req.onsuccess = event => {
        const count = (event.target as any).result as number;
        resolve(count);
      };
      req.onerror = _event => reject(req.error);
    });
  }

  /** @inheritDoc */
  async all(): Promise<Array<Item>> {
    return new Promise((resolve, reject) => {
      const req = this._idb_store.getAll();
      req.onsuccess = (event) => {
        const rows = (event.target as any).result as Array<Row>;
        const items = rows.map(row => this.structure.storables.decode(row.payload));
        resolve(items);
      };
      req.onerror = _event => reject(req.error);
    });
  }

  qall(): QueryExecutor<Item, never> {
    return new QueryExecutor({
      source: this,
      query_spec: { everything: true },
      storables: this.structure.storables,
      indexables: this.structure.indexables,
    });
  }

  /**
   * Add an index to the store
   *
   * @remark This is an asynchronous operation since derived indexes' values
   * will be added to existing items in the db.
   */
  async addIndex<Trait extends Indexable>(
    name: string,
    trait: string | ((item: Item) => Trait),
    options?: { unique?: boolean; explode?: boolean },
  ): Promise<void> {

    if (typeof trait === 'string') {
      if (!trait.startsWith('.'))
        throw Error("Index path must start with '.'");
      trait = trait.slice(1);
    }

    // create idb index
    const idb_tx = this._idb_store.transaction;
    const idb_store = idb_tx.objectStore(this.structure.name);
    const idb_index = idb_store.createIndex(name, `traits.${name}`, {
      unique: options?.unique ?? false,
      multiEntry: options?.explode ?? false,
    });

    // update existing items if needed
    if (typeof trait !== 'string') {
      const trait_getter = trait as (item: Item) => Trait;
      await this.qall()._replaceRows((row: Row) => {
        const item = this.structure.storables.decode(row.payload);
        row.traits[name] = this.structure.indexables.encode(trait_getter(item));
        return row;
      });
    }

    // create Index object
    const index_structure = new IndexStructure({
      name: name,
      unique: options?.unique ?? false,
      explode: options?.explode ?? false,
      parent_store_name: this.structure.name,
      trait_path_or_getter: trait,
      storables: this.structure.storables,
      indexables: this.structure.indexables,
    });
    const index = new BoundIndex(index_structure, idb_index);
    this.structure.index_structures[name] = index_structure;
    this.indexes[name] = index;

  }

  /**
   * Remove an index from the store
   *
   * @remark This is an asynchronous operation since derived indexes'
   * calculated values will be purged from the db.
   */
  async removeIndex(name: string): Promise<void> {

    // remove idb index
    this._idb_store.deleteIndex(name);

    // update existing rowsif needed
    if (some(this.indexes[name]).structure.kind === 'derived') {
      await this.qall()._replaceRows((row: Row) => {
        delete row.traits[name];
        return row;
      });
    }

    // remove index from this object
    delete this.structure.index_structures[name];
    delete this.indexes[name];

  }

  async _transact<T>(mode: TransactionMode, callback: (store: BoundStore<Item>) => Promise<T>): Promise<T> {
    return await callback(this);
  }

}

/**
 * A store that will start a new transaction on each method call
 */
export class AutonomousStore<Item extends Storable> implements Store<Item> {

  /** @inheritDoc */
  readonly structure: StoreStructure<Item>;

  /** @inheritDoc */
  readonly indexes: Dict<string, AutonomousIndex<Item, Indexable>>;

  readonly by: Dict<string, Index<Item, Indexable>>;

  readonly _conn: Connection;

  constructor(structure: StoreStructure<Item>, conn: Connection) {
    this.structure = structure;
    this.indexes = {};
    for (const index_name of structure.index_names) {
      const index_structure = some(structure.index_structures[index_name]);
      this.indexes[index_name] = new AutonomousIndex(index_structure, this);
    }
    this.by = this.indexes;
    this._conn = conn;
  }

  async _transact<T>(mode: TransactionMode, callback: (bound_store: BoundStore<Item>) => Promise<T>): Promise<T> {
    return await this._conn._transact([this.structure.name], mode, async tx => {
      const bound_store = some(tx.stores[this.structure.name]) as any as BoundStore<Item>;
      return await callback(bound_store);
    });
  }

  /** @inheritDoc */
  async add(item: Item): Promise<void> {
    await this._transact('rw', async bound_store => await bound_store.add(item));
  }

  /** @inheritDoc */
  async clear(): Promise<void> {
    await this._transact('rw', async bound_store => await bound_store.clear());
  }

  /** @inheritDoc */
  async count(): Promise<number> {
    return await this._transact('r', async bound_store => await bound_store.count());
  }

  /** @inheritDoc */
  async all(): Promise<Array<Item>> {
    return await this._transact('r', async bound_store => await bound_store.all());
  }

  /** @inheritDoc */
  qall(): QueryExecutor<Item, never> {
    return new QueryExecutor({
      source: this,
      query_spec: { everything: true },
      storables: this.structure.storables,
      indexables: this.structure.indexables,
    });
  }

}
