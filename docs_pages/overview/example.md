First, check out {@page Installation}.

Now, here's a 5-minute rundown of what Jine has to offer, and how to use it:

```ts
import { codec, encodesTo, NativelyStorable, NativelyIndexable, MigrationTx, Database, Connection, Store, Index, Transaction } from 'jinedb';
const assert = require('assert').strict;


// == // == // INITIALIZATION // == // == //

// What we'll be storing
class Recipe {
  constructor(
    public name: string,
    public url: string,
    public servings: number,
    public ingredients: Array<string>,
  ) { }
}

// Let typescript know what our database will looks like
interface $$ {
  recipes: Store<Recipe> & {
    by: {
      name: Index<Recipe, string>;
      servings: Index<Recipe, number>;
      ingredients: Index<Recipe, string>;
      ingredientCount: Index<Recipe, number>;
    }
  };
}

// Define the database migrations
const migrations = [
  async (genuine: boolean, tx: MigrationTx) => {
    // Create a item store for recipes
    const recipes = tx.addStore<Recipe>('recipes');

    // Track recipes by their name
    // Require names to be unique
    await recipes.addIndex<string>('name', '.name', { unique: true });

    // Track recipes by their serving count
    await recipes.addIndex<number>('servings', '.servings');

    // Track recipes by their ingredients
    await recipes.addIndex<string>('ingredients', '.ingredients', { explode: true });
    // ^^ The flag 'explode: true' means that a recipe where
    //  recipe.ingredients = ['milk', 'chocolate']
    // will get indexed for 'milk' and 'chocolate' individually
    // rather than indexed for the array as a whole

    // Track recipes by their ingredient count
    await recipes.addIndex<number>(
      'ingredientCount',
      (recipe: Recipe) => recipe.ingredients.length,
    );
  }
];

// Define the custom type
const types = [
  codec(Recipe, 'Recipe', {
    encode(recipe: Recipe): NativelyStorable {
      return {
        name: recipe.name,
        servings: recipe.servings,
        url: recipe.url,
        ingredients: recipe.ingredients,
      };
    },
    decode(encoded: any): Recipe {
      const { name, url, servings, ingredients } = encoded;
      return new Recipe(name, url, servings, ingredients);
    },
  }),
];

// Let typescript know about the custom type
interface Recipe {
  [encodesTo]: NativelyStorable;
}

// Create the database!
const jine = new Database<$$>('recipes', { migrations, types });


// Open a connection to the database (if top-level await isn't available)
jine.connect(async conn => {



// == // == // POPULATION // == // == //

// Some recipes
const pancakes = new Recipe(
  "Todd's Famous Blueberry Pancakes",  // (who the hell is Todd??)
  'allrecipes.com/recipe/20177',
  6,
  ['flour', 'eggs', 'salt', 'milk', 'baking powder', 'butter',
   'white sugar', 'blueberries'],
);
const waffles = new Recipe(
  'Cinnamon Roll Waffles',
  'allrecipes.com/recipe/240386',
  6,
  ['flour', 'brown sugar', 'white sugar', 'butter',
   'baking powder', 'cinnamon', 'salt', 'milk', 'eggs',
   'vanilla extract', 'confectioners sugar', 'cream cheese'],
);
const biscuits = new Recipe(
  'Basic Biscuits',
  'allrecipes.com/recipe/20075',
  10,
  ['flour', 'baking powder', 'salt', 'shortening', 'milk'],
);
const tacros = new Recipe(
  'Tacros',  // croissant tacos... apparently
  'allrecipes.com/recipe/262970',
  10,
  ['masa harina', 'bread flour', 'vital wheat gluten',
   'white sugar', 'salt', 'instant yeast', 'milk', 'lard',
   'butter'],
);

// Add the recipes!
await conn.$.recipes.add(pancakes);
await conn.$.recipes.add(waffles);
await conn.$.recipes.add(biscuits);
await conn.$.recipes.add(tacros);



// == // == // QUERIES // == // == //

// I have a recipe's name
assert.deepEqual(biscuits, await conn.$.recipes.by.name.getOne('Basic Biscuits'));
// Note that the returned item is correctly of rich type `Recipe`!
// .selectOne only works on unique indexes and returns one item, or errors if no item is found

// I have some eggs I want to cook
const eggRecipes = await conn.$.recipes.by.ingredients.get('eggs')
assert.deepEqual([pancakes, waffles], eggRecipes);
// .find returns all items matching a given trait

// I'm gonna have a lot of guests over
const partyRecipes = await conn.$.recipes.by.servings.select({ above: 7 }).array()
assert.deepEqual([biscuits, tacros], partyRecipes);
// It's just me for this meal, and I don't want leftovers
const aloneRecipes = await conn.$.recipes.by.servings.select({ below: 3 }).array()
assert.deepEqual([], aloneRecipes);
// I want to try something complicated
const complexRecipes = await conn.$.recipes.by.ingredientCount.select({ above: 10 }).array();
assert.deepEqual([waffles], complexRecipes);
// .select accepts queries in the form:
//   { above  : val }  for x > val
//   { from   : val }  for x >= val
//   { below  : val }  for x < val
//   { through: val }  for x <= val
//   { above: lo, below  : hi }  for lo < x < hi
//   { from : lo, below  : hi }  for lo <= x < hi
//   { above: lo, through: hi }  for lo < x <= hi
//   { from : lo, through: hi }  for lo <= x <= hi
//   { equals: val }  for x === val
//   'everything'  for everything

// Just want to know how many recipes I have
assert.equal(4, await conn.$.recipes.count());



// == // == // TRANSACTIONS // == // == //

const beforeCount = await conn.$.recipes.count();

const bananaBread = new Recipe(
  "Joy's Easy Banana Bread",
  'allrecipes.com/recipe/241707',
  10,
  ['bananas', 'white sugar', 'egg', 'butter', 'flour',
   'baking soda', 'salt'],
);

await conn.transact([conn.$.recipes], 'rw', async tx => {
  await tx.$.recipes.add(bananaBread);
  tx.abort();
  // or throw Error();
});

const afterCount = await conn.$.recipes.count();
assert.equal(beforeCount, afterCount);  // transaction atomically aborted

await conn.transact([conn.$.recipes], 'rw', async tx => {
  // Transactions are auto-committed when not in use
  await new Promise(resolve => setTimeout(resolve, 0));
  // The following is now an error:
  assert.rejects(tx.$.recipes.add(bananaBread));
});



// == // == // RESET // == // == //

await conn.$.recipes.clear();
assert.equal(0, await conn.$.recipes.count());




});
```
