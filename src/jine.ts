

// == Core == //

// (in order of ownership; lower is bound to higher)
export { Database } from './database';
export { Connection, BoundConnection, AutonomousConnection } from './connection';
export { Transaction } from './transaction';
export { Store, BoundStore, AutonomousStore } from './store';
export { Index, BoundIndex, AutonomousIndex } from './index';

// Migrations
export { addStore, removeStore, addIndex, removeIndex } from './migration';


// == Storable and Indexable == //

import { Codec } from './util';

import * as storable from './storable';
import * as indexable from './indexable';

export type Storable = storable.Storable;
export type Indexable = indexable.Indexable;

type NativelyStorable = storable.NativelyStorable;
type NativelyIndexable = indexable.NativelyIndexable;

/**
 * Register a custom type with Jine so that it can be stored.
 *
 * In order to store your custom types, Jine asks you to tell it
 * how to encode your type down to a [[NativelyStorable]], and how
 * to decode it back from an encoded value.
 *
 * Additionally, Jine asks you to give your custom types a string
 * id. This id has no semantic value but must be globally unique.
 * When a custom type is stored with Jine, its encoded value is
 * stored with the type id. When retrieving data, this type id is
 * then used to find the decoding function.
 *
 * ```ts
 * class Person {
 *   constructor(public name: string, public age: number) { }
 * }
 *
 * jine.registerStorable<Person>(Person, 'Person:v1', {
 *   encode(person: Person): NativelyStorable {
 *     return [person.name, person.age];
 *   },
 *   decode(encoded: NativelyStorable): Person {
 *     const [name, age] = encoded as [string, number];
 *     return new Person(name, age);
 *   },
 * });
 * ```
 *
 * Changing or removing a type id or codec is dangerous.
 * If a type id is changed, item retrieval may fail since it cannot
 * find the codec. If a codec is changed, item retrieval may fail
 * since it is expecting the encoded data to be in an outdated
 * format.
 *
 * @typeParam T The custom type.
 * @param constructor The constructor for the type being reigstered.
 * @param id An arbitrary globally-unique id.
 * @param codec How to encode and decode this type.
 */
export function registerStorable<T>(
  constructor: Function,
  id: string,
  codec: Codec<T, NativelyStorable>,
): void {
  storable.register(constructor, id, codec);
}

/**
 * Register a custom type with Jine so that it can be used  as trait values.
 *
 * Analogous to [[registerStorable]].
 *
 * @typeParam T The custom type
 * @param constructor The constructor of the custom type.
 * @param id An arbitrary globally-unique id.
 * @param codec How to encode and decode this type.
 */
export function registerIndexable<T>(
  constructor: Function,
  id: string,
  codec: Codec<T, NativelyIndexable>,
): void {
  indexable.register(constructor, id, codec);
}


// == Top-level == //

import { MigrationSpec } from './migration';
import { Database } from './database';

/**
 * Top-level helper type
 */
export type Jine<$$> = $$ & Database<$$>;

/**
 * Create a new database and run migrations on it.
 */
export async function newJine<$$>(name: string, migrations: Array<MigrationSpec>): Promise<Jine<$$>> {
  const db = await Database.new<$$>(name, migrations);
  return db._withShorthand();
}

