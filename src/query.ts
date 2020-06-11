
import { Row } from './row';
import { mapError } from './errors';
import { some, Dict } from './util';
import { IndexStructure } from './structure';
import { TransactionMode } from './transaction';
import { Store, StoreActual } from './store';
import { Index, IndexActual } from './index';
import { Storable, StorableRegistry } from './storable';
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

  readonly index_structures: Dict<IndexStructure<Item>>;
  readonly storables: StorableRegistry;
  readonly indexables: IndexableRegistry;

  readonly _query: Query<Trait>;

  readonly _idb_source: IDBIndex | IDBObjectStore;
  _idb_req: IDBRequest | null;
  _idb_cur: IDBCursorWithValue | null;

  constructor(args: {
    idb_source: IDBIndex | IDBObjectStore;
    query: Query<Trait>;
    index_structures: Dict<IndexStructure<Item>>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this._query = args.query;
    this._idb_source = args.idb_source;
    this._idb_req = null;
    this._idb_cur = null;
    this.index_structures = args.index_structures;
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
      compileTraitRange(this._query, this.indexables),
      compileCursorDirection(this._query),
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

    // update payload
    row.payload = this.storables.encode(new_item);

    // update traits
    for (const index_name of Object.keys(this.index_structures)) {
      const index_structure = some(this.index_structures[index_name]);
      const trait = index_structure.calc_trait(new_item);
      const encoded = this.indexables.encode(trait, index_structure.explode);
      const trait_name = index_name;
      row.traits[trait_name] = encoded;
    }

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
 * @typeparam Item The type of the items for the parent database
 * @typeparam Trait The type of the trait for the parent index
 */
export class Selection<Item extends Storable, Trait extends Indexable> {

  readonly source: Store<Item> | Index<Item, Trait>;
  readonly query: Query<Trait>;

  readonly index_structures: Dict<IndexStructure<Item>>;
  readonly storables: StorableRegistry;
  readonly indexables: IndexableRegistry;

  constructor(args: {
    source: Store<Item> | Index<Item, Trait>;
    query: Query<Trait>;
    index_structures: Dict<IndexStructure<Item>>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    this.source = args.source;
    this.query = args.query;
    this.index_structures = args.index_structures;
    this.storables = args.storables;
    this.indexables = args.indexables;
  }

  async _withCursor<T>(mode: TransactionMode, callback: (cursor: Cursor<Item, Trait>) => Promise<T>): Promise<T> {

    type TransactType = <T>(mode: TransactionMode, callback: (bound_source: StoreActual<Item> | IndexActual<Item, Trait>) => Promise<T>) => Promise<T>;
    const transact: TransactType = this.source._transact.bind(this.source);

    return await transact(mode, async (bound_source: StoreActual<Item> | IndexActual<Item, Trait>) => {

      const idb_source =
        bound_source instanceof StoreActual
          ? (bound_source as any)._idb_store
          : (bound_source as any)._idb_index;

      const cursor = new Cursor<Item, Trait>({
        idb_source: idb_source,
        query: this.query,
        index_structures: this.index_structures,
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
   *
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
   *
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
   * @return The number of selected items.
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
   *
   * @returns The items
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
 * Like [[Selection]], but for unique indexes.
 */
export class SelectionUnique<Item extends Storable, Trait extends Indexable> {

  readonly qe: Selection<Item, Trait>;

  constructor(args: {
    source: Index<Item, Trait>;
    query: Query<Trait>;
    index_structures: Dict<IndexStructure<Item>>;
    storables: StorableRegistry;
    indexables: IndexableRegistry;
  }) {
    if (!args.source.unique)
      throw Error('Cannot create a SelectionUnique on a non-unique index.');
    this.qe = new Selection(args);
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
   * @returns The item
   */
  async get(): Promise<Item> {
    const got = (await this.qe.array())[0];
    if (got === undefined)
      throw Error('No item found');
    return got;
  }

}
