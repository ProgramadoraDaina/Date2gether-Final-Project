import postgres from 'postgres';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRoomWithAdminViaApi } from './support/api';
import { API_URL, SPANISH_STORAGE_STATE, TEST_DATABASE_URL } from './support/env';
import { buildTestUser } from './support/test-data';

const headers = (token: string) => ({ Authorization: 'Bearer ' + token });
const path = (code: string) => API_URL + '/rooms/' + code;
async function setup(request: APIRequestContext) {
  const room = await createRoomWithAdminViaApi(request, 'Sala de admisión');
  const changed = await request.patch(path(room.code) + '/admission', {
    headers: headers(room.adminToken),
    data: { waitingRoomEnabled: true },
  });
  expect(changed.ok()).toBe(true);
  return room;
}
async function wait(request: APIRequestContext, code: string, name = 'Invitada') {
  const res = await request.post(path(code) + '/access', { data: { name } });
  expect(res.ok()).toBe(true);
  const receipt = await res.json();
  expect(receipt).toMatchObject({
    status: 'pending',
    requestId: expect.any(String),
    ticket: expect.any(String),
  });
  expect(receipt.token).toBeUndefined();
  return receipt as { requestId: string; ticket: string };
}
const status = (
  request: APIRequestContext,
  code: string,
  receipt: { requestId: string; ticket: string },
) =>
  request.get(path(code) + '/admission/' + receipt.requestId + '/status', {
    headers: headers(receipt.ticket),
  });
const decide = (
  request: APIRequestContext,
  code: string,
  token: string,
  id: string,
  decision: string,
) =>
  request.patch(path(code) + '/admission/' + id, { headers: headers(token), data: { decision } });

test('el ingreso sigue directo por defecto; la espera no se elude con el nombre del administrador ni con su ticket', async ({
  request,
}) => {
  const { code, adminToken } = await createRoomWithAdminViaApi(request, 'Ingreso directo');
  const direct = await request.post(path(code) + '/access', { data: { name: 'Primera' } });
  expect(await direct.json()).toMatchObject({ token: expect.any(String) });
  await request.patch(path(code) + '/admission', {
    headers: headers(adminToken),
    data: { waitingRoomEnabled: true },
  });
  const pending = await wait(request, code, 'Administrador');
  const host = await request.post(path(code) + '/access', {
    headers: headers(adminToken),
    data: { name: 'Otro nombre' },
  });
  expect(await host.json()).toMatchObject({
    participant: { userId: expect.any(String) },
    token: expect.any(String),
  });
  expect(
    (await request.post(API_URL + '/calls/' + code, { headers: headers(pending.ticket) })).status(),
  ).toBe(401);
  expect(
    (
      await request.post(API_URL + '/rooms', {
        headers: headers(pending.ticket),
        data: { name: 'Intento' },
      })
    ).status(),
  ).toBe(401);
});

test('solo el administrador de esa sala puede moderar y cada ticket consulta solo su solicitud', async ({
  request,
}) => {
  const room = await setup(request);
  const other = await createRoomWithAdminViaApi(request, 'Otra sala');
  const pending = await wait(request, room.code);
  const second = await wait(request, room.code);
  expect((await request.get(path(room.code) + '/admission')).status()).toBe(401);
  expect(
    (
      await request.get(path(room.code) + '/admission', { headers: headers(pending.ticket) })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.get(path(room.code) + '/admission', { headers: headers(other.adminToken) })
    ).status(),
  ).toBe(403);
  expect(
    (await decide(request, room.code, other.adminToken, pending.requestId, 'admitted')).status(),
  ).toBe(403);
  expect((await status(request, other.code, pending)).status()).toBe(401);
  expect((await status(request, room.code, { ...pending, ticket: second.ticket })).status()).toBe(
    401,
  );
  expect(
    (await decide(request, other.code, other.adminToken, pending.requestId, 'admitted')).status(),
  ).toBe(404);
  expect(
    (await decide(request, room.code, room.adminToken, pending.requestId, 'invalid')).status(),
  ).toBe(400);
  expect(
    (await decide(request, room.code, room.adminToken, pending.requestId, 'rejected')).ok(),
  ).toBe(true);
  expect(await (await status(request, room.code, pending)).json()).toMatchObject({
    status: 'rejected',
  });
  expect(
    (await decide(request, room.code, room.adminToken, pending.requestId, 'admitted')).status(),
  ).toBe(409);
});

