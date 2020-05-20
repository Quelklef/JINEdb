module.exports = {

  root: true,

  env: {
    browser: true,
  },

  extends: [
    'eslint:recommended',
  ],

  parserOptions: {
    ecmaVersion: 2019,
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
        "@typescript-eslint/camelcase": "off",
        "@typescript-eslint/ban-types": "off",
        "@typescript-eslint/no-use-before-define": "off",
        "@typescript-eslint/no-empty-function": ["off", { allow: [ "arrowFunctions" ] }],
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
        "@typescript-eslint/no-unused-vars": ["error", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }],
        "@typescript-eslint/no-misused-promises": "error",
        "@typescript-eslint/no-floating-promises" :"error",
      },

    },
  ],

}
