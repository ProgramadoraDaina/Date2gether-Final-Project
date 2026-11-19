import { defineConfig, devices } from '@playwright/test';
import {
  API_URL,
  SPANISH_STORAGE_STATE,
  CLIENT_URL,
  TEST_DATABASE_URL,
  TEST_JWT_ACCESS_SECRET,
  TEST_JWT_REFRESH_SECRET,
} from './e2e/support/env';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  // En CI no se puede dejar un test.only olvidado pasar silenciosamente.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // En CI, un solo worker: los tests comparten la misma base de datos de
  // prueba, y correr en paralelo podría hacer que un test pise los datos de otro.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',

  use: {
    baseURL: CLIENT_URL,
    storageState: SPANISH_STORAGE_STATE,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Playwright levanta estos dos procesos antes de correr los tests, y los
  // apaga al terminar. Es el mismo rol que cumple un service container en
  // GitHub Actions, pero para los dos servidores de la app (no la base).
  webServer: [
    {
      command: 'pnpm start:dev',
      // No se puede chequear API_URL "/" a secas: no hay ninguna ruta ahí
      // y Playwright solo da por "lista" una respuesta 2xx/3xx (un 404 lo
      // sigue considerando "todavía no", y queda reintentando hasta el timeout).
      url: `${API_URL}/health`,
      timeout: 120_000,
      // Siempre false: si se reutilizara un backend ya corriendo (ej. el de
      // desarrollo), los tests escribirían en esa base en vez de en la de test.
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL: TEST_DATABASE_URL,
        PORT: String(new URL(API_URL).port),
        CORS_ORIGIN: CLIENT_URL,
        JWT_ACCESS_SECRET: TEST_JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: TEST_JWT_REFRESH_SECRET,
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      },
    },
    {
      command: 'pnpm --filter client dev',
      url: CLIENT_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NEXT_PUBLIC_API_URL: API_URL,
      },
    },
  ],
});
