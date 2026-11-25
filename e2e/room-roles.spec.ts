import { expect, test } from '@playwright/test';
import {
  createRoomWithAdminViaApi,
  joinRoomAsMemberViaApi,
  registerUserViaApi,
  updateMemberRoleViaApi,
} from './support/api';
import { SPANISH_STORAGE_STATE } from './support/env';
import { buildTestUser } from './support/test-data';

// Los cambios de permisos se realizan desde el menú junto a cada nombre.
// Solo un admin puede usarlos y el rol del propietario está protegido.

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
  await adminPage.getByRole('button', { name: 'Presentes', exact: true }).click();
  await expect(adminPage.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();

  const member = buildTestUser({ name: 'Beto' });
  await registerUserViaApi(request, member);
  const memberContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  const memberPage = await memberContext.newPage();
  await loginViaUi(memberPage, member);
  await memberPage.goto(`/room/${code}`);
  await memberPage.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await memberPage.getByRole('button', { name: 'Presentes', exact: true }).click();
  await expect(memberPage.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();
  await expect(adminPage.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();

  const betoRowOnAdmin = adminPage
    .getByTestId('users-panel')
    .locator('li')
    .filter({ hasText: 'Beto' });
  const ownRowOnMember = memberPage
    .getByTestId('users-panel')
    .locator('li')
    .filter({ hasText: 'Beto' });
  await expect(betoRowOnAdmin.getByTestId('role-tag-participante')).toBeVisible();

  await betoRowOnAdmin.getByRole('button', { name: 'Permisos de Beto' }).click();
  await betoRowOnAdmin.getByRole('menuitem', { name: 'Hacer colaborador' }).click();

  await expect(betoRowOnAdmin.getByTestId('role-tag-colaborador')).toBeVisible();
  await expect(betoRowOnAdmin.getByRole('menu')).toHaveCount(0);
  // El evento llega también a la pantalla de Beto, sin que él recargue.
  await expect(ownRowOnMember.getByTestId('role-tag-colaborador')).toBeVisible();

  await betoRowOnAdmin.getByRole('button', { name: 'Permisos de Beto' }).click();
  await betoRowOnAdmin.getByRole('menuitem', { name: 'Quitar colaborador' }).click();

  await expect(betoRowOnAdmin.getByTestId('role-tag-participante')).toBeVisible();
  await expect(ownRowOnMember.getByTestId('role-tag-participante')).toBeVisible();

  await betoRowOnAdmin.getByRole('button', { name: 'Permisos de Beto' }).click();
  await betoRowOnAdmin.getByRole('menuitem', { name: 'Hacer administrador' }).click();
  await expect(betoRowOnAdmin.getByTestId('role-tag-administrador')).toBeVisible();
  await expect(ownRowOnMember.getByTestId('role-tag-administrador')).toBeVisible();
  await expect(betoRowOnAdmin.getByRole('button', { name: 'Permisos de Beto' })).toBeVisible();
  await expect(memberPage.getByRole('button', { name: 'Administrar ingresos (0)' })).toBeVisible();
  const ownerRow = memberPage.getByTestId('users-panel').locator('li').filter({ hasText: 'Ana' });
  await expect(ownerRow.getByText('Propietario')).toBeVisible();
  await expect(ownerRow.getByRole('button', { name: 'Permisos de Ana' })).toHaveCount(0);

  await betoRowOnAdmin.getByRole('button', { name: 'Permisos de Beto' }).click();
  await betoRowOnAdmin.getByRole('menuitem', { name: 'Quitar administrador' }).click();
  await expect(betoRowOnAdmin.getByTestId('role-tag-participante')).toBeVisible();
  await expect(ownRowOnMember.getByTestId('role-tag-participante')).toBeVisible();
  await expect(memberPage.getByTestId('role-button')).toHaveCount(0);

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
  await otherPage.getByRole('button', { name: 'Presentes', exact: true }).click();
  await expect(otherPage.getByRole('heading', { name: 'En la sala (1)' })).toBeVisible();

  const collaboratorContext = await browser.newContext({ storageState: SPANISH_STORAGE_STATE });
  const collaboratorPage = await collaboratorContext.newPage();
  await loginViaUi(collaboratorPage, collaborator.user);
  await collaboratorPage.goto(`/room/${code}`);
  await collaboratorPage.getByRole('button', { name: 'Entrar a la reunión', exact: true }).click();
  await collaboratorPage.getByRole('button', { name: 'Presentes', exact: true }).click();
  await expect(collaboratorPage.getByRole('heading', { name: 'En la sala (2)' })).toBeVisible();

  await expect(collaboratorPage.getByTestId('role-tag-colaborador')).toBeVisible();
  await expect(collaboratorPage.getByTestId('role-tag-participante')).toBeVisible();
  await expect(collaboratorPage.getByTestId('role-button')).toHaveCount(0);

  await otherContext.close();
  await collaboratorContext.close();
});

test('la API protege al propietario y rechaza cambios a no miembros o solicitados por personas ajenas', async ({
  request,
}) => {
  const { code, adminToken, adminId } = await createRoomWithAdminViaApi(
    request,
    'Sala sin colaboradores',
  );

  const selfChange = await updateMemberRoleViaApi(
    request,
    code,
    adminToken,
    adminId,
    'colaborador',
  );
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
