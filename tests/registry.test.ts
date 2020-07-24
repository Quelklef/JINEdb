
import 'fake-indexeddb/auto';
import { CodecRegistry, Encodable } from '../src/codec-registry';


describe('codec registry', () => {

  type Encoded = string | number | Array<Encoded>;
  type Box = [Encoded, string];

  let registry!: CodecRegistry<Encoded, Box>;

  beforeEach(() => {
    registry = new CodecRegistry<Encoded, Box>({
      box_constructor: Array,
      box: (unboxed: Encoded, metadata: string) => [unboxed, metadata],
      unbox: (boxed: Box) => [boxed[0], boxed[1]],
    });
  });

  it('allows already-encoded values of non-box types through', () => {
    expect(registry.encode('test')).toEqual('test');
    expect(registry.encode(15)).toEqual(15);
  });

  it('properly handles the box type', () => {
    const val = ['a', 'b', 'c'];
    expect(registry.decode(registry.encode(val))).toEqual(val);
  });

  it('properly handle a recursive instance of the box type', () => {
    const val = [ ['a'], ['b'], ['c'] ];
    expect(registry.decode(registry.encode(val))).toEqual(val);
  });

  it("doesn't fuck up with custom types", () => {

    class Person {
      constructor(
        public name: string,
        public age: number,
      ) { }
    }

    registry.register(Person, 'Person', {
      encode(person: Person): Encoded {
        return [person.name, person.age];
      },
      decode(encoded: Encoded): Person {
        const [name, age] = encoded as [string, number];
        return new Person(name, age);
      },
    });

    const me = new Person('me', 420);
    const enc = me as any as Encodable;  // unfortunately required
    expect(registry.decode(registry.encode(enc))).toEqual(me);

  });

});
