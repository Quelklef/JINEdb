
import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { codec, Database, Store, Index, Connection, Transaction } from '../src/jine';
import { codecIdMark } from '../src/codec';
import { reset } from './shared';

describe('encoding', () => {

  const traits = [
    undefined,
    null,
    false,
    true,
    -Infinity,
    -100,
    0,
    100,
    Infinity,
    new Date(),
    'string',
    // binary
    [1, 2, 3],
  ];

  it('supports natively-indexable types', async () => {
    const jine = new Database<any>('jine', {
      migrations: [
        async (genuine: boolean, tx: any) => {
          const store = await tx.addStore('items');
          await store.addIndex('trait', '.trait');
        },
      ],
    });

    for (let i = 0; i < traits.length; i++) {
      const trait = traits[i];
      const item = { idx: i, trait };
      await jine.$.items.add(item);
      const got = await jine.$.items.by.trait.getAll(trait)
      expect(got).toEqual([item]);
    }
  });

  it('correctly orders natively-indexable types', async () => {
    const jine = new Database<any>('jine', {
      migrations: [
        async (genuine: boolean, tx: any) => {
          const store = await tx.addStore('items');
          await store.addIndex('trait', '.trait');
        },
      ],
    });

    for (let i = 0; i < traits.length - 1; i++) {
      const smallTrait = traits[i];
      const largeTrait = traits[i + 1];
      const smallItem = { trait: smallTrait };
      const largeItem = { trait: largeTrait };

      await jine.$.items.clear();
      await jine.$.items.add(smallItem);
      await jine.$.items.add(largeItem);

      expect(await jine.$.items.by.trait.select({ below: smallTrait }).array()).toEqual([]);
      expect(await jine.$.items.by.trait.select({ above: smallTrait }).array()).toEqual([largeItem]);
      expect(await jine.$.items.by.trait.select({ below: largeTrait }).array()).toEqual([smallItem]);
      expect(await jine.$.items.by.trait.select({ above: largeTrait }).array()).toEqual([]);
    }
  });

  describe('natively-storable types', () => {

    let migrations!: Array<any>;
    let jine: Database<any>;
    beforeEach(() => {
      reset();
      migrations = [
        async (genuine: boolean, tx: any) => {
          tx.addStore('items');
        }
      ]
      jine = new Database<any>('jine', { migrations });
    });

    describe('not in a migration', () => {
      async function txCont<R>(callback: (tx: Transaction<any>) => Promise<R>): Promise<R> {
        return await jine.transact(['items'], 'rw', callback);
      }
      doNativelyStorableTypeTest(false, txCont);
    });

    describe('in a migration', () => {
      async function txCont<R>(callback: (tx: Transaction<any>) => Promise<R>): Promise<R> {
        let result!: R;
        migrations.push(async (genuine: boolean, tx: any) => {
          result = await callback(tx);
        });
        const jine2 = new Database<any>('jine', { migrations: migrations });
        await jine2.initialized;
        return result;
      }
      doNativelyStorableTypeTest(true, txCont);
    });

    function doNativelyStorableTypeTest(isMigration: boolean, txCont: <R>(callback: (tx: Transaction<any>) => Promise<R>) => Promise<R>): void {
      it("works with natively-storable primitive values", async () => {
        const vals = new Set([null, undefined, 'string', 10, 3.14]);
        for (const val of vals)
          await jine.$.items.add(val);

        // twice to ensure it survives a round-trip in the case of being in a migration tx
        let result = await txCont(tx => tx.$.items.selectAll().array()) as Array<unknown>;
        expect(new Set(result)).toStrictEqual(vals);
        result = await txCont(tx => tx.$.items.selectAll().array()) as Array<unknown>;
        expect(new Set(result)).toStrictEqual(vals);
      });

      it("works with natively-storable object values", async () => {
        const o = { a: 'a', b: 'b' };
        const d = new Date();
        const r = /abc/;
        const a = [1, 2, 3];
        await jine.$.items.add(o);
        await jine.$.items.add(d);
        await jine.$.items.add(r);
        await jine.$.items.add(a);

        const oPrime = !isMigration ? o : Object.assign(o, { [codecIdMark]: null });

        // twice to ensure it survives a round-trip in the case of being in a migration tx
        let result = await txCont(tx => tx.$.items.selectAll().array());
        expect(result).toStrictEqual([oPrime, d, r, a]);
        result = await txCont(tx => tx.$.items.selectAll().array());
        expect(result).toStrictEqual([oPrime, d, r, a]);
      });

      it("works with recursive instantiations of the storable registry box type", async () => {
        const o = {
          x: 1,
          c: {
            x: 2,
            c: {
              x: 3,
              c: null,
            }
          }
        };
        await jine.$.items.add(o);

        const oPrime = !isMigration ? o : {
          x: 1,
          c: {
            x: 2,
            c: {
              x: 3,
              c: null,
              [codecIdMark]: null,
            },
            [codecIdMark]: null,
          },
          [codecIdMark]: null,
        };

        // twice to ensure it survives a round-trip in the case of being in a migration tx
        let result = await txCont(tx => tx.$.items.selectAll().array());
        expect(result).toStrictEqual([oPrime]);
        result = await txCont(tx => tx.$.items.selectAll().array());
        expect(result).toStrictEqual([oPrime]);
      });
    }

  });

  it(`user types are ignored during migrations`, async () => {

    class MyPair {
      constructor(
        public fst: any,
        public snd: any,
      ) { }
    }

    const fruits = new MyPair(new MyPair('orange', 'pawpaw'), 'banana');

    const pairCodec = {
      type: MyPair,
      id: 'MyPair',
      encode(it: MyPair): unknown {
        return { fst: it.fst, snd: it.snd };
      },
      decode(it: any): MyPair {
        const { fst, snd } = it;
        return new MyPair(fst, snd);
      },
    };

    const migrations = [];
    migrations.push(async (genuine: boolean, tx: any) => {
      await tx.addStore('items');
    });
    reset();
    let jine = new Database<any>('jine', { migrations, types: [pairCodec] });

    await jine.$.items.add(fruits);

    migrations.push(async (genuine: boolean, tx: any) => {
      const [item] = await tx.$.items.selectAll().array();
      // vv In migrations, you get the items' encoded values, not them as rich JS objects
      //    Since they are marked, we cannot use a plain expect(item).toEqual() for testing
      expect(item).toEqual({
        [codecIdMark]: 'MyPair',
        fst: {
          [codecIdMark]: 'MyPair',
          fst: 'orange',
          snd: 'pawpaw',
        },
        snd: 'banana',
      });
    });
    jine = new Database('jine', { migrations, types: [pairCodec] });

    // vv But now out of the migration, the item should be decoded as a JS class
    expect(await jine.$.items.selectAll().array()).toEqual([fruits]);

  });

  it('works with custom storable types', async () => {

    class MyPair {
      constructor(
        public left: any,
        public right: any,
      ) { }
    }

    reset();
    const jine = new Database<any>('jine', {
      migrations: [
        async (genuine: boolean, tx: any) => {
          await tx.addStore('pairs');
        },
      ],
      types: [
        {
          type: MyPair,
          id: 'MyPair',
          encode(pair: MyPair): object {
            return { left: pair.left, right: pair.right };
          },
          decode(pair: any): MyPair {
            const { left, right } = pair;
            return new MyPair(left, right);
          },
        }
      ]
    });

    await jine.connect(async (conn: any) => {
      const pair = new MyPair('left', 'right');
      conn.$.pairs.add(pair);
      const got = await conn.$.pairs.selectAll().array();
      expect(got).toEqual([pair]);
      expect(got[0].constructor).toBe(MyPair);
    });

    // test the recursive case as well
    await jine.connect(async (conn: any) => {
      await conn.$.pairs.clear();
      const pair = new MyPair(new MyPair('ll', 'lr'), new MyPair('rl', 'rr'));
      conn.$.pairs.add(pair);
      const got = await conn.$.pairs.selectAll().array();
      expect(got).toEqual([pair]);
      expect(got[0].constructor).toBe(MyPair);
      expect(got[0].left.constructor).toBe(MyPair);
      expect(got[0].right.constructor).toBe(MyPair);
    });

  });

  it('works with custom indexable types', async () => {

    type BodyRating = 'pitiful' | 'reasonable' | 'impressive';

    interface Person {
      name: string;
      body: BodyRating;
    }

    class BodyTrait {
      constructor(
        public body_rating: BodyRating,
      ) { }
    }

    reset();
    const migrations = [
      async (genuine: boolean, tx: any) => {
        const people = tx.addStore('people');
        await people.addIndex('name', '.name');
      }
    ];
    const types = [
      {
        type: BodyTrait,
        id: 'BodyTrait',
        encode(it: BodyTrait): unknown {
          return ['pitiful', 'reasonable', 'impressive'].indexOf(it.body_rating);
        },
        decode(encoded: any): BodyTrait {
          const idx = encoded as number;
          return new BodyTrait(['pitiful', 'reasonable', 'impressive'][idx] as BodyRating);
        },
      }
    ];
    let jine = new Database<any>('jine', { migrations, types });

    await jine.connect(async (conn: any) => {
      await conn.$.people.add({ name: 'me', body: 'reasonable' });
      await conn.$.people.add({ name: 'the guy she tells me not to worry about', body: 'impressive' });
      expect(await conn.$.people.count()).toBe(2);
    });

    migrations.push(async (genuine: boolean, tx: any) => {
      await tx.$.people.addIndex('body_rating', (person: Person) => new BodyTrait(person.body));
    });
    jine = new Database<any>('jine', { migrations, types });

    await jine.connect(async (conn: any) => {
      expect(await conn.$.people.by.body_rating.select({ above: new BodyTrait('pitiful') }).count()).toBe(2);
      expect(await conn.$.people.by.body_rating.select({ above: new BodyTrait('reasonable') }).count()).toBe(1);
      expect(await conn.$.people.by.body_rating.select({ above: new BodyTrait('impressive') }).count()).toBe(0);
    });

  });

  it('allows for Array<MyCustomIndexable>', async () => {

    class MyCustomIndexable {
      constructor(
        public name: 'one' | 'two' | 'three'
      ) { }
    }

    interface Item {
      nums: Array<string>;
    }

    const items = [
      { nums: [ 'one', 'one' ] },
      { nums: [ 'one', 'two' ] },
      { nums: [ 'one', 'three' ] },
      { nums: [ 'two', 'one' ] },
      { nums: [ 'two', 'two' ] },
      { nums: [ 'two', 'three' ] },
      { nums: [ 'three', 'one' ] },
      { nums: [ 'three', 'two' ] },
      { nums: [ 'three', 'three' ] },
    ];

    reset();
    const jine = new Database<any>('jine', {
      migrations: [
        async (genuine: boolean, tx: any) => {
          const itemstore = tx.addStore('itemstore');
          await itemstore.addIndex('trait', (item: Item) => item.nums.map(n => new MyCustomIndexable(n as any)));
        }
      ],
      types: [
        {
          type: MyCustomIndexable,
          id: 'id',
          encode(mci: MyCustomIndexable): unknown {
            return { one: 1, two: 2, three: 3 }[mci.name];
          },
          decode(encoded: any): MyCustomIndexable {
            const actual = encoded as 1 | 2 | 3;
            return new MyCustomIndexable(['one', 'two', 'three'][actual - 1] as any);
          },
        }
      ]
    });

    for (const item of items)
      await jine.$.itemstore.add(item);

    const got = await jine.$.itemstore.by.trait.select({ above: [new MyCustomIndexable('three'), new MyCustomIndexable('two')] }).array();
    expect(got).toStrictEqual([items[items.length - 1]]);

  });

  describe('derives container types for custom storables', () => {

    class MyCustomStorable {
      constructor(
        public val: string
      ) { }
    }

    const puppy = new MyCustomStorable('puppy');
    const kitten = new MyCustomStorable('kitten');

    let jine!: Database<any>;

    beforeEach(async () => {
      reset();
      jine = new Database<any>('jine', {
        migrations: [
          async (genuine: boolean, tx: any) => {
            await tx.addStore('items');
          },
        ],
        types: [
          {
            type: MyCustomStorable,
            id: 'MyCustomStorable',
            encode(mcs: MyCustomStorable): unknown {
              return { val: mcs.val };
            },
            decode(encoded: any): MyCustomStorable {
              const actual = encoded.val as string;
              return new MyCustomStorable(actual);
            },
          }
        ]
      });
    });

    it('allows for Array<MyCustomStorable>', async () => {
      const array = [puppy, kitten];
      await jine.$.items.add(array);
      expect(await jine.$.items.selectAll().array()).toStrictEqual([array]);
    });

    it('allows for Map<MyCustomStorable>', async () => {
      const map = new Map([[puppy, kitten]]);
      await jine.$.items.add(map);
      expect(await jine.$.items.selectAll().array()).toStrictEqual([map]);
    });

    it('allows for Set<MyCustomStorable>', async () => {
      const set = new Set([puppy, kitten]);
      await jine.$.items.add(set);
      expect(await jine.$.items.selectAll().array()).toStrictEqual([set]);
    });

    it('allows for Record<string, MyCustomStorable>', async () => {
      const object = { pup: puppy, kit: kitten };
      await jine.$.items.add(object);
      expect(await jine.$.items.selectAll().array()).toStrictEqual([object]);
    });

  });

});
