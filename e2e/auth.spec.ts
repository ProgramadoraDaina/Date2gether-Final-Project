import { expect, test } from '@playwright/test';
import { registerUserViaApi } from './support/api';
import { buildTestUser } from './support/test-data';

// Todos estos tests cubren el flujo de autenticación que se armó en las
// últimas features: registro, login, persistencia de sesión y logout.
// Cada uno prueba UNA sola cosa, a propósito (ver clase: "fail fast" y
// tests chicos son más fáciles de diagnosticar cuando fallan).
test.describe('Registro', () => {
  // Carga el formulario de /register con datos válidos (nombre, email nuevo,
  // contraseña que cumple los requisitos) y lo envía. Se espera que la cuenta
  // se cree en el backend, el navegador guarde la sesión, y la app redirija
  // al home mostrando "Conectado como <nombre>".
  test('un usuario nuevo puede registrarse y queda logueado', async ({ page }) => {
    const user = buildTestUser();

    await page.goto('/register');
    await page.getByLabel('Nombre').fill(user.name);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill(user.password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.locator('.auth-bar')).toContainText(user.name);
  });

  // El input de contraseña solo bloquea en el navegador que tenga menos de
  // 8 caracteres (atributo minLength), pero la regla real "al menos una
  // letra y un número" la valida el backend (RegisterDto). Este test manda
  // una contraseña de 8 letras sin ningún número a propósito, para
  // comprobar que esa regla del servidor realmente se aplica y que el
  // mensaje de error llega hasta la pantalla (no se queda "silencioso").
  test('el registro falla si la contraseña no tiene un número', async ({ page }) => {
    const user = buildTestUser({ password: 'abcdefgh' });

    await page.goto('/register');
    await page.getByLabel('Nombre').fill(user.name);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill(user.password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    await expect(page.locator('.error')).toContainText('letra y un número');
    await expect(page).toHaveURL('/register');
  });

  // Registra un email por API (precondición) y después intenta registrar
  // ESE MISMO email de nuevo desde el formulario. Comprueba que el backend
  // rechaza cuentas duplicadas y que ese rechazo se muestra como error en
  // la UI, en vez de crear una segunda cuenta o loguear silenciosamente.
  test('el registro falla si el email ya tiene una cuenta', async ({ page, request }) => {
    const user = buildTestUser();
    await registerUserViaApi(request, user);

    await page.goto('/register');
    await page.getByLabel('Nombre').fill('Otro Nombre');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill(user.password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    await expect(page.locator('.error')).toContainText('Ya existe una cuenta con ese email');
    await expect(page).toHaveURL('/register');
  });
});

test.describe('Login', () => {
  // Crea una cuenta por API (no nos interesa probar el registro acá, solo
  // necesitamos "una cuenta que ya existe") y después inicia sesión desde
  // /login con esas credenciales. Se espera la misma redirección y estado
  // de sesión que después de un registro exitoso.
  test('un usuario existente puede iniciar sesión', async ({ page, request }) => {
    const user = buildTestUser();
    await registerUserViaApi(request, user);

    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill(user.password);
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.locator('.auth-bar')).toContainText(user.name);
  });

  // Mismo email que una cuenta real, pero contraseña incorrecta. El backend
  // no debe distinguir si falló el email o la contraseña (mensaje genérico
  // "Email o contraseña incorrectos"), y la app tiene que quedarse en
  // /login mostrando ese error, sin loguear a nadie.
  test('el login falla con la contraseña incorrecta', async ({ page, request }) => {
    const user = buildTestUser();
    await registerUserViaApi(request, user);

    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill('la-contraseña-incorrecta-1');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.locator('.error')).toContainText('incorrectos');
    await expect(page).toHaveURL('/login');
  });
});

test.describe('Sesión', () => {
  // Después de loguearse, recargar la página (F5) no debería cerrar la
  // sesión: el home tiene que volver a pedir el usuario actual usando el
  // token guardado (getCurrentUser) y mostrar "Conectado como" de nuevo.
  // Esto prueba que la sesión sobrevive a una recarga, no solo a la
  // navegación dentro de la SPA.
  test('la sesión persiste después de recargar la página', async ({ page }) => {
    const user = buildTestUser();

    await page.goto('/register');
    await page.getByLabel('Nombre').fill(user.name);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill(user.password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL('/');

    await page.reload();

    await expect(page.locator('.auth-bar')).toContainText(user.name);
  });

  // Logueado y en el home, hacer click en "Cerrar sesión" tiene que: (1)
  // borrar los tokens guardados, (2) volver a mostrar los links de
  // "Iniciar sesión" / "Crear cuenta", y (3) mantenerse así después de
  // recargar (si solo se borrara el estado en memoria, al recargar
  // volvería a aparecer logueado).
  test('cerrar sesión borra el estado y persiste después de recargar', async ({ page }) => {
    const user = buildTestUser();

    await page.goto('/register');
    await page.getByLabel('Nombre').fill(user.name);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Contraseña').fill(user.password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.locator('.auth-bar')).toContainText(user.name);

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
  });
});
