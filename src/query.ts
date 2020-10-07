import { M } from 'wrongish';

import { Row } from './row';
import { PACont } from './cont';
import { StoreSchema } from './schema';
import { TransactionMode } from './transaction';
import { JineError, mapError } from './errors';
import { getPropertyDescriptor } from './util';
import { Codec, Storable, Indexable } from './codec';

/**
 * Query specification
 *
 * A query falls into one of 3 categories:
 *
 * Wildcard: A wildcard query selects everything. This is given by `'all'`.
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
  = 'all'
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


function compileTraitRange<Trait extends Indexable>(query: Query<Trait>, codec: Codec): IDBKeyRange | undefined {
  /* Conpile an IDBKeyRange object from a Query<Trait>. */

  // The implementation isn't elegant, but it's easy to understand

  if (query === 'all')
    return undefined;

  query = query as Omit<Query<Trait>, 'all'>;

  if ('equals' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.only(codec.encodeTrait(query.equals!, false));

  if ('from' in query && 'through' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(codec.encodeTrait(query.from!, false), codec.encodeTrait(query.through!, false), false, false);

  if ('from' in query && 'below' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(codec.encodeTrait(query.from!, false), codec.encodeTrait(query.below!, false), false, true);

  if ('above' in query && 'through' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(codec.encodeTrait(query.above!, false), codec.encodeTrait(query.through!, false), true, false);

  if ('above' in query && 'below' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.bound(codec.encodeTrait(query.above!, false), codec.encodeTrait(query.below!, false), true, true);

  if ('from' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.lowerBound(codec.encodeTrait(query.from!, false), false)

  if ('above' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.lowerBound(codec.encodeTrait(query.above!, false), true);

  if ('through' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.upperBound(codec.encodeTrait(query.through!, false), false);

  if ('below' in query)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return IDBKeyRange.upperBound(codec.encodeTrait(query.below!, false), true);

  throw new Error('uh oh');

}

function compileCursorDirection<Trait extends Indexable>(query: Query<Trait>): IDBCursorDirection {
  if (query === 'all') return 'next';
  query = query as Omit<Query<Trait>, 'all'>;
  let result = query.reversed ? 'prev' : 'next';
  if (query.unique) result += 'unique';
  return result as IDBCursorDirection;
}


/*- IDBCursor wrapper */
export class Cursor<Item extends Storable, Trait extends Indexable> {

  private readonly _storeSchema: StoreSchema<Item>;
  private readonly _codec: Codec;

  private readonly _query: Query<Trait>;

  private readonly _idbSource: IDBObjectStore | IDBIndex;
  private _idbReq: IDBRequest | null;
  private _idbCur: IDBCursorWithValue | null;

  constructor(args: {
    idbSource: IDBIndex | IDBObjectStore;
    query: Query<Trait>;
    storeSchema: StoreSchema<Item>;
    codec: Codec;
  }) {
    this._query = args.query;
    this._codec = args.codec;
    this._idbSource = args.idbSource;
    this._idbReq = null;
    this._idbCur = null;
    this._storeSchema = args.storeSchema;
  }

  get initialized(): boolean {
    return this._idbReq !== null;
  }

  private _assertInitialized(): void {
    if (!this.initialized)
      throw new JineError('Cursor must be initialized; please await .init()');
  }

  init(): Promise<void> {
    const req = this._idbSource.openCursor(
      compileTraitRange(this._query, this._codec),
      compileCursorDirection(this._query),
    );
    this._idbReq = req;
    return new Promise((resolve, reject) => {
      req.onsuccess = _event => {
        this._idbCur = req.result;
        resolve();
      };
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  get exhausted(): boolean {
    return this.initialized && this._idbCur === null;
  }

  private _assertNotExhausted(): void {
    if (this.exhausted)
      throw new JineError('Cursor is exhausted and needs a nap.');
  }

  get active(): boolean {
    return this.initialized && !this.exhausted;
  }

  private _assertActive(): void {
    this._assertInitialized();
    this._assertNotExhausted();
  }

  private _activeIdbCur(): IDBCursorWithValue {
    this._assertActive();
    return M.a(this._idbCur, "Internal error");
  }

  private _activeIdbReq(): IDBRequest {
    this._assertActive();
    return M.a(this._idbReq, "Internal error");
  }

  currentRow(): Row {
    return this._activeIdbCur().value;
  }

  currentItem(): Item {
    // Get the item at the cursor.
    const idbCur = this._activeIdbCur();
    const row = idbCur.value;
    return this._codec.decodeItem(row.payload) as Item;
  }

  step(options?: { toTrait: Trait } | { size: number }): Promise<void> {
    this._assertInitialized();
    if (this.exhausted) {
      return Promise.resolve(undefined);
    } else {
      const idbReq = this._activeIdbReq();
      const idbCur = this._activeIdbCur();
      const req = idbReq;

      if (options && 'toTrait' in options) {
        const trait = options.toTrait;
        const encoded = this._codec.encodeTrait(trait, this._sourceIsExploding);
        idbCur.continue(encoded as any);
      } else {
        idbCur.advance(options?.size ?? 1);
      }

      return new Promise((resolve, reject) => {
        req.onsuccess = _event => {
          this._idbCur = req.result;
          resolve();
        };
        req.onerror = _event => reject(mapError(req.error));
      });
    }
  }

  private get _sourceIsExploding(): boolean {
    return this._idbSource instanceof IDBIndex && this._idbSource.multiEntry;
  }

  currentTrait(): Trait {
    const idbCur = this._activeIdbCur();
    const encoded = idbCur.key;
    return this._codec.decodeTrait(encoded, this._sourceIsExploding) as Trait;
  }

  async delete(): Promise<void> {
    // Delete the current object
    const idbCur = this._activeIdbCur();
    return new Promise((resolve, reject) => {
      const req = idbCur.delete();
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  async replaceRow(newRow: Row): Promise<void> {
    const idbCur = this._activeIdbCur();
    return new Promise((resolve, reject) => {
      const req = idbCur.update(newRow);
      req.onsuccess = _event => resolve();
      req.onerror = _event => reject(mapError(req.error));
    });
  }

  async replace(newItem: Item): Promise<void> {

    // Replace the current object with the given object
    const idbCur = this._activeIdbCur();
    const row: any = idbCur.value;

    // update payload
    row.payload = this._codec.encodeItem(newItem);

    // update traits
    for (const indexName of this._storeSchema.indexNames) {
      const indexSchema = this._storeSchema.index(indexName);
      const trait = indexSchema.calcTrait(newItem);
      const encoded = this._codec.encodeTrait(trait, indexSchema.explode);
      const traitName = indexName;
      row.traits[traitName] = encoded;
    }

    return new Promise((resolve, reject) => {
      const req = idbCur.update(row);
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

/** Represents a selection of a bunch of items from a [[Store]]. */
export class Selection<Item extends Storable, Trait extends Indexable> {

  private readonly _query: Query<Trait>;
  private readonly _idbSourceCont: PACont<IDBObjectStore | IDBIndex, TransactionMode>;
  private readonly _storeSchemaCont: PACont<StoreSchema<Item>>;
  private readonly _codec: Codec;

  private _cursorCont: PACont<Cursor<Item, Trait>, TransactionMode>;

  constructor(args: {
    query: Query<Trait>;
    idbSourceCont: PACont<IDBObjectStore, TransactionMode> | PACont<IDBIndex, TransactionMode>;
    storeSchemaCont: PACont<StoreSchema<Item>>;
    codec: Codec;
  }) {
    this._query = args.query;
    this._storeSchemaCont = args.storeSchemaCont;
    this._idbSourceCont = args.idbSourceCont;
    this._codec = args.codec;

    this._cursorCont = PACont.pair(
      this._idbSourceCont, this._storeSchemaCont
    ).map(async ([idbSource, storeSchema]) => {
      // TODO: use transactionmode
      return new Cursor<Item, Trait>({
        idbSource: idbSource,
        query: this._query,
        storeSchema: storeSchema,
        codec: this._codec,
      });
    });
  }

  async replaceRows(mapper: (row: Row) => Row): Promise<void> {
    await this._cursorCont.run('rw', async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        const oldRow = cursor.currentRow();
        const newRow = mapper(oldRow);
        await cursor.replaceRow(newRow);
      }
    });
  }

  /** Filter the selection */
  filter(...predicates: Array<(item: Item) => boolean>): this {
    const bigPred = (item: Item): boolean => predicates.every(pred => pred(item));

    this._cursorCont = this._cursorCont.map(cursor => {
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

  /** Drop `count` items off of the beginning of a selection */
  drop(count: number): this {
    this._cursorCont = this._cursorCont.map(cursor => {
      const modified = Object.create(cursor);
      modified.init = async function() {
        await cursor.init.call(this);
        await cursor.step.call(this, { size: count });
      };
      return modified;
    });
    return this;
  }

  /** Limit the selection to at most `count` items */
  limit(count: number): this {
    this._cursorCont = this._cursorCont.map(cursor => {
      const limited = Object.create(cursor);
      let passed = 0;

      limited.step = async function(this: typeof cursor, ...args: Parameters<(typeof cursor)['step']>) {
        await cursor.step.call(this, ...args);
        passed++;
        if (passed > count)
          console.warn("[jinedb] .limit()'d selection exceeding max count");
      };

      const oldExhaustedGetter = M.a(getPropertyDescriptor(cursor, 'exhausted')?.get);
      Object.defineProperty(limited, 'exhausted', {
        get() {
          return passed === count || oldExhaustedGetter.call(this);
        },
      });

      return limited;
    });
    return this;
  }

  /** Test if the selection is empty or not. */
  async isEmpty(): Promise<boolean> {
    return await this._cursorCont.run('r', async cursor => {
      await cursor.init();
      return cursor.exhausted;
    });
  }

  /** Replace all selected items with the result of passing them into the given callback. */
  async replace(mapper: (item: Item) => Item): Promise<void> {
    await this._cursorCont.run('rw', async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        const oldItem = cursor.currentItem();
        const newItem = mapper(oldItem);
        await cursor.replace(newItem);
      }
    });
  }

  /** Update all selected items with the given delta. */
  async update(delta: Partial<Item>): Promise<void> {
    await this._cursorCont.run('rw', async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        await cursor.update(delta);
      }
    });
  }

  /** Delete the selected items from the database. */
  async delete(): Promise<void> {
    await this._cursorCont.run('rw', async cursor => {
      for (await cursor.init(); cursor.active; await cursor.step()) {
        await cursor.delete();
      }
    });
  }

  /** Calculate the number of selected items. */
  async count(): Promise<number> {
    return await this._cursorCont.run('r', async cursor => {
      let result = 0;
      for (await cursor.init(); cursor.active; await cursor.step()) {
        result++;
      }
      return result;
    });
  }

  /** Return all selected items as an array. */
  async array(): Promise<Array<Item>> {
    return await this._cursorCont.run('r', async cursor => {
      const result: Array<Item> = [];
      for (await cursor.init(); cursor.active; await cursor.step()) {
        result.push(cursor.currentItem());
      }
      return result;
    });
  }

  /** Asynchronously iterate over the selected items */
  [Symbol.asyncIterator](): AsyncIterator<Item> {

    // !-!-!-!-!-!-!-!-! WARNING !-!-!-!-!-!-!-!-!
    // Reading the following code has been linked
    // to such effects as:
    // - Nausea and/or vomiting
    // - Psychotic break from reality
    // - Beginning or ending of belief in God
    // - Mid-life crisis
    // Proceed at your own risk!

    let resolveCursor: (cursor: Cursor<Item, Trait>) => void;
    const cursorPromise: Promise<Cursor<Item, Trait>>
      = new Promise(resolve => resolveCursor = resolve);

    let resolveIteratorDone: (iteratorDone: () => void) => void;
    const iteratorDonePromise: Promise<() => void>
      = new Promise(resolve => resolveIteratorDone = resolve);

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this._cursorCont.run('r', cursor => {
      resolveCursor(cursor);
      return new Promise(resolve => {
        const iteratorDone = resolve;
        resolveIteratorDone(iteratorDone);
      });
    });

    return {
      async next(): Promise<IteratorResult<Item>> {

        const iteratorDone = await iteratorDonePromise;
        const cursor = await cursorPromise;

        if (!cursor.initialized)
          await cursor.init();

        if (cursor.exhausted) {
          const result: IteratorResult<Item> = { done: true, value: undefined };
          iteratorDone();
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

  private readonly _selection: Selection<Item, Trait>;
  private readonly _idbSourceCont: PACont<IDBIndex, TransactionMode>;

  constructor(args: {
    selectedTrait: Trait;
    idbSourceCont: PACont<IDBIndex, TransactionMode>;
    storeSchemaCont: PACont<StoreSchema<Item>>;
    codec: Codec;
  }) {
    this._idbSourceCont = args.idbSourceCont.map(idbIndex => {
      if (!idbIndex.unique)
        throw new JineError(`Cannot perform a SelectionUnique operaiton on a non-unique index!`);
      return idbIndex;
    });
    this._selection = new Selection({
      query: { equals: args.selectedTrait },
      idbSourceCont: args.idbSourceCont,
      storeSchemaCont: args.storeSchemaCont,
      codec: args.codec,
    });
  }

  // TODO: in the methods of this class, we don't ensure that >0 rows are selected

  /** Like [[Selection.replace]] */
  async replace(mapper: (oldItem: Item) => Item): Promise<void> {
    await this._selection.replace(mapper);
  }

  /** Like [[Selection.update]] */
  async update(delta: Partial<Item>): Promise<void> {
    await this._selection.update(delta);
  }

  /** Like [[Selection.delete]] */
  async delete(): Promise<void> {
    await this._selection.delete();
  }

  /** Get the selected item from the database. */
  async get(): Promise<Item> {
    const got = (await this._selection.array())[0];
    if (got === undefined)
      throw new JineError('No item found');
    return got;
  }

  /** Get the selected item from the database, or an alternative value if the item isn't found. */
  async getOr<T = undefined>(alternative: T): Promise<Item | T> {
    const got = (await this._selection.array())[0];
    if (got === undefined) return alternative;
    return got;
  }

}
