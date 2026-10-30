import { expect, test } from '@playwright/test';
import { CLIENT_URL, EMPTY_STORAGE_STATE, SPANISH_STORAGE_STATE } from './support/env';

// Tema e idioma son preferencias globales: viven en el layout raíz y se
// guardan en localStorage con zustand/persist + skipHydration (ver
// client/src/features/theme y client/src/features/translation). Esa
// combinación ya causó un bug real de hidratación (fix f4dbcab), así que
// esta suite no solo prueba "se ve el color/idioma correcto", sino también
// que el SSR y el primer render del cliente no entren en conflicto.

type StorageOverrides = { language?: 'es' | 'en'; theme?: 'light' | 'dark' };

// Arma un storageState de Playwright con solo las claves que nos interesan
// controlar en cada test, en el mismo formato que persiste zustand
// (`{ state, version }`). Lo que no se pasa queda "sin preferencia guardada",
// que es justamente el caso que varios tests necesitan simular a propósito.
function buildStorageState({ language, theme }: StorageOverrides) {
  const localStorage: { name: string; value: string }[] = [];
  if (language) {
    localStorage.push({
      name: 'date2gether:language',
      value: JSON.stringify({ state: { language }, version: 1 }),
    });
  }
  if (theme) {
    localStorage.push({
      name: 'date2gether:theme',
      value: JSON.stringify({ state: { theme }, version: 1 }),
    });
  }
  return { cookies: [], origins: [{ origin: CLIENT_URL, localStorage }] };
}

test.describe('Tema (claro/oscuro)', () => {
  // Fijamos el idioma en español para que los selectores por rol/texto del
  // resto de la suite sigan funcionando igual; lo único que varía acá es el
  // tema y el prefers-color-scheme del sistema.

  test('sin preferencia guardada, el tema oscuro del sistema se aplica al cargar', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: buildStorageState({ language: 'es' }),
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.theme-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.theme-toggle')).toHaveText('☀️');
    await context.close();
  });

  test('sin preferencia guardada, el tema claro del sistema se aplica al cargar', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: buildStorageState({ language: 'es' }),
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.theme-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.theme-toggle')).toHaveText('🌙');
    await context.close();
  });

  // Clickear el toggle tiene que cambiar el atributo del documento Y guardar
  // la elección en localStorage, no solo actualizar el estado en memoria
  // (si no, un reload volvería a mostrar el tema del sistema).
  test('clickear el toggle cambia el tema y lo persiste en localStorage', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: buildStorageState({ language: 'es' }),
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.locator('.theme-toggle').click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const stored = await page.evaluate(() => localStorage.getItem('date2gether:theme'));
    expect(JSON.parse(stored ?? '{}').state.theme).toBe('dark');
    await context.close();
  });

  // La regla real de useTheme.ts es "explicitTheme ?? systemTheme": una
  // preferencia guardada manda por encima de lo que diga el sistema. Este
  // test fuerza esa contradicción (guardado = claro, sistema = oscuro) para
  // comprobar que efectivamente gana lo explícito, y que sigue ganando
  // después de un reload (no es solo un efecto de la primera carga).
  test('la preferencia explícita persiste tras recargar, aunque el sistema diga otra cosa', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: buildStorageState({ language: 'es', theme: 'light' }),
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await context.close();
  });

  // El toggle vive en el layout raíz (presente en toda la app), así que la
  // elección tiene que sobrevivir a una navegación dentro de la SPA, no solo
  // a un reload.
  test('la preferencia de tema persiste al navegar a otra página sin recargar', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: buildStorageState({ language: 'es' }),
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('.theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();

    await expect(page).toHaveURL('/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await context.close();
  });
});

test.describe('Idioma (ES/EN)', () => {
  // El default del store (store.ts) es 'en', no 'es', a pesar de que todo el
  // código fuente escribe los textos en español (el español es la "clave"
  // del diccionario, no una traducción). Este test deja eso explícito: una
  // visita sin preferencia guardada arranca en inglés.
  test('sin preferencia guardada, la app arranca en inglés', async ({ browser }) => {
    const context = await browser.newContext({ storageState: EMPTY_STORAGE_STATE });
    const page = await context.newPage();
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.subtitle')).toHaveText('Simple video calls, in the browser.');
    await context.close();
  });

  test('clickear el toggle cambia a español, actualiza <html lang> y persiste', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: EMPTY_STORAGE_STATE });
    const page = await context.newPage();
    await page.goto('/');

    await page.locator('.language-toggle').click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('.subtitle')).toHaveText('Videollamadas simples, en el navegador.');
    const stored = await page.evaluate(() => localStorage.getItem('date2gether:language'));
    expect(JSON.parse(stored ?? '{}').state.language).toBe('es');
    await context.close();
  });

  test('el idioma elegido persiste después de recargar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.subtitle')).toHaveText('Videollamadas simples, en el navegador.');

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('.subtitle')).toHaveText('Videollamadas simples, en el navegador.');
  });

  test('el idioma persiste al navegar a otra página sin recargar', async ({ browser }) => {
    const context = await browser.newContext({ storageState: EMPTY_STORAGE_STATE });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('.language-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();

    await expect(page).toHaveURL('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('.subtitle')).toHaveText('Entrá con tu cuenta de Date2gether.');
  });

  // Regresión directa del bug que arregló f4dbcab: layout.tsx renderiza
  // <html lang="es"> fijo en el server, y el idioma real se aplica recién
  // en un efecto post-mount. Si alguien vuelve a atar ese atributo
  // directamente al estado del store en el JSX, React va a detectar una
  // diferencia entre el HTML del servidor y el del cliente al hidratar.
  // Probamos justamente el caso que lo dispara: un idioma guardado distinto
  // al default ('es' guardado vs. 'en' default).
  test('no hay errores de hidratación al cargar con un idioma guardado distinto al default', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
    const page = await context.newPage();
    const hydrationErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /hydrat/i.test(msg.text())) {
        hydrationErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    expect(hydrationErrors).toEqual([]);
    await context.close();
  });
});
