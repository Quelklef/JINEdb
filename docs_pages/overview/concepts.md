
### Databases

A **database** is a construct which stores a number of objects. Objects in databases are referred to as **items**.

Jine allows you to store any kind of item you'd like in your database: native Javascript types, plain Objects, and even custom class instances.
However, it only natively supports a limited number of types; foreign types must be registered. See {@page Serialization and Custom Types} for detailed information on registering custom types.

Databases are reified by the [[Database]] type.

### Connections

Almost all interactions with a database must be done through a database **connection**.
Multiple connections may be open to any database at the same time.
A database deletion or migration will be blocked by any existing open connections.

Connections are reified by the [[Connection]] type.

### Transactions

Like connections, almost all interactions with a database must also be done through a **transaction**.
A transaction is a series of related database operations.
The key feature of transactions is that they are atomic: if an error occurs during a transaction, *all* changes will be cancelled; a transaction may not partially succeed.

Transactions are reified by the [[Transaction]] type.

### Stores

Items do not exist directly within databases. Instead, they are partitioned into item **stores**. For instance, a database containing information about food recipes may have a store for recipes and a store for ingredients.

Stores are reified by the [[Store]] type.

### Indexes and Traits

Jine lets you store absolutely any type of data into your database that you'd like.
Because of this, Jine knows very little about your data to start, and thus can do very few operations on it.
It can add items to stores and fully empty item stores, but it cannot do any querying.

An **index** is a way of telling Jine to track some particular feature of your data so that you can query it later.
The feature you'd like to track about your data is called a **trait** and comes in two forms. The first kind, called a **path trait**, allows you to track particular attributes of your items. If you're storing users, for instance, you may want to track their `.id` attribute. The second kind, a **derived trait**, allows you to track any *function* of your items. So perhaps your users have a `.friends` attribute which gives an array of ids of other users they're friends with. To track the number of friends each user has, you'd set up an index for the derived trait `user => user.friends.length`.

Indexes are reified by the [[Index]] type.

### Versions and Migrations

(In-depth discussion at {@page Versioning and Migrations})

Over time, the requirement of your databases will change.
You may want to add or remove item stores, or change the indexes on an existing item store.
However, you can't "just" modify the databases, since you don't own them: they're on the client's browser.
In order to handle databases changes in an orderly manner, Jine includes a versioning and migration system.

A **version** is a positive integer tied to a particular database that represents a particular structure of that that database.
For instance, version 1 of a food-related database may have an item store for food recipes.
Version 2 may add an index to the recipe item store, as well as adding an item store for ingredients.

A **migration** specifies how to go from one version to the next version.
If a user logs into your app when the database is at version 1, then next logs in at database version 7, the migrations for version 1 to 2, then 2 to 3, all the way up to 9 to 10, will be run in sequence so that the user's data is up-to-form for the current code.
