
import { Row } from './row';
import { Index } from './index';
import { Codec } from './codec';
import { PACont } from './cont';
import { Dict, Awaitable } from './util';
import { Selection, Cursor } from './query';
import { StoreSchema, IndexSchema } from './schema';
import { Transaction, TransactionMode } from './transaction';
import { JineError, JineNoSuchStoreError, mapError } from './errors';

/**
 * A collection of stored items.
 *
 * A store is a collection of items saved and managed by Jine.
 * Jine can natively handle storing some types (see [[NativelyStorable]]), but not all types.
 * Custom types must be registered. See [[Storable]].
 *
 * @typeparam Item The type of objects contained in this store.
 */
export class Store<Item> {

  /**
   * An alias for [[Store.indexes]].
   *
   * The type is `unknown` because the type should be given by the user-defined `$$` type.
   *
   * See {@page Example}.
   */
  by: unknown;

  /**
   * Store name
   *
   * Unique per-database
   */
  get name(): Awaitable<string> {
    return this._schemaCont.run(schema => schema.name);
  }

  _parentTxCont: PACont<Transaction, TransactionMode>;
  _idbStoreCont: PACont<IDBObjectStore, TransactionMode>;
  _schemaCont: PACont<StoreSchema<Item>>;
  _codec: Codec;

