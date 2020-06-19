
import 'fake-indexeddb/auto';
import { Database, Store, Index, Connection } from '../src/jine';
import { reset } from './shared';

type Num = {
  value: number;
};

interface $$ {
  nums: Store<Num> & {
    by: {
      value: Index<Num, number>;
    };
  };
}

describe('queries!', () => {

  let jine!: Database<$$>;
  let conn!: Connection<$$>;

  const one = { value: 1 };
  const two = { value: 2 };
  const three = { value: 3 };
  const four = { value: 4 };
  const five = { value: 5 };

  beforeEach(async () => {
    reset();
    jine = new Database<$$>('jine');
    jine.migration(1, async (genuine: boolean, tx) => {
      const nums = tx.addStore<Num>('nums');
      nums.addIndex<number>('value', '.value');
    });
    conn = await jine.newConnection();
    conn.transact([conn.$.nums], 'rw', async tx => {
      await tx.$.nums.add(one);
      await tx.$.nums.add(two);
      await tx.$.nums.add(three);
      await tx.$.nums.add(four);
      await tx.$.nums.add(five);
    });
  });

  afterEach(async () => {
    await conn.$.nums.clear();
    conn.close();
  });

  it('Index supports .exists', async () => {
    expect(await conn.$.nums.by.value.exists(3)).toBe(true);
    expect(await conn.$.nums.by.value.exists(6)).toBe(false);
  });

  describe(".select", () => {

    it('supports .update', async () => {
      await conn.$.nums.by.value.select({ equals: 3 }).update({ value: 10 });

      const items = await conn.$.nums.array();
      const vals = new Set(items.map(row => row.value));
      expect(vals).toEqual(new Set([1, 2, 4, 5, 10]));

      const ten_count = await conn.$.nums.by.value.select({ equals: 10 }).count();
      expect(ten_count).toBe(1);
    });

    it('supports .filter', async () => {
      const odds = await conn.$.nums.all().filter((num: Num) => num.value % 2 === 1).array();
      expect(odds).toEqual([one, three, five]);
    });

    describe('regarding for-await', () => {

      it('works', async () => {
        const results = [];
        for await (const result of conn.$.nums.all())
          results.push(result);
        expect(results).toStrictEqual([one, two, three, four, five])
      });

      it("times out if there's another operation during iteration", async () => {
        const f = async () => {
          for await (const result of conn.$.nums.all()) {
            await conn.$.nums.array();
          }
        };
        expect(f()).rejects.toThrow();
      });

    });

    it('supports .isEmpty', async () => {
      expect(await conn.$.nums.by.value.select({ equals: 3 }).isEmpty()).toBe(false);
      expect(await conn.$.nums.by.value.select({ equals: 6 }).isEmpty()).toBe(true);
    });

    it("supports * queries", async () => {
      const result = await conn.$.nums.by.value.select('everything').array();
      expect(result).toEqual([one, two, three, four, five]);
    });

    it("supports EQ queries", async () => {
      const result = await conn.$.nums.by.value.select({ equals: 3 }).array();
      expect(result).toEqual([three]);
    });

    it("supports GT queries", async () => {
      const result = await conn.$.nums.by.value.select({ above: 2 }).array();
      expect(result).toEqual([three, four, five]);
    });

    it("supports GE queries", async () => {
      const result = await conn.$.nums.by.value.select({ from: 2 }).array();
      expect(result).toEqual([two, three, four, five]);
    });

    it("supports LT queries", async () => {
      const result = await conn.$.nums.by.value.select({ below: 4 }).array();
      expect(result).toEqual([one, two, three]);
    });

    it("supports LE queries", async () => {
      const result = await conn.$.nums.by.value.select({ through: 4 }).array();
      expect(result).toEqual([one, two, three, four]);
    });

    it("supports GT/LT queries", async () => {
      const result = await conn.$.nums.by.value.select({ above: 1, below: 4 }).array();
      expect(result).toEqual([two, three]);
    });

    it("supports GT/LE queries", async () => {
      const result = await conn.$.nums.by.value.select({ above: 1, through: 4 }).array();
      expect(result).toEqual([two, three, four]);
    });

    it("supports GE/LT queries", async () => {
      const result = await conn.$.nums.by.value.select({ from: 1, below: 4 }).array();
      expect(result).toEqual([one, two, three]);
    });

    it("supports GE/LE queries", async () => {
      const result = await conn.$.nums.by.value.select({ from: 1, through: 4 }).array();
      expect(result).toEqual([one, two, three, four]);
    });

  });

});
