
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

  it('allows for updating trait getters', async () => {

    migrations.push(async (genuine: boolean, tx: any) => {
      const strings = await tx.addStore('strings');
      await strings.addIndex('trait', (x: any) => x.length);
    });
    jine = new Database('jine', { migrations });

    await jine.connect(async (conn: any) => {
      await conn.$.strings.add('123');
      await conn.$.strings.add('abc');
      expect(await conn.$.strings.by.trait.get(3)).toEqual(['123', 'abc']);
    });

    migrations.push(async (genuine: boolean, tx: any) => {
      await tx.$.strings.by.trait.updateTraitGetter((x: any) => [...x].filter(c => c === 'x').length);
    });
    jine = new Database('jine', { migrations });

    await jine.connect(async (conn: any) => {
      await conn.$.strings.add('___x');
      await conn.$.strings.add('___xx');
      await conn.$.strings.add('___xxx');

      // does not update traits on existing values
      expect(await conn.$.strings.by.trait.get(0)).toEqual([]);
      expect(await conn.$.strings.by.trait.get(1)).toEqual(['___x']);
      expect(await conn.$.strings.by.trait.get(2)).toEqual(['___xx']);
      expect(await conn.$.strings.by.trait.get(3)).toEqual(['123', 'abc', '___xxx']);
      expect(await conn.$.strings.by.trait.get(4)).toEqual([]);
    });

  });

  it('allows for updating trait paths', async () => {

    migrations.push(async (genuine: boolean, tx: any) => {
      const objects = await tx.addStore('objects');
      await objects.addIndex('trait', '.traitA');
    });
    jine = new Database('jine', { migrations });

    const obj = { traitA: 1, traitB: 2 };

    await jine.connect(async (conn: any) => {
      await conn.$.objects.add(obj);
      expect(await conn.$.objects.by.trait.get(1)).toEqual([obj]);
    });

    migrations.push(async (genuine: boolean, tx: any) => {
      await tx.$.objects.by.trait.updateTraitPath('.traitB');
    });
    jine = new Database('jine', { migrations });

    await jine.connect(async (conn: any) => {
      await conn.$.objects.add(obj);
      await conn.$.objects.add(obj);

      // does not update traits on existing values
      expect(await conn.$.objects.by.trait.get(1)).toEqual([obj]);
      expect(await conn.$.objects.by.trait.get(2)).toEqual([obj, obj]);
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
