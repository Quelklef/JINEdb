
import { Row } from './row';
import { Index } from './index';
import { PACont } from './cont';
import { Selection } from './query';
import { Dict, Awaitable } from './util';
import { TransactionMode } from './transaction';
import { StoreSchema, IndexSchema } from './schema';
import { Codec, Storable, Indexable } from './codec';
import { JineError, JineNoSuchStoreError, mapError } from './errors';

/**
 * A collection of items stored in the database.
 *
 * @typeparam Item The type of objects contained in this store.
 */
export class Store<Item extends Storable> {

  /**
   * Gives access to the store indexes.
   *
   * The type is `unknown` because the type should be given by the user-defined `$$` type.
   *
   * See {@page Example}.
   */
  public readonly by: unknown;

  /** Store name. Unique per-[[Database]]. */
  get name(): Awaitable<string> {
    return this._schemaCont.run(schema => schema.name);
  }

  private readonly _idbStoreCont: PACont<IDBObjectStore, TransactionMode>;
  private readonly _schemaCont: PACont<StoreSchema<Item>>;
  private readonly _codec: Codec;

  constructor(args: {
    parentIdbTxCont: PACont<IDBTransaction, TransactionMode>;
    schemaCont: PACont<StoreSchema<Item>>;
    codec: Codec;
  }) {
    this._schemaCont = args.schemaCont;
    this._codec = args.codec;

    this._idbStoreCont = PACont.pair(args.parentIdbTxCont, this._schemaCont).map(async ([idbTx, schema]) => {
      const storeName = schema.name;

      try {
        return idbTx.objectStore(storeName);
      } catch (err) {
        if (err.name === 'NotFoundError')
          throw new JineNoSuchStoreError({ storeName });
        throw mapError(err);
      }
    });

    this.by = new Proxy({}, {
      get: (_target: {}, prop: string | number | symbol) => {
        if (typeof prop === 'string') {
          const indexName = prop;
          return new Index({
            parentStore: this,
            parentStoreSchemaCont: this._schemaCont,
            parentIdbStoreCont: this._idbStoreCont,
            schemaCont: this._schemaCont.map(schema => schema.index(indexName) as IndexSchema<Item, any>),
            codec: this._codec,
          });
        }
      }
    });
  }

  /** Add an item to the store. */
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

  /** Remove all items from the store. */
  async clear(): Promise<void> {
    return await this._idbStoreCont.run('rw', idbStore => {
      return new Promise((resolve, reject) => {
        const req = idbStore.clear();
        req.onsuccess = _event => resolve();
        req.onerror = _event => reject(mapError(req.error));
      });
    });
  }

  /** Calculate the number of items in the store */
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

  /** Begin a query with all the items in the store */
  selectAll(): Selection<Item, never> {
    return new Selection({
      query: 'all',
      idbSourceCont: this._idbStoreCont,
      storeSchemaCont: this._schemaCont,
      codec: this._codec,
    });
  }

  /**
   * Add an index to the store.
   *
   * Only possible in a migration; see {@page Versioning}.
   *
   * @param indexName The name to give the new index
   * @param trait The path or function that defines the indexed trait.
   * @param options
   * - `unqiue`: enforces unique values for this trait; see [[Index.unique]].
   * - `explode`: see [[Index.explode]].
   */
  async addIndex<Trait extends Indexable>(
    indexName: string,
    traitPathOrGetter: string | ((item: Item) => Trait),
    options?: { unique?: boolean; explode?: boolean },
  ): Promise<Index<Item, Trait>> {

    return await PACont.pair(this._idbStoreCont, this._schemaCont).run('m', async ([idbStore, schema]) => {

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
        parentStoreSchemaCont: this._schemaCont,
        parentIdbStoreCont: this._idbStoreCont,
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
   * Only possible in a migration; see {@page Versioning}.
   */
  async removeIndex(name: string): Promise<void> {

    return await PACont.pair(this._idbStoreCont, this._schemaCont).run('m', async ([idbStore, schema]) => {

      // remove idb index
      idbStore.deleteIndex(name);

      // update existing rows if needed
      const indexSchema = schema.index(name);
      if (indexSchema.kind === 'derived') {
        await this.selectAll().replaceRows((row: Row) => {
          delete row.traits[name];
          return row;
        });
      }

      // remove index from this object
      schema.removeIndex(name);

    });

  }

}

