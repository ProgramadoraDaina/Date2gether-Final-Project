import { expect, test } from '@playwright/test';
import { createRoomViaApi } from './support/api';
import { SPANISH_STORAGE_STATE } from './support/env';

// rooms.spec.ts ya prueba que dos invitados conectados AL MISMO TIEMPO se ven
// los mensajes entre sí (broadcast en vivo). Lo que no tenía ningún test es
// que el historial quede guardado (chat.gateway.ts llama a
// chatService.getHistory() y lo manda por 'roomHistory' a cualquiera que se
// une, no solo a quien ya estaba), ni que los avisos de "se unió"/"salió de
// la sala" muestren el texto correcto en pantalla (rooms.spec.ts solo chequea
// que el conteo de "En la sala (N)" baje, no el aviso en sí).

test('un mensaje queda en el historial para alguien que se une después de que se envió', async ({
  page,
  request,
}) => {
  const code = await createRoomViaApi(request, 'Sala con historial');

  await page.goto(`/room/${code}`);
  await page.getByLabel('Tu nombre en la reunión').fill('Mensajera');
  await page.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();
  await page.getByPlaceholder('Escribí un mensaje...').fill('Mensaje para la posteridad');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.locator('#messages')).toContainText('Mensaje para la posteridad');

  await page.getByRole('link', { name: 'Salir', exact: true }).click();
  await expect(page).toHaveURL('/');

  await page.goto(`/room/${code}`);
  await page.getByLabel('Tu nombre en la reunión').fill('Lectora');
  await page.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();
  await expect(page.locator('#messages')).toContainText('Mensaje para la posteridad');
});

test('quienes ya están en la sala ven el aviso de que alguien se unió, y después de que se fue', async ({
  browser,
  request,
}) => {
  const code = await createRoomViaApi(request, 'Sala con avisos');
  const firstContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  const secondContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  try {
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();

    await first.goto(`/room/${code}`);
    await first.getByLabel('Tu nombre en la reunión').fill('Primero');
    await first.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
    await expect(first.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();

    await second.goto(`/room/${code}`);
    await second.getByLabel('Tu nombre en la reunión').fill('Segundo');
    await second.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();

    await expect(first.locator('.notice')).toContainText('Segundo se unió a la sala');

    await second.getByRole('link', { name: 'Salir', exact: true }).click();

    await expect(first.locator('.notice')).toContainText('Segundo salió de la sala');
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
