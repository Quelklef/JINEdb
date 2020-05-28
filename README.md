# JINEdb 0.2.0

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

// Set up migrations
const migrations = [
  {
    version: 1,
    alterations: [
      // Add user storage
      addStore<User>('$users'),
      // Index by unique username
      addIndex<User, string>('$users.$name', '.username', { unique: true }),
      // Index by friend names
      addIndex<User, string>('$users.$friends', '.friends', { explode: true }),
      // Index by friend count
      addIndex<User, number>(
        '$users.$popularity',
        (user: User) => user.friends.length,
      ),
    ],
  },
];

// Let typescript know what our database looks like
interface $$ {
  $users: Store<User> & {
    $name: Index<User, string>;
    $friends: Index<User, string>;
    $popularity: Index<user, number>;
  };
};

// Initialize database and open connection
const jine = newJine<$$>('users', migrations);
const jcon = jine.newConnection();

// Add users
await jcon.$users.add({ username: 'billy02'   , friends: ['AverageJoe'] });
await jcon.$users.add({ username: 'AverageJoe', friends: ['billy02']    });
await jcon.$users.add({ username: 'l0neRider' , friends: []             });

// billy02 and l0neRider just become friends!
await jcon.transact(tx => {
  await tx.$users.$name.one('l0neRider').update({ friends: ['billy02'] });
  const billy02 = await tx.$users.$name.get('billy02');
  await tx.$users.$name.one('billy02').update({
    friends: [...billy02.friends, 'l0neRider']
  });
});

// Who's friends with billy02?
const billy02_friends = await jcon.$users.$friends.find('billy02');
billy02_friends.map(user => user.name) === ['AverageJoe', 'l0neRider'];

// Anyone without friends?
const lonely = await jcon.$users.$popularity.find(0);
lonely.length === 0;  // nope!

// Anyone super popular?
const popular = await jcon.$users.$popularity.range({ above: 15 });
poopular.length === 0;  // also nope!

// Close database connection
jcon.close();
```

