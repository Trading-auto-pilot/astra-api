module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Coverage configuration
  collectCoverageFrom: [
    'BaseService.js',
    'serverFactory.js',
    'statusRouterFactory.js',
    '!**/*.test.js',
    '!**/node_modules/**'
  ],

  // Test match patterns
  testMatch: [
    '**/BaseService.test.js',
    '**/serverFactory.test.js',
    '**/statusRouterFactory.test.js'
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    'internalAuth.test.js' // Skip ESM test for now
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Reset mocks between tests
  resetMocks: true,

  // Restore mocks between tests
  restoreMocks: false
};
