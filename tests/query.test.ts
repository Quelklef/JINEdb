
import 'fake-indexeddb/auto';
import { newJine, Jine, addStore, addIndex, Store, Index, BoundConnection } from '../src/jine';
import { reset } from './shared';

type Num = {
  value: number;
};

interface $$ {
  $nums: Store<Num> & {
    $value: Index<Num, number>;
  };
}


describe('query', () => {

  const migrations = [

    {
      version: 1,

      alterations: [
        addStore<Num>({
          name: 'nums',
          encode: x => x,
          decode: x => x as Num,
        }),

        addIndex<Num, number>({
          name: 'value',
          to: 'nums',
          trait: 'value',
        }),
      ],
    },

  ];

  let jine!: Jine<$$>;
  let conn!: $$ & BoundConnection<$$> & $$;

  beforeEach(async () => {
    await reset();
    jine = await newJine<$$>('jine', migrations);
    conn = await jine.newConnection();
  });

  afterEach(async () => {
    conn.close();
  });

  describe("ranges", () => {

    const one = { value: 1 };
    const two = { value: 2 };
    const three = { value: 3 };
    const four = { value: 4 };
    const five = { value: 5 };

    beforeEach(async () => {
      conn.transact([conn.$nums], 'rw', async tx => {
        await tx.$nums.add(one);
        await tx.$nums.add(two);
        await tx.$nums.add(three);
        await tx.$nums.add(four);
        await tx.$nums.add(five);
      });
    });

    afterEach(async () => {
      await conn.$nums.clear();
    });

    it("supports * queries", async () => {
      const result = await conn.$nums.$value.range(null).array();
      expect(result).toEqual([one, two, three, four, five]);
    });

    it("supports EQ queries", async () => {
      const result = await conn.$nums.$value.range({ equals: 3 }).array();
      expect(result).toEqual([three]);
    });

    it("supports GT queries", async () => {
      const result = await conn.$nums.$value.range({ above: 2 }).array();
      expect(result).toEqual([three, four, five]);
    });

    it("supports GE queries", async () => {
      const result = await conn.$nums.$value.range({ from: 2 }).array();
      expect(result).toEqual([two, three, four, five]);
    });

    it("supports LT queries", async () => {
      const result = await conn.$nums.$value.range({ below: 4 }).array();
      expect(result).toEqual([one, two, three]);
    });

    it("supports LE queries", async () => {
      const result = await conn.$nums.$value.range({ through: 4 }).array();
      expect(result).toEqual([one, two, three, four]);
    });

    it("supports GT/LT queries", async () => {
      const result = await conn.$nums.$value.range({ above: 1, below: 4 }).array();
      expect(result).toEqual([two, three]);
    });

    it("supports GT/LE queries", async () => {
      const result = await conn.$nums.$value.range({ above: 1, through: 4 }).array();
      expect(result).toEqual([two, three, four]);
    });

    it("supports GE/LT queries", async () => {
      const result = await conn.$nums.$value.range({ from: 1, below: 4 }).array();
      expect(result).toEqual([one, two, three]);
    });

    it("supports GE/LE queries", async () => {
      const result = await conn.$nums.$value.range({ from: 1, through: 4 }).array();
      expect(result).toEqual([one, two, three, four]);
    });

  });

});
