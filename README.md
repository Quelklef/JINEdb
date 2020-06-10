# JINEdb 0.3.2

A client-side database for when **J**SON **i**s **n**ot **e**nough!

Almost all information is [in the docs](https://quelklef.github.io/JINEdb/docs).

But while you're here, have some delicious sample code:

```ts
import { newJine, Store, Index, Transaction } from 'jinedb';
const assert = require('assert').strict;

// Type to store in DB
type User = {
  username: string;
  friends: Array<string>;
};

// Let typescript know what our database looks like
interface $$ {
  users: Store<User> & {
    by: {
      name: Index<User, string>;
      friends: Index<User, string>;
      popularity: Index<User, number>;
    };
  };
};

// if your system doesn't support top-level awaits
async function main() {

// Initialize database
const jine = await newJine<$$>('users');

await jine.upgrade(1, async (genuine: boolean, tx: Transaction<$$>) => {
  // Add user storage
  const users = tx.addStore<User>('users');
  // Index by unique username
  users.addIndex<string>('name', '.username', { unique: true });
  // Index by friend names
  users.addIndex<string>('friends', '.friends', { explode: true });
  // Index by friend count
  users.addIndex<number>(
    'popularity',
    (user: User) => user.friends.length,
  );
});

// Initialize database and open connection
const jcon = await jine.newConnection();

// Add users
await jcon.$.users.add({ username: 'billy02'   , friends: ['AverageJoe'] });
await jcon.$.users.add({ username: 'AverageJoe', friends: ['billy02']    });
await jcon.$.users.add({ username: 'l0neRider' , friends: []             });

// billy02 and l0neRider just become friends!
await jcon.transact([jine.$.users], 'rw', async (tx: Transaction<$$>) => {
  await tx.$.users.by.name.one('l0neRider').update({ friends: ['billy02'] });

  const old_billy02 = await tx.$.users.by.name.get('billy02');
  await tx.$.users.by.name.one('billy02').update(
    { friends: [...old_billy02.friends, 'l0neRider'] });
});

// Who's friends with billy02?
const billy02_friends = await jcon.$.users.by.friends.find('billy02');
assert.deepEqual(['AverageJoe', 'l0neRider'], billy02_friends.map(user => user.username));

// Anyone without friends?
const lonely = await jcon.$.users.by.popularity.find(0);
// nope!
assert.equal(0, lonely.length);

// Anyone super popular?
const popular = await jcon.$.users.by.popularity.range({ above: 15 }).array();
// also nope!
assert.equal(0, popular.length);

// Close database connection
jcon.close();

}

main();
```

