
import 'fake-indexeddb/auto';

const FDBFactory = require('fake-indexeddb/lib/FDBFactory');

export function reset() {
  indexedDB = new FDBFactory();
}
