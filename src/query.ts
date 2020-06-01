
import * as storable from './storable';
import * as indexable from './indexable';

type Storable = storable.Storable;
type Indexable = indexable.Indexable;
type NativelyIndexable = indexable.NativelyIndexable;

import { Row } from './row';
import { TransactionMode } from './transaction';
import { Store, BoundStore } from './store';
import { Index, BoundIndex } from './index';
import { some, Dict } from './util';

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
export interface QuerySpec {  // TODO: should this be parameterized with <Trait>?
  /** Select everything */
  everything?: boolean;
  /** Equality */
  equals?: any;
  /** Inclusive lower bound */
  from?: any;
  /** Exclusive lower bound */
  above?: any;
  /** Inclusive upper bound */
  through?: any;
  /** Exclusive upper bound */
  below?: any;
  /** Reversed? */
  reversed?: boolean;
  /** Unique? */
  unique?: boolean;
}


function compileTraitRange(spec: QuerySpec): IDBKeyRange | undefined {
  /* Conpile an IDBKeyRange object from a QuerySpec. */

  // The implementation isn't elegant, but it's easy to understand

  if (spec.everything)
    return undefined;

  if ('equals' in spec)
    return IDBKeyRange.only(spec.equals);

  if ('from' in spec && 'through' in spec)
    return IDBKeyRange.bound(spec.from, spec.through, false, false);

  if ('from' in spec && 'below' in spec)
    return IDBKeyRange.bound(spec.from, spec.below, false, true);

  if ('above' in spec && 'through' in spec)
    return IDBKeyRange.bound(spec.above, spec.through, true, false);

  if ('above' in spec && 'below' in spec)
    return IDBKeyRange.bound(spec.above, spec.below, true, true);

  if ('from' in spec)
    return IDBKeyRange.lowerBound(spec.from, false)

  if ('above' in spec)
    return IDBKeyRange.lowerBound(spec.above, true);

  if ('through' in spec)
    return IDBKeyRange.upperBound(spec.through, false);

  if ('below' in spec)
    return IDBKeyRange.upperBound(spec.below, true);

  throw new Error('uh oh');

}

function compileCursorDirection(query_spec: QuerySpec): IDBCursorDirection {
  if (query_spec === null) return 'next';
  let result = query_spec.reversed ? 'prev' : 'next';
  if (query_spec.unique) result += 'unique';
  return result as IDBCursorDirection;
}

export function query<Item extends Storable, Trait extends Indexable>(
  source: Store<Item> | Index<Item, Trait>,
  query_spec: QuerySpec,
): QueryExecutor<Item, Trait> {
  return new QueryExecutor<Item, Trait>(source, query_spec);
}

export function queryUnique<Item extends Storable, Trait extends Indexable>(
  source: Index<Item, Trait>,
  query_spec: QuerySpec,
): UniqueQueryExecutor<Item, Trait> {
  return new UniqueQueryExecutor<Item, Trait>(source, query_spec);
}



export class Cursor<Item extends Storable, Trait extends Indexable> implements Cursor<Item, Trait> {
  /* IDBCursor wrapper */

  // For use by the API user to monkeypatch in any
  // methods that are missing from this class.
  // TODO: replicate on other classes.
  my: Dict<string, any> = {};

  readonly _query_spec: QuerySpec;

  readonly _idb_source: IDBIndex | IDBObjectStore;
  _idb_req: IDBRequest | null;
  _idb_cur: IDBCursorWithValue | null;

  constructor(idb_source: IDBIndex | IDBObjectStore, query_spec: QuerySpec) {
    this._query_spec = query_spec;
    this._idb_source = idb_source;
    this._idb_req = null;
    this._idb_cur = null;
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
      compileTraitRange(this._query_spec),
      compileCursorDirection(this._query_spec),
    );
    this._idb_req = req;
    return new Promise((resolve, reject) => {
      req.onsuccess = _event => {
        this._idb_cur = req.result;
        resolve();
      }
      req.onerror = _event => reject(req.error);
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
        req.onerror = _event => reject(req.error);
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
    return storable.decode(row.payload);
  }

  get _sourceIsExploding(): boolean {
    return this._idb_source instanceof IDBIndex && this._idb_source.multiEntry;
  }

  currentTrait(): Trait {
    this._assertActive();
    const encoded = some(this._idb_cur).key as NativelyIndexable;
    return indexable.decode(encoded, this._sourceIsExploding);
  }

  async delete(): Promise<void> {
    // Delete the current object
    this._assertActive();
    return new Promise((resolve, reject) => {
      const req = some(this._idb_cur).delete();
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

  async _replaceRow(new_row: Row): Promise<void> {
    this._assertActive();
    return new Promise((resolve, reject) => {
      const req = some(this._idb_cur).update(new_row);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

  async replace(new_item: Item): Promise<void> {
    // Replace the current object with the given object
    this._assertActive();
    const row: any = some(this._idb_cur).value;
    row.payload = storable.encode(new_item);
    return new Promise((resolve, reject) => {
      const req = some(this._idb_cur).update(row);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(req.error);
    });
  }

  async update(updates: Partial<Item>): Promise<void> {
    this._assertActive();
    const item = await this.currentItem();
    await this.replace(Object.assign({}, item, updates));
  }

}

/**
 * Used to execute queries.
 * @typeParam Item The type of the items for the parent database
 * @typeParam Trait The type of the trait for the parent index
 */
export class QueryExecutor<Item extends Storable, Trait extends Indexable> {

  readonly source: Store<Item> | Index<Item, Trait>;
  readonly query_spec: QuerySpec;

  constructor(source: Store<Item> | Index<Item, Trait>, query_spec: QuerySpec) {
    this.source = source;
    this.query_spec = query_spec;
  }

  async _withCursor<T>(mode: TransactionMode, callback: (cursor: Cursor<Item, Trait>) => Promise<T>): Promise<T> {

    type TransactType = <T>(mode: TransactionMode, callback: (bound_source: BoundStore<Item> | BoundIndex<Item, Trait>) => Promise<T>) => Promise<T>;
    const transact: TransactType = this.source._transact.bind(this.source);

    return await transact(mode, async (bound_source: BoundStore<Item> | BoundIndex<Item, Trait>) => {

      const idb_source =
        bound_source instanceof BoundStore
          ? (bound_source as any)._idb_store
          : (bound_source as any)._idb_index;

      const cursor = new Cursor<Item, Trait>(idb_source, this.query_spec);
      return await callback(cursor);

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

  constructor(source: Index<Item, Trait>, query_spec: QuerySpec) {
    if (!source.structure.unique)
      throw Error('Cannot create a UniqueQueryExecutor on a non-unique index.');
    this.qe = new QueryExecutor(source, query_spec);
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
   * await my_jine.$my_store.$my_index.one(trait_val).get()
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
