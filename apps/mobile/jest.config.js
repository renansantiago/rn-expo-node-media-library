const expoPreset = require('jest-expo/jest-preset');

// MSW (and a few of its dependencies) ship ESM-only `.mjs` builds, which must be transpiled for Jest.
const ESM_PACKAGES = [
  'msw',
  '@mswjs',
  'rettime',
  'until-async',
  'outvariant',
  'strict-event-emitter',
  '@open-draft',
  'headers-polyfill',
];

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  transform: {
    '\\.mjs$': expoPreset.transform['\\.[jt]sx?$'],
  },
  transformIgnorePatterns: [
    `/node_modules/(?!(\\.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|${ESM_PACKAGES.join('|')}))`,
    '/node_modules/@react-native/babel-preset/',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/app/**', '!src/test/**', '!**/*.d.ts'],
  coverageThreshold: {
    global: { lines: 80, statements: 80, functions: 80, branches: 70 },
  },
};
