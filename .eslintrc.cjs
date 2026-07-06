/**
 * Minimal ESLint config for the M0 foundation. The full CI lint job lands in
 * G8; this exists so the advertised `npm run lint` script runs against the
 * strict TypeScript sources without a parser error.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    es2022: true,
    browser: true,
    node: true,
  },
  ignorePatterns: ['dist/', 'coverage/', 'node_modules/', '*.cjs'],
  rules: {
    // Tuple-backed math primitives use non-null assertions and casts by design.
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
