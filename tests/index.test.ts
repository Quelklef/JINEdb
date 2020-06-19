
import 'fake-indexeddb/auto';
import { Database, Store, Index, Connection } from '../src/jine';
import { reset } from './shared';

type Item = {
  attr: string;
  attr_unique: string;
  attr_explode: Array<string>;
}

interface $$ {
  items: Store<Item> & {
    by: {
      index: Index<Item, string>;
      index_unique: Index<Item, string>;
      index_explode: Index<Item, string>;
      index_derived: Index<Item, number>;
    };
  };
}


describe('index', () => {

  let jine!: Database<$$>;
  let conn!: Connection<$$>;

  beforeEach(async () => {
    reset();
    jine = new Database<$$>('jine');
    jine.migration(1, async (genuine: boolean, tx) => {
      const items = tx.addStore<Item>('items');
      items.addIndex<string>('index', '.attr');
      items.addIndex<string>('index_unique', '.attr_unique', { unique: true });
      items.addIndex<string>('index_explode', '.attr_explode', { explode: true });
      items.addIndex<number>('index_derived', (item: Item) => item.attr.length);
    });
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

      await conn.$.items.add(item);
      const got = await conn.$.items.by.index.find("get me!");
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

      await conn.$.items.add(item_a);

      await expect(conn.$.items.add(item_b))
        .rejects.toThrow();

      expect(await conn.$.items.count()).toEqual(1);

    });

    it("properly explodes", async () => {

      const item = {
        attr: 'xxx',
        attr_unique: 'yyy',
        attr_explode: ['a', 'b', 'c'],
      };

      await conn.$.items.add(item);

      expect(await conn.$.items.by.index_explode.find('a')).toEqual([item]);
      expect(await conn.$.items.by.index_explode.find('b')).toEqual([item]);
      expect(await conn.$.items.by.index_explode.find('c')).toEqual([item]);

    });

  });

  describe('unique index', () => {

    it("allows for get()'ing items", async () => {

      const item = {
        attr: "",
        attr_unique: 'get me!',
        attr_explode: [],
      }

      await conn.$.items.add(item);
      const got = await conn.$.items.by.index_unique.findOne("get me!");
      expect(got).toEqual(item);

    });

    it("throws on a failed get()", async () => {

      expect(async () => await conn.$.items.by.index_unique.findOne('xxx'))
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

      await conn.$.items.add(item);
      const got = await conn.$.items.by.index_derived.find(5);
      expect(got).toEqual([item]);

    });

  });

});
