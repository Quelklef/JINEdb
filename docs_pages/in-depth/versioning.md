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

const jine = awit newJine('myjine');

await jine.upgrade(1, (genuine: boolean, tx: Transaction<$$>) => {
  // We add a store and that's it
  tx.addStore<User>('users');
});

await jine.upgrade(2, (genuine: boolean, tx: Transaction<$$>) => {
  // Add an index to the existing store
  tx.$.users.addIndex<string>('name', '.username', { unique: true });
});

await jine.upgrade(3, (genuine: boolean, tx: Transaction<$$>) => {
  // Add a post store and index by author
  const posts = tx.addStore<Post>('posts')
  posts.addIndex<string>('author', '.author');
});
```

This example is particularly straight-forward.

Let's consider a more difficult scenario.
Say we start with a `Book` type and database version 1 as follows:

```ts
type Book = {
  id: number;
  title: string;
};

const jine = await newJine('books');

await jine.upgrade(1, (genuine: boolean, tx: Transaction<$$>) => {
  const books = tx.addStore<Book>('books');
  books.addIndex<number>('id', '.id', { unique: true });
  books.addIndex<string>('title', '.title', { unique: true });
});
```

All is fine and dandy.
But now say that we've decided we *dont* want to keep track of book ids.
We may want to update the code to the following...

```ts
type Book = {
  title: string;
};

const jine = await newJine('books');

await jine.upgrade(1, (genuine: boolean, tx: Transaction<$$>) => {
  const books = tx.addStore<Book>('books');
  books.addIndex<number>('id', '.id', { unique: true });
  books.addIndex<string>('title', '.title', { unique: true });
});

await jine.upgrade(1, (genuine: boolean, tx: Transaction<$$>) => {
  tx.$.books.removeIndex('id');
});
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

For the second, just update the books in the migraiton.
This means that we can just include a `.after` hook to remove `.id` values from existing items.

```ts
type Book = {
  title: string;
};

const jine = await newJine('books');

await jine.upgrade(1, (genuine: boolean, tx: Transaction<$$>) => {
  const books = tx.addStore<any>('books');
  books.addIndex<number>('id', '.id', { unique: true });
  books.addIndex<string>('title', '.title', { unique: true });
});

await jine.upgrade(1, (genuine: boolean, tx: Transaction<$$>) => {
  tx.$.books.removeIndex('id');
  await tx.$.books.all().replace((book: any) => {
    delete book.id;
    return book;
  });
});
```

(If you don't want to reprocess the whole database at once, read through {@page Serialization and Custom Types})

// TODO: that update-on-demand idea perhaps deserves its own page? Or maybe to be inlined here?
// TODO: is there a way to streamline and canonicize the update-on-demand?
