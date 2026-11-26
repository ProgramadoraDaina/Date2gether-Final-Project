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
  promoteRoomToPermanent: jest.fn(),
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
    expect(screen.queryByRole('link', { name: 'Mis llamadas' })).not.toBeInTheDocument();
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

  it('muestra el botón de renombrar en todas las salas vigentes, temporales o permanentes', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getOwnedRooms } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([
      ownedRoom(),
      ownedRoom({ id: 'room-2', code: 'xyz-abcd-efg', name: 'Sala temporal', isPermanent: false }),
      ownedRoom({
        id: 'room-3',
        code: 'old-abcd-efg',
        name: 'Sala vieja',
        isPermanent: false,
        isJoinable: false,
      }),
    ]);
    const MyRoomsPage = (await import('./page')).default;
    render(<MyRoomsPage />);

    await screen.findByText('Cita de los lunes', { selector: '.roomName' });
    expect(screen.getAllByRole('button', { name: 'Renombrar sala' })).toHaveLength(2);
  });

  it('renombra una sala temporal', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getOwnedRooms, renameRoom } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([
      ownedRoom({ isPermanent: false, slots: [], nextOccurrenceAt: null }),
    ]);
    (renameRoom as jest.Mock<typeof renameRoom>).mockResolvedValue(undefined);
    const MyRoomsPage = (await import('./page')).default;
    render(<MyRoomsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Renombrar sala' }));
    fireEvent.change(screen.getByLabelText('Nuevo nombre de la sala'), {
      target: { value: 'Nombre nuevo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await screen.findByText('Nombre nuevo', { selector: '.roomName' });
    expect(renameRoom).toHaveBeenCalledWith('abc-defg-hij', 'Nombre nuevo');
  });

  describe('hacer permanente', () => {
    async function renderTemporary() {
      const { isLoggedIn } = await import('@/lib/auth');
      const { getOwnedRooms } = await import('@/lib/api');
      (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
      (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([
        ownedRoom({ isPermanent: false, slots: [], nextOccurrenceAt: null }),
      ]);
      const MyRoomsPage = (await import('./page')).default;
      render(<MyRoomsPage />);
      await screen.findByText('Cita de los lunes', { selector: '.roomName' });
    }

    it('no ofrece la acción en una sala que ya es permanente ni en una vencida', async () => {
      const { isLoggedIn } = await import('@/lib/auth');
      const { getOwnedRooms } = await import('@/lib/api');
      (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
      (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([
        ownedRoom(),
        ownedRoom({ id: 'room-2', code: 'old-abcd-efg', isPermanent: false, isJoinable: false }),
      ]);
      const MyRoomsPage = (await import('./page')).default;
      render(<MyRoomsPage />);
      await screen.findAllByText('Cita de los lunes');

      expect(screen.queryByRole('button', { name: /Hacer permanente/ })).not.toBeInTheDocument();
    });

    it('pide confirmación explicando que es irreversible y cancelar no llama a la API', async () => {
      await renderTemporary();
      const { promoteRoomToPermanent } = await import('@/lib/api');

      fireEvent.click(screen.getByRole('button', { name: /Hacer permanente/ }));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('Cita de los lunes');
      expect(dialog).toHaveTextContent('no se puede deshacer');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

      expect(promoteRoomToPermanent).not.toHaveBeenCalled();
      expect(screen.queryByText('Permanente')).not.toBeInTheDocument();
    });

    it('al confirmar muestra carga, llama a la API y la sala pasa a mostrar la insignia Permanente', async () => {
      await renderTemporary();
      const { promoteRoomToPermanent } = await import('@/lib/api');
      let finish: () => void = () => {};
      (promoteRoomToPermanent as jest.Mock<typeof promoteRoomToPermanent>).mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );

      fireEvent.click(screen.getByRole('button', { name: /Hacer permanente/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Sí, hacer permanente' }));

      expect(promoteRoomToPermanent).toHaveBeenCalledWith('abc-defg-hij');
      expect(await screen.findByRole('button', { name: 'Haciendo permanente…' })).toBeDisabled();

      finish();

      expect(await screen.findByText('Permanente')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /Hacer permanente/ })).not.toBeInTheDocument();
    });

    it('si el backend falla muestra el error en el diálogo y la sala sigue siendo temporal', async () => {
      await renderTemporary();
      const { promoteRoomToPermanent, ApiError } = await import('@/lib/api');
      (promoteRoomToPermanent as jest.Mock<typeof promoteRoomToPermanent>).mockRejectedValue(
        new ApiError('Solo el administrador de la sala puede hacerla permanente', 403),
      );

      fireEvent.click(screen.getByRole('button', { name: /Hacer permanente/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Sí, hacer permanente' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Solo el administrador de la sala puede hacerla permanente',
      );
      expect(screen.queryByText('Permanente')).not.toBeInTheDocument();
    });
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
