import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
  test: {
    root: './src',
    include: ['**/*.spec.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['**/*.{ts,js}'],
      reportsDirectory: '../coverage',
    },
  },
});
