import { expect, test } from '@playwright/test';
import {
  createRoomWithAdminViaApi,
  joinRoomAsMemberViaApi,
  registerUserViaApi,
  updateMemberRoleViaApi,
} from './support/api';
import { SPANISH_STORAGE_STATE } from './support/env';
import { buildTestUser } from './support/test-data';

// El cambio de rol (administrador -> colaborador/participante) no tenía
// ninguna cobertura, ni e2e ni de backend: ni el flujo feliz, ni las reglas
// de permisos (solo el admin puede cambiar roles, y nadie puede tocar el rol
// del admin). Ver rooms.service.ts (setMemberRole) y
// client/src/app/room/[code]/page.tsx (canChangeRole).

async function loginViaUi(
  page: import('@playwright/test').Page,
  user: { email: string; password: string },
) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('/');
}

test('el administrador puede ascender y después descender a un participante, y el cambio llega sin recargar', async ({
  browser,
  request,
}) => {
  const admin = buildTestUser({ name: 'Ana' });
  await registerUserViaApi(request, admin);
  const adminContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  const adminPage = await adminContext.newPage();
  await loginViaUi(adminPage, admin);
  await adminPage.getByRole('button', { name: 'Crear reunión' }).click();
  await adminPage.waitForURL(/\/room\//);
  const code = adminPage.url().split('/').pop() as string;
  await adminPage.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await expect(adminPage.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();

  const member = buildTestUser({ name: 'Beto' });
  await registerUserViaApi(request, member);
  const memberContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  const memberPage = await memberContext.newPage();
  await loginViaUi(memberPage, member);
  await memberPage.goto(`/room/${code}`);
  await memberPage.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await expect(memberPage.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();
  await expect(adminPage.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();

  // El admin ya había cargado su lista de roles (REST) antes de que Beto se
  // uniera. Esa lista solo se vuelve a pedir cuando llega el evento
  // memberRoleChanged (ver useRoomMembers.ts), no cuando aparece gente nueva
  // por el socket de presencia. Por eso tiene que volver a entrar a la sala
  // para que la fila de Beto tenga su rol y, con eso, el botón para cambiarlo.
  await adminPage.reload();
  await adminPage.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await expect(adminPage.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();

  const betoRowOnAdmin = adminPage.locator('.users-panel li').filter({ hasText: 'Beto' });
  const ownRowOnMember = memberPage.locator('.users-panel li').filter({ hasText: 'Beto' });
  await expect(betoRowOnAdmin.locator('.role-tag-participante')).toBeVisible();

  await betoRowOnAdmin.getByRole('button', { name: 'Hacer colaborador' }).click();

  await expect(betoRowOnAdmin.locator('.role-tag-colaborador')).toBeVisible();
  await expect(betoRowOnAdmin.getByRole('button', { name: 'Quitar colaborador' })).toBeVisible();
  // El evento llega también a la pantalla de Beto, sin que él recargue.
  await expect(ownRowOnMember.locator('.role-tag-colaborador')).toBeVisible();

  await betoRowOnAdmin.getByRole('button', { name: 'Quitar colaborador' }).click();

  await expect(betoRowOnAdmin.locator('.role-tag-participante')).toBeVisible();
  await expect(ownRowOnMember.locator('.role-tag-participante')).toBeVisible();

  await adminContext.close();
  await memberContext.close();
});

// canChangeRole en page.tsx depende solo de isCurrentUserAdmin, no del rol de
// la fila que se mira. Este test comprueba esa regla desde el lado de quien
// NO es admin: ni para la propia fila (ya ascendida a colaborador) ni para
// la de otro participante debería aparecer un botón de cambio de rol. Es un
// control de permisos real (quién puede escalar privilegios en la sala), no
// solo un detalle visual.
test('un colaborador no ve botones para cambiar roles, ni el suyo ni el de otra persona', async ({
  browser,
  request,
}) => {
  const { code, adminToken } = await createRoomWithAdminViaApi(request, 'Sala con colaborador');
  const collaborator = await joinRoomAsMemberViaApi(request, code);
  const other = await joinRoomAsMemberViaApi(request, code);
  const promoted = await updateMemberRoleViaApi(
    request,
    code,
    adminToken,
    collaborator.userId,
    'colaborador',
  );
  expect(promoted.ok()).toBe(true);

  const otherContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  const otherPage = await otherContext.newPage();
  await loginViaUi(otherPage, other.user);
  await otherPage.goto(`/room/${code}`);
  await otherPage.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await expect(otherPage.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();

  const collaboratorContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  const collaboratorPage = await collaboratorContext.newPage();
  await loginViaUi(collaboratorPage, collaborator.user);
  await collaboratorPage.goto(`/room/${code}`);
  await collaboratorPage.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await expect(collaboratorPage.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();

  await expect(collaboratorPage.locator('.role-tag-colaborador')).toBeVisible();
  await expect(collaboratorPage.locator('.role-tag-participante')).toBeVisible();
  await expect(collaboratorPage.locator('.role-button')).toHaveCount(0);

  await otherContext.close();
  await collaboratorContext.close();
});

// Rutas que antes no tenían ningún test: cambiarle el rol al propio admin
// (prohibido por reglas de negocio, no solo por permisos), cambiarle el rol
// a alguien que no es parte de la sala, y que un admin de OTRA sala no pueda
// tocar roles en esta. Las tres via API directa porque lo que se prueba es
// la respuesta del backend, no nada visual.
test('la API rechaza cambiar el rol del administrador, de quien no es miembro, y de quien no es admin de esta sala', async ({
  request,
}) => {
  const { code, adminToken, adminId } = await createRoomWithAdminViaApi(
    request,
    'Sala sin colaboradores',
  );

  const selfChange = await updateMemberRoleViaApi(request, code, adminToken, adminId, 'colaborador');
  expect(selfChange.status()).toBe(403);

  const nobodysId = '00000000-0000-0000-0000-000000000000';
  const strangerChange = await updateMemberRoleViaApi(
    request,
    code,
    adminToken,
    nobodysId,
    'colaborador',
  );
  expect(strangerChange.status()).toBe(404);

  const otherAdmin = await createRoomWithAdminViaApi(request, 'Otra sala');
  const outsiderChange = await updateMemberRoleViaApi(
    request,
    code,
    otherAdmin.adminToken,
    adminId,
    'colaborador',
  );
  expect(outsiderChange.status()).toBe(403);
});
