# JINEdb 0.2.0
For when **J**SON **i**s **n**ot **e**nough

JINEdb (henceforth 'Jine') is an in-browser database built on top of IndexedDB. Jine's main selling point is that **Jine can store user-defined types**, but Jine also has other features like transactions and indexes.

Jine was built out of a frustration with systems that offer support for a few built-in types, such as JSON, and nothing else. This forces users who want to store other types to either (A) manually re- and de-serialize on every query; or (B) write their own serialization layer on top of the existing technology. And neither of these options are good.

## Installation

`npm i jinedb`

then

```ts
import * as jine from 'jinedb'
```

As of right now, Jine requires Typescript to have DOM and es2020+ types. That means your `tsconfig.json` should include the following:

```json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "lib": ["dom", "es2020" /* or higher */]
  }
}
```

## API Docs

API docs are [here](https://quelklef.github.io/JINEdb/docs).

## Sample

```ts	
import { newJine, Store, Index, addStore, addIndex } from 'jine';	

// What are we going to be storing?
type User = {	
  id: number;	
  username: string;	
}	

// Set up our stores and indexes
const migrations = [	
  {	
    version: 1,	
    alterations: [	
      // Add a store in which to keep our users	
      addStore<User>('$users'),
      // Create index '$users.$id' tracking attriute '.id'; ensure entries are unique
      addIndex<User, number>('$users.$id', '.id', { unique: true }),
      // Create index '$users.$username_length' tracking username length
      addIndex<User, number>('$users.$username_length', (user: User) => user.username.length),
    ],	
  },	
]	

// We need to let typescript know what our database will look like	
interface $$ {	
  $users: Store<User> & {	
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
