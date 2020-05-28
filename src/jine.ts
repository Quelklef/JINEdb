

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
 * See {@page Serialization and Custom Types}.
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
 * See {@page Serialization and Custom Types}.
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

/**
 * Check if an item is Storable.
 *
 * See {@page Serialization and Custom Types}.
 *
 * @param item The item
 */
export function isStorable(item: any): item is Storable {
  return storable.isStorable(item);
}

/**
 * Check if a trait is Indexable.
 *
 * See {@page Serialization and Custom Types}.
 *
 * @param trait The trait
 */
export function isIndexable(trait: any): trait is Indexable {
  return indexable.isIndexable(trait);
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

