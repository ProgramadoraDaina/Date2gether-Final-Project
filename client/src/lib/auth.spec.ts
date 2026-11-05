import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const ACCESS_TOKEN_KEY = 'date2gether:accessToken';
const REFRESH_TOKEN_KEY = 'date2gether:refreshToken';
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('isLoggedIn', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('es true cuando hay un access token guardado, y false cuando no hay ninguno', async () => {
    const { isLoggedIn } = await import('./auth');
    expect(isLoggedIn()).toBe(false);
    localStorage.setItem(ACCESS_TOKEN_KEY, 'token-123');
    expect(isLoggedIn()).toBe(true);
  });
});

describe('onAuthChange', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('avisa cuando cambia el access token o el refresh token en otra pestaña, pero no ante cualquier otra clave de localStorage', async () => {
    const { onAuthChange } = await import('./auth');
    const callback = jest.fn();
    const stop = onAuthChange(callback);

    window.dispatchEvent(new StorageEvent('storage', { key: 'otra-clave-cualquiera' }));
    expect(callback).not.toHaveBeenCalled();

    window.dispatchEvent(new StorageEvent('storage', { key: ACCESS_TOKEN_KEY }));
    expect(callback).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new StorageEvent('storage', { key: REFRESH_TOKEN_KEY }));
    expect(callback).toHaveBeenCalledTimes(2);

    stop();
  });

  it('deja de avisar después de llamar a la función de limpieza que devuelve', async () => {
    const { onAuthChange } = await import('./auth');
    const callback = jest.fn();
    const stop = onAuthChange(callback);
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: ACCESS_TOKEN_KEY }));
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('extractErrorMessage', () => {
  it('devuelve el primer mensaje cuando el backend manda una lista de errores de validación', async () => {
    const { extractErrorMessage } = await import('./auth');
    const res = new Response(JSON.stringify({ message: ['el email no es válido', 'otro error'] }));
    await expect(extractErrorMessage(res, 'fallback')).resolves.toBe('el email no es válido');
  });

  it('devuelve el mensaje tal cual cuando el backend manda un solo string', async () => {
    const { extractErrorMessage } = await import('./auth');
    const res = new Response(JSON.stringify({ message: 'ya existe una cuenta con ese email' }));
    await expect(extractErrorMessage(res, 'fallback')).resolves.toBe(
      'ya existe una cuenta con ese email',
    );
  });

  it('devuelve el mensaje por defecto si la respuesta no trae un body JSON que se pueda leer', async () => {
    const { extractErrorMessage } = await import('./auth');
    const res = new Response('esto no es JSON');
    await expect(extractErrorMessage(res, 'mensaje por defecto')).resolves.toBe(
      'mensaje por defecto',
    );
  });
});

describe('register', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('guarda los tokens que devuelve el backend y entrega los datos de la cuenta creada', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    const user = {
      id: 'user-1',
      email: 'a@example.test',
      name: 'Ana',
      createdAt: new Date().toISOString(),
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ accessToken: 'access-1', refreshToken: 'refresh-1', user }), {
        status: 201,
      }),
    );
    const { register } = await import('./auth');
    await expect(register('a@example.test', 'password123', 'Ana')).resolves.toEqual(user);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('access-1');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-1');
  });

  it('lanza con el mensaje del backend cuando el registro falla, y no guarda ningún token', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Ya existe una cuenta con ese email' }), {
        status: 409,
      }),
    );
    const { register } = await import('./auth');
    await expect(register('a@example.test', 'password123', 'Ana')).rejects.toThrow(
      'Ya existe una cuenta con ese email',
    );
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });
});

describe('login', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('guarda los tokens que devuelve el backend y entrega los datos de la cuenta', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    const user = {
      id: 'user-1',
      email: 'a@example.test',
      name: 'Ana',
      createdAt: new Date().toISOString(),
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ accessToken: 'access-1', refreshToken: 'refresh-1', user }), {
        status: 200,
      }),
    );
    const { login } = await import('./auth');
    await expect(login('a@example.test', 'password123')).resolves.toEqual(user);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('access-1');
  });

  it('lanza "Email o contraseña incorrectos" cuando el backend rechaza el login', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { login } = await import('./auth');
    await expect(login('a@example.test', 'mala-password')).rejects.toThrow(
      'Email o contraseña incorrectos',
    );
  });
});

describe('logout', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('borra los tokens guardados aunque el pedido de logout al backend falle', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'access-1');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-1');
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const { logout } = await import('./auth');
    await expect(logout()).resolves.toBeUndefined();
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  it('no llama al backend si ya no había una sesión guardada', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    const { logout } = await import('./auth');
    await logout();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('refreshAccessToken', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('devuelve null sin llamar al backend si no hay refresh token guardado', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    const { refreshAccessToken } = await import('./auth');
    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('guarda el access token nuevo cuando el backend renueva la sesión', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-vieja');
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ accessToken: 'access-nueva', refreshToken: 'refresh-nueva' }),
        { status: 200 },
      ),
    );
    const { refreshAccessToken } = await import('./auth');
    await expect(refreshAccessToken()).resolves.toBe('access-nueva');
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('access-nueva');
  });

  it('borra los tokens guardados y devuelve null si el backend rechaza la renovación', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-vencida');
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { refreshAccessToken } = await import('./auth');
    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });
});

describe('getCurrentUser', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('devuelve null sin llamar al backend si no hay sesión guardada', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    const { getCurrentUser } = await import('./auth');
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si el access token guardado ya venció, renueva la sesión una vez y reintenta con el token nuevo', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'access-vencido');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-vigente');
    const user = {
      id: 'user-1',
      email: 'a@example.test',
      name: 'Ana',
      createdAt: new Date().toISOString(),
    };
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ accessToken: 'access-nuevo', refreshToken: 'refresh-nuevo' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }));
    const { getCurrentUser } = await import('./auth');
    await expect(getCurrentUser()).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      headers: { Authorization: 'Bearer access-nuevo' },
    });
  });

  it('devuelve null si el token venció y tampoco se pudo renovar la sesión', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'access-vencido');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-vencida');
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { getCurrentUser } = await import('./auth');
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
