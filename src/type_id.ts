
import { Constructor } from './util';


export type TypeId = string;

const ids = new Map<Constructor, TypeId>();

export function register(constructor: Constructor, id: string): void {
  if (ids.has(constructor)) {
    throw Error(`Type '${constructor.name}' already has a registered ID.`);
  }
  ids.set(constructor, id);
}

export function tryGetTypeId(constructor: Constructor): TypeId | undefined {
  return ids.get(constructor);
}

export function hasTypeId(constructor: Constructor): boolean {
  return tryGetTypeId(constructor) !== undefined;
}

export function getTypeId(constructor: Constructor): TypeId {
  const got = tryGetTypeId(constructor);
  if (got === undefined) {
    throw Error(`Type '${constructor.name}' does not have a registered ID.`);
  }
  return got;
}

