
import { Dict } from './util';

/*- A row is what's actually stored in IndexedDB */
export interface Row {
  id: number;
  payload: unknown;
  traits: Dict<unknown>;
}

