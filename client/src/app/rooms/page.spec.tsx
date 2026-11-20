import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OwnedRoom } from '@/lib/api';

jest.mock('next/navigation', () => ({ usePathname: () => '/rooms' }));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn() }));
jest.mock('@/lib/api', () => ({
  getOwnedRooms: jest.fn(),
  renameRoom: jest.fn(),
  ApiError: class extends Error {},
}));

function ownedRoom(overrides: Partial<OwnedRoom> = {}): OwnedRoom {
  return {
    id: 'room-1',
    code: 'abc-defg-hij',
    name: 'Cita de los lunes',
    isPermanent: true,
    isJoinable: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    lastEnteredAt: '2026-11-17T10:00:00.000Z',
    slots: [{ dayOfWeek: 1, timeOfDay: '21:30', timezone: 'America/Argentina/Buenos_Aires' }],
    nextOccurrenceAt: '2026-11-24T00:30:00.000Z',
    ...overrides,
  };
}

describe('MyRoomsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pide iniciar sesión si no hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(false);
    const MyRoomsPage = (await import('./page')).default;
    render(<MyRoomsPage />);

    await screen.findByText('Necesitás iniciar sesión para ver tus salas.');
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login');
  });

  it('lista las salas con horarios, próximo encuentro y accesos a entrar e historial', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getOwnedRooms } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([
      ownedRoom(),
      ownedRoom({
        id: 'room-2',
        code: 'xyz-abcd-efg',
        name: 'Sala vieja',
        isPermanent: false,
        isJoinable: false,
        slots: [],
        nextOccurrenceAt: null,
      }),
    ]);
    const MyRoomsPage = (await import('./page')).default;
    render(<MyRoomsPage />);

    await screen.findByText('Cita de los lunes');
    expect(screen.getByText('Permanente')).toBeInTheDocument();
    expect(screen.getByText(/Lunes 21:30/)).toBeInTheDocument();
    expect(screen.getByText(/Próximo encuentro/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Entrar' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute(
      'href',
      '/room/abc-defg-hij',
    );
    expect(screen.getByText('Vencida')).toBeInTheDocument();
    const historyLinks = screen.getAllByRole('link', { name: 'Ver historial' });
    expect(historyLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/history?roomId=room-1',
      '/history?roomId=room-2',
    ]);
  });

  it('copia el link de la sala al portapapeles', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getOwnedRooms } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([ownedRoom()]);
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const MyRoomsPage = (await import('./page')).default;
    render(<MyRoomsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Copiar link' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/room/abc-defg-hij`);
    expect(await screen.findByText('Link copiado')).toBeInTheDocument();
  });

  it('solo muestra el botón de renombrar en salas permanentes', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getOwnedRooms } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([
      ownedRoom(),
      ownedRoom({ id: 'room-2', code: 'xyz-abcd-efg', name: 'Sala vieja', isPermanent: false }),
    ]);
    const MyRoomsPage = (await import('./page')).default;
    render(<MyRoomsPage />);

    await screen.findByText('Cita de los lunes');
    expect(screen.getAllByRole('button', { name: 'Renombrar sala' })).toHaveLength(1);
  });

  it('renombra una sala permanente y actualiza el nombre mostrado', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getOwnedRooms, renameRoom } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([ownedRoom()]);
    (renameRoom as jest.Mock<typeof renameRoom>).mockResolvedValue(undefined);
    const MyRoomsPage = (await import('./page')).default;
    render(<MyRoomsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Renombrar sala' }));
    fireEvent.change(screen.getByLabelText('Nuevo nombre de la sala'), {
      target: { value: 'Grupo de los jueves' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await screen.findByText('Grupo de los jueves');
    expect(renameRoom).toHaveBeenCalledWith('abc-defg-hij', 'Grupo de los jueves');
  });

  it('avisa cuando todavía no creó ninguna sala', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getOwnedRooms } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([]);
    const MyRoomsPage = (await import('./page')).default;
    render(<MyRoomsPage />);

    await screen.findByText('Todavía no creaste ninguna sala.');
  });
});
