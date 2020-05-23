module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  reporters: [
    'default',
    ['./node_modules/jest-html-reporter/', {
      'includeConsoleLog': true,
      'includeFailureMsg': true,
      'sort': 'status'
    }],
  ],
};
