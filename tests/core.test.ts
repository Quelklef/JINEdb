

import 'fake-indexeddb/auto';
import { Database, Store, Index, ConnectionActual, NativelyIndexable, NativelyStorable } from '../src/jine';
import { reset } from './shared';

describe('core', () => {

  let jine!: Database<any>;  // use <any> for convenience
  let conn!: ConnectionActual<any>;

  beforeEach(() => {
    reset();
    jine = new Database<any>('jine');
    jine.migration(1, async (tx: any) => { });
  });

  it('works with custom storable types', async () => {

    class MyPair_v1 {
      constructor(
        public left: any,
        public right: any,
      ) { }
    }

    await jine.upgrade(2, async (genuine: boolean, tx: any) => {
      const pairs = await tx.addStore('pairs');

      tx.storables.register(MyPair_v1, 'MyPair', {
        encode(pair: MyPair_v1): NativelyStorable {
          return { left: pair.left, right: pair.right };
        },
        decode(encoded: NativelyStorable): MyPair_v1 {
          const { left, right } = encoded as any;
          return new MyPair_v1(left, right);
        },
      });
    });

    await jine.connect(async (conn: any) => {
      const pair = new MyPair_v1('left', 'right');
      conn.$.pairs.add(pair);
      const got = await conn.$.pairs.array();
      expect(got).toEqual([pair]);
      expect(got[0].constructor).toBe(MyPair_v1);
    });

    class MyPair_v2 {
      constructor(
        public fst: any,
        public snd: any,
      ) { }
    }

    await jine.upgrade(3, async (genuine: boolean, tx: any) => {
      await tx.storables.upgrade('MyPair', {
        constructor: MyPair_v2,
        encode(pair: MyPair_v2): NativelyStorable {
          return { fst: pair.fst, snd: pair.snd };
        },
        decode(encoded: NativelyStorable): MyPair_v2 {
          const { fst, snd } = encoded as any;
          return new MyPair_v2(fst, snd);
        },
        async migrate() {
          await tx.$.pairs.all().replace((old: any) => {
            const pair_v1 = old as MyPair_v1;
            const pair_v2 = new MyPair_v2(pair_v1.left, pair_v1.right);
            return pair_v2;
          });
        },
      });
    });

    await jine.connect(async (conn: any) => {
      const new_pair = new MyPair_v2('fst', 'snd');
      conn.$.pairs.add(new_pair);
      const got = await conn.$.pairs.array();
      const old_pair = new MyPair_v2('left', 'right');
      expect(got).toEqual([old_pair, new_pair]);
      expect(got[0].constructor).toBe(MyPair_v2);
      expect(got[1].constructor).toBe(MyPair_v2);
    });

  });

  it('works with custom indexable types', async () => {

    type BodyRating = 'pitiful' | 'reasonable' | 'impressive';

    interface Person {
      name: string;
      body: BodyRating;
    }

    await jine.upgrade(2, async (genuine: boolean, tx: any) => {
      const people = tx.addStore('people');
      await people.addIndex('name', '.name');
    });

    await jine.connect(async (conn: any) => {
      await conn.$.people.add({ name: 'me', body: 'reasonable' });
      await conn.$.people.add({ name: 'the guy she tells me not to worry about', body: 'impressive' });
      expect(await conn.$.people.count()).toBe(2);
    });

    class BodyTrait {
      constructor(
        public body_rating: BodyRating,
      ) { }
    }

    await jine.upgrade(3, async (genuine: boolean, tx: any) => {
      tx.indexables.register(BodyTrait, 'BodyTrait', {
        encode(body_trait: BodyTrait): number {
          return ['pitiful', 'reasonable', 'impressive'].indexOf(body_trait.body_rating);
        },
        decode(encoded: NativelyStorable): BodyTrait {
          const idx = encoded as number;
          return new BodyTrait(['pitiful', 'reasonable', 'impressive'][idx] as BodyRating);
        },
      });
      await tx.$.people.addIndex('body_rating', (person: Person) => new BodyTrait(person.body));
    });

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

    await jine.upgrade(2, async (genuine: boolean, tx: any) => {
      tx.indexables.register(MyCustomIndexable, 'mci', {
        encode(mci: MyCustomIndexable): NativelyIndexable {
          return { one: 1, two: 2, three: 3 }[mci.name];
        },
        decode(encoded: NativelyIndexable): MyCustomIndexable {
          const actual = encoded as 1 | 2 | 3;
          return new MyCustomIndexable(['one', 'two', 'three'][actual - 1] as any);
        },
      });
      const itemstore = tx.addStore('itemstore');
      itemstore.addIndex('trait', (item: Item) => item.nums.map(n => new MyCustomIndexable(n as any)));
      for (const item of items)
        await itemstore.add(item);
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

    beforeEach(async () => {
      await jine.upgrade(2, async (genuine: boolean, tx: any) => {
        tx.storables.register(MyCustomStorable, 'mcs', {
          encode(mcs: MyCustomStorable): NativelyStorable {
            return mcs.val;
          },
          decode(encoded: NativelyStorable): MyCustomStorable {
            const actual = encoded as string;
            return new MyCustomStorable(actual);
          },
        });
        tx.addStore('items');
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
