
import * as storable from './storable';
import * as indexable from './indexable';

type Storable = storable.Storable;
type Indexable = indexable.Indexable;
type NativelyIndexable = indexable.NativelyIndexable;

import { Row } from './row';
import { Cursor } from './query';
import { Connection } from './connection';
import { some, Dict } from './util';
import { TransactionMode } from './transaction';
import { IndexStructure, Index, BoundIndex, AutonomousIndex } from './index';

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
  }) {
    this.name = args.name;
    this.index_structures = args.index_structures;
  }

  /**
   * The names of the store's indexes.
   * Equivalent to `Object.keys(this.index_structures)`
   * @returns The store names
   */
  get index_names(): Set<string> {
    return new Set(Object.keys(this.index_structures));
  }

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
  }

  _withShorthand(): this {
    for (const index_name of this.structure.index_names) {
      const index = some(this.indexes[index_name]);
      (this as any)['$' + index_name] = index;
    }
    this._withShorthand = () => this;
    return this;
  }

  async _mapExistingRows(mapper: (row: Row) => Row): Promise<void> {
    const cursor = new Cursor(this._idb_store, { everything: true });
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
        payload: storable.encode(item),
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
      const encoded = indexable.encode(trait, index.structure.explode);
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
        const items = rows.map(row => storable.decode(row.payload));
        resolve(items);
      };
      req.onerror = _event => reject(req.error);
    });
  }

  /**
   * Add an index to the store
   */
  addIndex<Trait extends Indexable>(
    $name: string,
    trait: string | ((item: Item) => Trait),
    options?: { unique?: boolean; explode?: boolean },
  ): void {
    if (!$name.startsWith('$'))
      throw Error("Index name must begin with '$'");
    const name = $name.slice(1);
    const idb_tx = this._idb_store.transaction;
    const idb_store = idb_tx.objectStore(this.structure.name);
    const idb_index = idb_store.createIndex(name, `traits.${name}`, {
      unique: options?.unique ?? false,
      multiEntry: options?.explode ?? false,
    });

    if (typeof trait === 'string') {
      if (!trait.startsWith('.'))
        throw Error("Index path must start with '.'");
      trait = trait.slice(1);
    }

    const index_structure = new IndexStructure({
      name: name,
      unique: options?.unique ?? false,
      explode: options?.explode ?? false,
      parent_store_name: this.structure.name,
      trait_path_or_getter: trait,
    });
    const index = new BoundIndex(index_structure, idb_index);
    this.structure.index_structures[name] = index_structure;
    this.indexes[name] = index;
    (this as any)[$name] = index;
  }

  /**
   * Remove an index from the store
   */
  removeIndex($name: string): void {
    const name = $name.slice(1);
    this._idb_store.deleteIndex(name);
    delete this.structure.index_structures[name];
    delete this.indexes[name];
    delete (this as any)[$name];
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

  readonly _conn: Connection;

  constructor(structure: StoreStructure<Item>, conn: Connection) {
    this.structure = structure;
    this.indexes = {};
    for (const index_name of structure.index_names) {
      const index_structure = some(structure.index_structures[index_name]);
      this.indexes[index_name] = new AutonomousIndex(index_structure, this);
    }
    this._conn = conn;
  }

  _withShorthand(): this {
    for (const index_name of this.structure.index_names) {
      const index_structure = some(this.structure.index_structures[index_name]);
      const index = new AutonomousIndex(index_structure, this);
      (this as any)['$' + index_name] = index;
    }
    this._withShorthand = () => this;
    return this;
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

}
