# JINEdb

A client-side database for when **J**SON **i**s **n**ot **e**nough!

Almost all information is [in the docs](https://quelklef.github.io/JINEdb/docs).

But while you're here, have some delicious sample code:

```ts
import { Database, Connection, Transaction, Store, Index } from 'jinedb';
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

// Set up database
const jine = new Database<$$>('users');
jine.migration(1, async (genuine: boolean, tx: Transaction<$$>) => {
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

// Open connection
jine.connect(async conn => {

// Add users
await conn.$.users.add({ username: 'billy02'   , friends: ['AverageJoe'] });
await conn.$.users.add({ username: 'AverageJoe', friends: ['billy02']    });
await conn.$.users.add({ username: 'l0neRider' , friends: []             });

// billy02 and l0neRider just become friends!
await conn.transact([jine.$.users], 'rw', async (tx: Transaction<$$>) => {
  await tx.$.users.by.name.selectOne('l0neRider').update({ friends: ['billy02'] });

  await tx.$.users.by.name.selectOne('billy02').replace((old_billy02: User) =>
    ({ ...old_billy02, friends: [...old_billy02.friends, 'l0neRider'] }));
});

// Who's friends with billy02?
const billy02_friends = await conn.$.users.by.friends.find('billy02');
assert.deepEqual(['AverageJoe', 'l0neRider'], billy02_friends.map(user => user.username));

// Anyone without friends?
const lonely = await conn.$.users.by.popularity.find(0);
// nope!
assert.equal(0, lonely.length);

// Anyone super popular?
const popular = await conn.$.users.by.popularity.select({ above: 15 }).array();
// also nope!
assert.equal(0, popular.length);

});
```

