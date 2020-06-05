
import { Row } from './row';
import { mapError } from './errors';
import { some, Dict } from './util';
import { TransactionMode } from './transaction';
import { Store, BoundStore } from './store';
import { Index, BoundIndex } from './index';
import { Storable, StorableRegistry } from './storable';
import { Indexable, NativelyIndexable, IndexableRegistry } from './indexable';

/**
 * Query spec
 *
 * A query falls into one of 3 categories:
 *
 * Wildcard: A wildcard query selects everything. This is given by `null`.
 *
 * Exact: An exact query selects a particular value. This is given by `{ equals: value }`.
 *
 * Range: A range query selects values within a particular range. The range may be
 * bounded below or above, or both, but not neither. Both bounds may be inclusive
 * or exclusive. Lower bounds are given by the keys `from` and `above`, for inclusive
 * and exclusive, respectively; likewise, upper bounds are given by keywords
 * `through` and `below`. Thus `{ from: 0, below: 10 }` represents `0 <= x < 10` and
 * `{ through: 3 }` represents
 * `x <= 3`.
 *
 * Additionally, a query may have the `reversed` and `unique` keys. `reversed` marks that
 * the query results should be traversed in reverse order, and `unique` marks that
 * duplicated values should be skipped.
 */
export interface QuerySpec<Trait extends Indexable> {
  /** Select everything */
  everything?: boolean;
  /** Equality */
  equals?: Trait;
  /** Inclusive lower bound */
  from?: Trait;
  /** Exclusive lower bound */
  above?: Trait;
  /** Inclusive upper bound */
  through?: Trait;
  /** Exclusive upper bound */
  below?: Trait;
  /** Reversed? */
  reversed?: boolean;
  /** Unique? */
  unique?: boolean;
}


function compileTraitRange<Trait extends Indexable>(spec: QuerySpec<Trait>, indexables: IndexableRegistry): IDBKeyRange | undefined {
  /* Conpile an IDBKeyRange object from a QuerySpec<Trait>. */

  // The implementation isn't elegant, but it's easy to understand

  if (spec.everything)
    return undefined;

  if ('equals' in spec)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.only(indexables.encode(spec.equals!, false));

  if ('from' in spec && 'through' in spec)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(indexables.encode(spec.from!, false), indexables.encode(spec.through!, false), false, false);

  if ('from' in spec && 'below' in spec)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(indexables.encode(spec.from!, false), indexables.encode(spec.below!, false), false, true);

  if ('above' in spec && 'through' in spec)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(indexables.encode(spec.above!, false), indexables.encode(spec.through!, false), true, false);

  if ('above' in spec && 'below' in spec)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(indexables.encode(spec.above!, false), indexables.encode(spec.below!, false), true, true);

  if ('from' in spec)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.lowerBound(indexables.encode(spec.from!, false), false)

  if ('above' in spec)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.lowerBound(indexables.encode(spec.above!, false), true);

  if ('through' in spec)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.upperBound(indexables.encode(spec.through!, false), false);

  if ('below' in spec)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.upperBound(indexables.encode(spec.below!, false), true);

  throw new Error('uh oh');

}

function compileCursorDirection<T extends Indexable>(query_spec: QuerySpec<T>): IDBCursorDirection {
  if (query_spec === null) return 'next';
  let result = query_spec.reversed ? 'prev' : 'next';
  if (query_spec.unique) result += 'unique';
  return result as IDBCursorDirection;
}



export class Cursor<Item extends Storable, Trait extends Indexable> {
  /* IDBCursor wrapper */

  // For use by the API user to monkeypatch in any
  // methods that are missing from this class.
  // TODO: replicate on other classes.
  my: Dict<string, any> = {};

  readonly storables: StorableRegistry;
  readonly indexables: IndexableRegistry;

  readonly _query_spec: QuerySpec<Trait>;

  readonly _idb_source: IDBIndex | IDBObjectStore;
  _idb_req: IDBRequest | null;
  _idb_cur: IDBCursorWithValue | null;

