First, check out {@page Installation}.

Now, here's a 5-minute rundown of what Jine has to offer, and how to use it:

```ts
import { newJine, Store, Index, Transaction } from 'jinedb';
const assert = require('assert').strict;


// == // == // INITIALIZATION // == // == //

// What we'll be storing
type Recipe = {
  name: string;
  servings: number;
  url: string;
  ingredients: Array<string>;
};

// Let typescript know what our database will looks like
interface $$ {
  recipes: Store<Recipe> & {
    by: {
      name: Index<Recipe, string>;
      servings: Index<Recipe, number>;
      ingredients: Index<Recipe, string>;
      ingredient_count: Index<Recipe, number>;
    }
  };
}

// If your environment doesn't support top-level await
async function main() {

// Create our database
const jine = await newJine<$$>('recipes');

// Initialize db to version 1
await jine.upgrade(1, async (genuine: boolean, tx: Transaction<$$>) => {

  // Create a item store for recipes
  const recipes = tx.addStore<Recipe>('recipes');
  
  // Track recipes by their name
  // Require names to be unique
  recipes.addIndex<string>('name', '.name', { unique: true });
  
  // Track recipes by their serving count
  recipes.addIndex<number>('servings', '.servings');
  
  // Track recipes by their ingredients
  // The flag 'explode: true' means that a recipe where
  //  recipe.ingredients = ['milk', 'chocolate']
  // will get indexed for 'milk' and 'chocolate' individually
  // rather than indexed for the array as a whole
  recipes.addIndex<string>('ingredients', '.ingredients', { explode: true });
  
  // Track recipes by their ingredient count
  recipes.addIndex<number>(
    'ingredient_count',
    (recipe: Recipe) => recipe.ingredients.length,
  );
  
});


// Open a connection to the database
const jcon = await jine.newConnection();



// == // == // POPULATION // == // == //

// Some recipes
const pancakes = {
  name: "Todd's Famous Blueberry Pancakes",  // (who the hell is Todd??)
  url: 'allrecipes.com/recipe/20177',
  servings: 6,
  ingredients: ['flour', 'eggs', 'salt', 'milk', 'baking powder', 'butter',
                'white sugar', 'blueberries'],
};
const waffles = {
  name: 'Cinnamon Roll Waffles',
  url: 'allrecipes.com/recipe/240386',
  servings: 6,
  ingredients: ['flour', 'brown sugar', 'white sugar', 'butter',
                'baking powder', 'cinnamon', 'salt', 'milk', 'eggs',
                'vanilla extract', 'confectioners sugar', 'cream cheese'],
};
const biscuits = {
  name: 'Basic Biscuits',
  url: 'allrecipes.com/recipe/20075',
  servings: 10,
  ingredients: ['flour', 'baking powder', 'salt', 'shortening', 'milk'],
};
const tacros = {
  name: 'Tacros',  // croissant tacos... apparently
  url: 'allrecipes.com/recipe/262970',
  servings: 10,
  ingredients: ['masa harina', 'bread flour', 'vital wheat gluten',
                'white sugar', 'salt', 'instant yeast', 'milk', 'lard',
                'butter'],
};

// Add the recipes!
await jcon.$.recipes.add(pancakes);
await jcon.$.recipes.add(waffles);
await jcon.$.recipes.add(biscuits);
await jcon.$.recipes.add(tacros);



// == // == // QUERIES // == // == //

// I have a recipe's name
assert.deepEqual(biscuits, await jcon.$.recipes.by.name.get('Basic Biscuits'));
// .get only works on unique indexes and returns one item, or errors if no item is found

// I have some eggs I want to cook
const egg_recipes = await jcon.$.recipes.by.ingredients.find('eggs')
assert.deepEqual([pancakes, waffles], egg_recipes);
// .find returns all items matching a given trait

// I'm gonna have a lot of guests over
const party_recipes = await jcon.$.recipes.by.servings.range({ above: 7 }).array()
assert.deepEqual([biscuits, tacros], party_recipes);
// It's just me for this meal, and I don't want leftovers 
const alone_recipes = await jcon.$.recipes.by.servings.range({ below: 3 }).array()
assert.deepEqual([], alone_recipes);
// I want to try something complicated
const complex_recipes = await jcon.$.recipes.by.ingredient_count.range({ above: 10 }).array();
assert.deepEqual([waffles], complex_recipes);
// .range accepts queries in the form:
//   { above  : val }  for x > val
//   { from   : val }  for x >= val
//   { below  : val }  for x < val
//   { through: val }  for x <= val
//   { above: lo, below  : hi }  for lo < x < hi
//   { from : lo, below  : hi }  for lo <= x < hi
//   { above: lo, through: hi }  for lo < x <= hi
//   { from : lo, through: hi }  for lo <= x <= hi
//   { equals: val }  for x === val
//   { everything: true }  for everything

// Just want to know how many recipes I have
assert.equal(4, await jcon.$.recipes.count());



// == // == // TRANSACTIONS // == // == //

const before_count = await jcon.$.recipes.count();

const banana_bread = {
  name: "Joy's Easy Banana Bread",
  url: 'allrecipes.com/recipe/241707',
  servings: 10,
  ingredients: ['bananas', 'white sugar', 'egg', 'butter', 'flour',
                'baking soda', 'salt'],
};

await jcon.transact([jcon.$.recipes], 'rw', async tx => {
  await tx.$.recipes.add(banana_bread);
  tx.abort();
  // or throw Error();
});

const after_count = await jcon.$.recipes.count();
assert.equal(before_count, after_count);  // transaction atomically aborted

await jcon.transact([jcon.$.recipes], 'rw', async tx => {
  // Transactions are auto-committed when not in use
  await new Promise(resolve => setTimeout(resolve, 0));
  // The following is now an error:
  assert.rejects(async () => await tx.$.recipes.add(banana_bread));
});



// == // == // RESET // == // == //

await jcon.$.recipes.clear();
assert.equal(0, await jcon.$.recipes.count());



// == // == // CLEANUP // == // == //

jcon.close();

}

main();
```
