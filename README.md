# JINEdb 0.1.0
For when **J**SON **i**s **n**ot **e**nough

***

JINEdb (henceforth 'Jine') is an in-browser database built on top of IndexedDB. Jine's main selling point is that **Jine can store user-defined types**, but Jine also has other features like transactions and indexes.

Jine was built out of a frustration with systems that offer support for a few built-in types, such as JSON, and nothing else. This forces users who want to store other types to either (A) manually re- and de-serialize on every query; or (B) write their own serialization layer on top of the existing technology. And neither of these options are good.

## Sample

```ts

import { newJine, Store, Index, addStore, addIndex } from 'jine';

// Define the type of what we'll be storing with Jine
type User = {
  id: number;
  username: string;
}

// Define our database migrations
const migrations = [
  {
    version: 1,
    alterations: [
      // Add a store in which to keep our users
      addStore<User>({
        name: 'users',
      }),
      // Index users on their id
      addIndex<User, id>({
        name: 'id',
        to: 'users',
        unique: true,
        // 'trait' is what we want to index
        // In this case, it's the path from 'user' to 'user.id' since we want to index the 'id' attribute
        trait: 'id',
      }),
      // Index users on their username length
      addIndex<User, number>({
        name: 'username_length',
        to: 'users',
        // Traits can be functions!
        // This will calculate the username length for all users and index the user on that.
        trait: user => user.username.length,
      }),
    ],
  },
]

// We need to let typescript know what our database will look like
// Create an interface called '$$' which is essentially the shape of the database
interface $$ {
  // Store names are prefixed with '$'
  $users: Store<User> & {
    // As are index names
    $id: Index<User, number>;
    $username_length: Index<User, number>;
  }
}

// Create our database and a connection to it
const jine = newJine<$$>('my jine', migrations);
const jcon = jine.newConnection();

// Add some people!
await jcon.$users.add({ id: 0, username: 'Quelklef' });
await jcon.$users.add({ id: 1, username: 'JonSkeet' });
await jcon.$users.add({ id: 2, username: 'Dyrus' });

// Queries!
await jcon.$users.$id.get(0); // gives the Quelklef object
await jcon.$users.$username_length.find(8);  // gives the Quelklef and JonSkeet objects
await jcon.$users.$id.range({ above: 0 }).array()  // gives the JonSkeet and Dyrus objects

```
