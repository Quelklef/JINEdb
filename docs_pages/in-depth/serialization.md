
Out-of-the-box, Jine is only natively able to store a certain set of types (see [[NativelyStorable]]), and can only accept a certain set of types for trait values (see [[NativelyIndexable]]).

If you want to be able to store or index by a non-native type, you will have to register it.
Registering item types (to store) and trait types (to index) are different processes with different requirements.

### Registering a Type as [[Storable]] (for items)

If you want to be able to store a type besides what is [[NativelyStorable]], you may register a type as storable with [[registerStorable]].

This requires supplying Jine with your type constructor, functions for encoding and decoding, as well as an arbitrary globally-unique string id.

The constructor helps with object storage and the string id helps with object retreival.
When storing an object of a custom type, the encoding function is found by inspecting the type's constructor.
The object is then encoded accoring to the respective encoding function and stored in the database along with the given type id.
During retreival, the encoded value and type id are taken back out of the database.
The type id is used to find the decoding function, which is then used on the value.
The result of the decoding is then returned.

An example of registering a type:

```ts
// The type we want to be storable
class BookSeries {
  name: string;
  titles: Array<string>;
  
  get length(): number {
    return this.titles.length;
  }
    
  constructor(name: string, titles: Array<string>) {
    this.name = name;
    this.titles = titles;
  }
}

// Register the type
jine.registerStorable<BookSeries>(
  BookSeries,  // requires the constructor
  'BookSeries',  // and a globally-unique string id
  {  // as well as the encode and decode functions:
    encode(series: BookSeries): NativelyStorable {
      return {
        name: series.name,
        titles: series.titles,
      };
    };
    decode(encoded: NativelyStorable): User {
      const { name, titles } = encoded as any;
      return new BookSeries(name, titles);
    };
  },
);

// Add an object!
const some_series: BookSeries = ...;
await jcon.$series.add(some_series);
// Type error on previous line, oh no!
// Unfortunately, at this point TypeScript has no way of knowing that you've
// registered BookSeries to be Storable.
// There are two solutions:
await jcon.$series.add(some_series as BookSeries & jine.Storable);
// or
if (jine.isStorable(some_series)) await jcon.$series.$add(some_series);
// TODO: there must be a better way, right?
```

The rest of the Jine API is blissfully unaware of this serialization process.
You may, for instance, add a path index (see {@page Concepts}) on the getter `.length`.

The tricky part about registered types comes with version changes.

Imagine we added an `author: string` attribute to `BookSeries` objects.
If we then changed the existing encode and decode functions to match this change, we risk running into some trouble.
A user who loads up our app after not logging on for a while will still have `BookSeries` objects stored *without* the `author` attribute, so decoding will fail.

There are two good solutions to this.

#### Solution 1: Database Versioning

The first solution is to keep everything up-to-date via the versioning system.
When we change our `BookSeries` definition and encodings, we *also* push a database migration.
In this migration, we update all existing `BookSeries` objects to inlcude an `author` attribute, then we re-register the `BookSeries` type.

This would look something like the following:

```ts
// TODO: is there a better way to do this?
// We've updated our BookSeries type
class BookSeries {
  name: string;
  author: string;
  titles: Array<string>;
  
  get length(): number {
    return this.titles.length;
  }
    
  constructor(name: string, author: string; titles: Array<string>) {
    this.name = name;
    this.author = author;
    this.titles = titles;
  }
}

const migrations = [

  {
    // Version where BookSeries has no .author attribute
    version: 1,
    ...
  },
  
  {
    // Migrating to BookSeries having a .author attribute
    verison: 2,
    after: async () => {
    
      // Update existing BookSeries
      // Note that our mapper function cannot accpet a `series: BookSeries`
      // and must instead accept a `series: any`.
      // This is because BookSeries now has a .author attribute, which
      // the decoded values won't have---since they're decoding to an old
      // version of the BookSeries type.
      // TODO: make Store#all return a QueryExecutor
      await jcon.$book_series.range({ everything: true }).replace((series: any) => {
        // Find the author
        const author = findAuthor(series);
        // Return the updated BookSeries
        return { ...series, author };
      });
      
      // Now re-register BookSeries with the new encoding 
      // TODO: this will error since encodings cannot currently be overwritten
      jine.registerStorable<BookSeries>(BookSeries, 'BookSeries', {
        encode(series: BookSeries): NativelyStorable {
          return {
            name: series.name,
            author: series.author,
            titles: series.titles,
          };
        },
        decode(encoded: NativelyStorable): BookSeries {
          const { name, author, titles } = encoded as any;
          return new BookSeries(name, author, titles);
        },
      });
      
    },
  },
];
```

