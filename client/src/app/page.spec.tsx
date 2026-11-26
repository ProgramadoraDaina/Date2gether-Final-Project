import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { loginUrlFor } from '@/features/auth/safeRedirect';
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/',
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/auth', () => ({
  getCurrentUser: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  getCurrentUserOrThrow: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  isLoggedIn: jest.fn<() => boolean>().mockReturnValue(false),
  onAuthChange: () => () => {},
  logout: jest.fn(),
}));
jest.mock('@/lib/api', () => ({ createRoom: jest.fn() }));

const loggedInUser = {
  id: 'user-1',
  email: 'a@a.com',
  name: 'Daina',
  createdAt: '2026-01-01',
  nameColor: null,
};

async function setSession(user: typeof loggedInUser | null) {
  const { getCurrentUser, isLoggedIn } = await import('@/lib/auth');
  (isLoggedIn as jest.Mock<() => boolean>).mockReturnValue(user !== null);
  (getCurrentUser as jest.Mock<() => Promise<typeof user>>).mockResolvedValue(user);
}

describe('HomePage', () => {
  beforeEach(async () => {
    localStorage.clear();
    push.mockClear();
    const { createRoom } = await import('@/lib/api');
    (createRoom as jest.Mock).mockClear();
    // Default to logged out so tests do not leak a session into each other.
    await setSession(null);
  });
  it('sin sesión, "Crear reunión" está habilitado y redirige al login con retorno al home, sin crear sala', async () => {
    const { createRoom } = await import('@/lib/api');
    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Iniciar sesión');

    const button = screen.getByRole('button', { name: 'Crear reunión' });
    expect(button).toBeEnabled();
    // Name input is empty on purpose: `required` must not block the redirect.
    fireEvent.click(button);

    expect(push).toHaveBeenCalledWith(loginUrlFor('/'));
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('con token válido pero /auth/me fallando (429/5xx), sigue contando como sesión y crea la sala', async () => {
    await setSession(null);
    const { isLoggedIn } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<() => boolean>).mockReturnValue(true);
    localStorage.setItem('date2gether:userName', 'Ana');
    const { createRoom } = await import('@/lib/api');
    (createRoom as jest.Mock<typeof createRoom>).mockResolvedValue({
      id: 'room-1',
      code: 'abc-defg-hij',
      name: 'Reunión de Ana',
      isPermanent: false,
      createdAt: '2026-01-01',
    });
    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Iniciar sesión');

    fireEvent.click(screen.getByRole('button', { name: 'Crear reunión' }));

    await waitFor(() => expect(createRoom).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalledWith(loginUrlFor('/'));
  });

  it('sin sesión, no se muestran los campos de sala permanente', async () => {
    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Iniciar sesión');

    expect(
      screen.queryByLabelText('Sala permanente (enlace fijo, con sala de espera siempre activa)'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre de la sala')).not.toBeInTheDocument();
    expect(screen.queryByText('Horario semanal')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tu nombre')).toBeInTheDocument();
  });
  it('permite navegar a una sala con nombre y código sin iniciar sesión', async () => {
    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Iniciar sesión');
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Daina' } });
    fireEvent.change(screen.getByPlaceholderText('abc-defg-hij'), {
      target: { value: 'abc-defg-hij' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unirse' }));
    expect(push).toHaveBeenCalledWith('/room/abc-defg-hij');
    expect(push).not.toHaveBeenCalledWith('/login');
  });

  it('[5.2] el editor de horarios solo aparece cuando se activa el toggle de sala permanente', async () => {
    await setSession(loggedInUser);
    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Conectado como');

    expect(screen.queryByText('Horario semanal')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText('Sala permanente (enlace fijo, con sala de espera siempre activa)'),
    );
    expect(screen.getByText('Horario semanal')).toBeInTheDocument();
  });

  it('[5.2] crea la sala con isPermanent:true cuando el toggle está activo', async () => {
    const { getCurrentUser } = await import('@/lib/auth');
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: null,
    });
    const { createRoom } = await import('@/lib/api');
    (createRoom as jest.Mock<typeof createRoom>).mockResolvedValue({
      id: 'room-1',
      code: 'abc-defg-hij',
      name: 'Reunión de Daina',
      isPermanent: true,
      createdAt: '2026-01-01',
    });

    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Conectado como');
    fireEvent.click(
      screen.getByLabelText('Sala permanente (enlace fijo, con sala de espera siempre activa)'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Crear reunión' }));

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(
        'Reunión de Daina',
        expect.objectContaining({ isPermanent: true }),
      ),
    );
  });

  it('el campo de nombre de sala solo aparece con la sala permanente activa', async () => {
    await setSession(loggedInUser);
    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Conectado como');

    expect(screen.queryByLabelText('Nombre de la sala')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText('Sala permanente (enlace fijo, con sala de espera siempre activa)'),
    );
    expect(screen.getByLabelText('Nombre de la sala')).toBeInTheDocument();
  });

  it('usa el nombre de sala escrito en vez del autogenerado, si se completa en una permanente', async () => {
    const { getCurrentUser } = await import('@/lib/auth');
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: null,
    });
    const { createRoom } = await import('@/lib/api');
    (createRoom as jest.Mock<typeof createRoom>).mockResolvedValue({
      id: 'room-1',
      code: 'abc-defg-hij',
      name: 'Grupo de los jueves',
      isPermanent: true,
      createdAt: '2026-01-01',
    });

    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Conectado como');
    fireEvent.click(
      screen.getByLabelText('Sala permanente (enlace fijo, con sala de espera siempre activa)'),
    );
    fireEvent.change(screen.getByLabelText('Nombre de la sala'), {
      target: { value: 'Grupo de los jueves' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear reunión' }));

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(
        'Grupo de los jueves',
        expect.objectContaining({ isPermanent: true }),
      ),
    );
  });
});