test('desactivar la espera admite pendientes sin revivir solicitudes rechazadas o canceladas', async ({
  request,
}) => {
  const { code, adminToken } = await setup(request);
  const pending = await wait(request, code);
  const rejected = await wait(request, code);
  const cancelled = await wait(request, code);
  await decide(request, code, adminToken, rejected.requestId, 'rejected');
  await request.post(path(code) + '/admission/' + cancelled.requestId + '/cancel', {
    headers: headers(cancelled.ticket),
  });
  await request.patch(path(code) + '/admission', {
    headers: headers(adminToken),
    data: { waitingRoomEnabled: false },
  });
  const first = await (await status(request, code, pending)).json();
  const again = await (await status(request, code, pending)).json();
  expect(first.status).toBe('admitted');
  expect(first.access.participant.sub).toBe(pending.requestId);
  expect(again.access.participant.sub).toBe(first.access.participant.sub);
  expect(await (await status(request, code, rejected)).json()).toMatchObject({
    status: 'rejected',
  });
  expect(await (await status(request, code, cancelled)).json()).toMatchObject({
    status: 'cancelled',
  });
});

test('bloquear ingresos impide nuevas solicitudes y admisiones; desbloquear conserva la configuración de espera', async ({
  request,
}) => {
  const { code, adminToken } = await setup(request);
  const pending = await wait(request, code);
  await request.patch(path(code) + '/admission', {
    headers: headers(adminToken),
    data: { entryLocked: true },
  });
  expect((await request.post(path(code) + '/access', { data: { name: 'Nueva' } })).status()).toBe(
    403,
  );
  expect((await decide(request, code, adminToken, pending.requestId, 'admitted')).status()).toBe(
    403,
  );
  const host = await request.post(path(code) + '/access', {
    headers: headers(adminToken),
    data: { name: 'Host' },
  });
  expect((await host.json()).token).toBeTruthy();
  await request.patch(path(code) + '/admission', {
    headers: headers(adminToken),
    data: { waitingRoomEnabled: false },
  });
  expect(await (await status(request, code, pending)).json()).toMatchObject({
    status: 'pending',
    blocked: true,
  });
  await request.patch(path(code) + '/admission', {
    headers: headers(adminToken),
    data: { entryLocked: false },
  });
  expect(await (await status(request, code, pending)).json()).toMatchObject({ status: 'admitted' });
});

test('dos decisiones simultáneas se serializan sin sobrescribirse y los nombres repetidos conservan solicitudes distintas', async ({
  request,
}) => {
  const { code, adminToken } = await setup(request);
  const first = await wait(request, code, 'Alex');
  const second = await wait(request, code, 'Alex');
  expect(first.requestId).not.toBe(second.requestId);
  const results = await Promise.all([
    decide(request, code, adminToken, first.requestId, 'admitted'),
    decide(request, code, adminToken, first.requestId, 'rejected'),
  ]);
  expect(results.map((result) => result.status()).sort()).toEqual([200, 409]);
  const actual = await (await status(request, code, first)).json();
  const winning = (await results[0].json()).status ?? 'rejected';
  expect(actual.status).toBe(winning);
  expect(await (await status(request, code, second)).json()).toMatchObject({ status: 'pending' });
});

