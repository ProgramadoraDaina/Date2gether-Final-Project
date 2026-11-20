import { expect, test } from '@playwright/test';
import {
  createRoomWithAdminViaApi,
  joinRoomAsMemberViaApi,
  updateMemberRoleViaApi,
} from './support/api';
import { API_URL } from './support/env';

for (const role of ['colaborador', 'administrador'] as const) {
  test(`otorgar ${role}: ${role === 'administrador' ? 'hereda' : 'no hereda'} la sala en Mis salas e Historial`, async ({
    request,
    page,
  }) => {
    const roomName = `Herencia ${role}`;
    const { code, adminToken } = await createRoomWithAdminViaApi(request, roomName);
    const member = await joinRoomAsMemberViaApi(request, code);
    const response = await updateMemberRoleViaApi(request, code, adminToken, member.userId, role);
    expect(response.ok()).toBe(true);

    await page.goto('/login');
    await page.getByLabel('Email').fill(member.user.email);
    await page.getByLabel('Contraseña').fill(member.user.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/rooms');
    if (role === 'administrador') {
      await expect(page.getByText(roomName, { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toHaveAttribute(
        'href',
        `/room/${code}`,
      );
    } else {
      await expect(page.getByText('Todavía no tenés salas como administrador.')).toBeVisible();
      await expect(page.getByText(roomName, { exact: true })).toHaveCount(0);
    }
    await page.goto('/history');
    const administered = page.getByRole('region', { name: 'Salas que administrás' });
    if (role === 'administrador') {
      await expect(administered.getByText(roomName, { exact: true })).toBeVisible();
      await administered.getByRole('link', { name: 'Entrar', exact: true }).click();
      await expect(page).toHaveURL(`/room/${code}`);
      await expect(
        page.getByRole('button', { name: 'Entrar a la reunión', exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        administered.getByText('Todavía no tenés salas como administrador.'),
      ).toBeVisible();
      await expect(administered.getByText(roomName, { exact: true })).toHaveCount(0);
    }
  });
}

test('solo un nuevo admin puede conceder ambos roles y entrar sin esperar al creador', async ({
  request,
}) => {
  const { code, adminToken, adminId } = await createRoomWithAdminViaApi(
    request,
    'Delegación de permisos',
  );
  const heir = await joinRoomAsMemberViaApi(request, code);
  const other = await joinRoomAsMemberViaApi(request, code);
  const login = await request.post(`${API_URL}/auth/login`, {
    data: { email: heir.user.email, password: heir.user.password },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  expect(
    (
      await updateMemberRoleViaApi(request, code, accessToken, other.userId, 'administrador')
    ).status(),
  ).toBe(403);
  expect(
    (await updateMemberRoleViaApi(request, code, adminToken, heir.userId, 'colaborador')).ok(),
  ).toBe(true);
  expect(
    (
      await updateMemberRoleViaApi(request, code, accessToken, other.userId, 'administrador')
    ).status(),
  ).toBe(403);
  expect(
    (await updateMemberRoleViaApi(request, code, adminToken, heir.userId, 'administrador')).ok(),
  ).toBe(true);
  expect(
    (await updateMemberRoleViaApi(request, code, accessToken, other.userId, 'colaborador')).ok(),
  ).toBe(true);
  expect(
    (await updateMemberRoleViaApi(request, code, accessToken, other.userId, 'administrador')).ok(),
  ).toBe(true);

  const settings = await request.patch(`${API_URL}/rooms/${code}/admission`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { waitingRoomEnabled: true, entryLocked: true },
  });
  expect(settings.ok()).toBe(true);
  const access = await request.post(`${API_URL}/rooms/${code}/access`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name: heir.user.name },
  });
  expect(access.ok()).toBe(true);
  expect(await access.json()).toHaveProperty('token');
  const members = await request.get(`${API_URL}/rooms/${code}/members`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(await members.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ userId: adminId, role: 'administrador' }),
      expect.objectContaining({ userId: heir.userId, role: 'administrador' }),
      expect.objectContaining({ userId: other.userId, role: 'administrador' }),
    ]),
  );

  expect(
    (await updateMemberRoleViaApi(request, code, adminToken, heir.userId, 'colaborador')).ok(),
  ).toBe(true);
  const inherited = await request.get(`${API_URL}/rooms/mine`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(await inherited.json()).toEqual([]);
  expect(
    (
      await updateMemberRoleViaApi(request, code, accessToken, other.userId, 'participante')
    ).status(),
  ).toBe(403);
});
