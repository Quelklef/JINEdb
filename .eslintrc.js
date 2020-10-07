module.exports = {

  root: true,

  env: {
    browser: true,
    "jest/globals": true,  /* for jest */
  },

  plugins: ["jest"],

  extends: [
    'eslint:recommended',
  ],

  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
    project: './tsconfig.json',
    ecmaFeatures: {
      implicitStrict: true
    }
  },

  rules: {
    "no-unused-vars": ["error", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }],
  },

  overrides: [
    {

      files: ['**/*.ts'],

      parser: '@typescript-eslint/parser',

      plugins: [
        '@typescript-eslint',
      ],

      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/eslint-recommended',
        'plugin:@typescript-eslint/recommended',
      ],

      rules: {
        "no-unexpected-multiline": "off",
        "@typescript-eslint/ban-ts-ignore": "off",
        "@typescript-eslint/camelcase": "off",
        "@typescript-eslint/ban-types": "off",
        "@typescript-eslint/no-use-before-define": "off",
        "@typescript-eslint/no-empty-function": ["error", { allow: [ "arrowFunctions" ] }],
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
        "@typescript-eslint/no-unused-vars": ["error", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }],
        "@typescript-eslint/no-misused-promises": "error",
        "@typescript-eslint/no-floating-promises" :"error",
        "@typescript-eslint/no-this-alias" :"off",
        "@typescript-eslint/consistent-type-assertions" :"off",
      },

    },
  ],

}
