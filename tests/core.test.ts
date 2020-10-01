
import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Database, Store, Index, Connection } from '../src/jine';
import { reset } from './shared';

describe('core', () => {

  describe('without custom types', () => {

    it("works with natively-storable primitive values", async () => {
      reset();
      const jine = new Database<any>('jine', {
        migrations: [
          async (genuine: boolean, tx: any) => {
            tx.addStore('prims');
          }
        ],
      });
      const vals = new Set([null, undefined, 'string', 10, 3.14]);
      for (const val of vals)
        await jine.$.prims.add(val);
      expect(new Set(await jine.$.prims.array())).toStrictEqual(vals);
    });

    it("works with natively-storable object values", async () => {
      reset();
      const jine = new Database<any>('jine', {
        migrations: [
          async (genuine: boolean, tx: any) => {
            tx.addStore('obj');
          }
        ],
      });
      const o = { a: 'a', b: 'b' };
      const d = new Date();
      const r = /abc/;
      await jine.$.obj.add(o);
      await jine.$.obj.add(d);
      await jine.$.obj.add(r);
      expect(await jine.$.obj.array()).toStrictEqual([o, d, r]);
    });

    it("works with recursive instantiations of the storable registry box type", async () => {
      reset();
      const jine = new Database<any>('jine', {
        migrations: [
          async (genuine: boolean, tx: any) => {
            tx.addStore('obj');
          }
        ],
      });
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
      await jine.$.obj.add(o);
      expect(await jine.$.obj.array()).toStrictEqual([o]);
    });

  });

  it('works with custom storable types', async () => {

    // eslint-disable-next-line @typescript-eslint/class-name-casing
    class MyPair_v1 {
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
          type: MyPair_v1,
          id: 'MyPair',
          encode(pair: MyPair_v1): object {
            return { left: pair.left, right: pair.right };
          },
          decode(pair: any): MyPair_v1 {
            const { left, right } = pair;
            return new MyPair_v1(left, right);
          },
        }
      ]
    });

    await jine.connect(async (conn: any) => {
      const pair = new MyPair_v1('left', 'right');
      conn.$.pairs.add(pair);
      const got = await conn.$.pairs.array();
      expect(got).toEqual([pair]);
      expect(got[0].constructor).toBe(MyPair_v1);
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
          for (const item of items)
            await itemstore.add(item);
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
            tx.addStore('items');
          },
        ],
        types: [
          {
            type: MyCustomStorable,
            id: 'MyCustomStorable',
            encode(mcs: MyCustomStorable): unknown {
              return mcs.val;
            },
            decode(encoded: any): MyCustomStorable {
              const actual = encoded as string;
              return new MyCustomStorable(actual);
            },
          }
        ]
      });
    });

    it('allows for Array<MyCustomStorable>', async () => {
      const array = [puppy, kitten];
      await jine.$.items.add(array);
      expect(await jine.$.items.array()).toStrictEqual([array]);
    });

    it('allows for Map<MyCustomStorable>', async () => {
      const map = new Map([[puppy, kitten]]);
      await jine.$.items.add(map);
      expect(await jine.$.items.array()).toStrictEqual([map]);
    });

    it('allows for Set<MyCustomStorable>', async () => {
      const set = new Set([puppy, kitten]);
      await jine.$.items.add(set);
      expect(await jine.$.items.array()).toStrictEqual([set]);
    });

    it('allows for Record<string, MyCustomStorable>', async () => {
      const object = { pup: puppy, kit: kitten };
      await jine.$.items.add(object);
      expect(await jine.$.items.array()).toStrictEqual([object]);
    });

  });

});
