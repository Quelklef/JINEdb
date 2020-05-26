
import * as storable from './storable';
import * as indexable from './indexable';

type Storable = storable.Storable;
type Indexable = indexable.Indexable;
type NativelyIndexable = indexable.NativelyIndexable;

import { Row } from './row';
import { Cursor } from './query';
import { Connection } from './connection';
import { some, Dict, Codec } from './util';
import { Transaction, TransactionMode } from './transaction';
import { IndexStructure, Index, BoundIndex, AutonomousIndex } from './index';

export class StoreStructure<Item extends Storable> {

  public name: string;
  public item_codec: Codec<Item, Storable>;
  public index_structures: Dict<string, IndexStructure<Item, Indexable>>;

  constructor(args: {
    name: string;
    item_codec: Codec<Item, Storable>;
    index_structures: Dict<string, IndexStructure<Item, Indexable>>;
  }) {
    this.name = args.name;
    this.item_codec = args.item_codec;
    this.index_structures = args.index_structures;
  }

  get index_names(): Set<string> {
    return new Set(Object.keys(this.index_structures));
  }

}

export interface Store<Item extends Storable> {

  readonly structure: StoreStructure<Item>;
  readonly indexes: Dict<string, Index<Item, Indexable>>;

  add(item: Item): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  all(): Promise<Array<Item>>;

  _transact<T>(mode: TransactionMode, callback: (store: BoundStore<Item>) => Promise<T>): Promise<T>;

}

export class BoundStore<Item extends Storable> implements Store<Item> {

  readonly structure: StoreStructure<Item>;
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

    // TODO: this seems out-of-place
    for (const [index_name, index] of Object.entries(this.indexes)) {
      (this as any)['$' + index_name] = index;
    }
  }

  async _mapExistingRows(mapper: (row: Row) => Row): Promise<void> {
    const cursor = new Cursor(this._idb_store, null, this.structure.item_codec);
    await cursor.init();
    while (cursor.active) {
      await cursor._replaceRow(mapper(cursor._currentRow()));
    }
  }

  async add(item: Item): Promise<void> {
    return new Promise((resolve, reject) => {
      // Don't include the id since it's autoincrement'd
      const row: Omit<Row, 'id'> = {
        payload: storable.encode(this.structure.item_codec.encode(item)),
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

  async clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this._idb_store.clear();
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

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

  async all(): Promise<Array<Item>> {
    return new Promise((resolve, reject) => {
      const req = this._idb_store.getAll();
      req.onsuccess = (event) => {
        const rows = (event.target as any).result as Array<Row>;
        const items = rows.map(row => this.structure.item_codec.decode(storable.decode(row.payload)));
        resolve(items);
      };
      req.onerror = _event => reject(req.error);
    });
  }

  async _transact<T>(mode: TransactionMode, callback: (store: BoundStore<Item>) => Promise<T>): Promise<T> {
    return await callback(this);
  }

}

export class AutonomousStore<Item extends Storable> implements Store<Item> {

  public readonly structure: StoreStructure<Item>;
  public readonly indexes: Dict<string, AutonomousIndex<Item, Indexable>>;

  private readonly _conn: Connection;

  constructor(structure: StoreStructure<Item>, conn: Connection) {
    this.structure = structure;
    this.indexes = {};
    for (const index_name of structure.index_names) {
      const index_structure = some(structure.index_structures[index_name]);
      this.indexes[index_name] = new AutonomousIndex(index_structure, this);
    }
    this._conn = conn;
  }

  withShorthand(): AutonomousStore<Item> {
    for (const index_name of this.structure.index_names) {
      const index_structure = some(this.structure.index_structures[index_name]);
      const index = new AutonomousIndex(index_structure, this);
      (this as any)['$' + index_name] = index;
    }
    return this;
  }

  async _transact<T>(mode: TransactionMode, callback: (bound_store: BoundStore<Item>) => Promise<T>): Promise<T> {
    return await this._conn._transact([this.structure.name], mode, async tx => {
      const bound_store = some(tx.stores[this.structure.name]) as any as BoundStore<Item>;
      return await callback(bound_store);
    });
  }

  async add(item: Item): Promise<void> {
    await this._transact('rw', async bound_store => await bound_store.add(item));
  }

  async clear(): Promise<void> {
    await this._transact('rw', async bound_store => await bound_store.clear());
  }

  async count(): Promise<number> {
    return await this._transact('r', async bound_store => await bound_store.count());
  }

  async all(): Promise<Array<Item>> {
    return await this._transact('r', async bound_store => await bound_store.all());
  }

}
