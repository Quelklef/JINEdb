
import { Row } from './row';
import { some } from './util';
import { Cursor } from './cursor';
import { Storable } from './storable';
import { fullDecode } from './codec';
import { IndexSchema } from './schema';
import { AutonomousStore } from './store';
import { TransactionMode } from './transaction';
import { encodeTrait, IndexableTrait } from './traits';

interface QueryMeta {
  reversed?: boolean;
  unique?: boolean;
}

interface ExactBound { equals: any }

interface LowerInclusive { from?: any }
interface LowerExclusive { above?: any }
interface UpperInclusive { through?: any }
interface UpperExclusive { below?: any }

type ExactQuerySpec = ExactBound & QueryMeta;
type LIQuerySpec = LowerInclusive & QueryMeta;
type LEQuerySpec = LowerExclusive & QueryMeta;
type UIQuerySpec = UpperInclusive & QueryMeta;
type UEQuerySpec = UpperExclusive & QueryMeta;
type IIQuerySpec = LowerInclusive & UpperInclusive & QueryMeta;
type IEQuerySpec = LowerInclusive & UpperExclusive & QueryMeta;
type EIQuerySpec = LowerExclusive & UpperInclusive & QueryMeta;
type EEQuerySpec = LowerExclusive & UpperExclusive & QueryMeta;

type QuerySpec
  = ExactQuerySpec
  | LIQuerySpec
  | LEQuerySpec
  | UIQuerySpec
  | UEQuerySpec
  | IIQuerySpec
  | IEQuerySpec
  | EIQuerySpec
  | EEQuerySpec
  ;


function compileTraitRange(query_spec: QuerySpec): IDBKeyRange {
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
  let result = query_spec.reversed ? 'prev' : 'next';
  if (query_spec.unique) result += 'unique';
  return result as IDBCursorDirection;
}


export interface Index<Item extends Storable, Trait extends IndexableTrait> {

  // TODO: Schema types should probably be in respective files, not together in schema.ts
  readonly schema: IndexSchema<Item, Trait>;

  count(): Promise<number>;
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

  async query(query_spec: QuerySpec): Promise<Cursor<Item, Trait>> {
    const req = this._idb_index.openCursor(
      compileTraitRange(query_spec),
      compileCursorDirection(query_spec)
    );
    return await Cursor.new<Item, Trait>(req, this.schema.item_codec);
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
    const encoded = encodeTrait(trait);
    const cur = await this.query({ equals: encoded });
    if (!cur.isInBounds) return undefined;
    const item = cur.item;
    await cur.step();
    if (cur.isInBounds)
      throw Error(`Multiple matches for index '${this.schema.name}' with value '${trait}'.`);
    return item;
  }

  async get(trait: Trait): Promise<Item> {
    const got = await this.tryGet(trait);
    if (got === undefined)
      throw Error(`No match for index '${this.schema.name}' with value '${trait}'.`);
    return got;
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

  async _transact<T>(mode: TransactionMode, callback: (bound_index: BoundIndex<Item, Trait>) => Promise<T>): Promise<T> {
    return this._parent._transact(mode, async bound_store => {
      const index = some(bound_store.indexes[this.schema.name]) as BoundIndex<Item, Trait>;
      return await callback(index);
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

  async all(): Promise<Array<Item>> {
    return await this._transact('r', async bound_index => await bound_index.all());
  }

}
