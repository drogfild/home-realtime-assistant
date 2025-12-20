module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  ignorePatterns: ['dist', 'node_modules'],
  plugins: ['import', 'promise', 'n'],
  extends: [
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:n/recommended',
    'plugin:promise/recommended',
    'prettier'
  ],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx']
      }
    }
  },
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: ['./tsconfig.base.json'],
      },
      plugins: ['@typescript-eslint'],
      extends: [
        'plugin:@typescript-eslint/recommended',
      ]
    },
    {
      files: ['apps/web/src/**/*.{ts,tsx}'],
      env: {
        browser: true,
      }
    }
  ]
};
