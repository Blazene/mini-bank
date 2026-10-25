module.exports = {
  testEnvironment: 'node',
  // The TypeScript browser client has an isolated Vitest/DOM test suite.
  testPathIgnorePatterns: ['/node_modules/', '/frontend/'],
  coverageProvider: 'babel',
  collectCoverageFrom: [
    'src/**/*.js',
    'scripts/**/*.js',
    '!src/**/__tests__/**',
    '!scripts/**/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'html', 'lcov', 'json-summary', 'json'],
  coverageThreshold: {
    global: { statements: 95, branches: 95, functions: 95, lines: 95 },
  },
};
