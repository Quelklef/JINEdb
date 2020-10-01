
import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Database, Store, Index, Connection } from '../src/jine';
import { reset } from './shared';

describe('migration (no beforeEach)', () => {

  it('after reloading, jine should be able to reconstruct structure via migrations', async () => {

    let db!: Database<any>;

    async function setup(): Promise<void> {
      db = new Database<any>('db', {
        migrations: [
          async (genuine: boolean, tx: any) => {
            await tx.addStore('items');
          },
        ]
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
  let migrations!: Array<any>;

  beforeEach(async () => {
    reset();
    migrations = [ async (_tx: any) => { } ];
    jine = new Database<any>('jine', { migrations });
    await jine.initialized;
  });

  it('allows for adding and removing stores', async () => {

    migrations.push(async (genuine: boolean, tx: any) => {
      await tx.addStore('strings');
      await tx.addStore('numbers');
    });
    jine = new Database('jine', { migrations });

    await jine.connect(async (conn: any) => {
      await conn.$.strings.add('s t r i n g');
      expect(await conn.$.strings.array()).toEqual(['s t r i n g']);
      await conn.$.numbers.add(10);
      expect(await conn.$.numbers.array()).toEqual([10]);
    });

    migrations.push(async (genuine: boolean, tx: any) => {
      await tx.removeStore('strings');
      await tx.removeStore('numbers');
    });
    jine = new Database('jine', { migrations });

    await jine.connect(async (conn: any) => {
      await expect(async () => await conn.$.strings.array())
        .rejects.toThrow();
      await expect(async () => await conn.$.numbers.array())
        .rejects.toThrow();
    });

  });

  it('allows for adding and removing indexes', async () => {

    migrations.push(async (genuine: boolean, tx: any) => {
      const strings = await tx.addStore('strings');
      await strings.addIndex('self', (x: any) => x);
    });
    jine = new Database('jine', { migrations });

    await jine.connect(async (conn: any) => {
      await conn.$.strings.add('me!');
      expect(await conn.$.strings.by.self.get('me!')).toEqual(['me!']);
    });

    migrations.push(async (genuine: boolean, tx: any) => {
      await tx.$.strings.removeIndex('self');
    });
    jine = new Database('jine', { migrations });

    await jine.connect(async (conn: any) => {
      await expect(async () => await conn.$.strings.by.self.find('whatever'))
        .rejects.toThrow();
    });

  });

  /*
  it("throws on .abort()", async () => {
    async function go(): Promise<void> {
      migrations.push(async (genuine: boolean, tx: any) => {
        tx.abort();
      });
      jine = new Database('jine', { migrations });
      await jine.initialized;
    }
    await expect(go).rejects.toThrow();
  });
  */

});
