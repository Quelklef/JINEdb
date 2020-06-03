
import { some, Codec, Constructor } from './util';

/**
 * Cast a value to this type after registering it to be storable or indexable.
 *
 * Do **not** create a value that genuinely matches this type.
 *
 * For more information, see {@page Serialization and Custom Types}.
 */
export type Encodable = { __DONT__: never };

export class CodecRegistry<Encoded, Box extends Encoded> {

  _ids: Map<Constructor, string>;
  _codecs: Map<string, Codec<any, Encoded>>;

  _box: (unboxed: Encoded, id: string) => Box;
  _unbox: (boxed: Box) => [Encoded, string];
  _box_constructor: Constructor;

  constructor(args: {
    box: (unboxed: Encoded, id: string) => Box;
    unbox: (boxed: Box) => [Encoded, string];
    box_constructor: Constructor;
  }) {
    this._ids = new Map();
    this._codecs = new Map();

    this._box = args.box;
    this._unbox = args.unbox;
    this._box_constructor = args.box_constructor;
  }

  register<T>(con: Constructor, id: string, codec: Codec<T, Encoded>): void {
    if (this.isRegistered(con))
      throw Error(`Type '${con.name}' is already registered.`);
    this._ids.set(con, id);
    this._codecs.set(id, codec);
  }

  isRegistered(con: Constructor): boolean {
    return this._ids.has(con);
  }

  hasCodec(val: any): val is Encodable {
    return val?.constructor && this.isRegistered(val.constructor);
  }

  encode(val: Encodable | Encoded): Encoded {

    // If the item doesn't have a codec, then it must be already encoded.
    const already_encoded = !this.hasCodec(val);
    // This is ensured by the type requirement of Encoded | Encodable

    if (!already_encoded) {
      const type_id = some(this._ids.get((val as Object).constructor));
      const codec = some(this._codecs.get(type_id));
      const encoded = codec.encode(val as any);
      // use '+' to mark existence of a type id
      const boxed = this._box(encoded, '+' + type_id);
      return boxed;
    } else {
      const encoded = val as Encoded;
      if ((encoded as Object)?.constructor === this._box_constructor) {
        // use '-' to mark nonexistence of a type id
        const boxed = this._box(encoded, '-');
        return boxed;
      } else {
        return encoded;
      }
    }

  }

  decode(val: Encoded): any {
    if ((val as Object)?.constructor === this._box_constructor) {
      const boxed = val as Box;
      const [encoded, type_id] = this._unbox(boxed);
      if (type_id.startsWith('-')) return encoded;
      const codec = some(this._codecs.get(type_id.slice(1)));
      return codec.decode(encoded);
    } else {
      return val;
    }
  }

  modify(id: string, updates: Partial<Codec<any, Encoded>>): void {
    Object.assign(this._codecs.get(id), updates);
  }

  async upgrade(id: string, args: Codec<any, Encoded> & { constructor?: Constructor; migrate: () => Promise<void> }): Promise<void> {
    // Replace old constructor with new constructor, if given
    if (args.constructor) {
      const [old_constructor,] = some([...this._ids.entries()].find(([_key, val]) => val === id));
      this._ids.delete(old_constructor);
      this._ids.set(args.constructor, id);
    }
    this.modify(id, { encode: args.encode });
    await args.migrate();
    this.modify(id, { decode: args.decode });
  }

}

