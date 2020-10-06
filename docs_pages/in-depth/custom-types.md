Out-of-the-box, Jine is only natively able to store a certain set of types (see [[NativelyStorable]]), and can only accept a certain set of types for trait values (see [[NativelyIndexable]]).

You may use custom types with a database if you supply encoding and decoding functions to [[Database.constructor]]. For instance:

```ts
class Prompt {
  constructor(
    public statement: string,
    public agreement: LikertRating,
  ) { }
}

class LikertRating {
  constructor(
    public value: 'strongly disagree' | 'disagree' | 'neutral' | 'agree' | 'strongly agree'
  ) { }
}

// Define our database type
interface $$ {
  prompts: Store<Prompt> & {
    by: {
      rating: Index<Prompt, LikertRating>;
    };
  };
}

// Set up migrations
const migrations = [
  async (genuine: boolean, tx: Transaction) => {
    const prompts = await tx.addStore('prompts');
    await prompts.addIndex('rating');
  },
];

// Now we pass the custom type into the database constructor with an encoding and decoding function
const db = new Database<$$>('db', {
  migrations,
  types: [
    codec(Prompt, 'Prompt', {
      encode(prompt: Prompt): NativelyStorable {
        return {
          statement: prompt.statement,
          agreement: prompt.agreement,
        };
      },
      decode(encoded: any): Prompt {
        const { statement, agreement } = encoded;
        return new Promp(statement, agreement);
      },
    }),
    codec(LikertRating, 'LikertRating', {
      encode(rating: LikertRating): NativelyIndexable {
        const ratings = ['strongly disagree', 'disagree', 'neutral', 'agree', 'strongly agree'];
        return ratings.indexOf(rating.value);
      },
      decode(encoded: any): LikertRating {
        const ratings = ['strongly disagree', 'disagree', 'neutral', 'agree', 'strongly agree'];
        return ratings[encoded];
      },
    }),
  ],
});

// Let typescript know about our custom types
interface Prompt { [encodesTo]: NativelyStorable; }
interface LikertRating { [encodesTo]: NativelyIndexable; }

// Now we can use these types!
db.connect(async conn => {

  const promptTs = new Prompt('I appreciate typescript', new LikertRating('strongly agree'));
  const promptJs = new Prompt('I appreciate javascript', new LikertRating('strongly agree'));
  const promptWeb = new Prompt('I appreciate web APIs', new LikertRating('agree'));
  const promptTypeof = new Prompt('I appreciate that `typeof null === "object"`', new LikertRating('strongly disagree'));

  // add 'em to the db
  await conn.$.prompts.add(promptTs);
  await conn.$.prompts.add(promptJs);
  await conn.$.prompts.add(promptWeb);
  await conn.$.prompts.add(promptTypeof);

  // thing to note #1: we can use LikertRating objects as traits!
  const selection = conn.$.prompts.by.rating.select({
    from: new LikertRating('strongly disagree'(,
    through: new LikertRating('neutral'),
  });

  // thing to note #2: the results are in rich JS datatypes!
  const [got] = selection.array();
  console.log(got)  // same as promptTypeof

});
```

