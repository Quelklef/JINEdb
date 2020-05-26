
import 'fake-indexeddb/auto';
import { newJine, Jine, addStore, addIndex, Store, Index, BoundConnection } from '../src/jine';
import { reset } from './shared';

type Item = {
  attr: string;
  attr_unique: string;
  attr_explode: Array<string>;
}

interface $$ {
  $items: Store<Item> & {
    $index: Index<Item, string>;
    $index_unique: Index<Item, string>;
    $index_explode: Index<Item, string>;
    $index_derived: Index<Item, number>;
  };
}


describe('index', () => {

  const migrations = [

    {
      version: 1,

      alterations: [
        addStore<Item>({
          name: 'items',
          encode: x => x,
          decode: x => x as Item,
        }),

        addIndex<Item, string>({
          name: 'index',
          to: 'items',
          trait: 'attr',
        }),

        addIndex<Item, string>({
          name: 'index_unique',
          to: 'items',
          trait: 'attr_unique',
          unique: true,
        }),

        addIndex<Item, string>({
          name: 'index_explode',
          to: 'items',
          trait: 'attr_explode',
          explode: true,
        }),

        addIndex<Item, number>({
          name: 'index_derived',
          to: 'items',
          trait: item => item.attr.length,
        }),
      ],
    },

  ];

  let jine!: Jine<$$>;
  let conn!: $$ & BoundConnection<$$>;

  beforeEach(async () => {
    await reset();
    jine = await newJine<$$>('jine', migrations);
    conn = await jine.newConnection();
  });

  afterEach(async () => {
    conn.close();
  });

  describe('path index', () => {

    it("allows for find()'ing items", async () => {

      const item = {
        attr: "get me!",
        attr_unique: '',
        attr_explode: [],
      }

      await conn.$items.add(item);
      const got = await conn.$items.$index.find("get me!");
      expect(got).toEqual([item]);

    });

    it("doesn't allow duplicate values on a unique index", async () => {

      const item_a = {
        attr: 'a',
        attr_unique: 'both',
        attr_explode: ['ae1', 'ae2'],
      };

      const item_b = {
        attr: 'b',
        attr_unique: 'both',
        attr_explode: ['be1', 'be2'],
      }

      await conn.$items.add(item_a);

      await expect(conn.$items.add(item_b))
        .rejects.toThrow();

      expect(await conn.$items.count()).toEqual(1);

    });

    it("properly explodes", async () => {

      const item = {
        attr: 'xxx',
        attr_unique: 'yyy',
        attr_explode: ['a', 'b', 'c'],
      };

      await conn.$items.add(item);

      expect(await conn.$items.$index_explode.find('a')).toEqual([item]);
      expect(await conn.$items.$index_explode.find('b')).toEqual([item]);
      expect(await conn.$items.$index_explode.find('c')).toEqual([item]);

    });

  });

  describe('unique index', () => {

    it("allows for get()'ing items", async () => {

      const item = {
        attr: "",
        attr_unique: 'get me!',
        attr_explode: [],
      }

      await conn.$items.add(item);
      const got = await conn.$items.$index_unique.get("get me!");
      expect(got).toEqual(item);

    });

    it("throws on a failed get()", async () => {

      expect(async () => await conn.$items.$index_unique.get('xxx'))
        .rejects.toThrow();

    });

  });

  describe('derived index', () => {

    it("allows for find()'ing items", async () => {

      const item = {
        attr: "12345",
        attr_unique: '',
        attr_explode: [],
      }

      await conn.$items.add(item);
      const got = await conn.$items.$index_derived.find(5);
      expect(got).toEqual([item]);

    });

  });

});
