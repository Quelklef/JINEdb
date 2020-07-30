
import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Database, Store, Index, Connection, NativelyIndexable, NativelyStorable } from '../src/jine';
import { reset } from './shared';

describe('migration (no beforeEach)', () => {

  it('after reloading, jine should be able to reconstruct structure via migrations', async () => {

    let db!: Database<any>;
    
    async function setup(): Promise<void> {
      db = new Database<any>('db');
      await db.upgrade(1, async (genuine: boolean, tx: any) => {
        tx.addStore('items');
      });
    }

    // session 1
    await setup();
    await db.$.items.add('item');
    expect(await db.$.items.array()).toStrictEqual(['item']);

    // session 2
    await setup();
    expect(await db.$.items.array()).toStrictEqual(['item']);
    
  });
  
});

describe('migration', () => {

  let jine!: Database<any>;  // use <any> for convenience

  beforeEach(() => {
    reset();
    jine = new Database<any>('jine');
    jine.migration(1, async (_tx: any) => { });
  });

  it('allows for adding and removing stores', async () => {

    await jine.upgrade(2, async (genuine: boolean, tx: any) => {
      await tx.addStore('strings');
      await tx.addStore('numbers');
    });

    await jine.connect(async (conn: any) => {
      await conn.$.strings.add('s t r i n g');
      expect(await conn.$.strings.array()).toEqual(['s t r i n g']);
      await conn.$.numbers.add(10);
      expect(await conn.$.numbers.array()).toEqual([10]);
    });

    await jine.upgrade(3, async (genuine: boolean, tx: any) => {
      await tx.removeStore('strings');
      await tx.removeStore('numbers');
    });

    await jine.connect(async (conn: any) => {
      await expect(async () => await conn.$.strings.array())
        .rejects.toThrow();
      await expect(async () => await conn.$.numbers.array())
        .rejects.toThrow();
    });

  });

  it('allows for adding and removing indexes', async () => {

    await jine.upgrade(2, async (genuine: boolean, tx: any) => {
      const strings = await tx.addStore('strings');
      await strings.addIndex('self', (x: any) => x);
    });

    await jine.connect(async (conn: any) => {
      await conn.$.strings.add('me!');
      expect(await conn.$.strings.by.self.get('me!')).toEqual(['me!']);
    });

    await jine.upgrade(3, async (genuine: boolean, tx: any) => {
      await tx.$.strings.removeIndex('self');
    });

    await jine.connect(async (conn: any) => {
      await expect(async () => await conn.$.strings.by.self.find('whatever'))
        .rejects.toThrow();
    });

  });

  it("doesn't throw on .abort()", async () => {
    await jine.upgrade(2, async (genuine: boolean, tx: any) => {
      tx.abort();
    });
  });

  it("is atomic", async () => {

    class SomeClass { }

    await jine.upgrade(2, async (genuine: boolean, tx: any) => {
      tx.storables.register(SomeClass, 'SomeClass', {
        encode: (_sc: SomeClass): NativelyStorable => null,
        decode: (_ns: NativelyStorable): SomeClass => new SomeClass(),
      });
      tx.indexables.register(SomeClass, 'SomeClass', {
        encode: (_sc: SomeClass): NativelyStorable => null,
        decode: (_ns: NativelyStorable): SomeClass => new SomeClass(),
      });

      tx.abort();
    });

    await jine.connect(async (conn: any) => {
      const schema = await conn._schema_g();
      expect(schema.storables.isRegistered(SomeClass)).toBe(false);
      expect(schema.indexables.isRegistered(SomeClass)).toBe(false);
    });

  });

  it("using Database.$ without calling .initialize, relying on auto-init, works", async () => {

    jine.migration(2, async (genuine: boolean, tx: any) => {
      tx.addStore('numbers');
    });

    const got = await jine.$.numbers.array();
    expect(got).toStrictEqual([]);
    
  });

});
