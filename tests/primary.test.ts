
import "fake-indexeddb/auto";
import { Database, Connection, Transaction, Store, Index } from "../src/jine";
import { reset } from "./shared";

type Score = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type Room = {
  // Name of the room
  name: string,
  // 1-7 how much I like the room
  score: Score;
  // Neighboring rooms
  neighbors: Array<string>,
}

interface $$ {
  rooms: Store<Room> & {
    by: {
      name: Index<Room, string>;
      score: Index<Room, number>;
      neighbors: Index<Room, string>;
      degree: Index<Room, number>;
    }
  }
}

const room = (name: string, score: Score, neighbors: Array<string>): Room => ({ name, score, neighbors });
const ROOMS: Array<Room> = [
  room("attic", 7, ["upper bedroom"]),
  room("upper bedroom", 6, ["upper office", "attic"]),
  room("upper office", 6, ["upper bedroom", "ground-upper stairway"]),
  room("ground-upper stairway", 7, ["upper office", "ground hallway"]),
  room("ground hallway", 7, ["ground-upper stairway", "ground main bedroom", "ground second bedroom", "bathroom", "dining room"]),
  room("ground main bedroom", 6, ["ground hallway"]),
  room("ground second bedroom", 5, ["ground hallway"]),
  room("bathroom", 7, ["ground hallway"]),
  room("dining room", 7, ["ground hallway", "kitchen", "living room"]),
  room("kitchen", 7, ["dining room", "back porch", "ground-basement stairway"]),
  room("living room", 6, ["dining room", "front porch"]),
  room("back porch", 7, ["kitchen"]),
  room("front porch", 7, ["living room"]),
  room("ground-basement stairway", 7, ["kitchen", "basement main"]),
  room("basement main", 7, ["tool closet", "storage closet", "basement bedroom", "laundry room"]),
  room("tool closet", 5, ["basement main"]),
  room("storage closet", 5, ["basement main"]),
  room("basement bedroom", 5, ["basement main"]),
  room("laundry room", 4, ["basement main"]),
];

function expectArraySetEq<T>(actual: Array<T>, expected: Array<T>) {
  // https://stackoverflow.com/a/57428906/4608364
  expect(actual).toEqual(expect.arrayContaining(expected));
  expect(expected).toEqual(expect.arrayContaining(actual));
}

// TODO: test exploding and derived indexes

