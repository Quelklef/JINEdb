
import { Row } from './row';
import { some, Dict } from './util';
import { Storable } from './storable';
import { IndexableTrait } from './traits';
import { fullEncode, fullDecode, ItemCodec } from './codec';

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

export function query<Item extends Storable, Trait extends IndexableTrait>(
  idb_index: IDBIndex,
  item_codec: ItemCodec<Item>,
  query_spec: QuerySpec,
): QueryResult<Item, Trait> {
  const cursor = new Cursor<Item, Trait>(idb_index, query_spec, item_codec);
  const query_result = new QueryResult<Item, Trait>(cursor);
  return query_result;
}



export class Cursor<Item extends Storable, Trait extends IndexableTrait> implements Cursor<Item, Trait> {
  /* IDBCursor wrapper */

  // For use by the API user to monkeypatch in any
  // methods that are missing from this class.
  // TODO: replicate on other classes.
  my: Dict<string, any> = {};

  readonly _item_codec: ItemCodec<Item>;
  readonly _query_spec: QuerySpec;

  readonly _idb_source: IDBIndex | IDBObjectStore;
  _idb_req: IDBRequest | null;
  _idb_cur: IDBCursorWithValue | null;

  constructor(idb_source: IDBIndex | IDBObjectStore, query_spec: QuerySpec, item_codec: ItemCodec<Item>) {
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
    return fullDecode(row.payload, this._item_codec);
  }

  currentTrait(): Trait | undefined {
    // TODO: trait decoding!!
    this._assertActive();
    return some(this._idb_cur).key as Trait;
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
    const row = some(this._idb_cur).value;
    row.payload = fullEncode(new_item, this._item_codec);
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

export class QueryResult<Item extends Storable, Trait extends IndexableTrait> {

  _cursor: Cursor<Item, Trait>;

  constructor(cursor: Cursor<Item, Trait>) {
    this._cursor = cursor;
  }

  get cursor(): Cursor<Item, Trait> {
    return this._cursor;
  }

  async replace(mapper: (item: Item) => Item): Promise<void> {
    await this._cursor.init();
    while (this._cursor.active) {
      const old_item = this._cursor.currentItem();
      const new_item = mapper(old_item);
      await this._cursor.replace(new_item);
      await this._cursor.step();
    }
  }

  async update(updates: Partial<Item>): Promise<void> {
    await this._cursor.init();
    while (this._cursor.active) {
      await this._cursor.update(updates);
      await this._cursor.step();
    }
  }

  async delete(): Promise<void> {
    await this._cursor.init();
    while (this._cursor.active) {
      await this._cursor.delete();
      await this._cursor.step();
    }
  }

  async array(): Promise<Array<Item>> {
    const result = [];
    await this._cursor.init();
    while (this._cursor.active) {
      result.push(this._cursor.currentItem());
      await this._cursor.step();
    }
    return result;
  }

}
