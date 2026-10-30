// Puertos y URLs compartidos entre playwright.config.ts y los specs, para que
// no queden "mágicamente" repetidos en varios archivos.
export const API_PORT = 3001;
export const CLIENT_PORT = 3002;

export const API_URL = `http://localhost:${API_PORT}`;
export const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;

// Conexión a la base de Postgres descartable (ver docker-compose.test.yml).
// No es un secreto real: solo vive en la máquina de quien corre los tests.
export const TEST_DATABASE_URL = 'postgresql://test:test@localhost:5433/date2gether_test';

// Secrets de JWT solo para firmar tokens de prueba. No protegen nada real,
// por eso está bien que vivan en el código (lo mismo que enseña la clase
// sobre "valores para los tests").
export const TEST_JWT_ACCESS_SECRET = 'e2e-test-access-secret-no-es-real';
export const TEST_JWT_REFRESH_SECRET = 'e2e-test-refresh-secret-no-es-real';

// Los selectores de esta suite están en español, independientemente del idioma inicial de la app.
export const SPANISH_STORAGE_STATE = {
  cookies: [],
  origins: [
    {
      origin: CLIENT_URL,
      localStorage: [
        {
          name: 'date2gether:language',
          value: JSON.stringify({ state: { language: 'es' }, version: 1 }),
        },
      ],
    },
  ],
};

// Sin ningún storage previo: simula a alguien que entra por primera vez,
// sin preferencia de tema ni idioma guardada. Se usa para pisar el
// SPANISH_STORAGE_STATE global en los tests que necesitan probar los
// defaults reales de la app (ver preferences.spec.ts).
export const EMPTY_STORAGE_STATE = {
  cookies: [],
  origins: [],
};
