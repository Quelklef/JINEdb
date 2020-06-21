module.exports = {
  testEnvironment: 'node',
  reporters: [
    'default',
    ['./node_modules/jest-html-reporter/', {
      'includeConsoleLog': true,
      'includeFailureMsg': true,
      'sort': 'status'
    }],
  ],

    
  projects: [
    {
      displayName: 'test',
      preset: 'ts-jest',
      testPathIgnorePatterns: ["dist"],
    },
    {
      displayName: 'lint',
      runner: 'jest-runner-eslint',
      testMatch: ['<rootDir>/tests/**/*.test.ts'],
    },
  ],
};
