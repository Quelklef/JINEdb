Jine is on npm. Install it with:

```
npm i jinedb
```

then import it in your projects with with

```ts
import * as jine from 'jinedb';
```

If you're using Typescript, you'll also have to make sure that you're including the correct libraries, namely `dom` and `es2020` (or higher). That means your `tsconfig.json` should include the following:

```json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "lib": ["dom", "es2020" /* or higher */]
  }
}
```


