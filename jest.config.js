const { resolve } = require('path');
require('dotenv').config();

module.exports = {
  preset: 'ts-jest',
  moduleNameMapper: {
    '^@docroot/(.*)$': '<rootDir>/$1',
  },
  modulePaths: ['<rootDir>/src'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['jest-extended'],
  globalTeardown: resolve(__dirname, './lib/teardown.js'),
};
