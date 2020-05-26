
import * as storable from './storable';
import * as indexable from './indexable';

type Storable = storable.Storable;
type Indexable = indexable.Indexable;
type NativelyIndexable = indexable.NativelyIndexable;

import { Row } from './row';
import { TransactionMode } from './transaction';
import { Store, BoundStore } from './store';
import { Index, BoundIndex } from './index';
import { some, Dict, Codec } from './util';

interface QueryMeta {
  reversed?: boolean;
  unique?: boolean;
}

interface ExactBound { equals: any }

interface LowerInclusive { from?: any }
interface LowerExclusive { above?: any }
interface UpperInclusive { through?: any }
interface UpperExclusive { below?: any }

type EverythingQuerySpec = null;
type ExactQuerySpec = ExactBound & QueryMeta;
type LIQuerySpec = LowerInclusive & QueryMeta;
type LEQuerySpec = LowerExclusive & QueryMeta;
type UIQuerySpec = UpperInclusive & QueryMeta;
type UEQuerySpec = UpperExclusive & QueryMeta;
type IIQuerySpec = LowerInclusive & UpperInclusive & QueryMeta;
type IEQuerySpec = LowerInclusive & UpperExclusive & QueryMeta;
type EIQuerySpec = LowerExclusive & UpperInclusive & QueryMeta;
type EEQuerySpec = LowerExclusive & UpperExclusive & QueryMeta;

export type QuerySpec
  = EverythingQuerySpec
  | ExactQuerySpec
  | LIQuerySpec
  | LEQuerySpec
  | UIQuerySpec
  | UEQuerySpec
  | IIQuerySpec
  | IEQuerySpec
  | EIQuerySpec
  | EEQuerySpec
  ;


function compileTraitRange(query_spec: QuerySpec): IDBKeyRange | undefined {
  /*

  Conpile an IDBKeyRange object from a QuerySpec.

  If the QuerySpec object matches more than one particular type,
  for instance by satisfying both ExactQuerySpec and EEQuerySpec,
  then one type will win over the other with the following
  order of precedence:

    - ExactQuerySpec
    - IIQuerySpec
    - IEQuerySpec
    - EIQuerySpec
    - EEQuerySpec
    - LIQuerySpec
    - LEQuerySpec
    - UIQuerySpec
    - UEQuerySpec

  */

  // The implementation isn't elegant, but it's easy to understand

  if (query_spec === null)
    return undefined;

  const exact_q = query_spec as ExactQuerySpec;
  if ('equals' in exact_q)
    return IDBKeyRange.only(exact_q.equals);

  const ii_q = query_spec as IIQuerySpec;
  if ('from' in ii_q && 'through' in ii_q)
    return IDBKeyRange.bound(ii_q.from, ii_q.through, false, false);

  const ie_q = query_spec as IEQuerySpec;
  if ('from' in ie_q && 'below' in ie_q)
    return IDBKeyRange.bound(ie_q.from, ie_q.below, false, true);

  const ei_q = query_spec as EIQuerySpec;
  if ('above' in ei_q && 'through' in ei_q)
    return IDBKeyRange.bound(ei_q.above, ei_q.through, true, false);

  const ee_q = query_spec as EEQuerySpec;
  if ('above' in ee_q && 'below' in ee_q)
    return IDBKeyRange.bound(ee_q.above, ee_q.below, true, true);

  const li_q = query_spec as LIQuerySpec;
  if ('from' in li_q)
    return IDBKeyRange.lowerBound(li_q.from, false)

  const le_q = query_spec as LEQuerySpec;
  if ('above' in le_q)
    return IDBKeyRange.lowerBound(le_q.above, true);

  const ui_q = query_spec as UIQuerySpec;
  if ('through' in ui_q)
    return IDBKeyRange.upperBound(ui_q.through, false);

  const ue_q = query_spec as UEQuerySpec;
  if ('below' in ue_q)
    return IDBKeyRange.upperBound(ue_q.below, true);

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

  readonly _item_codec: Codec<Item, Storable>;
  readonly _query_spec: QuerySpec;

  readonly _idb_source: IDBIndex | IDBObjectStore;
  _idb_req: IDBRequest | null;
  _idb_cur: IDBCursorWithValue | null;

  constructor(idb_source: IDBIndex | IDBObjectStore, query_spec: QuerySpec, item_codec: Codec<Item, Storable>) {
    this._item_codec = item_codec;
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
    return this._item_codec.decode(storable.decode(row.payload));
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
    row.payload = storable.encode(this._item_codec.encode(new_item));
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

      const cursor = new Cursor<Item, Trait>(idb_source, this.query_spec, this.source.structure.item_codec);
      await cursor.init();
      return await callback(cursor);

    });

  }

  async replace(mapper: (item: Item) => Item): Promise<void> {
    await this._withCursor('rw', async cursor => {
      while (cursor.active) {
        const old_item = cursor.currentItem();
        const new_item = mapper(old_item);
        await cursor.replace(new_item);
        await cursor.step();
      }
    });
  }

  async update(updates: Partial<Item>): Promise<void> {
    await this._withCursor('rw', async cursor => {
      while (cursor.active) {
        await cursor.update(updates);
        await cursor.step();
      }
    });
  }

  async delete(): Promise<void> {
    await this._withCursor('rw', async cursor => {
      while (cursor.active) {
        await cursor.delete();
        await cursor.step();
      }
    });
  }

  async count(): Promise<number> {
    return await this._withCursor('r', async cursor => {
      let result = 0;
      // TODO: replace all while loops here with
      // for (await cursor.init(); cursor.active; await cursor.step())
      for (; cursor.active; await cursor.step()) {
        result++;
      }
      return result;
    });
  }

  async array(): Promise<Array<Item>> {
    return await this._withCursor('r', async cursor => {
      const result: Array<Item> = [];
      while (cursor.active) {
        result.push(cursor.currentItem());
        await cursor.step();
      }
      return result;
    });
  }

}

export class UniqueQueryExecutor<Item extends Storable, Trait extends Indexable> {

  readonly qe: QueryExecutor<Item, Trait>;

  constructor(source: Index<Item, Trait>, query_spec: QuerySpec) {
    if (!source.structure.unique)
      throw Error('Cannot create a UniqueQueryExecutor on a non-unique index.');
    this.qe = new QueryExecutor(source, query_spec);
  }

  async replace(new_item: Item): Promise<void> {
    await this.qe.replace(_old_item => new_item);
  }

  async update(updates: Partial<Item>): Promise<void> {
    await this.qe.update(updates);
  }

  async delete(): Promise<void> {
    await this.qe.delete();
  }

  async get(): Promise<Item> {
    const got = (await this.qe.array())[0];
    if (got === undefined)
      throw Error('No item found');
    return got;
  }

}
