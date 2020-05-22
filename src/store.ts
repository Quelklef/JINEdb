
import { Row } from './row';
import { Cursor } from './cursor';
import { Storable } from './storable';
import { some, Dict } from './util';
import { Connection } from './connection';
import { IndexableTrait } from './traits';
import { Transaction, TransactionMode } from './transaction';
import { ItemCodec, fullDecode, fullEncode } from './codec';
import { IndexSchema, Index, BoundIndex, AutonomousIndex } from './index';

export class StoreSchema<Item extends Storable> {

  public name: string;
  public item_codec: ItemCodec<Item>;
  public index_schemas: Dict<string, IndexSchema<Item, IndexableTrait>>;

  constructor(args: {
    name: string;
    item_codec: ItemCodec<Item>;
    index_schemas: Dict<string, IndexSchema<Item, IndexableTrait>>;
  }) {
    this.name = args.name;
    this.item_codec = args.item_codec;
    this.index_schemas = args.index_schemas;
  }

  get index_names(): Set<string> {
    return new Set(Object.keys(this.index_schemas));
  }

}

export interface Store<Item extends Storable> {

  readonly schema: StoreSchema<Item>;
  readonly indexes: Dict<string, Index<Item, IndexableTrait>>;

  add(item: Item): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  all(): Promise<Array<Item>>;

}

export class BoundStore<Item extends Storable> implements Store<Item> {

  public readonly schema: StoreSchema<Item>;
  public readonly indexes: Dict<string, BoundIndex<Item, IndexableTrait>>;

  private readonly _idb_store: IDBObjectStore;

  constructor(
    schema: StoreSchema<Item>,
    idb_store: IDBObjectStore,
  ) {
    this.schema = schema;

    this._idb_store = idb_store;

    this.indexes = {};
    for (const index_name of schema.index_names) {
      const index_schema = some(schema.index_schemas[index_name]);
      const idb_index = this._idb_store.index(index_name);
      this.indexes[index_name] = new BoundIndex(index_schema, idb_index);
    }

    // TODO: this seems out-of-place
    for (const [index_name, index] of Object.entries(this.indexes)) {
      (this as any)['$' + index_name] = index;
    }
  }

  async _mapExistingRows(f: (r: Row) => Row): Promise<void> {
    const cursor_req = this._idb_store.openCursor();
    const cursor = await Cursor.new(cursor_req, this.schema.item_codec);
    await cursor._replaceAllRows(f);
  }

  async add(item: Item): Promise<void> {
    return new Promise((resolve, reject) => {
      // Don't include the id since it's autoincrement'd
      const row: Omit<Row, 'id'> = {
        payload: fullEncode(item, this.schema.item_codec),
        traits: this._calcTraits(item),
      };

      const req = this._idb_store.add(row);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

  _calcTraits(item: Item): Dict<string, IndexableTrait> {
    /* Calculate all indexed traits for an item */
    const traits: Dict<string, IndexableTrait> = {};
    for (const index_name of this.schema.index_names) {
      const index = some(this.indexes[index_name]);
      const trait_name = index_name;
      const trait = index._get_trait(item);
      traits[trait_name] = trait;
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
        const items = rows.map(row => fullDecode(row.payload, this.schema.item_codec));
        resolve(items);
      };
      req.onerror = _event => reject(req.error);
    });
  }

}

export class AutonomousStore<Item extends Storable> implements Store<Item> {

  public readonly schema: StoreSchema<Item>;
  public readonly indexes: Dict<string, AutonomousIndex<Item, IndexableTrait>>;

  private readonly _conn: Connection;

  constructor(schema: StoreSchema<Item>, conn: Connection) {
    this.schema = schema;
    this.indexes = {};
    for (const index_name of schema.index_names) {
      const index_schema = some(schema.index_schemas[index_name]);
      this.indexes[index_name] = new AutonomousIndex(index_schema, this);
    }
    this._conn = conn;
  }

  withShorthand(): AutonomousStore<Item> {
    for (const index_name of this.schema.index_names) {
      const index_schema = some(this.schema.index_schemas[index_name]);
      const index = new AutonomousIndex(index_schema, this);
      (this as any)['$' + index_name] = index;
    }
    return this;
  }

  async _transact<T>(mode: TransactionMode, callback: (bound_store: BoundStore<Item>) => Promise<T>): Promise<T> {
    return await this._conn._transact([this.schema.name], mode, async tx => {
      const bound_store = some(tx.stores[this.schema.name]) as any as BoundStore<Item>;
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