  constructor(args: {
    txCont: PACont<Transaction, TransactionMode>;
    schemaCont: PACont<StoreSchema<Item>>;
    codec: Codec;
  }) {
    this._parentTxCont = args.txCont;
    this._schemaCont = args.schemaCont;
    this._codec = args.codec;

    this._idbStoreCont = args.txCont.map(async tx => {
      return await this._schemaCont.run(schema => {
        const storeName = schema.name;
        const idbTx = tx._idbTx;

        try {
          return idbTx.objectStore(storeName);
        } catch (err) {
          if (err.name === 'NotFoundError')
            throw new JineNoSuchStoreError({ storeName });
          throw mapError(err);
        }
      });
    });

    this.by = new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const indexName = prop;
          return new Index({
            parentStore: this,
            parentTxCont: this._parentTxCont,
            schemaCont: this._schemaCont.map(schema => schema.index(indexName) as IndexSchema<Item, any>),
            codec: this._codec,
          });
        }
      }
    });
  }

  async _mapExistingRows(mapper: (row: Row) => Row): Promise<void> {
    return await PACont.pair(this._idbStoreCont, this._schemaCont).run('rw', async ([idbStore, schema]) => {
      const cursor = new Cursor({
        idbSource: idbStore,
        query: 'everything',
        storeSchema: schema,
        codec: this._codec,
      });
      for (await cursor.init(); cursor.active; await cursor.step()) {
        await cursor._replaceRow(mapper(cursor._currentRow()));
      }
    });
  }

  /**
   * Add an item to the store.
   */
  async add(item: Item): Promise<void> {
    return PACont.pair(this._idbStoreCont, this._schemaCont).run('rw', async ([idbStore, schema]) => {
      return new Promise((resolve, reject) => {

        const traits: Dict<unknown> = {};
        // vv Calculate traits, but not during migrations, since migrations don't have access
        //    to user-defined types. These values will be filled in after migrations are run.
        if (idbStore.transaction.mode !== 'versionchange') {
          for (const indexName of schema.indexNames) {
            const indexSchema = schema.index(indexName);
            const trait = indexSchema.calcTrait(item);
            const encoded = this._codec.encodeTrait(trait, indexSchema.explode);
            const traitName = indexName;
            traits[traitName] = encoded;
          }
        }

        // Don't include the id since it's autoincrement'd
        const row: Omit<Row, 'id'> = {
          payload: this._codec.encodeItem(item),
          traits: traits,
        };

        const req = idbStore.add(row);
        req.onsuccess = _event => resolve();
        req.onerror = _event => reject(mapError(req.error));

      });
    });
  }

  /**
   * Remove all items from the store.
   */
  async clear(): Promise<void> {
    return await this._idbStoreCont.run('rw', idbStore => {
      return new Promise((resolve, reject) => {
        const req = idbStore.clear();
        req.onsuccess = _event => resolve();
        req.onerror = _event => reject(mapError(req.error));
      });
    });
  }

  /**
   * @return The number of items in the store
   */
  async count(): Promise<number> {
    return await this._idbStoreCont.run('r', idbStore => {
      return new Promise((resolve, reject) => {
        const req = idbStore.count();
        req.onsuccess = event => {
          const count = (event.target as any).result as number;
          resolve(count);
        };
        req.onerror = _event => reject(mapError(req.error));
      });
    });
  }

  /**
   * @returns An array with all items in the store.
   */
  async array(): Promise<Array<Item>> {
    return this._idbStoreCont.run('r', async idbStore => {
      return new Promise((resolve, reject) => {
        const req = idbStore.getAll();
        req.onsuccess = (event) => {
          const rows = (event.target as any).result as Array<Row>;
          const items = rows.map(row => this._codec.decodeItem(row.payload) as Item);
          resolve(items);
        };
        req.onerror = _event => reject(mapError(req.error));
      });
    });
  }

  /**
   * Begin a query with all the items in the store
   * @returns The query executor.
   */
  all(): Selection<Item, never> {
    return new Selection({
      query: 'everything',
      idbSourceCont: this._idbStoreCont,
      storeSchemaCont: this._schemaCont,
      codec: this._codec,
    });
  }

  /**
   * Add an index to the store.
   *
   * Only possible in a versionchange ('vc') transaction, which is given by [[Database.upgrade]].
   *
   * @param indexName The name to give the new index
   * @param trait The path or function that defines the indexed trait (see [[Index]])
   * @param options
   * - `unqiue`: enforces unique values for this trait; see [[Index.unique]].
   * - `explode`: see [[Index.explode]].
   */
  async addIndex<Trait>(
    indexName: string,
    traitPathOrGetter: string | ((item: Item) => Trait),
    options?: { unique?: boolean; explode?: boolean },
  ): Promise<Index<Item, Trait>> {

    return await PACont.pair(this._idbStoreCont, this._schemaCont).run('vc', async ([idbStore, schema]) => {

      if (typeof traitPathOrGetter === 'string') {
        const traitPath = traitPathOrGetter;
        if (!traitPath.startsWith('.'))
          throw new JineError("Trait path must start with '.'");
        traitPathOrGetter = traitPath.slice(1);
      }

      const unique = options?.unique ?? false;
      const explode = options?.explode ?? false;

      idbStore.createIndex(
        indexName,
        `traits.${indexName}`,
        { unique: unique, multiEntry: explode },
      );

      const indexSchema = new IndexSchema({
        name: indexName,
        traitPathOrGetter: traitPathOrGetter,
        unique: unique,
        explode: explode,
      });

      const index = new Index<Item, Trait>({
        parentStore: this,
        parentTxCont: this._parentTxCont,
        schemaCont: PACont.fromValue(indexSchema),
        codec: this._codec,
      });

      // Note that we don't actually calculate the trait values.
      // This is done after migrations are run.

      schema.addIndex(indexName, indexSchema);

      return index;

    });

  }

  /**
   * Remove an index from the store
   *
   * Only possible in a `versionchange` transaction, which is given by [[Database.upgrade]].
   *
   * @param name The name of the index to remove.
   */
  async removeIndex(name: string): Promise<void> {

    return await PACont.pair(this._idbStoreCont, this._schemaCont).run('vc', async ([idbStore, schema]) => {

      // remove idb index
      idbStore.deleteIndex(name);

      // update existing rows if needed
      const indexSchema = schema.index(name);
      if (indexSchema.kind === 'derived') {
        await this.all()._replaceRows((row: Row) => {
          delete row.traits[name];
          return row;
        });
      }

      // remove index from this object
      schema.removeIndex(name);

    });

  }

}

