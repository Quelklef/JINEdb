
import { Row } from './row';
import { Store } from './store';
import { Index } from './index';
import { mapError } from './errors';
import { Storable } from './storable';
import { AsyncCont } from './cont';
import { StoreSchema } from './schema';
import { some, getPropertyDescriptor, Dict, Awaitable } from './util';
import { Indexable, NativelyIndexable, IndexableRegistry } from './indexable';

/**
 * Query specification
 *
 * A query falls into one of 3 categories:
 *
 * Wildcard: A wildcard query selects everything. This is given by `'everything'`.
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
export type Query<Trait extends Indexable>
  = 'everything'
  | {
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
  };


function compileTraitRange<Trait extends Indexable>(query: Query<Trait>, indexables: IndexableRegistry): IDBKeyRange | undefined {
  /* Conpile an IDBKeyRange object from a Query<Trait>. */

  // The implementation isn't elegant, but it's easy to understand

  if (query === 'everything')
    return undefined;

  query = query as Omit<Query<Trait>, 'everything'>;

  if ('equals' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.only(indexables.encode(query.equals!, false));

  if ('from' in query && 'through' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(indexables.encode(query.from!, false), indexables.encode(query.through!, false), false, false);

  if ('from' in query && 'below' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(indexables.encode(query.from!, false), indexables.encode(query.below!, false), false, true);

  if ('above' in query && 'through' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(indexables.encode(query.above!, false), indexables.encode(query.through!, false), true, false);

  if ('above' in query && 'below' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(indexables.encode(query.above!, false), indexables.encode(query.below!, false), true, true);

  if ('from' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.lowerBound(indexables.encode(query.from!, false), false)

  if ('above' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.lowerBound(indexables.encode(query.above!, false), true);

  if ('through' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.upperBound(indexables.encode(query.through!, false), false);

  if ('below' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.upperBound(indexables.encode(query.below!, false), true);

  throw new Error('uh oh');

}

function compileCursorDirection<Trait extends Indexable>(query: Query<Trait>): IDBCursorDirection {
  if (query === 'everything') return 'next';
  query = query as Omit<Query<Trait>, 'everything'>;
  let result = query.reversed ? 'prev' : 'next';
  if (query.unique) result += 'unique';
  return result as IDBCursorDirection;
}


export class Cursor<Item extends Storable, Trait extends Indexable> {
  /* IDBCursor wrapper */

  // For use by the API user to monkeypatch in any
  // methods that are missing from this class.
  // TODO: replicate on other classes.
  my: Dict<any> = {};

  readonly store_schema: StoreSchema<Item>;

  readonly _query: Query<Trait>;

  readonly _idb_source: IDBObjectStore | IDBIndex;
  _idb_req: IDBRequest | null;
  _idb_cur: IDBCursorWithValue | null;

  constructor(args: {
    idb_source: IDBIndex | IDBObjectStore;
    query: Query<Trait>;
    store_schema: StoreSchema<Item>;
  }) {
    this._query = args.query;
    this._idb_source = args.idb_source;
    this._idb_req = null;
    this._idb_cur = null;
    this.store_schema = args.store_schema;
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
      compileTraitRange(this._query, this.store_schema.indexables),
      compileCursorDirection(this._query),
    );
    this._idb_req = req;
    return new Promise((resolve, reject) => {
      req.onsuccess = _event => {
        this._idb_cur = req.result;
        resolve();
      };
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
  
  get active(): boolean {
    return this.initialized && !this.exhausted;
  }

  _assertActive(): void {
    this._assertInitialized();
    this._assertNotExhausted();
  }

  _active_idb_cur(): IDBCursorWithValue {
    this._assertActive();
    return some(this._idb_cur, "Internal error");
  }

  _active_idb_req(): IDBRequest {
    this._assertActive();
    return some(this._idb_req, "Internal error");
  }
  
  _currentRow(): Row {
    return this._active_idb_cur().value;
  }

  currentItem(): Item {
    // Get the item at the cursor.
    const idb_cur = this._active_idb_cur();
    const row = idb_cur.value;
    return this.store_schema.storables.decode(row.payload) as Item;
  }

  step(options?: { toTrait: Trait } | { size: number }): Promise<void> {
    this._assertInitialized();
    if (this.exhausted) {
      return Promise.resolve(undefined);
    } else {
      const idb_req = this._active_idb_req();
      const idb_cur = this._active_idb_cur();
      const req = idb_req;

      if (options && 'toTrait' in options) {
        const trait = options.toTrait;
        const encoded = this.store_schema.indexables.encode(trait, this._sourceIsExploding);
        idb_cur.continue(encoded);
      } else {
        idb_cur.advance(options?.size ?? 1);
      }

      return new Promise((resolve, reject) => {
        req.onsuccess = _event => {
          this._idb_cur = req.result;
          resolve();
        };
        req.onerror = _event => reject(mapError(req.error));
      });
    }
  }

  get _sourceIsExploding(): boolean {
    return this._idb_source instanceof IDBIndex && this._idb_source.multiEntry;
  }

  currentTrait(): Trait {
    const idb_cur = this._active_idb_cur();
    const encoded = idb_cur.key as NativelyIndexable;
    return this.store_schema.indexables.decode(encoded, this._sourceIsExploding) as Trait;
  }

  async delete(): Promise<void> {
    // Delete the current object
    const idb_cur = this._active_idb_cur();
    return new Promise((resolve, reject) => {
      const req = idb_cur.delete();
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  async _replaceRow(new_row: Row): Promise<void> {
    const idb_cur = this._active_idb_cur();
    return new Promise((resolve, reject) => {
      const req = idb_cur.update(new_row);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  async replace(new_item: Item): Promise<void> {

    // Replace the current object with the given object
    const idb_cur = this._active_idb_cur();
    const row: any = idb_cur.value;

    // update payload
    row.payload = this.store_schema.storables.encode(new_item);

    // update traits
    for (const index_name of this.store_schema.index_names) {
      const index_schema = this.store_schema.index(index_name);
      const trait = index_schema.calc_trait(new_item);
      const encoded = this.store_schema.indexables.encode(trait, index_schema.explode);
      const trait_name = index_name;
      row.traits[trait_name] = encoded;
    }

    return new Promise((resolve, reject) => {
      const req = idb_cur.update(row);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });

  }

  async update(delta: Partial<Item>): Promise<void> {
    this._assertActive();
    const item = await this.currentItem();
    await this.replace(Object.assign(item, delta));
  }

}

/**
 * Used to execute queries.
 * @typeparam Item The type of the items for the parent database
 * @typeparam Trait The type of the trait for the parent index
 */
export class Selection<Item extends Storable, Trait extends Indexable> {

  readonly source: Store<Item> | Index<Item, Trait>;
  readonly query: Query<Trait>;

  readonly store_schema_g: () => Awaitable<StoreSchema<Item>>;

  cursor_k: AsyncCont<Cursor<Item, Trait>>;

  constructor(args: {
    source: Store<Item> | Index<Item, Trait>;
    query: Query<Trait>;
    store_schema_g: () => Awaitable<StoreSchema<Item>>;
  }) {
    this.source = args.source;
    this.query = args.query;
    this.store_schema_g = args.store_schema_g;

    const idb_source_k =
      this.source instanceof Store
        ? (this.source as any)._idb_store_k
        : (this.source as any)._idb_index_k;

    this.cursor_k = idb_source_k.map(async (idb_source: IDBObjectStore | IDBIndex) => {
      const schema = await this.store_schema_g();
      // TODO: use transactionmode
      return new Cursor<Item, Trait>({
        idb_source: idb_source,
        query: this.query,
        store_schema: schema,
      });
    });
  }

  async _replaceRows(mapper: (row: Row) => Row): Promise<void> {
    await this.cursor_k.run(/*'rw', */async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        const old_row = cursor._currentRow();
        const new_row = mapper(old_row);
        await cursor._replaceRow(new_row);
      }
    });
  }

  /**
   * Filter the selection
   *
   * @returns this
   */
  filter(...predicates: Array<(item: Item) => boolean>): this {
    const bigPred = (item: Item): boolean => predicates.every(pred => pred(item));

    this.cursor_k = this.cursor_k.map(cursor => {
      const filtered = Object.create(cursor);

      // step until predicate is satisfied
      function satisfied(this: typeof cursor): boolean {
        return this.exhausted || bigPred(this.currentItem());
      }

      filtered.init = async function() {
        // In case the first item doesn't satisfy the predicates
        await cursor.init.call(this);
        while (!satisfied.call(this)) {
          await cursor.step.call(this);
        }
      };

      filtered.step = async function(
        this: typeof cursor,
        options: Parameters<Cursor<Item, Trait>['step']>[0],
      ) {
        if (options && 'toTrait' in options) {
          do {
            await cursor.step.call(this, options);
          } while (!satisfied.call(this));
        } else if (options && 'size' in options) {
          for (let i = 0; i < options.size; i++)
            await filtered.step.call(this);
        } else {
          // Step one
          do {
            await cursor.step.call(this);
          } while (!satisfied.call(this));
        }
      };

      return filtered;
    });

    return this;
  }

  /**
   * Drop items off of the beginning of a selection
   *
   * @param skipCount The number of items to skip
   * @returns this
   */
  drop(count: number): this {
    this.cursor_k = this.cursor_k.map(cursor => {
      const modified = Object.create(cursor);
      modified.init = async function() {
        await cursor.init.call(this);
        await cursor.step.call(this, { size: count });
      };
      return modified;
    });
    return this;
  }

  /**
   * Limit the number of items in the selection to the given length
   *
   * @param length The length
   * @return this
   */
  limit(length: number): this {
    this.cursor_k = this.cursor_k.map(cursor => {
      const limited = Object.create(cursor);
      let passed = 0;
      
      limited.step = async function(this: typeof cursor, ...args: Parameters<(typeof cursor)['step']>) {
        await cursor.step.call(this, ...args);
        passed++;
        if (passed > length)
          console.warn("[jinedb] .limit()'d selection exceeding max length");
      };

      const oldExhaustedGetter = some(getPropertyDescriptor(cursor, 'exhausted')?.get, null);
      Object.defineProperty(limited, 'exhausted', {
        get() {
          return passed === length || oldExhaustedGetter.call(this);
        },
      });
      
      return limited;
    });
    return this;
  }

  /**
   * Test if the selection is empty or not.
   */
  async isEmpty(): Promise<boolean> {
    return await this.cursor_k.run(/*'r', */async cursor => {
      await cursor.init();
      return cursor.exhausted;
    });
  }

  /**
   * Replace all selected items.
   *
   * @param mapper Given an existing item, this function should return the new item.
   */
  async replace(mapper: (item: Item) => Item): Promise<void> {
    await this.cursor_k.run(/*'rw', */async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        const old_item = cursor.currentItem();
        const new_item = mapper(old_item);
        await cursor.replace(new_item);
      }
    });
  }

  /**
   * Update all selected items with the given delta.
   *
   * @param updates The delta
   */
  async update(delta: Partial<Item>): Promise<void> {
    await this.cursor_k.run(/*'rw', */async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        await cursor.update(delta);
      }
    });
  }

  /**
   * Delete the selected items from the database.
   */
  async delete(): Promise<void> {
    await this.cursor_k.run(/*'rw', */async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        await cursor.delete();
      }
    });
  }

  /**
   * @return The number of selected items.
   */
  async count(): Promise<number> {
    return await this.cursor_k.run(/*'r', */async cursor => {
      let result = 0;
      for (await cursor.init(); cursor.active; await cursor.step()) {
        result++;
      }
      return result;
    });
  }

  /**
   * Return all selected items as an array.
   *
   * @returns The items
   */
  async array(): Promise<Array<Item>> {
    return await this.cursor_k.run(/*'r', */async cursor => {
      const result: Array<Item> = [];
      for (await cursor.init(); cursor.active; await cursor.step()) {
        result.push(cursor.currentItem());
      }
      return result;
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<Item> {

    // !-!-!-!-!-!-!-!-! WARNING !-!-!-!-!-!-!-!-!
    // Reading the following code has been linked
    // to such effects as:
    // - Nausea and/or vomiting
    // - Psychotic break from reality
    // - Beginning or ending of belief in God
    // - Mid-life crisis
    // Proceed at your own risk!
    
    let resolve_cursor: (cursor: Cursor<Item, Trait>) => void;
    const cursor_p: Promise<Cursor<Item, Trait>>
      = new Promise(resolve => resolve_cursor = resolve);

    let resolve_iterator_done: (iterator_done: () => void) => void;
    const iterator_done_p: Promise<() => void>
      = new Promise(resolve => resolve_iterator_done = resolve);
   
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.cursor_k.run(/*'r', */cursor => {
      resolve_cursor(cursor);
      return new Promise(resolve => {
        const iterator_done = resolve;
        resolve_iterator_done(iterator_done);
      });
    });

    return {
      async next(): Promise<IteratorResult<Item>> {

        const iterator_done = await iterator_done_p;
        const cursor = await cursor_p;

        if (!cursor.initialized)
          await cursor.init();

        if (cursor.exhausted) {
          const result: IteratorResult<Item> = { done: true, value: undefined };
          iterator_done();
          return result;
        } else {
          const result: IteratorResult<Item> = { done: false, value: cursor.currentItem() };
          await cursor.step();
          return result;
        }

      }
    };
    
  }

}

/**
 * Like [[Selection]], but for unique indexes.
 */
export class SelectionUnique<Item extends Storable, Trait extends Indexable> {

  readonly selection: Selection<Item, Trait>;
  readonly source: Index<Item, Trait>;

  constructor(args: {
    source: Index<Item, Trait>;
    selected_trait: Trait;
    store_schema_g: () => Awaitable<StoreSchema<Item>>;
  }) {
    this.source = args.source;
    this.selection = new Selection({
      source: args.source,
      query: { equals: args.selected_trait },
      store_schema_g: args.store_schema_g,
    });
  }

  // TODO: in the methods of this class, we don't ensure that >0 rows are selected

  async _ensureSourceUnique(): Promise<void> {
    if (!await this.source.unique)
      throw Error('Cannot create a SelectionUnique on a non-unique index.');
  }

  /**
   * Replace the item with a new item.
   *
   * @param mapper A function that accepts the old item and returns the new item
   */
  async replace(mapper: (old_item: Item) => Item): Promise<void> {
    await this._ensureSourceUnique();
    await this.selection.replace(mapper);
  }
  
  /**
   * Update the item with a delta
   *
   * @param updates The delta
   */
  async update(delta: Partial<Item>): Promise<void> {
    await this._ensureSourceUnique();
    await this.selection.update(delta);
  }

  /**
   * Delete the item from the database.
   */
  async delete(): Promise<void> {
    await this._ensureSourceUnique();
    await this.selection.delete();
  }

  /**
   * Get the item from the database.
   *
   * @returns The item
   */
  async get(): Promise<Item> {
    await this._ensureSourceUnique();
    const got = (await this.selection.array())[0];
    if (got === undefined)
      throw Error('No item found');
    return got;
  }
  
  /**
   * Get the item from the database, or an alternative value if the item isn't found.
   *
   * @returns The item
   */
  async getOr<T = undefined>(alternative: T): Promise<Item | T> {
    await this._ensureSourceUnique();
    const got = (await this.selection.array())[0];
    if (got === undefined) return alternative;
    return got;
  }

}
