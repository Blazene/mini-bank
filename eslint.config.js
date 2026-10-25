module.exports = [
  // Coverage reports contain generated third-party JavaScript, not application source.
  { ignores: ['coverage/**', 'frontend/dist/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], 'no-undef': 'off' },
  },
];
