const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  // next/jest solo mapea CSS/imágenes/fonts por defecto; el alias "@/*" de
  // tsconfig.json (usado por las páginas de app/) no se resuelve sin esto.
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};

module.exports = createJestConfig(customJestConfig);
