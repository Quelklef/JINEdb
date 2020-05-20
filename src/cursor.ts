
import { Row } from './row';
import { Dict } from './util';
import { Storable } from './storable';
import { encodeTrait } from './traits';
import { IndexableTrait } from './traits';
import { fullEncode, fullDecode, ItemCodec } from './codec';

export class Cursor<Item extends Storable, Trait extends IndexableTrait> {
  /* IDBCursor wrapper */

  readonly item_codec: ItemCodec<Item>;

  // For use by the API user to monkeypatch in any
  // methods that are missing from this class.
  // TODO: replicate on other classes.
  my: Dict<string, any> = {};

  readonly _req: IDBRequest;

  // null marks the cursor as completed
  _idb_cur!: IDBCursorWithValue | null;

  static readonly _allow_construction = Symbol();
  constructor(override: any, req: IDBRequest, item_codec: ItemCodec<Item>) {
    if (override !== Cursor._allow_construction)
      throw Error('Do not construct a Cursor directly; use Cursor.new.');
    this._req = req;
    this.item_codec = item_codec;
  }

  static new<Item extends Storable, Trait extends IndexableTrait>(req: IDBRequest, item_codec: ItemCodec<Item>): Promise<Cursor<Item, Trait>> {
    return new Promise(resolve => {
      const cursor = new Cursor<Item, Trait>(Cursor._allow_construction, req, item_codec);
      req.onsuccess = event => {
        cursor._idb_cur = (event.target as any).result;
        resolve(cursor);
      };
    });
  }

  get isInBounds(): boolean {
    return this._idb_cur !== null && this._idb_cur.key !== undefined;
  }

  get _valid_cur(): IDBCursorWithValue {
    /* Return this._idb_cur if cursor is in bounds; else, throw */
    // TODO: perhaps this._idb_cur.key is undefined by choice of the API user?
    if (!this.isInBounds)
      throw Error('Cursor out-of-bounds');
    return this._idb_cur as IDBCursorWithValue;
  }

  async _nextCur(advance: (current_idb_cur: IDBCursor) => void): Promise<void> {
    /* Helper function for advancing the idb cursor, for instance via .continue() or .advance().
    Accepts a function which calls the low-level db advancement function, such as .continue().
    Waits for the advanement to complete, retrieves the new IDBCursor object, and sets this._idb_cur to it.
    Returns a promise that resolves when getting the new cursor is complete. */

    return new Promise(resolve => {
      this._req.onsuccess = event => {
        this._idb_cur = (event.target as any).result;
        resolve();
      };
      advance(this._valid_cur);
    });
  }

  async _continue(key: IDBValidKey): Promise<void> {
    await this._nextCur(cur => cur.continue(key));
  }

  async _advance(count: number): Promise<void> {
    await this._nextCur(cur => cur.advance(count));
  }

  async jump(value: Trait): Promise<void> {
    // Jump to a given value for the trait
    await this._continue(encodeTrait(value));
  }

  async step(count = 1): Promise<void> {
    // Step n keys
    await this._advance(count);
  }

  get _row(): Row {
    return this._valid_cur.value;
  }

  get item(): Item {
    // Get the item at the cursor.
    return fullDecode(this._row.payload, this.item_codec);
  }

  get trait(): Trait {
    // TODO: trait decoding!!
    return this._valid_cur.key as Trait;
  }

  async delete(): Promise<void> {
    // Delete the current object
    return new Promise(resolve => {
      const req = this._valid_cur.delete();
      req.onsuccess = _event => resolve();
    });
  }

  async _replaceRow(new_row: Row): Promise<void> {
    return new Promise(resolve => {
      const req = this._valid_cur.update(new_row);
      req.onsuccess = () => resolve();
    });
  }

  async replace(new_item: Item): Promise<void> {
    // Replace the current object with the given object
    const row = this._row;
    row.payload = fullEncode(new_item, this.item_codec);
    await this._replaceRow(row);
  }

  async _replaceAllRows(f: (row: Row) => Row): Promise<void> {
    /* Iterate over all remaining rows, replacing them as per the given function */
    const awaiting: Array<Promise<void>> = [];
    while (this.isInBounds) {
      const row = this._row;
      const mapped = f(row);
      awaiting.push(this._replaceRow(mapped));
      await this.step();
    }
    await Promise.all(awaiting);
  }

}
