
import { Row } from './row';
import { some } from './util';
import { Storable } from './storable';
import { AutonomousStore } from './store';
import { TransactionMode } from './transaction';
import { query, QuerySpec, QueryResult } from './query';
import { ItemCodec, fullDecode } from './codec';
import { IndexableTrait } from './traits';

export class IndexSchema<Item extends Storable, Trait extends IndexableTrait> {

  public name: string;
  public unique: boolean;
  public explode: boolean;
  public item_codec: ItemCodec<Item>;
  public parent_store_name: string;
  public trait_path_or_getter: string | ((item: Item) => Trait);

  constructor(args: {
    name: string;
    unique?: boolean;
    explode?: boolean;
    item_codec: ItemCodec<Item>;
    parent_store_name: string;
    trait_path_or_getter: string | ((item: Item) => Trait);
  }) {
    this.name = args.name;
    this.unique = args.unique ?? false;
    this.explode = args.explode ?? false;
    this.item_codec = args.item_codec;
    this.parent_store_name = args.parent_store_name;
    this.trait_path_or_getter = args.trait_path_or_getter;
  }

  get kind(): 'path' | 'derived' {
    if (typeof this.trait_path_or_getter === 'string')
      return 'path';
    return 'derived';
  }

  get trait_path(): string {
    if (this.kind !== 'path')
      throw Error('Cannot get .path on a non-path index.');
    return this.trait_path_or_getter as string;
  }

  get trait_getter(): (item: Item) => Trait {
    if (this.kind !== 'derived')
      throw Error('Cannot get .trait_getter on a non-derived index.');
    return this.trait_path_or_getter as (item: Item) => Trait;
  }

}

export interface Index<Item extends Storable, Trait extends IndexableTrait> {

  // TODO: Schema types should probably be in respective files, not together in schema.ts
  readonly schema: IndexSchema<Item, Trait>;

  count(): Promise<number>;
  find(trait: Trait): Promise<Array<Item>>;
  tryGet(trait: Trait): Promise<Item | undefined>;
  get(trait: Trait): Promise<Item>;
  all(): Promise<Array<Item>>;

}

export class BoundIndex<Item extends Storable, Trait extends IndexableTrait> implements Index<Item, Trait> {

  public readonly schema: IndexSchema<Item, Trait>

  private readonly _idb_index: IDBIndex;

  constructor(schema: IndexSchema<Item, Trait>, idb_index: IDBIndex) {
    this.schema = schema;
    this._idb_index = idb_index;
  }

  _get_trait(item: Item): Trait {
    if (this.schema.kind === 'path') {
      return (item as any)[this.schema.trait_path];
    } else {
      return this.schema.trait_getter(item);
    }
  }

  query(query_spec: QuerySpec): QueryResult<Item, Trait> {
    return query(this._idb_index, this.schema.item_codec, query_spec);
  }

  async count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = this._idb_index.count();
      req.onsuccess = event => {
        const count = (event.target as any).result as number;
        resolve(count);
      };
      req.onerror = _event => reject(req.error);
    });
  }

  async tryGet(trait: Trait): Promise<Item | undefined> {
    if (!this.schema.unique)
      throw new Error('.get() is only valid on a unique index');
    const results = await this.query({ equals: trait }).array();
    return results[0];
  }

  async get(trait: Trait): Promise<Item> {
    const got = await this.tryGet(trait);
    if (got === undefined)
      throw new Error('No match');
    return got;
  }

  async find(trait: Trait): Promise<Array<Item>> {
    return await this.query({ equals: trait }).array();
  }

  async all(): Promise<Array<Item>> {
    return new Promise((resolve, reject) => {
      const req = this._idb_index.getAll();
      req.onsuccess = event => {
        const rows = (event.target as any).result as Array<Row>;
        const items = rows.map(row => fullDecode(row.payload, this.schema.item_codec));
        resolve(items as Array<Item>);
      };
      req.onerror = _event => reject(req.error);
    });
  }

}

export class AutonomousIndex<Item extends Storable, Trait extends IndexableTrait> implements Index<Item, Trait> {

  public readonly schema: IndexSchema<Item, Trait>

  readonly _parent: AutonomousStore<Item>;

  constructor(schema: IndexSchema<Item, Trait>, parent: AutonomousStore<Item>) {
    this.schema = schema;
    this._parent = parent;
  }

  async _transact_NONDEBUG<T>(mode: TransactionMode, callback: (bound_index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T> {
    return this._parent._transact(mode, async bound_store => {
      const index = some(bound_store.indexes[this.schema.name]) as BoundIndex<Item, Trait>;
      return await callback(index);
    });
  }

  async _transact<T>(mode: TransactionMode, callback: (bound_index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T> {
    return this._parent._transact(mode, async bound_store => {
      const index = some(bound_store.indexes[this.schema.name]) as BoundIndex<Item, Trait>;
      const result = await callback(index);
      return result;
    });
  }

  async count(): Promise<number> {
    return await this._transact('r', async bound_index => await bound_index.count());
  }

  async tryGet(trait: Trait): Promise<Item | undefined> {
    return await this._transact('r', async bound_index => await bound_index.tryGet(trait));
  }

  async get(trait: Trait): Promise<Item> {
    return await this._transact('r', async bound_index => await bound_index.get(trait));
  }

  async find(trait: Trait): Promise<Array<Item>> {
    return await this._transact('r', async bound_index => await bound_index.find(trait));
  }

  async all(): Promise<Array<Item>> {
    return await this._transact('r', async bound_index => await bound_index.all());
  }

}
