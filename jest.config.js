module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  clearMocks: true,
  testTimeout: 10000,
  coveragePathIgnorePatterns: ['/node_modules/', '/conf/', '/sqlite/']
};
