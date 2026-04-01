/**
 * Separate Jest config for end-to-end tests.
 * These hit a live Next.js server and make real Polygon Amoy blockchain transactions.
 *
 * Prerequisites:
 *   1. Start the dev server:  npm run dev
 *   2. Creator wallet funded with POL (gas) + TT tokens
 *
 * Run:
 *   npx jest --config jest.e2e.config.js
 *   npx jest --config jest.e2e.config.js --verbose
 */
const path = require('path');

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/e2e/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // 5 minutes per test — blockchain confirmations can take ~60 s on Amoy
  testTimeout: 300_000,
  // Load .env so contract addresses and private keys are available
  setupFiles: ['<rootDir>/jest.e2e.setup.js'],
  verbose: true,
};
