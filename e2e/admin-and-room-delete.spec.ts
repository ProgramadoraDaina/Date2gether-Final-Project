import { expect, test } from '@playwright/test';
import {
  createRoomWithAdminViaApi,
  joinRoomAsMemberViaApi,
  registerUserViaApi,
} from './support/api';
import { API_URL } from './support/env';
import { buildTestUser } from './support/test-data';

// Roles globales (users.role) y borrado de salas. El backend es la autoridad: la UI solo
// oculta cosas. Ver src/modules/admin y RoomsService.deleteRoomAsAdmin.

async function registerAndLogin(request: import('@playwright/test').APIRequestContext) {
  const user = buildTestUser();
  await registerUserViaApi(request, user);
  const res = await request.post(`${API_URL}/auth/login`, {
    data: { email: user.email, password: user.password },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { accessToken: string; user: { id: string; role: string } };
  return { user, token: body.accessToken, id: body.user.id, role: body.user.role };
}

test('una cuenta con rol user recibe 403 en GET /admin/users y el login devuelve role "user"', async ({
  request,
}) => {
  const { token, role } = await registerAndLogin(request);
  expect(role).toBe('user');

  const res = await request.get(`${API_URL}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(res.status()).toBe(403);
});

test('sin token, GET /admin/users responde 401', async ({ request }) => {
  const res = await request.get(`${API_URL}/admin/users`);

  expect(res.status()).toBe(401);
});

test('una cuenta con rol user tampoco puede cambiar roles ni borrar salas por /admin (403)', async ({
  request,
}) => {
  const { token, id } = await registerAndLogin(request);
  const { code } = await createRoomWithAdminViaApi(request, 'Sala ajena');
  const headers = { Authorization: `Bearer ${token}` };

  const promote = await request.patch(`${API_URL}/admin/users/${id}/role`, {
    headers,
    data: { role: 'admin' },
  });
  const moderate = await request.delete(`${API_URL}/admin/rooms/${code}`, { headers });

  expect(promote.status()).toBe(403);
  expect(moderate.status()).toBe(403);
});

test('el administrador de la sala la borra (204) y después la sala responde 404', async ({
  request,
}) => {
  const { code, adminToken } = await createRoomWithAdminViaApi(request, 'Sala para borrar');
  const headers = { Authorization: `Bearer ${adminToken}` };

  const res = await request.delete(`${API_URL}/rooms/${code}`, { headers });

  expect(res.status()).toBe(204);
  expect((await request.get(`${API_URL}/rooms/${code}`)).status()).toBe(404);
  expect((await request.delete(`${API_URL}/rooms/${code}`, { headers })).status()).toBe(404);
});

test('borrar una sala sin token responde 401 y un participante recibe 403 sin borrarla', async ({
  request,
}) => {
  const { code } = await createRoomWithAdminViaApi(request, 'Sala protegida');
  expect((await request.delete(`${API_URL}/rooms/${code}`)).status()).toBe(401);

  const member = await joinRoomAsMemberViaApi(request, code);
  const login = await request.post(`${API_URL}/auth/login`, {
    data: { email: member.user.email, password: member.user.password },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };

  const res = await request.delete(`${API_URL}/rooms/${code}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  expect(res.status()).toBe(403);
  expect((await request.get(`${API_URL}/rooms/${code}`)).status()).toBe(200);
});
