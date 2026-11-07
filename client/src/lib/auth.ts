const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const ACCESS_TOKEN_KEY = 'date2gether:accessToken';
const REFRESH_TOKEN_KEY = 'date2gether:refreshToken';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  nameColor: string | null;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return getAccessToken() !== null;
}

// El evento "storage" solo llega a las OTRAS pestañas: así se detecta un logout hecho en otra.
export function onAuthChange(callback: () => void): () => void {
  function handleStorage(e: StorageEvent) {
    if (e.key === ACCESS_TOKEN_KEY || e.key === REFRESH_TOKEN_KEY) callback();
  }
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}

function setTokens(tokens: AuthTokens): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

// Variante de extractErrorMessage que además devuelve `code`, si el backend
// lo manda (p. ej. NO_HOST_CONNECTED del gate de anfitrión de llamadas). El
// body solo se puede leer una vez por Response, así que los puntos de
// llamada que necesitan ambos datos deben usar esta función en lugar de
// llamar a extractErrorMessage y luego intentar leer el código por su
// cuenta.
export async function extractErrorDetails(
  res: Response,
  fallback: string,
): Promise<{ message: string; code?: string }> {
  try {
    const body = await res.json();
    const message = Array.isArray(body.message)
      ? body.message[0]
      : typeof body.message === 'string'
        ? body.message
        : fallback;
    const code = typeof body.code === 'string' ? body.code : undefined;
    return { message, code };
  } catch {
    // respuesta sin body JSON: se usa el mensaje por defecto
    return { message: fallback };
  }
}

export async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  return (await extractErrorDetails(res, fallback)).message;
}

export async function register(email: string, password: string, name: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'No se pudo crear la cuenta'));

  const data: AuthTokens & { user: AuthUser } = await res.json();
  setTokens(data);
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'Email o contraseña incorrectos'));

  const data: AuthTokens & { user: AuthUser } = await res.json();
  setTokens(data);
  return data.user;
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  clearTokens();
  if (!refreshToken) return;

  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Los tokens locales ya se borraron; un error de red no debe bloquear el logout.
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }

  const data: AuthTokens = await res.json();
  setTokens(data);
  return data.accessToken;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const accessToken = getAccessToken();
  if (!accessToken) return null;

  let res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401) {
    const newAccessToken = await refreshAccessToken();
    if (!newAccessToken) return null;
    res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${newAccessToken}` },
    });
  }

  if (!res.ok) return null;
  return res.json();
}
