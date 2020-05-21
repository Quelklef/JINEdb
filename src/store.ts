
import { Row } from './row';
import { Cursor } from './cursor';
import { Storable } from './storable';
import { some, Dict } from './util';
import { IndexableTrait } from './traits';
import { fullDecode, fullEncode } from './codec';
import { StoreSchema, IndexSchema } from './schema';
import { Connection } from './connection';
import { Transaction, TransactionMode } from './transaction';
import { Index, BoundIndex, AutonomousIndex } from './index';

export interface Store<Item extends Storable> {

  readonly schema: StoreSchema<Item>;
  readonly indexes: Dict<string, Index<Item, IndexableTrait>>;

  add(item: Item): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  all(): Promise<Array<Item>>;

}

export class BoundStore<Item extends Storable> {

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

  _addIndex<$$>(index_schema: IndexSchema<Item, IndexableTrait>): ((tx: Transaction<$$>) => Promise<void>) | undefined {
    this._idb_store.createIndex(
      index_schema.name,
      `traits.${index_schema.name}`,
      {
        unique: index_schema.unique,
        multiEntry: index_schema.explode,
      }
    );

    this.schema.index_schemas[index_schema.name] = index_schema;

    if (index_schema.kind === 'path') {
      return undefined;
    } else {
      return async tx => {
        const store = some(tx.stores[this.schema.name]) as any as BoundStore<Item>;
        await store._mapExistingRows(row => {
          const item = fullDecode(row.payload, store.schema.item_codec) as Item;
          const index = some(tx.stores[this.schema.name]?.indexes[index_schema.name]) as any as BoundIndex<Item, any>;
          const trait = index._get_trait(item);
          row.traits[index_schema.name] = trait;
          row.payload = fullEncode(item, store.schema.item_codec);
          return row;
        });
      };
    }
  }

  _removeIndex<$$>(index_name: string): ((tx: Transaction<$$>) => Promise<void>) | undefined {
    // TODO: This one should also be refactored into two methods, I think
    this._idb_store.deleteIndex(index_name);
    delete this.schema.index_schemas[index_name];

    const index_schema = some(this.schema.index_schemas[index_name]);
    if (index_schema.kind === 'path') {
      return undefined;
    } else {
      return async tx => {
        const store = some(tx.stores[this.schema.name]) as any as BoundStore<Item>;
        await store._mapExistingRows(row => {
          delete row.traits[index_name];
          return row;
        });
      };
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

  private readonly _conn: Connection<unknown>;

  // TODO: split T<$$> types into T and $T<$$>. This Connection shouldn't need or have a type param.
  constructor(schema: StoreSchema<Item>, conn: Connection<unknown>) {
    this.schema = schema;
    this.indexes = {};
    for (const index_name of schema.index_names) {
      const index_schema = some(schema.index_schemas[index_name]);
      this.indexes[index_name] = new AutonomousIndex(index_schema, this);
    }
    this._conn = conn;
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
