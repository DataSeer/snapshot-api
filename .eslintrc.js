// File: .eslintrc.js
module.exports = {
  env: {
    node: true,
    es2021: true
  },
  extends: [
    'eslint:recommended',
    'plugin:node/recommended',
    'prettier'
  ],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  plugins: [
    'import',
    'node'
  ],
  overrides: [
    {
      files: ['test/**/*.js'],
      env: {
        jest: true
      },
      rules: {
        'node/no-unpublished-require': 'off'
      }
    }
  ],
  rules: {
    // eslint-plugin-node@11's resolver predates the package "exports" field, so
    // it fails to resolve modules that only expose entries via exports maps
    // (e.g. uuid >=9). The module is a real, declared dependency — allow it
    // explicitly so node/no-missing-require doesn't false-positive.
    'node/no-missing-require': ['error', { allowModules: ['uuid'] }],
    'node/no-unsupported-features/node-builtins': ['error', {
      version: '>=20.0.0'  // Added this to match your Node version
    }],
    'node/exports-style': ['error', 'module.exports'],
    'node/file-extension-in-import': ['error', 'always'],
    'node/prefer-global/buffer': ['error', 'always'],
    'node/prefer-global/console': ['error', 'always'],
    'node/prefer-global/process': ['error', 'always'],
    'node/prefer-global/url-search-params': ['error', 'always'],
    'node/prefer-global/url': ['error', 'always'],
    'node/prefer-promises/dns': 'error',
    'node/prefer-promises/fs': 'error',
    'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    'import/no-unresolved': 'error',
    'import/named': 'error',
    'import/default': 'error',
    'import/namespace': 'error'
  }
}
