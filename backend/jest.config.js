module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js'
  ],
  setupFiles: ['<rootDir>/tests/setup.js'],
  verbose: true,
  clearMocks: true
};
