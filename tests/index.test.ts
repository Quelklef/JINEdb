
import 'fake-indexeddb/auto';
import { newJine, Jine, addStore, addIndex, Store, Index } from '../src/jine';
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

  let jine!: Jine<$$>;

  beforeEach(async () => {

    await reset();

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

    jine = await newJine<$$>('jine', migrations);

  });

  afterEach(async () => {
    jine._idb_db.close();
  });

  describe('path index', () => {

    it("allows for get()'ing items", async () => {

      const item = {
        attr: "get me!",
        attr_unique: '',
        attr_explode: [],
      }

      await jine.$items.add(item);
      const got = await jine.$items.$index.get("get me!");
      expect(got).toEqual(item);

    });

    it("throws on a failed get()", async () => {

      expect(async () => await jine.$items.$index.get('xxx'))
        .rejects.toThrow();

    });

    it("throws on multiple matches for a get()", async () => {

      const item_a = {
        attr: 'same',
        attr_unique: 'A',
        attr_explode: [],
      };

      const item_b = {
        attr: 'same',
        attr_unique: 'B',
        attr_explode: [],
      };

      await jine.$items.add(item_a);
      await jine.$items.add(item_b);

      expect(async () => await jine.$items.$index.get('same'))
        .rejects.toThrow();

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

      await jine.$items.add(item_a);

      await expect(jine.$items.add(item_b))
        .rejects.toThrow();

      // The following check is disabled because a bug in fake-indexeddb prevents
      // the test from passing. See commit f61d36fb6f401b6aec4c5c2b93077e2a02532478.
      // expect(await jine.$items.count()).toEqual(1);

    });

    it("properly explodes", async () => {

      const item = {
        attr: 'xxx',
        attr_unique: 'yyy',
        attr_explode: ['a', 'b', 'c'],
      };

      await jine.$items.add(item);

      expect(await jine.$items.$index_explode.get('a')).toEqual(item);
      expect(await jine.$items.$index_explode.get('b')).toEqual(item);
      expect(await jine.$items.$index_explode.get('c')).toEqual(item);

    });

  });

  describe('derived index', () => {

    it("allows for get()'ing items", async () => {

      const item = {
        attr: "12345",
        attr_unique: '',
        attr_explode: [],
      }

      await jine.$items.add(item);
      const got = await jine.$items.$index_derived.get(5);
      expect(got).toEqual(item);

    });

    it("throws on a failed get()", async () => {

      expect(async () => await jine.$items.$index_derived.get(10))
        .rejects.toThrow();

    });


  });

});
