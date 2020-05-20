
import 'fake-indexeddb/auto';

import { newJine, Jine, addStore, addIndex, Store, Index } from '../src/jine';

type Person = {
  name: string,
  age: number,
}

interface $$ {
  $people: Store<Person>;
}


describe('index', () => {

  let jine!: Jine<$$>;

  beforeEach(async () => {

    await new Promise(resolve => {
      const req = indexedDB.deleteDatabase('jine');
      req.onsuccess = _event => resolve();
      req.onerror = () => console.log('database deletion error')
      req.onblocked = () => console.log('database deletion blocked');
    });

    const migrations = [

      {
        version: 1,

        alterations: [
          addStore<Person>({
            name: 'people',
            encode: x => x,
            decode: x => x as Person,
          }),
        ],
      },

    ];

    jine = await newJine<$$>('jine', migrations);

  });

  afterEach(async () => {

    jine._idb_db.close();

  });

  const catherine = {
    name: 'catherine',
    age: 70,
  };

  const katheryn = {
    name: 'katheryn',
    age: 30,
  };

  describe('transaction', () => {

    it("aborts atomically with .abort()", async () => {
      await jine.transact([jine.$people], 'rw', async tx => {
        await tx.$people.add(catherine);
        await tx.$people.add(katheryn);
        tx.abort();
      });
      expect(await jine.$people.count()).toEqual(0);
    });

    it("aborts atomically with an error", async () => {
      class MyError extends Error { }
      try {
        await jine.transact([jine.$people], 'rw', async tx => {
          await tx.$people.add(catherine);
          await tx.$people.add(katheryn);
          throw new MyError('oh no');
        });
      } catch (e) {
        if (!(e instanceof MyError)) throw e;
      }
      expect(await jine.$people.count()).toEqual(0);
    });

  });

});
