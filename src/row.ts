
import { Dict } from './util';

export interface Row {
  id: number;
  payload: unknown;
  traits: Dict<unknown>;
}