  constructor(args: {
    idb_source: IDBIndex | IDBObjectStore;
    query_spec: QuerySpec<Trait>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this._query_spec = args.query_spec;
    this._idb_source = args.idb_source;
    this._idb_req = null;
    this._idb_cur = null;
    this.storables = args.storables;
    this.indexables = args.indexables;
  }

  get initialized(): boolean {
    return this._idb_req !== null;
  }

  _assertInitialized(): void {
    if (!this.initialized)
      throw Error('Cursor must be initialized; please await .init()');
  }

  init(): Promise<void> {
    const req = this._idb_source.openCursor(
      compileTraitRange(this._query_spec, this.indexables),
      compileCursorDirection(this._query_spec),
    );
    this._idb_req = req;
    return new Promise((resolve, reject) => {
      req.onsuccess = _event => {
        this._idb_cur = req.result;
        resolve();
      }
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  get exhausted(): boolean {
    return this.initialized && this._idb_cur === null;
  }

  _assertNotExhausted(): void {
    if (this.exhausted)
      throw Error('Cursor is exhausted and needs a nap.');
  }

  step(): Promise<void> {
    this._assertInitialized();
    if (this.exhausted) {
      return Promise.resolve(undefined);
    } else {
      const req = some(this._idb_req);
      some(this._idb_cur).continue();
      return new Promise((resolve, reject) => {
        req.onsuccess = _event => {
          this._idb_cur = req.result;
          resolve();
        };
        req.onerror = _event => reject(mapError(req.error));
      });
    }
  }

  get active(): boolean {
    return this.initialized && !this.exhausted;
  }

  _assertActive(): void {
    this._assertInitialized();
    this._assertNotExhausted();
  }

  _currentRow(): Row {
    return some(this._idb_cur).value;
  }

  currentItem(): Item {
    // Get the item at the cursor.
    this._assertActive();
    const row = some(this._idb_cur).value;
    return this.storables.decode(row.payload);
  }

  get _sourceIsExploding(): boolean {
    return this._idb_source instanceof IDBIndex && this._idb_source.multiEntry;
  }

  currentTrait(): Trait {
    this._assertActive();
    const encoded = some(this._idb_cur).key as NativelyIndexable;
    return this.indexables.decode(encoded, this._sourceIsExploding) as Trait;
  }

  async delete(): Promise<void> {
    // Delete the current object
    this._assertActive();
    return new Promise((resolve, reject) => {
      const req = some(this._idb_cur).delete();
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  async _replaceRow(new_row: Row): Promise<void> {
    this._assertActive();
    return new Promise((resolve, reject) => {
      const req = some(this._idb_cur).update(new_row);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  async replace(new_item: Item): Promise<void> {
    // Replace the current object with the given object
    this._assertActive();
    const row: any = some(this._idb_cur).value;
    row.payload = this.storables.encode(new_item);
    return new Promise((resolve, reject) => {
      const req = some(this._idb_cur).update(row);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  async update(updates: Partial<Item>): Promise<void> {
    this._assertActive();
    const item = await this.currentItem();
    await this.replace(Object.assign(item, updates));
  }

}

/**
 * Used to execute queries.
 * @typeParam Item The type of the items for the parent database
 * @typeParam Trait The type of the trait for the parent index
 */
export class QueryExecutor<Item extends Storable, Trait extends Indexable> {

  readonly source: Store<Item> | Index<Item, Trait>;
  readonly query_spec: QuerySpec<Trait>;

  readonly storables: StorableRegistry;
  readonly indexables: IndexableRegistry;

  constructor(args: {
    source: Store<Item> | Index<Item, Trait>;
    query_spec: QuerySpec<Trait>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.source = args.source;
    this.query_spec = args.query_spec;
    this.storables = args.storables;
    this.indexables = args.indexables;
  }

  async _withCursor<T>(mode: TransactionMode, callback: (cursor: Cursor<Item, Trait>) => Promise<T>): Promise<T> {

    type TransactType = <T>(mode: TransactionMode, callback: (bound_source: BoundStore<Item> | BoundIndex<Item, Trait>) => Promise<T>) => Promise<T>;
    const transact: TransactType = this.source._transact.bind(this.source);

    return await transact(mode, async (bound_source: BoundStore<Item> | BoundIndex<Item, Trait>) => {

      const idb_source =
        bound_source instanceof BoundStore
          ? (bound_source as any)._idb_store
          : (bound_source as any)._idb_index;

      const cursor = new Cursor<Item, Trait>({
        idb_source: idb_source,
        query_spec: this.query_spec,
        storables: this.storables,
        indexables: this.indexables,
      });
      return await callback(cursor);

    });

  }

  async _replaceRows(mapper: (row: Row) => Row): Promise<void> {
    await this._withCursor('rw', async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        const old_row = cursor._currentRow();
        const new_row = mapper(old_row);
        await cursor._replaceRow(new_row);
      }
    });
  }

  /**
   * Replace all selected items.
   * @param mapper Given an existing item, this function should return the new item.
   */
  async replace(mapper: (item: Item) => Item): Promise<void> {
    await this._withCursor('rw', async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        const old_item = cursor.currentItem();
        const new_item = mapper(old_item);
        await cursor.replace(new_item);
      }
    });
  }

  /**
   * Update all selected items with the given delta.
   * @param updates The delta
   */
  async update(updates: Partial<Item>): Promise<void> {
    await this._withCursor('rw', async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        await cursor.update(updates);
      }
    });
  }

  /**
   * Delete the selected items from the database.
   */
  async delete(): Promise<void> {
    await this._withCursor('rw', async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        await cursor.delete();
      }
    });
  }

  /**
   * Return the number of selected items.
   */
  async count(): Promise<number> {
    return await this._withCursor('r', async cursor => {
      let result = 0;
      for (await cursor.init(); cursor.active; await cursor.step()) {
        result++;
      }
      return result;
    });
  }

  /**
   * Return all selected items as an array.
   */
  async array(): Promise<Array<Item>> {
    return await this._withCursor('r', async cursor => {
      const result: Array<Item> = [];
      for (await cursor.init(); cursor.active; await cursor.step()) {
        result.push(cursor.currentItem());
      }
      return result;
    });
  }

}

/**
 * Like [[QueryExecutor]], but for unique indexes.
 */
export class UniqueQueryExecutor<Item extends Storable, Trait extends Indexable> {

  readonly qe: QueryExecutor<Item, Trait>;

  constructor(args: {
    source: Index<Item, Trait>;
    query_spec: QuerySpec<Trait>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    if (!args.source.structure.unique)
      throw Error('Cannot create a UniqueQueryExecutor on a non-unique index.');
    this.qe = new QueryExecutor(args);
  }

  /**
   * Replace the item with a new item.
   * @param new_item The new item
   */
  async replace(new_item: Item): Promise<void> {
    await this.qe.replace(_old_item => new_item);
  }

  /**
   * Update the item with a delta
   * @param updates The delta
   */
  async update(updates: Partial<Item>): Promise<void> {
    await this.qe.update(updates);
  }

  /**
   * Delete the item from the database.
   */
  async delete(): Promise<void> {
    await this.qe.delete();
  }

  /**
   * Get the item from the database.
   *
   * Example:
   * ```ts
   * await my_host.$.my_store.by.my_index.one(trait_val).get()
   * ```
   *
   * @returns The item
   */
  async get(): Promise<Item> {
    const got = (await this.qe.array())[0];
    if (got === undefined)
      throw Error('No item found');
    return got;
  }

}
