import { expect, test } from '@playwright/test';
import { createRoomViaApi, registerUserViaApi } from './support/api';
import { buildTestUser } from './support/test-data';

// Estos son tests "esqueleto": la sala todavía es solo chat de texto por
// websocket (sin video), así que acá solo verificamos el cableado básico
// -crear una sala, unirse con un código, que el error de código inválido
// se vea y redirija- y no el detalle del chat en sí. A medida que la
// feature de video/chat crezca, se agregan tests más específicos en una
// rama nueva.

// Formato real de los códigos: generateRoomCode() arma "abc-defg-hij"
// (3 letras, guión, 4 letras, guión, 3 letras).
const ROOM_URL_PATTERN = /\/room\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

test.describe('Crear y unirse a una sala', () => {
  // Crear sala exige estar logueado (el creador queda como administrador de
  // esa sala), así que primero se registra una cuenta real desde la API y
  // se inicia sesión en la UI antes de crear la reunión.
  // Se espera: 1) la app navega a /room/<código> con el formato correcto,
  // y 2) el websocket se conecta solo y la persona que creó la sala
  // aparece en el panel "En la sala (1)".
  test('crear una reunión navega a la sala y queda conectado', async ({ page, request }) => {
    const user = buildTestUser({ name: 'Ana' });
    await registerUserViaApi(request, user);

    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill(user.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'Crear reunión' }).click();

    await expect(page).toHaveURL(ROOM_URL_PATTERN);
    await expect(page.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();
  });

  // Crea una sala por API (no nos interesa probar la creación acá) y la
  // une desde el home con el código real. Comprueba que el formulario de
  // "unirse" lleva a la sala correcta y que el websocket deja entrar a
  // alguien que llega con un código que sí existe.
  test('unirse con un código existente lleva a esa sala', async ({ page, request }) => {
    const code = await createRoomViaApi(request, 'Reunión de prueba');

    await page.goto('/');
    await page.getByLabel('Tu nombre').fill('Bruno');
    await page.getByPlaceholder('abc-defg-hij').fill(code);
    await page.getByRole('button', { name: 'Unirse', exact: true }).click();

    await expect(page).toHaveURL(`/room/${code}`);
    await expect(page.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();
  });

  // Dos "personas" (dos pestañas/contextos de navegador separados, cada
  // una con su propia sesión) entran a la MISMA sala. Esto prueba que el
  // gateway de sockets realmente comparte el estado entre conexiones
  // distintas: la segunda persona tiene que ver a la primera en la lista,
  // y viceversa (no son dos salas aisladas por accidente).
  test('dos personas en la misma sala se ven entre sí', async ({ browser, request }) => {
    const code = await createRoomViaApi(request, 'Reunión compartida');

    const contextAna = await browser.newContext();
    const pageAna = await contextAna.newPage();
    await pageAna.goto('/');
    await pageAna.getByLabel('Tu nombre').fill('Ana');
    await pageAna.getByPlaceholder('abc-defg-hij').fill(code);
    await pageAna.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(pageAna.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();

    const contextBruno = await browser.newContext();
    const pageBruno = await contextBruno.newPage();
    await pageBruno.goto('/');
    await pageBruno.getByLabel('Tu nombre').fill('Bruno');
    await pageBruno.getByPlaceholder('abc-defg-hij').fill(code);
    await pageBruno.getByRole('button', { name: 'Unirse', exact: true }).click();

    await expect(pageBruno.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();
    await expect(pageAna.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();

    await contextAna.close();
    await contextBruno.close();
  });

  // Intentar unirse con un código que no existe no debería romper la app
  // ni dejar a la persona "colgada" en una sala vacía: el gateway emite un
  // error ("No existe una sala con el código..."), la UI lo muestra como
  // aviso, y después de un momento redirige sola de vuelta al home.
  test('unirse con un código inexistente muestra error y vuelve al inicio', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Tu nombre').fill('Caro');
    await page.getByPlaceholder('abc-defg-hij').fill('zzz-zzzz-zzz');
    await page.getByRole('button', { name: 'Unirse', exact: true }).click();

    await expect(page).toHaveURL('/room/zzz-zzzz-zzz');
    await expect(page.getByText('No existe una sala con el código')).toBeVisible();

    await expect(page).toHaveURL('/', { timeout: 5_000 });
  });
});
