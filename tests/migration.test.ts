
import 'fake-indexeddb/auto';
import { newJine, Database, Store, Index, ConnectionActual, NativelyIndexable, NativelyStorable } from '../src/jine';
import { reset } from './shared';

describe('migration', () => {

  let jine!: Database<any>;  // use <any> for convenience
  let conn!: ConnectionActual<any>;

  beforeEach(async () => {
    reset();
    jine = await newJine<any>('jine');
    await jine.upgrade(1, async (tx: any) => { });
  });

  it('allows for adding and removing stores', async () => {

    await jine.upgrade(2, async (genuine: boolean, tx: any) => {
      await tx.addStore('strings');
    });

    await jine.connect(async (conn: any) => {
      await conn.$.strings.add('s t r i n g');
      expect(await conn.$.strings.array()).toEqual(['s t r i n g']);
    });

    await jine.upgrade(3, async (genuine: boolean, tx: any) => {
      await tx.removeStore('strings');
    });

    await jine.connect(async (conn: any) => {
      expect(conn.$.strings).toBe(undefined);
    });

  });

  it('allows for adding and removing indexes', async () => {

    await jine.upgrade(2, async (genuine: boolean, tx: any) => {
      const strings = await tx.addStore('strings');
      await strings.addIndex('self', (x: any) => x);
    });

    await jine.connect(async (conn: any) => {
      await conn.$.strings.add('me!');
      expect(await conn.$.strings.by.self.find('me!')).toEqual(['me!']);
    });

    await jine.upgrade(3, async (genuine: boolean, tx: any) => {
      await tx.$.strings.removeIndex('self');
    });

    await jine.connect(async (conn: any) => {
      expect(Object.is(conn.$.strings.by.self, undefined)).toBe(true);
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
        encode: (sc: SomeClass): NativelyStorable => null,
        decode: (ns: NativelyStorable): SomeClass => new SomeClass(),
      });
      tx.indexables.register(SomeClass, 'SomeClass', {
        encode: (sc: SomeClass): NativelyStorable => null,
        decode: (ns: NativelyStorable): SomeClass => new SomeClass(),
      });

      tx.abort();
    });

    await jine.connect(async (conn: any) => {
      expect(conn._storables.isRegistered(SomeClass)).toBe(false);
      expect(conn._indexables.isRegistered(SomeClass)).toBe(false);
    });

  });

});
