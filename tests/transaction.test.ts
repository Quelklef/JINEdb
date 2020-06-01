
import 'fake-indexeddb/auto';
import { newJine, Jine, Store, Index, BoundConnection } from '../src/jine';
import { reset } from './shared';

type Person = {
  name: string,
  age: number,
}

interface $$ {
  $people: Store<Person>;
}


describe('transaction', () => {

  let jine!: Jine<$$>;
  let conn!: $$ & BoundConnection<$$> & $$;

  beforeEach(async () => {
    reset();
    jine = newJine<$$>('jine');
    await jine.upgrade(1, async tx => {
      tx.addStore<Person>('$people');
    });
    conn = await jine.newConnection();
  });

  afterEach(async () => {
    conn.close();
  });

  const catherine = {
    name: 'catherine',
    age: 70,
  };

  const katheryn = {
    name: 'katheryn',
    age: 30,
  };

  it("supports multiple operations", async () => {
    await conn.transact([conn.$people], 'rw', async tx => {
      await tx.$people.add(catherine);
      await tx.$people.add(katheryn);
    });
    expect(await conn.$people.count()).toEqual(2);
  });

  it("aborts atomically with .abort()", async () => {
    await conn.transact([conn.$people], 'rw', async tx => {
      await tx.$people.add(catherine);
      await tx.$people.add(katheryn);
      tx.abort();
    });
    expect(await conn.$people.count()).toEqual(0);
  });

  it("aborts atomically with an error", async () => {
    class MyError extends Error { }
    try {
      await conn.transact([conn.$people], 'rw', async tx => {
        await tx.$people.add(catherine);
        await tx.$people.add(katheryn);
        throw new MyError('oh no');
      });
    } catch (e) {
      if (!(e instanceof MyError)) throw e;
    }
    expect(await conn.$people.count()).toEqual(0);
  });

});
