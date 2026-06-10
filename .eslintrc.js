// File: .eslintrc.js
module.exports = {
  env: {
    node: true,
    es2021: true
  },
  extends: [
    'eslint:recommended',
    'plugin:n/recommended',
    'prettier'
  ],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  plugins: [
    'import',
    'n'
  ],
  overrides: [
    {
      files: ['test/**/*.js'],
      env: {
        jest: true
      },
      rules: {
        'n/no-unpublished-require': 'off'
      }
    }
  ],
  rules: {
    'n/no-unsupported-features/node-builtins': ['error', {
      version: '>=20.0.0'  // Added this to match your Node version
    }],
    'n/exports-style': ['error', 'module.exports'],
    'n/file-extension-in-import': ['error', 'always'],
    'n/prefer-global/buffer': ['error', 'always'],
    'n/prefer-global/console': ['error', 'always'],
    'n/prefer-global/process': ['error', 'always'],
    'n/prefer-global/url-search-params': ['error', 'always'],
    'n/prefer-global/url': ['error', 'always'],
    'n/prefer-promises/dns': 'error',
    'n/prefer-promises/fs': 'error',
    'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    'import/no-unresolved': 'error',
    'import/named': 'error',
    'import/default': 'error',
    'import/namespace': 'error'
  }
}
