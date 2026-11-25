import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OwnedRoom } from '@/lib/api';

jest.mock('next/navigation', () => ({ usePathname: () => '/rooms' }));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/features/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn() }));
// El riel de navegación pide el rol global; estas pruebas no ejercitan el link de admin.
jest.mock('@/features/auth/useGlobalRole', () => ({ useGlobalRole: () => 'user' }));
jest.mock('@/lib/api', () => ({
  getOwnedRooms: jest.fn(),
  renameRoom: jest.fn(),
  deleteRoom: jest.fn(),
  ApiError: class extends Error {
    constructor(
      message: string,
      readonly status?: number,
    ) {
      super(message);
    }
  },
}));

function ownedRoom(overrides: Partial<OwnedRoom> = {}): OwnedRoom {
  return {
    hiddenFromMyRooms: false,
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

    await screen.findByText('Cita de los lunes', { selector: '.roomName' });
    expect(screen.getByText('Permanente')).toBeInTheDocument();
    expect(screen.getByText(/Lunes 21:30/)).toBeInTheDocument();
    expect(screen.getByText(/Próximo encuentro/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Entrar' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute(
      'href',
      '/room/abc-defg-hij',
    );
    expect(screen.getByText('Vencida')).toBeInTheDocument();
    const historyLinks = screen.getAllByRole('link', { name: 'Mis llamadas' });
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

    await screen.findByText('Cita de los lunes', { selector: '.roomName' });
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

    await screen.findByText('Grupo de los jueves', { selector: '.roomName' });
    expect(renameRoom).toHaveBeenCalledWith('abc-defg-hij', 'Grupo de los jueves');
  });

  describe('eliminar sala', () => {
    async function renderWithRoom() {
      const { isLoggedIn } = await import('@/lib/auth');
      const { getOwnedRooms } = await import('@/lib/api');
      (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
      (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([
        ownedRoom(),
        ownedRoom({ id: 'room-2', code: 'xyz-abcd-efg', name: 'Otra sala' }),
      ]);
      const MyRoomsPage = (await import('./page')).default;
      render(<MyRoomsPage />);
      await screen.findAllByText('Cita de los lunes');
    }

    it('pide confirmación en la página antes de borrar y cancelar no llama a la API', async () => {
      await renderWithRoom();
      const { deleteRoom } = await import('@/lib/api');

      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar sala' })[0]);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('Cita de los lunes');

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(deleteRoom).not.toHaveBeenCalled();
      expect(screen.getAllByText('Cita de los lunes').length).toBeGreaterThan(0);
    });

    it('al confirmar borra la sala, muestra el estado de carga y la saca de la lista', async () => {
      await renderWithRoom();
      const { deleteRoom } = await import('@/lib/api');
      let finish: () => void = () => {};
      (deleteRoom as jest.Mock<typeof deleteRoom>).mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );

      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar sala' })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar sala' }));

      expect(deleteRoom).toHaveBeenCalledWith('abc-defg-hij');
      expect(await screen.findByRole('button', { name: 'Eliminando…' })).toBeDisabled();

      finish();

      await waitFor(() => expect(screen.queryAllByText('Cita de los lunes')).toHaveLength(0));
      expect(screen.getAllByText('Otra sala').length).toBeGreaterThan(0);
    });

    it('si la sala ya no existe (404) cierra el diálogo, la saca de la lista y avisa', async () => {
      await renderWithRoom();
      const { deleteRoom, ApiError } = await import('@/lib/api');
      (deleteRoom as jest.Mock<typeof deleteRoom>).mockRejectedValue(
        new ApiError('No existe una sala con el código "abc-defg-hij"', 404),
      );

      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar sala' })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar sala' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryAllByText('Cita de los lunes')).toHaveLength(0);
      expect(screen.getAllByText('Otra sala').length).toBeGreaterThan(0);
      expect(screen.getByRole('status')).toHaveTextContent('La sala ya no existe.');
    });

    it('si el backend falla muestra el error y deja la sala en la lista', async () => {
      await renderWithRoom();
      const { deleteRoom, ApiError } = await import('@/lib/api');
      (deleteRoom as jest.Mock<typeof deleteRoom>).mockRejectedValue(
        new ApiError('Solo el administrador de la sala puede borrarla'),
      );

      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar sala' })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar sala' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Solo el administrador de la sala puede borrarla',
      );
      // El nombre también aparece en el diálogo abierto: se mira la lista.
      expect(
        within(screen.getByRole('list')).getAllByText('Cita de los lunes').length,
      ).toBeGreaterThan(0);
    });
  });

  it('avisa cuando no administra salas propias ni heredadas', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getOwnedRooms } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([]);
    const MyRoomsPage = (await import('./page')).default;
    render(<MyRoomsPage />);

    await screen.findByText('Todavía no tenés salas como administrador.');
  });
});
