# JINEdb 0.3.1

A client-side database for when **J**SON **i**s **n**ot **e**nough!

Almost all information is [in the docs](https://quelklef.github.io/JINEdb/docs).

But while you're here, have some delicious sample code:

```ts
import { newJine, Store, Index, addStore, addIndex } from 'jine';

// Type to store in DB
type User = {
  username: string;
  friends: Array<number>;
};

// Let typescript know what our database looks like
interface $$ {
  users: Store<User> & {
    name: Index<User, string>;
    friends: Index<User, string>;
    popularity: Index<user, number>;
  };
};

// Initialize database
const jine = await newJine<$$>('users');

await jine.upgrade(1, (genuine: boolean, tx: Transaction<$$>) => {
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
const jcon = jine.newConnection();

// Add users
await jcon.$.users.add({ username: 'billy02'   , friends: ['AverageJoe'] });
await jcon.$.users.add({ username: 'AverageJoe', friends: ['billy02']    });
await jcon.$.users.add({ username: 'l0neRider' , friends: []             });

// billy02 and l0neRider just become friends!
await jcon.transact(tx => {
  await tx.$.users.by.name.one('l0neRider').update({ friends: ['billy02'] });
  // TODO: implement UniqueQueryExecutor#map
  //       probably the whole family of updaters need a small redesign
  await tx.$users.by.name.one('billy02').map(old_billy =>
    { ...old_billy, friends: [...old_billy.friends, 'l0neRider'] });
});

// Who's friends with billy02?
const billy02_friends = await jcon.$.users.by.friends.find('billy02');
billy02_friends.map(user => user.name) === ['AverageJoe', 'l0neRider'];

// Anyone without friends?
const lonely = await jcon.$.users.by.popularity.find(0);
lonely.length === 0;  // nope!

// Anyone super popular?
const popular = await jcon.$.users.by.popularity.range({ above: 15 });
poopular.length === 0;  // also nope!

// Close database connection
jcon.close();
```

