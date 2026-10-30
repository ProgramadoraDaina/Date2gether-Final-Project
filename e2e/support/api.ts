import type { APIRequestContext } from '@playwright/test';
import { API_URL } from './env';
import { buildTestUser, type TestUser } from './test-data';

// Crea una cuenta directamente contra la API, sin pasar por el formulario.
// Se usa en tests que necesitan "una cuenta que ya existe" como precondición
// (por ejemplo, probar el login) sin repetir el flujo de registro de nuevo:
// cada test debería enfocarse en una sola cosa.
export async function registerUserViaApi(
  request: APIRequestContext,
  user: TestUser,
): Promise<void> {
  const res = await request.post(`${API_URL}/auth/register`, { data: user });
  if (!res.ok()) {
    throw new Error(`No se pudo crear el usuario de prueba: ${res.status()} ${await res.text()}`);
  }
}

// Crear sala exige login, así que primero registra una cuenta descartable.
export async function createRoomViaApi(request: APIRequestContext, name: string): Promise<string> {
  const user = buildTestUser();
  const registerRes = await request.post(`${API_URL}/auth/register`, { data: user });
  if (!registerRes.ok()) {
    throw new Error(
      `No se pudo crear el usuario de prueba: ${registerRes.status()} ${await registerRes.text()}`,
    );
  }
  const { accessToken } = (await registerRes.json()) as { accessToken: string };

  const res = await request.post(`${API_URL}/rooms`, {
    data: { name },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok()) {
    throw new Error(`No se pudo crear la sala de prueba: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { code: string };
  return body.code;
}

export interface RoomWithAdmin {
  code: string;
  adminToken: string;
  adminId: string;
}

// Igual que createRoomViaApi, pero además devuelve el token y el id de quien
// creó la sala (queda como 'administrador'): hace falta para los tests que
// necesitan seguir actuando como esa cuenta, por ejemplo cambiar el rol de
// otros miembros.
export async function createRoomWithAdminViaApi(
  request: APIRequestContext,
  name: string,
): Promise<RoomWithAdmin> {
  const admin = buildTestUser();
  const registerRes = await request.post(`${API_URL}/auth/register`, { data: admin });
  if (!registerRes.ok()) {
    throw new Error(
      `No se pudo crear el usuario admin: ${registerRes.status()} ${await registerRes.text()}`,
    );
  }
  const { accessToken, user } = (await registerRes.json()) as {
    accessToken: string;
    user: { id: string };
  };

  const res = await request.post(`${API_URL}/rooms`, {
    data: { name },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok()) {
    throw new Error(`No se pudo crear la sala de prueba: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { code: string };
  return { code: body.code, adminToken: accessToken, adminId: user.id };
}

export interface JoinedMember {
  user: TestUser;
  userId: string;
}

// Registra una cuenta nueva y la une a una sala ya existente como
// 'participante', vía el mismo endpoint que usa una persona logueada al
// entrar por enlace/código (no el de invitados, que no deja rol). Devuelve
// las credenciales de la cuenta para poder loguearla por UI más adelante,
// en los tests que necesitan ver cómo reacciona esa persona en pantalla.
export async function joinRoomAsMemberViaApi(
  request: APIRequestContext,
  code: string,
): Promise<JoinedMember> {
  const user = buildTestUser();
  const registerRes = await request.post(`${API_URL}/auth/register`, { data: user });
  if (!registerRes.ok()) {
    throw new Error(
      `No se pudo crear el usuario de prueba: ${registerRes.status()} ${await registerRes.text()}`,
    );
  }
  const { accessToken, user: createdUser } = (await registerRes.json()) as {
    accessToken: string;
    user: { id: string };
  };

  const joinRes = await request.post(`${API_URL}/rooms/${code}/join`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!joinRes.ok()) {
    throw new Error(`No se pudo unir a la sala de prueba: ${joinRes.status()} ${await joinRes.text()}`);
  }
  return { user, userId: createdUser.id };
}

// Wrapper fino sobre PATCH /rooms/:code/members/:userId: a diferencia de los
// demás helpers de este archivo, no tira si la respuesta falla, porque varios
// tests quieren inspeccionar el código de error (403, 404) en vez de
// tratarlo como una precondición rota.
export function updateMemberRoleViaApi(
  request: APIRequestContext,
  code: string,
  adminToken: string,
  targetUserId: string,
  role: 'colaborador' | 'participante',
) {
  return request.patch(`${API_URL}/rooms/${code}/members/${targetUserId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { role },
  });
}