#### Solution 2: Type Versioning

This second solution is a little bit more lightweight as it doesn't require updating all existing objects, which may take a while.
The idea is to update old versions of `BookSeries` objects on-the-fly as we decode them from the database.
This could involve either calculating the new `.author` attribute, or putting in a default value, such as `null`.

When we first register the `BookSeries` type with Jine, instead of

```ts
jine.registerStorable(BookSeries, 'BookSeries', ...);
```

we will write

```ts
jine.registerStorable(BookSeries, 'BookSeries:v1', ...);
```

Now let's skip forward in time to when we want to add our `.author` attribute to `BookSeries` objects.
We would do something like this:

```ts
// We've updated our BookSeries type
class BookSeries {
  name: string;
  author: string;
  titles: Array<string>;
  
  get length(): number {
    return this.titles.length;
  }
    
  constructor(name: string, author: string; titles: Array<string>) {
    this.name = name;
    this.author = author;
    this.titles = titles;
  }
}

// Update the decoding for v1 to find the author on-demand
jine.registerStorable(BookSeries, 'BookSeries:v1', {
  encode: ...,  // same as before
  // Note that the decode function may NOT be async
  decode: (encoded: NativelyStorable): BookSeries {
    const { name, titles } = encoded as any;
    const author = authorLookup(name);
    reutrn new BookSeries(name, author, titles);
  },
});

// Register v2 for BookSeries with .author attributes
jine.registerStorable(BookSeries, 'BookSeries:v2', {
  encode(series: BookSeries): NativelyStorable {
    return {
      name: series.name,
      author: series.author,
      titles: series.titles,
    };
  },
  decode(encoded: NativelyStorable): BookSeries {
    const { name, author, titles } = encoded as any;
    return new BookSeries(name, author, titles);
  },
});
```

Now we will find the author when loading old `BookSeries` objects.
This is more efficient, but comes at the cost of more complex code.

Note that instead of loading the author, you could just substitute a default value for `.author` when loading old objects.

### Registering a Type as [[Indexable]] (for traits)

Registering a type for use in indexes is highly analogous to registering a type for storing.
As such, this description of the former will rely heavily on the description of the latter: if you haven't already read about registering Storable types, do so now.

The important differences between the two processes are as follows:
1. Use [[registerIndexable]] instead of [[registerStorable]]
2. Different types are natively supported: [[NativelyIndexable]] vs [[NativelyStorable]]
3. Cast to `Indexable` or use `isIndexable` instead of `Storable`/`isStorable`
4. One must preserve ordering when registering [[Indexable]] types

This last point is worth talking about.

When doing a query such as `jcon.$my_store.$my_index.range({ from: lo, through: hi })`, Jine will be working with your *serialized* trait values, not your unserialized ones.
This means when writing a trait serializer, it is vital to preserve ordering and equality.
Otherwise, you risk incorrect results when doing queries.

Here is an example of custom trait serialization:

```ts
// The custom trait
type Mood = "exuberant" | "happy" | "neutral" | "sad" | "devastated";

jine.registerIndexable(Mood, 'mood', {
  encode(mood: Mood): NativelyIndexable {
    const mapping = {
      exuberant : 5,
      happy     : 4,
      neutral   : 3,
      sad       : 2,
      devastated: 1,
    };
    return mapping[mood];
  },
  decode(encoded: NativelyStorable): Mood {
    const mapping = {
      5: "exuberant",
      4: "happy",
      3: "neutral",
      2: "sad",
      1: "devastated",
    };
    const num = encoded as number;
    return mapping[num];
  },
});

// Find happy people
await jcon.$people.$mood.range({ above: "neutral" });

// Find unhappy people
await jcon.$people.$mood.range({ below: "neutral" });
```