describe("usage", () => {

  let db!: Database<$$>;

  beforeEach(async () => {
    
    reset();
    
    db = new Database<$$>("home");
    await db.upgrade(1, async (genuine: boolean, tx: Transaction<$$>) => {
      const rooms = tx.addStore<Room>("rooms");
      rooms.addIndex<string>("name", ".name", { unique: true });
      rooms.addIndex<number>("score", ".score");
      rooms.addIndex<string>("neighbors", ".neighbors", { explode: true });
      rooms.addIndex<number>("degree", room => room.neighbors.length);
    });

    await db.transact(["rooms"], "rw", async (tx: Transaction<$$>) => {
      for (const room of ROOMS) {
        await tx.$.rooms.add(room);
      }
    });
    

  });

  describe('Transaction', () => {

    it(".abort()", async () => {
      await db.transact(['rooms'], 'rw', async (tx: Transaction<$$>) => {
        await tx.$.rooms.clear();
        tx.abort();
      });
      expectArraySetEq(await db.$.rooms.array(), ROOMS);
    });

    it("aborts on error", async () => {
      try {
        await db.transact(['rooms'], 'rw', async (tx: Transaction<$$>) => {
          await tx.$.rooms.clear();
          throw 'uh-oh';
        });
      } catch (err) {
        expect(err).toBe('uh-oh');
      }
      expectArraySetEq(await db.$.rooms.array(), ROOMS);
    });

  });



  // --- --- --- $ --- --- --- //
  
  let $!: $$;
  
  describe("Database.$", () => {

    beforeEach(() => {
      $ = db.$;
    });
    
    test_$();

  });
    
  describe("Connection.$", () => {
    
    let con!: Connection<$$>;
    beforeEach(async () => {
      con = await db.newConnection();
      $ = con.$;
    });
    afterEach(async () => await con.close());

    test_$();

  });

  describe("Transaction.$", () => {

    let con!: Connection<$$>;
    beforeEach(async () => {
      con = await db.newConnection();
      const tx_k = await con.newTransaction(['rooms'], 'rw');
      const tx = await tx_k.value; // FIXME
      $ = tx.$;
    });

    afterEach(() => {
      con.close();
    });

    test_$();

  });

  function test_$() {

    it("$.{store}.count()", async () => {
      expect(await $.rooms.count()).toBe(ROOMS.length);
    });

    it("$.{store}.clear()", async () => {
      await $.rooms.clear();
      expect(await $.rooms.count()).toBe(0);
    });

    describe("$.{store}.add()", () => {

      it("throws on uniqueness violation", async () => {
        const new_bathroom: Room = { name: "bathroom", score: 3, neighbors: [] };
        await expect($.rooms.add(new_bathroom))
          .rejects.toThrow();
      });

    });

    it("$.{store}.by.{index}.exists()", async () => {
      expect(await $.rooms.by.name.exists("bathroom"));
      expect(!await $.rooms.by.name.exists("no room here"));
    });

    it("$.{store}.by.{index}.find()", async () => {
      const expected = ROOMS.filter(room => room.score === 6);
      const actual = await $.rooms.by.score.find(6);
      expectArraySetEq(actual, expected);
    });

    describe("$.{store}.by.{index}.findOne()", () => {

      it("finds one", async () => {
        const expected = ROOMS.find(room => room.name === "bathroom");
        const actual = await $.rooms.by.name.findOne("bathroom");
        expect(actual).toStrictEqual(expected);
      });

      it("throws on failure", async () => {
        await expect($.rooms.by.name.findOne("no room here"))
          .rejects.toThrow();
      });

      it("throws on non-unique index", async () => {
        await expect($.rooms.by.score.findOne('whatever' as any))
          .rejects.toThrow();
      });
      
    });


    it("$.{store}.by.{index}.select( * )", async () => {
     const expected = ROOMS;
      const actual = await $.rooms.by.name.select("everything").array();
      expectArraySetEq(actual, expected);
    });

    it("$.{store}.by.{index}.select( EQ )", async () => {
      const expected = ROOMS.filter(room => room.score === 5);
      const actual = await $.rooms.by.score.select({ equals: 5 }).array();
      expectArraySetEq(actual, expected);
    });
    
    it("$.{store}.by.{index}.select( GT )", async () => {
      const expected = ROOMS.filter(room => room.score > 5);
      const actual = await $.rooms.by.score.select({ above: 5 }).array();
      expectArraySetEq(actual, expected);
    });
    
    it("$.{store}.by.{index}.select( GE )", async () => {
      const expected = ROOMS.filter(room => room.score >= 5);
      const actual = await $.rooms.by.score.select({ from: 5 }).array();
      expectArraySetEq(actual, expected);
    });
    
    it("$.{store}.by.{index}.select( LT )", async () => {
      const expected = ROOMS.filter(room => room.score < 6);
      const actual = await $.rooms.by.score.select({ below: 6 }).array();
      expectArraySetEq(actual, expected);
    });
    
    it("$.{store}.by.{index}.select( LE )", async () => {
      const expected = ROOMS.filter(room => room.score <= 6);
      const actual = await $.rooms.by.score.select({ through: 6 }).array();
      expectArraySetEq(actual, expected);
    });
    
    it("$.{store}.by.{index}.select( GT/LT )", async () => {
      const expected = ROOMS.filter(room => room.score > 4 && room.score < 7);
      const actual = await $.rooms.by.score.select({ above: 4, below: 7 }).array();
      expectArraySetEq(actual, expected);
    });
    
    it("$.{store}.by.{index}.select( GT/LE )", async () => {
      const expected = ROOMS.filter(room => room.score > 4 && room.score <= 6);
      const actual = await $.rooms.by.score.select({ above: 4, through: 6 }).array();
      expectArraySetEq(actual, expected);
    });
    
    it("$.{store}.by.{index}.select( GE/LT )", async () => {
      const expected = ROOMS.filter(room => room.score >= 5  && room.score < 7);
      const actual = await $.rooms.by.score.select({ from: 5, below: 7 }).array();
      expectArraySetEq(actual, expected);
    });
    
    it("$.{store}.by.{index}.select( GE/LE )", async () => {
      const expected = ROOMS.filter(room => room.score >= 5 && room.score <= 6);
      const actual = await $.rooms.by.score.select({ from: 5, through: 6 }).array();
      expectArraySetEq(actual, expected);
    });

    it("$.{store}.by.{index}.select().update()", async () => {
      // Decided I don"t like the attic
      await $.rooms.by.name.select({ equals: "attic" }).update({ score: 1 });
      const attic = await $.rooms.by.name.findOne("attic");
      expect(attic.score).toBe(1);
    });

    it("$.{store}.by.{index}.select().filter()", async () => {
      const expected = ROOMS.filter(room => room.name.includes("stairway"));
      const actual = await $.rooms.all().filter(room => room.name.includes("stairway")).array();
      expectArraySetEq(actual, expected);
    });

    describe("$.{store}.by.{index}.select()[asyncIterator]", () => {

      it("iterates items", async () => {
        const rooms = [];
        for await (const room of $.rooms.all()) {
          rooms.push(room);
        }
        expectArraySetEq(rooms, ROOMS);
      });

      it("times out if there's another mid-iteration operation", async () => {
        const bugged = async () => {
          for await (const result of $.rooms.all()) {
            // Another operation
            await $.rooms.array();
          }
        };
        expect(bugged()).rejects.toThrow();
      });
      
    });
      
  }
  
});
