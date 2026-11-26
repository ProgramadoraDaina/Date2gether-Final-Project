import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRoomWithAdminViaApi } from './support/api';
import { API_URL } from './support/env';
import { buildTestUser } from './support/test-data';

// Contrato HTTP de PATCH /rooms/:code/permanent (promoción temporal -> permanente).
// La autorización por rol se resuelve en RoomsService.promoteToPermanent.

const promote = (request: APIRequestContext, code: string, token?: string) =>
  request.patch(`${API_URL}/rooms/${code}/permanent`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

async function joinAsParticipantToken(request: APIRequestContext, code: string) {
  const res = await request.post(`${API_URL}/auth/register`, { data: buildTestUser() });
  expect(res.ok()).toBeTruthy();
  const { accessToken } = (await res.json()) as { accessToken: string };
  const join = await request.post(`${API_URL}/rooms/${code}/join`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(join.ok()).toBeTruthy();
  return accessToken;
}

test('sin token responde 401 y la sala sigue siendo temporal', async ({ request }) => {
  const { code } = await createRoomWithAdminViaApi(request, 'Sala sin token');

  expect((await promote(request, code)).status()).toBe(401);

  const info = (await (await request.get(`${API_URL}/rooms/${code}`)).json()) as {
    isPermanent: boolean;
  };
  expect(info.isPermanent).toBe(false);
});

test('un participante recibe 403 y la sala sigue siendo temporal', async ({ request }) => {
  const { code } = await createRoomWithAdminViaApi(request, 'Sala ajena');
  const participantToken = await joinAsParticipantToken(request, code);

  expect((await promote(request, code, participantToken)).status()).toBe(403);

  const info = (await (await request.get(`${API_URL}/rooms/${code}`)).json()) as {
    isPermanent: boolean;
  };
  expect(info.isPermanent).toBe(false);
});

test('una sala inexistente responde 404', async ({ request }) => {
  const { adminToken } = await createRoomWithAdminViaApi(request, 'Otra sala');

  expect((await promote(request, 'zzz-zzzz-zzz', adminToken)).status()).toBe(404);
});

test('el administrador promueve la sala (200) y repetir la llamada es idempotente', async ({
  request,
}) => {
  const { code, adminToken } = await createRoomWithAdminViaApi(request, 'Sala a promover');

  const first = await promote(request, code, adminToken);
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ code, isPermanent: true, waitingRoomEnabled: true });

  const second = await promote(request, code, adminToken);
  expect(second.status()).toBe(200);
  expect(await second.json()).toMatchObject({ code, isPermanent: true });

  const info = (await (await request.get(`${API_URL}/rooms/${code}`)).json()) as {
    isPermanent: boolean;
  };
  expect(info.isPermanent).toBe(true);
});
