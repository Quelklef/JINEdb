Using a client-side database comes with the unfortunate difficulty that users may not interact with the app for a long period of time, and then come back to it.
This means that their data may be in a format from months or years ago, and this format may be incompatible with the current code base.

Jine offers a versioning and migration system to handle this.

Every Jine database is marked with a version.
This version specifies the database's format, such as what stores and indexes it has.
When changing a database format, one must also give the database a new version.

A migration is a specification of how to go from one database version to the next.
When a database is created, all relevant migrations are run to take the database from its format to the current format.

Let's look at a simple example:

```ts
type User = {
  username: string,
};

type Post = {
  author: string;
  content: string,
};

const migrations = [
  {
    // Initial database setup
    version: 1,
    // We add a store and that's it
    alterations: [
      addStore<User>('$users'),
    ],
  },
  
  {
    // Next version
    version: 2,
    // Add an index to the existing store
    alterations: [
      addIndex<User, string>('$users.$name', '.username', { unique: true }),
    ],
  },
  
  {
    // Next version
    version: 3,
    // Add a post store and index by author
    alterations: [
      addStore<Post>('$posts'),
      addIndex<Post, string>('$posts.$author', '.author'),
    ],
  },
];

const jine = newJine('myjine', migrations);
```

This example is particularly straight-forward.

Let's consider a more difficult scenario.
Say we start with a `Book` type and database version 1 as follows:

```ts
type Book = {
  id: number;
  title: string;
};

const migrations = [
  {
    version: 1,
    alterations: [
      addStore<Book>('$books'),
      addIndex<Book, number>('$books.$id', '.id', { unique: true }),
    ],
  }
];

const jine = newJine('books', migrations);
```

All is fine and dandy.
But now say that we've decided we *dont* want to keep track of book ids.
We may want to update the code to the following...

```ts
type Book = {
  title: string;
};

const migrations = [
  {
    version: 1,
    alterations: [
      addStore<Book>('$books'),
      addIndex<Book, number>('$books.$id', '.id', { unique: true }),
      addIndex<Book, string>('$books.$title', '.title'),
    ],
  },
  {
    version: 2,
    alterations: [
      removeIndex('$books.$id'),
    ],
  }
];

interface $$ { ... }
const jine = newJine('books', migrations);
```

...but this presents two problems:

1. Your types are wrong!
The version 1 `addIndex`es are *not* on `Book` objects.
They're on the old `Book` version.
2. Our stored books have a `.id` attribute that we don't need.
We've removed the index, but that doesn't update the actual stored values.

These problems are not too difficult to overcome.

The first is an easy fix: replace `Book` with `any` for pre-version-2 alterations.
If you want, you can keep a type for each version, but using `any` is probably easier.

The second is fixed with the help of jine.
Migrations may have `.before` and `.after` attributes, which are async functions that run before and after the migrations' database alterations get processed.
This means that we can just include a `.after` hook to remove `.id` values from existing items.

The correct code is as follows:

```ts
type Book = {
  title: string;
};

const migrations = [
  {
    version: 1,
    alterations: [
      addStore<any>('$books'),
      addIndex<any, number>('$books.$id', '.id', { unique: true }),
      addIndex<any, string>('$books.$title', '.title'),
    ],
  },
  {
    version: 2,
    alterations: [
      removeIndex('$books.$id'),
    ],
    // TODO: .before and .after hooks should be supplied transactions
    // I mean, look---this questionable use of closures
    // the migration .after comes before the jcon definition
    after: async () => {
      // Remove .id from existing bookds
      // TODO: make Store#all return a QueryExecutor
      await jcon.$books.range({ everything: true }).replace((book: any) => {
        delete book.id;
        return book;
      });
    },
  }
];

interface $$ { ... }
const jine = newJine<$$>('books', migrations);
const jcon = jine.newConnection();
```

(If you don't want to reprocess the whole database at once, read through {@page Serialization and Custom Types})

// TODO: that update-on-demand idea perhaps deserves its own page? Or maybe to be inlined here?

// TODO: is there a way to streamline and canonicize the update-on-demand?
