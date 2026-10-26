import { expect, test } from '@playwright/test';
import { createRoomViaApi, registerUserViaApi } from './support/api';
import { API_URL, SPANISH_STORAGE_STATE } from './support/env';
import { buildTestUser } from './support/test-data';

const ROOM_URL_PATTERN = /\/room\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

test('crear una reunión requiere cuenta y conserva el rol de administrador', async ({
  page,
  request,
}) => {
  const user = buildTestUser({ name: 'Ana' });
  await registerUserViaApi(request, user);
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByLabel('Tu nombre', { exact: true })).toHaveValue(user.name);
  await page.getByRole('button', { name: 'Crear reunión' }).click();
  await expect(page).toHaveURL(ROOM_URL_PATTERN);
  await page.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();
  await expect(page.locator('.role-tag-administrador')).toBeVisible();
});

test('un invitado puede entrar con un código sin iniciar sesión', async ({ page, request }) => {
  const code = await createRoomViaApi(request, 'Reunión de prueba');
  await page.goto('/');
  await page.getByLabel('Tu nombre', { exact: true }).fill('Bruno');
  await page.getByPlaceholder('abc-defg-hij').fill(code);
  await page.getByRole('button', { name: 'Unirse', exact: true }).click();
  await expect(page).toHaveURL(`/room/${code}`);
  await page.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Llamar', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('date2gether:accessToken'))).toBeNull();
});

test('el enlace directo exige un nombre antes de conectar', async ({ page, request }) => {
  const code = await createRoomViaApi(request, 'Invitación directa');
  await page.goto(`/room/${code}`);
  const enter = page.getByRole('button', { name: 'Entrar a la reunión', exact: true });
  await expect(enter).toBeDisabled();
  await page.getByLabel('Tu nombre en la reunión').fill('   ');
  await expect(enter).toBeDisabled();
  await page.getByLabel('Tu nombre en la reunión').fill('  Invitada  ');
  await enter.click();
  await expect(page.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();
  await expect(page.locator('.users-panel')).toContainText('Invitada');
});

test('dos invitados con el mismo nombre chatean y salir no elimina al otro', async ({
  browser,
  request,
}) => {
  const code = await createRoomViaApi(request, 'Reunión compartida');
  const first = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  const second = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    for (const page of [a, b]) {
      await page.goto(`/room/${code}`);
      await page.getByLabel('Tu nombre en la reunión').fill('Alex');
      await page.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
    }
    for (const page of [a, b])
      await expect(page.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();
    await a.getByPlaceholder('Escribí un mensaje...').fill('Mensaje entre invitados');
    await a.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(b.locator('#messages')).toContainText('Mensaje entre invitados');
    await a.getByRole('link', { name: 'Salir', exact: true }).click();
    await expect(b.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});

test('un enlace inexistente muestra el error sin conectar a una sala', async ({ page }) => {
  await page.goto('/room/zzz-zzzz-zzz');
  await page.getByLabel('Tu nombre en la reunión').fill('Caro');
  await page.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText('No existe una sala');
  await expect(page.getByRole('button', { name: 'Llamar', exact: true })).toHaveCount(0);
});

test('la API valida el nombre y limita el pase a participación en su sala', async ({ request }) => {
  const code = await createRoomViaApi(request, 'Acceso con enlace');
  const route = `${API_URL}/rooms/${code}/access`;
  expect((await request.post(route, { data: { name: '   ' } })).status()).toBe(400);
  expect(
    (await request.post(route, { data: { name: 'Alex', userId: 'suplantado' } })).status(),
  ).toBe(400);
  const response = await request.post(route, { data: { name: ' Alex ' } });
  expect(response.status()).toBe(201);
  const access = await response.json();
  expect(access.participant.name).toBe('Alex');
  expect(access.participant.userId).toBeUndefined();
  const headers = { Authorization: `Bearer ${access.token}` };
  expect(
    (await request.post(`${API_URL}/rooms`, { headers, data: { name: 'No permitido' } })).status(),
  ).toBe(401);
  expect((await request.get(`${API_URL}/rooms/${code}/members`, { headers })).status()).toBe(401);
  // El guard rechaza antes de contactar AWS: esta suite no crea reuniones Chime.
  expect((await request.post(`${API_URL}/calls/xyz-abcd-efg`, { headers })).status()).toBe(403);
  expect((await request.post(`${API_URL}/calls/${code}`)).status()).toBe(401);
});
