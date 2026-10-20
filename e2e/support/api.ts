import type { APIRequestContext } from '@playwright/test';
import { API_URL } from './env';
import type { TestUser } from './test-data';

// Crea una cuenta directamente contra la API, sin pasar por el formulario.
// Se usa en tests que necesitan "una cuenta que ya existe" como precondición
// (por ejemplo, probar el login) sin repetir el flujo de registro de nuevo:
// cada test debería enfocarse en una sola cosa.
export async function registerUserViaApi(request: APIRequestContext, user: TestUser): Promise<void> {
  const res = await request.post(`${API_URL}/auth/register`, { data: user });
  if (!res.ok()) {
    throw new Error(`No se pudo crear el usuario de prueba: ${res.status()} ${await res.text()}`);
  }
}

// Crea una sala directamente contra la API y devuelve su código, para tests
// que necesitan "una sala que ya existe" sin pasar por el formulario de creación.
export async function createRoomViaApi(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${API_URL}/rooms`, { data: { name } });
  if (!res.ok()) {
    throw new Error(`No se pudo crear la sala de prueba: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { code: string };
  return body.code;
}