test('el anfitrión rechaza o admite desde la interfaz; esperar, recargar y cancelar nunca conectan el chat antes de ser admitido', async ({
  browser,
  request,
}) => {
  const user = buildTestUser({ name: 'Anfitriona' });
  const registration = await request.post(API_URL + '/auth/register', { data: user });
  expect(registration.ok()).toBe(true);
  const account = await registration.json();
  const created = await request.post(API_URL + '/rooms', {
    headers: headers(account.accessToken),
    data: { name: 'Espera por UI' },
  });
  const { code } = await created.json();
  const hostContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  const guestContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  try {
    const host = await hostContext.newPage();
    await host.goto('/login');
    await host.getByLabel('Email').fill(user.email);
    await host.getByLabel('Contraseña').fill(user.password);
    await host.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(host).toHaveURL('/');
    await host.goto('/room/' + code);
    await host.getByLabel('Tu nombre en la reunión').fill('Anfitriona');
    await host.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
    await host.getByRole('button', { name: /Administrar ingresos/ }).click();
    await host.getByLabel('Activar sala de espera').check();
    await expect(host.getByLabel('Activar sala de espera')).toBeChecked();

    const guest = await guestContext.newPage();
    let earlyConnections = 0;
    guest.on('request', (req) => {
      if (/socket\.io|\/calls\//.test(req.url())) earlyConnections++;
    });
    await guest.goto('/room/' + code);
    await guest.getByLabel('Tu nombre en la reunión').fill('Invitada');
    await guest.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Sala de espera' })).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'Sala de espera' })).toBeVisible();
    await host.getByRole('button', { name: 'Actualizar solicitudes' }).click();
    await host.getByRole('button', { name: 'Rechazar Invitada', exact: true }).click();
    await expect(guest.getByRole('status')).toHaveText('El anfitrión rechazó tu solicitud.', {
      timeout: 10000,
    });
    expect(earlyConnections).toBe(0);
    await guest.getByRole('button', { name: 'Volver al formulario' }).click();
    await guest.getByLabel('Tu nombre en la reunión').fill('Invitada');
    await guest.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Sala de espera' })).toBeVisible();
    await guest.getByRole('button', { name: 'Cancelar solicitud' }).click();
    await expect(guest.getByLabel('Tu nombre en la reunión')).toBeVisible();
    expect(earlyConnections).toBe(0);
    await guest.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
    await host.getByRole('button', { name: 'Actualizar solicitudes' }).click();
    await host.getByRole('button', { name: 'Admitir Invitada', exact: true }).click();
    await expect(guest.getByPlaceholder('Escribí un mensaje...')).toBeVisible({ timeout: 10000 });
    await host.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await guest.getByPlaceholder('Escribí un mensaje...').fill('Mensaje después de admisión');
    await guest.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(host.getByTestId('messages')).toContainText('Mensaje después de admisión');
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('una cuenta que espera no obtiene membresía por la ruta anterior ni puede administrar; las solicitudes vencidas no dan acceso', async ({
  request,
}) => {
  const { code, adminToken } = await setup(request);
  const registered = await request.post(API_URL + '/auth/register', { data: buildTestUser() });
  const account = await registered.json();
  expect(
    (await request.post(path(code) + '/join', { headers: headers(account.accessToken) })).status(),
  ).toBe(403);
  expect(
    (
      await request.get(path(code) + '/admission', { headers: headers(account.accessToken) })
    ).status(),
  ).toBe(403);
  const res = await request.post(path(code) + '/access', {
    headers: headers(account.accessToken),
    data: { name: 'Registrada' },
  });
  const receipt = await res.json();
  expect(receipt.status).toBe('pending');
  const db = postgres(TEST_DATABASE_URL);
  try {
    await db`update room_admission_requests set expires_at = now() - interval '1 minute' where id = ${receipt.requestId}`;
  } finally {
    await db.end();
  }
  expect(await (await status(request, code, receipt)).json()).toMatchObject({ status: 'expired' });
  expect((await decide(request, code, adminToken, receipt.requestId, 'admitted')).status()).toBe(
    409,
  );
  const list = await request.get(path(code) + '/admission', { headers: headers(adminToken) });
  expect((await list.json()).requests).toHaveLength(0);
});
